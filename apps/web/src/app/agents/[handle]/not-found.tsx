import { PublicShell } from "@/features/agents/components/public-shell";
import { AgentNotFound } from "@/features/status/agent-not-found";
import { services } from "@/server/container";

// Close matches come from the directory the /agents page reads; if it is behind, there are none.
export default async function AgentNotFoundPage() {
  const { data: agents } = await services.listDirectory();
  return (
    <PublicShell>
      <AgentNotFound agents={agents} />
    </PublicShell>
  );
}
