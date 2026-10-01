// The values code holds because it cannot read a stylesheet (packages/ui/src/tokens.ts), against
// the stylesheet. They are written down twice on purpose, and this is what makes twice safe.
import assert from "node:assert/strict";
import test from "node:test";
import { TOKEN_MIRROR } from "../../packages/ui/src/tokens.ts";
import { resolve, surface } from "./lib/tokens-file.mjs";

const spelt = (value) => String(value).toLowerCase().replace(/\s+/g, "");

test("every mirrored value is the value its token holds in styles.css", () => {
  const wrong = [];
  for (const [name, mirrored] of Object.entries(TOKEN_MIRROR)) {
    const tokens = surface(name);
    for (const [token, value] of Object.entries(mirrored)) {
      const held = resolve(tokens, token);
      if (spelt(held) !== spelt(value)) {
        wrong.push(`${token} on ${name}: tokens.ts says ${value}, styles.css says ${held}`);
      }
    }
  }

  assert.deepEqual(wrong, []);
});

test("the mirror holds something, so the test above is not passing on nothing", () => {
  assert.ok(Object.keys(TOKEN_MIRROR.light).length > 0);
});
