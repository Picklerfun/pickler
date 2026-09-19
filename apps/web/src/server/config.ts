import "server-only";

export type DataSource = { kind: "sample" } | { kind: "supabase"; url: string; secretKey: string };

/**
 * PICKLER_DATA_SOURCE=supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY.
 * Anything else serves labelled sample data.
 */
export function readDataSource(env: Record<string, string | undefined> = process.env): DataSource {
  if (env.PICKLER_DATA_SOURCE !== "supabase") {
    return { kind: "sample" };
  }
  const url = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("PICKLER_DATA_SOURCE=supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY");
  }
  return { kind: "supabase", url, secretKey };
}
