// A route's busy state, waited out before anything is read.
import assert from "node:assert/strict";
import test from "node:test";
import { settle } from "./lib/settle.mjs";

/** A page whose busy selector clears after `clearsAfter` ms, or never. */
function pageClearing(clearsAfter) {
  const asked = [];
  return {
    asked,
    locator(selector) {
      return {
        first() {
          return {
            async waitFor({ state, timeout }) {
              asked.push({ selector, state, timeout });
              if (clearsAfter === null || clearsAfter > timeout) {
                throw new Error(`Timeout ${timeout}ms exceeded`);
              }
            },
          };
        },
      };
    },
  };
}

test("a route that declares no busy state is settled without asking the page", async () => {
  const page = pageClearing(null);

  const result = await settle(page, { name: "landing" });

  assert.equal(result, null);
  assert.deepEqual(page.asked, []);
});

test("a busy state that clears is waited for until nothing matches it", async () => {
  const page = pageClearing(300);
  const route = { name: "create-name", settles: { gone: "#hint:text-is('CHECKING')" } };

  const result = await settle(page, route, 1000);

  assert.equal(result, null);
  assert.deepEqual(page.asked, [
    { selector: "#hint:text-is('CHECKING')", state: "detached", timeout: 1000 },
  ]);
});

test("a busy state that never clears is reported, not waited past", async () => {
  const page = pageClearing(null);
  const route = { name: "create-name", settles: { gone: "#hint:text-is('CHECKING')" } };

  const result = await settle(page, route, 1000);

  assert.equal(result, "#hint:text-is('CHECKING') still matched after 1000ms");
});

test("`settles` without a selector is refused rather than read as settled", async () => {
  const page = pageClearing(0);

  const result = await settle(page, { name: "x", settles: {} });

  assert.match(result, /without a `gone` selector/);
  assert.deepEqual(page.asked, []);
});
