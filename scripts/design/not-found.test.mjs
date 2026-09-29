// What a 404 from the dev server means is decided by two pure functions, so every position of the
// decision is pinned here without a server.
import assert from "node:assert/strict";
import test from "node:test";
import { afterNotFound, pageFor } from "./lib/not-found.mjs";

const PAGES = [
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/(auth)/passkey/page.tsx",
  "apps/web/src/app/agents/[handle]/ask/page.tsx",
  "apps/web/src/app/agents/page.tsx",
  "apps/web/src/app/tokens/[ticker]/picks/[pickId]/page.tsx",
  "apps/web/src/app/docs/[...slug]/page.tsx",
];

test("the first 404 is tried once more, whether or not the page exists", () => {
  assert.deepEqual(afterNotFound({ attempts: 1, built: true }), { retry: true });
  assert.deepEqual(afterNotFound({ attempts: 1, built: false }), { retry: true });
});

test("a second 404 from a route with no page file is a screen not built yet", () => {
  assert.deepEqual(afterNotFound({ attempts: 2, built: false }), { kind: "not-built" });
});

test("a second 404 from a built route is the server's fault, not a missing screen", () => {
  assert.deepEqual(afterNotFound({ attempts: 2, built: true }), {
    kind: "server-error",
    detail: "404 from a built route",
  });
});

test("a path finds its page through route groups and dynamic segments", () => {
  assert.equal(pageFor("/", PAGES), "apps/web/src/app/page.tsx");
  assert.equal(pageFor("/passkey?state=add", PAGES), "apps/web/src/app/(auth)/passkey/page.tsx");
  assert.equal(pageFor("/agents", PAGES), "apps/web/src/app/agents/page.tsx");
  assert.equal(
    pageFor("/agents/halftime/ask", PAGES),
    "apps/web/src/app/agents/[handle]/ask/page.tsx",
  );
  assert.equal(
    pageFor("/tokens/half/picks/half-1", PAGES),
    "apps/web/src/app/tokens/[ticker]/picks/[pickId]/page.tsx",
  );
  assert.equal(pageFor("/docs/a/b/c", PAGES), "apps/web/src/app/docs/[...slug]/page.tsx");
});

test("a path with no page is nothing, and a dynamic segment matches exactly one segment", () => {
  assert.equal(pageFor("/nowhere", PAGES), null);
  assert.equal(pageFor("/agents/halftime", PAGES), null);
  assert.equal(pageFor("/agents/halftime/ask/more", PAGES), null);
});
