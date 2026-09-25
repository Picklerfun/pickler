"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { WebauthnStamper } from "@turnkey/webauthn-stamper";
import { Button, Icon } from "@pickler/ui";
import { ensureProfile } from "@/features/auth/lib/account";
import {
  SessionExpired,
  createWallet,
  markEnrolled,
  openChallenge,
} from "@/features/auth/lib/custody";
import { describeDevice } from "@/features/auth/lib/device";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import {
  agentState,
  confirmDelegated,
  confirmPolicies,
  confirmWallet,
  createAgent,
  draftAgent,
  errorCode,
  handleAvailable,
  prepareDelegated,
  preparePolicies,
  prepareWallet,
  startRun,
  studioApi,
  type Options,
} from "../api";
import { custody, session } from "../lib/passkey";
import { studioPreview } from "../preview";
import { runCeremony, type CeremonyProgress, type CeremonyStep } from "./ceremony";
import { ORDER, fromApiDraft, ready, toCreate, type Draft, type OrderStep } from "./draft";
import { flowReducer, initialFlow, openingFlow, paramFromStep, type StepProps } from "./flow";
import { RAIL_LABELS } from "./map";
import { Describe } from "./describe";
import { Reading } from "./reading";
import { NameStep, type HandleCheck } from "./name";
import { TradesStep } from "./trades";
import { LooksStep } from "./looks";
import { ReadsStep } from "./reads";
import { SkillsStep } from "./skills";
import { DecidesStep } from "./decides";
import { Review } from "./review";
import { FirstRun, idleCeremony, type CeremonyView, type FirstCall } from "./first-run";
import { Stack } from "./stack";
import shell from "../studio.module.css";
import styles from "./create.module.css";

type Access = { enabled: boolean; canManage: boolean; workspaceId: string };

const HANDLE_RE = /^[a-z0-9_]{3,15}$/;
const HANDLE_DEBOUNCE_MS = 400;
const BUSY_MESSAGE = "The model is busy. Build it step by step instead.";

const CEREMONY_NAMES: Record<CeremonyStep, string> = {
  wallet: "Its wallet",
  rules: "Its rules",
  agent: "The agent",
  run: "Its first run",
};

function localStore() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The two names a WebAuthn prompt fails with when the person closed it or it timed out. */
const CLOSED_PROMPT = new Set(["NotAllowedError", "AbortError"]);

/**
 * A ceremony failure in words, named by the step it stopped on, because the answer to "did
 * anything happen" is which lines above it are done. A closed passkey prompt says so plainly;
 * everything else — an API refusal, an expired session, any other failure — shows its own message.
 */
function describeFailure(step: CeremonyStep | null, caught: unknown): string {
  const where = step ? `${CEREMONY_NAMES[step]}: ` : "";
  if (caught instanceof Error && CLOSED_PROMPT.has(caught.name)) {
    return `${where}the passkey prompt was closed. Nothing after the last finished line was created.`;
  }
  if (caught instanceof SessionExpired) {
    return `${where}your sign-in expired. Sign in again; the lines marked done stay done.`;
  }
  if (caught instanceof Error && caught.message) {
    return `${where}${caught.message}`;
  }
  return `${where}it did not finish.`;
}

/**
 * Creating an agent, as the "Pickler Create First Agent v2" canvas draws it: Describe, then either
 * the model's draft revealed on "Got it" or seven manual steps, the review they both end at, and
 * the first run — whose first four lines are the passkey ceremony that creates the wallet, approves
 * its rules and creates the agent. `?step=` mirrors the screen so each one is reachable by URL.
 */
export function CreateAgent({
  initialStep,
  allowSample,
}: {
  initialStep: ReturnType<typeof initialFlow>["step"];
  /** Outside production, a link past Describe opens on the canvas's example draft. */
  allowSample: boolean;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    flowReducer,
    initialStep,
    (step): ReturnType<typeof initialFlow> => openingFlow(step, allowSample),
  );
  const [options, setOptions] = useState<Options | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [owner, setOwner] = useState("@you");
  const [preview, setPreview] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [revealed, setRevealed] = useState(0);
  const [check, setCheck] = useState<HandleCheck>("idle");
  const [checkError, setCheckError] = useState("");
  const [ceremony, setCeremony] = useState<CeremonyView>(idleCeremony);
  const [call, setCall] = useState<FirstCall | null>(null);
  const [settled, setSettled] = useState(false);
  /* One attempt per draft: its idempotency keys, and what it has already done. A retry reuses both,
     so it resumes after the last finished step instead of asking for the passkey again. */
  const attempt = useRef<{
    keys: { create: string; run: string };
    progress: CeremonyProgress;
  } | null>(null);
  /* Aborted when the screen goes away, so leaving mid-ceremony never raises a later prompt. */
  const leaving = useRef<AbortController | null>(null);
  const rpId = useRef<string | null>(null);
  const { draft, step } = state;

  /* Loading: the same session guard the studio has, then the defaults every create sends. */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const supabase = getSupabase();
        if (!supabase) {
          const fixture = studioPreview(Date.now(), "?state=empty");
          if (!fixture) {
            throw new Error("Authentication is not configured for this environment.");
          }
          if (active) {
            setPreview(true);
            setOptions(fixture.options);
            setAccess({ enabled: true, canManage: true, workspaceId: "preview" });
          }
          return;
        }
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace("/signin");
          return;
        }
        const account = await ensureProfile(supabase);
        if (account.kind !== "ready") {
          router.replace("/signup?complete=1");
          return;
        }
        await studioApi("/onboard", { method: "POST" });
        const [current, opts] = await Promise.all([
          studioApi<Access>("/me"),
          studioApi<Options>("/options"),
        ]);
        if (active) {
          setOwner(`@${account.profile.handle}`);
          setAccess(current);
          setOptions(opts);
        }
      } catch (caught) {
        if (active) {
          setLoadError(caught instanceof Error ? caught.message : "Could not load the studio.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  /* `?step=` follows the screen, so a reload or a shared link opens where it was. */
  const shownParam = useRef(paramFromStep(initialStep));
  useEffect(() => {
    const param = paramFromStep(step);
    if (param !== shownParam.current) {
      shownParam.current = param;
      router.replace(`/studio/new?step=${param}`, { scroll: false });
    }
  }, [step, router]);

  /* The handle is checked wherever it changes — typed, or proposed by the model — so the review
     never offers to create an agent under a handle nobody asked the API about. */
  useEffect(() => {
    const handle = draft.handle;
    if (draft.handleAvailable !== null || !HANDLE_RE.test(handle)) {
      setCheck("idle");
      return;
    }
    let active = true;
    setCheck("checking");
    const timer = setTimeout(() => {
      handleAvailableFor(handle)
        .then((available) => {
          if (active) {
            dispatch({ type: "patch", patch: { handleAvailable: available } });
            setCheck("idle");
          }
        })
        .catch((caught: unknown) => {
          if (active) {
            setCheck("error");
            setCheckError(caught instanceof Error ? caught.message : "The check failed.");
          }
        });
    }, HANDLE_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft.handle, draft.handleAvailable]);

  /* A changed draft is a different request, so it gets a new attempt; a retry of the same draft
     reuses it, which is what lets the API find the half-finished attempt (spec §4.2). */
  useEffect(() => {
    attempt.current = null;
  }, [draft]);

  useEffect(() => {
    const controller = new AbortController();
    leaving.current = controller;
    return () => controller.abort();
  }, []);

  /* Each screen's heading takes focus when the screen changes, so a screen reader hears where it
     is. Not on the first render: arriving on the page is not a change. */
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    document.querySelector<HTMLElement>(`#create-${paramFromStep(step)} h1`)?.focus();
  }, [step]);

  const patch = useCallback((next: Partial<Draft>) => dispatch({ type: "patch", patch: next }), []);
  const replace = useCallback((next: Draft) => dispatch({ type: "replace", draft: next }), []);
  const stepProps: StepProps = { draft, patch, replace };

  const fill = useCallback(async () => {
    dispatch({ type: "busy", busy: true });
    dispatch({ type: "error", error: "" });
    try {
      const answer = await draftAgent(draft.prompt.trim());
      setRevealed(0);
      dispatch({ type: "drafted", draft: fromApiDraft(answer.draft) });
    } catch (caught) {
      if (errorCode(caught) === "DRAFT_UNAVAILABLE") {
        dispatch({ type: "manual" });
        dispatch({ type: "error", error: BUSY_MESSAGE });
        return;
      }
      dispatch({
        type: "error",
        error: caught instanceof Error ? caught.message : "Drafting failed.",
      });
    }
  }, [draft.prompt]);

  const create = useCallback(async () => {
    if (!options) {
      return;
    }
    const current = attempt.current ?? {
      keys: { create: crypto.randomUUID(), run: crypto.randomUUID() },
      progress: {},
    };
    attempt.current = current;
    const signal = leaving.current?.signal;
    const body = (walletId: string) => toCreate(draft, walletId, options.defaults);

    const progress: { at: CeremonyStep | null } = { at: null };
    setCeremony({ ...idleCeremony(), started: true });
    setCall(null);
    setSettled(false);
    dispatch({ type: "go", step: "run" });

    const knownRp = async () => {
      if (!rpId.current) {
        rpId.current = (await openChallenge(custody())).rp.id;
      }
      return rpId.current;
    };

    try {
      const result = await runCeremony(
        {
          state: agentState,
          register: async () => {
            const challenge = await openChallenge(custody());
            rpId.current = challenge.rp.id;
            await createWallet(custody(), {
              options: challenge,
              label: describeDevice(navigator.userAgent),
            });
            markEnrolled(localStore(), (await session()).userId);
          },
          stamp: async (unsigned) => ({
            url: unsigned.url,
            body: unsigned.body,
            stamp: await new WebauthnStamper({ rpId: await knownRp() }).stamp(unsigned.body),
          }),
          prepareDelegated,
          confirmDelegated: async (signed) => {
            await confirmDelegated(signed);
          },
          prepareWallet,
          confirmWallet,
          preparePolicies,
          confirmPolicies,
          createAgent: async (walletId) => {
            const agent = await createAgent(body(walletId), current.keys.create);
            // `POST /agents` answers the runtime record, whose id is the product id it was
            // created under (`product_agents.runtime_agent_id` is written from the same uuid).
            return { id: agent.id };
          },
          startRun: (agentId) => startRun(agentId, current.keys.run),
          onStep: (which, phase) => {
            progress.at = phase === "start" ? which : null;
            setCeremony((was) => ({ ...was, steps: { ...was.steps, [which]: phase } }));
          },
          onWallet: (wallet) => setCeremony((was) => ({ ...was, address: wallet.address })),
        },
        draft.handle,
        current.progress,
        signal,
      );
      setCeremony((was) => ({
        ...was,
        agentId: result.agentId,
        runId: result.runId,
        address: result.address,
      }));
    } catch (caught) {
      if (signal?.aborted) {
        return;
      }
      const failed = progress.at;
      setCeremony((was) => ({
        ...was,
        steps: failed ? { ...was.steps, [failed]: "failed" } : was.steps,
        error: describeFailure(failed, caught),
      }));
    }
  }, [draft, options]);

  const onSettled = useCallback((next: FirstCall | null, done: boolean) => {
    setCall(next);
    setSettled(done);
  }, []);

  const onShown = useCallback((count: number) => setRevealed(count), []);
  const onRead = useCallback(() => dispatch({ type: "go", step: "review" }), []);

  const canManage = Boolean(access?.canManage);
  const agentMade = ceremony.steps.agent === "done";
  const manualAt = ORDER.indexOf(step as OrderStep);
  const showRail = state.mode === "manual" && !state.editing && manualAt >= 0;
  const createDisabled = !ready("review", draft) || !options || !canManage || state.busy;

  return (
    <main className={styles.page} data-surface="dark">
      <header className={shell.topbar}>
        <Link href="/" className={shell.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={22} priority />
          <span>PICKLER</span>
        </Link>
        <span className={styles.newAgent}>NEW AGENT</span>
        <span className={shell.spacer} />
        <Link href="/studio" className={styles.exit}>
          Exit
        </Link>
      </header>

      <div className={styles.stage}>
        <div className={styles.flow}>
          {preview && (
            <p className={styles.banner} role="status">
              <Icon name="alert" size={13} />
              Design preview. This build has no authentication configured, so nothing here can be
              drafted, checked or created.
            </p>
          )}
          {access && !canManage && (
            <p className={styles.banner} role="status">
              <Icon name="lock" size={13} />
              This workspace cannot create agents yet. An operator enables it by hand.
            </p>
          )}
          {loadError && (
            <p className={styles.alert} role="alert">
              <Icon name="alert" size={13} />
              {loadError}
            </p>
          )}

          {showRail && (
            <ol className={styles.rail} aria-label="Steps">
              {ORDER.map((key, index) => (
                <li key={key}>
                  <button
                    type="button"
                    className={styles.railStep}
                    data-state={index < manualAt ? "done" : index === manualAt ? "here" : "ahead"}
                    aria-current={index === manualAt ? "step" : undefined}
                    disabled={!(index < manualAt || ready(step, draft))}
                    onClick={() => dispatch({ type: "go", step: key })}
                  >
                    <span className={styles.railBar} />
                    {RAIL_LABELS[key]}
                  </button>
                </li>
              ))}
            </ol>
          )}

          {state.mode === "auto" && step === "review" && (
            <p className={styles.filled}>FILLED FROM YOUR LINE · CHECK IT</p>
          )}

          {step === "start" && (
            <Describe line={draft.prompt} onLine={(prompt) => patch({ prompt })} />
          )}
          {step === "reading" && (
            <Reading draft={draft} shown={revealed} onShown={onShown} onDone={onRead} />
          )}
          {step === "name" && <NameStep {...stepProps} check={check} checkError={checkError} />}
          {step === "trades" && <TradesStep {...stepProps} />}
          {step === "looks" && <LooksStep {...stepProps} />}
          {step === "reads" && <ReadsStep {...stepProps} />}
          {step === "skills" && <SkillsStep {...stepProps} />}
          {step === "decides" && <DecidesStep {...stepProps} />}
          {step === "review" && (
            <Review
              draft={draft}
              mode={state.mode}
              onEdit={(which) => dispatch({ type: "edit", step: which })}
            />
          )}
          {step === "run" && (
            <FirstRun
              ceremony={ceremony}
              name={draft.name.trim() || "the agent"}
              onSettled={onSettled}
            />
          )}

          {step !== "reading" && <div className={styles.nav}>{nav()}</div>}
          {step === "start" && (
            <button
              type="button"
              className={styles.quietLink}
              onClick={() => dispatch({ type: "manual" })}
            >
              OR BUILD IT STEP BY STEP
            </button>
          )}
          {state.error && (
            <p className={styles.alert} role="alert">
              <Icon name="alert" size={13} />
              {state.error}
            </p>
          )}
        </div>

        <Stack
          draft={draft}
          step={step}
          mode={state.mode}
          revealed={revealed}
          wallet={ceremony.address}
          call={call?.block ?? null}
          owner={owner}
        />
      </div>
    </main>
  );

  function nav() {
    if (step === "start") {
      return (
        <Button
          size="lg"
          disabled={draft.prompt.trim().length < 3 || state.busy}
          onClick={() => void fill()}
        >
          {state.busy ? "Reading your line…" : "Set it up from my line"}
        </Button>
      );
    }
    if (step === "run") {
      if (!ceremony.started || ceremony.error) {
        return (
          <>
            {!agentMade && (
              <Button
                variant="secondary"
                size="lg"
                onClick={() => dispatch({ type: "go", step: "review" })}
              >
                Back
              </Button>
            )}
            <Button size="lg" disabled={createDisabled} onClick={() => void create()}>
              {ceremony.error ? "Try again with your passkey" : "Create and run it once"}
            </Button>
          </>
        );
      }
      return (
        <Button
          size="lg"
          disabled={!settled}
          onClick={() =>
            router.push(ceremony.agentId ? `/studio?agent=${ceremony.agentId}` : "/studio")
          }
        >
          {settled ? "Open the studio" : "Thinking…"}
        </Button>
      );
    }
    const label = state.editing
      ? "Done"
      : step === "review"
        ? "Create and run it once"
        : step === "skills" && draft.skills.length + draft.custom.length === 0
          ? "Skip for now"
          : "Next";
    const disabled = step === "review" && !state.editing ? createDisabled : !ready(step, draft);
    return (
      <>
        <Button variant="secondary" size="lg" onClick={() => dispatch({ type: "back" })}>
          {state.editing ? "Cancel" : "Back"}
        </Button>
        <Button
          size="lg"
          disabled={disabled}
          onClick={() => {
            if (step === "review" && !state.editing) {
              void create();
              return;
            }
            dispatch({ type: "next" });
          }}
        >
          {label}
        </Button>
      </>
    );
  }
}

/** The public availability route, answered as a boolean. */
async function handleAvailableFor(handle: string): Promise<boolean> {
  return (await handleAvailable(handle)).available;
}
