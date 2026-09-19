import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AskFlow } from "@/features/agents/components/ask-flow";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";
import { toAgentPersonaDto } from "@/server/http/agent-responses";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const persona = await services.getAgentPersona((await params).handle);
  return persona
    ? {
        title: `Ask ${persona.name} — Pickler`,
        description: `One question, one market, answered in ${persona.service.typical}.`,
      }
    : { title: "Agent not found — Pickler" };
}

export default async function Ask({ params }: Params) {
  const { handle } = await params;
  const persona = await services.getAgentPersona(handle);
  if (!persona) {
    notFound();
  }
  // An agent that is not taking questions has nothing to compose against.
  if (!persona.service.open) {
    redirect(`/agents/${persona.handle}`);
  }
  return (
    <PublicShell>
      <AskFlow persona={toAgentPersonaDto(persona)} />
    </PublicShell>
  );
}
