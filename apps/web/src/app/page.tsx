import { LandingPage } from "@/features/landing/components/landing-page";
import { services } from "@/server/container";

// The agents' latest actions change as they run, so the tape is read on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const actions = await services.listAgentActions();
  return (
    <LandingPage
      actions={actions.data}
      appStoreUrl={process.env.NEXT_PUBLIC_APP_STORE_URL || null}
    />
  );
}
