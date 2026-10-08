import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentSectionHref,
  studioAgentRoute,
  STUDIO_ROUTE_SECTIONS,
} from "../src/features/studio/routing/routes";
import { DRAFT_SECTIONS } from "../src/features/studio/draft/model";
import { LIVE_SECTIONS } from "../src/features/studio/live/model";
import { SECTIONS } from "../src/features/studio/sections/keys";
import { studioReturnHref, profileFromStudio } from "../src/features/studio/shell/account-return";
import { decide } from "../src/middleware";
import { callbackDestination } from "../src/features/auth/lib/callback";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("every draft, published and historical rail section has a real App Router page", () => {
  const all = [
    ...DRAFT_SECTIONS.flatMap((group) => group.items.map((item) => item.key)),
    ...LIVE_SECTIONS,
    ...SECTIONS,
  ];
  for (const section of all) {
    assert.ok(
      STUDIO_ROUTE_SECTIONS.some((key) => key === section),
      section,
    );
    assert.ok(
      existsSync(
        fileURLToPath(
          new URL(
            `../src/app/(workspace)/studio/agents/[agentId]/${section}/page.tsx`,
            import.meta.url,
          ),
        ),
      ),
      section,
    );
    assert.deepEqual(studioAgentRoute(agentSectionHref("product-id", section)), {
      agentId: "product-id",
      section,
    });
  }
});
test("private routes reject ambiguous identities and unknown sections", () => {
  for (const path of [
    "/agents/id/brief",
    "/studio/agents/id/missing",
    "/studio/agents/id/brief/extra",
    "/studio/agents/%2f/brief",
  ]) {
    assert.equal(studioAgentRoute(path), null);
  }
  assert.throws(() => agentSectionHref("../other", "brief"));
  assert.throws(() => agentSectionHref("id", "missing"));
});
test("profile round trips keep canonical agent/section/check and strip private query data", () => {
  const profile = new URL(
    profileFromStudio("/studio/agents/a/decisions", "?check=c&secret=hidden"),
    "https://app.pickler.fun",
  );
  for (const home of ["/", "/studio"]) {
    assert.equal(
      studioReturnHref(profile.searchParams.get("returnTo")!, home),
      "/studio/agents/a/decisions?check=c",
    );
  }
  for (const path of [
    "/studio/agents/a/../a/brief",
    "/studio/agents/a/%2e%2e/a/brief",
    "/\\evil.example/studio",
    "/studio/agents/a/nope",
    "https://evil.example/studio/agents/a/brief",
  ]) {
    assert.equal(studioReturnHref(path, "/studio"), "/studio");
  }
});
test("host guard protects deep links and preserves the requested query", () => {
  const hosts = { studio: "app.pickler.fun", marketplace: "pickler.fun" };
  const auth = { configured: true, session: false };
  const path = "/studio/agents/a/decisions";
  assert.deepEqual(decide("app.pickler.fun", path, hosts, auth, "?check=c"), {
    kind: "signIn",
    to: `/signin?next=${encodeURIComponent(path + "?check=c")}`,
  });
  assert.deepEqual(decide("pickler.fun", path, hosts, auth), { kind: "notFound" });
  assert.deepEqual(decide("localhost:3005", path, hosts, { ...auth, session: true }), {
    kind: "serve",
  });
});
test("authentication resumes deep links only after wallet and profile are ready", () => {
  const next = "/studio/agents/a/brief?check=c";
  assert.equal(callbackDestination({ wallet: "found", profile: "found" }, "/", next), next);
  assert.equal(
    callbackDestination({ wallet: "missing", profile: "found" }, "/", next),
    `/signup?step=passkey&next=${encodeURIComponent(next)}`,
  );
  assert.equal(
    callbackDestination({ wallet: "found", profile: "missing" }, "/", next),
    `/signup?step=handle&next=${encodeURIComponent(next)}`,
  );
  assert.equal(
    callbackDestination({ wallet: "failed", profile: "found" }, "/", next),
    `/signup?next=${encodeURIComponent(next)}`,
  );
  assert.equal(
    callbackDestination({ wallet: "found", profile: "found" }, "/", "//evil.example"),
    "/",
  );
});
