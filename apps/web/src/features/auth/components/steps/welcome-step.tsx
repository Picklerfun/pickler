"use client";

import { ButtonLink, Icon } from "@pickler/ui";
import styles from "../../auth.module.css";
import { formatBalance } from "../../lib/balance";
import type { WalletDto } from "../../lib/custody-api";

/**
 * Back in, with the one number that matters and the door to the rest.
 *
 * The balance is the whole reason this screen is careful: `raw` is null when the chain could not
 * be read, and that is not a zero. An empty wallet reads "0.00"; an unread one says so.
 */
export function WelcomeStep({
  title,
  handle,
  wallet,
  destination,
}: {
  /** From `welcomeTitle`: a new account's, or WELCOME BACK for one that already existed. */
  title: string;
  /** May be empty: the sign-in rail never asks for a name, so the shell supplies it or does not. */
  handle: string;
  /** Null when GET /wallets/me has not answered, or answered 404 for an account with no wallet. */
  wallet: WalletDto | null;
  /** The door to the rest: the studio, or wherever the guard turned them away from. */
  destination: string;
}) {
  const token = formatBalance(wallet?.balances.token);
  const native = formatBalance(wallet?.balances.native);

  return (
    <div className={styles.flowStep}>
      <h1 className={styles.flowTitle}>{title}</h1>
      {handle && <p className={styles.flowLead}>@{handle.toUpperCase()}</p>}

      <div className={styles.balanceCard}>
        <p className={styles.balanceLabel}>
          MASTER WALLET
          <span className={styles.balanceLock}>
            <Icon name="lock" size={11} />
            PASSKEY TO MOVE
          </span>
        </p>

        {token === null ? (
          <p className={styles.balanceUnknown}>
            We could not read this wallet&apos;s balance just now. Nothing has moved — try again in
            a moment.
          </p>
        ) : (
          <>
            <p className={styles.balance}>
              {token}
              <span>{wallet?.balances.token.symbol}</span>
            </p>
            {native !== null && (
              <p className={styles.balanceSecondary}>
                + {native} {wallet?.balances.native.symbol}
              </p>
            )}
          </>
        )}
      </div>

      <ButtonLink href={destination} className={styles.primary} variant="primary" arrow>
        Open the studio
      </ButtonLink>
    </div>
  );
}
