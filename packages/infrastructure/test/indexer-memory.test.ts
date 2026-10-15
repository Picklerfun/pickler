import test from "node:test";
import assert from "node:assert/strict";
import { tokenFixture } from "./token-fixture.js";
import { lockCanonicalGraduationBlocks } from "../src/launch/projection-locks.js";

test("position reconciliation returns one scalar even with a large unrelated header history", async (t) => {
  const f = await tokenFixture(t);
  await f.store.pool.query(`
    INSERT INTO market.chain_blocks(chain,hash,number,parent_hash,block_time,finality)
    SELECT 'eip155:10143','0x'||lpad(to_hex(n),64,'0'),n,
           '0x'||lpad(to_hex(n-1),64,'0'),now(),'confirmed'
    FROM generate_series(1,100000) n
  `);
  const client = await f.store.pool.connect();
  try {
    const previous = await client.query(
      "SELECT hash FROM market.chain_blocks WHERE chain='eip155:10143' AND NOT orphaned FOR SHARE",
    );
    assert.equal(previous.rowCount, 100000, "the former query materialized every header");
    await client.query("BEGIN");
    assert.equal(await lockCanonicalGraduationBlocks(client, "uniswap"), 0);
    assert.equal(await lockCanonicalGraduationBlocks(client, "kuru"), 0);
    await client.query("COMMIT");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
