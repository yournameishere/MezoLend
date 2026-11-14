// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @title PermitLib
/// @notice EIP-2612 helper. MUSD (and Mezo's BTC and MEZO precompiles) support `permit`, so every MezoLend
///         action that pulls tokens can run in one transaction with an off-chain signature instead of a
///         separate approve.
/// @dev The permit call is wrapped in try/catch: anyone can submit a signed permit first (front-running it),
///      which would make a plain `permit` call revert and grief the user. If the permit fails, the action
///      continues and the following transferFrom succeeds only if the allowance is already in place.
library PermitLib {
    struct Permit {
        uint256 value;
        uint256 deadline; // 0 = no permit (use an existing allowance)
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function tryPermit(address token, address owner, address spender, Permit calldata p) internal {
        if (p.deadline == 0) return;
        try IERC20Permit(token).permit(owner, spender, p.value, p.deadline, p.v, p.r, p.s) {} catch {}
    }
}
