import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { validAgentSegment } from "@/features/studio/routing/routes";
export default async function AgentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ agentId: string }>;
}) {
  if (!validAgentSegment((await params).agentId)) {
    notFound();
  }
  return children;
}
