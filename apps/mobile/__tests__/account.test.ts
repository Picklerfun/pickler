import { accountAddress, type AccountState } from "../src/account";

const address = "0x2222222222222222222222222222222222222222" as const;

test("none has no address", () => {
  expect(accountAddress({ status: "none" })).toBeNull();
});

test("locked exposes stored address", () => {
  const s: AccountState = { status: "locked", address, credentialId: "c" };
  expect(accountAddress(s)).toBe(address);
});

test("unlocked exposes wallet address", () => {
  const s: AccountState = {
    status: "unlocked",
    wallet: { address, credentialId: "c", session: { end() {} } } as never,
  };
  expect(accountAddress(s)).toBe(address);
});
