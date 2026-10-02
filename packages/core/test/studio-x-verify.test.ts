import test from "node:test";
import assert from "node:assert/strict";
import {
  challengeCode,
  findVerificationPost,
  parseXHandle,
  verificationText,
} from "../src/features/studio/x-verify.js";
import * as core from "../src/index.js";

test("handles: @ optional, 1-15 of [A-Za-z0-9_]", () => {
  assert.equal(parseXHandle("@HalftimeBot"), "HalftimeBot");
  assert.equal(parseXHandle(" halftime_bot "), "halftime_bot");
  assert.equal(parseXHandle("half time"), null);
  assert.equal(parseXHandle("a".repeat(16)), null);
  assert.equal(parseXHandle("@"), null);
});

test("the package exports the verification parser, not the applications' @-form normalizer", () => {
  // applications' `normalizeXHandle` answers "@handle"; this one answers the bare handle X takes.
  assert.equal(core.parseXHandle("@HalftimeBot"), "HalftimeBot");
  assert.equal(core.normalizeXHandle("HalftimeBot"), "@HalftimeBot");
});

test("a challenge code is pk- and 8 base32 characters, from the given random bytes", () => {
  assert.match(challengeCode(new Uint8Array([1, 2, 3, 4, 5])), /^pk-[a-z2-7]{8}$/);
  // RFC 4648's own example: "fooba" is MZXW6YTB.
  assert.equal(challengeCode(new TextEncoder().encode("fooba")), "pk-mzxw6ytb");
  assert.throws(() => challengeCode(new Uint8Array(4)), RangeError);
});

test("the line to post names the agent and the code", () => {
  assert.equal(
    verificationText("Halftime", "pk-7f3a2b9c"),
    "Verifying Halftime on @pickler · pk-7f3a2b9c",
  );
});

test("a post matches only from the user, after the challenge, with the code", () => {
  const since = new Date("2026-10-02T10:00:00Z");
  const post = {
    id: "1",
    authorId: "u1",
    text: "Verifying Halftime on @pickler · pk-abcdefgh",
    createdAt: new Date("2026-10-02T10:05:00Z"),
  };
  const want = { userId: "u1", code: "pk-abcdefgh", since };
  assert.equal(findVerificationPost([post], want)?.id, "1");
  assert.equal(findVerificationPost([{ ...post, authorId: "u2" }], want), null);
  assert.equal(
    findVerificationPost([{ ...post, createdAt: new Date("2026-10-02T09:59:00Z") }], want),
    null,
  );
  assert.equal(findVerificationPost([{ ...post, text: "pk-abcdefgX" }], want), null);
  // Case-insensitive on the code, as X may not change case but people retype it.
  assert.equal(findVerificationPost([{ ...post, text: "PK-ABCDEFGH" }], want)?.id, "1");
});
