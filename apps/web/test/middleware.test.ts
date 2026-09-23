import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/middleware";

const HOSTS = { marketplace: "pickler.fun", studio: "app.pickler.fun" };

test("a path on its own host is served", () => {
  assert.deepEqual(decide("pickler.fun", "/leaderboard", HOSTS), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/console", HOSTS), { kind: "serve" });
});

test("the studio root serves the studio", () => {
  assert.deepEqual(decide("app.pickler.fun", "/", HOSTS), { kind: "rewrite", to: "/console" });
});

test("a studio path asked of the marketplace redirects, so old links survive", () => {
  assert.deepEqual(decide("pickler.fun", "/account", HOSTS), {
    kind: "redirect",
    to: "https://app.pickler.fun/account",
  });
});

test("a marketplace path asked of the studio is 404, not a redirect", () => {
  // A redirect would give every screen two canonical URLs.
  assert.deepEqual(decide("app.pickler.fun", "/leaderboard", HOSTS), { kind: "notFound" });
});

test("shared paths are served on both hosts", () => {
  assert.deepEqual(decide("app.pickler.fun", "/api/v1/landing", HOSTS), { kind: "serve" });
  assert.deepEqual(decide("pickler.fun", "/brand/logo.png", HOSTS), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/brand/logo.png", HOSTS), { kind: "serve" });
});

test("development is inert: every path is served on localhost", () => {
  assert.deepEqual(decide("localhost:3001", "/console", HOSTS), { kind: "serve" });
  assert.deepEqual(decide("localhost:3001", "/leaderboard", HOSTS), { kind: "serve" });
  assert.deepEqual(decide("localhost:3001", "/", HOSTS), { kind: "serve" });
});
