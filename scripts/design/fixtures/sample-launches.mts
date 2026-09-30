// Sample launches for the design checks' token board.
// Not live data: no contract is deployed and nothing here was read from a chain.

import type { LaunchSummaryDto, ReadDto } from "@pickler/api-schema";

const AUSD = {
  chainId: "eip155:10143",
  address: "0x00000000000000000000000000000000000a05d0",
  symbol: "AUSD",
  decimals: 6,
};

const launches: LaunchSummaryDto[] = [
  {
    id: "eip155:10143:0x00000000000000000000000000000000000ha1f0",
    chainId: "eip155:10143",
    address: "0x00000000000000000000000000000000000ha1f0",
    ticker: "$HALF",
    name: "Halftime",
    imageUri: null,
    phase: "pre_graduation",
    agentId: "halftime",
    quote: AUSD,
    totalSupply: "1000000000000000000000000000",
    launchedAt: "2026-09-01T00:00:00.000Z",
    graduatedAt: null,
  },
  {
    id: "eip155:10143:0x0000000000000000000000000000000000007a9e",
    chainId: "eip155:10143",
    address: "0x0000000000000000000000000000000000007a9e",
    ticker: "$TAPE",
    name: "Tape Reader",
    imageUri: null,
    phase: "graduated",
    // A launch nothing links to an agent yet, so the board's UNLINKED AGENT chip is measured too.
    agentId: null,
    quote: AUSD,
    totalSupply: "1000000000000000000000000000",
    launchedAt: "2026-08-12T00:00:00.000Z",
    graduatedAt: "2026-09-20T00:00:00.000Z",
  },
];

/** The launch catalogue as `GET /v1/launches` answers it: the rows, and how fresh they are. */
export function sampleLaunches(): ReadDto<LaunchSummaryDto[]> {
  return {
    data: launches,
    asOfBlock: "48211907",
    asOfBlockHash: "0x5a3f0c1d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a29",
    indexedAt: "2026-09-29T00:00:00.000Z",
    finality: "finalized",
    stale: false,
  };
}
