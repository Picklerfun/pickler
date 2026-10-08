"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button, BrandMark, Tag } from "@pickler/ui";
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
  const [failedImage, setFailedImage] = useState<string | null>(null);
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
  const account = x.account;
  const imageUrl = account?.profileImageUrl;
  const statusLabel = {
    connected: "Connected",
    disconnected: "Not connected",
    reconnect_required: "Reconnect required",
    revocation_pending: "Disconnect pending",
  }[x.status];
  return (
    <div
      className={styles.xConnect}
      data-well={well}
      data-x-status={x?.status}
      data-x-available={x?.available}
      id={`${idPrefix}-x-connect`}
    >
      <div className={styles.xHeader}>
        {account ? (
          <a
            className={styles.xProfile}
            href={`https://x.com/${encodeURIComponent(account.handle)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open @${account.handle} on X`}
          >
            <span className={styles.xAvatar} aria-hidden="true">
              {imageUrl && failedImage !== imageUrl ? (
                <Image
                  src={imageUrl}
                  alt=""
                  width={36}
                  height={36}
                  unoptimized
                  referrerPolicy="no-referrer"
                  onError={() => setFailedImage(imageUrl)}
                />
              ) : (
                <BrandMark name="x" size={20} />
              )}
            </span>
            <span className={styles.xProfileText}>
              <span className={styles.xName}>{account.displayName || `@${account.handle}`}</span>
              <span className={styles.xHandle}>
                {account.displayName ? `@${account.handle} · X` : "X"}
              </span>
            </span>
          </a>
        ) : (
          <span className={styles.xEmpty} aria-label="X">
            <BrandMark name="x" size={20} />
          </span>
        )}
        {!connected && <Tag role="status">{statusLabel}</Tag>}
      </div>
      <div className={styles.xFooter}>
        <p className={styles.xNoteLine}>
          {connected
            ? "Read-only access."
            : "Verify ownership to publish your agent. Read-only access."}
        </p>
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
      </div>
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
      {connected && x.readsAvailable && (
        <p className={styles.xNoteLine}>Optional: 5 posts · once a day · uses X API credits.</p>
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
