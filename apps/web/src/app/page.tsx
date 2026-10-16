import { LandingPage } from "@/features/landing/components/landing-page";
import { services } from "@/server/container";

// Public activity and canonical agent tokens are read on every request.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tokens?: string }>;
}) {
  const params = await searchParams;
  const tokenPreview = process.env.NODE_ENV !== "production" && params.tokens === "preview";
  const [actions, directory] = await Promise.all([
    tokenPreview ? Promise.resolve({ data: [] }) : services.listAgentActions(),
    tokenPreview ? Promise.resolve({ data: [], degraded: false }) : services.listTokenDirectory(),
  ]);
  return (
    <LandingPage
      actions={actions.data}
      directory={directory}
      tokenPreview={tokenPreview}
      appStoreUrl={process.env.NEXT_PUBLIC_APP_STORE_URL || null}
    />
  );
}
