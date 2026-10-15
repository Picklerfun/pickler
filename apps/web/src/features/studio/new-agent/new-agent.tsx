"use client";
import { useStudioForm } from "../routing/memory";

import { StudioAccessRequest } from "../access-request";
import { useEffect, useRef, useState } from "react";
import { Button, Icon } from "@pickler/ui";
import { SecondPasskey } from "@/features/auth/components/second-passkey";
import type { PasskeysKnown } from "@/features/auth/lib/second-passkey";
import {
  StudioError,
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
} from "../api";
import { relyingParty, stampActivity } from "../lib/passkey";
import { menuAccess } from "../home/access";
import home from "../home/home.module.css";
import { Advanced } from "./advanced";
import { AvatarPicker } from "./avatar-picker";
import { NoSubOrganization, createAgent, createWallet, type UnsignedActivity } from "./ceremony";
import { Chrome } from "./chrome";
import { CreditsModal } from "./credits-modal";
import type { NewAgentStaged } from "./fixture";
import { Identity } from "./identity";
import {
  canCreate,
  createLabel,
  deriveHandle,
  emptyForm,
  footNote,
  handleState,
  sheetCopy,
  toDraftRequest,
  unitsOf,
  validHandle,
  walletLockNote,
  walletOutlined,
  walletSheetStep,
  type NewAgentForm,
} from "./model";
import { PasskeySheet, type SheetPhase } from "./passkey-sheet";
import { TradingMarkets, useTradingMarkets } from "../shell/trading-markets";
import { Reads } from "./reads";
import { useAgentWallet } from "./use-agent-wallet";
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

const stamp = async (unsigned: UnsignedActivity) => stampActivity(await relyingParty(), unsigned);
const closedPrompt = (caught: unknown) => caught instanceof Error && CLOSED_PROMPT.has(caught.name);
/* Only our own words reach the screen: the studio's message for a code, or the missing
   sub-organization's. Anything else (a network error, a bug) gets the fallback. */
const failure = (caught: unknown, fallback: string) =>
  (caught instanceof StudioError || caught instanceof NoSubOrganization) && caught.message
    ? caught.message
    : fallback;

/** The wallet sheet closed while step 2 waited for its Continue. The wallet is kept. */
class StepTwoClosed extends Error {
  constructor() {
    super("Step 2 was closed before it was continued.");
    this.name = "StepTwoClosed";
  }
}

/**
 * The create screen ("Pickler Studio Empty v5", docs/specs/studio-create-simplified-v1.md §3): the
 * frame (`chrome.tsx`), the brief column (name and handle, avatar, voice, what it reads, advanced
 * settings) and the agent's wallet beside it. The wallet is made and funded first; then
 * "Create {name}" signs the wallet's policies with one passkey and creates the agent as a draft.
 * Every rule is in `model.ts`, every signature order in `ceremony.ts` and the wallet reads in
 * `use-agent-wallet.ts`; this file holds the screen's state and the transport.
 *
 * A ceremony that was already signed finishes even if the person leaves the screen: its requests
 * are not aborted on unmount, so a stamped wallet, delegated user or policy set always reaches the
 * server. Only the screen's own state stops updating.
 */
export function NewAgent({
  passkeys,
  accountHandle,
  canManage,
  preview: previewProp,
  locked,
  error,
  staged,
  hasAgents,
  draftLock = "",
  onBack,
  backTo,
  onCreated,
}: {
  passkeys: PasskeysKnown;
  accountHandle: string | null;
  canManage: boolean;
  /** A staged or fixture studio, which says so. Nothing on it is sent. */
  preview: boolean;
  /** Why creating is closed on this workspace (research not enabled), or null when it is open. */
  locked: { title: string; note: string } | null;
  error: string;
  staged: NewAgentStaged | null;
  /** The person has agents already: "+ New agent" opened this, not the first visit. */
  hasAgents: boolean;
  /**
   * The draft limit's note (`draftLimitLock` in `home/gate.ts`), or "". At the limit the wallet
   * step and Create are shut before any money moves: the API would refuse the draft at the end.
   */
  draftLock?: string | undefined;
  /** Back to the agent the person came from; absent on a first visit, where there is none. */
  onBack?: (() => void) | undefined;
  /** That agent's name, for "Back to {name}". */
  backTo?: string | undefined;
  /** The draft exists: reload the agents and open its home. */
  onCreated(productId: string): Promise<void>;
}) {
  /* A staged screen is a preview whatever the shell said: nothing drawn from a fixture is sent. */
  const preview = previewProp || staged !== null;
  const researchLock = locked ? `${locked.title} ${locked.note}` : "";
  const access = menuAccess({
    hasAgent: hasAgents,
    canManage,
    researchLock,
    fundLock: "",
    draftLock,
  });

  const [form, setForm] = useStudioForm<NewAgentForm>(
    "create:form",
    0,
    staged?.form ?? emptyForm(),
  );
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
  const reads = useAgentWallet(preview, staged);
  const marketNetwork =
    reads.wallets?.chainId === 143
      ? "mainnet"
      : reads.wallets?.chainId === 10143
        ? "testnet"
        : null;
  const catalogue = useTradingMarkets(marketNetwork, preview);
  const [sheet, setSheet] = useState<Sheet | null>(staged?.sheet ?? null);
  const [modal, setModal] = useState<Modal>(staged?.modal ?? null);
  const [fundOn, setFundOn] = useState<string | null>(staged?.fundOn ?? null);
  const [actionError, setActionError] = useState("");
  /* The draft the API answered for. From here on the button opens it and never creates again. */
  const [created, setCreated] = useState<string | null>(null);
  /* The wallet sheet's second Continue: set while step 2 waits for it. */
  const step2 = useRef<{ resolve(): void; reject(reason: Error): void } | null>(null);
  /* A ceremony or an open is in flight: a second press starts nothing. */
  const running = useRef(false);
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

  const available = availability?.handle === handle ? availability.available : null;
  const nameState = handleState(handle, available);
  /* A wallet without Pickler's delegated user is not ready: "Create its wallet" finishes it. */
  const ready = reads.delegated === false ? null : reads.wallet;
  const firstTime = reads.delegated === false;
  /* Step 2 was cancelled: the wallet exists, its delegated user does not. */
  const resumeStep = walletSheetStep(reads.wallet, reads.delegated);
  const busy = sheet?.phase === "busy";
  /* Whether the button reads as open. A preview draws it as the person would see it, and
     `creatable` still refuses the press there. */
  const drawnOpen =
    access.create &&
    catalogue.allows(form.markets) &&
    created === null &&
    canCreate(form, nameState, ready, draftLock);
  const creatable = !preview && drawnOpen;
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
    if (running.current) {
      return;
    }
    running.current = true;
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
      reads.delegate();
      finish(() => void reads.refresh());
    } catch (caught) {
      step2.current = null;
      if (!mounted.current) {
        return;
      }
      // Whatever step 1 made is kept: read it, so the panel and "Try again" start at step 2.
      void reads.refresh();
      if (closedPrompt(caught)) {
        setSheet((current) => current && { ...current, phase: "err" });
        return;
      }
      setSheet(null);
      if (!(caught instanceof StepTwoClosed)) {
        setActionError(failure(caught, "Its wallet could not be created."));
      }
    } finally {
      running.current = false;
    }
  }

  async function runCreate() {
    if (!ready || !creatable || running.current) {
      return;
    }
    running.current = true;
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
            // Approved now, and for good: a retry after a failed draft must not write them twice.
            reads.approve(walletId);
            return answer;
          },
          createDraft: () => createDraft(toDraftRequest(form, ready.walletId)),
        },
        { walletId: ready.walletId, policiesApproved: reads.policiesApproved },
      ));
    } catch (caught) {
      running.current = false;
      if (!mounted.current) {
        return;
      }
      if (closedPrompt(caught)) {
        setSheet((current) => current && { ...current, phase: "err" });
        return;
      }
      setSheet(null);
      // A confirm whose answer was lost may have approved the policies: the server knows.
      void reads.refresh();
      if (errorCode(caught) === "HANDLE_TAKEN") {
        setAvailability({ handle, available: false });
      }
      setActionError(failure(caught, `${form.name.trim()} could not be created.`));
      return;
    }
    setCreated(productId);
    finish(() => {
      running.current = false;
      void open(productId);
    });
  }

  /* Only the reload: the draft exists, and a failure here is not a failure to create it. */
  async function open(productId: string) {
    if (running.current) {
      return;
    }
    running.current = true;
    try {
      await onCreated(productId);
    } catch {
      if (mounted.current) {
        setActionError(`${form.name.trim()} was created but did not open. Press to open it.`);
      }
    } finally {
      running.current = false;
    }
  }

  function startWallet() {
    if (preview || busy || running.current || !access.create || draftLock) {
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
      void reads.refresh();
    }
  }

  function press() {
    if (created) {
      void open(created);
      return;
    }
    if (creatable && !running.current) {
      setSheet({ kind: "create", phase: "idle", step: 1 });
    }
  }

  const name = form.name.trim();
  const copy = sheetCopy({
    kind: sheet?.kind ?? "wallet",
    step: sheet?.step ?? 1,
    firstTime,
    form,
  });

  return (
    <Chrome
      accountHandle={accountHandle}
      preview={preview}
      form={form}
      handle={handle}
      hasAgents={hasAgents}
      canManage={canManage}
      researchLock={researchLock}
      sectionNote={access.sectionNote}
      staged={staged !== null}
      back={onBack ? { to: backTo ?? "your agent", disabled, onBack } : null}
      master={
        reads.wallets && {
          ausdMicro: unitsOf(reads.wallets.master.ausdMicro),
          monWei: unitsOf(reads.wallets.master.monWei),
        }
      }
      onWallets={() => {
        setFundOn(null);
        setModal("wallets");
      }}
      onCredits={() => setModal("credits")}
      overlays={
        <>
          <PasskeySheet
            id="new-agent-sheet"
            open={sheet !== null}
            title={copy.title}
            body={copy.body}
            done={copy.done}
            phase={sheet?.phase ?? "idle"}
            twoStep={sheet?.kind === "wallet" && firstTime}
            step={sheet?.step ?? 1}
            onContinue={onContinue}
            onClose={onCloseSheet}
          />
          <WalletsModal
            open={modal === "wallets"}
            wallets={reads.wallets}
            openOn={fundOn}
            draft={
              reads.wallet && {
                walletId: reads.wallet.walletId,
                name,
                accent: form.accent,
                pattern: form.pattern,
              }
            }
            preview={preview}
            onClose={() => {
              setModal(null);
              setFundOn(null);
            }}
            onCredits={() => {
              setFundOn(null);
              setModal("credits");
            }}
            onRefresh={reads.refresh}
            onMoved={() => void reads.refresh()}
          />
          <CreditsModal
            open={modal === "credits"}
            onClose={() => setModal(null)}
            onWallets={() => setModal("wallets")}
          />
          <AvatarPicker
            open={modal === "avatar"}
            form={form}
            onChange={edit}
            onClose={() => setModal(null)}
          />
        </>
      }
    >
      <section className={styles.column} aria-labelledby="new-agent-title">
        {preview && (
          <p className={styles.previewNote} role="status">
            <Icon name="alert" size={13} />
            Design preview. This screen is drawn from a fixture; nothing on it can be sent or saved.
          </p>
        )}
        {error && (
          <p className={styles.alert} role="alert">
            <Icon name="alert" size={13} />
            {error}
          </p>
        )}
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
        <TradingMarkets
          read={catalogue}
          network={marketNetwork}
          value={form.markets}
          disabled={disabled}
          onChange={(markets) => edit({ ...form, markets })}
        />
        <Advanced
          form={form}
          open={advancedOpen}
          disabled={disabled}
          onToggle={() => setAdvancedOpen((current) => !current)}
          onChange={edit}
        />

        <SecondPasskey passkeys={passkeys} id="home-second-passkey" />

        {!locked && access.createNote && <p className={home.newAgentNote}>{access.createNote}</p>}
        <div className={styles.create}>
          {/* aria-disabled, not disabled: a shut button stays focusable, so its label (the
              reason it is shut) is announced. press() refuses while shut. */}
          <Button
            variant="primary"
            size="lg"
            block
            aria-disabled={created ? busy : !drawnOpen}
            onClick={press}
          >
            {created ? `Open ${name}` : createLabel(form, nameState, ready, draftLock)}
          </Button>
        </div>
        <p className={styles.foot}>{footNote(ready)}</p>
        {actionError && (
          <p className={styles.alert} role="alert">
            <Icon name="alert" size={13} />
            {actionError}
          </p>
        )}
        {reads.error && (
          <p className={styles.alert} role="alert">
            <Icon name="alert" size={13} />
            {reads.error}
          </p>
        )}
      </section>

      <WalletPanel
        accessRequest={
          locked || staged?.accessStatus ? (
            <StudioAccessRequest
              preview={preview}
              placement="wallet"
              previewStatus={staged?.accessStatus ?? "not_requested"}
              previewLoading={staged?.accessLoading ?? false}
            />
          ) : undefined
        }
        loading={!preview && reads.seq === 0}
        wallet={ready}
        firstTime={firstTime}
        pendingDelegate={resumeStep === 2}
        outlined={walletOutlined(form, nameState, ready)}
        form={form}
        checkedAt={reads.checkedAt}
        refreshing={reads.refreshing}
        arrivals={reads.arrivals}
        busy={busy}
        preview={preview}
        lockNote={walletLockNote(draftLock, access.createNote)}
        onCreateWallet={startWallet}
        onRefresh={() => void reads.refresh()}
        onFund={() => {
          if (ready && access.create && !draftLock) {
            setFundOn(ready.walletId);
            setModal("wallets");
          }
        }}
      />
    </Chrome>
  );
}
