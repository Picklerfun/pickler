import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deviceTypeFromTransports,
  toTurnkeyTransports,
} from "../src/features/wallets/domain/passkey.js";

test("an empty transport list means the authenticator is built into the device", () => {
  assert.deepEqual(toTurnkeyTransports([]), ["AUTHENTICATOR_TRANSPORT_INTERNAL"]);
  assert.deepEqual(toTurnkeyTransports(undefined), ["AUTHENTICATOR_TRANSPORT_INTERNAL"]);
});

test("transports are upper-cased into Turnkey's enum", () => {
  assert.deepEqual(toTurnkeyTransports(["usb", "nfc"]), [
    "AUTHENTICATOR_TRANSPORT_USB",
    "AUTHENTICATOR_TRANSPORT_NFC",
  ]);
});

test("hybrid transport names a passkey that lives on another device", () => {
  assert.equal(deviceTypeFromTransports(["hybrid"]), "cross_device");
  assert.equal(deviceTypeFromTransports(["internal"]), "platform");
  assert.equal(deviceTypeFromTransports(["usb"]), "security_key");
  assert.equal(deviceTypeFromTransports([]), "platform");
});
