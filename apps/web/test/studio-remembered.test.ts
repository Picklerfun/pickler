import assert from "node:assert/strict";
import { test } from "node:test";
import { remembered } from "../src/features/studio/lib/remembered";

/* The relying party: read from a custody challenge once, because every read stores a challenge. */

test("a value that was read is not read again", async () => {
  let reads = 0;
  const rp = remembered(async () => {
    reads += 1;
    return "app.pickler.fun";
  });

  assert.equal(await rp(), "app.pickler.fun");
  assert.equal(await rp(), "app.pickler.fun");
  assert.equal(await rp(), "app.pickler.fun");
  assert.equal(reads, 1);
});

test("asking again while the first read is under way does not start a second", async () => {
  let reads = 0;
  let answer!: (value: string) => void;
  const rp = remembered(() => {
    reads += 1;
    return new Promise<string>((resolve) => {
      answer = resolve;
    });
  });

  const both = Promise.all([rp(), rp()]);
  answer("app.pickler.fun");
  assert.deepEqual(await both, ["app.pickler.fun", "app.pickler.fun"]);
  assert.equal(reads, 1);
});

test("a read that failed is not remembered: the next one tries again", async () => {
  let reads = 0;
  const rp = remembered(async () => {
    reads += 1;
    if (reads === 1) {
      throw new Error("offline");
    }
    return "app.pickler.fun";
  });

  await assert.rejects(rp(), /offline/);
  assert.equal(await rp(), "app.pickler.fun");
  assert.equal(await rp(), "app.pickler.fun");
  assert.equal(reads, 2);
});

test("a failure reaches everyone who was waiting on that read", async () => {
  let fail!: (reason: Error) => void;
  const rp = remembered(
    () =>
      new Promise<string>((_resolve, reject) => {
        fail = reject;
      }),
  );

  const first = rp();
  const second = rp();
  fail(new Error("offline"));
  await assert.rejects(first, /offline/);
  await assert.rejects(second, /offline/);
});
