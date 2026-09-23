import { test } from "node:test";
import assert from "node:assert/strict";
import { productFor } from "../src/server/hosts";

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
