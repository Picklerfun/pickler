/** No valid credential was presented (HTTP 401). */
export class AuthenticationRequiredError extends Error {
  constructor(message = "Valid Bearer token or API key required") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/** The workspace behind the credential is deactivated (HTTP 401). */
export class InactiveWorkspaceError extends Error {
  constructor() {
    super("Account is inactive");
    this.name = "InactiveWorkspaceError";
  }
}

/** Authenticated, but not allowed (HTTP 403). */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}
