"use client";
import { useState } from "react";
import { Button, Chip, ChipText, Icon, Input, Segmented, Tag } from "@pickler/ui";
import { addSite, isNfl, toggleIn } from "./draft";
import type { StepProps } from "./flow";
import { BOOKS, WEB_MODES } from "./map";
import styles from "./create.module.css";

/**
 * Exactly where it may look. The web is always on in this plan (a run with no source fails), so
 * unlike the canvas there is no switch for it, only its three modes; sports data and the books are
 * offered for NFL, the one subcategory with data behind them.
 */
export function ReadsStep({ draft, patch, replace }: StepProps) {
  const [site, setSite] = useState("");
  const [refused, setRefused] = useState(false);
  const mode = WEB_MODES.find((candidate) => candidate.value === draft.webMode) ?? WEB_MODES[0]!;
  const lists = draft.webMode !== "anywhere";
  const nfl = isNfl(draft);

  function add() {
    if (!site.trim()) {
      return;
    }
    const next = addSite(draft, site);
    setRefused(next === draft);
    if (next !== draft) {
      replace(next);
      setSite("");
    }
  }

  return (
    <section className={styles.step} id="create-reads">
      <h1 className={styles.headline} tabIndex={-1}>
        WHAT IT READS<span>.</span>
      </h1>
      <p className={styles.lead}>Exactly where it&apos;s allowed to look before it makes a call.</p>

      <div className={styles.panel} data-on="true">
        <span className={styles.cardBody}>
          <span className={styles.cardHead}>
            Market data <span className={styles.cardKind}>ALWAYS ON</span>
          </span>
          <span className={styles.cardNote}>
            Market rules and the live order book on Polymarket.
          </span>
        </span>
      </div>

      <div className={styles.panel} data-on="true">
        <span className={styles.cardBody}>
          <span className={styles.cardHead}>
            Web search <span className={styles.cardKind}>ALWAYS ON</span>
          </span>
          <span className={styles.cardNote}>News, reports and posts about the event.</span>
        </span>
        <div className={styles.panelSplit}>
          <Segmented
            label="Where it searches"
            className={styles.segmented}
            options={WEB_MODES}
            value={draft.webMode}
            onChange={(webMode) => patch({ webMode })}
          />
          {lists && (
            <>
              {draft.sites.length > 0 && (
                <div className={styles.chips}>
                  {draft.sites.map((host) => (
                    <ChipText key={host} className={styles.siteChip}>
                      {host}
                      <button
                        type="button"
                        aria-label={`Remove ${host}`}
                        onClick={() => patch({ sites: draft.sites.filter((x) => x !== host) })}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </ChipText>
                  ))}
                </div>
              )}
              <div className={styles.addRow}>
                <Input
                  size="sm"
                  shape="pill"
                  value={site}
                  aria-label="Add a site"
                  placeholder="Add a site, e.g. rotowire.com"
                  onChange={(event) => {
                    setSite(event.target.value);
                    setRefused(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      add();
                    }
                  }}
                />
                <Button variant="secondary" size="sm" onClick={add}>
                  Add
                </Button>
              </div>
              {refused && (
                <p className={styles.note} data-tone="bad" role="alert">
                  That is not a site it can add: use a host like rotowire.com, once, up to 20.
                </p>
              )}
            </>
          )}
          <p className={styles.note}>
            {lists && draft.sites.length === 0 ? "Add at least one site." : mode.note}
          </p>
        </div>
      </div>

      {nfl && (
        <>
          <div className={styles.panel} data-on="true">
            <span className={styles.cardBody}>
              <span className={styles.cardHead}>
                Sports data <span className={styles.cardKind}>NFL</span>
              </span>
              <span className={styles.cardNote}>Rosters, injuries and schedules.</span>
            </span>
          </div>
          <div className={styles.panel} data-on={draft.books.length > 0}>
            <span className={styles.cardBody}>
              <span className={styles.cardHead}>
                Sportsbook odds <span className={styles.cardKind}>NFL</span>
                {draft.books.length === 0 && <Tag className={styles.soon}>OFF</Tag>}
              </span>
              <span className={styles.cardNote}>
                Compares the market with the books you pick. Pick none to leave the odds out.
              </span>
            </span>
            <div className={styles.panelSplit}>
              <div className={styles.chips}>
                {BOOKS.map((book) => (
                  <Chip
                    key={book.key}
                    selected={draft.books.includes(book.key)}
                    onClick={() => patch({ books: toggleIn(draft.books, book.key) })}
                  >
                    {book.label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
