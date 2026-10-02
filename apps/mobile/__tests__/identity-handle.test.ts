import { HANDLE_RULES, RESERVED_HANDLES as API_RESERVED } from "../../../packages/api-schema/src/profiles";
import { claimable, HANDLE_MAX, HANDLE_MIN, handleNote, handleProblem, handleState, normalizeHandle, RESERVED_HANDLES } from "../src/identity/handle";

test("the app's rules are the API's: a change there that is not made here fails this", () => {
  expect({ min: HANDLE_MIN, max: HANDLE_MAX }).toEqual({ min: HANDLE_RULES.min, max: HANDLE_RULES.max });
  expect([...RESERVED_HANDLES].sort()).toEqual([...API_RESERVED].sort());
  for (const handle of ["night_owl", "abc", "a".repeat(15), "Night", "ñandu", "has space", "ab", "a".repeat(16)]) {
    const local = handleProblem(handle);
    const lower = handle.trim().toLowerCase();
    const api = lower.length < HANDLE_RULES.min || lower.length > HANDLE_RULES.max || !HANDLE_RULES.pattern.test(lower);
    expect(local !== null).toBe(api);
  }
});

test("a handle is sent trimmed, lowercased and without the @ somebody pasted", () => {
  expect(normalizeHandle("  @NightOwl ")).toBe("nightowl");
});

test("what is wrong with a handle is named while it is typed", () => {
  expect(handleProblem("ab")).toBe("too_short");
  expect(handleProblem("a".repeat(16))).toBe("too_long");
  expect(handleProblem("night owl")).toBe("invalid_characters");
  expect(handleProblem("admin")).toBe("reserved");
  expect(handleProblem("night_owl")).toBeNull();
});

test("the field's state follows what the server said about this handle", () => {
  expect(handleState("", undefined)).toBe("empty");
  expect(handleState("ab", true)).toBe("too_short"); // lo local manda: no hay nada que consultar
  expect(handleState("nightowl", undefined)).toBe("checking");
  expect(handleState("nightowl", null)).toBe("unknown");
  expect(handleState("nightowl", false)).toBe("taken");
  expect(handleState("nightowl", true)).toBe("ok");
});

test("the note under the field uses the web's words", () => {
  expect(handleNote("empty", "")).toBe("PICK ONE · 3–15");
  expect(handleNote("too_short", "ab")).toBe("TOO SHORT · 3 MIN");
  expect(handleNote("taken", "@NightOwl")).toBe("@NIGHTOWL IS TAKEN");
  expect(handleNote("ok", "nightowl")).toBe("AVAILABLE");
  // Una consulta que falló nunca dice «taken».
  expect(handleNote("unknown", "nightowl")).toBe("COULD NOT CHECK · YOU CAN STILL CLAIM IT");
});

test("a handle can be claimed unless something is known to be wrong with it", () => {
  expect(["ok", "unknown", "checking"].map((s) => claimable(s as never))).toEqual([true, true, true]);
  expect(["empty", "too_short", "too_long", "invalid_characters", "reserved", "taken"].map((s) => claimable(s as never))).toEqual([false, false, false, false, false, false]);
});
