import { z } from "zod";
import { contextSchema, type EnrichedState } from "../evaluation/v2/context";
import { fingerprint, EvaluationFailure } from "../evaluation/decision-evaluation";
import { validateCapture } from "./capture";

export const selectionSchema = z
  .object({
    captureHash: z.string().regex(/^[a-f0-9]{64}$/),
    claims: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,80}$/),
            claim: z.string().trim().min(1).max(2000),
            context: contextSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type ObservationCase = {
  id: string;
  label: string;
  captureHash: string;
  eventId: string | null;
  state: EnrichedState;
};

export function prepareObservation(rawCapture: unknown, rawSelection: unknown): ObservationCase[] {
  const { capture, hash } = validateCapture(rawCapture);
  const selection = selectionSchema.parse(rawSelection);
  if (
    selection.captureHash !== hash ||
    new Set(selection.claims.map((c) => c.id)).size !== selection.claims.length
  ) {
    throw new EvaluationFailure("OBSERVATION_SELECTION_MISMATCH");
  }
  const sources = capture.sources;
  if (
    !sources.length ||
    sources.length > 100 ||
    new Set(sources.map((s) => s.id)).size !== sources.length ||
    sources.some(
      (s) =>
        !s.content ||
        s.content.length > 20_000 ||
        Date.parse(s.retrievedAt) > Date.parse(capture.observedAt) ||
        (s.publishedAt !== null && Date.parse(s.publishedAt) > Date.parse(capture.observedAt)),
    )
  ) {
    throw new EvaluationFailure("OBSERVATION_INVALID_EVIDENCE");
  }
  return selection.claims.map((claim) => {
    const context = claim.context ?? {
      target: { eventId: null, date: null, provenance: [] },
      documents: sources.map((s) => ({
        sourceId: s.id,
        event: { eventId: null, date: null, provenance: [] },
      })),
      glossary: [],
    };
    const ids = new Set(sources.map((s) => s.id));
    if (
      context.documents.length !== ids.size ||
      new Set(context.documents.map((d) => d.sourceId)).size !== ids.size ||
      context.documents.some((d) => !ids.has(d.sourceId))
    ) {
      throw new EvaluationFailure("OBSERVATION_CONTEXT_DOCUMENT_MISMATCH");
    }
    for (const value of [
      context.target,
      ...context.documents.map((d) => d.event),
      ...context.glossary,
    ]) {
      if (
        value.provenance.some((p) => !ids.has(p.sourceId)) ||
        (("term" in value || value.date !== null || value.eventId !== null) &&
          !value.provenance.length)
      ) {
        throw new EvaluationFailure("OBSERVATION_CONTEXT_PROVENANCE_REQUIRED");
      }
      if (
        "date" in value &&
        value.date &&
        (!Number.isFinite(Date.parse(value.date)) ||
          new Date(value.date).toISOString().slice(0, 10) !== value.date)
      ) {
        throw new EvaluationFailure("OBSERVATION_INVALID_EVENT_DATE");
      }
    }
    const fragments = sources.flatMap((s) => {
      const result: EnrichedState["fragments"] = [];
      for (let start = 0; start < s.content.length; start += 800) {
        const end = Math.min(start + 800, s.content.length);
        result.push({
          id: `f_${fingerprint({ sourceId: s.id, contentHash: s.contentHash, start, end }).slice(0, 24)}`,
          sourceId: s.id,
          start,
          end,
          text: s.content.slice(start, end),
        });
      }
      return result;
    });
    const state: EnrichedState = {
      synthetic: false,
      observedAt: capture.observedAt,
      claim: claim.claim,
      canResearch: false, // Observation happens after finalization; it never starts another search.
      documents: sources.map((s) => ({ id: s.id, text: s.content })),
      contextVersion: "2.0.0",
      target: context.target,
      glossary: context.glossary,
      fragments,
      documentContext: context.documents.map((d) => {
        const s = sources.find((s) => s.id === d.sourceId)!;
        return {
          ...d,
          title: s.title,
          publishedAt: s.publishedAt,
          retrievedAt: s.retrievedAt,
          truncated: s.truncated,
        };
      }),
    };
    if (fragments.length > 128 || Buffer.byteLength(JSON.stringify(state)) > 150_000) {
      throw new EvaluationFailure("OBSERVATION_CONTEXT_TOO_LARGE");
    }
    return {
      id: fingerprint({ captureHash: hash, claim }),
      label: claim.id,
      captureHash: hash,
      eventId: context.target.eventId,
      state,
    };
  });
}
