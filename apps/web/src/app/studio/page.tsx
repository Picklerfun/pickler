import type { Metadata } from "next";
import { Studio } from "@/features/studio/studio";
import { sectionFromSearch } from "@/features/studio/sections/keys";
import { stageFromSearch } from "@/features/studio/home/stage";

export const metadata: Metadata = {
  title: "Studio — Pickler",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[]; stage?: string | string[] }>;
}) {
  const search = await searchParams;
  return (
    <Studio
      openSection={sectionFromSearch(process.env.NODE_ENV, search.section)}
      stage={stageFromSearch(process.env.NODE_ENV, search.stage)}
    />
  );
}
