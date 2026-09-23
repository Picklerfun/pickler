"use client";
import { Icon } from "@pickler/ui";
import { UNBACKED, type Draft } from "./draft";
import type { SheetKind } from "./passkey-sheet";
import styles from "./empty.module.css";

/**
 * Draft overview · go public: the four things the canvas asks for between a draft and a live agent.
 *
 * None of the four has a backend. Voice is not modelled, there is no account-linking endpoint,
 * agent sub-wallets are specification two of the custody work, and funding needs a wallet that does
 * not exist. So each one is drawn, each one says what it is waiting on, and none of them can be
 * ticked — which is why the progress bar reads zero and Go public is disabled rather than sitting
 * one click away from a promise the product cannot keep.
 */
const VOICES = [
  {
    name: "Analyst",
    swatch: "blue",
    sample: "Took Lakers −4.5 at 0.58. Model says 0.64. Small edge, sized small.",
  },
  {
    name: "Contrarian",
    swatch: "orange",
    sample: "Everyone is on the favourite. That is the whole reason I am not.",
  },
  { name: "Deadpan", swatch: "soft", sample: "Lakers −4.5 at 0.58. 12 MON. That is the post." },
  {
    name: "Professor",
    swatch: "amber",
    sample: "Pace differential and rest days both favour LA. Taking −4.5 at 0.58.",
  },
];

export function DraftOverview({
  draft,
  open,
  voice,
  onOpen,
  onVoice,
  onSheet,
  onStudio,
}: {
  draft: Draft;
  open: string | null;
  voice: string;
  onOpen(key: string | null): void;
  onVoice(name: string): void;
  onSheet(kind: SheetKind): void;
  onStudio(): void;
}) {
  const name = draft.name.trim() || "Your agent";
  const chosen = VOICES.find((entry) => entry.name === voice);
  const tasks = [
    { key: "voice", title: "Voice", meta: "HOW EVERY PICK READS", waiting: UNBACKED.voice },
    { key: "x", title: "Connect X", meta: "WHERE IT POSTS", waiting: UNBACKED.x },
    { key: "wallet", title: "Its wallet", meta: "LIMITS · PASSKEY", waiting: UNBACKED.wallet },
    { key: "fund", title: "Fund it", meta: "AFTER ITS WALLET", waiting: UNBACKED.fund },
  ];

  return (
    <div className={styles.draft}>
      <div className={styles.draftHead}>
        <h1 className={styles.headline} id="go-public">
          GO PUBLIC<span>.</span>
        </h1>
        <span className={styles.progressLabel}>0 / 4</span>
      </div>
      <span className={styles.progress} role="img" aria-label="None of the four are done">
        <i style={{ width: "0%" }} />
      </span>
      <p className={styles.note}>
        {name} exists and can research. The four below are what the design asks for before it posts
        in public, and none of them is built — so this list is a plan, not a queue.
      </p>

      {tasks.map((task, position) => (
        <section key={task.key} className={styles.task}>
          <div className={styles.taskHead}>
            <span className={styles.taskMark}>{position + 1}</span>
            <span className={styles.taskWho}>
              <b>{task.title}</b>
              <small>{task.meta}</small>
            </span>
            <span className={styles.mark} data-tint="grey">
              NO BACKEND
            </span>
            <button
              type="button"
              className={styles.taskCta}
              onClick={() =>
                task.key === "wallet" || task.key === "fund"
                  ? onSheet(task.key)
                  : onOpen(open === task.key ? null : task.key)
              }
            >
              {task.key === "wallet" || task.key === "fund" ? "See the sheet" : "Open"}
            </button>
          </div>
          <p className={styles.taskWhy}>
            <Icon name="alert" size={13} />
            {task.waiting}
          </p>

          {open === "voice" && task.key === "voice" && (
            <div className={styles.voice}>
              <div className={styles.chips}>
                {VOICES.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    className={styles.chip}
                    data-swatch={entry.swatch}
                    aria-pressed={voice === entry.name}
                    onClick={() => onVoice(entry.name)}
                  >
                    <span className={styles.beatDot} />
                    {entry.name}
                  </button>
                ))}
              </div>
              <p className={styles.sample}>
                {chosen ? chosen.sample : "Pick one to see how a post would read."}
              </p>
              <p className={styles.note}>
                A preview, written here. Nothing saves a voice, so this choice is gone when you
                leave the page.
              </p>
            </div>
          )}

          {open === "x" && task.key === "x" && (
            <div className={styles.voice}>
              <p className={styles.note}>
                The design verifies a handle by asking you to post a code and then reading it back.
                There is no endpoint that reads X, so there is no field here to type into — a box
                that accepted a handle and told you it was verified would be inventing the answer.
              </p>
            </div>
          )}
        </section>
      ))}

      <button
        type="button"
        className={styles.primary}
        disabled
        title="Nothing above can be done yet"
      >
        4 to go
      </button>
      <button type="button" className={styles.quiet} onClick={onStudio}>
        OPEN THE STUDIO INSTEAD
      </button>
    </div>
  );
}
