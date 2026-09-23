import type { Metadata } from "next";
import { Console } from "@/features/console/console";
import { sectionFromSearch } from "@/features/console/sections/keys";

export const metadata: Metadata = {
  title: "Studio — Pickler",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const search = await searchParams;
  return <Console openSection={sectionFromSearch(process.env.NODE_ENV, search.section)} />;
}
