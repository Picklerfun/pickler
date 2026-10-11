import { LandingPage } from "@/features/landing/components/landing-page";
import { services } from "@/server/container";

// Public activity and canonical agent tokens are read on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [actions, directory] = await Promise.all([
    services.listAgentActions(),
    services.listDirectory(),
  ]);
  return (
    <LandingPage
      actions={actions.data}
      directory={directory}
      appStoreUrl={process.env.NEXT_PUBLIC_APP_STORE_URL || null}
    />
  );
}
