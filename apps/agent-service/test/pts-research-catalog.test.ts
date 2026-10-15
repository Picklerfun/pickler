import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";
import {
  PTS_INTRADAY_RESPONSIVE_POLICY,
  PTS_RESEARCH_CANDIDATES,
  assertPtsConfig,
  ptsCandidateVersion,
  ptsConfigVersion,
  ptsPolicy,
  ptsResearchPolicy,
  type PtsVersion,
} from "@pickler/trading/pts";
import { resolvePerpsStrategy, type PerpsStrategySelection } from "@pickler/trading/strategies";

const root = resolve(import.meta.dirname, "../../../knowledge/trading/pts-research");
const ids = ["primary-er20", "persistent-setups", "ready-band-entry", "retracement-control"];
const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const byteHash = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

async function schema(name: string) {
  return new Ajv({ strict: true }).compile(await readJson(resolve(root, `schemas/${name}`)));
}

test("immutable offline research catalog pins the course, baseline, descriptors and exact trading policies", async () => {
  const catalog = await readJson(resolve(root, "catalog.json"));
  const validateCatalog = await schema("catalog-v1.schema.json");
  const validateCandidate = await schema("candidate-v1.schema.json");
  const validatePolicy = await schema("policy-v1.schema.json");

  assert.equal(validateCatalog(catalog), true, JSON.stringify(validateCatalog.errors));
  assert.deepEqual(
    catalog.candidates.map((candidate: { id: string }) => candidate.id),
    ids,
  );
  assert.deepEqual(
    PTS_RESEARCH_CANDIDATES.map((candidate) => candidate.id),
    ids,
  );
  assert.equal(catalog.reference.sha256, await byteHash(resolve(root, catalog.reference.path)));
  assert.equal(catalog.baseline.sha256, await byteHash(resolve(root, catalog.baseline.path)));
  assert.deepEqual(
    await readJson(resolve(root, catalog.baseline.path)),
    PTS_INTRADAY_RESPONSIVE_POLICY,
  );

  for (const candidate of catalog.candidates) {
    const file = resolve(root, candidate.descriptor.path);
    const descriptor = await readJson(file);
    const policyFile = resolve(dirname(file), descriptor.policy.path);
    const policy = await readJson(policyFile);

    assert.equal(candidate.descriptor.sha256, await byteHash(file));
    assert.equal(validateCandidate(descriptor), true, JSON.stringify(validateCandidate.errors));
    assert.equal(descriptor.id, candidate.id);
    assert.equal(descriptor.candidateVersion, candidate.version);
    assert.equal(descriptor.policy.sha256, await byteHash(policyFile));
    assert.equal(validatePolicy(policy), true, JSON.stringify(validatePolicy.errors));
    assert.deepEqual(policy, ptsResearchPolicy(candidate.id, candidate.version));
    assert.equal(
      descriptor.reference.sha256,
      await byteHash(resolve(dirname(file), descriptor.reference.path)),
    );
    assert.equal(
      descriptor.baseline.sha256,
      await byteHash(resolve(dirname(file), descriptor.baseline.path)),
    );
    assert.equal(descriptor.reference.sha256, catalog.reference.sha256);
    assert.equal(descriptor.baseline.sha256, catalog.baseline.sha256);
    assert.equal(
      await readFile(resolve(dirname(file), descriptor.decisions.path), "utf8").then(Boolean),
      true,
    );
    assert.equal(
      await readFile(resolve(dirname(file), descriptor.literature.path), "utf8").then(Boolean),
      true,
    );
  }
});

test("catalog contracts reject unknown identities, activation, stacking and modified published thresholds", async () => {
  const catalog = await readJson(resolve(root, "catalog.json"));
  const descriptor = await readJson(resolve(root, "primary-er20/0.1.0.json"));
  const policy = await readJson(resolve(root, "primary-er20/0.1.0/policy.json"));
  const validateCatalog = await schema("catalog-v1.schema.json");
  const validateCandidate = await schema("candidate-v1.schema.json");
  const validatePolicy = await schema("policy-v1.schema.json");

  for (const patch of [
    { enabled: true },
    { financialExecutable: true },
    { studioSelectable: true },
    { publicTrialStarted: true },
    { executionScope: "local-evaluation-only" },
    { comparison: "STACKED_CANDIDATES" },
    { candidates: [...catalog.candidates, catalog.candidates[0]] },
    { candidates: [catalog.candidates[0], ...catalog.candidates.slice(0, 3)] },
  ]) {
    assert.equal(validateCatalog({ ...catalog, ...patch }), false);
  }
  for (const patch of [
    { id: "unknown" },
    { candidateVersion: "0.2.0" },
    { enabled: true },
    { financialExecutable: true },
    { studioSelectable: true },
    { publicTrialStarted: true },
    { singleChange: false },
    { riskPolicy: "new-risk" },
  ]) {
    assert.equal(validateCandidate({ ...descriptor, ...patch }), false);
  }
  assert.equal(validatePolicy({ ...policy, enabled: true }), false);
  assert.equal(
    validatePolicy({
      ...policy,
      primary: { ...policy.primary, efficiencyMinimumInclusive: "0.31" },
    }),
    false,
  );
  assert.equal(validatePolicy({ ...policy, recoveryExclusive: ["0.38", "0.495"] }), false);
  assert.throws(() => ptsResearchPolicy("unknown"), { code: "INVALID_INPUT" });
  assert.throws(() => ptsResearchPolicy("primary-er20", "0.2.0"), { code: "INVALID_INPUT" });
});

test("research identities cannot resolve through executable PTS, account configuration or Studio selectors", async () => {
  const config = await readJson(
    resolve(import.meta.dirname, "../src/pts-study/pts-intraday-responsive-template.json"),
  );

  for (const id of ids) {
    const identity = `${id}@0.1.0`;
    const changed = { ...config, candidate: identity };

    assert.throws(() => ptsCandidateVersion(identity), { code: "INVALID_INPUT" });
    assert.throws(() => ptsPolicy(identity as PtsVersion), { code: "INVALID_INPUT" });
    assert.throws(() => ptsConfigVersion(changed), { code: "INVALID_INPUT" });
    assert.throws(() => assertPtsConfig(changed), { code: "INVALID_INPUT" });
    assert.throws(
      () => resolvePerpsStrategy({ id, version: "0.1.0" } as unknown as PerpsStrategySelection),
      /Unknown perpetual strategy/,
    );
  }
});

test("manifest example matches the offline contract and policies but deliberately supplies no private capture", async () => {
  const file = resolve(root, "examples/input-manifest.json");
  const example = await readJson(file);
  const validate = await schema("input-v1.schema.json");

  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.equal(
    example.reference.sha256,
    await byteHash(resolve(dirname(file), example.reference.file)),
  );
  assert.equal(example.dataUse, "examined-development");
  assert.ok(example.historyWindow.to > example.historyWindow.from);
  for (const candidate of example.candidates) {
    const policyFile = resolve(dirname(file), candidate.file);

    assert.equal(candidate.sha256, await byteHash(policyFile));
    assert.deepEqual(
      await readJson(policyFile),
      ptsResearchPolicy(candidate.id, candidate.version),
    );
  }
  for (const source of Object.values(example.sources) as { file: string; sha256: string }[]) {
    assert.match(source.file, /private-.*-not-supplied\.json$/);
    assert.equal(source.sha256, "0".repeat(64));
  }
  assert.equal(validate({ ...example, envFile: "never-load.env" }), false);
  assert.equal(validate({ ...example, dataUse: "blind-holdout" }), false);
  assert.equal(validate({ ...example, candidates: example.candidates.slice(1) }), false);
  assert.equal(
    validate({ ...example, reference: { ...example.reference, file: "private.env" } }),
    false,
  );
});
