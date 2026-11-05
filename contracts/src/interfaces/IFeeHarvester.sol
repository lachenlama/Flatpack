// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IFeeHarvester
/// @notice Converts basket fee shares and dividend skims into $WIF and splits it (ARCHITECTURE.md sections 5.3 and 5.4).
/// @dev Swap path for any component: token -(v3, registry fee tier)-> USDG -(v3 USDG/WETH, fee 100)-> WETH -unwrap->
///      ETH -(v4 ETH/WIF pool key, immutable from the constructor)-> WIF.
///      The keeper controls only timing and minWifOut. Recipients and splits are constants (ADR-0004).
///      REFERRAL CYCLES: each basket has a current cycle. onFeeShares adds to cycleFeeShares[basket][cycle] and, if
///      referrer != 0, adds refShares = shares * REFERRAL_SHARE_BPS / 10000 to
///      referralShares[basket][cycle][referrer] and cycleReferralShares[basket][cycle].
///      harvestFees closes the current cycle, fixing wifPerFeeShare for it, and increments the cycle.
interface IFeeHarvester {
    event FactorySet(address factory);
    event KeeperSet(address keeper);
    event FeeSharesReceived(
        address indexed basket,
        address indexed referrer,
        uint256 shares,
        uint256 referralShares,
        uint256 cycle
    );
    event DividendSkimReceived(address indexed basket, address indexed token, uint256 amount);
    event FeesHarvested(
        address indexed basket,
        uint256 indexed cycle,
        uint256 feeShares,
        uint256 wifOut,
        uint256 burned,
        uint256 toReferrers,
        uint256 toVaultBackers,
        uint256 toVaultCurator
    );
    event DividendsHarvested(address indexed basket, uint256 wifOut);
    event ReferralClaimed(address indexed basket, address indexed referrer, uint256 indexed cycle, uint256 amount);

    error OnlyKeeper();
    error OnlyBasket();
    error FactoryAlreadySet();
    error NothingToHarvest();
    error InsufficientWifOut(uint256 out, uint256 minimum);
    error Expired();
    error CycleNotClosed(uint256 cycle);
    error AlreadyClaimed(uint256 cycle);

    // splits, in bps of the $WIF from a fee harvest (after referrers): burn 50%, backers 30%, curator 20%
    function BURN_BPS() external pure returns (uint256); // 5000
    function BACKER_BPS() external pure returns (uint256); // 3000
    function CURATOR_BPS() external pure returns (uint256); // 2000
    function REFERRAL_SHARE_BPS() external pure returns (uint256); // 1000 (of fee shares)
    function DEAD() external pure returns (address); // 0x000000000000000000000000000000000000dEaD

    /// @notice One-time wiring by the owner (the deploy script). It sets the factory and the vault it reads.
    function setFactory(address factory) external;
    function setKeeper(address keeper) external;

    /// @notice Basket only (factory.isBasket(msg.sender)). The shares are already minted or transferred to this contract.
    function onFeeShares(address referrer, uint256 shares) external;
    /// @notice Basket only. The tokens are already transferred to this contract.
    function onDividendSkim(address token, uint256 amount) external;

    /// @notice Keeper only. Redeems ALL pending fee shares of `basket`, sells everything for $WIF, and splits it per section 5.4.
    /// @dev Also claims any $WIF dividends those shares accrued (PayInWif baskets) and adds them to W.
    ///      The burn = W * BURN_BPS / 10000. toReferrers = W * cycleReferralShares / cycleFeeShares.
    ///      The rest R = W - burn - toReferrers goes to the vault: backers = R * 3000 / 5000 and curator = R - backers.
    ///      INV-8: burn + toReferrers + backers + curator == W.
    function harvestFees(address basket, uint256 minWifOut, uint256 deadline) external returns (uint256 wifOut);

    /// @notice Keeper only. Sells all pending dividend skims of `basket` for $WIF, transfers them to the basket, and calls
    ///         basket.notifyWifDividend.
    function harvestDividends(address basket, uint256 minWifOut, uint256 deadline) external returns (uint256 wifOut);

    /// @notice Pays msg.sender's referral $WIF for the given CLOSED cycles of `basket`.
    function claimReferral(address basket, uint256[] calldata cycles, address to) external returns (uint256 amount);

    function currentCycle(address basket) external view returns (uint256);
    function pendingFeeShares(address basket) external view returns (uint256);
    function pendingDividend(address basket, address token) external view returns (uint256);
    function referralOf(
        address basket,
        uint256 cycle,
        address referrer
    ) external view returns (uint256 shares, uint256 claimableWif, bool claimed);
}
