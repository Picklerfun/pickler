"use client";

import "@pickler/ui/styles.css";
import "./globals.css";
import { ErrorScreen } from "@/features/status/error-screen";
import { StatusFrame } from "@/features/status/status-screen";

/**
 * The root layout itself failed, so this replaces it: its own document, no product provider, no
 * wallet. "Back" is `/`, which is a real page on both products.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <StatusFrame foot="IF IT KEEPS HAPPENING, SEND US THE CODE ABOVE">
          <ErrorScreen digest={error.digest} reset={reset} home="/" />
        </StatusFrame>
      </body>
    </html>
  );
}
