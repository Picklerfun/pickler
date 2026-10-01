import { headers } from "next/headers";
import { PublicShell } from "@/features/agents/components/public-shell";
import { NotFoundScreen } from "@/features/status/not-found-screen";
import { StatusFrame } from "@/features/status/status-screen";
import { PRODUCT_HOSTS, productFor } from "@/server/hosts";

/**
 * On the marketplace (and a host serving both) the 404 is a marketplace page: light, in the shell,
 * with the navigation that still works. On the studio host it is the studio's night blue, with
 * only the mark, because the marketplace's navigation is not the studio's.
 */
export default async function NotFound() {
  const host = (await headers()).get("host") ?? "pickler.fun";
  if (productFor(host, PRODUCT_HOSTS) === "studio") {
    return (
      <StatusFrame foot="PICKLER · 2026 · TESTNET">
        <NotFoundScreen host={host} />
      </StatusFrame>
    );
  }
  return (
    <PublicShell>
      <NotFoundScreen host={host} />
    </PublicShell>
  );
}
