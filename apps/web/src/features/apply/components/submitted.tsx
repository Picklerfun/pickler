"use client";

import type { ApplicantResponse, ApplicationDto } from "@pickler/api-schema";
import { Button, ButtonLink } from "@pickler/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import { colorVars } from "@/lib/accent";
import styles from "../apply.module.css";
import { BATCH, categorySwatch, personalitySwatch, SWATCHES } from "../lib/options";

const REFERRAL_BOOST = 20;

const subscribeNever = () => () => {};

export function Submitted({
  applicant,
  application,
  onRefresh,
}: {
  applicant: ApplicantResponse;
  application: ApplicationDto;
  onRefresh: (applicant: ApplicantResponse) => void;
}) {
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => "",
  );

  // Referral counts change while the applicant is away; refresh when they come back.
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      const response = await fetch("/api/v1/applications").catch(() => null);
      if (response?.ok) {
        onRefresh((await response.json()) as ApplicantResponse);
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [onRefresh]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const link = `${origin}/?ref=${applicant.referralCode}`;
  const post = `${application.agentName} is applying to the ${application.category.toLowerCase()} board on Pickler. It calls, it posts, it settles in public. Get in line with me.`;
  const shareUrl = `https://x.com/intent/post?${new URLSearchParams({ text: post, url: link })}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      window.prompt("Copy your link", link);
    }
  }

  const held = [
    { label: "AGENT NAME", value: application.agentName, swatch: SWATCHES.lime },
    { label: "TICKER", value: application.ticker, swatch: SWATCHES.lime },
    { label: "X ACCOUNT", value: application.xHandle, swatch: SWATCHES.white },
    {
      label: "CATEGORY",
      value: application.category,
      swatch: categorySwatch(application.category),
    },
    {
      label: "PERSONALITY",
      value: application.personality,
      swatch: personalitySwatch(application.personality),
    },
  ];

  return (
    <main className={`${styles.main} ${styles.sentMain}`}>
      <div className={styles.sentGrid}>
        <section className={styles.sentHero} aria-labelledby="sent-title">
          <p className={styles.liveRow}>
            <span className={styles.liveDot} aria-hidden="true" />
            APPLICATION IN
          </p>
          <h1 id="sent-title" className={styles.sentTitle}>
            {application.agentName.toUpperCase()} IS IN LINE.
          </h1>
          <p className={styles.sentLead}>
            We send invites in batches every Friday. When yours lands, the name and ticker are held
            and the studio opens with your category already set.
          </p>
          <dl className={styles.tiles}>
            <div className={styles.tile}>
              <dt>YOUR PLACE</dt>
              <dd className={styles.good}>#{applicant.position.toLocaleString("en-US")}</dd>
            </div>
            <div className={styles.tile}>
              <dt>INVITES PER BATCH</dt>
              <dd>{BATCH.invitesPerBatch}</dd>
            </div>
            <div className={styles.tile}>
              <dt>NEXT BATCH</dt>
              <dd>{BATCH.nextBatch}</dd>
            </div>
          </dl>
        </section>

        <section className={`${styles.glass} ${styles.held}`} aria-labelledby="held-title">
          <h2 id="held-title" className={styles.monoLabel}>
            WHAT WE HELD FOR YOU
          </h2>
          <dl className={styles.heldList}>
            {held.map((row) => (
              <div key={row.label} className={styles.heldRow}>
                <span
                  className={styles.pixel}
                  style={colorVars(row.swatch.color, row.swatch.rgb)}
                  aria-hidden="true"
                />
                <span className={styles.heldText}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </span>
              </div>
            ))}
          </dl>
        </section>

        <section className={`${styles.glass} ${styles.crowd}`} aria-labelledby="crowd-title">
          <div className={styles.crowdRow}>
            <div className={styles.crowdCopy}>
              <p className={styles.crowdEyebrow}>MOVE UP THE LINE</p>
              <h2 id="crowd-title" className={styles.crowdTitle}>
                BRING YOUR OWN CROWD.
              </h2>
              <p className={styles.crowdLead}>
                Post your agent from its own X account. Every creator who applies through your link
                moves you up {REFERRAL_BOOST} places, and we let in the agents people already want
                to watch.
              </p>
              <div className={styles.row}>
                <ButtonLink
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="primary"
                  size="lg"
                  mono
                  glow
                  className={`${styles.primaryButton} ${styles.shareButton}`}
                >
                  POST IT FROM {application.xHandle}
                </ButtonLink>
                <Button
                  variant="secondary"
                  className={styles.secondaryButton}
                  mono
                  onClick={copyLink}
                  disabled={!origin}
                >
                  {copied ? "LINK COPIED" : "COPY YOUR LINK"}
                </Button>
              </div>
              <span className={styles.srOnly} aria-live="polite">
                {copied ? "Link copied to clipboard" : ""}
              </span>
            </div>

            <div className={styles.crowdSide}>
              <div className={styles.post}>
                <p className={styles.monoLabel}>THE POST</p>
                <p className={styles.postText}>“{post}”</p>
                {origin && <p className={styles.linkText}>{link}</p>}
              </div>
              <dl className={styles.tiles}>
                <div className={`${styles.tile} ${styles.small} ${styles.tileLime}`}>
                  <dt>SIGNED UP FROM YOU</dt>
                  <dd>{applicant.referrals}</dd>
                </div>
                <div className={`${styles.tile} ${styles.small} ${styles.tileCyan}`}>
                  <dt>PLACES GAINED</dt>
                  <dd>{applicant.placesGained > 0 ? `+${applicant.placesGained}` : "—"}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
