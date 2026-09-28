// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Pickler agent token
/// @notice A fixed-supply ERC-20 tied to an agent's identity.
/// @dev Deliberately the least interesting contract in the system. The entire supply is
///      created once, in the constructor, and handed to the curve. There is no mint, no burn,
///      no owner, no pause, no blacklist and no transfer tax — not as an omission but as the
///      product guarantee: a buyer's position cannot be diluted, frozen or taxed after the
///      fact, and no key exists that could do it. Anything that needs to change should be a
///      new launch, not a new function here.
contract PicklerAgentToken is ERC20 {
    error InvalidSupply();
    error InvalidRecipient();

    constructor(string memory name_, string memory symbol_, uint256 totalSupply_, address supplyRecipient)
        ERC20(name_, symbol_)
    {
        if (totalSupply_ == 0) {
            revert InvalidSupply();
        }
        if (supplyRecipient == address(0)) {
            revert InvalidRecipient();
        }

        _mint(supplyRecipient, totalSupply_);
    }
}
