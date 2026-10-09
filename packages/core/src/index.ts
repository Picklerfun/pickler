export * from "./features/research/market-scope.js";
export * from "./features/research/plugins.js";
export * from "./features/research/nfl.js";
export * from "./features/research/soccer.js";
export type { Clock } from "./ports/clock.js";
export { createGetHealth } from "./application/get-health.js";
export { DataSourceUnavailableError } from "./shared/errors.js";

export {
  remainingTokens,
  tokensOutForQuoteIn,
  type CurveConfig,
} from "./features/launch/domain/curve-math.js";

export {
  nextRange,
  planAdvance,
  type AdvancePlan,
  type IndexedBlock,
  type IndexerCursor,
} from "./features/launch/domain/indexing.js";

export {
  ChainMismatchError,
  ChainUnavailableError,
  type BlockRef,
  type CallRequest,
  type ChainLog,
  type ChainReader,
  type LogQuery,
} from "./features/launch/ports/chain-reader.js";

// Shared public-view types (accents, agent refs, pick outcomes); the landing read model they were
// written for is gone (docs/specs/marketplace-real-only-v1.md N4).
export * from "./features/landing/domain/landing.js";
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
export type {
  ApplicationDecision,
  ApplicationReviewEntry,
  ApplicationReviewFilter,
  ApplicationReviewRepository,
  ApplicationStatus,
} from "./features/applications/ports/application-review-repository.js";
export {
  APPLICATION_DECISIONS,
  APPLICATION_STATUSES,
  ApplicationNotFoundError,
  createApplicationReview,
  DECISION_NOTE_MAX,
  ReviewValidationError,
} from "./features/applications/application/review-applications.js";

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
export {
  AGENT_ACTION_CALLS,
  AGENT_ACTION_OUTCOMES,
  AGENT_ACTIONS_DEFAULT,
  AGENT_ACTIONS_MAX,
  createListAgentActions,
  type AgentAction,
  type AgentActionCall,
  type AgentActionFeed,
  type AgentActionOutcome,
} from "./features/agents/domain/agent-actions.js";

export * from "./features/markets/domain/markets.js";
export type { MarketBoard } from "./features/markets/ports/market-board.js";
export {
  byCoverage,
  createGetMarket,
  createListMarkets,
  normalizeSymbol,
} from "./features/markets/application/markets.js";

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
  CustodyAccountLookup,
  ProfileRepository,
} from "./features/profiles/ports/profile-repository.js";
export {
  createProfileService,
  type HandleAvailability,
  type ProfileAccount,
} from "./features/profiles/application/profiles.js";

export * from "./features/research/types.js";
export * from "./features/research/policy.js";
export * from "./features/research/style.js";
export * from "./features/research/brief.js";
export * from "./features/research/books.js";
export {
  evaluateDecision,
  briefVerdict,
  type BriefVerdict,
} from "./features/research/decision-policy.js";
export { createResearchRunner } from "./features/research/run-research.js";
export { marketExclusion } from "./features/research/eligibility.js";
export { publicSourceUrl } from "./features/research/source-url.js";
export * from "./features/studio/access.js";
export * from "./features/studio/brief-config.js";
export * from "./features/studio/preview.js";
export * from "./features/studio/locks.js";
export * from "./features/studio/create.js";
export * from "./features/studio/revise.js";
export * from "./features/studio/setup-summary.js";
export * from "./features/studio/publish.js";

export {
  ADD_PASSKEY_ACTIVITY_TYPE,
  ChallengeNotUsableError,
  NoCustodyAccountError,
  SUPPORTED_TRANSPORTS,
  type DisplayIdentity,
  deviceTypeFromTransports,
  toTurnkeyTransports,
  type ChallengeOptions,
  type DeviceType,
  type PasskeyAttestation,
  AGENT_WALLET_ACTIVITY_TYPES,
  AgentWalletNotFoundError,
  AgentWalletLinkedError,
  DelegatedKeyNotConfiguredError,
  DelegatedUserExistsError,
  DelegatedUserMissingError,
  MONAD_ACCOUNT_PATH,
} from "./features/wallets/domain/passkey.js";
export {
  MERA_RELYING_PARTY,
  turnkeyRelyingPartyProblem,
  type RelyingPartyProblem,
} from "./features/wallets/domain/relying-party.js";
export {
  DEPOSIT_AMOUNTS_AUSD,
  DepositAlreadyRecordedError,
  DepositFeeTooHighError,
  DepositNonceError,
  DepositNotSendableError,
  DepositsUnavailableError,
  InsufficientFundsError,
  InsufficientGasError,
  InvalidDepositAmountError,
  InvalidTransferError,
  isDepositAmount,
  MAX_DEPOSIT_GAS,
  MAX_FEE_MULTIPLE,
  MAX_NATIVE_TRANSFER_GAS,
  SignedTransactionMismatchError,
  TransferAlreadyRecordedError,
  type DepositAmountAusd,
} from "./features/wallets/domain/deposit.js";
export {
  agentWalletPolicies,
  delegatedSelfDeletePolicy,
  DELEGATED_CREDENTIAL_ACTIVITY_TYPES,
  MIN_AGENT_WALLET_POLICIES,
  VENUE_CONTRACTS,
  type TurnkeyPolicy,
} from "./features/wallets/domain/agent-wallet-policies.js";
export type {
  AddPasskeyActivityBuilder,
  AgentWallet,
  AgentWalletActivityBuilders,
  ExistingAgentWallet,
  AgentWalletRepository,
  AgentWalletSummary,
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  DepositChain,
  NativeTransferInspection,
  UnlinkedAgentWallet,
  Passkey,
  RegistrationInput,
  StoredChallenge,
  SubOrganizationCreator,
  TransferInspection,
  UnsignedActivity,
  WalletBalanceReader,
} from "./features/wallets/ports/custody.js";
export {
  createCustodyService,
  type CustodyServiceDeps,
  type TransferRequest,
} from "./features/wallets/application/custody.js";

export * from "./features/identity/domain/wallet-auth.js";
export { MAX_OPEN_NONCES_PER_ADDRESS } from "./features/identity/ports/wallet-identity.js";
export type {
  AccountProvisioner,
  NonceHolder,
  NonceStore,
  SignatureVerifier,
  WalletLink,
  WalletLinkRepository,
} from "./features/identity/ports/wallet-identity.js";
export {
  AccountNotJoinableError,
  AddressTakenError,
  BadSignatureError,
  createWalletSignIn,
  ExpiredNonceError,
  joinStatement,
  NoAccountToJoinError,
  NONCE_TTL_MS,
  PRESENTED_WALLET_KINDS,
  SameAccountError,
  SIGN_IN_STATEMENT,
  UnknownNonceError,
  WalletAccountConflictError,
  WrongDomainError,
  WrongPurposeError,
  type Presented,
  type PresentedWalletKind,
  type SignedMessage,
} from "./features/identity/application/wallet-sign-in.js";

export * from "./features/perps/types.js";
export * from "./features/perps/service.js";

export * from "./features/research/trading-config.js";

export * from "./features/advice/index.js";

export * from "./features/ai-credits/index.js";
export * from "./features/studio/access-requests.js";

export { assertPerplSelection } from "./features/perps/service.js";
export type { PerplMarketCatalog } from "./features/perps/types.js";

export * from "./features/studio/x-oauth.js";
