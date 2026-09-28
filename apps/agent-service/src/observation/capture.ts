import { mkdir, readFile, link, unlink, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decisionSchema } from "@pickler/api-schema";
import type { ResearchObservation, ResearchObserver } from "@pickler/core";
import { fingerprint, EvaluationFailure } from "../evaluation/decision-evaluation";

const timestamp = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const source = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    url: z.string().nullable(),
    content: z.string(),
    contentHash: hash,
    publishedAt: timestamp.nullable(),
    retrievedAt: timestamp,
    truncated: z.boolean(),
  })
  .strict();
export const captureSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("research-decision-observation"),
    observedAt: timestamp,
    scope: z
      .object({
        tenantId: z.string(),
        agentId: z.string(),
        runId: z.string(),
        configVersion: z.number().int().positive(),
      })
      .strict(),
    market: z
      .object({
        id: z.string(),
        question: z.string(),
        rules: z.string(),
        startsAt: timestamp.nullable(),
        closesAt: timestamp.nullable(),
        timingSource: z.string().nullable(),
      })
      .strict(),
    sources: z.array(source).max(100),
    quotes: z.array(
      z
        .object({
          outcomeId: z.string(),
          observedAt: timestamp,
          bids: z.array(z.object({ price: z.string(), size: z.string() }).strict()),
          asks: z.array(z.object({ price: z.string(), size: z.string() }).strict()),
        })
        .strict(),
    ),
    primary: z
      .object({
        decision: decisionSchema,
        usage: z.record(z.string(), z.number().finite().nonnegative()),
        model: z.string(),
        promptHashes: z.record(z.string(), hash),
      })
      .strict(),
  })
  .strict();
export type Capture = z.infer<typeof captureSchema>;
export type Envelope = { hash: string; capture: Capture };

export function validateCapture(raw: unknown): Envelope {
  const envelope = z.object({ hash, capture: captureSchema }).strict().parse(raw);
  if (
    fingerprint(envelope.capture) !== envelope.hash ||
    envelope.capture.sources.some((s) => fingerprint(s.content) !== s.contentHash)
  ) {
    throw new EvaluationFailure("OBSERVATION_HASH_MISMATCH");
  }
  return envelope;
}

export function localDirectory(path: string) {
  const directory = resolve(path);
  if (!directory.split("/").includes(".data")) {
    throw new EvaluationFailure("OBSERVATION_REQUIRES_PRIVATE_DATA_DIRECTORY");
  }
  return directory;
}

// Publish atomically and exclusively; interrupted writes never become admissible inputs.
export async function writeImmutable(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
    await link(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export function makeCapture(snapshot: ResearchObservation): Envelope {
  const capture = captureSchema.parse({
    schemaVersion: 1,
    kind: "research-decision-observation",
    observedAt: snapshot.observedAt,
    scope: snapshot.scope,
    market: {
      id: snapshot.market.id,
      question: snapshot.market.question,
      rules: snapshot.market.rules,
      startsAt: snapshot.market.startsAt ?? null,
      closesAt: snapshot.market.closesAt,
      timingSource: snapshot.market.timingSource ?? null,
    },
    sources: snapshot.evidence.sources.map((s) => {
      let url: string | null = null;
      try {
        const parsed = new URL(s.url);
        if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
          url = `${parsed.origin}${parsed.pathname}`;
        }
      } catch {
        /* Preserve unknown URLs without copying credentials. */
      }
      return {
        id: s.id,
        title: s.title,
        url,
        content: s.content,
        contentHash: fingerprint(s.content),
        publishedAt: s.publishedAt,
        retrievedAt: s.retrievedAt,
        truncated: s.truncated,
      };
    }),
    quotes: snapshot.evidence.quotes,
    primary: {
      decision: snapshot.primary.decision,
      usage: Object.fromEntries(
        Object.entries((snapshot.primary.usage ?? {}) as Record<string, unknown>).filter(
          ([key, value]) =>
            [
              "inputTokens",
              "outputTokens",
              "totalTokens",
              "reasoningTokens",
              "cachedInputTokens",
            ].includes(key) &&
            typeof value === "number" &&
            Number.isFinite(value) &&
            value >= 0,
        ),
      ),
      model: snapshot.primary.metadata.model,
      promptHashes: Object.fromEntries(
        Object.entries(snapshot.primary.metadata.prompts).map(([key, prompt]) => [
          key,
          prompt.sha256,
        ]),
      ),
    },
  });
  if (Buffer.byteLength(JSON.stringify(capture)) > 256_000) {
    throw new EvaluationFailure("OBSERVATION_CAPTURE_TOO_LARGE");
  }
  return { hash: fingerprint(capture), capture };
}

export function createFileObserver(env: NodeJS.ProcessEnv): ResearchObserver | undefined {
  const mode = env.JEV_OBSERVATION_MODE ?? "off";
  if (mode === "off") {
    return undefined;
  }
  if (
    mode !== "capture" ||
    !env.JEV_OBSERVATION_DIRECTORY ||
    !env.JEV_OBSERVATION_TENANT_ID ||
    !env.JEV_OBSERVATION_AGENT_ID
  ) {
    throw new EvaluationFailure("INVALID_OBSERVATION_CONFIGURATION");
  }
  const directory = localDirectory(env.JEV_OBSERVATION_DIRECTORY);
  return {
    async completed(snapshot) {
      if (
        snapshot.scope.tenantId !== env.JEV_OBSERVATION_TENANT_ID ||
        snapshot.scope.agentId !== env.JEV_OBSERVATION_AGENT_ID
      ) {
        return;
      }
      const envelope = makeCapture(snapshot);
      const path = resolve(directory, "captures", `${fingerprint(snapshot.scope)}.json`);
      try {
        await writeImmutable(path, envelope);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        const previous = validateCapture(JSON.parse(await readFile(path, "utf8")));
        if (previous.hash !== envelope.hash) {
          throw new EvaluationFailure("OBSERVATION_CAPTURE_CHANGED");
        }
      }
    },
    failed() {
      console.error("Observation capture failed; primary decision remains unchanged.");
    },
  };
}
