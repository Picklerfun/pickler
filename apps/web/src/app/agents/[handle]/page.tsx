import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PersonaPage } from "@/features/agents/components/persona-page";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

// Shared by generateMetadata and the page within one request.
const loadPersona = cache((handle: string) => services.getAgentPersona(handle));

type Params = Promise<{ handle: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const persona = await loadPersona((await params).handle);
  if (!persona) {
    return { title: "Agent not found — Pickler" };
  }
  return { title: `${persona.name} (@${persona.handle}) — Pickler`, description: persona.blurb };
}

export default async function AgentPage({ params }: { params: Params }) {
  const persona = await loadPersona((await params).handle);
  if (!persona) {
    notFound();
  }
  return (
    <PublicShell>
      <PersonaPage persona={persona} nowMs={services.clock.now().getTime()} />
    </PublicShell>
  );
}
