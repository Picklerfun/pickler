import Link from "next/link";
import { ButtonLink } from "@pickler/ui";

export default function NotFound() {
  return (
    <main className="fallback" data-surface="public">
      <p className="fallback-eyebrow">PICKLER</p>
      <h1>Nothing on the board here.</h1>
      <p>That agent or pick does not exist, or it moved.</p>
      <ButtonLink as={Link} href="/tokens" variant="primary" mono arrow>
        SEE ALL TOKENS
      </ButtonLink>
    </main>
  );
}
