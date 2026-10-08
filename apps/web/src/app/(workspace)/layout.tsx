import type { ReactNode } from "react";
import { StudioMemoryProvider } from "@/features/studio/routing/memory";
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <StudioMemoryProvider>{children}</StudioMemoryProvider>;
}
