// ADVICE_SPLITTER_ADDRESS reaches the app as extra.adviceSplitter (app.config.ts), like PICKLER_API_URL.
const SPLITTER = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

function load(adviceSplitter: unknown, apiUrl: string | null) {
  let mod!: typeof import("../src/config/advice");
  jest.isolateModules(() => {
    jest.doMock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { adviceSplitter } } } }));
    jest.doMock("../src/config/api", () => ({ API_URL: apiUrl }));
    mod = require("../src/config/advice");
  });
  return mod;
}

test("a valid splitter address is pinned as given", () => {
  expect(load(SPLITTER, "https://pickler.fun/api/v1").ADVICE_SPLITTER).toBe(SPLITTER);
  expect(load(` ${SPLITTER.toLowerCase()} `, null).ADVICE_SPLITTER).toBe(SPLITTER.toLowerCase());
});

test.each([
  ["unset", undefined],
  ["empty", ""],
  ["too short", "0x1234"],
  ["not hex", "0x5FbDB2315678afecb367f032d93F642f64180aaZ"],
  ["without 0x", SPLITTER.slice(2)],
  ["a bad checksum", "0x5FbDB2315678afecb367f032d93F642f64180aA3"],
  ["not a string", 42],
])("the splitter is null when %s", (_, raw) => {
  expect(load(raw, "https://pickler.fun/api/v1").ADVICE_SPLITTER).toBeNull();
});

test("Studio agents are on only with both the API and the splitter", () => {
  expect(load(SPLITTER, "https://pickler.fun/api/v1").studioAgentsEnabled()).toBe(true);
  expect(load(SPLITTER, null).studioAgentsEnabled()).toBe(false);
  expect(load("", "https://pickler.fun/api/v1").studioAgentsEnabled()).toBe(false);
  expect(load("", null).studioAgentsEnabled()).toBe(false);
});
