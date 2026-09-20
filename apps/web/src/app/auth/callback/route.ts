import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/** Authentication callback only; product provisioning belongs to the business API. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!code || !supabaseUrl || !key) {
    return NextResponse.redirect(new URL("/signin", url.origin));
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
  const { error } = await client.auth.exchangeCodeForSession(code);
  const response = NextResponse.redirect(new URL(error ? "/signin" : "/console", url.origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
