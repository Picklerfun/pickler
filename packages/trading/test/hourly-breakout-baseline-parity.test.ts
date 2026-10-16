import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPaperObservation } from "../src/perps.js";

const frozen = JSON.parse(
  readFileSync(
    new URL("./fixtures/hourly-breakout-financial-parity.json", import.meta.url),
    "utf8",
  ),
) as {
  format: string;
  originalCommit: string;
  originalFile: string;
  originalFileSha256: string;
  vectors: {
    id: number;
    args: Parameters<typeof applyPaperObservation>;
    expected: ReturnType<typeof applyPaperObservation>;
  }[];
};

test("64 original frozen observations retain exact native funding, marking, day and peak results", () => {
  assert.equal(frozen.format, "hourly-breakout-frozen-financial-parity-v1");
  assert.equal(frozen.originalCommit, "4cd119dd2568c763faa69af946556016c095b045");
  assert.equal(frozen.originalFile, "packages/trading/src/features/perps-paper/simulation.ts");
  assert.equal(
    frozen.originalFileSha256,
    "ece05d050a5b0321a74872a6bc0ba825071dfed889be3371689dfd40bcfa7d6a",
  );
  assert.equal(frozen.vectors.length, 64);
  assert.equal(new Set(frozen.vectors.map((vector) => vector.id)).size, 64);
  for (const vector of frozen.vectors) {
    const actual = applyPaperObservation(...structuredClone(vector.args));
    assert.deepEqual(actual, vector.expected, `Frozen financial case ${vector.id}`);
  }
});
