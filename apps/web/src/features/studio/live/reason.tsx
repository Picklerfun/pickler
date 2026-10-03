import shell from "../shell/shell.module.css";

/**
 * Why a shut control is shut, for assistive technology: the control stays focusable
 * (`aria-disabled`), points here with `aria-describedby` and carries the same words in its title.
 * Nothing is drawn when it is open.
 */
export function Reason({ id, text }: { id: string; text: string | null }) {
  if (!text) {
    return null;
  }
  return (
    <span id={id} className={shell.srOnly}>
      {text}
    </span>
  );
}
