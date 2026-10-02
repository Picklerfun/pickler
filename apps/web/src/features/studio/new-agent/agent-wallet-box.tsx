"use client";
import { useId } from "react";
import { Button, Icon, Segmented } from "@pickler/ui";
import type { StudioWallets } from "../api";
import { accentVars } from "@/lib/accent";
import { AvatarGrid } from "./identity";
import { formatUnits, unitsOf, type Accent, type Token } from "./model";
import {
  agentWalletTag,
  canMove,
  moveNote,
  moveSource,
  transferLabel,
  type Move,
} from "./transfer-model";
import styles from "./new-agent.module.css";

const TOKENS = [
  { value: "AUSD", label: "AUSD" },
  { value: "MON", label: "MON" },
] as const;

export interface AgentWalletBoxProps {
  agent: StudioWallets["agents"][number];
  wallets: StudioWallets;
  name: string;
  /** This screen's agent, drawn with its own avatar before an agent has the wallet. */
  avatar: { accent: Accent; pattern: number } | null;
  /** The move form is showing, in this direction; null when it is closed. */
  moving: { toAgent: boolean } | null;
  token: Token;
  amount: string;
  /** MAX filled a MON amount and kept the gas reserve back. */
  keptForGas: boolean;
  error: string;
  copied: boolean;
  preview: boolean;
  onPick(toAgent: boolean): void;
  onToken(token: Token): void;
  onAmount(text: string): void;
  onMax(held: bigint | null): void;
  onSend(move: Move): void;
  onCancel(): void;
  onCopy(): void;
}

/**
 * One agent wallet in "Your wallets": its name, address, tag, balances and caps, "Fund from
 * master" and "Pull back to master", and the move form when one is open. The rules are
 * `transfer-model.ts`'s; the state is the modal's.
 */
export function AgentWalletBox({
  agent,
  wallets,
  name,
  avatar,
  moving,
  token,
  amount,
  keptForGas,
  error,
  copied,
  preview,
  onPick,
  onToken,
  onAmount,
  onMax,
  onSend,
  onCancel,
  onCopy,
}: AgentWalletBoxProps) {
  const formId = useId();
  const noteId = useId();
  const toAgent = moving?.toAgent ?? true;
  const move: Move = { walletId: agent.walletId, toAgent, token };
  const held = moveSource(wallets, move);
  const input = { amount, token, toAgent, held, agentName: name };
  const label = transferLabel(input);
  const ok = canMove(input);
  const over = label.startsWith("More");

  return (
    <div className={styles.walletBox}>
      <div className={styles.walletBoxHead}>
        {avatar ? (
          <span
            className={styles.walletMark}
            data-accent="true"
            style={accentVars(avatar.accent)}
            aria-hidden="true"
          >
            <AvatarGrid pattern={avatar.pattern} small />
          </span>
        ) : (
          <span className={styles.walletMark} aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className={styles.walletBoxName}>
          <b>
            {name} <i>· agent wallet</i>
          </b>
          <small title={agent.address}>{agent.address}</small>
        </span>
        <span className={styles.walletTag} data-tone={agent.agentId ? undefined : "quiet"}>
          {agentWalletTag(agent)}
        </span>
        <button
          type="button"
          className={styles.chipButton}
          aria-label={copied ? `${name}'s address copied` : `Copy ${name}'s address`}
          onClick={onCopy}
        >
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <div className={styles.tiles}>
        <span className={styles.tile}>
          <b>{formatUnits(unitsOf(agent.ausdMicro), "AUSD")}</b>
          <small>AUSD · TRADES</small>
        </span>
        <span className={styles.tile}>
          <b>{formatUnits(unitsOf(agent.monWei), "MON")}</b>
          <small>MON · GAS</small>
        </span>
      </div>
      {agent.caps && (
        <div className={styles.row}>
          <small>CAPS · TRADE / DAY / LEV</small>
          <b>{`${agent.caps.perTradeAusd} / ${agent.caps.perDayAusd} / ${agent.caps.maxLeverage}×`}</b>
        </div>
      )}
      <div className={styles.moveButtons}>
        <button
          type="button"
          className={styles.direction}
          data-fund={agent.walletId}
          aria-expanded={moving !== null && toAgent}
          aria-controls={formId}
          disabled={preview}
          onClick={() => onPick(true)}
        >
          <Icon name="arrowUp" size={12} />
          Fund from master
        </button>
        <button
          type="button"
          className={styles.direction}
          aria-expanded={moving !== null && !toAgent}
          aria-controls={formId}
          disabled={preview}
          onClick={() => onPick(false)}
        >
          <Icon name="arrowDown" size={12} />
          Pull back to master
        </button>
      </div>
      {moving && (
        <div className={styles.move} id={formId}>
          <div className={styles.moveRow}>
            <Segmented
              label="Token"
              className={styles.tokenSwitch}
              options={TOKENS}
              value={token}
              onChange={onToken}
            />
            <span className={styles.amountField} data-bad={over}>
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Amount in ${token}`}
                aria-invalid={over}
                aria-describedby={noteId}
                placeholder="0"
                data-amount={agent.walletId}
                value={amount}
                onChange={(event) => onAmount(event.target.value)}
              />
              <button
                type="button"
                className={styles.chipButton}
                aria-label={`Fill the most ${token} the source can send`}
                disabled={held === null}
                onClick={() => onMax(held)}
              >
                MAX
              </button>
              <small>{token}</small>
            </span>
          </div>
          <div className={styles.moveButtons}>
            <Button block disabled={!ok || preview} onClick={() => onSend(move)}>
              {label}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          <span className={styles.moveNote} id={noteId}>
            {moveNote({ toAgent, held, token, keptForGas })}
          </span>
          {error && (
            <p className={styles.alert} role="alert">
              <Icon name="alert" size={13} />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
