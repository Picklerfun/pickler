import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/features/agents/components/public-shell";
import { ReadCard } from "@/features/agents/components/read-card";
import { services } from "@/server/container";
import { toAgentReadDto } from "@/server/http/agent-responses";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const read = await services.getRead((await params).id);
  return read
    ? { title: `${read.market} · ${read.agent.name} — Pickler`, description: read.market }
    : { title: "Read not found — Pickler" };
}

export default async function Read({ params }: Params) {
  const read = await services.getRead((await params).id);
  if (!read) {
    notFound();
  }
  return (
    <PublicShell>
      <ReadCard read={toAgentReadDto(read)} />
    </PublicShell>
  );
}
