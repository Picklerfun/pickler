"use client";

import { useEffect, useState } from "react";
import { Button, Chip, Tag, Textarea } from "@pickler/ui";
import type {
  StudioApplicationDto,
  StudioApplicationReviewRequestDto,
  StudioApplicationsDto,
} from "@pickler/api-schema";
import { studioApi } from "./api";
import { StudioSkeleton } from "./skeleton";
import styles from "./applications-inbox.module.css";

type Status = StudioApplicationDto["status"];
type Filter = Status | "all";
interface Loaded {
  filter: Filter;
  rows?: StudioApplicationDto[];
  error?: string;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "submitted", label: "To review" },
  { key: "invited", label: "Invited" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const TINT: Record<Status, string> = { submitted: "amber", invited: "lime", rejected: "magenta" };
const LABEL: Record<Status, string> = {
  submitted: "To review",
  invited: "Invited",
  rejected: "Rejected",
};

/** Fixture rows for the design preview; nothing here is ever sent. */
export const PREVIEW_APPLICATIONS: StudioApplicationDto[] = [
  {
    id: 41,
    email: "nina@example.com",
    agentName: "Halftime",
    ticker: "$HALF",
    xHandle: "@halftimebot",
    category: "Sports",
    personality: "Analyst",
    edge: "It reads injury reports before the books move.",
    whyYou: "I have traded NBA props for six years and I read the injury beat every morning.",
    status: "submitted",
    submittedAt: "2026-10-07T18:06:00.000Z",
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
    invitedAt: null,
  },
  {
    id: 38,
    email: "theo@example.com",
    agentName: "Unlock Watch",
    ticker: "$UNLK",
    xHandle: "@unlockwatch",
    category: "Crypto",
    personality: "Deadpan",
    edge: "Unlock calendars, and what the float does after.",
    whyYou: "Three years on token unlock desks.",
    status: "invited",
    submittedAt: "2026-10-05T09:15:00.000Z",
    reviewedAt: "2026-10-06T10:00:00.000Z",
    reviewedBy: "ops@pickler.fun",
    decisionNote: "Clear beat, public record already.",
    invitedAt: "2026-10-06T10:00:00.000Z",
  },
];

/**
 * The operators' inbox for creator applications: what /apply received, and the one decision each
 * one gets. Drawn only for a super admin (the server decides; this component just asks). Inviting
 * turns access on by email (spec R5); the acceptance email stays separate.
 */
export function ApplicationsInbox({ preview = false }: { preview?: boolean }) {
  const [filter, setFilter] = useState<Filter>("submitted");
  // What the last read answered, and for which filter: loading is the filter not matching, so the
  // effect only reads and never sets state before the answer.
  const [loaded, setLoaded] = useState<Loaded | null>(
    preview ? { filter: "all", rows: PREVIEW_APPLICATIONS } : null,
  );

  useEffect(() => {
    if (preview) {
      return;
    }
    let active = true;
    const query = filter === "all" ? "" : `?status=${filter}`;
    void studioApi<StudioApplicationsDto>(`/applications${query}`)
      .then((result) => {
        if (active) {
          setLoaded({ filter, rows: result.applications });
        }
      })
      .catch(() => {
        if (active) {
          setLoaded({ filter, error: "Applications could not be loaded. Please try again." });
        }
      });
    return () => {
      active = false;
    };
  }, [filter, preview]);

  const loading = !preview && loaded?.filter !== filter;
  const rows = loaded?.rows ?? [];
  const shown = preview && filter !== "all" ? rows.filter((row) => row.status === filter) : rows;

  return (
    <section id="applications-inbox" className={styles.inbox} aria-labelledby="applications-title">
      <div className={styles.head}>
        <h3 id="applications-title" className={styles.title}>
          Creator applications
        </h3>
        <div className={styles.filters} role="group" aria-label="Status">
          {FILTERS.map((option) => (
            <Chip
              key={option.key}
              selected={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </div>
      <p className={styles.note}>
        Inviting turns studio access on for the account under that email, or the moment it signs up.
        The acceptance email is sent separately.
      </p>
      {loading ? (
        <StudioSkeleton variant="access" />
      ) : loaded?.error ? (
        <p role="alert" className={styles.error}>
          {loaded.error}
        </p>
      ) : shown.length === 0 ? (
        <p className={styles.empty}>
          Nothing {filter === "all" ? "yet" : LABEL[filter].toLowerCase()}.
        </p>
      ) : (
        <ul className={styles.list}>
          {shown.map((row) => (
            <ApplicationRow
              key={row.id}
              row={row}
              preview={preview}
              onDecided={(next) =>
                setLoaded((current) =>
                  current?.rows
                    ? {
                        ...current,
                        rows: current.rows.map((item) => (item.id === next.id ? next : item)),
                      }
                    : current,
                )
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ApplicationRow({
  row,
  preview,
  onDecided,
}: {
  row: StudioApplicationDto;
  preview: boolean;
  onDecided: (next: StudioApplicationDto) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(status: StudioApplicationReviewRequestDto["status"]) {
    if (preview || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body: StudioApplicationReviewRequestDto = note.trim()
        ? { status, note: note.trim() }
        : { status };
      const next = await studioApi<StudioApplicationDto>(`/applications/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onDecided(next);
    } catch {
      setError("The decision could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const decided = row.status !== "submitted";
  return (
    <li className={styles.row} data-status={row.status}>
      <div className={styles.rowHead}>
        <span className={styles.agent}>
          <strong>{row.agentName}</strong>
          <span className={styles.ticker}>{row.ticker}</span>
        </span>
        <Tag data-tint={TINT[row.status]}>{LABEL[row.status]}</Tag>
        <span className={styles.when}>{new Date(row.submittedAt).toLocaleString()}</span>
      </div>
      <dl className={styles.answers}>
        <div>
          <dt>Email</dt>
          <dd>{row.email}</dd>
        </div>
        <div>
          <dt>X account</dt>
          <dd>{row.xHandle}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{row.category}</dd>
        </div>
        <div>
          <dt>Personality</dt>
          <dd>{row.personality}</dd>
        </div>
        <div className={styles.wide}>
          <dt>Its edge</dt>
          <dd>{row.edge}</dd>
        </div>
        <div className={styles.wide}>
          <dt>Why them</dt>
          <dd>{row.whyYou}</dd>
        </div>
      </dl>
      {decided ? (
        <p className={styles.decision}>
          {LABEL[row.status]} by {row.reviewedBy ?? "an operator"}
          {row.reviewedAt ? ` on ${new Date(row.reviewedAt).toLocaleString()}` : ""}
          {row.decisionNote ? ` · ${row.decisionNote}` : ""}
        </p>
      ) : (
        <div className={styles.actions}>
          <Textarea
            aria-label={`Note for ${row.agentName}`}
            rows={2}
            maxLength={500}
            placeholder="A note for the record (optional)"
            className={styles.noteField}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy || preview}
          />
          <div className={styles.buttons}>
            <Button
              variant="primary"
              onClick={() => void decide("invited")}
              disabled={busy || preview}
            >
              Invite
            </Button>
            <Button
              variant="secondary"
              onClick={() => void decide("rejected")}
              disabled={busy || preview}
            >
              Reject
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </li>
  );
}
