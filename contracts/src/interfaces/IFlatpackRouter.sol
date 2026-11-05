// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IFlatpackRouter
/// @notice One-transaction USDG -> basket shares. Stateless (INV-3). Swaps directly against Uniswap v3 pools resolved
///         from v3Factory.getPool(USDG, token, registry.component(token).v3Fee) (ADR-0005).
/// @dev buy():  1) check the deadline; 2) basket.sync(); 3) amounts = basket.previewMint(shares);
///              4) pull maxUsdgIn USDG from msg.sender; 5) for each component, exact-output swap USDG->token for
///              amounts[i] (revert if the amount received != amounts[i]); 6) forceApprove the basket for exactly amounts[i];
///              7) basket.mint(shares, receiver, referrer); 8) reset approvals to 0; 9) refund unused USDG to msg.sender;
///              10) require usdgSpent <= maxUsdgIn.
///      Every component must be registry.isEnabled (disabled -> revert ComponentDisabled).
///      The callback is authenticated against the pool stored in transient storage just before pool.swap.
interface IFlatpackRouter {
    struct BuyParams {
        address basket;
        uint256 shares; // gross shares (the receiver gets shares - fee)
        uint256 maxUsdgIn; // 6 decimals
        address receiver;
        address referrer; // optional
        uint256 deadline;
    }

    event Bought(
        address indexed basket,
        address indexed buyer,
        address indexed receiver,
        address referrer,
        uint256 shares,
        uint256 sharesOut,
        uint256 usdgSpent
    );

    error Expired();
    error NotBasket();
    error ComponentDisabled(address token);
    error PoolNotFound(address token);
    error UnexpectedCallback();
    error ExcessiveInput(uint256 spent, uint256 maximum);
    error IncompleteFill(address token, uint256 received, uint256 expected);

    function buy(BuyParams calldata p) external returns (uint256 sharesOut, uint256 usdgSpent);

    /// @notice Quote helper for the app. It performs the swaps in a simulation and ALWAYS reverts with
    ///         QuoteResult(usdgIn). Call it with eth_call and decode the revert data.
    error QuoteResult(uint256 usdgIn);
    function quoteBuy(address basket, uint256 shares) external;

    function factory() external view returns (address);
    function registry() external view returns (address);
    function usdg() external view returns (address);
}
