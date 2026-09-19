import type { Metadata } from "next";
import { Console } from "@/features/console/console";
export const metadata: Metadata = {
  title: "Research console — Pickler",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function ConsolePage() {
  return <Console />;
}
