import { readAgentToken } from "./token-read.js";
import type { Pool } from "pg";
import { encodeAbiParameters, keccak256 } from "viem";
import {
  TokenLaunchError,
  type TokenAuthorization,
  type TokenContext,
  type TokenDraft,
  type TokenLaunchRepository,
  type TokenScope,
  type TokenTransaction,
  type TokenIntent,
  type TokenIntentTransaction,
} from "@pickler/core";

export function tokenAgentKey(chainId: number, agentId: string): string {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "bytes16" }],
      ["pickler.agent.v1", BigInt(chainId), `0x${agentId.replaceAll("-", "")}`],
    ),
  );
}
function contextMaster(rows: { address: string }[]) {
  return rows.length === 1;
}
export class PostgresTokenLaunchStore implements TokenLaunchRepository {
  constructor(
    private readonly pool: Pool,
    private readonly escrow?: string,
    private readonly quote?: string,
  ) {}
  async transaction<T>(
    scope: TokenScope,
    chainId: number | null,
    work: (tx: TokenTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // One master wallet per owner. This short fence also covers agents in other workspaces.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `launch:${scope.userId}:${chainId}`,
      ]);
      const workspace = await client.query<{ ownerUserId: string; active: boolean }>(
        `SELECT owner_user_id AS "ownerUserId", is_active AS active FROM identity.workspaces WHERE id=$1 FOR NO KEY UPDATE`,
        [scope.workspaceId],
      );
      const owner = workspace.rows[0];
      if (!owner || !owner.active || owner.ownerUserId !== scope.userId) {
        throw new TokenLaunchError("TOKEN_OWNER_REQUIRED");
      }
      const access = await client.query<{ enabled: boolean }>(
        "SELECT enabled FROM pickler.research_access WHERE user_id=$1 FOR SHARE",
        [owner.ownerUserId],
      );
      const agent = await client.query<{
        name: string;
        handle: string;
        visibility: "private" | "public";
        published: boolean;
        killed: boolean;
      }>(
        `SELECT name,handle,visibility,published_at IS NOT NULL AS published,killed_at IS NOT NULL AS killed FROM agents.agents WHERE id=$1 AND workspace_id=$2 FOR NO KEY UPDATE`,
        [scope.agentId, scope.workspaceId],
      );
      if (!agent.rows[0]) {
        throw new TokenLaunchError("TOKEN_NOT_FOUND");
      }
      const master = await client.query<{ address: string }>(
        `SELECT a.address FROM wallets.turnkey_orgs o JOIN wallets.wallets w ON w.wallet_id=o.master_wallet_id AND w.user_id=o.user_id AND w.kind='master' JOIN wallets.wallet_accounts a ON a.wallet_id=w.wallet_id AND a.chain='monad' WHERE o.user_id=$1 ORDER BY a.created_at,a.id LIMIT 2 FOR SHARE OF o,w,a`,
        [scope.userId],
      );
      if (master.rows.length > 1) {
        throw new TokenLaunchError("TOKEN_LAUNCH_BLOCKED", ["MASTER_WALLET_REQUIRED"]);
      }
      const profile = await client.query<{ accent: string; avatarPattern: number }>(
        `SELECT accent, avatar_pattern AS "avatarPattern" FROM agents.agent_profiles WHERE agent_id=$1`,
        [scope.agentId],
      );
      const token = await readAgentToken(client, scope.agentId, chainId);
      let venue: TokenContext["venue"];
      let fees: TokenContext["fees"] = null;
      if (token.token) {
        const graduation = await client.query<{
          market: string;
          vault: string;
          accountId: string;
          positions: { id: string }[];
        }>(
          `SELECT g.market,g.vault,g.account_id::text AS "accountId",g.positions FROM market.kuru_graduations g
          JOIN market.chain_blocks b ON b.chain=g.chain AND b.hash=g.block_hash WHERE g.chain=$1 AND g.token=$2 AND NOT b.orphaned AND b.finality IN ('confirmed','finalized') ORDER BY g.block_number DESC LIMIT 1`,
          [`eip155:${chainId}`, token.token.address],
        );
        const completed = await client.query(
          `SELECT 1 FROM market.chain_events e JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash JOIN market.pools p ON p.address=e.emitter JOIN market.tokens t ON t.id=p.token_id AND t.chain=e.chain WHERE e.chain=$1 AND t.address=$2 AND p.phase='pre_graduation' AND e.event_name='CurveCompleted' AND lower(e.decoded->>'token')=t.address AND NOT e.orphaned AND NOT b.orphaned AND b.finality IN ('confirmed','finalized') LIMIT 1`,
          [`eip155:${chainId}`, token.token.address],
        );
        const g = graduation.rows[0];
        venue = g
          ? {
              status: "kuru",
              readyToGraduate: false,
              market: g.market,
              vault: g.vault,
              accountId: g.accountId,
              positions: g.positions.map((p) => p.id),
              liquidityLocked: true,
            }
          : {
              status: "curve",
              readyToGraduate: !!completed.rowCount,
              market: null,
              vault: null,
              accountId: null,
              positions: [],
              liquidityLocked: false,
            };
        if (this.escrow && contextMaster(master.rows)) {
          const cursor = await client.query<{ block: number }>(
            `SELECT last_block AS block FROM market.indexer_cursors WHERE chain=$1 AND contract=$2 AND stream='token-launch-v1'`,
            [`eip155:${chainId}`, this.escrow],
          );
          if (cursor.rows[0]) {
            const balances = await client.query<{ asset: string; amount: string }>(
              `SELECT lower(e.decoded->>'asset') AS asset,sum(CASE WHEN e.event_name='FeeAccrued' THEN (e.decoded->>'amount')::numeric ELSE -(e.decoded->>'amount')::numeric END)::text AS amount
              FROM market.chain_events e JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
              WHERE e.chain=$1 AND e.emitter=$2 AND NOT e.orphaned AND NOT b.orphaned AND b.finality IN ('confirmed','finalized')
              AND ((e.event_name='FeeAccrued' AND lower(e.decoded->>'beneficiary')=$3) OR (e.event_name='FeeClaimed' AND lower(e.decoded->>'beneficiary')=$3)) GROUP BY lower(e.decoded->>'asset')`,
              [`eip155:${chainId}`, this.escrow, master.rows[0]!.address.toLowerCase()],
            );
            const ausd = BigInt(balances.rows.find((b) => b.asset === this.quote)?.amount ?? "0"),
              agent = balances.rows.find((b) => b.asset === token.token!.address)?.amount ?? "0";
            if (ausd < 0n || BigInt(agent) < 0n) {
              throw new Error("FEE_PROJECTION_INCONSISTENT");
            }
            fees = {
              ausd: ausd.toString(),
              agent,
              block: cursor.rows[0].block,
              scope: "master_wallet",
            };
          }
        }
      }
      const submission = await client.query(
        `SELECT 1 FROM launch.operations WHERE agent_id=$1 AND chain=$2 AND action='launch' AND status IN ('submitting','confirming','included','finalized','unknown') AND payload->>'txHash' IS NOT NULL LIMIT 1`,
        [scope.agentId, `eip155:${chainId}`],
      );
      const time = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
      const context: TokenContext = {
        ...agent.rows[0],
        ownerUserId: owner.ownerUserId,
        workspaceId: scope.workspaceId,
        enabled: access.rows[0]?.enabled ?? false,
        accent: profile.rows[0]?.accent ?? "lime",
        avatarPattern: profile.rows[0]?.avatarPattern ?? 0,
        masterAddress: master.rows[0]?.address.toLowerCase() ?? null,
        token: token.token,
        confirmationPending: token.pending || (!token.token && !!submission.rowCount),
        ...(venue ? { venue } : {}),
        fees,
      };
      const chain = chainId === null ? null : `eip155:${chainId}`;
      const readDraft = async (): Promise<TokenDraft | null> => {
        const result = await client.query<{
          id: string;
          version: number;
          params: { name: string; ticker: string };
          status: string;
        }>("SELECT id,version,params,status FROM launch.drafts WHERE agent_id=$1 AND chain=$2", [
          scope.agentId,
          chain,
        ]);
        const d = result.rows[0];
        return d
          ? {
              id: d.id,
              version: d.version,
              name: d.params.name,
              ticker: d.params.ticker,
              status: d.status === "prepared" ? "prepared" : "draft",
            }
          : null;
      };
      const readIntent: TokenIntentTransaction["read"] = async (key) => {
        const r = await client.query<{ payload: TokenIntent }>(
          `SELECT payload FROM launch.operations WHERE agent_id=$1 AND chain=$2 AND owner_id=$3 AND (request_key=$4 OR id::text=$4)`,
          [scope.agentId, chain, scope.userId, key],
        );
        return r.rows[0]?.payload ?? null;
      };
      const activeIntent = async () => {
        await client.query(
          `UPDATE launch.operations SET status='failed',version=version+1,payload=payload || jsonb_build_object('status','failed','error','AUTHORIZATION_EXPIRED','version',version+1)
          WHERE owner_id=$1 AND chain=$2 AND status IN ('preparing','awaiting_signature') AND expires_at<=clock_timestamp() AND payload->>'activityId' IS NULL AND payload->>'txHash' IS NULL`,
          [scope.userId, chain],
        );
        const r = await client.query(
          `SELECT 1 FROM launch.operations WHERE owner_id=$1 AND chain=$2 AND
          (status IN ('signing','signed','submitting','confirming','included','unknown') OR
          (status IN ('preparing','awaiting_signature') AND expires_at>clock_timestamp())) LIMIT 1`,
          [scope.userId, chain],
        );
        return !!r.rowCount;
      };
      const intents: TokenIntentTransaction = {
        read: readIntent,
        active: activeIntent,
        reserve: async (input) => {
          if (chainId !== 10143 || (await activeIntent())) {
            throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
          }
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          const nonce = BigInt(
            "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
          ).toString();
          const intent: TokenIntent = { ...input, id: crypto.randomUUID(), version: 1, nonce };
          await client.query(
            `INSERT INTO launch.operations(id,agent_id,owner_id,chain,request_key,action,status,version,nonce,payload,expires_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11))`,
            [
              intent.id,
              scope.agentId,
              scope.userId,
              chain,
              intent.key,
              intent.action,
              intent.status,
              intent.version,
              intent.nonce,
              intent,
              intent.deadline,
            ],
          );
          return intent;
        },
        update: async (intent, patch) => {
          const next = { ...intent, ...patch, version: intent.version + 1 };
          const updated = await client.query(
            `UPDATE launch.operations SET payload=$5,status=$6,version=$7,sender=$8,transaction_nonce=$9,updated_at=clock_timestamp()
            WHERE id=$1 AND agent_id=$2 AND owner_id=$3 AND version=$4`,
            [
              intent.id,
              scope.agentId,
              scope.userId,
              intent.version,
              next,
              next.status,
              next.version,
              next.prepared?.sender.toLowerCase() ?? null,
              next.prepared?.transactionNonce ?? null,
            ],
          );
          if (updated.rowCount !== 1) {
            throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
          }
          if (next.prepared) {
            const prepared = next.prepared;
            const requests = await client.query<{ id: string }>(
              `INSERT INTO launch.transaction_requests(owner_id,chain,sender,destination,params_hash,idempotency_key)
              VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL
              DO UPDATE SET updated_at=launch.transaction_requests.updated_at RETURNING id`,
              [
                scope.userId,
                chain,
                prepared.sender.toLowerCase(),
                prepared.destination.toLowerCase(),
                keccak256(prepared.unsignedTransaction as `0x${string}`),
                intent.id,
              ],
            );
            const transactionId = requests.rows[0]!.id;
            await client.query("UPDATE launch.operations SET transaction_id=$2 WHERE id=$1", [
              intent.id,
              transactionId,
            ]);
            if (next.txHash) {
              await client.query(
                `UPDATE launch.transaction_requests SET tx_hash=$2,block_hash=$3,status=$4,updated_at=clock_timestamp() WHERE id=$1`,
                [
                  transactionId,
                  next.txHash,
                  next.blockHash,
                  next.status === "included"
                    ? "included"
                    : next.status === "finalized"
                      ? "finalized"
                      : next.status === "failed"
                        ? "reverted"
                        : "submitted",
                ],
              );
            }
          }
          return next;
        },
      };
      const result = await work({
        context,
        intents,
        latestOperation: async () => {
          const r = await client.query<{ payload: TokenIntent }>(
            "SELECT payload FROM launch.operations WHERE agent_id=$1 AND chain=$2 AND owner_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
            [scope.agentId, chain, scope.userId],
          );
          return r.rows[0]?.payload ?? null;
        },
        now: time.rows[0]!.now,
        draft: readDraft,
        saveDraft: async (input) => {
          const current = await readDraft();
          if (
            current &&
            current.version === input.expectedVersion + 1 &&
            current.name === input.name &&
            current.ticker === input.ticker
          ) {
            return current;
          }
          if ((current?.version ?? 0) !== input.expectedVersion) {
            throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
          }
          const pending = await client.query(
            "SELECT 1 FROM launch.grants WHERE agent_id=$1 AND chain=$2 AND expires_at > clock_timestamp() LIMIT 1",
            [scope.agentId, chain],
          );
          if (pending.rowCount || (await activeIntent())) {
            throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
          }
          const params = {
            name: input.name,
            ticker: input.ticker,
            avatar: { accent: context.accent, pattern: context.avatarPattern },
          };
          if (current) {
            await client.query(
              "UPDATE launch.drafts SET params=$2,version=version+1,status='draft',updated_at=clock_timestamp() WHERE id=$1",
              [current.id, params],
            );
          } else {
            await client.query(
              "INSERT INTO launch.drafts(owner_id,agent_id,chain,params) VALUES($1,$2,$3,$4)",
              [scope.userId, scope.agentId, chain, params],
            );
          }
          await client.query(
            "INSERT INTO launch.agent_keys(agent_id,chain,agent_key) VALUES($1,$2,$3) ON CONFLICT(agent_id,chain) DO NOTHING",
            [scope.agentId, chain, tokenAgentKey(chainId!, scope.agentId)],
          );
          return (await readDraft())!;
        },
        activeAuthorization: async () => {
          const pending = await client.query(
            "SELECT 1 FROM launch.grants WHERE agent_id=$1 AND chain=$2 AND expires_at > clock_timestamp() LIMIT 1",
            [scope.agentId, chain],
          );
          return !!pending.rowCount;
        },
        authorization: async (key) => {
          const r = await client.query<{ payload: TokenAuthorization; ownerId: string }>(
            `SELECT payload, owner_id AS "ownerId" FROM launch.grants WHERE agent_id=$1 AND chain=$2 AND idempotency_key=$3`,
            [scope.agentId, chain, key],
          );
          if (r.rows[0] && r.rows[0].ownerId !== scope.userId) {
            throw new TokenLaunchError("TOKEN_IDEMPOTENCY_CONFLICT");
          }
          return r.rows[0]?.payload ?? null;
        },
        recordAuthorization: async (key, draft, authorization) => {
          if (authorization.params.agentKey !== tokenAgentKey(chainId!, scope.agentId)) {
            throw new TokenLaunchError("TOKEN_LAUNCH_BLOCKED", ["LAUNCH_UNAVAILABLE"]);
          }
          await client.query(
            `INSERT INTO launch.grants(agent_id,chain,draft_id,draft_version,owner_id,factory,nonce,idempotency_key,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11))`,
            [
              scope.agentId,
              chain,
              draft.id,
              draft.version,
              scope.userId,
              authorization.factory.toLowerCase(),
              authorization.grantNonce,
              key,
              authorization,
              time.rows[0]!.now,
              authorization.grantDeadline,
            ],
          );
          await client.query(
            "UPDATE launch.drafts SET status='prepared',updated_at=clock_timestamp() WHERE id=$1",
            [draft.id],
          );
        },
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
