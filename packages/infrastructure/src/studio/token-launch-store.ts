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
} from "@pickler/core";

export function tokenAgentKey(chainId: number, agentId: string): string {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "bytes16" }],
      ["pickler.agent.v1", BigInt(chainId), `0x${agentId.replaceAll("-", "")}`],
    ),
  );
}
export class PostgresTokenLaunchStore implements TokenLaunchRepository {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(
    scope: TokenScope,
    chainId: number | null,
    work: (tx: TokenTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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
      const time = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
      const context: TokenContext = {
        ...agent.rows[0],
        ownerUserId: owner.ownerUserId,
        enabled: access.rows[0]?.enabled ?? false,
        accent: profile.rows[0]?.accent ?? "lime",
        avatarPattern: profile.rows[0]?.avatarPattern ?? 0,
        masterAddress: master.rows[0]?.address.toLowerCase() ?? null,
        token: token.token,
        confirmationPending: token.pending,
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
      const result = await work({
        context,
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
          if (pending.rowCount) {
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
