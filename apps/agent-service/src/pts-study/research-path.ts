import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { PilotError } from "@pickler/core";

function allowedName(file: string) {
  return (
    file.length > 0 &&
    file.length <= 4096 &&
    !file.includes("\0") &&
    !/^[a-z][a-z\d+.-]*:/i.test(file) &&
    file.endsWith(".json") &&
    !/(^|[/\\])(?:\.env[^/\\]*|credentials[^/\\]*|secrets?[^/\\]*)($|[/\\])/i.test(file)
  );
}

function systemAlias(file: string) {
  if (file.startsWith("/tmp/")) {
    return "/private" + file;
  }
  if (file.startsWith("/var/")) {
    return "/private" + file;
  }
  return file;
}

/** Resolve explicit JSON without following user-controlled file or parent-directory aliases. */
export async function researchJsonPath(file: string, base?: string) {
  if (!allowedName(file)) {
    throw new PilotError("INVALID_INPUT", "Explicit local JSON path required");
  }
  const requested = base === undefined ? resolve(file) : resolve(base, file);
  const canonical = await realpath(requested);
  if (
    !allowedName(requested) ||
    !allowedName(canonical) ||
    (canonical !== requested && canonical !== systemAlias(requested))
  ) {
    throw new PilotError(
      "INVALID_INPUT",
      "Credential paths and symlinked JSON source components are forbidden",
    );
  }
  return canonical;
}
