"use client";

import { useEffect, useState } from "react";
import { Button, Icon, Tag } from "@pickler/ui";
import type {
  StudioAccessRequestStatusDto,
  StudioAccessRequestsInboxDto,
} from "@pickler/api-schema";
import { studioApi } from "./api";
import { StudioSkeleton } from "./skeleton";
import styles from "./access-request.module.css";

/** Creator requests and a server-authorized team inbox; never a grant or a passkey ceremony. */
export function StudioAccessRequest({
  preview = false,
  placement = "account",
  previewStatus = "not_requested",
  previewLoading = false,
}: {
  preview?: boolean;
  placement?: "account" | "wallet";
  previewStatus?: StudioAccessRequestStatusDto["status"];
  /** Inert, non-production fixture only; never changes real access. */
  previewLoading?: boolean;
}) {
  const [state, setState] = useState<StudioAccessRequestStatusDto | null>(
    preview ? { status: previewStatus, requestedAt: null, canReviewRequests: false } : null,
  );
  const [loading, setLoading] = useState(!preview || previewLoading);
  const [inbox, setInbox] = useState<StudioAccessRequestsInboxDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (preview) {
      return;
    }
    let active = true;
    void studioApi<StudioAccessRequestStatusDto>("/access-request")
      .then(async (result) => {
        if (!active) {
          return;
        }
        setState(result);
        if (result.canReviewRequests && placement === "account") {
          const entries = await studioApi<StudioAccessRequestsInboxDto>("/access-requests");
          if (active) {
            setInbox(entries);
          }
        }
      })
      .catch(() => {
        if (active) {
          setError("Access status could not be loaded. Please try again.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [preview, placement]);

  async function request() {
    if (preview || busy || state?.status === "pending" || state?.status === "enabled") {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await studioApi<StudioAccessRequestStatusDto>("/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setState({ ...result, canReviewRequests: state?.canReviewRequests ?? false });
    } catch {
      setError("Your request could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const pending = state?.status === "pending";
  const enabled = state?.status === "enabled";
  return (
    <section
      className={styles.notice}
      data-placement={placement}
      aria-label="Creator access"
      id="creator-access-panel"
    >
      {loading || busy ? (
        <StudioSkeleton variant="access" />
      ) : !state ? (
        <>
          <p role="alert">{error}</p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </>
      ) : (
        <>
          <div className={styles.heading}>
            <Icon name={enabled ? "check" : "alert"} size={18} />
            <h2>
              {enabled
                ? "Creator access enabled"
                : pending
                  ? "Access request pending"
                  : "Creator access required"}
            </h2>
          </div>
          <p>
            {enabled
              ? "You can create agents in your own workspace. Wallet and funding requirements still apply."
              : pending
                ? "Your request is saved for the Pickler team. You can create its wallet after approval."
                : "Request creator access before creating its wallet. You can keep setting up your agent while you wait."}
          </p>
          {pending ? (
            <Tag data-tint="amber">Request sent</Tag>
          ) : !enabled ? (
            <Button variant="primary" onClick={() => void request()} disabled={preview}>
              Request access
            </Button>
          ) : null}
          {(pending || enabled) && (
            <Button variant="secondary" disabled={preview} onClick={() => window.location.reload()}>
              Check access
            </Button>
          )}
          {error && <p role="alert">{error}</p>}
          {inbox && (
            <div className={styles.inbox}>
              <h3>Team inbox · {inbox.requests.length} pending shown</h3>
              {inbox.requests.length === 0 && <p>No pending access requests.</p>}
              <ul>
                {inbox.requests.map((entry) => (
                  <li key={entry.userId}>
                    <strong>
                      {entry.displayName} · @{entry.handle}
                    </strong>
                    <span>{new Date(entry.requestedAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <p>Review these requests using the existing operator approval process.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
