import readJson from "./fixtures/reads/read.json";
import { levelFromCell, levelFromRead, levelIsLive, levelTitle, REMINDER_PRE_MS, reminderKinds, remindersCopy, resolvesLabel, sideFor } from "../src/reads/level";
import { parseRead } from "../src/reads/types";

const NOW = Date.parse("2026-09-22T18:00:00.000Z");
const BTC = { id: 16, mark: 762555 }; // pd 1 (fixture context.json); mismos números que P10 de F2

test("levelFromCell previews target and expiry from the app mark (D2, P10)", () => {
  const l = levelFromCell(BTC, { levelBps: 50, horizonMin: 240 }, new Date(NOW));
  expect(l).toEqual({ marketId: 16, levelBps: 50, horizonMin: 240, target: 766368, expiresAt: "2026-09-22T22:00:00.000Z" });
  expect(l.readId).toBeUndefined();
});

test("levelFromRead takes the server values and the read id", () => {
  const read = parseRead(readJson);
  const l = levelFromRead(read);
  expect(l).toEqual({ marketId: read.marketId, levelBps: read.levelBps, horizonMin: read.horizonMin, target: read.target, expiresAt: read.expiresAt, readId: read.id });
});

test("sideFor suggests long above the mark and short below (D12)", () => {
  expect(sideFor(250)).toBe("long");
  expect(sideFor(50)).toBe("long");
  expect(sideFor(-50)).toBe("short");
  expect(sideFor(-100)).toBe("short");
});

test("levelIsLive is strict on expiry", () => {
  const l = levelFromCell(BTC, { levelBps: 50, horizonMin: 60 }, new Date(NOW));
  expect(levelIsLive(l, NOW)).toBe(true);
  expect(levelIsLive(l, NOW + 60 * 60_000 - 1)).toBe(true);
  expect(levelIsLive(l, NOW + 60 * 60_000)).toBe(false);
});

test("resolvesLabel shows local time and the remaining time", () => {
  const l = levelFromCell(BTC, { levelBps: 50, horizonMin: 240 }, new Date(NOW));
  const d = new Date(l.expiresAt);
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  expect(resolvesLabel(l, NOW + 2 * 60_000)).toBe(`Resolves ${hh}:${mm} · in 3 h 58 m`);
  expect(resolvesLabel(l, NOW + 240 * 60_000)).toBe(`Resolves ${hh}:${mm} · now`);
});

test("levelTitle is symbol + cell label", () => {
  expect(levelTitle("BTC", levelFromCell(BTC, { levelBps: 100, horizonMin: 240 }, new Date(NOW)))).toBe("BTC +1.0% · 4H");
});

test("reminderKinds mirrors reminder-set: pre only if more than 15 min remain", () => {
  const l = levelFromCell(BTC, { levelBps: 50, horizonMin: 60 }, new Date(NOW));
  expect(REMINDER_PRE_MS).toBe(15 * 60_000);
  expect(reminderKinds(l, NOW)).toEqual(["pre", "expiry"]);
  expect(reminderKinds(l, NOW + 45 * 60_000 - 1)).toEqual(["pre", "expiry"]);
  expect(reminderKinds(l, NOW + 45 * 60_000)).toEqual(["expiry"]);
  expect(remindersCopy(["pre", "expiry"])).toBe("Reminders set: 15 min before and at expiry.");
  expect(remindersCopy(["expiry"])).toBe("Reminder set at expiry.");
});
