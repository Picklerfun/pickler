import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { AccountState } from "../src/account";
import { type IdentityApi, useIdentity } from "../src/hooks/useIdentity";
import { gateOpen } from "../src/identity/state";

// Sin PICKLER_API_URL la app no tiene cuenta: no pregunta, no guarda, no retiene. Es la garantía de que un build sin la
// variable —el del bounty— se comporta como antes.

jest.mock("../src/config/api", () => ({ API_URL: null }));
jest.mock("../src/wallet/wallet", () => ({ unlockStoredWallet: jest.fn(), describeError: () => "" }));
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const fetched = jest.fn();
const realFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = fetched as never; });
afterAll(() => { globalThis.fetch = realFetch; });

const store = jest.requireMock("expo-secure-store") as { getItemAsync: jest.Mock; setItemAsync: jest.Mock };
const { unlockStoredWallet } = jest.requireMock("../src/wallet/wallet") as { unlockStoredWallet: jest.Mock };

let latest!: IdentityApi;
function Probe({ account }: { account: AccountState }) {
  latest = useIdentity(account, () => {});
  return null;
}

test("with no API configured the account is off: nothing is asked, stored or held, whatever the wallet does", async () => {
  const sign = jest.fn(async () => "0xsig");
  const wallet = { address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf", credentialId: "cred", session: { end() {} }, account: { signMessage: sign } };
  const states: AccountState[] = [
    { status: "none" },
    { status: "locked", address: wallet.address as never, credentialId: "cred" },
    { status: "unlocked", wallet: wallet as never },
  ];
  for (const account of states) {
    act(() => { create(createElement(Probe, { account })); });
    await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
    expect(latest.identity).toEqual({ status: "off" });
    expect(gateOpen(latest.identity)).toBe(false);
  }

  await act(async () => { await latest.claim("nightowl"); });
  await act(async () => { await latest.recheck(); });
  expect(await latest.check("nightowl")).toBeNull();

  expect(latest.identity).toEqual({ status: "off" });
  expect(fetched).not.toHaveBeenCalled();
  expect(sign).not.toHaveBeenCalled();
  expect(unlockStoredWallet).not.toHaveBeenCalled();
  expect(store.getItemAsync).not.toHaveBeenCalled();
  expect(store.setItemAsync).not.toHaveBeenCalled();
});
