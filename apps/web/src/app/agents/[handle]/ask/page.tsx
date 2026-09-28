import type { AgentPersonaDto } from "@pickler/api-schema";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AskFlow } from "@/features/agents/components/ask-flow";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

function askDescription(persona: AgentPersonaDto): string {
  if (persona.service === null) {
    return `${persona.name} is not taking questions yet.`;
  }
  return `One question, one market, answered in ${persona.service.typical}.`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const persona = await services.getAgentPersona((await params).handle);
  return persona
    ? {
        title: `Ask ${persona.name} — Pickler`,
        description: askDescription(persona),
      }
    : { title: "Agent not found — Pickler" };
}

export default async function Ask({ params }: Params) {
  const { handle } = await params;
  const persona = await services.getAgentPersona(handle);
  if (!persona) {
    notFound();
  }
  // An agent that is not taking questions — or has no read service at all — has nothing to
  // compose against.
  const service = persona.service;
  if (service === null || !service.open) {
    redirect(`/agents/${persona.handle}`);
  }
  // Dark: this page's body still composes against the old ground — panels made of white at 6%,
  // glows, a starfield behind them — and redrawing it is its own task. The shell is light for
  // everyone else.
  return (
    <PublicShell surface="dark">
      <AskFlow persona={persona} service={service} />
    </PublicShell>
  );
}
