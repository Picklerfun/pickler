"use client";

import { Button, Icon } from "@pickler/ui";
import type { ProfileDto } from "../../auth/lib/pickler-api";
import { NotYet } from "../components/not-yet";
import { Toggle } from "../components/toggle";
import { joinedLabel, profileLink } from "../lib/profile";
import styles from "../account.module.css";

/** The four squares of the identity mark, in the order the canvas sets them. */
const MARK = ["lime", "violet", "amber", "blue"] as const;

export function ProfileSection({
  profile,
  origin,
}: {
  profile: ProfileDto | null;
  origin: string;
}) {
  const joined = joinedLabel(profile?.created_at);
  const link = profile ? profileLink(origin, profile.handle) : null;

  return (
    <section id="account-panel-profile" className={styles.section} aria-label="Public profile">
      <div className={styles.identity}>
        <div className={styles.mark} aria-hidden="true">
          {MARK.map((tint) => (
            <span key={tint} className={styles.square} data-tint={tint} />
          ))}
        </div>
        <h2 className={styles.handle}>{profile ? `@${profile.handle.toUpperCase()}` : "@—"}</h2>
        {joined && <p className={styles.joined}>{joined}</p>}
        {/* Disabled, and still showing the address it would copy, because that address does not
            resolve: apps/web/src/app has no /@handle route and nothing serves a person's public
            page. A button that copied it would hand somebody a link to a 404 with their name on. */}
        <Button
          variant="secondary"
          className={styles.link}
          disabled
          title="There is no public profile page yet, so this link would not open."
        >
          <Icon name="link" size={14} />
          {link ?? "—"}
        </Button>
      </div>

      <h3 className={styles.heading}>BIO</h3>
      <input
        className={styles.bio}
        type="text"
        maxLength={80}
        disabled
        aria-label="Bio"
        placeholder="80 characters, on the page that does not exist yet"
      />
      <NotYet title="A bio has nowhere to be stored">
        The profile the API keeps is a display name, a handle and the day it was made. Nothing reads
        or writes a bio, so this field is drawn and left inert rather than taking eighty characters
        and dropping them.
      </NotYet>

      <h3 className={styles.heading}>VISIBILITY</h3>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <p className={styles.rowTitle}>Show my wallet</p>
          <p className={styles.rowMeta}>NO PUBLIC PAGE TO SHOW IT ON · NOTHING STORES THIS YET</p>
        </div>
        <Toggle
          on={false}
          label="Show my wallet"
          why="There is nowhere to store this preference, and no public page it would change."
        />
      </div>

      <h3 className={styles.heading}>ON THE BOARD</h3>
      <NotYet title="Your totals and your agents&rsquo; records are not computed for you">
        The leaderboard ranks agents, not people. Nothing adds up a person&rsquo;s agents, picks or
        net, so the three figures the canvas puts here — and the cards under them — have no source.
        A dash in each tile would read as a number still loading, which is why there are no tiles.
      </NotYet>
    </section>
  );
}
