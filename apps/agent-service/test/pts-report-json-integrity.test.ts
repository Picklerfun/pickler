import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesHash, digest } from "../src/pts-study/files.js";
import { ptsReport } from "../src/pts-study/report.js";
import { jsonChunks } from "../src/pts-study/serialization.js";

test("published report hashes the JSON projection, including omitted optional values", async () => {
  const output = await mkdtemp(join(tmpdir(), "pts-report-json-integrity-"));
  const raw = {
    optional: undefined,
    nested: { absent: undefined, retained: "é 🌒" },
    date: new Date(0),
    sparse: [undefined, , "last"],
  };
  await ptsReport(
    output,
    {
      protocol: "perps-pts-intraday-sma-v1",
      processState: "interrupted",
      roundDetails: [raw],
    },
    [{ slot: 0, symbol: "HYPE", variant: "pts-intraday", action: "hold", optional: undefined }],
  );
  const text = await readFile(join(output, "report.json"), "utf8");
  const report = JSON.parse(text);
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));

  assert.equal(manifest.reportHash, digest(report));
  assert.equal(manifest.format, "pts-report-manifest-v3");
  assert.equal(manifest.reportHashPolicy, "sha256-canonical-published-json-v1");
  assert.deepEqual(report.roundDetails, JSON.parse(JSON.stringify([raw])));
  assert.equal(Object.hasOwn(report.rows[0], "optional"), false);
  for (const [name, hash] of Object.entries(manifest.files)) {
    const bytes = await readFile(join(output, name), "utf8");
    assert.equal(bytesHash(bytes), hash);
    assert.equal(Buffer.byteLength(bytes), manifest.fileBytes[name]);
  }
  assert.notEqual(digest(raw), digest(JSON.parse(JSON.stringify(raw))));
});

test("canonical JSON ordering keeps native values and the default serialization order", () => {
  const value = {
    z: undefined,
    "2": "two",
    "10": "ten",
    nested: { z: new Date(0), a: [undefined, , Number.NaN] },
    a: Object(2),
  };
  const text = [...jsonChunks(value, { canonicalKeys: true })].join("");

  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(value)));
  assert.equal(bytesHash(text), digest(JSON.parse(text)));
  assert.equal([...jsonChunks(value)].join(""), JSON.stringify(value));
  assert.ok(text.indexOf('"10"') < text.indexOf('"2"'));
});

test("report hashes the same serialization pass when a source has toJSON", async () => {
  let calls = 0;
  const output = await mkdtemp(join(tmpdir(), "pts-report-json-once-"));
  await ptsReport(
    output,
    {
      protocol: "perps-pts-intraday-sma-v1",
      roundDetails: [{ toJSON: () => ({ sequence: ++calls, absent: undefined }) }],
    },
    [],
  );
  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));

  assert.equal(calls, 1);
  assert.deepEqual(report.roundDetails, [{ sequence: 1 }]);
  assert.equal(manifest.reportHash, digest(report));
});

test("equivalent report publications keep deterministic content and hash", async () => {
  const outputs = await Promise.all([
    mkdtemp(join(tmpdir(), "pts-report-json-first-")),
    mkdtemp(join(tmpdir(), "pts-report-json-second-")),
  ]);
  for (const output of outputs) {
    await ptsReport(
      output,
      { protocol: "perps-pts-intraday-sma-v1", roundDetails: [{ z: 2, a: undefined }] },
      [
        {
          slot: 0,
          symbol: "BTC",
          variant: "pts-intraday",
          action: "hold",
          reason: "PRIMARY_TREND",
        },
      ],
    );
  }
  for (const name of ["manifest.json", "report.json", "report.csv", "report.html"]) {
    assert.deepEqual(
      await readFile(join(outputs[0]!, name)),
      await readFile(join(outputs[1]!, name)),
    );
  }
});
