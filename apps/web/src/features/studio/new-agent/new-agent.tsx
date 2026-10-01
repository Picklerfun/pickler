"use client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Icon, Tag } from "@pickler/ui";
import { SecondPasskey } from "@/features/auth/components/second-passkey";
import type { PasskeysKnown } from "@/features/auth/lib/second-passkey";
import { accentVars } from "@/lib/accent";
import {
  agentState,
  confirmDelegated,
  confirmPolicies,
  confirmWallet,
  createDraft,
  errorCode,
  handleAvailable,
  prepareDelegated,
  preparePolicies,
  prepareWallet,
  studioWallets,
  type StudioWallets,
} from "../api";
import { relyingParty, stampActivity } from "../lib/passkey";
import { menuAccess } from "../home/access";
import { HomeMenu } from "../home/menu";
import { RAIL } from "../sections/rail";
import shell from "../studio.module.css";
import home from "../home/home.module.css";
import { Advanced } from "./advanced";
import { AvatarPicker } from "./avatar-picker";
import { NoSubOrganization, createAgent, createWallet, type UnsignedActivity } from "./ceremony";
import { CreditsModal } from "./credits-modal";
import type { NewAgentStaged } from "./fixture";
import { AvatarGrid, Identity } from "./identity";
import {
  canCreate,
  createLabel,
  deriveHandle,
  emptyForm,
  footNote,
  formatUnits,
  handleState,
  toDraftRequest,
  unlinkedWallet,
  validHandle,
  walletSheetStep,
  type NewAgentForm,
  type Token,
  type WalletView,
} from "./model";
import { PasskeySheet, type SheetPhase } from "./passkey-sheet";
import { Reads } from "./reads";
import { Voice } from "./voice";
import { WalletPanel } from "./wallet-panel";
import { WalletsModal } from "./wallets-modal";
import styles from "./new-agent.module.css";

/** The two names a WebAuthn prompt fails with when the person closed it or it timed out. */
const CLOSED_PROMPT = new Set(["NotAllowedError", "AbortError"]);
/** How long the sheet shows its "done" before it closes. */
const DONE_MS = 650;

type Sheet = { kind: "wallet" | "create"; phase: SheetPhase; step: 1 | 2 };
type Modal = null | "wallets" | "credits" | "avatar";

/** The wallets with their balances, and whether Pickler's delegated user exists yet. */
const readWallets = () => Promise.all([studioWallets(), agentState()]);
const stamp = async (unsigned: UnsignedActivity) => stampActivity(await relyingParty(), unsigned);
const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const closedPrompt = (caught: unknown) => caught instanceof Error && CLOSED_PROMPT.has(caught.name);
const failure = (caught: unknown, fallback: string) =>
  caught instanceof Error && caught.message ? caught.message : fallback;

/** The wallet sheet closed while step 2 waited for its Continue. The wallet is kept. */
class StepTwoClosed extends Error {
  constructor() {
    super("Step 2 was closed before it was continued.");
    this.name = "StepTwoClosed";
  }
}

/** What a refresh found that the last read did not: "{delta} AUSD arrived". */
function arrived(before: WalletView, after: WalletView, at: string) {
  const found: { text: string; at: string }[] = [];
  const check = (token: Token, was: bigint | null, now: bigint | null) => {
    if (was !== null && now !== null && now > was) {
      found.push({ text: `${formatUnits(now - was, token)} ${token} arrived`, at });
    }
  };
  check("AUSD", before.ausdMicro, after.ausdMicro);
  check("MON", before.monWei, after.monWei);
  return found;
}

/**
 * The create screen ("Pickler Studio Empty v5", docs/specs/studio-create-simplified-v1.md §3): the
 * top bar and the disabled rail, the brief column (name and handle, avatar, voice, what it reads,
 * advanced settings) and the agent's wallet beside it. The wallet is made and funded first; then
 * "Create {name}" signs the wallet's policies with one passkey and creates the agent as a draft.
 * Every rule is in `model.ts` and every signature order in `ceremony.ts`; this file holds the
 * state and the transport.
 */
export function NewAgent({
  passkeys,
  canManage,
  preview,
  locked,
  error,
  staged,
  hasAgents,
  onCreated,
}: {
  passkeys: PasskeysKnown;
  canManage: boolean;
  /** A staged or fixture studio, which says so. Nothing on it is sent. */
  preview: boolean;
  /** Why creating is closed on this workspace (research not enabled), or null when it is open. */
  locked: { title: string; note: string } | null;
  error: string;
  staged: NewAgentStaged | null;
  /** The person has agents already: "+ New agent" opened this, not the first visit. */
  hasAgents: boolean;
  /** The draft exists: reload the agents and open its home. */
  onCreated(productId: string): Promise<void>;
}) {
  const researchLock = locked ? `${locked.title} ${locked.note}` : "";
  const access = menuAccess({
    hasAgent: hasAgents,
    canManage,
    researchLock,
    fundLock: "",
    draftLock: "",
  });

  const [form, setForm] = useState<NewAgentForm>(staged?.form ?? emptyForm());
  const [availability, setAvailability] = useState<{
    handle: string;
    available: boolean | "failed";
  } | null>(
    staged
      ? { handle: deriveHandle(staged.form.name, staged.form.handle), available: staged.available }
      : null,
  );
  /* Bumped by the handle's "Try again", to ask the availability check once more. */
  const [recheck, setRecheck] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(staged?.advancedOpen ?? false);
  const [wallet, setWallet] = useState<WalletView | null>(staged?.wallet ?? null);
  const [policiesApproved, setPoliciesApproved] = useState(false);
  /* Whether Pickler's delegated user exists; null until read. Without it a wallet is half made. */
  const [delegated, setDelegated] = useState<boolean | null>(staged ? !staged.firstTime : null);
  const [wallets, setWallets] = useState<StudioWallets | null>(staged?.wallets ?? null);
  /* The last balances read, to tell what a refresh found that was not there before. */
  const lastRead = useRef<WalletView | null>(staged?.wallet ?? null);
  const [checkedAt, setCheckedAt] = useState("");
  const [arrivals, setArrivals] = useState<{ text: string; at: string }[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(
    staged?.sheet ? { kind: staged.sheet, phase: "idle", step: 1 } : null,
  );
  const [modal, setModal] = useState<Modal>(staged?.modal ?? null);
  const [fundOn, setFundOn] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState("");
  /* The draft the API answered for. From here on the button opens it and never creates again. */
  const [created, setCreated] = useState<string | null>(null);
  /* The wallet sheet's second Continue: set while step 2 waits for it. */
  const step2 = useRef<{ resolve(): void; reject(reason: Error): void } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      step2.current?.reject(new StepTwoClosed());
    };
  }, []);

  const handle = deriveHandle(form.name, form.handle);
  /* The handle check, debounced as the brief did it. */
  useEffect(() => {
    if (preview || !validHandle(handle)) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      handleAvailable(handle).then(
        (answer) => {
          if (active) {
            setAvailability({ handle, available: answer.available });
          }
        },
        () => {
          if (active) {
            setAvailability({ handle, available: "failed" });
          }
        },
      );
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [handle, preview, recheck]);

  /* The wallets and the delegated user, as a read found them. A wallet with no agent yet is this
     screen's: a reload mid-setup finds it here. */
  const apply = useCallback((list: StudioWallets, state: { hasDelegatedUser: boolean }) => {
    const at = clock(list.readAt);
    const found = unlinkedWallet(list);
    setWallets(list);
    setDelegated(state.hasDelegatedUser);
    setCheckedAt(at);
    const before = lastRead.current;
    if (before && found && before.walletId === found.wallet.walletId) {
      const news = arrived(before, found.wallet, at);
      if (news.length) {
        setArrivals((current) => [...news, ...current]);
      }
    }
    lastRead.current = found?.wallet ?? null;
    setWallet(found?.wallet ?? null);
    setPoliciesApproved(found?.policiesApproved ?? false);
  }, []);
  const unread = useCallback((caught: unknown) => {
    setActionError(failure(caught, "Your wallets could not be read. Refresh to try again."));
  }, []);

  useEffect(() => {
    if (preview) {
      return;
    }
    let active = true;
    readWallets().then(
      ([list, state]) => {
        if (active) {
          apply(list, state);
        }
      },
      (caught: unknown) => {
        if (active) {
          unread(caught);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [apply, unread, preview]);

  async function refresh() {
    if (preview) {
      return;
    }
    setRefreshing(true);
    try {
      const [list, state] = await readWallets();
      if (mounted.current) {
        apply(list, state);
      }
    } catch (caught) {
      if (mounted.current) {
        unread(caught);
      }
    } finally {
      if (mounted.current) {
        setRefreshing(false);
      }
    }
  }

  const available = availability?.handle === handle ? availability.available : null;
  const nameState = handleState(handle, available);
  /* A wallet without Pickler's delegated user is not ready: "Create its wallet" finishes it. */
  const ready = delegated === false ? null : wallet;
  const firstTime = delegated === false;
  /* Step 2 was cancelled: the wallet exists, its delegated user does not. */
  const resumeStep = walletSheetStep(wallet, delegated);
  const busy = sheet?.phase === "busy";
  const creatable =
    !preview && access.create && created === null && canCreate(form, nameState, ready);
  const disabled = busy || created !== null;

  function edit(next: NewAgentForm) {
    setForm(next);
    setActionError("");
  }

  function finish(then: () => void) {
    setSheet((current) => current && { ...current, phase: "ok" });
    setTimeout(() => {
      if (mounted.current) {
        setSheet(null);
        then();
      }
    }, DONE_MS);
  }

  async function runWallet() {
    setActionError("");
    setSheet({ kind: "wallet", phase: "busy", step: resumeStep });
    try {
      await createWallet({
        state: agentState,
        stamp,
        prepareWallet,
        confirmWallet,
        prepareDelegated,
        confirmDelegated: async (signed) => {
          await confirmDelegated(signed);
        },
        onStep: (step) => setSheet({ kind: "wallet", phase: "busy", step }),
        beforeStep2: () =>
          new Promise<void>((resolve, reject) => {
            step2.current = { resolve, reject };
            setSheet({ kind: "wallet", phase: "idle", step: 2 });
          }),
      });
      setDelegated(true);
      finish(() => void refresh());
    } catch (caught) {
      step2.current = null;
      if (!mounted.current) {
        return;
      }
      if (closedPrompt(caught)) {
        setSheet((current) => current && { ...current, phase: "err" });
        // A cancelled step 2 left the wallet: read it, so "Try again" starts at step 2.
        void refresh();
        return;
      }
      setSheet(null);
      if (!(caught instanceof StepTwoClosed)) {
        setActionError(
          caught instanceof NoSubOrganization
            ? caught.message
            : failure(caught, "Its wallet could not be created."),
        );
      }
      // Whatever step 1 made is kept: the panel shows it, or offers step 2 for it.
      void refresh();
    }
  }

  async function runCreate() {
    if (!ready || !creatable) {
      return;
    }
    setActionError("");
    setSheet({ kind: "create", phase: "busy", step: 1 });
    let productId: string;
    try {
      ({ productId } = await createAgent(
        {
          stamp,
          preparePolicies,
          confirmPolicies: async (walletId, signed) => {
            const answer = await confirmPolicies(walletId, signed);
            // Approved now: a retry after a failed draft must not write them twice.
            setPoliciesApproved(true);
            return answer;
          },
          createDraft: () => createDraft(toDraftRequest(form, ready.walletId)),
        },
        { walletId: ready.walletId, policiesApproved },
      ));
    } catch (caught) {
      if (!mounted.current) {
        return;
      }
      if (closedPrompt(caught)) {
        setSheet((current) => current && { ...current, phase: "err" });
        return;
      }
      setSheet(null);
      if (errorCode(caught) === "HANDLE_TAKEN") {
        setAvailability({ handle, available: false });
      }
      if (errorCode(caught) === "WALLET_UNDERFUNDED") {
        void refresh();
      }
      setActionError(failure(caught, `${form.name.trim()} could not be created.`));
      return;
    }
    setCreated(productId);
    finish(() => void open(productId));
  }

  /* Only the reload: the draft exists, and a failure here is not a failure to create it. */
  async function open(productId: string) {
    try {
      await onCreated(productId);
    } catch {
      if (mounted.current) {
        setActionError(`${form.name.trim()} was created but did not open. Press to open it.`);
      }
    }
  }

  function startWallet() {
    if (preview || busy || !access.create) {
      return;
    }
    /* A wallet step 1 already made opens at step 2: that is all that is left. */
    setSheet({ kind: "wallet", phase: "idle", step: resumeStep });
  }

  function onContinue() {
    if (preview || !sheet) {
      return;
    }
    if (sheet.kind === "wallet" && step2.current) {
      const gate = step2.current;
      step2.current = null;
      setSheet({ kind: "wallet", phase: "busy", step: 2 });
      gate.resolve();
      return;
    }
    if (sheet.phase === "busy" || sheet.phase === "ok") {
      return;
    }
    void (sheet.kind === "wallet" ? runWallet() : runCreate());
  }

  function onCloseSheet() {
    if (busy) {
      return;
    }
    const wasWallet = sheet?.kind === "wallet";
    setSheet(null);
    if (step2.current) {
      // runWallet's catch reads the wallets again.
      const gate = step2.current;
      step2.current = null;
      gate.reject(new StepTwoClosed());
    } else if (wasWallet) {
      // Whatever the sheet made is kept; the panel must know it, to offer step 2 only.
      void refresh();
    }
  }

  function press() {
    if (created) {
      void open(created);
      return;
    }
    if (creatable) {
      setSheet({ kind: "create", phase: "idle", step: 1 });
    }
  }

  const name = form.name.trim();
  const sheetCopy =
    sheet?.kind === "create"
      ? {
          title: `Create ${name}?`,
          body: `SETS ITS CAPS · ${form.perTrade} / ${form.perDay} AUSD · ${form.leverage}× · IT CAN ONLY TRADE ON PERPL AND CAN'T WITHDRAW · PICKLER HOLDS EVERY TRADE TO THESE CAPS`,
          done: `${name} is yours`,
        }
      : sheet?.step === 2
        ? {
            title: "Let Pickler trade from it?",
            body: `INSIDE THE CAPS ONLY · NEVER WITHDRAW${firstTime ? " · 2 OF 2" : ""}`,
            done: "Wallet ready",
          }
        : {
            title: name ? `Create ${name}'s wallet?` : "Create its wallet?",
            body: `UNDER YOUR PASSKEY · ONLY THIS AGENT USES IT${firstTime ? " · 1 OF 2" : ""}`,
            done: "Wallet ready",
          };

  return (
    <main className={home.home} id="home-empty" data-surface="dark">
      <header className={home.top}>
        <Link href="/" className={home.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
          <span>PICKLER</span>
        </Link>
        {name ? (
          <span className={home.agentChip}>
            <span className={styles.chipAvatar} style={accentVars(form.accent)} aria-hidden="true">
              <AvatarGrid pattern={form.pattern} small />
            </span>
            <b>{name}</b>
            {handle && <small>@{handle}</small>}
          </span>
        ) : (
          <span className={home.noAgent}>
            <span className={home.noAgentMark} aria-hidden="true">
              +
            </span>
            <b>{hasAgents ? "New agent" : "No agent yet"}</b>
          </span>
        )}
        <span className={home.spacer} />
        <span className={home.pill} data-tint="grey">
          TESTNET
        </span>
        <span className={home.emptyMenu}>
          <HomeMenu
            agent={null}
            agents={[]}
            calls={0}
            running={false}
            canManage={canManage}
            researchLock={researchLock}
            onSection={noSection}
            onSwitch={noSection}
          />
        </span>
        <Link href="/account" className={home.account} aria-label="Account">
          <span className={shell.swatch} aria-hidden="true">
            <i data-swatch="lime" />
            <i data-swatch="violet" />
            <i data-swatch="amber" />
            <i data-swatch="blue" />
          </span>
        </Link>
      </header>

      <div className={home.emptyBody}>
        <nav className={home.emptyRail} aria-label="Studio sections">
          {/* The same sections the shell's rail draws, every row disabled until an agent exists. */}
          {RAIL.map((group) => (
            <div key={group.title}>
              <p className={shell.railTitle}>{group.title}</p>
              <div className={shell.railItems}>
                {group.items.map((item) => (
                  <span
                    key={item.key}
                    className={home.emptyRailItem}
                    title={access.sectionNote}
                    aria-disabled="true"
                  >
                    <Icon name={item.icon} size={17} />
                    <span className={shell.railLabel}>{item.label}</span>
                    {item.soon && <Tag className={home.soon}>SOON</Tag>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={home.emptyMain}>
          <section className={styles.column} aria-labelledby="new-agent-title">
            {preview && (
              <p className={styles.previewNote} role="status">
                <Icon name="alert" size={13} />
                Design preview. This screen is drawn from a fixture; nothing on it can be sent or
                saved.
              </p>
            )}
            {error && (
              <p className={styles.alert} role="alert">
                <Icon name="alert" size={13} />
                {error}
              </p>
            )}
            <SecondPasskey passkeys={passkeys} id="home-second-passkey" />

            <p className={styles.kicker}>
              {hasAgents ? "A NEW AGENT" : "YOUR FIRST AGENT"} · SET UP ITS TRADING STRATEGY
            </p>
            <Identity
              form={form}
              handle={nameState}
              disabled={disabled}
              onChange={edit}
              onAvatar={() => setModal("avatar")}
              onRecheck={() => {
                setAvailability(null);
                setRecheck((count) => count + 1);
              }}
            />
            <Voice form={form} disabled={disabled} onChange={edit} />
            <Reads form={form} disabled={disabled} onChange={edit} />
            <Advanced
              form={form}
              open={advancedOpen}
              disabled={disabled}
              onToggle={() => setAdvancedOpen((current) => !current)}
              onChange={edit}
            />

            {access.createNote && <p className={home.newAgentNote}>{access.createNote}</p>}
            <div className={styles.create}>
              {/* aria-disabled, not disabled: a shut button stays focusable, so its label (the
                  reason it is shut) is announced. press() refuses while shut. */}
              <Button
                variant="primary"
                size="lg"
                block
                aria-disabled={created ? busy : !creatable}
                onClick={press}
              >
                {created ? `Open ${name}` : createLabel(form, nameState, ready)}
              </Button>
            </div>
            <p className={styles.foot}>{footNote(ready)}</p>
            {actionError && (
              <p className={styles.alert} role="alert">
                <Icon name="alert" size={13} />
                {actionError}
              </p>
            )}
          </section>

          <WalletPanel
            wallet={ready}
            firstTime={firstTime}
            pendingDelegate={resumeStep === 2}
            form={form}
            checkedAt={checkedAt}
            arrivals={arrivals}
            busy={busy || refreshing}
            preview={preview}
            onCreateWallet={startWallet}
            onRefresh={() => void refresh()}
            onFund={() => {
              if (ready) {
                setFundOn(ready.walletId);
                setModal("wallets");
              }
            }}
          />
        </div>
      </div>

      <PasskeySheet
        open={sheet !== null}
        title={sheetCopy.title}
        body={sheetCopy.body}
        done={sheetCopy.done}
        phase={sheet?.phase ?? "idle"}
        twoStep={sheet?.kind === "wallet" && firstTime}
        step={sheet?.step ?? 1}
        onContinue={onContinue}
        onClose={onCloseSheet}
      />
      <WalletsModal
        open={modal === "wallets"}
        wallets={wallets}
        openOn={fundOn}
        preview={preview}
        onClose={() => {
          setModal(null);
          setFundOn(null);
        }}
        onMoved={() => void refresh()}
      />
      <CreditsModal open={modal === "credits"} onClose={() => setModal(null)} />
      <AvatarPicker
        open={modal === "avatar"}
        form={form}
        onChange={edit}
        onClose={() => setModal(null)}
      />
    </main>
  );
}

/* Every section and every switch needs an agent; the Menu disables them, so nothing calls these. */
function noSection(): void {}
