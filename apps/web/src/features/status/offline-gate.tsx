"use client";

import { Button } from "@pickler/ui";
import { useEffect, useState, type ReactNode } from "react";
import { useNow } from "@/lib/now";
import { StatusActions, StatusFrame, StatusScreen } from "./status-screen";
import styles from "./status.module.css";
import { ago } from "./words";

const RETRY_MS = 15_000;

/**
 * 1d. The studio without a connection. The studio stays mounted underneath, hidden, so a brief
 * being written is still there when the connection comes back; nothing can be signed meanwhile,
 * because nothing can reach the API.
 */
export function OfflineGate({ children }: { children: ReactNode }) {
  /* When the browser said the connection went, or null while it has not. The browser's word is a
     hint — it says "online" behind a dead router — so a check that reaches the API is the proof
     that clears the screen, before or without the event. */
  const [since, setSince] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [tries, setTries] = useState(0);
  const now = useNow(15_000);
  const offline = since !== null;

  useEffect(() => {
    const back = () => {
      setSince(null);
      setTries(0);
    };
    const gone = () => setSince((current) => current ?? Date.now());
    window.addEventListener("online", back);
    window.addEventListener("offline", gone);
    return () => {
      window.removeEventListener("online", back);
      window.removeEventListener("offline", gone);
    };
  }, []);

  async function check(counted: boolean) {
    setChecking(true);
    try {
      const response = await fetch("/api/v1/health", { cache: "no-store" });
      if (response.ok) {
        setSince(null);
        setTries(0);
      } else if (counted) {
        setTries((n) => n + 1);
      }
    } catch {
      if (counted) {
        setTries((n) => n + 1);
      }
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!offline) {
      return;
    }
    const timer = setInterval(() => void check(false), RETRY_MS);
    return () => clearInterval(timer);
  }, [offline]);

  const at =
    since === null
      ? ""
      : new Date(since).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

  return (
    <>
      <div hidden={offline}>{children}</div>
      {offline && (
        <StatusFrame foot="NOTHING CAN BE SIGNED WHILE OFFLINE · WHAT YOU WERE WRITING STAYS ON THIS PAGE">
          <StatusScreen
            id="offline"
            tone="cool"
            eyebrow="NETWORK · OFFLINE"
            title="YOU'RE OFFLINE"
            body={
              <>
                Your agents run on-chain, not on your connection.
                {since !== null && (
                  <>
                    {" "}
                    What you see is from{" "}
                    <b>
                      {at} · {ago(since, now)}
                    </b>
                    .
                  </>
                )}{" "}
                We reconnect the moment you do.
              </>
            }
          >
            <StatusActions>
              <Button
                variant={tries > 0 ? "secondary" : "primary"}
                onClick={() => void check(true)}
                disabled={checking}
              >
                {checking && <span className={styles.pulse} aria-hidden="true" />}
                {checking ? "Checking" : tries > 0 ? "Try again" : "Retry now"}
              </Button>
              <span className={styles.note} role="status">
                {tries > 0
                  ? `STILL OFFLINE · TRIED ${tries} ${tries === 1 ? "TIME" : "TIMES"}`
                  : "RETRIES ON ITS OWN EVERY 15S"}
              </span>
            </StatusActions>
          </StatusScreen>
        </StatusFrame>
      )}
    </>
  );
}
