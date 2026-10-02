import { createProfile, describeIdentityError, fetchChallenge, fetchProfile, handleAvailable, IdentityError, isHandleRefusal, presentSignature, type DoFetch } from "../src/identity/api";

const BASE = "https://pickler.fun/api/v1";

/** Un fetch que responde lo que se le dice y anota lo que se le pidió. */
function server(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const doFetch: DoFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  };
  return { calls, doFetch };
}

test("the challenge is the server's message, asked for this address and chain", async () => {
  const { calls, doFetch } = server(200, { data: { nonce: "n1", message: "pickler.fun wants you to sign in…" } });
  expect(await fetchChallenge(BASE, "0xAbC", 10143, doFetch)).toBe("pickler.fun wants you to sign in…");
  expect(calls[0]!.url).toBe(`${BASE}/auth/wallet/nonce`);
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ address: "0xAbC", chain_id: 10143 });
});

test("the signature is presented with the string unchanged, as a passkey wallet", async () => {
  const { calls, doFetch } = server(200, { data: { userId: "u1", session: { accessToken: "at", refreshToken: "rt" } } });
  expect(await presentSignature(BASE, "the message\n", "0xsig", doFetch)).toEqual({ userId: "u1", token: "at" });
  expect(calls[0]!.url).toBe(`${BASE}/auth/wallet/verify`);
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ raw: "the message\n", signature: "0xsig", kind: "mera" });
});

test("a refusal carries the API's code, and a body without the data is not an answer", async () => {
  await expect(fetchChallenge(BASE, "0xA", 10143, server(400, { error: "invalid_address", message: "no" }).doFetch)).rejects.toMatchObject({ status: 400, code: "invalid_address" });
  await expect(presentSignature(BASE, "m", "0xsig", server(401, { message: "bad signature" }).doFetch)).rejects.toMatchObject({ status: 401, code: "401" });
  await expect(presentSignature(BASE, "m", "0xsig", server(200, { data: {} }).doFetch)).rejects.toBeInstanceOf(IdentityError);
  await expect(fetchChallenge(BASE, "0xA", 10143, server(200, {}).doFetch)).rejects.toBeInstanceOf(IdentityError);
});

test("a profile is its username, no profile is null, and not knowing is neither", async () => {
  const has = server(200, { data: { handle: "nightowl", display_name: "nightowl" } });
  expect(await fetchProfile(BASE, "at", has.doFetch)).toEqual({ handle: "nightowl" });
  expect((has.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer at");
  expect(await fetchProfile(BASE, "at", server(404, { message: "Profile not found" }).doFetch)).toBeNull();
  // Un 500 o una red caída no es «sin username»: se lanza, y nadie queda retenido por ello.
  await expect(fetchProfile(BASE, "at", server(500, {}).doFetch)).rejects.toMatchObject({ status: 500 });
  await expect(fetchProfile(BASE, "at", async () => { throw new TypeError("Network request failed"); })).rejects.toMatchObject({ status: 0, code: "network" });
});

test("claiming posts the handle as the display name too, with the session", async () => {
  const { calls, doFetch } = server(201, { data: { handle: "nightowl" } });
  expect(await createProfile(BASE, "at", "nightowl", doFetch)).toEqual({ handle: "nightowl" });
  expect(calls[0]!.init.method).toBe("POST");
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ handle: "nightowl", display_name: "nightowl" });
  expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer at");
});

test("availability is yes, no, or not known — never 'taken' because a lookup failed", async () => {
  expect(await handleAvailable(BASE, "nightowl", server(200, { data: { available: true } }).doFetch)).toBe(true);
  expect(await handleAvailable(BASE, "nightowl", server(200, { data: { available: false } }).doFetch)).toBe(false);
  expect(await handleAvailable(BASE, "nightowl", server(500, {}).doFetch)).toBeNull();
  expect(await handleAvailable(BASE, "nightowl", async () => { throw new TypeError("offline"); })).toBeNull();
});

test("errors are said in words", () => {
  expect(describeIdentityError(new IdentityError(0, "network"))).toMatch(/Couldn't reach Pickler/);
  expect(describeIdentityError(new IdentityError(400, "nonce_invalid"))).toMatch(/took too long/);
  expect(describeIdentityError(new IdentityError(409, "409", "That handle is taken"))).toBe("That handle is taken");
});

test("a route that does not exist is not an account without a username", async () => {
  // La API mal desplegada responde 404 a todo; eso no puede abrir la pantalla obligatoria.
  await expect(fetchProfile(BASE, "at", server(404, { success: false, message: "Route not found" }).doFetch)).rejects.toMatchObject({ status: 404 });
});

test("only a refusal of the username itself is the person's to fix", () => {
  expect(isHandleRefusal(new IdentityError(409, "handle_taken"))).toBe(true);
  expect(isHandleRefusal(new IdentityError(400, "invalid_profile"))).toBe(true);
  // `wallet_required` (una cuenta de estudio sin su wallet) es un 409 que ningún username arregla: suelta la pantalla.
  for (const other of [new IdentityError(0, "network"), new IdentityError(0, "timeout"), new IdentityError(401, "401"), new IdentityError(409, "wallet_required"), new IdentityError(409, "409"), new IdentityError(500, "500"), new IdentityError(502, "502"), new Error("boom")]) {
    expect(isHandleRefusal(other)).toBe(false);
  }
});

test("an error with no body still reads as a sentence", () => {
  expect(describeIdentityError(new IdentityError(502, "502"))).toBe("Pickler answered 502.");
  expect(describeIdentityError(new IdentityError(400, "invalid_profile", "Invalid handle: reserved"))).toBe("That username is not allowed. Try another.");
});
