import { mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { fingerprint, EvaluationFailure } from "../evaluation/decision-evaluation";
import { localDirectory, writeImmutable } from "./capture";

const amount = z.number().finite().nonnegative();
const rates = z
  .object({ input: amount.positive(), output: amount, source: z.string().min(1) })
  .strict();
export const campaignSchema = z
  .object({
    schemaVersion: z.literal(1),
    authorization: z.string().min(10),
    maxUsd: amount.max(0.5),
    maxCalls: z.number().int().min(0).max(176),
    priorUsd: amount,
    priorCalls: z.number().int().nonnegative(),
    jevModel: z.literal("jev-1.13.0"),
    llmModel: z.string().min(1),
    llmBaseUrl: z.string().url(),
    ratesVerifiedAt: z.string().datetime({ offset: true }),
    jevRates: rates,
    llmRates: rates,
  })
  .strict()
  .superRefine((c, ctx) => {
    const url = new URL(c.llmBaseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      c.priorUsd > c.maxUsd ||
      c.priorCalls > c.maxCalls
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid campaign ceiling or endpoint" });
    }
  });
export type Campaign = z.infer<typeof campaignSchema>;
const startedSchema = z.object({ reservedUsd: amount }).passthrough();
const completedSchema = z.object({ cost: amount }).passthrough();

export async function readOptional(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function initializeCampaign(directory: string, raw: unknown) {
  const campaign = campaignSchema.parse(raw);
  const path = localDirectory(directory);
  await mkdir(resolve(path, "requests"), { recursive: true, mode: 0o700 });
  await writeImmutable(resolve(path, "campaign.json"), campaign);
  return campaign;
}

export async function accounting(directory: string, campaign: Campaign) {
  let measuredUsd = 0;
  let pendingUsd = 0;
  let calls = 0;
  let unknownCharges = 0;
  for (const id of await readdir(resolve(directory, "requests"))) {
    const path = resolve(directory, "requests", id);
    const started = startedSchema.parse(await readOptional(resolve(path, "started.json")));
    const rawCompleted = await readOptional(resolve(path, "completed.json"));
    calls++;
    if (rawCompleted) {
      measuredUsd += completedSchema.parse(rawCompleted).cost;
    } else {
      pendingUsd += started.reservedUsd;
      unknownCharges++;
    }
  }
  return {
    calls,
    measuredUsd,
    pendingUsd,
    unknownCharges,
    accountedUsd: campaign.priorUsd + measuredUsd + pendingUsd,
    accountedCalls: campaign.priorCalls + calls,
  };
}

export async function withCampaign<T>(directory: string, fn: (campaign: Campaign) => Promise<T>) {
  const path = localDirectory(directory);
  // Deliberately no automatic stale-lock recovery after interruption.
  const lock = await open(resolve(path, "LOCK"), "wx", 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const campaign = campaignSchema.parse(await readOptional(resolve(path, "campaign.json")));
    if (await readOptional(resolve(path, "STOP.json"))) {
      throw new EvaluationFailure("OBSERVATION_STOPPED");
    }
    const totals = await accounting(path, campaign);
    if (totals.unknownCharges) {
      throw new EvaluationFailure("OBSERVATION_PENDING_CHARGES");
    }
    return await fn(campaign);
  } finally {
    await lock.close();
    await unlink(resolve(path, "LOCK"));
  }
}

export async function reserve(
  directory: string,
  campaign: Campaign,
  caseId: string,
  variant: string,
  reservedUsd: number,
  metadata: unknown,
) {
  const totals = await accounting(directory, campaign);
  if (
    !Number.isFinite(reservedUsd) ||
    reservedUsd < 0 ||
    totals.unknownCharges ||
    totals.accountedCalls + 1 > campaign.maxCalls ||
    totals.accountedUsd + reservedUsd > campaign.maxUsd
  ) {
    throw new EvaluationFailure("OBSERVATION_BUDGET_OR_CALL_LIMIT");
  }
  const path = resolve(directory, "requests", fingerprint({ caseId, variant }));
  await mkdir(path, { mode: 0o700 });
  await writeImmutable(resolve(path, "started.json"), {
    caseId,
    variant,
    reservedUsd,
    metadata,
    startedAt: new Date().toISOString(),
  });
  return path;
}
