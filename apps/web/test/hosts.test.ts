import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marketplaceUrl,
  originFor,
  ownerOf,
  productFor,
  studioHref,
  studioOrigin,
  studioUrl,
} from "../src/server/hosts";

const HOSTS = { marketplace: "pickler.fun", studio: "app.pickler.fun" };

test("each configured hostname maps to its own product", () => {
  assert.equal(productFor("pickler.fun", HOSTS), "marketplace");
  assert.equal(productFor("app.pickler.fun", HOSTS), "studio");
});

test("a port is not part of the hostname", () => {
  assert.equal(productFor("pickler.fun:443", HOSTS), "marketplace");
  assert.equal(productFor("app.pickler.fun:3001", HOSTS), "studio");
});

test("the comparison ignores case, because a Host header may carry any", () => {
  assert.equal(productFor("APP.Pickler.Fun", HOSTS), "studio");
});

test("localhost belongs to neither, so development serves everything", () => {
  assert.equal(productFor("localhost:3001", HOSTS), "either");
  assert.equal(productFor("127.0.0.1:3001", HOSTS), "either");
});

test("an unknown host is 'either' rather than a guess", () => {
  // A preview deployment on workers.dev must not lose half the application.
  assert.equal(productFor("pickler-web-staging.workers.dev", HOSTS), "either");
});

test("a host that merely ends with the marketplace name is not the marketplace", () => {
  // The check is equality, not suffix: evilpickler.fun must not be served as the product.
  assert.equal(productFor("evilpickler.fun", HOSTS), "either");
});

test("studio paths belong to the studio", () => {
  assert.equal(ownerOf("/studio"), "studio");
  assert.equal(ownerOf("/account"), "studio");
  assert.equal(ownerOf("/signin"), "studio");
  assert.equal(ownerOf("/signup"), "studio");
  assert.equal(ownerOf("/passkey"), "studio");
  assert.equal(ownerOf("/auth/callback"), "studio");
});

test("marketplace paths belong to the marketplace", () => {
  assert.equal(ownerOf("/create"), "marketplace");
  assert.equal(ownerOf("/"), "marketplace");
  assert.equal(ownerOf("/leaderboard"), "marketplace");
  assert.equal(ownerOf("/markets/BTC-PERP"), "marketplace");
  assert.equal(ownerOf("/portfolio"), "marketplace");
  assert.equal(ownerOf("/activity"), "marketplace");
});

test("a nested path belongs where its first segment does", () => {
  assert.equal(ownerOf("/studio?section=picks"), "studio");
  assert.equal(ownerOf("/tokens/HALF/picks/9"), "marketplace");
});

test("a path that merely starts with a studio name is not the studio", () => {
  // /accounts-of-agents is a marketplace page that must not be refused on the marketplace.
  assert.equal(ownerOf("/accounts-of-agents"), "marketplace");
});

test("the API and Next's own assets belong to both", () => {
  assert.equal(ownerOf("/api/v1/landing"), "either");
  assert.equal(ownerOf("/_next/static/chunk.js"), "either");
});

test("the static files both products' pages request belong to both", () => {
  // The icon is set on the root layout, so a studio page requests it too; universal links need the
  // association file served as a direct 200 from a fixed origin.
  assert.equal(ownerOf("/brand/logo.png"), "either");
  assert.equal(ownerOf("/.well-known/apple-app-site-association"), "either");
  assert.equal(ownerOf("/_headers"), "either");
});

test("taking custody is a studio path, not a marketplace one", () => {
  // The ceremony is reached from /account and from the studio's agent form. Left out of the studio
  // list it resolves to the marketplace, and app.pickler.fun 404s its own passkey flow. The concept
  // is still custody; only the address a person sees says passkey.
  assert.equal(ownerOf("/passkey"), "studio");
});

test("the old custody address is nobody's studio path any more", () => {
  // Nothing was ever deployed under it and nothing links to it, so it is a marketplace path by the
  // same default every unlisted segment gets — which means the studio host 404s it.
  assert.equal(ownerOf("/custody"), "marketplace");
});

test("the studio's home has a different address on each host", () => {
  // No one string is right everywhere, which is why this takes the product. On the marketplace it
  // has to be absolute: the cross-host redirect that used to carry /studio is gone.
  const hosts = { marketplace: "pickler.fun", studio: "app.pickler.fun" };
  assert.equal(studioHref("studio", hosts), "/");
  assert.equal(studioHref("marketplace", hosts), "https://app.pickler.fun/");
  assert.equal(studioHref("either", hosts), "/studio");
});

test("a studio path gets an origin only where it has to cross one", () => {
  // The marketplace host 404s studio paths rather than forwarding them, so a link to one carries
  // the studio's origin from there and nowhere else.
  const hosts = { marketplace: "pickler.fun", studio: "app.pickler.fun" };
  assert.equal(studioUrl("marketplace", hosts, "/signin"), "https://app.pickler.fun/signin");
  assert.equal(studioUrl("studio", hosts, "/signin"), "/signin");
  assert.equal(studioUrl("either", hosts, "/signin"), "/signin");
});

test("the studio link follows a reconfigured studio host", () => {
  // Hard-coding the production hostname would make a preview pair link at production.
  const hosts = { marketplace: "market.test", studio: "studio.test" };
  assert.equal(studioHref("marketplace", hosts), "https://studio.test/");
  assert.equal(studioUrl("marketplace", hosts, "/signin"), "https://studio.test/signin");
});

test("a marketplace path gets an origin only from the studio host", () => {
  // The mirror of `studioUrl`. The studio host 404s what the marketplace owns, so the studio's
  // links to the directory and the leaderboard have to name the other origin there, and only there.
  const hosts = { marketplace: "pickler.fun", studio: "app.pickler.fun" };
  assert.equal(marketplaceUrl("studio", hosts, "/agents"), "https://pickler.fun/agents");
  assert.equal(marketplaceUrl("marketplace", hosts, "/agents"), "/agents");
  assert.equal(marketplaceUrl("either", hosts, "/agents"), "/agents");
});

test("a marketplace link carries the whole path it was given", () => {
  const hosts = { marketplace: "pickler.fun", studio: "app.pickler.fun" };
  assert.equal(
    marketplaceUrl("studio", hosts, "/agents/half_time"),
    "https://pickler.fun/agents/half_time",
  );
  assert.equal(marketplaceUrl("studio", hosts, "/leaderboard"), "https://pickler.fun/leaderboard");
  assert.equal(marketplaceUrl("studio", hosts, "/"), "https://pickler.fun/");
});

test("the marketplace link follows a reconfigured marketplace host", () => {
  const hosts = { marketplace: "market.test", studio: "studio.test" };
  assert.equal(marketplaceUrl("studio", hosts, "/agents"), "https://market.test/agents");
});

test("every marketplace link the studio renders is one its own host would refuse", () => {
  // The reason the helper exists, pinned against `ownerOf`: if one of these became a studio path,
  // sending it to the other origin would be the bug.
  for (const path of ["/agents", "/agents/half_time", "/leaderboard"]) {
    assert.equal(ownerOf(path), "marketplace", path);
  }
});

/* Two local hosts, port and all, so the split can be rehearsed before production. */
const LOCAL = { marketplace: "pickler.localhost:3001", studio: "app.pickler.localhost:3001" };

test("a configured host with a port still names its product", () => {
  assert.equal(productFor("app.pickler.localhost:3001", LOCAL), "studio");
});

test("a local host is reached over http, with its port", () => {
  assert.equal(originFor("app.pickler.localhost:3001"), "http://app.pickler.localhost:3001");
});

test("plain localhost is reached over http", () => {
  assert.equal(originFor("localhost:3001"), "http://localhost:3001");
});

test("a real host is reached over https", () => {
  assert.equal(originFor("app.pickler.fun"), "https://app.pickler.fun");
});

test("a host that only ends in the letters localhost is not local", () => {
  assert.equal(originFor("evillocalhost.com"), "https://evillocalhost.com");
});

test("the studio's home, from the local marketplace, is the local studio", () => {
  assert.equal(studioHref("marketplace", LOCAL), "http://app.pickler.localhost:3001/");
});

test("a marketplace path, from the local studio, is the local marketplace", () => {
  assert.equal(marketplaceUrl("studio", LOCAL, "/agents"), "http://pickler.localhost:3001/agents");
});

test("the studio's origin from the local marketplace is the local studio", () => {
  assert.equal(
    studioOrigin("marketplace", "pickler.localhost:3001", LOCAL),
    "http://app.pickler.localhost:3001",
  );
});

test("the studio's origin on the studio is its configured one, whatever the server calls itself", () => {
  assert.equal(studioOrigin("studio", "localhost:3001", HOSTS), "https://app.pickler.fun");
});

test("the studio's origin on a shared host is that host", () => {
  assert.equal(studioOrigin("either", "localhost:3001", HOSTS), "http://localhost:3001");
});
