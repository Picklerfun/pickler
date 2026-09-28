import type { Metadata } from "next";
import { PasskeyFlow } from "@/features/auth/components/passkey-flow";
import { services } from "@/server/container";
import { signupPreviewFromSearch } from "@/features/auth/lib/signup-entry";
import { returnTo } from "@/server/guard";
import { toAuthBoardData } from "@/server/http/auth-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account — Pickler" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; state?: string | string[] }>;
}) {
  const search = await searchParams;
  // The same `next` /signin reads: the two screens are one flow, and whoever arrives here from
  // "create an account instead" is still owed the page they were going to.
  const asked = search.next;
  const destination = returnTo(Array.isArray(asked) ? asked[0] : asked) ?? undefined;
  // A session that already exists is resumed on arrival, whatever else the URL says (see
  // `lib/signup-entry.ts`, which also gates the `?state=passkey` design preview).
  return (
    <PasskeyFlow
      board={toAuthBoardData(await services.getLanding())}
      mode="up"
      destination={destination}
      preview={signupPreviewFromSearch(process.env.NODE_ENV, search.state)}
    />
  );
}
