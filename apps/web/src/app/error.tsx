"use client";

import { Button } from "@pickler/ui";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="fallback" data-surface="public">
      <p className="fallback-eyebrow">PICKLER</p>
      <h1>We could not load the board.</h1>
      <p>The data source did not answer. Try again in a moment.</p>
      <Button variant="primary" mono onClick={reset}>
        TRY AGAIN
      </Button>
    </main>
  );
}
