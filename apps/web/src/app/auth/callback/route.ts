import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callbackDestination, readOf, type Read } from "@/features/auth/lib/callback";
import { apiFetch } from "@/server/api-client";
import { PRODUCT_HOSTS, productFor, studioHref } from "@/server/hosts";

/** Authentication callback only; product provisioning belongs to the business API. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const product = productFor(request.headers.get("host"), PRODUCT_HOSTS);
  // Every redirect from here lands on the studio, which is where the session cookie below is set.
  // The middleware already sends a marketplace callback to the studio before it gets here, so this
  // is the request's own origin in practice; it is spelled out so no redirect can leave the studio.
  const origin = product === "marketplace" ? `https://${PRODUCT_HOSTS.studio}` : url.origin;
  const code = url.searchParams.get("code");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!code || !supabaseUrl || !key) {
    return noStore(NextResponse.redirect(new URL("/signin", origin)));
  }
  const jar = await cookies();
  const client = createServerClient(supabaseUrl, key, {
    cookieOptions: { secure: url.protocol === "https:" },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values) {
          jar.set(name, value, options);
        }
      },
    },
  });
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return noStore(NextResponse.redirect(new URL("/signin", origin)));
  }
  // Validated here, before the one redirect: the account's profile and master wallet decide the
  // destination, so nobody is sent to the studio only to be bounced back to the signup.
  const token = data.session.access_token;
  const [profile, wallet] = await Promise.all([
    readAccount("/v1/profile", token),
    readAccount("/v1/signing/wallets/me", token),
  ]);
  const studio = studioHref(product, PRODUCT_HOSTS);
  const destination = callbackDestination({ profile, wallet }, studio);
  return noStore(NextResponse.redirect(new URL(destination, origin)));
}

/** One account read on the server. A thrown transport error is a failed read, never a 404. */
async function readAccount(path: string, token: string): Promise<Read> {
  try {
    const response = await apiFetch(
      new Request(`https://pickler.internal${path}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    return readOf(response.status);
  } catch {
    return "failed";
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
