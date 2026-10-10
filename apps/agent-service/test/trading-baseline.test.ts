import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
  chmod,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import {
  PERPS_STRATEGIES,
  resolvePerpsStrategy,
  type PerpsStrategySelection,
} from "@pickler/trading/strategies";
import {
  inventorySchema,
  manifestSchema,
  type BaselineInventory,
} from "../src/trading-baseline/contracts.js";
import { exportBaseline, baselineDatabaseUrl } from "../src/trading-baseline/export.js";
import {
  exportBaselineFiles,
  checkSourceFiles,
  listBaselineFiles,
} from "../src/trading-baseline/files.js";
import {
  ensureAnnotatedBaselineRef,
  exportBaselineGit,
  recoverBaselineGit,
} from "../src/trading-baseline/git.js";
import { verifyPts } from "../src/trading-baseline/pts.js";
import { verifyBaseline, readBaseline } from "../src/trading-baseline/verify.js";
import { restoreBaseline } from "../src/trading-baseline/restore.js";
import {
  BaselineError,
  credentialFile,
  csv,
  disjoint,
  fileFingerprint,
  git,
  html,
  newDirectory,
  sha256,
  writeJson,
} from "../src/trading-baseline/safe.js";

const repository = resolve(import.meta.dirname, "../../..");
const ptsPath = "knowledge/trading/pts";
const candidatePath = "knowledge/trading/pts-versions/pts-trend-reversal/0.1.0.json";
const signal = new AbortController().signal;
async function temporary(t: TestContext) {
  const path = await realpath(await mkdtemp(join(tmpdir(), "pickler-baseline-test-")));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function fixture(t: TestContext) {
  const root = await temporary(t);
  const repo = join(root, "repository");
  await mkdir(repo);
  await cp(join(repository, "knowledge"), join(repo, "knowledge"), { recursive: true });
  await git(repo, ["init", "-b", "codex/baseline-test"], signal);
  await git(repo, ["config", "user.name", "Controlled baseline test"], signal);
  await git(repo, ["config", "user.email", "baseline-test@localhost"], signal);
  await git(repo, ["add", "knowledge"], signal);
  await git(repo, ["commit", "-m", "Controlled reference fixture"], signal);
  const commit = await git(repo, ["rev-parse", "HEAD"], signal);
  const references = [
    { name: "refs/tags/pts-test-1", commit, annotated: true },
    { name: "refs/tags/sma-test-1", commit, annotated: true },
    { name: "refs/heads/codex/baseline-test", commit, annotated: false },
  ];
  for (const ref of references.filter((r) => r.annotated)) {
    await ensureAnnotatedBaselineRef(repo, ref.name, ref.commit, signal);
  }
  const studies = join(root, "studies");
  await mkdir(studies);
  await writeFile(
    join(studies, "pending.json"),
    JSON.stringify({
      position: "pending",
      funding: null,
      reserveUsd: "0.020000",
      consumedUsd: null,
      status: "unknown",
      omissions: 2,
    }),
  );
  await writeFile(
    join(studies, "study.env"),
    'MODEL_API_KEY="sk-controlled-should-never-copy"\nDATABASE_URL="postgresql://user:controlled@127.0.0.1:55432/fixture"\n',
  );
  const fingerprint = await fileFingerprint(join(studies, "pending.json"));
  const inventory: BaselineInventory = {
    protocol: "trading-baseline-inventory-v1",
    repository: repo,
    ptsPath,
    candidatePath,
    references,
    roots: [{ id: "history", path: studies }],
    files: [
      {
        root: "history",
        path: "pending.json",
        sha256: fingerprint.sha256,
        bytes: fingerprint.bytes,
        mtimeMs: fingerprint.mtimeMs,
      },
      { root: "history", path: "study.env", sha256: null, bytes: null, mtimeMs: null },
    ],
    databases: [],
    unavailable: [],
  };
  const inventoryPath = join(root, "inventory.json");
  await writeJson(inventoryPath, inventory);
  return { root, repo, studies, inventory, inventoryPath, output: join(root, "backup") };
}

test("original PTS sources, references, fragments, contracts and disabled candidate are valid", async () => {
  const result = await verifyPts(repository, ptsPath, candidatePath);
  assert.equal(result.files, 50);
  assert.deepEqual(result.coverage, {
    sourceFiles: 29,
    sourceWords: 66637,
    rules: 22,
    questions: 22,
    transcriptChunks: 127,
    conceptCards: 22,
  });
  assert.equal(
    result.bundleSha256,
    "e860f1912b2b09fcb97202fd3354fc594b42e573dd82a91f7271532d84c1ca30",
  );
  assert.equal(result.coverageIssues.length, 3);
});

test("PTS never resolves as an executable strategy; all existing exact selections remain", () => {
  assert.deepEqual(
    PERPS_STRATEGIES.map((s) => `${s.id}@${s.version}`),
    [
      "rules@1.0.0",
      "deepseek@1.0.0",
      "jev@1.0.0",
      "combined@1.0.0",
      "rules@2.0.0",
      "deepseek@2.0.0",
      "jev@2.0.0",
      "combined@2.0.0",
      "rules@2.1.0",
      "deepseek@2.1.0",
      "jev@2.1.0",
      "combined@2.1.0",
    ],
  );
  for (const selection of PERPS_STRATEGIES) {
    assert.equal(resolvePerpsStrategy(selection), selection);
  }
  assert.throws(
    () =>
      resolvePerpsStrategy({
        id: "pts-trend-reversal",
        version: "0.1.0",
      } as unknown as PerpsStrategySelection),
    /Unknown perpetual strategy/,
  );
});

test("draft execution, unknown versions and wrong references are rejected without changing originals", async (t) => {
  const f = await fixture(t);
  const path = join(f.repo, candidatePath);
  const original = JSON.parse(await readFile(path, "utf8"));
  for (const patch of [
    { executionEnabled: true },
    { candidateVersion: "0.2.0" },
    { formatVersion: 2 },
    { reference: { ...original.reference, sha256: "a".repeat(64) } },
  ]) {
    await writeFile(path, JSON.stringify({ ...original, ...patch }));
    await assert.rejects(verifyPts(f.repo, ptsPath, candidatePath), BaselineError);
  }
  assert.equal(
    sha256(await readFile(join(f.repo, ptsPath, "bundle.json"))),
    original.reference.sha256,
  );
});

test("altered source, missing file and extra file invalidate the original bundle", async (t) => {
  const f = await fixture(t);
  const file = join(f.repo, ptsPath, "sources/m01-c01.txt");
  const original = await readFile(file);
  await writeFile(file, original.subarray(0, 300));
  await assert.rejects(verifyPts(f.repo, ptsPath, candidatePath), /HASH_MISMATCH/);
  await rm(file);
  await assert.rejects(verifyPts(f.repo, ptsPath, candidatePath), /INVENTORY_MISMATCH/);
  await writeFile(file, original);
  await writeFile(join(f.repo, ptsPath, "extra.txt"), "Unexpected source");
  await assert.rejects(verifyPts(f.repo, ptsPath, candidatePath), /INVENTORY_MISMATCH/);
});

test("semantic fragment integrity is checked even after rehashing its enclosing inventory", async (t) => {
  const f = await fixture(t);
  const dir = join(f.repo, ptsPath);
  const file = join(dir, "retrieval/chunks.jsonl");
  const records = (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  records[0].text = "Altered transcript";
  records[0].textSha256 = sha256(records[0].text);
  await writeFile(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const bundle = JSON.parse(await readFile(join(dir, "bundle.json"), "utf8"));
  const fingerprint = await fileFingerprint(file);
  Object.assign(
    bundle.files.find((r: { path: string }) => r.path === "retrieval/chunks.jsonl"),
    { sha256: fingerprint.sha256, bytes: fingerprint.bytes },
  );
  await writeFile(join(dir, "bundle.json"), JSON.stringify(bundle));
  await assert.rejects(verifyPts(f.repo, ptsPath, candidatePath), /FRAGMENT_MISMATCH/);
});

test("immutable annotated refs reject conflicting targets and lightweight replacements", async (t) => {
  const f = await fixture(t);
  const ref = f.inventory.references[0]!;
  await ensureAnnotatedBaselineRef(f.repo, ref.name, ref.commit, signal);
  await git(f.repo, ["commit", "--allow-empty", "-m", "Different controlled commit"], signal);
  const different = await git(f.repo, ["rev-parse", "HEAD"], signal);
  await assert.rejects(
    ensureAnnotatedBaselineRef(f.repo, ref.name, different, signal),
    /REFERENCE_CONFLICT/,
  );
  await git(f.repo, ["tag", "lightweight", ref.commit], signal);
  await assert.rejects(
    ensureAnnotatedBaselineRef(f.repo, "refs/tags/lightweight", ref.commit, signal),
    /REFERENCE_CONFLICT/,
  );
  assert.equal(await git(f.repo, ["rev-parse", `${ref.name}^{commit}`], signal), ref.commit);
});

test("Git recovery is standalone with both annotated refs, commit and exact original sources", async (t) => {
  const f = await fixture(t);
  await exportBaselineGit(f.repo, f.inventory.references, join(f.root, "baseline.bundle"), signal);
  const code = await recoverBaselineGit(
    join(f.root, "baseline.bundle"),
    f.inventory.references,
    join(f.root, "recovered"),
    signal,
  );
  assert.equal(
    sha256(await readFile(join(code, ptsPath, "bundle.json"))),
    sha256(await readFile(join(repository, ptsPath, "bundle.json"))),
  );
  assert.equal((await verifyPts(code, ptsPath, candidatePath)).files, 50);
});

test("complete local export, network-free verification, deterministic replay and restore preserve unknown costs", async (t) => {
  const f = await fixture(t);
  const before = await readFile(join(f.studies, "pending.json"));
  const manifest = await exportBaseline({
    inventoryPath: f.inventoryPath,
    output: f.output,
    signal,
  });
  assert.equal(manifest.status, "complete");
  assert.equal(manifest.files.find((r) => r.path === "study.env")?.status, "excluded");
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Network forbidden");
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  const first = await verifyBaseline({
    state: join(f.output, "manifest.json"),
    output: join(f.root, "verify-1"),
    verifierRepository: repository,
    signal,
  });
  const second = await verifyBaseline({
    state: join(f.output, "manifest.json"),
    output: join(f.root, "verify-2"),
    verifierRepository: repository,
    signal,
  });
  assert.deepEqual(first, second);
  assert.equal(first.status, "verified");
  const restored = await restoreBaseline({
    state: join(f.output, "manifest.json"),
    output: join(f.root, "restore"),
    verifierRepository: repository,
    signal,
  });
  assert.equal(restored.status, "verified-complete");
  assert.equal(restored.applicationsStarted, false);
  assert.deepEqual(await readFile(join(f.root, "restore/files/history/pending.json")), before);
  assert.deepEqual(await readFile(join(f.studies, "pending.json")), before);
  assert.equal(
    (await readFile(join(f.output, "manifest.json"), "utf8")).includes("sk-controlled"),
    false,
  );
  await assert.rejects(
    exportBaseline({ inventoryPath: f.inventoryPath, output: f.output, signal }),
    /NEW_DIRECTORY_REQUIRED/,
  );
});

test("truncation, changed inventory and absent source produce a partial baseline", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.studies, "pending.json"), "Changed after inventory");
  const manifest = await exportBaseline({
    inventoryPath: f.inventoryPath,
    output: f.output,
    signal,
  });
  assert.equal(manifest.status, "partial");
  assert.equal(manifest.files[0]!.status, "changed");
  const check = await verifyBaseline({
    state: join(f.output, "manifest.json"),
    output: join(f.root, "verify"),
    verifierRepository: repository,
    signal,
  });
  assert.equal(check.completeness, "partial");
  assert.equal(check.status, "verified");
});

test("files changing after copying and new source files are not reported complete", async (t) => {
  const f = await fixture(t);
  const output = await newDirectory(f.output);
  const records = await exportBaselineFiles(f.inventory, output, signal);
  await writeFile(join(f.studies, "pending.json"), "Changed later");
  await writeFile(join(f.studies, "later.json"), "{}");
  const gaps = await checkSourceFiles(f.inventory, records, signal);
  assert.equal(records[0]!.status, "changed");
  assert.equal(gaps[0]!.code, "DIRECTORY_INVENTORY_CHANGED");
});

test("manifest tampering, unknown formats and corrupt artifacts fail verification", async (t) => {
  const f = await fixture(t);
  await exportBaseline({ inventoryPath: f.inventoryPath, output: f.output, signal });
  const manifestPath = join(f.output, "manifest.json");
  const original = await readFile(manifestPath);
  await writeFile(manifestPath, original.subarray(0, 100));
  await assert.rejects(readBaseline(manifestPath), /MANIFEST_HASH_MISMATCH/);
  await writeFile(manifestPath, original);
  const manifest = JSON.parse(original.toString());
  assert.throws(() => manifestSchema.parse({ ...manifest, protocol: "trading-baseline-v2" }));
  await writeFile(join(f.output, "files/history/pending.json"), "Corrupt");
  const result = await verifyBaseline({
    state: manifestPath,
    output: join(f.root, "verify"),
    verifierRepository: repository,
    signal,
  });
  assert.equal(result.status, "failed");
  assert.ok(result.failures.some((s) => s.endsWith("BASELINE_ARTIFACT_HASH_MISMATCH")));
  await assert.rejects(
    restoreBaseline({
      state: manifestPath,
      output: join(f.root, "restore"),
      verifierRepository: repository,
      signal,
    }),
    /VERIFICATION_FAILED/,
  );
});

test("symlinks, path traversal, duplicate inventory and original directories are rejected", async (t) => {
  const f = await fixture(t);
  await symlink(join(f.studies, "pending.json"), join(f.studies, "linked.json"));
  const malicious = { ...f.inventory.files[0]!, path: "linked.json" };
  const files = await exportBaselineFiles(
    { ...f.inventory, files: [malicious] },
    await newDirectory(f.output),
    signal,
  );
  assert.equal(files[0]!.reason, "BASELINE_SYMLINK_FORBIDDEN");
  await assert.rejects(
    exportBaselineFiles(
      { ...f.inventory, files: [{ ...malicious, path: "../pending.json" }] },
      f.output,
      signal,
    ),
    /UNSAFE_PATH/,
  );
  assert.throws(() => disjoint(f.studies, join(f.studies, "backup")), /OVERLAPPING_PATHS/);
  assert.throws(() => inventorySchema.parse({ ...f.inventory, protocol: "future" }));
  await assert.rejects(
    exportBaselineFiles(
      { ...f.inventory, files: [f.inventory.files[0]!, f.inventory.files[0]!] },
      f.output,
      signal,
    ),
    /INVENTORY_INVALID/,
  );
});

test("stopped-volume provenance requires inventoried evidence before database access", async (t) => {
  const f = await fixture(t);
  const database = {
    id: "recovered-old",
    envFile: "/nonexistent/never-read.env",
    tools: { kind: "docker" as const, container: "isolated-copy" },
    configurationFiles: [],
    origin: {
      kind: "stopped-volume-copy" as const,
      originalContainer: "stopped-original",
      originalVolume: "original-volume",
      originalPort: 55432,
      originalSystemIdentifier: "7686061876344971300",
      evidenceRoot: "missing-proof",
    },
  };
  const inventory = { ...f.inventory, databases: [database] };
  assert.equal(inventorySchema.parse(inventory).databases[0]!.origin?.kind, "stopped-volume-copy");
  assert.throws(() =>
    inventorySchema.parse({
      ...inventory,
      databases: [{ ...database, origin: { kind: "unknown" } }],
    }),
  );
  await writeFile(f.inventoryPath, JSON.stringify(inventory));
  await assert.rejects(
    exportBaseline({ inventoryPath: f.inventoryPath, output: f.output, signal }),
    /DATABASE_ORIGIN_INVALID/,
  );
});

test("credentials are excluded by filename or contents and only PostgreSQL configuration is selected", async (t) => {
  const f = await fixture(t);
  for (const path of [
    ".env",
    "nested/.env.local",
    "study.env",
    "key.pem",
    "errors.private",
    "credentials.json",
    "pgpass",
  ]) {
    assert.equal(credentialFile(path), true);
  }
  const url = await baselineDatabaseUrl(join(f.studies, "study.env"));
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.equal(process.env.MODEL_API_KEY, undefined);
  await writeFile(join(f.studies, "payload.json"), '{"api_key":"never-backup-this"}');
  const fingerprint = await fileFingerprint(join(f.studies, "payload.json"));
  const entries = await exportBaselineFiles(
    { ...f.inventory, files: [{ root: "history", path: "payload.json", ...fingerprint }] },
    await newDirectory(f.output),
    signal,
  );
  assert.equal(entries[0]!.status, "excluded");
  assert.equal(entries[0]!.reason, "SENSITIVE_CONTENT");
  assert.equal((await listBaselineFiles(f.output)).length, 0);
});

test("private permission changes fail integrity checks; HTML and CSV cannot execute injected values", async (t) => {
  const f = await fixture(t);
  await exportBaseline({ inventoryPath: f.inventoryPath, output: f.output, signal });
  await chmod(join(f.output, "files/history/pending.json"), 0o644);
  const result = await verifyBaseline({
    state: join(f.output, "manifest.json"),
    output: join(f.root, "verify"),
    verifierRepository: repository,
    signal,
  });
  assert.equal(result.status, "failed");
  assert.ok(result.failures.some((s) => s.endsWith("BASELINE_PRIVATE_PERMISSIONS_REQUIRED")));
  assert.equal(html('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  assert.equal(csv("=1+2"), '"\'=1+2"');
});

test("offline CLI dispatch never imports runtime, PostgreSQL or providers and rejects paid/env switches", async (t) => {
  const f = await fixture(t);
  await exportBaseline({ inventoryPath: f.inventoryPath, output: f.output, signal });
  const hook = join(f.root, "guard.mjs");
  await writeFile(
    hook,
    `import {registerHooks} from "node:module"; globalThis.fetch=()=>{throw Error("NETWORK_FORBIDDEN")}; registerHooks({resolve(s,c,n){if(s==="pg"||/agent-runtime|evaluation-host|trading-baseline\\/database|model-providers/.test(s))throw Error("FORBIDDEN_IMPORT");return n(s,c)}});`,
  );
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      hook,
      "apps/agent-service/src/evaluate.ts",
      "baseline-verify",
      "--state",
      join(f.output, "manifest.json"),
      "--output",
      join(f.root, "cli-verify"),
    ],
    { cwd: repository, env: { PATH: process.env.PATH }, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /"status":"verified"/);
  const rejected = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "apps/agent-service/src/evaluate.ts",
      "baseline-verify",
      "--state",
      join(f.output, "manifest.json"),
      "--env-file",
      join(f.studies, "study.env"),
      "--output",
      join(f.root, "bad"),
    ],
    { cwd: repository, env: { PATH: process.env.PATH }, encoding: "utf8" },
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /reject provider\/config\/env\/paid/);
});
