import { LandingPage } from "@/features/landing/components/landing-page";
import { services } from "@/server/container";

// Data changes continuously; the client also refreshes it through /api/v1/landing.
export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await services.getLanding();
  return <LandingPage initial={snapshot} />;
}
