import { LandingPage } from "@/features/landing/components/landing-page";

// Copy and illustrations only: the landing reads no API (docs/specs/marketplace-real-only-v1.md N4).
export default function Home() {
  return <LandingPage appStoreUrl={process.env.NEXT_PUBLIC_APP_STORE_URL || null} />;
}
