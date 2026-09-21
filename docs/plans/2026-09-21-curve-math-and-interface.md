# Curve Math and Frozen Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `PicklerCurveMath` — the only place curve arithmetic exists in Solidity — plus the preset derivation script and the ABI generation pipeline, so that every later deliverable is written against a frozen, tested interface.

**Architecture:** A pure Solidity library over a constant-product curve with virtual reserves, using directional rounding that always favours the protocol. A derivation function turns the three numbers product chooses (sale allocation, LP allocation, target reserve) into the two the curve needs (`X0`, `Q0`), and proves price continuity at graduation. A Foundry test exports its fuzz vectors to a committed JSON fixture that a TypeScript parity test reads, so the UI preview can never drift from the chain.

**Tech Stack:** Foundry (solc 0.8.30, 256 fuzz runs), forge-std, TypeScript with `node --test`, Turborepo workspaces.

**Scope note:** `docs/specs/launchpad-monad-v1.md` covers several independent subsystems. This plan covers A1 and the parts of D0 that depend on nothing else. A2/A3 (token, factory, curve), A4 (V4 spike), A5/A6 (graduation, escrow) and all of track B each get their own plan. This one produces working, tested software on its own.

**Open decision this plan does not settle:** the SPDX license for Pickler contracts. Files below use `UNLICENSED` as an explicit placeholder. Nothing in this plan is deployed, so the choice can be made before A2 without rework.

---

## File Structure

| File                                              | Responsibility                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `contracts/src/libraries/PicklerCurveMath.sol`    | All curve arithmetic. Pure, no storage, no external calls.         |
| `contracts/test/PicklerCurveMath.t.sol`           | Unit and fuzz tests for each direction and the derivation.         |
| `contracts/test/PicklerCurveMathInvariant.t.sol`  | Invariants over random operation sequences.                        |
| `contracts/test/CurveVectors.t.sol`               | Writes the shared parity fixture.                                  |
| `contracts/script/DerivePreset.s.sol`             | Emits a preset descriptor from chosen inputs; proves continuity.   |
| `packages/core/src/features/launch/curve-math.ts` | TypeScript port used only for UI preview.                          |
| `packages/core/test/curve-math.test.ts`           | Parity against the Solidity fixture.                               |
| `packages/core/test/fixtures/curve-vectors.json`  | Generated fixture, committed.                                      |
| `scripts/generate-abi.mjs`                        | Foundry artifacts → `packages/chain/src/abi/`.                     |

## The math

Constant product over virtual reserves. `X0` and `Q0` are the initial virtual token and quote reserves, `K = X0 * Q0`, and `s` is net tokens sold. Then `X = X0 - s`, `Q = K / X`, and the marginal price is `Q / X`.

- Buy with net quote `dQ`: `tokensOut = X - K / (Q + dQ)`
- Sell `dX` tokens: `quoteGrossOut = Q - K / (X + dX)`
- Buy exact output: `quoteNetIn = K / (X - tokensOut) - Q`

Derivation, given sale allocation `S`, LP allocation `L` and target end reserve `R_end`:

- `X0 = S² / (S - L)`
- `Q0 = R_end * (X0 - S) / S`

These follow from requiring price continuity at graduation, `R_end / L = p_end`. Substituting `p_end = X0·Q0 / (X0-S)²` and `R_end = Q0·S / (X0-S)` gives `L = S(X0-S) / X0`, which rearranges to the two formulas above. Task 5 asserts this rather than trusting it.

Rounding is directional and uniform: the quote reserve `Q` is always floored, and the term subtracted from a reserve is always ceilinged. Every rounding error therefore moves value toward the curve, never toward the trader, which is what makes the no-round-trip-profit invariant in Task 6 hold.

---

### Task 1: Foundry dependencies

**Files:**

- Create: `contracts/.gitignore`
- Modify: `contracts/foundry.toml`
- Modify: `contracts/AGENTS.md`

- [ ] **Step 1: Install forge-std pinned to a commit**

```bash
cd contracts
forge install foundry-rs/forge-std@v1.11.0 --no-git
```

Expected: `lib/forge-std` exists and contains `src/Test.sol`.

- [ ] **Step 2: Keep dependencies and build output untracked**

Create `contracts/.gitignore`:

```gitignore
lib/
out/
cache/
broadcast/
```

- [ ] **Step 3: Record the dependency so a clean checkout can reproduce it**

Add to `contracts/foundry.toml` under `[profile.default]`:

```toml
fs_permissions = [{ access = "read-write", path = "../packages/core/test/fixtures" }]
```

`fs_permissions` is required by Task 7, which writes the parity fixture from a test. The path is relative to `--root contracts`, so it must reach back out to `packages/`; granting `./` would not cover it.

- [ ] **Step 4: Verify the toolchain compiles**

Run: `npm run contracts:build`
Expected: `Nothing to compile` or a successful compile — not an error about a missing `lib/`.

- [ ] **Step 5: Commit**

```bash
git add contracts/.gitignore contracts/foundry.toml
git commit -m "Give the Foundry project something to compile against"
```

---

### Task 2: Buying with an exact quote amount

**Files:**

- Create: `contracts/src/libraries/PicklerCurveMath.sol`
- Create: `contracts/test/PicklerCurveMath.t.sol`

- [ ] **Step 1: Write the failing test**

Create `contracts/test/PicklerCurveMath.t.sol`:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

contract PicklerCurveMathTest is Test {
    // A deliberately small, hand-checkable curve: X0 = 1000, Q0 = 1000, K = 1_000_000.
    function _config() internal pure returns (PicklerCurveMath.CurveConfig memory) {
        return PicklerCurveMath.CurveConfig({
            virtualTokenReserve: 1000,
            virtualQuoteReserve: 1000,
            saleAllocation: 500
        });
    }

    function test_tokensOutForQuoteIn_matchesHandComputedValue() public pure {
        // x = 1000, q = 1000, dQ = 1000 -> newX = ceil(1_000_000 / 2000) = 500, out = 500.
        uint256 tokensOut = PicklerCurveMath.tokensOutForQuoteIn(_config(), 0, 1000);

        assertEq(tokensOut, 500);
    }

    function test_tokensOutForQuoteIn_returnsZeroForDust() public pure {
        // dQ = 1 cannot move a curve this coarse; the trader gets nothing rather than a free token.
        uint256 tokensOut = PicklerCurveMath.tokensOutForQuoteIn(_config(), 0, 1);

        assertEq(tokensOut, 0);
    }

    function test_tokensOutForQuoteIn_accountsForTokensAlreadySold() public pure {
        // netSold = 250 -> x = 750, q = floor(1_000_000 / 750) = 1333.
        // newX = ceil(1_000_000 / 2333) = 429, out = 321.
        uint256 tokensOut = PicklerCurveMath.tokensOutForQuoteIn(_config(), 250, 1000);

        assertEq(tokensOut, 321);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `forge test --root contracts --match-contract PicklerCurveMathTest -vv`
Expected: FAIL — the compiler cannot find `../src/libraries/PicklerCurveMath.sol`.

- [ ] **Step 3: Write the minimal implementation**

Create `contracts/src/libraries/PicklerCurveMath.sol`:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

/// @title Pickler curve arithmetic
/// @notice Constant product over virtual reserves. The only place curve maths exists on chain.
/// @dev Rounding is directional and uniform: the quote reserve is floored and any term
///      subtracted from a reserve is ceilinged, so every rounding error favours the curve.
library PicklerCurveMath {
    struct CurveConfig {
        uint256 virtualTokenReserve;
        uint256 virtualQuoteReserve;
        uint256 saleAllocation;
    }

    error SaleAllocationExceeded(uint256 requested, uint256 remaining);

    /// @notice Tokens delivered for a net quote amount, after fees have already been deducted.
    function tokensOutForQuoteIn(CurveConfig memory config, uint256 netSold, uint256 quoteNetIn)
        internal
        pure
        returns (uint256 tokensOut)
    {
        if (quoteNetIn == 0) {
            return 0;
        }

        uint256 k = _invariant(config);
        uint256 x = config.virtualTokenReserve - netSold;
        uint256 q = k / x;

        uint256 newX = _ceilDiv(k, q + quoteNetIn);

        return newX >= x ? 0 : x - newX;
    }

    function _invariant(CurveConfig memory config) private pure returns (uint256) {
        return config.virtualTokenReserve * config.virtualQuoteReserve;
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : (numerator - 1) / denominator + 1;
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `forge test --root contracts --match-contract PicklerCurveMathTest -vv`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/libraries/PicklerCurveMath.sol contracts/test/PicklerCurveMath.t.sol
git commit -m "Price a purchase against the curve"
```

---

### Task 3: Selling tokens back

**Files:**

- Modify: `contracts/src/libraries/PicklerCurveMath.sol`
- Modify: `contracts/test/PicklerCurveMath.t.sol`

- [ ] **Step 1: Write the failing test**

Append to `contracts/test/PicklerCurveMathTest`:

```solidity
    function test_quoteOutForTokensIn_matchesHandComputedValue() public pure {
        // netSold = 500 -> x = 500, q = 2000. Selling 500 back: newQ = ceil(1_000_000 / 1000) = 1000.
        uint256 quoteOut = PicklerCurveMath.quoteOutForTokensIn(_config(), 500, 500);

        assertEq(quoteOut, 1000);
    }

    function test_quoteOutForTokensIn_returnsZeroForDust() public pure {
        uint256 quoteOut = PicklerCurveMath.quoteOutForTokensIn(_config(), 500, 0);

        assertEq(quoteOut, 0);
    }

    function test_roundTripNeverPaysMoreThanItCost() public pure {
        PicklerCurveMath.CurveConfig memory config = _config();

        uint256 bought = PicklerCurveMath.tokensOutForQuoteIn(config, 0, 1000);
        uint256 returned = PicklerCurveMath.quoteOutForTokensIn(config, bought, bought);

        assertLe(returned, 1000);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `forge test --root contracts --match-contract PicklerCurveMathTest -vv`
Expected: FAIL — `quoteOutForTokensIn` is not a member of the library.

- [ ] **Step 3: Write the minimal implementation**

Add to `PicklerCurveMath`:

```solidity
    /// @notice Gross quote returned for tokens sold back, before the sell fee is deducted.
    function quoteOutForTokensIn(CurveConfig memory config, uint256 netSold, uint256 tokensIn)
        internal
        pure
        returns (uint256 quoteGrossOut)
    {
        if (tokensIn == 0) {
            return 0;
        }

        uint256 k = _invariant(config);
        uint256 x = config.virtualTokenReserve - netSold;
        uint256 q = k / x;

        uint256 newQ = _ceilDiv(k, x + tokensIn);

        return newQ >= q ? 0 : q - newQ;
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `forge test --root contracts --match-contract PicklerCurveMathTest -vv`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/libraries/PicklerCurveMath.sol contracts/test/PicklerCurveMath.t.sol
git commit -m "Price a sale back into the curve"
```

---

### Task 4: Buying an exact number of tokens

This is what consumes the last of the sale allocation without inventing a partial price.

**Files:**

- Modify: `contracts/src/libraries/PicklerCurveMath.sol`
- Modify: `contracts/test/PicklerCurveMath.t.sol`

- [ ] **Step 1: Write the failing test**

Append to `contracts/test/PicklerCurveMathTest`:

```solidity
    function test_quoteInForTokensOut_isTheInverseOfBuying() public pure {
        // Buying exactly 500 from a fresh curve should cost the 1000 that bought 500 in Task 2.
        uint256 quoteIn = PicklerCurveMath.quoteInForTokensOut(_config(), 0, 500);

        assertEq(quoteIn, 1000);
    }

    function test_quoteInForTokensOut_chargesAtLeastOneUnit() public pure {
        // A single token off a coarse curve still costs something. Free tokens are a bug.
        uint256 quoteIn = PicklerCurveMath.quoteInForTokensOut(_config(), 0, 1);

        assertGe(quoteIn, 1);
    }

    function test_quoteInForTokensOut_revertsPastTheSaleAllocation() public {
        vm.expectRevert(
            abi.encodeWithSelector(PicklerCurveMath.SaleAllocationExceeded.selector, uint256(501), uint256(500))
        );

        PicklerCurveMath.quoteInForTokensOut(_config(), 0, 501);
    }

    function test_remainingTokens_reportsWhatIsLeft() public pure {
        assertEq(PicklerCurveMath.remainingTokens(_config(), 200), 300);
    }
```

The revert test calls a library function that reverts, so it cannot be `pure`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `forge test --root contracts --match-contract PicklerCurveMathTest -vv`
Expected: FAIL — `quoteInForTokensOut` and `remainingTokens` are not members of the library.

- [ ] **Step 3: Write the minimal implementation**

Add to `PicklerCurveMath`:

```solidity
    /// @notice Net quote required to receive an exact number of tokens.
    function quoteInForTokensOut(CurveConfig memory config, uint256 netSold, uint256 tokensOut)
        internal
        pure
        returns (uint256 quoteNetIn)
    {
        if (tokensOut == 0) {
            return 0;
        }

        uint256 remaining = remainingTokens(config, netSold);
        if (tokensOut > remaining) {
            revert SaleAllocationExceeded(tokensOut, remaining);
        }

        uint256 k = _invariant(config);
        uint256 x = config.virtualTokenReserve - netSold;
        uint256 q = k / x;

        uint256 newQ = _ceilDiv(k, x - tokensOut);

        return newQ <= q ? 1 : newQ - q;
    }

    /// @notice Tokens still available on the curve.
    function remainingTokens(CurveConfig memory config, uint256 netSold)
        internal
        pure
        returns (uint256)
    {
        return config.saleAllocation - netSold;
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `forge test --root contracts --match-contract PicklerCurveMathTest -vv`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/libraries/PicklerCurveMath.sol contracts/test/PicklerCurveMath.t.sol
git commit -m "Let the last buyer take exactly what is left"
```

---

### Task 5: Deriving the curve from what product chooses

**Files:**

- Modify: `contracts/src/libraries/PicklerCurveMath.sol`
- Create: `contracts/test/PicklerCurveMathDerivation.t.sol`

- [ ] **Step 1: Write the failing test**

Create `contracts/test/PicklerCurveMathDerivation.t.sol`:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

contract PicklerCurveMathDerivationTest is Test {
    function test_deriveReserves_matchesTheClosedForm() public pure {
        // S = 800, L = 200 -> X0 = 800^2 / 600 = 1066 (floored).
        (uint256 x0,) = PicklerCurveMath.deriveReserves(800, 200, 1_000_000);

        assertEq(x0, 1066);
    }

    function test_deriveReserves_rejectsAnLpAllocationItCannotSatisfy() public {
        vm.expectRevert(PicklerCurveMath.InvalidAllocation.selector);

        PicklerCurveMath.deriveReserves(800, 800, 1_000_000);
    }

    /// The property the whole derivation exists for: at graduation the reserve per LP token
    /// equals the marginal price, so the pool opens where the curve closed.
    function testFuzz_priceIsContinuousAtGraduation(
        uint256 saleAllocation,
        uint256 lpAllocation,
        uint256 targetReserve
    ) public pure {
        saleAllocation = bound(saleAllocation, 1e18, 1e27);
        lpAllocation = bound(lpAllocation, saleAllocation / 100, saleAllocation - saleAllocation / 100);
        targetReserve = bound(targetReserve, 1e6, 1e24);

        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(
            saleAllocation, lpAllocation, targetReserve
        );

        PicklerCurveMath.CurveConfig memory config = PicklerCurveMath.CurveConfig({
            virtualTokenReserve: x0,
            virtualQuoteReserve: q0,
            saleAllocation: saleAllocation
        });

        uint256 endReserve = PicklerCurveMath.quoteInForTokensOut(config, 0, saleAllocation);

        // reserve per LP token vs marginal price, compared as a ratio scaled by 1e18
        uint256 reservePerLpToken = (endReserve * 1e18) / lpAllocation;
        uint256 endPrice = PicklerCurveMath.marginalPrice(config, saleAllocation);

        assertApproxEqRel(reservePerLpToken, endPrice, 0.001e18);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `forge test --root contracts --match-contract PicklerCurveMathDerivationTest -vv`
Expected: FAIL — `deriveReserves`, `InvalidAllocation` and `marginalPrice` are not members of the library.

- [ ] **Step 3: Write the minimal implementation**

Add to `PicklerCurveMath`:

```solidity
    error InvalidAllocation();

    /// @notice Derives the virtual reserves from the three numbers product chooses.
    /// @dev X0 = S^2 / (S - L) and Q0 = R_end * (X0 - S) / S. Both follow from requiring
    ///      R_end / L == p_end, so that the pool opens at the price the curve closed at.
    function deriveReserves(uint256 saleAllocation, uint256 lpAllocation, uint256 targetReserve)
        internal
        pure
        returns (uint256 virtualTokenReserve, uint256 virtualQuoteReserve)
    {
        if (lpAllocation == 0 || lpAllocation >= saleAllocation || targetReserve == 0) {
            revert InvalidAllocation();
        }

        virtualTokenReserve = (saleAllocation * saleAllocation) / (saleAllocation - lpAllocation);
        virtualQuoteReserve = (targetReserve * (virtualTokenReserve - saleAllocation)) / saleAllocation;

        if (virtualQuoteReserve == 0) {
            revert InvalidAllocation();
        }
    }

    /// @notice Marginal price in quote units per token, scaled by 1e18.
    function marginalPrice(CurveConfig memory config, uint256 netSold)
        internal
        pure
        returns (uint256)
    {
        uint256 k = _invariant(config);
        uint256 x = config.virtualTokenReserve - netSold;

        return ((k / x) * 1e18) / x;
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `forge test --root contracts --match-contract PicklerCurveMathDerivationTest -vv`
Expected: PASS, 3 tests including 256 fuzz runs of the continuity property.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/libraries/PicklerCurveMath.sol contracts/test/PicklerCurveMathDerivation.t.sol
git commit -m "Derive the curve from the three numbers product picks"
```

---

### Task 6: Invariants over random sequences

A single round trip proving no profit is not enough. These run many operations in a random order and assert the properties hold throughout.

**Files:**

- Create: `contracts/test/PicklerCurveMathInvariant.t.sol`

- [ ] **Step 1: Write the failing test**

Create `contracts/test/PicklerCurveMathInvariant.t.sol`:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

/// Replays a sequence of buys and sells and tracks what the curve owes versus what it took in.
contract CurveHandler {
    using PicklerCurveMath for PicklerCurveMath.CurveConfig;

    PicklerCurveMath.CurveConfig public config;

    uint256 public netSold;
    uint256 public quoteTakenIn;
    uint256 public quotePaidOut;

    constructor() {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(800e18, 200e18, 1_000e6);
        config = PicklerCurveMath.CurveConfig({
            virtualTokenReserve: x0,
            virtualQuoteReserve: q0,
            saleAllocation: 800e18
        });
    }

    function buy(uint256 quoteNetIn) external {
        quoteNetIn = _bound(quoteNetIn, 1, 100e6);

        uint256 tokensOut = PicklerCurveMath.tokensOutForQuoteIn(config, netSold, quoteNetIn);
        if (tokensOut > PicklerCurveMath.remainingTokens(config, netSold)) {
            return;
        }

        netSold += tokensOut;
        quoteTakenIn += quoteNetIn;
    }

    function sell(uint256 tokensIn) external {
        tokensIn = _bound(tokensIn, 0, netSold);
        if (tokensIn == 0) {
            return;
        }

        uint256 quoteOut = PicklerCurveMath.quoteOutForTokensIn(config, netSold, tokensIn);

        netSold -= tokensIn;
        quotePaidOut += quoteOut;
    }

    function _bound(uint256 value, uint256 low, uint256 high) private pure returns (uint256) {
        if (high <= low) {
            return low;
        }
        return low + (value % (high - low + 1));
    }
}

contract PicklerCurveMathInvariantTest is Test {
    CurveHandler internal handler;

    function setUp() public {
        handler = new CurveHandler();
        targetContract(address(handler));
    }

    /// Rounding must never let traders extract more quote than they put in.
    function invariant_curveNeverPaysOutMoreThanItTookIn() public view {
        assertLe(handler.quotePaidOut(), handler.quoteTakenIn());
    }

    /// The curve can never sell more than its allocation, however the sequence is ordered.
    function invariant_netSoldNeverExceedsTheSaleAllocation() public view {
        (,, uint256 saleAllocation) = handler.config();

        assertLe(handler.netSold(), saleAllocation);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `forge test --root contracts --match-contract PicklerCurveMathInvariantTest -vv`
Expected: FAIL to compile until the file is complete; once it compiles, both invariants must pass. If `invariant_curveNeverPaysOutMoreThanItTookIn` fails, the rounding direction in Task 2 or Task 3 is wrong — fix the library, not the invariant.

- [ ] **Step 3: Configure invariant depth**

Add to `contracts/foundry.toml`:

```toml
[invariant]
runs = 64
depth = 128
fail_on_revert = false
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `forge test --root contracts --match-contract PicklerCurveMathInvariantTest -vv`
Expected: PASS, 2 invariants over 64 runs of depth 128.

- [ ] **Step 5: Commit**

```bash
git add contracts/test/PicklerCurveMathInvariant.t.sol contracts/foundry.toml
git commit -m "Hold the curve to its invariants under random sequences"
```

---

### Task 7: The parity fixture

The TypeScript preview and the Solidity library must agree exactly. The fixture is generated from Solidity so the chain is always the source.

**Files:**

- Create: `contracts/test/CurveVectors.t.sol`
- Create: `packages/core/test/fixtures/curve-vectors.json` (generated)
- Create: `packages/core/src/features/launch/curve-math.ts`
- Create: `packages/core/test/curve-math.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the vector exporter**

Create `contracts/test/CurveVectors.t.sol`:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PicklerCurveMath} from "../src/libraries/PicklerCurveMath.sol";

/// Writes the vectors the TypeScript preview is checked against. Run with:
/// forge test --root contracts --match-contract CurveVectorsTest
contract CurveVectorsTest is Test {
    function test_writeVectors() public {
        (uint256 x0, uint256 q0) = PicklerCurveMath.deriveReserves(800e18, 200e18, 1_000e6);

        PicklerCurveMath.CurveConfig memory config = PicklerCurveMath.CurveConfig({
            virtualTokenReserve: x0,
            virtualQuoteReserve: q0,
            saleAllocation: 800e18
        });

        string memory json = "vectors";
        vm.serializeString(json, "virtualTokenReserve", vm.toString(x0));
        vm.serializeString(json, "virtualQuoteReserve", vm.toString(q0));
        vm.serializeString(json, "saleAllocation", vm.toString(uint256(800e18)));

        uint256[6] memory quoteInputs =
            [uint256(1), 1e6, 10e6, 100e6, 500e6, 1_000e6];

        string[] memory buys = new string[](quoteInputs.length);
        for (uint256 i = 0; i < quoteInputs.length; i++) {
            string memory entry = string.concat("buy", vm.toString(i));
            vm.serializeString(entry, "quoteNetIn", vm.toString(quoteInputs[i]));
            buys[i] = vm.serializeString(
                entry,
                "tokensOut",
                vm.toString(PicklerCurveMath.tokensOutForQuoteIn(config, 0, quoteInputs[i]))
            );
        }

        string memory output = vm.serializeString(json, "buys", buys);

        vm.writeJson(output, "../packages/core/test/fixtures/curve-vectors.json");
    }
}
```

- [ ] **Step 2: Generate the fixture**

```bash
mkdir -p packages/core/test/fixtures
forge test --root contracts --match-contract CurveVectorsTest
```

Expected: `packages/core/test/fixtures/curve-vectors.json` exists and contains six buy vectors with non-zero `tokensOut` for every input above 1.

- [ ] **Step 3: Write the failing parity test**

Create `packages/core/test/curve-math.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tokensOutForQuoteIn } from "../src/features/launch/curve-math.js";

interface CurveVectors {
  virtualTokenReserve: string;
  virtualQuoteReserve: string;
  saleAllocation: string;
  buys: Array<{ quoteNetIn: string; tokensOut: string }>;
}

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/curve-vectors.json", import.meta.url), "utf8"),
) as CurveVectors;

describe("curve math parity with Solidity", () => {
  it("reproduces every buy vector exactly", () => {
    const config = {
      virtualTokenReserve: BigInt(vectors.virtualTokenReserve),
      virtualQuoteReserve: BigInt(vectors.virtualQuoteReserve),
      saleAllocation: BigInt(vectors.saleAllocation),
    };

    for (const vector of vectors.buys) {
      const tokensOut = tokensOutForQuoteIn(config, 0n, BigInt(vector.quoteNetIn));

      assert.equal(
        tokensOut,
        BigInt(vector.tokensOut),
        `quoteNetIn ${vector.quoteNetIn} diverged from the on-chain result`,
      );
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run build:shared && node --import tsx --test packages/core/test/curve-math.test.ts`
Expected: FAIL — cannot find `../src/features/launch/curve-math.js`.

- [ ] **Step 5: Write the TypeScript port**

Create `packages/core/src/features/launch/curve-math.ts`:

```typescript
/**
 * UI preview only. The authority for any quote a user acts on is `quoteBuy` / `quoteSell`
 * read from the curve contract at a block. This port exists so the interface can show a
 * number before a round trip, and it is held to the Solidity result by curve-math.test.ts.
 */
export interface CurveConfig {
  virtualTokenReserve: bigint;
  virtualQuoteReserve: bigint;
  saleAllocation: bigint;
}

export function tokensOutForQuoteIn(
  config: CurveConfig,
  netSold: bigint,
  quoteNetIn: bigint,
): bigint {
  if (quoteNetIn === 0n) {
    return 0n;
  }

  const k = config.virtualTokenReserve * config.virtualQuoteReserve;
  const x = config.virtualTokenReserve - netSold;
  const q = k / x;

  const newX = ceilDiv(k, q + quoteNetIn);

  return newX >= x ? 0n : x - newX;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --import tsx --test packages/core/test/curve-math.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 7: Commit**

```bash
git add contracts/test/CurveVectors.t.sol packages/core/src/features/launch packages/core/test/curve-math.test.ts packages/core/test/fixtures/curve-vectors.json
git commit -m "Hold the preview to what the chain would answer"
```

---

### Task 8: ABI generation

`contracts/AGENTS.md` requires ABIs to be generated from compiler artifacts and records that the command does not exist. This adds it.

**Files:**

- Create: `scripts/generate-abi.mjs`
- Modify: `package.json`
- Modify: `packages/chain/src/index.ts`
- Modify: `packages/chain/AGENTS.md`
- Modify: `contracts/AGENTS.md`

- [ ] **Step 1: Write the generator**

Create `scripts/generate-abi.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Foundry artifacts -> packages/chain/src/abi/. Never hand-edit the output.
 * Run `npm run contracts:abi` after any contract change; CI re-runs it and fails on a diff.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(root, "packages/chain/src/abi");

/** Contracts whose ABI is part of the public interface. */
const CONTRACTS = ["PicklerCurveMath"];

mkdirSync(outputDirectory, { recursive: true });

const index = [];

for (const name of CONTRACTS) {
  const artifactPath = join(root, "contracts/out", `${name}.sol`, `${name}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

  const abi = JSON.stringify(artifact.abi, null, 2);
  const abiHash = createHash("sha256").update(abi).digest("hex");

  const contents = `// Generated by scripts/generate-abi.mjs. Do not edit.
export const ${name}Abi = ${abi} as const;

export const ${name}AbiHash = "${abiHash}";
`;

  writeFileSync(join(outputDirectory, `${name}.ts`), contents);
  index.push(`export * from "./${name}";`);
}

writeFileSync(
  join(outputDirectory, "index.ts"),
  `// Generated by scripts/generate-abi.mjs. Do not edit.\n${index.join("\n")}\n`,
);

console.log(`Generated ${CONTRACTS.length} ABI file(s) into packages/chain/src/abi/`);
```

- [ ] **Step 2: Wire the command**

Add to the root `package.json` scripts:

```json
"contracts:abi": "npm run contracts:build && node scripts/generate-abi.mjs"
```

- [ ] **Step 3: Run it**

Run: `npm run contracts:abi`
Expected: `Generated 1 ABI file(s) into packages/chain/src/abi/`, and `packages/chain/src/abi/PicklerCurveMath.ts` exists.

- [ ] **Step 4: Export the ABIs from the package**

Add to `packages/chain/src/index.ts`:

```typescript
export * from "./abi";
```

- [ ] **Step 5: Verify the package still typechecks and stays dependency-free**

Run: `npm run typecheck --workspace=@pickler/chain`
Expected: no errors. Confirm `packages/chain/package.json` still has an empty `dependencies` object.

- [ ] **Step 6: Record the workflow in both instruction files**

In `contracts/AGENTS.md`, replace the sentence stating the generation command does not exist with a description of `npm run contracts:abi` and the `CONTRACTS` list in `scripts/generate-abi.mjs`. In `packages/chain/AGENTS.md`, replace the sentence stating no ABIs or generation scripts exist with the same, noting that `src/abi/` is generated output and is never hand-edited.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-abi.mjs package.json packages/chain contracts/AGENTS.md
git commit -m "Generate public ABIs from the compiler instead of by hand"
```

---

### Task 9: Wire the new suites into the repository checks

`AGENTS.md` requires test discovery to be extended for new suites. An unrun test is not coverage.

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/` (the existing workflow file)

- [ ] **Step 1: Add the core test glob**

The root `test` script already discovers `packages/core/test/*.test.ts`, so `curve-math.test.ts` is picked up. Verify rather than assume:

Run: `npm test 2>&1 | grep -c "curve math parity"`
Expected: at least 1.

- [ ] **Step 2: Add contract tests to CI**

Add a step to the existing GitHub Actions workflow, after the Node setup:

```yaml
- name: Install Foundry
  uses: foundry-rs/foundry-toolchain@v1

- name: Build contracts
  run: npm run contracts:build

- name: Test contracts
  run: npm run contracts:test

- name: Verify generated ABIs are current
  run: |
    npm run contracts:abi
    git diff --exit-code packages/chain/src/abi
```

- [ ] **Step 3: Run the full check locally**

Run: `npm run contracts:test && npm test && npm run lint && npm run format:check`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows
git commit -m "Run the contract suite where it can fail the build"
```

---

## What this plan deliberately leaves out

`PicklerBondingCurve` and the fee arithmetic that sits on top of this library; the ERC-20 and factory; the V4 spike; the graduation adapter and locker; the fee escrow; every part of track B. Each needs its own plan, and each depends on this one only through `PicklerCurveMath` and the generated ABIs.

The preset descriptor and environment manifest from D0 are also deferred: the descriptor's numbers come from `deriveReserves`, so it is cheaper to write once A2 fixes the surrounding parameters than to write twice.
