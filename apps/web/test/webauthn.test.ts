import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base64urlToBuffer,
  bufferToBase64url,
  normalizeTransports,
} from "../src/features/auth/lib/webauthn";

const bytesOf = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer));
const bufferOf = (bytes: number[]) => new Uint8Array(bytes).buffer;

/**
 * 0xfb 0xff 0xfe is the smallest input whose standard base64 is "+//+": it exercises alphabet
 * indices 62 and 63, the two characters base64url renames, in one three-byte group.
 */
const PLUS_AND_SLASH = [0xfb, 0xff, 0xfe];

test("base64url survives every byte value at every position in the padding cycle", () => {
  for (let value = 0; value < 256; value++) {
    // Lengths 1, 2 and 3 cover all three residues of the three-byte group, so a byte is checked
    // as the first, middle and final member of a group, and with two, one and no padding chars.
    for (const bytes of [[value], [value, 0xff], [0x00, value, 0xff], [0xff, 0x00, value]]) {
      const encoded = bufferToBase64url(bufferOf(bytes));
      assert.deepEqual(
        bytesOf(base64urlToBuffer(encoded)),
        bytes,
        `round trip lost ${JSON.stringify(bytes)} via ${encoded}`,
      );
    }
  }
});

test("round trips buffers of every length from empty to past one three-byte group", () => {
  for (let length = 0; length <= 64; length++) {
    // A deterministic spread rather than a constant fill: a repeated byte hides an encoder that
    // reorders within a group.
    const bytes = Array.from({ length }, (_, i) => (i * 37 + length * 101) % 256);
    assert.deepEqual(bytesOf(base64urlToBuffer(bufferToBase64url(bufferOf(bytes)))), bytes);
  }
});

test("the encoded form is url safe: no plus, slash or padding, for any input", () => {
  for (let length = 0; length <= 64; length++) {
    const bytes = Array.from({ length }, (_, i) => (i * 37 + length * 101) % 256);
    const encoded = bufferToBase64url(bufferOf(bytes));
    assert.equal(/[+/=]/.test(encoded), false, `${encoded} is not url safe`);
  }
  // Named explicitly so a silent loss of the +/- and //_ substitutions cannot pass by chance.
  assert.equal(bufferToBase64url(bufferOf(PLUS_AND_SLASH)), "-__-");
});

test("decoding restores the padding the encoder stripped", () => {
  // Two bytes encode to three characters plus one '=', one byte to two characters plus '=='.
  assert.equal(bufferToBase64url(bufferOf([0xfb, 0xff])), "-_8");
  assert.equal(bufferToBase64url(bufferOf([0xfb])), "-w");
  assert.deepEqual(bytesOf(base64urlToBuffer("-_8")), [0xfb, 0xff]);
  assert.deepEqual(bytesOf(base64urlToBuffer("-w")), [0xfb]);
  // The server's validator allows padding through, so a padded value must decode the same way.
  assert.deepEqual(bytesOf(base64urlToBuffer("-_8=")), [0xfb, 0xff]);
  assert.deepEqual(bytesOf(base64urlToBuffer("-w==")), [0xfb]);
});

test("an empty buffer encodes to an empty string and back", () => {
  assert.equal(bufferToBase64url(bufferOf([])), "");
  assert.deepEqual(bytesOf(base64urlToBuffer("")), []);
});

test("absent or empty transports become internal, and reported ones are lower cased", () => {
  assert.deepEqual(normalizeTransports(undefined), ["internal"]);
  assert.deepEqual(normalizeTransports([]), ["internal"]);
  assert.deepEqual(normalizeTransports(["internal"]), ["internal"]);
  assert.deepEqual(normalizeTransports(["HYBRID", "Usb"]), ["hybrid", "usb"]);
  assert.deepEqual(normalizeTransports(["ble", "nfc"]), ["ble", "nfc"]);
});
