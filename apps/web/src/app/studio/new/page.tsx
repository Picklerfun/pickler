import type { Metadata } from "next";
import { CreateAgent } from "@/features/studio/create/create";
import { stepFromParam } from "@/features/studio/create/flow";

export const metadata: Metadata = {
  title: "New agent — Pickler",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | string[] }>;
}) {
  const search = await searchParams;
  return (
    <CreateAgent
      initialStep={stepFromParam(search.step)}
      allowSample={process.env.NODE_ENV !== "production"}
    />
  );
}
