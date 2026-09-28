import type { ContractDeployment } from "./index";

/**
 * Verified external deployments Pickler depends on.
 *
 * Every entry was read from the chain, not copied from documentation: `codeHash` is the
 * keccak256 of the deployed bytecode at `verifiedAtBlock`. Verify against these before using
 * an address — an address list carried between environments is how a launch ends up pointing
 * at nothing, and Uniswap's own deployment list covers Monad mainnet only.
 *
 * Pickler's own contracts are not here. None are deployed.
 */
export interface VerifiedDeployment extends ContractDeployment {
  /** keccak256 of the deployed bytecode at `verifiedAtBlock`. */
  codeHash: `0x${string}`;
  /** Size in bytes of the deployed bytecode, as a cheap first check. */
  codeSize: number;
}

export interface VenueDeployment {
  chainId: number;
  /** Who deployed and maintains this, which is not always Uniswap. */
  maintainer: "uniswap" | "monad";
  official: boolean;
  verifiedAtBlock: bigint;
  verifiedOn: string;
  contracts: Record<string, VerifiedDeployment>;
  /** Source commits the deployment was built from, where the maintainer published them. */
  sourcePins?: Record<string, string>;
  notes: string;
}

function contract(
  chainId: number,
  address: `0x${string}`,
  deploymentBlock: bigint,
  codeHash: `0x${string}`,
  codeSize: number,
): VerifiedDeployment {
  return { chainId, address, deploymentBlock, codeHash, codeSize };
}

/**
 * Uniswap V4 on Monad testnet, deployed and maintained by Monad — NOT an official Uniswap
 * deployment. Its PoolManager is 34582 bytes where the official Monad mainnet build is 24009,
 * so the two are different builds and a result on one does not carry to the other.
 *
 * This is the only V4 available on 10143: the official Uniswap addresses have zero code there.
 */
export const UNISWAP_V4_MONAD_TESTNET = {
  chainId: 10143,
  maintainer: "monad",
  official: false,
  verifiedAtBlock: 62279958n,
  verifiedOn: "2026-09-21",
  contracts: {
    poolManager: contract(
      10143,
      "0x451D64ab3b650040d2aE1886602b97ed6eDc643d",
      62279958n,
      "0x61199025286997b715457c68f86dbc42c847753f01e0773668394a405d53d579",
      34582,
    ),
    positionManager: contract(
      10143,
      "0x3Bb14E3D0Cd50aBe3EdACa06d06c29C78676C31A",
      62279958n,
      "0x3452caf821d383d2b18ae48cc0d1467b179b07a1198b8d72153181fcbc556ed5",
      23877,
    ),
    stateView: contract(
      10143,
      "0xB639209539c61BaF67AC04876315786F8D0b153c",
      62279958n,
      "0xeedadde80f69c3b89437996025759b839a65e12db6c8379a7327a34aa269fa5e",
      3531,
    ),
    quoter: contract(
      10143,
      "0x869834d127b230283fe63E0d0A9bEB67216a94C7",
      62279958n,
      "0xdc1a524cd6108e0d1d90c5de1b594b2f953feaf9dc6c2387ecd1b4232ea0e521",
      6118,
    ),
    universalRouter: contract(
      10143,
      "0x1b7bFCd2870329B987191910D85c22C7287f3c22",
      62279958n,
      "0x82fe297858b607b6f6b5599928724441acd046e3dbd19971ec3d6be6587997c6",
      19499,
    ),
    // Same address as mainnet, different bytecode: this one was deployed by Monad rather
    // than being the canonical Permit2. Equal addresses across networks prove nothing.
    permit2: contract(
      10143,
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      62279958n,
      "0xe8ca368abb6fa7f5d31b388b14e16d3654281140695486df9a22d7d9b75df310",
      9152,
    ),
  },
  sourcePins: {
    v4Core: "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
    v4Periphery: "3231810e39b8c4d569b9d66907fa4ef8cd2cec22",
    universalRouter: "999d561c3ad58fb5cab91b602911f3c75591a9c7",
    // The PoolManager predates the rest and was built from a different core commit.
    existingPoolManagerCore: "a7cf038cd568801a79a9b4cf92cd5b52c95c8585",
  },
  notes:
    "Monad-maintained, not official Uniswap. Source: monad-developers/uniswap-v4-hooks-example. " +
    "Exercised by contracts/test/fork/UniswapV4Graduation.t.sol at the block above.",
} as const satisfies VenueDeployment;

/**
 * Official Uniswap V4 on Monad mainnet. Addresses are from Uniswap's deployment page and were
 * confirmed to hold code; the code hashes are recorded at the block noted. Nothing has been
 * executed against these — the spike ran on testnet.
 */
export const UNISWAP_V4_MONAD_MAINNET = {
  chainId: 143,
  maintainer: "uniswap",
  official: true,
  verifiedAtBlock: 106855516n,
  verifiedOn: "2026-09-21",
  contracts: {
    poolManager: contract(
      143,
      "0x188d586DdCF52439676ca21a244753fa19F9eA8e",
      106855516n,
      "0xf5d7a45765367807b101f825ec74004078c79bd96c621e481c608ee22f7336d4",
      24009,
    ),
    positionManager: contract(
      143,
      "0x5b7Ec4a94ff9BEdb700fb82ab09d5846972f4016",
      106855516n,
      "0x1a75f5a91d9fa7e4ffefa5211d4dc39c1a7cc520d3be59b631e9b9a6ec49ffc0",
      23877,
    ),
    universalRouter: contract(
      143,
      "0x0d97dC33264BFC1c226207428a79b26757fB9dc3",
      106855516n,
      "0x5c84d90c7d4dbe374f13a7b506c22cadf4f9ee4f6d6106711001aee7c5153c5a",
      19499,
    ),
    quoter: contract(
      143,
      "0xa222dD357A9076d1091Ed6AA2E16c9742dD26891",
      106855516n,
      "0x3666b10d21aee597139d129b378b2cdaeaaaaaffeb142c1f64366a7bd5be8b3b",
      6118,
    ),
    stateView: contract(
      143,
      "0x77395f3B2E73ae90843717371294fa97cc419D64",
      106855516n,
      "0x9f14dd3281369ca12d9a58c95a78f3387437dd24fa958631514361d9a52621ed",
      3531,
    ),
    permit2: contract(
      143,
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      106855516n,
      "0x332f9ca0fbd282f4a9b16f5332870dc98addc5172dd5e48ab6fa7c9be3d10fa0",
      9152,
    ),
  },
  notes:
    "Official Uniswap deployment, verified on chain at the block above. Nothing has been " +
    "executed against it: the spike ran on testnet, whose PoolManager is a different build.",
} as const satisfies VenueDeployment;
