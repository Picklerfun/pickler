import assert from "node:assert/strict";
import { test } from "node:test";
import { previewAllowed, studioPreview } from "../src/features/console/preview";
import { SECTIONS, sectionFromSearch } from "../src/features/console/sections/keys";
import {
  forgetRail,
  railOnServer,
  railSnapshot,
  setRail,
  subscribeRail,
} from "../src/features/console/lib/rail";

/* One behaviour per test. An assert after a failing assert never runs, so a test that checked all
   four gate positions at once would report the first failure and hide the other three. */

test("the studio preview is refused in a production build", () => {
  assert.equal(previewAllowed("production", false, ""), false);
});

test("the studio preview is refused where authentication is configured", () => {
  assert.equal(previewAllowed("development", true, ""), false);
});

test("the studio preview leaves ?state=empty to the empty studio", () => {
  assert.equal(previewAllowed("development", false, "?state=empty"), false);
});

test("the studio preview stands in where there is no authentication at all", () => {
  assert.equal(previewAllowed("development", false, ""), true);
});

test("the preview carries the plugin roster the skills screen draws its rows from", () => {
  const preview = studioPreview(Date.UTC(2026, 0, 1));
  assert.ok(preview, "no preview in a test environment, which configures no authentication");
  assert.deepEqual(
    preview.options.plugins.map((plugin) => plugin.id),
    ["polymarket", "exa", "balldontlie", "the-odds-api", "paper-trading"],
  );
});

test("the preview's running run did not start before it was created", () => {
  const preview = studioPreview(Date.UTC(2026, 0, 1));
  assert.ok(preview);
  const running = preview.runs.find((run) => run.status === "running");
  assert.ok(running, "the fixture has a run in flight, so the live states render");
  assert.ok(running.startedAt !== null && running.startedAt >= running.createdAt);
});

/* The rail reads and writes this browser's storage. Node has no window, so one stands in. */
function withStorage(store: Map<string, string> | null) {
  const storage = store
    ? {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      }
    : {
        getItem() {
          throw new Error("storage is blocked");
        },
        setItem() {
          throw new Error("storage is blocked");
        },
      };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  forgetRail();
  return store;
}

test("the rail starts wide where nothing has been stored", () => {
  withStorage(new Map());
  assert.equal(railSnapshot(), true);
});

test("the first paint is the same on both sides, so hydration has nothing to reconcile", () => {
  withStorage(new Map([["pickler.studio.rail", "narrow"]]));
  assert.equal(railOnServer(), true);
});

test("a collapsed rail comes back collapsed", () => {
  const store = withStorage(new Map());
  setRail(false);
  forgetRail();
  assert.equal(railSnapshot(), false, `stored: ${store!.get("pickler.studio.rail")}`);
});

test("an expanded rail comes back expanded", () => {
  withStorage(new Map([["pickler.studio.rail", "narrow"]]));
  setRail(true);
  forgetRail();
  assert.equal(railSnapshot(), true);
});

test("a value the rail did not write is not trusted as a preference", () => {
  withStorage(new Map([["pickler.studio.rail", "yes"]]));
  assert.equal(railSnapshot(), true);
});

test("the snapshot is stable between notifications, which is what React requires of it", () => {
  const store = withStorage(new Map());
  const first = railSnapshot();
  store!.set("pickler.studio.rail", "narrow");
  assert.equal(railSnapshot(), first);
});

test("setting the rail notifies every subscriber", () => {
  withStorage(new Map());
  let told = 0;
  const stop = subscribeRail(() => (told += 1));
  setRail(false);
  stop();
  assert.equal(told, 1);
});

test("an unsubscribed listener is not told again", () => {
  withStorage(new Map());
  let told = 0;
  subscribeRail(() => (told += 1))();
  setRail(false);
  assert.equal(told, 0);
});

test("blocked storage leaves the rail at its default instead of throwing", () => {
  withStorage(null);
  assert.equal(railSnapshot(), true);
});

test("blocked storage does not make closing the rail throw", () => {
  withStorage(null);
  assert.doesNotThrow(() => setRail(false));
});

/* `?section=` is how every studio section becomes reachable by a check. One behaviour per test. */

test("a production build ignores the section a link asked for", () => {
  assert.equal(sectionFromSearch("production", "picks"), undefined);
});

test("a link can open the studio on a section a check would never reach", () => {
  assert.equal(sectionFromSearch("development", "picks"), "picks");
});

test("a section the rail does not have is not opened on", () => {
  assert.equal(sectionFromSearch("development", "../etc/passwd"), undefined);
});

test("a repeated section param takes the first value rather than the array", () => {
  assert.equal(sectionFromSearch("development", ["skills", "picks"]), "skills");
});

test("no section asked for leaves the studio where it opens", () => {
  assert.equal(sectionFromSearch("development", undefined), undefined);
});

test("every section the rail can reach is a section a link can ask for", () => {
  const unreachable = SECTIONS.filter((key) => sectionFromSearch("development", key) !== key);
  assert.deepEqual(unreachable, []);
});
