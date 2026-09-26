import { z } from "zod";
import { assessmentSchema, EvaluationFailure, fingerprint } from "./decision-evaluation";

const idSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const timestamp = z.string().datetime({ offset: true });
const sourceSchema = z.object({
  id: z.string().min(1).max(250),
  url: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }),
  title: z.string().max(1000),
  content: z.string().min(1).max(20_000),
  retrievedAt: timestamp,
  publishedAt: timestamp.nullable(),
  truncated: z.boolean(),
});
const provenanceSchema = sourceSchema
  .omit({ content: true })
  .extend({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const reviewSchema = z
  .object({
    reviewer: z.string().trim().min(1).max(100),
    reviewedAt: timestamp,
    rationale: z.string().trim().min(20).max(4000),
  })
  .strict();
const capturedCaseSchema = z
  .object({
    id: idSchema,
    split: z.enum(["dev", "holdout"]),
    state: z
      .object({
        synthetic: z.literal(false),
        observedAt: timestamp,
        claim: z.string().trim().min(1).max(2000),
        documents: z
          .array(
            z
              .object({ id: z.string().min(1).max(250), text: z.string().min(1).max(20_000) })
              .strict(),
          )
          .min(1)
          .max(10),
        canResearch: z.boolean(),
      })
      .strict(),
    origin: z
      .object({
        runId: z.string().uuid().optional(),
        marketId: z.string().min(1).max(100).optional(),
        snapshotId: z.string().uuid().optional(),
        eventId: idSchema.optional(),
        collectionKind: z.literal("public-excerpt").optional(),
        captureHash: z.string().regex(/^[a-f0-9]{64}$/),
        sources: z.array(provenanceSchema).min(1).max(10),
      })
      .strict(),
    expected: assessmentSchema.nullable(),
    review: reviewSchema.nullable(),
  })
  .strict();

export const capturedDatasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("captured-evidence"),
    cases: z.array(capturedCaseSchema).min(1).max(100),
  })
  .strict();
export type CapturedDataset = z.infer<typeof capturedDatasetSchema>;

export function validateCapturedDataset(raw: unknown, requireReviewed: boolean): CapturedDataset {
  const parsed = capturedDatasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new EvaluationFailure("INVALID_CAPTURED_DATASET");
  }
  const dataset = parsed.data;
  const ids = new Set<string>();
  const partitions = new Map<string, string>();
  for (const item of dataset.cases) {
    if (ids.has(item.id)) {
      throw new EvaluationFailure("DUPLICATE_CASE_ID");
    }
    ids.add(item.id);
    if (requireReviewed && (!item.review || !item.expected)) {
      throw new EvaluationFailure("HUMAN_REVIEW_REQUIRED");
    }
    if (Boolean(item.review) !== Boolean(item.expected)) {
      throw new EvaluationFailure("INCOMPLETE_REVIEW");
    }
    if (item.expected) {
      const resolved = ["SUPPORTED", "CONTRADICTED"].includes(item.expected.evidence);
      let next = item.state.canResearch ? "RESEARCH" : "ABSTAIN";
      if (resolved) {
        next = "FINALIZE";
      }
      if (item.expected.next !== next) {
        throw new EvaluationFailure("INCONSISTENT_REVIEW_LABELS");
      }
    }
    const origin = item.origin;
    const publicExcerpt = origin.collectionKind === "public-excerpt";
    if (
      publicExcerpt
        ? !origin.snapshotId || !origin.eventId || Boolean(origin.runId) || Boolean(origin.marketId)
        : !origin.runId || !origin.marketId || Boolean(origin.snapshotId)
    ) {
      throw new EvaluationFailure("INVALID_CAPTURE_ORIGIN");
    }
    const groupKeys: string[] = [];
    if (origin.runId) {
      groupKeys.push(`run:${origin.runId}`);
    }
    if (origin.marketId) {
      groupKeys.push(`market:${origin.marketId}`);
    }
    if (origin.snapshotId) {
      groupKeys.push(`snapshot:${origin.snapshotId}`);
    }
    if (origin.eventId) {
      groupKeys.push(`event:${origin.eventId}`);
    }
    const sourceIds = new Set(item.origin.sources.map((source) => source.id));
    const documentIds = new Set(item.state.documents.map((document) => document.id));
    if (
      sourceIds.size !== item.origin.sources.length ||
      documentIds.size !== item.state.documents.length ||
      sourceIds.size !== documentIds.size
    ) {
      throw new EvaluationFailure("SOURCE_PROVENANCE_MISMATCH");
    }
    for (const source of item.origin.sources) {
      const document = item.state.documents.find((entry) => entry.id === source.id);
      if (!document || fingerprint(document.text) !== source.contentHash) {
        throw new EvaluationFailure("SOURCE_PROVENANCE_MISMATCH");
      }
      if (
        Date.parse(source.retrievedAt) > Date.parse(item.state.observedAt) ||
        (source.publishedAt && Date.parse(source.publishedAt) > Date.parse(item.state.observedAt))
      ) {
        throw new EvaluationFailure("EVIDENCE_AFTER_SNAPSHOT");
      }
      groupKeys.push(`source:${source.contentHash}`);
    }
    for (const key of groupKeys) {
      if (partitions.has(key) && partitions.get(key) !== item.split) {
        throw new EvaluationFailure("CROSS_SPLIT_LEAKAGE");
      }
      partitions.set(key, item.split);
    }
    if (Buffer.byteLength(JSON.stringify(item.state)) > 60_000) {
      throw new EvaluationFailure("CAPTURED_STATE_TOO_LARGE");
    }
  }
  return dataset;
}

const selectionSchema = z
  .array(
    z
      .object({
        id: idSchema,
        runId: z.string().uuid(),
        eventId: idSchema.optional(),
        split: z.enum(["dev", "holdout"]),
        claim: z.string().trim().min(1).max(2000),
        sourceIds: z.array(z.string().min(1)).min(1).max(10),
        canResearch: z.boolean(),
      })
      .strict(),
  )
  .min(1)
  .max(100);

const captureSchema = z.object({
  run: z.object({
    id: z.string().uuid(),
    finishedAt: z.number().int().positive(),
    decision: z.object({ marketId: z.string().min(1) }),
  }),
  events: z.object({ events: z.array(z.object({ type: z.string(), data: z.unknown() })) }),
});

export function prepareCapturedDataset(captures: unknown[], selections: unknown): CapturedDataset {
  const selected = selectionSchema.safeParse(selections);
  const parsed = z.array(captureSchema).min(1).safeParse(captures);
  if (!selected.success || !parsed.success) {
    throw new EvaluationFailure("INVALID_CAPTURE_OR_SELECTIONS");
  }
  if (new Set(parsed.data.map((capture) => capture.run.id)).size !== parsed.data.length) {
    throw new EvaluationFailure("DUPLICATE_CAPTURE");
  }
  const cases = selected.data.map((selection) => {
    const index = parsed.data.findIndex((capture) => capture.run.id === selection.runId);
    const capture = parsed.data[index];
    if (!capture) {
      throw new EvaluationFailure("CAPTURE_NOT_FOUND");
    }
    const sources = new Map<string, z.infer<typeof sourceSchema>>();
    for (const event of capture.events.events) {
      let candidates: unknown[] = [];
      if (event.type === "source") {
        candidates = [event.data];
      } else if (event.type === "sources") {
        const value = z.object({ sources: z.array(z.unknown()) }).safeParse(event.data);
        if (value.success) {
          candidates = value.data.sources;
        }
      }
      for (const candidate of candidates) {
        const id = z.object({ id: z.string() }).safeParse(candidate);
        if (!id.success || !selection.sourceIds.includes(id.data.id)) {
          continue;
        }
        const value = sourceSchema.safeParse(candidate);
        if (!value.success) {
          throw new EvaluationFailure("INVALID_SELECTED_SOURCE");
        }
        const previous = sources.get(value.data.id);
        if (previous && fingerprint(previous.content) !== fingerprint(value.data.content)) {
          throw new EvaluationFailure("AMBIGUOUS_SOURCE_VERSION");
        }
        sources.set(value.data.id, value.data);
      }
    }
    const picked = selection.sourceIds.map((id) => {
      const source = sources.get(id);
      if (!source) {
        throw new EvaluationFailure("SOURCE_NOT_FOUND");
      }
      return source;
    });
    return {
      id: selection.id,
      split: selection.split,
      state: {
        synthetic: false as const,
        observedAt: new Date(capture.run.finishedAt).toISOString(),
        claim: selection.claim,
        documents: picked.map((source) => ({ id: source.id, text: source.content })),
        canResearch: selection.canResearch,
      },
      origin: {
        runId: capture.run.id,
        ...(selection.eventId ? { eventId: selection.eventId } : {}),
        marketId: capture.run.decision.marketId,
        captureHash: fingerprint(captures[index]),
        sources: picked.map(({ content, ...source }) => ({
          ...source,
          contentHash: fingerprint(content),
        })),
      },
      expected: null,
      review: null,
    };
  });
  return validateCapturedDataset({ schemaVersion: 1, kind: "captured-evidence", cases }, false);
}

// Public excerpts are explicitly collected now, not represented as historical model runs.
const publicCollectionSchema = z
  .object({
    kind: z.literal("public-excerpt-collection"),
    snapshots: z
      .array(
        z
          .object({
            snapshotId: z.string().uuid(),
            eventId: idSchema,
            observedAt: timestamp,
            split: z.enum(["dev", "holdout"]),
            sources: z.array(sourceSchema).min(1).max(10),
            claims: z
              .array(
                z
                  .object({
                    id: idSchema,
                    claim: z.string().min(1).max(2000),
                    sourceIds: z.array(z.string()).min(1).max(10),
                    canResearch: z.boolean(),
                  })
                  .strict(),
              )
              .min(1)
              .max(16),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export function preparePublicEvidence(raw: unknown): CapturedDataset {
  const parsed = publicCollectionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new EvaluationFailure("INVALID_PUBLIC_COLLECTION");
  }
  if (
    new Set(parsed.data.snapshots.map((item) => item.snapshotId)).size !==
    parsed.data.snapshots.length
  ) {
    throw new EvaluationFailure("DUPLICATE_PUBLIC_SNAPSHOT");
  }
  for (const snapshot of parsed.data.snapshots) {
    if (new Set(snapshot.sources.map((source) => source.id)).size !== snapshot.sources.length) {
      throw new EvaluationFailure("DUPLICATE_PUBLIC_SOURCE");
    }
  }
  const cases = parsed.data.snapshots.flatMap((snapshot) =>
    snapshot.claims.map((claim) => {
      const sources = claim.sourceIds.map((id) => {
        const source = snapshot.sources.find((item) => item.id === id);
        if (!source) {
          throw new EvaluationFailure("SOURCE_NOT_FOUND");
        }
        return source;
      });
      return {
        id: claim.id,
        split: snapshot.split,
        state: {
          synthetic: false as const,
          observedAt: snapshot.observedAt,
          claim: claim.claim,
          documents: sources.map((source) => ({ id: source.id, text: source.content })),
          canResearch: claim.canResearch,
        },
        origin: {
          snapshotId: snapshot.snapshotId,
          eventId: snapshot.eventId,
          collectionKind: "public-excerpt" as const,
          captureHash: fingerprint(snapshot),
          sources: sources.map(({ content, ...source }) => ({
            ...source,
            contentHash: fingerprint(content),
          })),
        },
        expected: null,
        review: null,
      };
    }),
  );
  return validateCapturedDataset({ schemaVersion: 1, kind: "captured-evidence", cases }, false);
}

export function capturedCoverage(dataset: CapturedDataset) {
  const items = validateCapturedDataset(dataset, false).cases;
  return {
    cases: items.length,
    explicitEvents: new Set(
      items.flatMap((item) => (item.origin.eventId ? [item.origin.eventId] : [])),
    ).size,
    casesWithoutEventId: items.filter((item) => !item.origin.eventId).length,
    publicExcerptCases: items.filter((item) => item.origin.collectionKind === "public-excerpt")
      .length,
    reviewedCases: items.filter((item) => item.review).length,
    uniqueSourceTexts: new Set(
      items.flatMap((item) => item.origin.sources.map((source) => source.contentHash)),
    ).size,
    splits: Object.fromEntries(
      ["dev", "holdout"].map((split) => [
        split,
        items.filter((item) => item.split === split).length,
      ]),
    ),
  };
}
