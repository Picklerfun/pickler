import type { ReactNode } from "react";
import type { Metadata } from "next";
import { OfflineGate } from "@/features/status/offline-gate";
import { StudioLayout } from "@/features/studio/routing/layout";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Studio — Pickler",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <OfflineGate>
      <StudioLayout>{children}</StudioLayout>
    </OfflineGate>
  );
}
