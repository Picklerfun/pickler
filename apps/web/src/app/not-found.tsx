import { headers } from "next/headers";
import { NotFoundScreen } from "@/features/status/not-found-screen";
import { StatusFrame } from "@/features/status/status-screen";

export default async function NotFound() {
  const host = (await headers()).get("host") ?? "pickler.fun";
  return (
    <StatusFrame foot="PICKLER · 2026 · TESTNET">
      <NotFoundScreen host={host} />
    </StatusFrame>
  );
}
