import type { Pool, PoolClient } from "pg";
import { PilotError, type AgentConfig } from "@pickler/core";
import {
  emptyPerplLiveDocument,
  type PerplLiveAuthority,
  type PerplLiveDocument,
  type PerplLiveRepository,
  type PerplLiveScope,
} from "@pickler/trading/perpl-live";

function micros(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value > 10000) {
    return "0";
  }
  const [whole, fraction = ""] = String(value).split(".");
  return (BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6))).toString();
}
export class PostgresPerplLiveStore implements PerplLiveRepository {
  constructor(private readonly pool: Pool) {}
  private async authority(
    client: Pool | PoolClient,
    scope: PerplLiveScope,
    locked: boolean,
  ): Promise<PerplLiveAuthority> {
    const result = await client.query<{
      tenantId: string;
      agentId: string;
      config: AgentConfig;
      configVersion: number;
      enabled: boolean;
      paused: boolean;
      killed: boolean;
      address: string;
      organizationId: string;
    }>(
      `SELECT p.tenant_id AS "tenantId",p.runtime_agent_id AS "agentId",r.config,r.version AS "configVersion",
      coalesce(a.enabled,false) AS enabled,r.paused,(g.killed_at IS NOT NULL) AS killed,
      c.address,w.sub_organization_id AS "organizationId"
      FROM identity.workspaces x
      JOIN pickler.product_agents p ON p.workspace_id=x.id
      JOIN agents.agents g ON g.id=p.product_agent_id
      JOIN pickler.agents r ON r.tenant_id=p.tenant_id AND r.id=p.runtime_agent_id
      JOIN wallets.agent_wallets l ON l.agent_id=g.id
      JOIN wallets.wallets w ON w.wallet_id=l.wallet_id AND w.user_id=x.owner_user_id AND w.kind='agent'
      JOIN wallets.wallet_accounts c ON c.wallet_id=w.wallet_id AND c.chain='monad'
      LEFT JOIN pickler.research_access a ON a.user_id=x.owner_user_id
      WHERE x.owner_user_id=$1 AND x.is_active AND p.product_agent_id=$2
      ORDER BY c.created_at LIMIT 1 ${locked ? "FOR NO KEY UPDATE OF x,p,g,r,w" : ""}`,
      [scope.userId, scope.productAgentId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Perpl agent not found");
    }
    const selection = row.config.perpl;
    return {
      scope,
      tenantId: row.tenantId,
      agentId: row.agentId,
      address: row.address.toLowerCase(),
      organizationId: row.organizationId,
      configVersion: row.configVersion,
      enabled: row.enabled,
      paused: row.paused,
      killed: row.killed,
      network: selection?.network ?? "",
      markets: selection?.markets ?? [],
      perCallMicros: micros(row.config.spend?.perCallAusd),
      perDayMicros: micros(row.config.spend?.perDayAusd),
    };
  }
  private connectedAuthority(authority: PerplLiveAuthority, document: PerplLiveDocument | null) {
    if (!document) {
      return authority;
    }
    const external = document.connection?.kind === "key_wallet";
    if (
      document.version !== 1 ||
      document.productAgentId !== authority.scope.productAgentId ||
      !/^0x[a-f\d]{40}$/.test(document.address) ||
      (external
        ? document.connection!.custodyAddress !== authority.address
        : document.address !== authority.address)
    ) {
      throw new PilotError("PERPL_ACCOUNT_CHANGED", "Agent wallet identity changed");
    }
    return { ...authority, custodyAddress: authority.address, address: document.address };
  }
  async read(scope: PerplLiveScope) {
    const authority = await this.authority(this.pool, scope, false);
    const r = await this.pool.query<{ document: PerplLiveDocument }>(
      "SELECT document FROM pickler.perpl_live_accounts WHERE product_agent_id=$1",
      [scope.productAgentId],
    );
    const document = r.rows[0]?.document ?? null;
    return { authority: this.connectedAuthority(authority, document), document };
  }
  async transact<T>(
    scope: PerplLiveScope,
    change: (document: PerplLiveDocument, authority: PerplLiveAuthority, now: number) => T,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const authority = await this.authority(client, scope, true);
      await client.query(
        `INSERT INTO pickler.perpl_live_accounts(product_agent_id,document) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [scope.productAgentId, emptyPerplLiveDocument(authority.address, scope.productAgentId)],
      );
      const row = await client.query<{ document: PerplLiveDocument; now: string }>(
        `SELECT document,(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS now FROM pickler.perpl_live_accounts WHERE product_agent_id=$1 FOR UPDATE`,
        [scope.productAgentId],
      );
      const document = row.rows[0]!.document;
      const result = change(
        document,
        this.connectedAuthority(authority, document),
        Number(row.rows[0]!.now),
      );
      this.connectedAuthority(authority, document);
      if (document.encryptedToken && document.accountId) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `perpl-account:10143:${document.address}:${document.accountId}`,
        ]);
        const used = await client.query(
          `SELECT 1 FROM pickler.perpl_live_accounts
           WHERE product_agent_id<>$1 AND document->>'address'=$2
           AND document->>'accountId'=$3 AND document->>'encryptedToken' IS NOT NULL LIMIT 1`,
          [scope.productAgentId, document.address, String(document.accountId)],
        );
        if (used.rowCount) {
          throw new PilotError(
            "PERPL_ACCOUNT_IN_USE",
            "This Perpl account is already connected to an agent",
          );
        }
      }
      if (result && typeof (result as { then?: unknown }).then === "function") {
        throw new Error("Perpl mutation callbacks must be synchronous");
      }
      await client.query(
        "UPDATE pickler.perpl_live_accounts SET document=$2,updated_at=clock_timestamp() WHERE product_agent_id=$1",
        [scope.productAgentId, document],
      );
      await client.query("COMMIT");
      return structuredClone(result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async due(limit: number) {
    const r = await this.pool.query<{ userId: string; productAgentId: string }>(
      `SELECT w.owner_user_id AS "userId",a.product_agent_id AS "productAgentId"
      FROM pickler.perpl_live_accounts a JOIN pickler.product_agents p ON p.product_agent_id=a.product_agent_id
      JOIN identity.workspaces w ON w.id=p.workspace_id
      WHERE w.is_active AND (EXISTS(SELECT 1 FROM jsonb_array_elements(a.document->'sessions') s WHERE s->>'status' IN ('active','paused','stopping','frozen'))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(a.document->'setup') s WHERE s->>'status' IN ('unknown','submitted')))
      ORDER BY a.updated_at LIMIT $1`,
      [Math.max(1, Math.min(limit, 10))],
    );
    return r.rows;
  }
}
