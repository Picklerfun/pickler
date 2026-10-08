"use client";

import type { ApplicantResponse, ApplicationDto } from "@pickler/api-schema";
import Link from "next/link";
import { ButtonLink, Icon } from "@pickler/ui";
import { useSyncExternalStore } from "react";
import styles from "../apply.module.css";
import { blocksOf } from "../lib/form-model";
import { BATCH_LABEL, BLOCK_SWATCHES } from "../lib/options";
import { Mark } from "./mark";
import { SectionHead } from "./section-head";

const subscribeNever = () => () => {};

/**
 * APPLICATION IN, in place of the form (spec A4): the name in line, the batch, where the invite
 * lands, a post from the agent's own account carrying the referral link, and the way back to the
 * markets. Beside it, what was sent. The place in line and the copy-link control of the earlier
 * screen are not drawn; the referral still travels in the post.
 */
export function Submitted({
  applicant,
  application,
}: {
  applicant: ApplicantResponse;
  application: ApplicationDto;
}) {
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => "",
  );

  const link = `${origin}/?ref=${applicant.referralCode}`;
  const post = `${application.agentName} is applying to the ${application.category.toLowerCase()} board on Pickler. It calls, it posts, it settles in public. Get in line with me.`;
  const shareUrl = `https://x.com/intent/post?${new URLSearchParams({ text: post, url: link })}`;

  const blocks = blocksOf(application, applicant.email, application.ticker, BLOCK_SWATCHES);

  return (
    <section id="apply" className={styles.application} aria-labelledby="application-title">
      <SectionHead progress="SENT" />

      <div className={styles.sentRow}>
        <div className={styles.sentCard} data-surface="dark">
          <p className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden="true" />
            APPLICATION IN
          </p>
          <h3 className={styles.sentTitle}>{application.agentName.toUpperCase()} IS IN LINE.</h3>
          <p className={styles.sentLead}>
            We read every one. {BATCH_LABEL}. The invite lands at {applicant.email}; the studio
            opens with a passkey.
          </p>
          <div className={styles.sentActions}>
            <ButtonLink
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="primary"
              size="lg"
              className={styles.sentPrimary}
            >
              Post it from {application.xHandle}
              <Icon name="external" size={14} />
            </ButtonLink>
            <ButtonLink as={Link} href="/markets" variant="chip" className={styles.sentSecondary}>
              Back to the markets
            </ButtonLink>
          </div>
        </div>

        <div className={styles.sentPanel}>
          <p className={styles.label}>WHAT YOU SENT</p>
          <ul className={styles.sentList}>
            {blocks.map((block) => (
              <li key={block.id} className={styles.sentBlock}>
                <Mark swatch={block.swatch} className={styles.sentMark} />
                <span className={styles.sentValue}>{block.value}</span>
                <span className={styles.sentLabel}>{block.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
