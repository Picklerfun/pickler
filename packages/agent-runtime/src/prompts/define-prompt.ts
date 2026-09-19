import { createHash } from "node:crypto";
import type { PromptSnapshot } from "@pickler/core";

/** Hash the exact UTF-8 instructions sent to the model, without normalization. */
export function definePrompt(input: Omit<PromptSnapshot, "sha256">): Readonly<PromptSnapshot> {
  return Object.freeze({
    ...input,
    sha256: createHash("sha256").update(input.instructions, "utf8").digest("hex"),
  });
}
