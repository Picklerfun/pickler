import { readFile, readdir } from "node:fs/promises";
import { join, dirname, relative, resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { BaselineError, fileFingerprint, safePath, sha256 } from "./safe.js";

interface Source {
  id: string;
  path: string;
  sha256: string;
  lines: number;
  words: number;
}
interface Reference {
  sourceId: string;
  lineStart: number;
  lineEnd: number;
}
interface Fragment {
  id: string;
  kind: "transcript" | "concept";
  text: string;
  textSha256: string;
  sourceReferences: Reference[];
  ruleIds: string[];
}
interface Candidate {
  reference: { sha256: string };
  proposedPolicy: { sha256: string };
}
async function json(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function inventoryPaths(root: string, prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...(await inventoryPaths(root, path)));
    } else if (entry.isFile()) {
      paths.push(path);
    } else {
      throw new BaselineError("BASELINE_PTS_UNSUPPORTED_FILE");
    }
  }
  return paths.sort();
}

/** Reads and validates the ORIGINAL contracts; never edits or interprets execution parameters. */
export async function verifyPts(repository: string, ptsPath: string, candidatePath: string) {
  const root = await safePath(repository, ptsPath);
  const bundlePath = await safePath(root, "bundle.json");
  const bundle = (await json(bundlePath)) as {
    bundleId: string;
    knowledgeVersion: string;
    executionEnabled: boolean;
    candidateRegistered: boolean;
    files: { path: string; bytes: number; sha256: string }[];
    coverage: {
      sourceFiles: number;
      sourceWords: number;
      rules: number;
      questions: number;
      transcriptChunks: number;
      conceptCards: number;
    };
  };
  if (
    bundle.bundleId !== "pts-course" ||
    bundle.knowledgeVersion !== "1.0.0" ||
    bundle.executionEnabled !== false ||
    bundle.candidateRegistered !== false
  ) {
    throw new BaselineError("BASELINE_PTS_VERSION_UNSUPPORTED");
  }
  const expected = [...bundle.files.map((f) => f.path), "bundle.json"].sort();
  if (
    new Set(expected).size !== expected.length ||
    JSON.stringify(await inventoryPaths(root)) !== JSON.stringify(expected)
  ) {
    throw new BaselineError("BASELINE_PTS_INVENTORY_MISMATCH");
  }
  for (const file of bundle.files) {
    const actual = await fileFingerprint(await safePath(root, file.path), true);
    if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes || actual.secret) {
      throw new BaselineError("BASELINE_PTS_HASH_MISMATCH");
    }
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemas = [
    "source-manifest",
    "rules",
    "candidate-policy",
    "analysis-request",
    "analysis",
    "retrieval-record",
  ];
  for (const schema of schemas) {
    ajv.addSchema(
      await json(await safePath(root, `schemas/${schema}.schema.json`)),
      `${schema}.schema.json`,
    );
  }
  const check = (schema: string, value: unknown) => {
    if (!ajv.validate(`${schema}.schema.json`, value)) {
      throw new BaselineError("BASELINE_PTS_CONTRACT_INVALID");
    }
  };
  const sources = await json(await safePath(root, "source-manifest.json"));
  const rules = await json(await safePath(root, "rules.json"));
  const policy = await json(await safePath(root, "candidate-policy.json"));
  check("source-manifest", sources);
  check("rules", rules);
  check("candidate-policy", policy);
  check("analysis-request", await json(await safePath(root, "examples/analysis-request.json")));
  check("analysis", await json(await safePath(root, "examples/analysis-response.json")));
  const questions = await json(await safePath(root, "open-questions.json"));
  const lines = new Map<string, string[]>();
  let words = 0;
  for (const source of sources.sources as Source[]) {
    const text = await readFile(await safePath(root, source.path), "utf8");
    const content = text.split("\n");
    if (content.at(-1) === "") {
      content.pop();
    }
    const count = text.trim().split(/\s+/u).length;
    if (
      sha256(text) !== source.sha256 ||
      content.length !== source.lines ||
      count !== source.words ||
      lines.has(source.id)
    ) {
      throw new BaselineError("BASELINE_PTS_SOURCE_MISMATCH");
    }
    words += count;
    lines.set(source.id, content);
  }
  const ruleIds = new Set<string>(rules.rules.map((r: { id: string }) => r.id));
  const questionIds = new Set<string>(questions.questions.map((q: { id: string }) => q.id));
  const reference = (ref: Reference) => {
    const content = lines.get(ref.sourceId);
    if (
      !content ||
      !Number.isInteger(ref.lineStart) ||
      !Number.isInteger(ref.lineEnd) ||
      ref.lineStart < 1 ||
      ref.lineEnd < ref.lineStart ||
      ref.lineEnd > content.length
    ) {
      throw new BaselineError("BASELINE_PTS_REFERENCE_INVALID");
    }
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      if ("sourceId" in v && "lineStart" in v) {
        reference(v as unknown as Reference);
      }
      for (const [key, child] of Object.entries(v)) {
        if (Array.isArray(child) && (key === "ruleIds" || key.endsWith("QuestionIds"))) {
          const ids = key === "ruleIds" ? ruleIds : questionIds;
          if (child.some((id) => !ids.has(id))) {
            throw new BaselineError("BASELINE_PTS_REFERENCE_INVALID");
          }
        }
        walk(child);
      }
    }
  };
  const cover = new Map(
    [...lines].map(([id, source]) => [id, new Array<number>(source.length).fill(0)]),
  );
  let transcriptChunks = 0;
  let conceptCards = 0;
  const recordIds = new Set<string>();
  for (const file of ["retrieval/chunks.jsonl", "retrieval/concepts.jsonl"]) {
    for (const line of (await readFile(await safePath(root, file), "utf8"))
      .split("\n")
      .filter(Boolean)) {
      const record = JSON.parse(line) as Fragment;
      check("retrieval-record", record);
      walk(record);
      if (recordIds.has(record.id) || record.textSha256 !== sha256(record.text)) {
        throw new BaselineError("BASELINE_PTS_FRAGMENT_MISMATCH");
      }
      recordIds.add(record.id);
      if (record.kind === "transcript") {
        transcriptChunks++;
        if (record.sourceReferences.length !== 1) {
          throw new BaselineError("BASELINE_PTS_FRAGMENT_MISMATCH");
        }
        const ref = record.sourceReferences[0]!;
        if (
          lines
            .get(ref.sourceId)!
            .slice(ref.lineStart - 1, ref.lineEnd)
            .join("\n") !== record.text
        ) {
          throw new BaselineError("BASELINE_PTS_FRAGMENT_MISMATCH");
        }
        for (let i = ref.lineStart - 1; i < ref.lineEnd; i++) {
          cover.get(ref.sourceId)![i]!++;
        }
      } else {
        conceptCards++;
      }
    }
  }
  for (const content of cover.values()) {
    if (content.some((n) => n !== 1)) {
      throw new BaselineError("BASELINE_PTS_COVERAGE_MISMATCH");
    }
  }
  for (const file of [
    "rules.json",
    "candidate-policy.json",
    "open-questions.json",
    "examples/analysis-request.json",
    "examples/analysis-response.json",
  ]) {
    walk(await json(await safePath(root, file)));
  }
  const coverage = {
    sourceFiles: lines.size,
    sourceWords: words,
    rules: ruleIds.size,
    questions: questionIds.size,
    transcriptChunks,
    conceptCards,
  };
  if (JSON.stringify(coverage) !== JSON.stringify(bundle.coverage)) {
    throw new BaselineError("BASELINE_PTS_COVERAGE_MISMATCH");
  }
  if (
    Object.values(policy.reviewedDefinitions).some((value) => value !== null) ||
    Object.entries(policy.execution).some(
      ([key, value]) => !["readiness", "blockingQuestionIds"].includes(key) && value !== null,
    )
  ) {
    throw new BaselineError("BASELINE_PTS_UNREVIEWED_EXECUTION_PARAMETER");
  }
  const descriptorPath = await safePath(repository, candidatePath);
  const descriptor = (await json(descriptorPath)) as Candidate;
  const schemaPath = relative(
    repository,
    resolve(dirname(descriptorPath), "../schemas/candidate.schema.json"),
  );
  const schema = await json(await safePath(repository, schemaPath));
  if (!ajv.compile(schema)(descriptor)) {
    throw new BaselineError("BASELINE_CANDIDATE_CONTRACT_INVALID");
  }
  const bundleSha256 = (await fileFingerprint(bundlePath)).sha256;
  if (
    descriptor.reference.sha256 !== bundleSha256 ||
    descriptor.proposedPolicy.sha256 !==
      (await fileFingerprint(await safePath(root, "candidate-policy.json"))).sha256
  ) {
    throw new BaselineError("BASELINE_CANDIDATE_REFERENCE_MISMATCH");
  }
  const example = await json(
    await safePath(
      repository,
      relative(repository, resolve(dirname(descriptorPath), "../examples/candidate.json")),
    ),
  );
  if (!ajv.compile(schema)(example) || JSON.stringify(example) !== JSON.stringify(descriptor)) {
    throw new BaselineError("BASELINE_CANDIDATE_EXAMPLE_MISMATCH");
  }
  return {
    bundleSha256,
    candidateSha256: (await fileFingerprint(descriptorPath)).sha256,
    coverage,
    files: expected.length,
    coverageIssues: sources.coverageIssues,
    status: "verified-reference-only",
  };
}
