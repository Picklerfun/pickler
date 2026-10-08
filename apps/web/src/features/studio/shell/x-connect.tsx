"use client";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink, BrandMark } from "@pickler/ui";
import type { XPostsDto } from "@pickler/api-schema";
import type { XState } from "../api";
import { StudioSkeleton } from "../skeleton";
import styles from "./x-connect.module.css";

export interface XConnectProps {
  x: XState | null;
  canManage: boolean;
  onConnect(): Promise<void>;
  onDisconnect(): Promise<void>;
  onPosts(cursor?: string): Promise<XPostsDto>;
  idPrefix: string;
  well?: boolean;
}
/** OAuth consent and private, explicitly requested timeline; shared by both agent studios. */
export function XConnect({
  x,
  canManage,
  onConnect,
  onDisconnect,
  onPosts,
  idPrefix,
  well = false,
}: XConnectProps) {
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [posts, setPosts] = useState<XPostsDto | null>(null);
  const [error, setError] = useState("");
  const attempted = useRef<XState | null>(null);
  const [readAttempted, setReadAttempted] = useState(false);
  const current = useRef(x);
  useEffect(() => {
    current.current = x;
  }, [x]);
  const [seen, setSeen] = useState(x);
  if (x !== seen) {
    setSeen(x);
    setPosts(null);
    setReadAttempted(false);
  }
  async function action(run: () => Promise<void>) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect X. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function read() {
    if (!x || !canManage || !x.readsAvailable || reading || attempted.current === x) {
      return;
    }
    attempted.current = x;
    setReadAttempted(true);
    setReading(true);
    setError("");
    try {
      const connection = x;
      const result = await onPosts();
      if (current.current === connection) {
        setPosts(result);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not read posts. View them on X instead.",
      );
    } finally {
      setReading(false);
    }
  }
  if (!x) {
    return <StudioSkeleton variant="rows" />;
  }
  const connected = x.status === "connected";
  return (
    <div
      className={styles.xConnect}
      data-well={well}
      data-x-status={x?.status}
      data-x-available={x?.available}
      id={`${idPrefix}-x-connect`}
    >
      <div className={styles.xRow}>
        <BrandMark name="x" size={20} />
        <span>{x.account ? `@${x.account.handle}` : "Connect your X account"}</span>
      </div>
      <p className={styles.xNoteLine}>
        Verify your X account. Connecting does not load posts, allow posting or activate trading.
      </p>
      {x.status === "reconnect_required" && (
        <p className={styles.xLine}>
          Reconnect X required. Your previous verification does not grant read access.
        </p>
      )}
      {x.status === "revocation_pending" && (
        <p className={styles.xLine}>
          Read access is blocked. Disconnect is pending at X; try Disconnect again.
        </p>
      )}
      {!x.available && (
        <p className={styles.xLine}>
          X connection is not configured yet. Publishing requires Connect X.
        </p>
      )}
      {busy ? (
        <StudioSkeleton variant="rows" />
      ) : (
        <div className={styles.xActions}>
          {!connected && (
            <Button
              size="sm"
              disabled={!canManage || !x.available || x.status === "revocation_pending"}
              onClick={() => void action(onConnect)}
            >
              {x.account ? "Reconnect X" : "Connect X"}
            </Button>
          )}
          {(x.account || x.status === "revocation_pending") && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!canManage}
              onClick={() => void action(onDisconnect)}
            >
              Disconnect
            </Button>
          )}
          {connected && x.account && (
            <ButtonLink
              variant="secondary"
              size="sm"
              href={`https://x.com/${encodeURIComponent(x.account.handle)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View posts on X
            </ButtonLink>
          )}
          {connected && x.readsAvailable && !readAttempted && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!canManage || !x.readsAvailable || reading}
              onClick={() => void read()}
            >
              Load 5 posts (paid)
            </Button>
          )}
        </div>
      )}
      {connected && !x.readsAvailable && (
        <p className={styles.xNoteLine}>In-app post reading is disabled to avoid X API charges.</p>
      )}
      {connected && x.readsAvailable && (
        <p className={styles.xNoteLine}>
          Optional preview uses X API credits: up to 5 posts, one attempt per day. View posts on X
          without an API request instead.
        </p>
      )}
      {reading && <StudioSkeleton variant="rows" />}
      {!reading && posts && connected && (
        <div className={styles.xPosts}>
          {posts.posts.length === 0 && <p className={styles.xNoteLine}>No posts found.</p>}
          {posts.posts.map((post) => (
            <article className={styles.xPost} key={post.id}>
              <p className={styles.xPostText}>{post.text}</p>
              <a href={post.url} target="_blank" rel="noopener noreferrer">
                View on X
              </a>
              <time dateTime={post.createdAt}>
                {new Date(post.createdAt).toLocaleDateString("en-US")}
              </time>
            </article>
          ))}
        </div>
      )}
      {error && (
        <p className={styles.xLine} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
