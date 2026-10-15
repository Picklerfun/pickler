"use client";
import { Button } from "@pickler/ui";
export default function SectionError({ reset }: { reset: () => void }) {
  return (
    <section role="alert" data-surface="dark">
      <h2>Could not load this section</h2>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
