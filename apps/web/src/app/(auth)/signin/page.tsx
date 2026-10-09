import type { Metadata } from "next";
import { PasskeyFlow } from "@/features/auth/components/passkey-flow";
import { returnTo } from "@/server/guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Pickler" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // Where the guard turned them away from, if it did. `returnTo` refuses anything that is not a
  // path on this site, because `next` comes from the address bar; undefined then leaves the flow
  // on its own default, the studio.
  const asked = (await searchParams).next;
  const destination = returnTo(Array.isArray(asked) ? asked[0] : asked) ?? undefined;
  return <PasskeyFlow mode="in" destination={destination} />;
}
