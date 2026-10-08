import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  AccessDeniedError,
  PilotError,
  XFailure,
  XHandleTakenError,
  X_READ_SCOPES,
  type XActor,
  type XApiPolicy,
  type XAttempt,
  type XGrant,
  type XIdentity,
  type XOAuthStore,
  type XTokens,
} from "@pickler/core";
import { encryptAes256Gcm, decryptAes256Gcm } from "../crypto/aes-256-gcm.js";

export class PostgresXOAuthStore implements XOAuthStore {
  constructor(
    private readonly pool: Pool,
    private readonly key: string,
    private readonly keyVersion: number,
  ) {}
  private async tx<T>(run: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const result = await run(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  private async owner(db: Pool | PoolClient, a: XActor, lock = false, creator = true) {
    const result = await db.query(
      `SELECT p.product_agent_id FROM pickler.product_agents p
      JOIN identity.workspaces w ON w.id=p.workspace_id
      JOIN pickler.research_access r ON r.user_id=w.owner_user_id
      JOIN agents.agents a ON a.id=p.product_agent_id
      WHERE p.product_agent_id=$1 AND p.workspace_id=$2 AND p.tenant_id=$3
        AND w.owner_user_id=$4 AND w.is_active ${creator ? "AND r.enabled AND a.killed_at IS NULL" : ""}
      ${lock ? "FOR SHARE OF w,r,p" : ""}`,
      [a.agentId, a.workspaceId, a.tenantId, a.userId],
    );
    if (!result.rowCount) {
      throw new AccessDeniedError("Agent ownership or creator access changed");
    }
    if (lock) {
      const agent = await db.query(
        "SELECT id FROM agents.agents WHERE id=$1 AND ($2::boolean OR killed_at IS NULL) FOR UPDATE",
        [a.agentId, !creator],
      );
      if (!agent.rowCount) {
        throw new AccessDeniedError("Agent is unavailable");
      }
    }
  }
  private async seal(tokens: XTokens) {
    return encryptAes256Gcm(JSON.stringify(tokens), this.key);
  }
  private async open(raw: string, version: number): Promise<XTokens> {
    if (version !== this.keyVersion || !this.key) {
      throw new XFailure("X_RECONNECT_REQUIRED");
    }
    const value = JSON.parse(await decryptAes256Gcm(raw, this.key));
    return { ...value, expiresAt: new Date(value.expiresAt) };
  }
  async pendingRevocations(a: XActor) {
    await this.owner(this.pool, a, false, false);
    const rows = await this.pool.query(
      "SELECT id,token,key_version FROM agents.x_oauth_revocations WHERE agent_id=$1 ORDER BY created_at",
      [a.agentId],
    );
    const pending = [];
    for (const row of rows.rows) {
      if (row.key_version !== this.keyVersion) {
        throw new XFailure("X_UNAVAILABLE");
      }
      pending.push({ id: row.id as string, token: await decryptAes256Gcm(row.token, this.key) });
    }
    return pending;
  }
  async retainRevocation(a: XActor, token: string) {
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO agents.x_oauth_revocations (id,agent_id,token,key_version) VALUES ($1,$2,$3,$4)",
      [id, a.agentId, await encryptAes256Gcm(token, this.key), this.keyVersion],
    );
    return id;
  }
  async clearRevocation(a: XActor, id: string) {
    await this.pool.query("DELETE FROM agents.x_oauth_revocations WHERE agent_id=$1 AND id=$2", [
      a.agentId,
      id,
    ]);
  }
  private async archive(db: PoolClient, a: XActor) {
    await db.query(
      `INSERT INTO agents.x_account_history (id,agent_id,x_user_id,handle,verified_at,verification_post_id,verification_method)
      SELECT $2,agent_id,x_user_id,handle,verified_at,verification_post_id,verification_method FROM agents.x_accounts WHERE agent_id=$1`,
      [a.agentId, randomUUID()],
    );
  }
  async saveAttempt(a: XAttempt) {
    const verifier = await encryptAes256Gcm(a.verifier, this.key);
    await this.tx(async (db) => {
      await this.owner(db, a, true);
      const recent = await db.query(
        "SELECT 1 FROM agents.x_oauth_attempts WHERE agent_id=$1 AND created_at>now()-interval '10 seconds'",
        [a.agentId],
      );
      if (recent.rowCount) {
        throw new XFailure("X_RATE_LIMITED", 10);
      }
      await db.query(
        "UPDATE agents.x_oauth_attempts SET status='finished',verifier='' WHERE agent_id=$1 AND status='pending'",
        [a.agentId],
      );
      await db.query(
        `INSERT INTO agents.x_oauth_attempts (id,agent_id,user_id,workspace_id,tenant_id,state_hash,browser_hash,verifier,key_version,return_to,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          a.id,
          a.agentId,
          a.userId,
          a.workspaceId,
          a.tenantId,
          a.stateHash,
          a.browserHash,
          verifier,
          this.keyVersion,
          a.returnTo,
          a.expiresAt,
        ],
      );
      await db.query(
        "DELETE FROM agents.x_oauth_attempts WHERE agent_id=$1 AND expires_at<now()-interval '1 day'",
        [a.agentId],
      );
    });
  }
  async claimAttempt(stateHash: string, browserHash: string, now: Date): Promise<XAttempt> {
    const result = await this.pool.query(
      `UPDATE agents.x_oauth_attempts SET status='processing'
      WHERE state_hash=$1 AND browser_hash=$2 AND status='pending' AND expires_at>$3
      RETURNING id,agent_id AS "agentId",user_id AS "userId",workspace_id AS "workspaceId",tenant_id AS "tenantId",state_hash AS "stateHash",browser_hash AS "browserHash",verifier,key_version AS "keyVersion",return_to AS "returnTo",expires_at AS "expiresAt"`,
      [stateHash, browserHash, now],
    );
    const row = result.rows[0];
    if (!row) {
      throw new PilotError("X_OAUTH_INVALID", "Start Connect X again");
    }
    if (row.keyVersion !== this.keyVersion) {
      throw new XFailure("X_UNAVAILABLE");
    }
    return { ...row, verifier: await decryptAes256Gcm(row.verifier, this.key) };
  }
  async finishAttempt(id: string) {
    await this.pool.query(
      "UPDATE agents.x_oauth_attempts SET status='finished',verifier='' WHERE id=$1",
      [id],
    );
  }
  async legacy(a: XActor) {
    await this.owner(this.pool, a, false, false);
    const result = await this.pool.query(
      "SELECT handle,verified_at AS \"verifiedAt\" FROM agents.x_accounts WHERE agent_id=$1 AND verification_method='post'",
      [a.agentId],
    );
    return result.rows[0] ?? null;
  }
  async grant(a: XActor): Promise<XGrant | null> {
    await this.owner(this.pool, a, false, false);
    const result = await this.pool.query(
      `SELECT g.*,x.x_user_id,x.handle,x.verified_at FROM agents.x_oauth_grants g
      JOIN agents.x_accounts x ON x.agent_id=g.agent_id WHERE g.agent_id=$1 AND g.workspace_id=$2 AND g.tenant_id=$3`,
      [a.agentId, a.workspaceId, a.tenantId],
    );
    const r = result.rows[0];
    if (!r) {
      return null;
    }
    let tokens: XTokens | null = null;
    try {
      tokens =
        r.tokens && (r.user_id === a.userId || r.status === "revocation_pending")
          ? await this.open(r.tokens, r.key_version)
          : null;
    } catch {
      /* Status remains diagnosable, no plaintext escapes. */
    }
    const status = r.status === "connected" && !tokens ? "reconnect_required" : r.status;
    return {
      ...a,
      identity: { id: r.x_user_id, handle: r.handle },
      status,
      tokens,
      version: r.version,
      verifiedAt: r.verified_at,
    };
  }
  async connect(a: XAttempt, identity: XIdentity, tokens: XTokens, now: Date) {
    const encrypted = await this.seal(tokens);
    try {
      await this.tx(async (db) => {
        await this.owner(db, a, true);
        const attempt = await db.query(
          "SELECT 1 FROM agents.x_oauth_attempts WHERE id=$1 AND status='processing' AND expires_at>$2 AND agent_id=$3 AND user_id=$4 AND workspace_id=$5 AND tenant_id=$6 FOR UPDATE",
          [a.id, now, a.agentId, a.userId, a.workspaceId, a.tenantId],
        );
        if (!attempt.rowCount) {
          throw new PilotError("X_OAUTH_INVALID", "Start Connect X again");
        }
        const old = await db.query(
          "SELECT x_user_id FROM agents.x_accounts WHERE agent_id=$1 FOR UPDATE",
          [a.agentId],
        );
        if (old.rows[0] && old.rows[0].x_user_id !== identity.id) {
          throw new PilotError(
            "X_ACCOUNT_MISMATCH",
            "Disconnect the previous account before changing it",
          );
        }
        const pending = await db.query(
          "SELECT status FROM agents.x_oauth_grants WHERE agent_id=$1 FOR UPDATE",
          [a.agentId],
        );
        if (pending.rows[0]?.status === "revocation_pending") {
          throw new PilotError("X_REVOCATION_PENDING", "Finish disconnecting before reconnecting");
        }
        if (old.rows[0]) {
          await this.archive(db, a);
        }
        await db.query(
          `INSERT INTO agents.x_accounts (agent_id,x_user_id,handle,verified_at,verification_method)
          VALUES ($1,$2,$3,$4,'oauth') ON CONFLICT (agent_id) DO UPDATE SET handle=$3,verified_at=$4,verification_method='oauth'`,
          [a.agentId, identity.id, identity.handle, now],
        );
        await db.query(
          `INSERT INTO agents.x_oauth_grants (agent_id,user_id,workspace_id,tenant_id,status,tokens,key_version,scopes,expires_at)
          VALUES ($1,$2,$3,$4,'connected',$5,$6,$7,$8)
          ON CONFLICT (agent_id) DO UPDATE SET user_id=$2,workspace_id=$3,tenant_id=$4,status='connected',tokens=$5,key_version=$6,scopes=$7,expires_at=$8,version=agents.x_oauth_grants.version+1,refresh_claim=NULL,refresh_started_at=NULL,validated_at=NULL`,
          [
            a.agentId,
            a.userId,
            a.workspaceId,
            a.tenantId,
            encrypted,
            this.keyVersion,
            JSON.stringify(tokens.scopes),
            tokens.expiresAt,
          ],
        );
        await db.query("UPDATE agents.agent_profiles SET x_handle=$2 WHERE agent_id=$1", [
          a.agentId,
          `@${identity.handle}`,
        ]);
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new XHandleTakenError();
      }
      throw error;
    }
  }
  async claimRefresh(a: XActor, version: number, now: Date) {
    const claim = randomUUID();
    const status = await this.tx(async (db) => {
      await this.owner(db, a, true);
      const row = (
        await db.query("SELECT * FROM agents.x_oauth_grants WHERE agent_id=$1 FOR UPDATE", [
          a.agentId,
        ])
      ).rows[0];
      if (!row || row.version !== version || row.status !== "connected") {
        throw new XFailure("X_RECONNECT_REQUIRED");
      }
      if (row.refresh_claim) {
        if (now.getTime() - row.refresh_started_at.getTime() > 30_000) {
          await db.query(
            "UPDATE agents.x_oauth_grants SET status='reconnect_required',validated_at=NULL WHERE agent_id=$1",
            [a.agentId],
          );
          return "lost";
        }
        return "busy";
      }
      await db.query(
        "UPDATE agents.x_oauth_grants SET refresh_claim=$2,refresh_started_at=$3,validated_at=NULL WHERE agent_id=$1",
        [a.agentId, claim, now],
      );
      return "claimed";
    });
    if (status === "lost") {
      throw new XFailure("X_RECONNECT_REQUIRED");
    }
    if (status === "busy") {
      throw new PilotError("X_REFRESH_BUSY", "Connection refresh is in progress; try again");
    }
    return claim;
  }
  async finishRefresh(a: XActor, version: number, claim: string, tokens: XTokens, now: Date) {
    const encrypted = await this.seal(tokens);
    await this.tx(async (db) => {
      await this.owner(db, a, true);
      const result = await db.query(
        `UPDATE agents.x_oauth_grants SET tokens=$4,key_version=$5,scopes=$6,expires_at=$7,version=version+1,refresh_claim=NULL,refresh_started_at=NULL,validated_at=NULL
        WHERE agent_id=$1 AND version=$2 AND refresh_claim=$3 AND status='connected' AND refresh_started_at>$8::timestamptz-interval '30 seconds'`,
        [
          a.agentId,
          version,
          claim,
          encrypted,
          this.keyVersion,
          JSON.stringify(tokens.scopes),
          tokens.expiresAt,
          now,
        ],
      );
      if (!result.rowCount) {
        throw new XFailure("X_RECONNECT_REQUIRED");
      }
    });
  }
  async reconnect(a: XActor, version: number) {
    await this.pool.query(
      "UPDATE agents.x_oauth_grants SET status='reconnect_required',validated_at=NULL WHERE agent_id=$1 AND version=$2 AND status='connected'",
      [a.agentId, version],
    );
  }
  async assertGrant(a: XActor, version: number) {
    await this.owner(this.pool, a, false, false);
    const result = await this.pool.query(
      "SELECT 1 FROM agents.x_oauth_grants WHERE agent_id=$1 AND user_id=$2 AND version=$3 AND status='connected' AND refresh_claim IS NULL AND expires_at>now()",
      [a.agentId, a.userId, version],
    );
    if (!result.rowCount) {
      throw new XFailure("X_RECONNECT_REQUIRED");
    }
  }
  async validatePublication(a: XActor, version: number, now: Date) {
    await this.tx(async (db) => {
      await this.owner(db, a, true);
      const result = await db.query(
        "UPDATE agents.x_oauth_grants SET validated_at=$3 WHERE agent_id=$1 AND version=$2 AND status='connected' AND refresh_claim IS NULL AND expires_at>$3 AND scopes @> $4::jsonb",
        [a.agentId, version, now, JSON.stringify(X_READ_SCOPES)],
      );
      if (!result.rowCount) {
        throw new XFailure("X_RECONNECT_REQUIRED");
      }
    });
  }
  async disconnect(a: XActor) {
    await this.tx(async (db) => {
      await this.owner(db, a, true, false);
      await db.query(
        "UPDATE agents.x_oauth_attempts SET status='finished',verifier='' WHERE agent_id=$1 AND status IN ('pending','processing')",
        [a.agentId],
      );
      const row = (
        await db.query(
          "SELECT tokens,key_version,status FROM agents.x_oauth_grants WHERE agent_id=$1 FOR UPDATE",
          [a.agentId],
        )
      ).rows[0];
      let pendingTokens = row?.tokens ?? null;
      if (row?.tokens && row.key_version === this.keyVersion && this.key) {
        const tokens = await this.open(row.tokens, row.key_version);
        if (row.status !== "revocation_pending") {
          for (const token of new Set([tokens.accessToken, tokens.refreshToken])) {
            await db.query(
              "INSERT INTO agents.x_oauth_revocations (id,agent_id,token,key_version) VALUES ($1,$2,$3,$4)",
              [randomUUID(), a.agentId, await encryptAes256Gcm(token, this.key), this.keyVersion],
            );
          }
        }
        pendingTokens = await this.seal({
          ...tokens,
          accessToken: "",
          refreshToken: "",
          scopes: [],
        });
      }
      await db.query(
        "UPDATE agents.x_oauth_grants SET status='revocation_pending',tokens=$2,version=version+1,validated_at=NULL,refresh_claim=NULL WHERE agent_id=$1 AND status<>'revocation_pending'",
        [a.agentId, pendingTokens],
      );
      await db.query("UPDATE agents.agent_profiles SET x_handle=NULL WHERE agent_id=$1", [
        a.agentId,
      ]);

      const oauth = await db.query("SELECT 1 FROM agents.x_oauth_grants WHERE agent_id=$1", [
        a.agentId,
      ]);
      if (!oauth.rowCount) {
        await this.archive(db, a);
        await db.query("DELETE FROM agents.x_accounts WHERE agent_id=$1", [a.agentId]);
      }
    });
    return this.grant(a);
  }
  async revoked(a: XActor, version: number) {
    await this.tx(async (db) => {
      await this.owner(db, a, true, false);
      await this.archive(db, a);
      const result = await db.query(
        "DELETE FROM agents.x_oauth_grants WHERE agent_id=$1 AND version=$2 AND status='revocation_pending' RETURNING agent_id",
        [a.agentId, version],
      );
      if (result.rowCount) {
        await db.query("DELETE FROM agents.x_accounts WHERE agent_id=$1", [a.agentId]);
      }
    });
  }
  async reserveRead(a: XActor, kind: "identity" | "posts", policy: XApiPolicy, now: Date) {
    await this.tx(async (db) => {
      await this.owner(db, a, true);
      const day = now.toISOString().slice(0, 10);
      await db.query(
        "INSERT INTO agents.x_api_usage (agent_id,day,policy_version) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [a.agentId, day, policy.version],
      );
      const row = (
        await db.query("SELECT * FROM agents.x_api_usage WHERE agent_id=$1 AND day=$2 FOR UPDATE", [
          a.agentId,
          day,
        ])
      ).rows[0];
      if (row.retry_at && row.retry_at > now) {
        throw new XFailure(
          "X_RATE_LIMITED",
          Math.ceil((row.retry_at.getTime() - now.getTime()) / 1000),
        );
      }
      if (
        (kind === "identity" && row.identity_requests >= policy.identityRequestsPerDay) ||
        (kind === "posts" &&
          (row.post_requests >= policy.postRequestsPerDay ||
            row.post_resources + 20 > policy.postResourcesPerDay))
      ) {
        throw new XFailure(
          "X_RATE_LIMITED",
          Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86_400_000 - now.getTime()) / 1000),
        );
      }
      await db.query(
        "INSERT INTO agents.x_api_calls (id,agent_id,kind,policy_version,reserved_resources,started_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [randomUUID(), a.agentId, kind, policy.version, kind === "posts" ? 20 : 1, now],
      );
      await db.query(
        `UPDATE agents.x_api_usage SET identity_requests=identity_requests+$3,post_requests=post_requests+$4,post_resources=post_resources+$5,policy_version=$6 WHERE agent_id=$1 AND day=$2`,
        [
          a.agentId,
          day,
          kind === "identity" ? 1 : 0,
          kind === "posts" ? 1 : 0,
          kind === "posts" ? 20 : 0,
          policy.version,
        ],
      );
    });
  }
  async rateLimited(a: XActor, retryAfter: number, now: Date) {
    await this.pool.query(
      "UPDATE agents.x_api_usage SET retry_at=GREATEST(retry_at,$3) WHERE agent_id=$1 AND day=$2",
      [a.agentId, now.toISOString().slice(0, 10), new Date(now.getTime() + retryAfter * 1000)],
    );
  }
}
