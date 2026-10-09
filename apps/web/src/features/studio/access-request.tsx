"use client";

import { useEffect, useState } from "react";
import { Button, Icon, Tag } from "@pickler/ui";
import type { StudioAccessRequestStatusDto } from "@pickler/api-schema";
import { useMarketplaceHref } from "../site/studio-href";
import { studioApi } from "./api";
import { StudioSkeleton } from "./skeleton";
import { ApplicationsInbox } from "./applications-inbox";
import styles from "./access-request.module.css";

type Application = StudioAccessRequestStatusDto["application"];

/** What the notice says for an account without access, by where its application stands. */
export function accessNotice(application: Application): {
  title: string;
  body: string;
  tag: string | null;
  tint: "amber" | "lime" | "magenta" | null;
  apply: boolean;
} {
  switch (application) {
    case "submitted":
      return {
        title: "Not approved yet",
        body: "Your application is with the Pickler team. Creators come in a few at a time, and the invite lands by email.",
        tag: "In review",
        tint: "amber",
        apply: false,
      };
    case "invited":
      return {
        title: "You are in",
        body: "Your application was accepted. Access turns on with your account; if this still shows, check again in a moment.",
        tag: "Invited",
        tint: "lime",
        apply: false,
      };
    case "rejected":
      return {
        title: "Not this time",
        body: "Your application was not accepted for this batch. You can apply again with another agent.",
        tag: "Not accepted",
        tint: "magenta",
        apply: true,
      };
    default:
      return {
        title: "Not approved yet",
        body: "There is no application under this account's email. Creators come in a few at a time; apply first, and the invite lands by email.",
        tag: null,
        tint: null,
        apply: true,
      };
  }
}

/**
 * Creator access, as the studio tells it. Since docs/specs/landing-trade-v1.md §7 the way in is the
 * application at /apply, read by the team: a signed-in person without access is told where their
 * application stands (in review, invited, not accepted, or none under this email) rather than
 * offered a request button, and a super admin gets the applications inbox under this notice.
 * Never a grant or a passkey ceremony.
 */
export function StudioAccessRequest({
  preview = false,
  placement = "account",
  previewStatus = "not_requested",
  previewApplication = "submitted",
  previewLoading = false,
  previewReviewer = false,
}: {
  preview?: boolean;
  placement?: "account" | "wallet";
  previewStatus?: StudioAccessRequestStatusDto["status"];
  previewApplication?: Application;
  /** Inert, non-production fixture only; never changes real access. */
  previewLoading?: boolean;
  /** Draws the operators' inbox from fixture rows in the design preview. */
  previewReviewer?: boolean;
}) {
  const [state, setState] = useState<StudioAccessRequestStatusDto | null>(
    preview
      ? {
          status: previewStatus,
          requestedAt: null,
          application: previewApplication,
          canReviewRequests: previewReviewer,
        }
      : null,
  );
  const [loading, setLoading] = useState(!preview || previewLoading);
  const [error, setError] = useState("");
  const applyHref = useMarketplaceHref("/apply");

  useEffect(() => {
    if (preview) {
      return;
    }
    let active = true;
    void studioApi<StudioAccessRequestStatusDto>("/access-request")
      .then((result) => {
        if (active) {
          setState(result);
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
  }, [preview]);

  const enabled = state?.status === "enabled";
  const notice = accessNotice(state?.application ?? null);
  return (
    <section
      className={styles.notice}
      data-placement={placement}
      aria-label="Creator access"
      id="creator-access-panel"
    >
      {loading ? (
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
            <Icon name={enabled ? "check" : "clock"} size={18} />
            <h2>{enabled ? "Creator access enabled" : notice.title}</h2>
          </div>
          <p>
            {enabled
              ? "You can create agents in your own workspace. Wallet and funding requirements still apply."
              : notice.body}
          </p>
          {!enabled && notice.tag && <Tag data-tint={notice.tint ?? undefined}>{notice.tag}</Tag>}
          {!enabled && notice.apply && (
            <a href={applyHref} className={styles.applyLink}>
              Create an agent · the application
            </a>
          )}
          <Button variant="secondary" disabled={preview} onClick={() => window.location.reload()}>
            Check access
          </Button>
          {state.canReviewRequests && placement === "account" && (
            <ApplicationsInbox preview={preview} />
          )}
        </>
      )}
    </section>
  );
}
