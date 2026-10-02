import { readMissingCopy } from "../src/screens/readCopy";

test("Read missing state asks to unlock when the reads session isn't ready (I2)", () => {
  for (const s of ["none", "signing"] as const) {
    expect(readMissingCopy(s)).toEqual({ title: "Unlock to open this read", body: "Your reads are tied to your wallet. Unlock to load it." });
  }
});

test("Read missing state is a neutral load failure with a ready session (I2)", () => {
  const c = readMissingCopy("ready");
  expect(c.title).toBe("Couldn't load this read");
  expect(c.body).toBe("Check your connection and try again.");
  expect(`${c.title} ${c.body}`).not.toMatch(/another wallet/); // ya no se acusa a una wallet ajena
});
