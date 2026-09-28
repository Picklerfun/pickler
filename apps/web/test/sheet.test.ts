import assert from "node:assert/strict";
import { test } from "node:test";
import { CANCELLED_TITLE, NOTHING_HAPPENED, sheetCopy } from "../src/features/auth/lib/sheet";
import type { Ceremony, SheetPhase } from "../src/features/auth/lib/sheet";

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

test("each ceremony asks its own question — the sheet is never generically about passkeys", () => {
  const asked = (ceremony: Ceremony) => sheetCopy({ ceremony, phase: "idle" }).title;

  assert.equal(asked("create"), "Create a passkey for Pickler?");
  assert.equal(asked("backup"), "Add a backup passkey?");
  assert.equal(asked("here"), "Save a passkey on this device?");

  // Three questions, not one question three times.
  assert.equal(new Set([asked("create"), asked("backup"), asked("here")]).size, 3);
});

test("each ceremony says its own thing when it worked", () => {
  const done = (ceremony: Ceremony) => sheetCopy({ ceremony, phase: "ok" }).title;

  assert.equal(done("create"), "Passkey saved");
  assert.equal(done("backup"), "Backup saved");
  assert.equal(done("here"), "Saved");
});

test("the first ceremony names the live relying party, not a domain from the canvas", () => {
  assert.equal(
    sheetCopy({ ceremony: "create", phase: "idle", rpId: "pickler.fun", userAgent: SAFARI_MAC })
      .note,
    "PICKLER.FUN · ICLOUD KEYCHAIN",
  );
  // The one that catches a hard-coded domain: a different relying party has to show through.
  assert.equal(
    sheetCopy({ ceremony: "create", phase: "idle", rpId: "localhost", userAgent: SAFARI_MAC }).note,
    "LOCALHOST · ICLOUD KEYCHAIN",
  );
  // Chrome on a Mac has no single store to name, so the line is the domain and nothing else.
  assert.equal(
    sheetCopy({ ceremony: "create", phase: "idle", rpId: "pickler.fun", userAgent: CHROME_MAC })
      .note,
    "PICKLER.FUN",
  );
  // No relying party known yet: an empty segment must not leave a stray separator behind.
  assert.equal(sheetCopy({ ceremony: "create", phase: "idle", userAgent: CHROME_MAC }).note, "");
  assert.equal(
    sheetCopy({ ceremony: "create", phase: "idle", userAgent: SAFARI_MAC }).note,
    "ICLOUD KEYCHAIN",
  );
});

test("the backup ceremony names the three places a backup can live", () => {
  // Nothing about a backup is derived: it is a list of what the operating system will offer.
  const note = sheetCopy({
    ceremony: "backup",
    phase: "idle",
    rpId: "pickler.fun",
    userAgent: SAFARI_MAC,
  }).note;
  assert.equal(note, "PHONE · SECURITY KEY · PASSWORD MANAGER");
});

test("saving one on this device names this browser, this platform and which half it is on", () => {
  assert.equal(
    sheetCopy({ ceremony: "here", phase: "idle", userAgent: CHROME_MAC, step: 1 }).note,
    "CHROME · MACOS · 1 OF 2",
  );
  assert.equal(
    sheetCopy({ ceremony: "here", phase: "busy", userAgent: CHROME_MAC, step: 2 }).note,
    "CHROME · MACOS · 2 OF 2",
  );
  // A user agent nobody recognises drops its segments rather than printing "NULL · NULL".
  assert.equal(
    sheetCopy({ ceremony: "here", phase: "idle", userAgent: "Wget/1.21.4", step: 1 }).note,
    "1 OF 2",
  );
});

test("a cancelled ceremony says so, and says what it did not do", () => {
  for (const ceremony of ["create", "backup", "here"] as const) {
    // `error: null` is describeCeremonyFailure's answer for NotAllowedError — the person
    // dismissed the prompt. That is a decision, not a fault, and the same words for all three.
    const copy = sheetCopy({ ceremony, phase: "error", error: null });
    assert.equal(copy.title, CANCELLED_TITLE);
    assert.equal(copy.title, "Passkey cancelled");
    assert.equal(copy.note, NOTHING_HAPPENED);
    assert.equal(copy.note, "NOTHING WAS SIGNED · NOTHING MOVED");
  }
});

test("a ceremony that failed keeps the reassurance but does not call it a cancellation", () => {
  const copy = sheetCopy({
    ceremony: "create",
    phase: "error",
    error: "This device does not support the kind of passkey Pickler needs.",
  });
  assert.notEqual(copy.title, CANCELLED_TITLE);
  assert.equal(copy.title, "Passkey not saved");
  // Still true, and still the thing the person wants to know first.
  assert.equal(copy.note, NOTHING_HAPPENED);
  // The sentence itself belongs to the sheet's alert, not to the mono line under the title.
  assert.notEqual(copy.note, "This device does not support the kind of passkey Pickler needs.");
});

test("the phase decides the title; nothing else leaks between phases", () => {
  const phases: SheetPhase[] = ["idle", "busy", "ok", "error"];
  const titles = phases.map((phase) => sheetCopy({ ceremony: "backup", phase, error: null }).title);
  assert.deepEqual(titles, [
    "Add a backup passkey?",
    "Add a backup passkey?",
    "Backup saved",
    "Passkey cancelled",
  ]);
});
