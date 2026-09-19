import type { AccentDto, AgentSummaryDto, VenueDto } from "@pickler/api-schema";
import Image from "next/image";
import { accentVars } from "@/lib/accent";
import { Meter, ChipText } from "@pickler/ui";
import styles from "../agents.module.css";
import { formatInteger, initials } from "../lib/format";

/**
 * The agent's mark. Initials until an agent has a logo: pass `src` and the image fills the same
 * frame, so a row does not move when the artwork arrives.
 */
export function AgentAvatar({
  name,
  accent,
  src,
  large = false,
  small = false,
}: {
  name: string;
  accent: AccentDto;
  src?: string | undefined;
  large?: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={`${styles.avatar} ${large ? styles.avatarLarge : ""} ${small ? styles.avatarSmall : ""}`}
      style={accentVars(accent)}
      aria-hidden="true"
    >
      {src ? (
        <Image
          src={src}
          alt=""
          width={128}
          height={128}
          className={styles.avatarImage}
          unoptimized
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function StageBadge({ token }: { token: AgentSummaryDto["token"] }) {
  if (!token) {
    return <span className={`${styles.stage} ${styles.stageNone}`}>NO TOKEN</span>;
  }
  const graduated = token.stage === "graduated";
  return (
    <span className={`${styles.stage} ${graduated ? styles.stageGraduated : ""}`}>
      {graduated ? "GRADUATED" : "PRE-GRAD"}
    </span>
  );
}

const venueMarks = (token: NonNullable<AgentSummaryDto["token"]>) =>
  token.stage === "graduated"
    ? [
        { src: "/brand/pons.png", label: "Pons", title: "Graduated on Pons" },
        { src: "/brand/robinhood.png", label: "Robinhood Chain", title: "Robinhood Chain" },
      ]
    : [
        { src: "/brand/logo.png", label: "Pickler curve", title: "On the Pickler curve" },
        { src: "/brand/monad.png", label: "Monad", title: "Monad" },
      ];

/** Where the token trades: our curve on Monad before graduation, Pons on Robinhood Chain after it. */
export function VenueMarks({ token }: { token: AgentSummaryDto["token"] }) {
  if (!token) {
    return null;
  }
  return (
    <span className={styles.marks}>
      {venueMarks(token).map((mark) => (
        <span key={mark.src} className={styles.mark} title={mark.title}>
          <Image src={mark.src} alt={mark.title} width={64} height={64} unoptimized />
        </span>
      ))}
    </span>
  );
}

/** The same information as chips, one per venue, for the token page. */
export function VenueChips({ token }: { token: AgentSummaryDto["token"] }) {
  if (!token) {
    return null;
  }
  return (
    <>
      {venueMarks(token).map((mark) => (
        <ChipText key={mark.src} className={`${styles.chip} ${styles.venueChip}`}>
          <span className={styles.chipMark}>
            <Image src={mark.src} alt="" width={64} height={64} unoptimized />
          </span>
          {mark.label.toUpperCase()}
        </ChipText>
      ))}
    </>
  );
}

const venueLabel: Record<VenueDto, string> = {
  predictions: "PREDICTION MARKETS",
  perps: "PERPL",
  both: "PREDICTIONS + PERPL",
};

export function VenueChip({ venue }: { venue: VenueDto }) {
  return <ChipText className={`${styles.chip} ${styles.venueChip}`}>{venueLabel[venue]}</ChipText>;
}

export function CurveProgress({
  token,
  className,
  bareBar = false,
}: {
  token: NonNullable<AgentSummaryDto["token"]>;
  className?: string | undefined;
  bareBar?: boolean;
}) {
  const target = token.graduationTarget;
  const graduated = token.stage === "graduated";
  const ratio = graduated ? 1 : Math.min(1, target > 0 ? token.raised / target : 0);
  return (
    <span className={className}>
      <Meter
        value={ratio * 100}
        tone={graduated ? "lime" : "amber"}
        label="Progress to graduation"
      />
      {!bareBar && (
        <span className={styles.curveNote}>
          {graduated
            ? "graduated · trading in a pool"
            : `${formatInteger(token.raised)} / ${formatInteger(target)} MON to graduate`}
        </span>
      )}
    </span>
  );
}
