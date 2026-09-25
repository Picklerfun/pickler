/**
 * The rules an agent's wallet is born with, written in Turnkey's policy language and approved by
 * the person's passkey. See docs/specs/studio-create-and-fund-v1.md §4.1.
 *
 * Pure strings, no vendor types: core cannot see @turnkey/http. The field names match Turnkey's
 * `v1CreatePolicyIntentV3`, and the adapter that sends them is typed against it.
 *
 * How Turnkey resolves these (policies/overview in its documentation): the root quorum — the
 * person's passkey — bypasses every policy; otherwise any applicable DENY wins over every ALLOW;
 * otherwise one applicable ALLOW is enough; otherwise the outcome is an implicit deny. There is
 * no ordering between policies, so "first" below is only the order of the array.
 */

export interface TurnkeyPolicy {
  policyName: string;
  effect: "EFFECT_ALLOW" | "EFFECT_DENY";
  /** Absent means the policy applies to every non-root user, which is what the DENYs want. */
  consensus?: string;
  condition: string;
  notes: string;
}

/**
 * The contracts the delegated user may send a transaction to. Empty until live trading exists:
 * with it empty no ALLOW policy is written, so the delegated user can sign nothing at all — the
 * paper-only state the studio ships in. Filling it is the trading work, not a configuration flag.
 */
export const VENUE_CONTRACTS: readonly string[] = [];

/** ERC-20 `transfer(address,uint256)` and `approve(address,uint256)`, as `eth.tx.data[0..10]`. */
const TRANSFER_SELECTOR = "0xa9059cbb";
const APPROVE_SELECTOR = "0x095ea7b3";

/**
 * Every value below is interpolated into a policy language, inside single quotes. Nothing that
 * could close a quote gets that far: an id is letters, digits and hyphens (Turnkey's are UUIDs),
 * and an address is hex. Production addresses are 20 bytes; the check is on the alphabet, which
 * is what makes interpolation safe, and the length is the caller's business.
 */
const ID = /^[A-Za-z0-9-]+$/;
const ADDRESS = /^0x[0-9a-fA-F]+$/;

function id(value: string, what: string): string {
  if (!ID.test(value)) {
    throw new Error(`Refusing to write a policy for a malformed ${what}`);
  }
  return value;
}

function address(value: string): string {
  if (!ADDRESS.test(value)) {
    throw new Error("Refusing to write a policy for a malformed contract address");
  }
  return value.toLowerCase();
}

const onlyDelegated = (delegatedUserId: string) =>
  `approvers.any(user, user.id == '${delegatedUserId}')`;

/**
 * The wallet's rules, in this order: trade only to the venue (omitted when there is no venue),
 * never an ERC-20 transfer or approve, and only root changes the rules.
 */
export function agentWalletPolicies(input: {
  delegatedUserId: string;
  walletId: string;
  venueContracts: readonly string[];
}): TurnkeyPolicy[] {
  const delegatedUserId = id(input.delegatedUserId, "delegated user id");
  const walletId = id(input.walletId, "wallet id");
  const venues = input.venueContracts.map(address);
  const policies: TurnkeyPolicy[] = [];

  if (venues.length > 0) {
    const destinations = venues.map((venue) => `eth.tx.to == '${venue}'`).join(" || ");
    policies.push({
      policyName: "Trade only, from this wallet, to the venue",
      effect: "EFFECT_ALLOW",
      consensus: onlyDelegated(delegatedUserId),
      condition: `activity.action == 'SIGN' && wallet.id == '${walletId}' && (${destinations})`,
      notes:
        "Pickler's delegated user may sign transactions from this wallet only to the listed venue contracts.",
    });
  }

  policies.push({
    policyName: "Never a transfer out",
    effect: "EFFECT_DENY",
    condition: `wallet.id == '${walletId}' && (eth.tx.data[0..10] == '${TRANSFER_SELECTOR}' || eth.tx.data[0..10] == '${APPROVE_SELECTOR}')`,
    notes: "The agent never withdraws: no ERC-20 transfer or approve, whatever else is allowed.",
  });

  policies.push({
    policyName: "Only root changes the rules",
    effect: "EFFECT_DENY",
    condition: "activity.resource == 'POLICY'",
    notes: "The delegated user may not create, update or delete policies.",
  });

  return policies;
}

/**
 * Written once per sub-organization, with the first agent's policies: the delegated user may
 * delete itself and no other user, so a compromised Pickler key can be cut without the person
 * present. The shape is Turnkey's own agentic-wallet example.
 */
export function delegatedSelfDeletePolicy(delegatedUserId: string): TurnkeyPolicy {
  const da = id(delegatedUserId, "delegated user id");
  return {
    policyName: "Pickler may remove itself",
    effect: "EFFECT_ALLOW",
    consensus: onlyDelegated(da),
    condition: `activity.type == 'ACTIVITY_TYPE_DELETE_USERS' && activity.params.user_ids.count() == 1 && '${da}' in activity.params.user_ids`,
    notes: "Pickler's delegated user may delete itself, and no other user.",
  };
}
