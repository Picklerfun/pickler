export class InvalidEmailError extends Error {
  constructor() {
    super("Invalid email address");
    this.name = "InvalidEmailError";
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns a trimmed, lower-cased address or throws InvalidEmailError. */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new InvalidEmailError();
  }
  return email;
}
