import { prfUnavailableMessage } from "../src/wallet/prfMessage";

describe("prfUnavailableMessage", () => {
  it("mentions iOS 18 when the device is on an older major version", () => {
    expect(prfUnavailableMessage(17)).toContain("iOS 18");
  });

  it("does not mention iOS 18 when the device is already on 18", () => {
    expect(prfUnavailableMessage(18)).not.toContain("iOS 18");
  });

  it("does not mention iOS 18 when the device is on a newer major version", () => {
    expect(prfUnavailableMessage(26)).not.toContain("iOS 18");
  });

  it("does not mention iOS 18 when the major version is unknown", () => {
    expect(prfUnavailableMessage(undefined)).not.toContain("iOS 18");
  });
});
