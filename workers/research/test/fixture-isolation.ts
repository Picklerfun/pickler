import type { Pool } from "pg";

export function assertControlledDatabaseUrl(connectionString: string): void {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "55522" ||
    url.pathname !== "/postgres" ||
    url.search !== ""
  ) {
    throw new Error("Controlled tests require the dedicated Supabase database on 127.0.0.1:55522");
  }
}

export async function assertControlledDatabase(
  pool: Pick<Pool, "query">,
  identity: string | undefined,
): Promise<void> {
  if (
    !identity ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(identity)
  ) {
    throw new Error("CONTROLLED_TEST_DATABASE_ID must identify the disposable test stack");
  }
  const marker = await pool.query<{ identity: string }>(
    "SELECT identity FROM pickler_worker_test.identity WHERE singleton = true",
  );
  if (marker.rows.length !== 1 || marker.rows[0]!.identity !== identity) {
    throw new Error("Controlled test database identity does not match this test stack");
  }
}
