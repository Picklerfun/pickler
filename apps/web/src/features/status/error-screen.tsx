"use client";

import { Button, ButtonLink, Icon } from "@pickler/ui";
import { useEffect, useState } from "react";
import { useMarketplaceHref } from "@/features/site/studio-href";
import { StatusActions, StatusScreen } from "./status-screen";
import styles from "./status.module.css";
import { errorCode } from "./words";

/** 1c. The page failed to load. Its error does not establish transaction or agent status. */
export function ErrorScreen({
  digest,
  reset,
  home,
}: {
  digest: string | undefined;
  reset: () => void;
  /** Where "back" goes; the root error boundary has no product shell to say. */
  home?: string;
}) {
  // The moment of failure. Rendered on the server too when the failure happened there, so the
  // client's clock may differ by a second: the span says so to React instead of re-rendering.
  const [at] = useState(() => new Date());
  const code = errorCode(digest, at);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const markets = useMarketplaceHref("/markets");

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  function copy() {
    navigator.clipboard?.writeText(code).then(
      () => setCopied(true),
      () => {},
    );
  }

  function retry() {
    setRetrying(true);
    reset();
    // `reset` re-renders the segment; if it fails again this screen is back and can be pressed.
    setTimeout(() => setRetrying(false), 1400);
  }

  return (
    <StatusScreen
      id="server-error"
      tone="loss"
      eyebrow="500 · OUR SIDE"
      title="WE BROKE"
      body="We could not load this page. Try again to refresh its data. If you submitted a transaction, check its status before submitting it again."
    >
      <div className={styles.row}>
        <span className={styles.code} suppressHydrationWarning>
          {code}
        </span>
        <button type="button" className={styles.copyButton} onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={13} />
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <StatusActions>
        <Button variant="primary" onClick={retry} disabled={retrying}>
          {retrying && <span className={styles.pulse} aria-hidden="true" />}
          {retrying ? "Trying" : "Try again"}
        </Button>
        <ButtonLink href={home ?? markets}>
          {home ? "Back to the start" : "Back to Markets"}
        </ButtonLink>
      </StatusActions>
    </StatusScreen>
  );
}
