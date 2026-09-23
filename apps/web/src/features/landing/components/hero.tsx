import Image from "next/image";
import { Icon } from "@pickler/ui";
import styles from "../landing.module.css";
import type { Hue } from "../lib/palette";
import { AgentsCreated } from "./agents-created";
import { Backed } from "./backed";
import { Mark } from "./mark";

export function Headline() {
  return (
    <div>
      <h1 className={styles.headline}>
        PREDICT
        {/* Drawn, not typed — see .headlineStop. */}
        <span className={styles.headlineStop} aria-hidden="true" />
      </h1>
      <p className={styles.tagline}>AGENTS THAT BET IN PUBLIC</p>
    </div>
  );
}

/** What the product does, said once each. Copy, not data: none of this is a measurement. */
const PERKS: { title: string; tag: string; hue: Hue }[] = [
  { title: "Build an agent. No code", tag: "STUDIO", hue: "lime" },
  { title: "Launch its token", tag: "CURVE", hue: "indigo" },
  { title: "Earn on every trade", tag: "VOLUME FEES", hue: "amber" },
  { title: "Get paid for its takes", tag: "REVENUE", hue: "orange" },
  { title: "Wins and losses, public", tag: "PROOF", hue: "violet" },
  { title: "You set the limits", tag: "CAPS", hue: "magenta" },
];

export function HeroRow() {
  return (
    <div className={styles.heroRow}>
      <section className={styles.claim} aria-label="What Pickler does">
        {/* A claim, not a section heading, and set in the body face at 600 rather than the
            display face — so it is a paragraph and the section is named by its label. */}
        <p className={styles.claimTitle}>Every call priced, timestamped, settled.</p>
        <ul className={styles.perks}>
          {PERKS.map((perk) => (
            <li key={perk.tag} className={styles.perk}>
              <Mark hue={perk.hue} className={styles.perkMark} />
              <span className={styles.perkTitle}>{perk.title}</span>
              <span className={styles.perkTag}>{perk.tag}</span>
            </li>
          ))}
        </ul>
        <a href="#waitlist" className={styles.claimCta}>
          Join waitlist
          <span className={styles.claimCtaBadge} aria-hidden="true">
            <Icon name="arrow" size={15} />
          </span>
        </a>
      </section>

      {/* The studio's own ground, appearing inline in a white page. Nothing here is a rule of its
          own: the card takes the opposite surface and everything inside it follows. The id is how
          surfaces.mjs names this block to assert that it does. */}
      <div id="mascot-card" className={styles.mascotCard} data-surface="dark">
        <p className={`${styles.label} ${styles.mascotLabel}`}>ALWAYS ON</p>
        <Mark hue="lime" className={styles.mascotCorner} />
        <div className={styles.mascotGlow} aria-hidden="true" />
        <Image
          src="/brand/mascot.webp"
          alt="Pickler mascot"
          width={1000}
          height={834}
          className={styles.mascot}
          priority
          unoptimized
        />
      </div>

      <div className={styles.heroLive}>
        <AgentsCreated />
        <Backed />
      </div>
    </div>
  );
}
