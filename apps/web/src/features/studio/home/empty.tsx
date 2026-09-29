"use client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, ButtonLink, Icon, Tag, type IconName } from "@pickler/ui";
import { SecondPasskey } from "@/features/auth/components/second-passkey";
import type { PasskeysKnown } from "@/features/auth/lib/second-passkey";
import { useMarketplaceHref } from "@/features/site/studio-href";
import { useNow } from "@/lib/now";
import {
  StudioError,
  createDraft,
  errorCode,
  handleAvailable,
  startPreviewRun,
  type PreviewRun,
} from "../api";
import { BriefFields } from "../brief/brief-form";
import {
  briefProblemText,
  canCreate,
  canRun,
  createLabel,
  createPress,
  createProblem,
  createdLabel,
  deriveHandle,
  emptyForm,
  fingerprint,
  footNote,
  handleState,
  idleNote,
  isTerminal,
  runLabel,
  runState,
  sectionForField,
  toRequest,
  type BriefForm,
  type CreatedDraft,
  type SectionKey,
} from "../brief/model";
import { PaperRun, type PaperRunView } from "../brief/paper-run";
import { menuAccess } from "./access";
import { HomeMenu } from "./menu";
import shell from "../studio.module.css";
import styles from "./home.module.css";

/* The rail the "Pickler Studio Empty v4" canvas draws, every row disabled until an agent exists. */
const RAIL: { title: string; items: [IconName, string][] }[] = [
  {
    title: "RUN",
    items: [
      ["grid", "Overview"],
      ["chat", "Console"],
      ["target", "Trades"],
      ["activity", "Activity"],
    ],
  },
  {
    title: "BUILD",
    items: [
      ["file", "Brief"],
      ["sliders", "Sources & rules"],
      ["wallet", "Limits & funding"],
      ["user", "Identity & voice"],
    ],
  },
  { title: "GROW", items: [["globe", "Public profile"]] },
];

const HANDLE_RE = /^[a-z0-9_]{3,15}$/;

/** The run a brief was sent on: its id, what it was made from, and its latest read. */
interface Paper {
  id: string;
  ranFor: string;
  perTrade: number;
  run: PreviewRun | null;
  /** A staged run's whole view, drawn without reading anything. */
  view: PaperRunView | null;
}

/** A brief home filled in for the design harness, with its run in one state. Nothing is sent. */
export interface BriefStaged {
  form: BriefForm;
  available: boolean;
  paper: Paper;
}

/**
 * The home before the first agent, as the "Pickler Studio Empty v4" canvas draws it, made real
 * (docs/specs/studio-brief-v1.md §5): the top bar with "No agent yet", the studio rail with every
 * section disabled, and the first agent's brief where the board would be. The brief is written
 * here, run once on paper through the real runtime ("Run it on paper", nothing is created), and
 * then created as a private draft that adopts that run ("Create {Name}"). `/studio/new` stays for
 * later agents.
 */
export function EmptyHome({
  passkeys,
  canManage,
  preview,
  locked,
  error,
  staged,
  onCreated,
}: {
  passkeys: PasskeysKnown;
  canManage: boolean;
  /** A staged or fixture studio, which says so. Nothing on it is sent. */
  preview: boolean;
  /** Why creating is closed on this workspace (research not enabled), or null when it is open. */
  locked: { title: string; note: string } | null;
  error: string;
  staged: BriefStaged | null;
  /** The draft exists: reload the agents and open its home. */
  onCreated(productId: string): Promise<void>;
}) {
  const researchLock = locked ? `${locked.title} ${locked.note}` : "";
  /* No agents, so no unfunded-agent lock: the same answer the Menu's "+ New agent" reads. */
  const access = menuAccess({
    hasAgent: false,
    canManage,
    researchLock,
    fundLock: "",
    draftLock: "",
  });
  const now = useNow(15_000);
  const directory = useMarketplaceHref("/agents");

  const [form, setForm] = useState<BriefForm>(staged?.form ?? emptyForm());
  const [availability, setAvailability] = useState<{
    handle: string;
    available: boolean | "failed";
  } | null>(
    staged ? { handle: deriveHandle(staged.form.name), available: staged.available } : null,
  );
  /* Bumped by the name's "Try again", to ask the availability check once more. */
  const [recheck, setRecheck] = useState(0);
  const [paper, setPaper] = useState<Paper | null>(staged?.paper ?? null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SectionKey, string>>>({});
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [runError, setRunError] = useState("");
  const [createError, setCreateError] = useState("");
  /* The draft the API answered 201 for. From here on the button reloads and never creates. */
  const [created, setCreated] = useState<CreatedDraft | null>(null);
  const [opening, setOpening] = useState(false);

  const handle = deriveHandle(form.name);
  /* The existing availability check, debounced; the canvas's mock TAKEN list is gone. */
  useEffect(() => {
    if (preview || !HANDLE_RE.test(handle)) {
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

  const onUpdate = useCallback((run: PreviewRun) => {
    setPaper((current) => (current && current.id === run.id ? { ...current, run } : current));
  }, []);
  /* The run is gone (read after its 24 h, or cleaned up): back to IDLE, asking for a new one. */
  const onExpired = useCallback(() => {
    setPaper(null);
    setRunError("That paper run expired. Run it again to create.");
  }, []);

  const available = availability?.handle === handle ? availability.available : null;
  const nameState = handleState(form.name, available);
  const latest = paper?.run ?? paper?.view?.run ?? null;
  const state = runState(
    {
      started: paper !== null,
      terminal: latest !== null && isTerminal(latest.status),
      ranFor: paper?.ranFor ?? null,
    },
    fingerprint(form),
  );
  const completed = latest?.status === "completed";
  const nextRunAt =
    retryAt !== null && retryAt > now
      ? new Date(retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";
  const runnable = access.create && !starting && !created && canRun(form, state, nextRunAt);
  const creatable = access.create && !creating && canCreate(nameState, state, completed);

  function edit(next: BriefForm) {
    setForm(next);
    setFieldErrors({});
    setCreateError("");
  }

  async function run() {
    if (preview || !runnable) {
      return;
    }
    setRunError("");
    setFieldErrors({});
    setStarting(true);
    const ranFor = fingerprint(form);
    const perTrade = form.perTrade;
    try {
      const { id } = await startPreviewRun(toRequest(form));
      setPaper({ id, ranFor, perTrade, run: null, view: null });
    } catch (caught) {
      const details = caught instanceof StudioError ? caught.details : undefined;
      const section =
        errorCode(caught) === "INVALID_BRIEF"
          ? sectionForField(String(details?.field ?? ""))
          : null;
      if (section) {
        const next: Partial<Record<SectionKey, string>> = {};
        next[section] = briefProblemText(String(details?.reason ?? ""));
        setFieldErrors(next);
      } else if (
        errorCode(caught) === "PREVIEW_RATE_LIMITED" &&
        typeof details?.retryAt === "number"
      ) {
        setRetryAt(details.retryAt);
      } else {
        setRunError(caught instanceof Error ? caught.message : "The paper run did not start.");
      }
    } finally {
      setStarting(false);
    }
  }

  /* Only the reload: the draft exists, and a failure here is not a failure to create it. */
  async function open(productId: string) {
    setOpening(true);
    try {
      await onCreated(productId);
    } catch {
      /* The button says so (`createdLabel`), and the next press comes back here. */
    } finally {
      setOpening(false);
    }
  }

  async function create() {
    const press = createPress({
      created,
      busy: creating || opening,
      creatable: !preview && paper !== null && creatable,
    });
    if (press.kind === "reload") {
      await open(press.productId);
      return;
    }
    if (press.kind === "none" || !paper) {
      return;
    }
    setCreateError("");
    setCreating(true);
    let productId: string;
    try {
      ({ productId } = await createDraft({
        ...toRequest(form),
        name: form.name.trim(),
        handle,
        previewRunId: paper.id,
      }));
    } catch (caught) {
      const problem = createProblem(
        errorCode(caught),
        caught instanceof Error ? caught.message : "",
      );
      if (problem.kind === "stale") {
        // The server saw a different brief than the run's: say so the way the screen does.
        setPaper((current) => (current ? { ...current, ranFor: "" } : current));
      } else if (problem.kind === "taken") {
        setAvailability({ handle, available: false });
      } else {
        if (problem.kind === "rerun") {
          setPaper(null);
        }
        setCreateError(problem.text);
      }
      return;
    } finally {
      setCreating(false);
    }
    setCreated({ productId, name: form.name.trim() });
    await open(productId);
  }

  return (
    <main className={styles.home} data-surface="dark">
      <header className={styles.top}>
        <Link href="/" className={styles.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
          <span>PICKLER</span>
        </Link>
        <span className={styles.noAgent}>
          <span className={styles.noAgentMark} aria-hidden="true">
            +
          </span>
          <b>No agent yet</b>
        </span>
        <span className={styles.spacer} />
        <span className={styles.pill} data-tint="grey">
          TESTNET
        </span>
        <span className={styles.emptyMenu}>
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
        <Link href="/account" className={styles.account} aria-label="Account">
          <span className={shell.swatch} aria-hidden="true">
            <i data-swatch="lime" />
            <i data-swatch="violet" />
            <i data-swatch="amber" />
            <i data-swatch="blue" />
          </span>
        </Link>
      </header>

      <div className={styles.emptyBody}>
        <nav className={styles.emptyRail} aria-label="Studio sections">
          {RAIL.map((group) => (
            <div key={group.title}>
              <p className={shell.railTitle}>{group.title}</p>
              <div className={shell.railItems}>
                {group.items.map(([icon, label]) => (
                  <span
                    key={label}
                    className={styles.emptyRailItem}
                    title={access.sectionNote}
                    aria-disabled="true"
                  >
                    <Icon name={icon} size={17} />
                    <span className={shell.railLabel}>{label}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={styles.emptyMain}>
          <section className={styles.brief} id="home-empty" aria-labelledby="home-empty-title">
            {preview && (
              <p className={styles.emptyNote} role="status">
                <Icon name="alert" size={13} />
                Design preview. This home is drawn from a fixture; nothing on it can be sent or
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

            <p className={styles.briefKicker}>YOUR FIRST AGENT · ITS BRIEF IS WHAT IT RUNS ON</p>
            <div className={styles.starts}>
              <span className={styles.startsLabel}>START FROM</span>
              <span className={styles.start} data-on="true">
                <i aria-hidden="true" />
                Blank
              </span>
              <Link href={directory} className={styles.start}>
                <i data-tint="lime" aria-hidden="true" />A ranked agent
                <Tag className={styles.soon}>SOON</Tag>
              </Link>
            </div>

            <BriefFields
              form={form}
              handle={nameState}
              fieldErrors={fieldErrors}
              disabled={starting || creating || created !== null}
              onChange={edit}
              onRecheck={() => {
                setAvailability(null);
                setRecheck((count) => count + 1);
              }}
            />

            {access.createNote && <p className={styles.newAgentNote}>{access.createNote}</p>}
            <div className={styles.briefActions}>
              {/* aria-disabled, not disabled: a shut button stays focusable, so its label (the
                  reason it is shut) is announced. run() and create() refuse while shut. */}
              <Button
                variant="secondary"
                size="lg"
                aria-disabled={!runnable}
                onClick={() => void run()}
              >
                {runLabel(form, starting ? "LIVE" : state, nextRunAt)}
              </Button>
              <Button
                variant="primary"
                size="lg"
                aria-disabled={created ? opening : !creatable}
                onClick={() => void create()}
              >
                {created
                  ? createdLabel(created, opening ? "opening" : "failed")
                  : creating
                    ? "Creating"
                    : createLabel(form, nameState, state, completed)}
              </Button>
            </div>
            {runError && (
              <p className={styles.alert} role="alert">
                <Icon name="alert" size={13} />
                {runError}
              </p>
            )}
            {createError && (
              <p className={styles.alert} role="alert">
                <Icon name="alert" size={13} />
                {createError}
              </p>
            )}
            <p className={styles.briefFoot}>{footNote(state)}</p>
            <p className={styles.briefActionNote}>
              Building more than one?{" "}
              <ButtonLink as={Link} href="/studio/new" variant="ghost" size="sm">
                The step-by-step flow
              </ButtonLink>
            </p>
          </section>

          <aside className={styles.briefSide} aria-label="Starting point and paper run">
            <Image
              className={styles.briefMascot}
              src="/brand/mascot.webp"
              alt=""
              width={96}
              height={80}
            />
            <div className={styles.sideCard}>
              <span className={styles.sideTitle}>STARTING POINT</span>
              <div className={styles.source}>
                <span className={styles.sourceMark} aria-hidden="true">
                  —
                </span>
                <span className={styles.grow}>
                  <b className={styles.sourceName}>Blank</b>
                  <small className={styles.sourceLine}>No source</small>
                </span>
              </div>
              <p className={styles.sideText}>
                A blank brief. Every section is yours. Read a ranked agent first to see how a
                working one reads.
              </p>
              <Link href={directory} className={styles.sideLink}>
                SEE THEIR RECEIPTS →
              </Link>
            </div>
            <PaperRun
              key={paper?.id ?? "idle"}
              previewId={paper?.id ?? null}
              staged={paper?.view ?? null}
              state={state}
              perTrade={paper?.perTrade ?? form.perTrade}
              idleNote={idleNote(form)}
              onUpdate={onUpdate}
              onExpired={onExpired}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}

/* Every section and every switch needs an agent; the Menu disables them, so nothing calls these. */
function noSection(): void {}
