import test from "node:test";
import assert from "node:assert/strict";
import { sourcesSchema } from "@pickler/api-schema";

test("prefer or only with no sites is rejected, but anywhere or a populated list is fine", () => {
  assert.throws(() => sourcesSchema.parse({ web: { mode: "prefer", sites: [] }, books: [] }));
  assert.doesNotThrow(() =>
    sourcesSchema.parse({ web: { mode: "only", sites: ["espn.com"] }, books: [] }),
  );
  assert.doesNotThrow(() =>
    sourcesSchema.parse({ web: { mode: "anywhere", sites: [] }, books: [] }),
  );
});
