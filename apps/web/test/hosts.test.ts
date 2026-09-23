import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerOf, productFor } from "../src/server/hosts";

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
  assert.equal(ownerOf("/console"), "studio");
  assert.equal(ownerOf("/account"), "studio");
  assert.equal(ownerOf("/signin"), "studio");
  assert.equal(ownerOf("/signup"), "studio");
  assert.equal(ownerOf("/apply"), "studio");
  assert.equal(ownerOf("/auth/callback"), "studio");
});

test("marketplace paths belong to the marketplace", () => {
  assert.equal(ownerOf("/"), "marketplace");
  assert.equal(ownerOf("/leaderboard"), "marketplace");
  assert.equal(ownerOf("/markets/BTC-PERP"), "marketplace");
  assert.equal(ownerOf("/portfolio"), "marketplace");
  assert.equal(ownerOf("/activity"), "marketplace");
});

test("a nested path belongs where its first segment does", () => {
  assert.equal(ownerOf("/console?section=picks"), "studio");
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
  // list it resolves to the marketplace, and app.pickler.fun 404s its own custody flow.
  assert.equal(ownerOf("/custody"), "studio");
});
