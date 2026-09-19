import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readEnv } from "./config/env";
import { createModel } from "./composition/model";

const mode = process.argv[2];
if (mode !== "combined" && mode !== "split") {
  throw new Error(
    "Specify combined or split. Each explicit invocation makes paid model calls; no research or external tools are used.",
  );
}
const result = await createModel(readEnv()).diagnose(mode);
const directory = resolve(".data");
await mkdir(directory, { recursive: true });
const path = resolve(directory, `model-diagnostic-${randomUUID()}.json`);
await writeFile(path, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ path, result }));
