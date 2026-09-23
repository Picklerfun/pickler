"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, ButtonLink, Icon } from "@pickler/ui";
import { MONAD_TESTNET } from "@pickler/chain";
import { addressButtonLabel, type CopyState } from "../../auth/lib/address";
import { formatBalance } from "../../auth/lib/balance";
import type { BalanceDto, WalletDto } from "../../auth/lib/custody-api";
import { NotYet } from "../components/not-yet";
import styles from "../account.module.css";

/** What the screen knows about the master wallet, as four states rather than a nullable object. */
export type WalletState =
  | { kind: "loading" }
  | { kind: "ready"; wallet: WalletDto }
  /** 404 from wallets/me: an account with no wallet yet, which is an ordinary first-run state. */
  | { kind: "none" }
  | { kind: "error"; reason: string };

/**
 * A balance tile. `formatBalance` answers null for a balance the chain could not be read for, and
 * that is not zero — printing 0.00 there tells somebody their money is gone when the truth is that
 * nobody looked. So null gets an em dash and a line saying which of the two happened.
 */
function Balance({
  use,
  tint,
  balance,
}: {
  use: string;
  tint: "blue" | "violet";
  balance: BalanceDto;
}) {
  const shown = formatBalance(balance);
  return (
    <div className={styles.balance}>
      <p className={styles.balanceUse} data-tint={tint}>
        <span className={styles.balanceSquare} aria-hidden="true" />
        {use}
      </p>
      <p className={styles.balanceAmount}>
        <span className={styles.balanceValue}>{shown ?? "—"}</span>
        <span className={styles.balanceSymbol}>{balance.symbol}</span>
      </p>
      {shown === null && <p className={styles.balanceUnread}>CHAIN DID NOT ANSWER · NOT ZERO</p>}
    </div>
  );
}

export function WalletSection({ state }: { state: WalletState }) {
  const [copied, setCopied] = useState<CopyState>("idle");
  const wallet = state.kind === "ready" ? state.wallet : null;

  function copy(address: string) {
    void navigator.clipboard.writeText(address).then(
      () => setCopied("copied"),
      () => setCopied("failed"),
    );
  }

  return (
    <section id="account-panel-wallet" className={styles.section} aria-label="Wallet">
      {/* The page's inversion, and the one surfaces.mjs asserts on this route: a light card inside
          the night-blue page, built by nesting the opposite data-surface rather than by a rule of
          its own. Everything inside reads the light value of the same token names. */}
      <div id="account-wallet-card" className={styles.card} data-surface="light">
        <p className={styles.cardLabel}>MASTER WALLET · AVAILABLE</p>
        {state.kind === "loading" && <p className={styles.cardNote}>Reading the chain…</p>}
        {state.kind === "none" && (
          <>
            {/* The trigger moved. A wallet used to be made during sign-up, so this said it arrived
                with your first passkey; it is now made when you build your first agent, or here,
                whenever you decide to. Saying the old thing would describe a product that no
                longer exists. */}
            <p className={styles.cardNote}>
              No wallet yet. One is made when you build your first agent — or now, if you would
              rather have it ready. Its key never leaves the enclave it is made in.
            </p>
            <div className={styles.cardActions}>
              <ButtonLink as={Link} href="/custody" variant="primary" arrow>
                Create my wallet
              </ButtonLink>
            </div>
          </>
        )}
        {state.kind === "error" && <p className={styles.cardNote}>{state.reason}</p>}
        {wallet && (
          <>
            <div className={styles.balances}>
              <Balance use="PERPS · MARKETS" tint="blue" balance={wallet.balances.token} />
              <Balance use="MEMECOINS · GAS" tint="violet" balance={wallet.balances.native} />
            </div>
            <div className={styles.cardActions}>
              {/* Disabled rather than absent, because the canvas puts it here and a missing action
                  reads as a screen that forgot rather than a move that is not built. There is no
                  transfer route: signing.ts mounts a challenge, a register, the add pair and
                  wallets/me, and not one of them moves anything. */}
              <Button
                variant="primary"
                disabled
                title="Sending is not built yet — no route in this build moves funds."
              >
                <Icon name="key" size={15} />
                Send
              </Button>
              <Button
                variant="secondary"
                className={styles.receive}
                onClick={() => copy(wallet.address)}
              >
                <Icon name="copy" size={15} />
                {copied === "copied" ? "COPIED" : "Receive"}
              </Button>
            </div>
          </>
        )}
      </div>

      {wallet && (
        <div className={styles.network}>
          <div className={styles.networkName}>
            {/* The wallet DTO carries an address and balances and no chain, so the network is named
                from the one this build targets rather than from the response. If a chain ever
                travels on WalletDto, read it from there instead of from here. */}
            <p className={styles.networkTitle}>{MONAD_TESTNET.name}</p>
            <button
              type="button"
              className={styles.address}
              onClick={() => copy(wallet.address)}
              title={wallet.address}
            >
              {addressButtonLabel(wallet.address, copied)}
            </button>
          </div>
          <span className={styles.selfCustody}>
            <span className={styles.selfCustodyDot} aria-hidden="true" />
            SELF-CUSTODY
          </span>
        </div>
      )}

      <h3 className={styles.heading}>AGENT WALLETS</h3>
      <NotYet title="No agent has a wallet of its own yet">
        Agent sub-wallets, their spend caps and the top-up and pull-back moves are specification two
        of the custody work, and it has not been written. Nothing mints one, funds one or reads its
        balance — so this screen shows no rows, no meters and no totals rather than numbers that
        nothing stands behind.
      </NotYet>

      <h3 className={styles.heading}>ACTIVITY</h3>
      <NotYet title="Nothing reads this wallet&rsquo;s history">
        The signing API answers with the current balances and no transactions. Until something
        serves a history, an empty list here would be indistinguishable from a wallet that has never
        moved.
      </NotYet>
    </section>
  );
}
