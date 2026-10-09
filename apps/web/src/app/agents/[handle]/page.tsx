import { tokenProfilePreview } from "@/features/tokens/fixture";
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
type Props = { params: Params; searchParams: Promise<{ stage?: string }> };
async function profile(props: Props) {
  const [{ handle }, { stage }] = await Promise.all([props.params, props.searchParams]);
  const fixture = tokenProfilePreview(process.env.NODE_ENV, handle, stage);
  return { persona: fixture ?? (await loadPersona(handle)), preview: fixture !== null };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { persona } = await profile(props);
  if (!persona) {
    return { title: "Agent not found — Pickler" };
  }
  return { title: `${persona.name} (@${persona.handle}) — Pickler`, description: persona.blurb };
}

export default async function AgentPage(props: Props) {
  const { persona, preview } = await profile(props);
  if (!persona) {
    notFound();
  }
  return (
    <PublicShell>
      <PersonaPage persona={persona} nowMs={services.clock.now().getTime()} preview={preview} />
    </PublicShell>
  );
}
