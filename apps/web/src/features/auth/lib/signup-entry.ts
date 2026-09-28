/**
 * How `/signup` and `/signin` are entered.
 *
 * With a session already there — whatever the URL, `?step=passkey` (where every signed-in screen
 * sends a person without a master wallet), `?step=handle` (a wallet and no profile), or neither —
 * the flow reads the account and lands on whatever it still needs: the passkey step, the handle
 * step, or welcome. The email form is only for someone with no session. `arrivalFor` is that
 * decision.
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

/**
 * What the sign flow does on arrival: a preview draws its step and reads nothing; a session is
 * resumed (the account is read and the landing check decides the step); without one, the email
 * form. The URL's other parameters do not enter into it.
 */
export function arrivalFor(input: {
  preview: SignupPreview | undefined;
  signedIn: boolean;
}): "preview" | "resume" | "form" {
  if (input.preview !== undefined) {
    return "preview";
  }
  return input.signedIn ? "resume" : "form";
}
