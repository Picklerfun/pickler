import "server-only";
import { cookies } from "next/headers";

// The apply token is a bearer secret for one waitlist seat. It lives only in an
// httpOnly cookie so it never appears in URLs, logs, referrers or client JavaScript.
const APPLY_COOKIE = "pk_apply";

export async function readApplyToken(): Promise<string | null> {
  return (await cookies()).get(APPLY_COOKIE)?.value ?? null;
}
