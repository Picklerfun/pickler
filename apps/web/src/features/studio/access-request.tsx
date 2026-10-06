"use client";

import { useEffect, useState } from "react";
import { Button, Icon } from "@pickler/ui";
import type {
  StudioAccessRequestStatusDto,
  StudioAccessRequestsInboxDto,
} from "@pickler/api-schema";
import { studioApi } from "./api";
import styles from "./access-request.module.css";

/** Creator requests and a server-authorized team inbox; never a grant or a passkey ceremony. */
export function StudioAccessRequest({ preview = false }: { preview?: boolean }) {
  const [state, setState] = useState<StudioAccessRequestStatusDto | null>(null);
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
        if (result.canReviewRequests) {
          const entries = await studioApi<StudioAccessRequestsInboxDto>("/access-requests");
          if (active) {
            setInbox(entries);
          }
        }
      })
      .catch(() => {
        if (active) {
          setError("Access status could not be loaded. You can try again by requesting access.");
        }
      });
    return () => {
      active = false;
    };
  }, [preview]);

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
    <section className={styles.notice} aria-label="Creator access" id="creator-access-panel">
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
            ? "Your request is saved in the Pickler team's inbox. You can return here to check its status. Agent and wallet creation stay locked until approval."
            : "Your account does not yet have permission to create agents or their wallets. Request access from the Pickler team to continue."}
      </p>
      {!enabled && (
        <Button
          variant="primary"
          onClick={() => void request()}
          disabled={preview || busy || pending}
        >
          {busy ? "Sending request…" : pending ? "Request sent" : "Request access"}
        </Button>
      )}
      {(pending || enabled) && !preview && (
        <Button onClick={() => window.location.reload()}>Check access again</Button>
      )}
      {preview && <p>This is a design preview. No access request will be sent.</p>}
      {error && <p role="alert">{error}</p>}
      {pending && (
        <p role="status">Your request was recorded. It does not enable access automatically.</p>
      )}
      {inbox && (
        <div className={styles.inbox}>
          <h3>Team inbox · {inbox.requests.length} pending</h3>
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
    </section>
  );
}
