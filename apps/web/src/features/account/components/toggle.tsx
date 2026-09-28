import styles from "../account.module.css";

/**
 * A switch that is off and cannot be moved, drawn as a switch so the screen answers the question
 * rather than leaving the row out and letting the reader assume.
 *
 * Both switches on this screen are in that position — email recovery is off by design, and there is
 * nowhere to store a visibility preference — so the component has no `onChange` at all. Adding one
 * is a change to this file; until then nothing can wire a handler to a setting with no home, which
 * is the point.
 *
 * `aria-disabled` on a real button rather than `disabled`: it stays reachable and its title stays
 * readable, and "this is off and you cannot turn it on" is the answer somebody came for. A control
 * taken out of the tab order does not give it to them.
 */
export function Toggle({ on, label, why }: { on: boolean; label: string; why: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled="true"
      aria-label={label}
      className={styles.toggle}
      title={why}
    >
      <span className={styles.toggleKnob} aria-hidden="true" />
    </button>
  );
}
