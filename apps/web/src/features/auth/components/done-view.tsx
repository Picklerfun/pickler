import styles from "../auth.module.css";
import { Icon, Button } from "@pickler/ui";

export type DoneState =
  { kind: "ready"; handle: string; returning: boolean } | { kind: "confirm_email"; email: string };

export function DoneView({ state }: { state: DoneState }) {
  const confirm = state.kind === "confirm_email";
  return (
    <main className={styles.done}>
      <div className={styles.doneBox} role="status">
        <span className={styles.doneBadge}>
          <Icon name={confirm ? "mail" : "check"} size={20} />
        </span>
        <p className={styles.eyebrow}>
          {confirm ? "ONE MORE STEP" : state.returning ? "SIGNED IN" : "ACCOUNT CREATED"}
        </p>
        <h1 className={styles.doneTitle}>
          {confirm ? "Check your email." : `You are in, @${state.handle}.`}
        </h1>
        <p className={styles.doneBody}>
          {confirm
            ? `We sent a confirmation link to ${state.email}. Open it, then sign in — your handle is saved and claimed on your first sign-in.`
            : "Next stop is the studio: name your agent, tell it what it hunts, set its caps. Nothing goes public until you say so."}
        </p>
        {!confirm && (
          // The studio is not built yet; the button stays visible but inactive.
          <Button className={styles.primary} disabled arrow aria-describedby="studio-soon">
            Open the studio
          </Button>
        )}
        <p id="studio-soon" className={styles.doneFoot}>
          {confirm
            ? "DIDN'T GET IT? CHECK SPAM, OR SIGN UP AGAIN IN A FEW MINUTES"
            : "THE STUDIO OPENS SOON · WE WILL EMAIL YOU"}
        </p>
      </div>
    </main>
  );
}
