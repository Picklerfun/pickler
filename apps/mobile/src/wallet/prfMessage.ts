/** Mensaje para PRF_UNAVAILABLE: la causa real es el proveedor del passkey; iOS 18 solo si la versión es menor. */
export function prfUnavailableMessage(iosMajor: number | undefined): string {
  const base = "Your passkey provider didn't return the secret Pickler needs. Save the passkey with Apple Passwords (iCloud Keychain), not a third-party manager, and try again.";
  return iosMajor !== undefined && iosMajor < 18 ? `${base} Passkeys with PRF also need iOS 18 or newer.` : base;
}
