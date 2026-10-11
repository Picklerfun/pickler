import { join } from "node:path";
import { BaselineError, git, newDirectory } from "./safe.js";
import type { BaselineInventory } from "./contracts.js";

export async function ensureAnnotatedBaselineRef(
  repository: string,
  name: string,
  commit: string,
  signal: AbortSignal,
): Promise<void> {
  if (!/^refs\/tags\/[a-zA-Z0-9._/-]+$/.test(name) || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new BaselineError("BASELINE_INVALID_REFERENCE");
  }
  await git(repository, ["cat-file", "-e", `${commit}^{commit}`], signal);
  let existing: string | undefined;
  try {
    existing = await git(repository, ["rev-parse", "--verify", name], signal);
  } catch {
    // Creation is atomic: another writer creating it meanwhile makes git tag fail.
  }
  if (existing) {
    const type = await git(repository, ["cat-file", "-t", name], signal);
    const target = await git(repository, ["rev-parse", `${name}^{commit}`], signal);
    if (type !== "tag" || target !== commit) {
      throw new BaselineError("BASELINE_REFERENCE_CONFLICT");
    }
    return;
  }
  await git(
    repository,
    [
      "tag",
      "-a",
      name.slice(10),
      commit,
      "-m",
      `Immutable recovery baseline ${name.slice(10)}; no execution authorization.`,
    ],
    signal,
  );
}

export async function exportBaselineGit(
  repository: string,
  refs: BaselineInventory["references"],
  output: string,
  signal: AbortSignal,
) {
  if (await git(repository, ["status", "--porcelain", "--untracked-files=normal"], signal)) {
    throw new BaselineError("BASELINE_CLEAN_CHECKOUT_REQUIRED");
  }
  for (const ref of refs) {
    const target = await git(repository, ["rev-parse", `${ref.name}^{commit}`], signal);
    if (
      target !== ref.commit ||
      (ref.annotated && (await git(repository, ["cat-file", "-t", ref.name], signal)) !== "tag")
    ) {
      throw new BaselineError("BASELINE_REFERENCE_CONFLICT");
    }
  }
  await git(repository, ["bundle", "create", output, ...refs.map((r) => r.name)], signal);
}

/** Uses an empty Git database so bundles requiring missing prerequisites are rejected. */
export async function recoverBaselineGit(
  bundle: string,
  refs: BaselineInventory["references"],
  output: string,
  signal: AbortSignal,
): Promise<string> {
  const repo = await newDirectory(output);
  await git(repo, ["init", "--bare", "."], signal);
  await git(repo, ["bundle", "verify", bundle], signal);
  const listed = await git(repo, ["bundle", "list-heads", bundle], signal);
  const expected = new Set(listed.split("\n").map((line) => line.split(" ")[1]));
  for (const ref of refs) {
    if (!expected.has(ref.name)) {
      throw new BaselineError("BASELINE_BUNDLE_REFERENCE_MISSING");
    }
  }
  await git(
    repo,
    ["fetch", "--no-write-fetch-head", bundle, ...refs.map((r) => `${r.name}:${r.name}`)],
    signal,
  );
  for (const ref of refs) {
    if (
      (await git(repo, ["rev-parse", `${ref.name}^{commit}`], signal)) !== ref.commit ||
      (ref.annotated && (await git(repo, ["cat-file", "-t", ref.name], signal)) !== "tag")
    ) {
      throw new BaselineError("BASELINE_BUNDLE_REFERENCE_MISMATCH");
    }
  }
  const delivery = refs.find((r) => r.name.startsWith("refs/heads/"));
  if (!delivery) {
    throw new BaselineError("BASELINE_DELIVERY_REFERENCE_REQUIRED");
  }
  const code = join(repo, "recovered-code");
  await newDirectory(code);
  await git(repo, ["--work-tree", code, "checkout", delivery.commit, "--", "."], signal);
  return code;
}
