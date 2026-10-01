"use client";

import { ErrorScreen } from "@/features/status/error-screen";
import { StatusFrame } from "@/features/status/status-screen";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusFrame foot="IF IT KEEPS HAPPENING, SEND US THE CODE ABOVE">
      <ErrorScreen digest={error.digest} reset={reset} />
    </StatusFrame>
  );
}
