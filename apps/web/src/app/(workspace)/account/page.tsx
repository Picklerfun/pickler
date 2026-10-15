import type { Metadata } from "next";
import { Account } from "@/features/account/account";
import { openingSection } from "@/features/account/lib/sections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account — Pickler",
  description: "Your wallet, your passkeys and what the board sees.",
  robots: { index: false, follow: false },
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[]; returnTo?: string | string[] }>;
}) {
  const search = await searchParams;
  /**
   * Which section opens. The three sit behind a rail, so two of them are unreachable to anything
   * that only opens `/account` — and a check that measures the wallet and reports on the screen has
   * measured a third of it. `?section=` puts one on screen, outside production only, the way the
   * studio reaches its empty state with `?state=empty`. The profile link is a real product link
   * and works in production as well.
   */
  const asked = Array.isArray(search.section) ? search.section[0] : search.section;
  const opening = openingSection(process.env.NODE_ENV, asked);
  return (
    <Account
      opening={opening}
      returnTo={Array.isArray(search.returnTo) ? search.returnTo[0] : search.returnTo}
    />
  );
}
