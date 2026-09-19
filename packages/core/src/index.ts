export * from "./features/research/market-scope.js";
export * from "./features/research/plugins.js";
export * from "./features/research/nfl.js";
export type { Clock } from "./ports/clock.js";
export { createGetHealth } from "./application/get-health.js";
export { DataSourceUnavailableError } from "./shared/errors.js";

export * from "./features/landing/domain/landing.js";
export type { LandingReadModel } from "./features/landing/ports/landing-read-model.js";
export { createGetLanding, LANDING_LIMITS } from "./features/landing/application/get-landing.js";

export { InvalidEmailError, normalizeEmail } from "./features/waitlist/domain/email.js";
export type {
  WaitlistPlacement,
  WaitlistRepository,
} from "./features/waitlist/ports/waitlist-repository.js";
export {
  createJoinWaitlist,
  type JoinWaitlistOptions,
} from "./features/waitlist/application/join-waitlist.js";

export {
  APPLICATION_LIMITS,
  ApplicantNotFoundError,
  ApplicationAlreadySubmittedError,
  ApplicationValidationError,
  CATEGORIES,
  effectiveLinePosition,
  HandleTakenError,
  normalizeReferralCode,
  normalizeTicker,
  normalizeXHandle,
  PERSONALITIES,
  REFERRAL_BOOST,
  TickerTakenError,
  validateApplication,
  type Applicant,
  type Application,
  type ApplicationField,
  type ApplicationInput,
  type Category as ApplicationCategory,
  type FieldIssue,
  type Personality,
} from "./features/applications/domain/application.js";
export type {
  ApplicantRepository,
  SubmitOutcome,
} from "./features/applications/ports/applicant-repository.js";
export {
  createCheckTicker,
  createGetApplicant,
  createSubmitApplication,
} from "./features/applications/application/applications.js";

export * from "./features/agents/domain/agents.js";
export type { AgentDirectory } from "./features/agents/ports/agent-directory.js";
export {
  byRecord,
  createGetAgentPersona,
  createGetAgentProfile,
  createGetLeaderboard,
  createGetPickDetail,
  createGetPlatformAnalytics,
  createGetRead,
  createListAgents,
  createListDirectory,
  createListReads,
} from "./features/agents/application/agents.js";

export * from "./features/access/domain/modules.js";
export * from "./features/access/domain/api-scopes.js";
export * from "./features/access/domain/abilities.js";
export * from "./features/access/domain/principal.js";
export * from "./features/access/domain/authorization.js";
export { isIpAllowed } from "./features/access/domain/ip-allowlist.js";
export {
  InvalidAccessTokenError,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from "./features/access/ports/access-token-verifier.js";
export {
  AccessDeniedError,
  AuthenticationRequiredError,
  InactiveWorkspaceError,
} from "./features/access/domain/errors.js";
export type { Workspace, WorkspaceDirectory } from "./features/access/ports/workspace-directory.js";
export type { ApiKeyDirectory, StoredApiKey } from "./features/access/ports/api-key-directory.js";
export {
  createAuthenticateRequest,
  type Authenticated,
  type AuthenticateDependencies,
  type AuthenticateOptions,
  type RequestCredentials,
} from "./features/access/application/authenticate-request.js";

export * from "./features/agent-registry/domain/agent.js";
export * from "./features/agent-registry/domain/events.js";
export type {
  AgentEventLog,
  AgentRegistry,
} from "./features/agent-registry/ports/agent-registry.js";
export {
  createAgentQueries,
  type AgentQueryDependencies,
} from "./features/agent-registry/application/agent-queries.js";
export {
  AGENT_AUTH_WINDOW_SECONDS,
  AgentAuthenticationError,
  canonicalBody,
  createAuthenticateAgent,
  type AgentAuthDependencies,
  type AgentAuthFailure,
  type AgentRequest,
} from "./features/agent-registry/application/authenticate-agent.js";

export * from "./features/budget/domain/amounts.js";
export * from "./features/budget/domain/ledger.js";
export type { BudgetSource } from "./features/budget/ports/budget-source.js";

export * from "./features/signing/domain/turnkey-activity.js";
export type { SignedActivityForwarder, TurnkeyReader } from "./features/signing/ports/signing.js";

export * from "./features/profiles/domain/profile.js";
export type {
  CreateProfileResult,
  ProfileRepository,
} from "./features/profiles/ports/profile-repository.js";
export {
  createProfileService,
  type HandleAvailability,
} from "./features/profiles/application/profiles.js";

export * from "./features/research/types.js";
export * from "./features/research/policy.js";
export { evaluateDecision } from "./features/research/decision-policy.js";
export { createResearchRunner } from "./features/research/run-research.js";
export { marketExclusion } from "./features/research/eligibility.js";
export { publicSourceUrl } from "./features/research/source-url.js";
export * from "./features/paper/orders.js";
