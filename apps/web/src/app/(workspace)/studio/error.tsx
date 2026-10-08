"use client";
import { Button } from "@pickler/ui";
export default function StudioError({ reset }: { reset: () => void }) {
  return (
    <section role="alert" data-surface="dark">
      <h2>Could not load Studio</h2>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
