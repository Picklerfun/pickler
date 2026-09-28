import { z } from "zod";
import { validateCapturedDataset, type CapturedDataset } from "../captured-evidence";
import { assessmentSchema, EvaluationFailure, fingerprint } from "../decision-evaluation";

export const contextVersion = "2.0.0";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const provenance = z.array(
  z.object({ sourceId: z.string().min(1), note: z.string().min(10) }).strict(),
);
const event = z
  .object({
    eventId: z.string().min(1).nullable(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    provenance,
  })
  .strict();
export const contextSchema = z
  .object({
    target: event,
    documents: z.array(z.object({ sourceId: z.string(), event }).strict()),
    glossary: z.array(
      z.object({ term: z.string().min(1), definition: z.string().min(1), provenance }).strict(),
    ),
  })
  .strict();
const reviewSchema = z
  .object({
    reviewer: z.string().min(1),
    kind: z.enum(["human", "assistant-delegated"]).optional(),
    authorization: z.string().min(10).optional(),
    reviewedAt: z.string().datetime({ offset: true }),
    approvedHash: hash,
    rationale: z.string().min(20),
  })
  .strict();
const shell = z
  .object({
    schemaVersion: z.literal(2),
    contextVersion: z.literal(contextVersion),
    developmentEventIds: z.array(z.string().min(1)).min(1),
    cases: z
      .array(
        z
          .object({
            base: z.unknown(),
            context: contextSchema,
            proposal: z
              .object({ assessment: assessmentSchema, rationale: z.string().min(20) })
              .strict()
              .nullable(),
            review: reviewSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
type Base = CapturedDataset["cases"][number];
export type Context = z.infer<typeof contextSchema>;
export type CaseV2 = Omit<z.infer<typeof shell>["cases"][number], "base"> & { base: Base };
export type DatasetV2 = Omit<z.infer<typeof shell>, "cases"> & { cases: CaseV2[] };
export function reviewHash(item: CaseV2): string {
  return fingerprint({ base: item.base, context: item.context, proposal: item.proposal });
}
export function upgradeDataset(raw: unknown, developmentEventIds: string[]): DatasetV2 {
  const old = validateCapturedDataset(raw, false);
  return validateDatasetV2(
    {
      schemaVersion: 2,
      contextVersion,
      developmentEventIds,
      cases: old.cases.map((base) => ({
        base,
        context: {
          target: { eventId: null, date: null, provenance: [] },
          documents: base.origin.sources.map((source) => ({
            sourceId: source.id,
            event: { eventId: null, date: null, provenance: [] },
          })),
          glossary: [],
        },
        proposal: null,
        review: null,
      })),
    },
    false,
  );
}
export function validateDatasetV2(raw: unknown, reviewed: boolean): DatasetV2 {
  const result = shell.safeParse(raw);
  if (!result.success) {
    throw new EvaluationFailure("INVALID_V2_DATASET");
  }
  const bases = validateCapturedDataset(
    {
      schemaVersion: 1,
      kind: "captured-evidence",
      cases: result.data.cases.map((item) => item.base),
    },
    false,
  );
  const dataset: DatasetV2 = {
    ...result.data,
    cases: result.data.cases.map((item, index) => ({ ...item, base: bases.cases[index]! })),
  };
  for (const item of dataset.cases) {
    const ids = new Set(item.base.state.documents.map((doc) => doc.id));
    if (
      item.context.documents.length !== ids.size ||
      new Set(item.context.documents.map((doc) => doc.sourceId)).size !== ids.size ||
      item.context.documents.some((doc) => !ids.has(doc.sourceId))
    ) {
      throw new EvaluationFailure("V2_CONTEXT_DOCUMENT_MISMATCH");
    }
    for (const value of [
      item.context.target,
      ...item.context.documents.map((doc) => doc.event),
      ...item.context.glossary,
    ]) {
      if (
        value.provenance.some((ref) => !ids.has(ref.sourceId)) ||
        (("term" in value || value.eventId !== null || value.date !== null) &&
          !value.provenance.length)
      ) {
        throw new EvaluationFailure("V2_CONTEXT_PROVENANCE_REQUIRED");
      }
      if (
        "date" in value &&
        value.date &&
        new Date(value.date).toISOString().slice(0, 10) !== value.date
      ) {
        throw new EvaluationFailure("INVALID_CONTEXT_DATE");
      }
    }
    if (!item.base.origin.eventId) {
      throw new EvaluationFailure("V2_EVENT_ID_REQUIRED");
    }
    if (
      item.base.split === "holdout" &&
      dataset.developmentEventIds.includes(item.base.origin.eventId)
    ) {
      throw new EvaluationFailure("V2_DEVELOPMENT_EVENT_LEAKAGE");
    }
    if (item.review && (!item.proposal || item.review.approvedHash !== reviewHash(item))) {
      throw new EvaluationFailure("V2_REVIEW_HASH_MISMATCH");
    }
    if (item.review?.kind === "assistant-delegated" && !item.review.authorization) {
      throw new EvaluationFailure("V2_DELEGATION_AUTHORIZATION_REQUIRED");
    }
    if (reviewed && !item.review) {
      throw new EvaluationFailure("V2_JOINT_REVIEW_REQUIRED");
    }
    if (item.proposal) {
      const a = item.proposal.assessment;
      const next = ["SUPPORTED", "CONTRADICTED"].includes(a.evidence)
        ? "FINALIZE"
        : item.base.state.canResearch
          ? "RESEARCH"
          : "ABSTAIN";
      if (a.next !== next) {
        throw new EvaluationFailure("V2_INCONSISTENT_REFERENCE");
      }
    }
    enrichedState(item);
  }
  return dataset;
}
export function enrichedState(item: CaseV2) {
  const fragments = item.base.state.documents.flatMap((doc) => {
    const list: { id: string; sourceId: string; start: number; end: number; text: string }[] = [];
    let start = 0;
    while (start < doc.text.length) {
      const end = Math.min(start + 800, doc.text.length);
      const text = doc.text.slice(start, end);
      list.push({
        id: `f_${fingerprint({ sourceId: doc.id, contentHash: fingerprint(doc.text), start, end }).slice(0, 24)}`,
        sourceId: doc.id,
        start,
        end,
        text,
      });
      start = end;
    }
    return list;
  });
  if (fragments.length > 128) {
    throw new EvaluationFailure("V2_TOO_MANY_FRAGMENTS");
  }
  const state = {
    ...item.base.state,
    contextVersion,
    target: item.context.target,
    documentContext: item.context.documents.map((doc) => {
      const source = item.base.origin.sources.find((source) => source.id === doc.sourceId)!;
      return {
        ...doc,
        title: source.title,
        publishedAt: source.publishedAt,
        retrievedAt: source.retrievedAt,
        truncated: source.truncated,
      };
    }),
    glossary: item.context.glossary,
    fragments,
  };
  if (Buffer.byteLength(JSON.stringify(state)) > 150_000) {
    throw new EvaluationFailure("V2_CONTEXT_TOO_LARGE");
  }
  return state;
}
export type EnrichedState = ReturnType<typeof enrichedState>;
