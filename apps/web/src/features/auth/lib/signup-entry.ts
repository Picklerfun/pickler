/**
 * How `/signup` is entered, read from its search parameters on the server.
 *
 * `?step=passkey` is where every signed-in screen sends a person without a master wallet
 * (`redirectFor` in `custody.ts`), and `?complete=1` is where the studio sends one without a
 * profile. Both resume an existing session: the flow reads the account and lands on whatever it
 * still needs — the handle step, then the passkey step — instead of asking for an email again.
 * Without a session there is nothing to resume, and the flow starts at the account screen.
 *
 * `?state=passkey` is a design preview of the signup at its passkey step, with no session and no
 * reads, so the design harness can measure the step. Outside production only, gated on the build
 * alone like the home's `?stage=` and the creation flow's `?step=` sample. Pure, with `nodeEnv` an
 * argument, so the gate is pinned in both positions. Its button opens the sheet, whose challenge
 * the API refuses without a session, so nothing on it can create anything.
 */
export const SIGNUP_PREVIEWS = ["passkey"] as const;

export type SignupPreview = (typeof SIGNUP_PREVIEWS)[number];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function signupPreviewFromSearch(
  nodeEnv: string | undefined,
  asked: string | string[] | undefined,
): SignupPreview | undefined {
  if (nodeEnv === "production") {
    return undefined;
  }
  const value = first(asked);
  return SIGNUP_PREVIEWS.find((state): state is SignupPreview => state === value);
}

/** Whether `/signup` should resume an existing session rather than start at the account screen. */
export function resumesSignup(search: {
  step?: string | string[] | undefined;
  complete?: string | string[] | undefined;
}): boolean {
  return first(search.step) === "passkey" || first(search.complete) === "1";
}
