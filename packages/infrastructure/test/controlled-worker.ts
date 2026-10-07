/** Test-only boundaries shared by compiled local Worker fixtures. */
export function assertControlledDatabaseUrl(connectionString: string): void {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    !["55522", "55532"].includes(url.port) ||
    url.pathname !== "/postgres" ||
    url.search !== ""
  ) {
    throw new Error(
      "Controlled tests require the dedicated Supabase database on 127.0.0.1:55522 or 55532",
    );
  }
}

export async function assertControlledDatabase(
  pool: { query(sql: string): Promise<{ rows: { identity: string }[] }> },
  identity: string | undefined,
): Promise<void> {
  if (
    !identity ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(identity)
  ) {
    throw new Error("CONTROLLED_TEST_DATABASE_ID must identify the disposable test stack");
  }
  const marker = await pool.query(
    "SELECT identity FROM pickler_worker_test.identity WHERE singleton = true",
  );
  if (marker.rows.length !== 1 || marker.rows[0]!.identity !== identity) {
    throw new Error("Controlled test database identity does not match this test stack");
  }
}

const nativeFetch = globalThis.fetch.bind(globalThis);
const providers = new Set([
  "https://api.turnkey.com",
  "https://testnet.perpl.xyz",
  "https://app.perpl.xyz",
  "https://api.typesafe.ai",
  "https://controlled.invalid",
  "https://api.exa.ai",
]);

/** Production entry points never import or install this transport. No external request escapes. */
export function installControlledStudioTransport(
  identity: string,
  transport: typeof fetch = nativeFetch,
): void {
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (
      ["http://127.0.0.1:55521", "http://127.0.0.1:55531"].includes(url.origin) &&
      url.pathname.startsWith("/auth/v1/")
    ) {
      return noRedirect(await transport(new Request(request, { redirect: "manual" })));
    }
    if (url.origin === "http://127.0.0.1:8798" && url.pathname === "/rpc") {
      return noRedirect(await transport(new Request(request, { redirect: "manual" })));
    }
    if (!providers.has(url.origin)) {
      throw new Error("Controlled Studio transport refuses an unconfigured destination");
    }
    return noRedirect(
      await transport("http://127.0.0.1:8798/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Controlled-Identity": identity },
        body: JSON.stringify({
          url: request.url,
          method: request.method,
          body: request.method === "GET" ? null : await request.text(),
        }),
        signal: request.signal,
        redirect: "manual",
      }),
    );
  };
}

function noRedirect(response: Response): Response {
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel();
    throw new Error("Controlled transport refuses redirects");
  }
  return response;
}
