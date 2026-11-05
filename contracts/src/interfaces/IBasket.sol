// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice What happens to cash dividends (ERC-8056 multiplier increases of at most MAX_DIVIDEND_STEP).
enum DividendMode {
    Reinvest, // default stock behaviour: value stays in the basket
    PayInWif // the dividend portion is skimmed, sold for $WIF by the harvester, and streamed to holders
}

/// @notice Initialisation payload. The factory builds it, and the clone receives it exactly once.
struct BasketInit {
    string name;
    string symbol;
    address curator;
    address[] tokens; // 2..8 entries, strictly ascending by address (the factory validates)
    uint256[] rawUnits; // raw token amount per 1e18 shares, each > 0
    DividendMode mode;
    address harvester; // IFeeHarvester
    address wif; // $WIF token (reward token for PayInWif)
}

/// @title IBasket
/// @notice Immutable, fixed-unit, in-kind basket of Stock Tokens (ADR-0001). It has no owner.
/// @dev MINT: deposit ceil(rawUnits_i * shares / 1e18) of each component. The receiver gets shares - fee, and the
///      harvester gets fee = shares * FEE_BPS / 10000 (ADR-0002).
///      REDEEM: fee shares go to the harvester. The net shares are burned and each component pays
///      floor(effBal_i * net / totalSupplyBefore). Each leg is attempted independently, and a failed leg becomes an IOU (ADR-0003).
///      The harvester is EXEMPT from fees on both mint and redeem.
///      Every mint/redeem calls sync() first.
///      effBal_i := IERC20(token_i).balanceOf(this) - totalOwed[token_i]
///      INVARIANT INV-1: effBal_i * 1e18 >= rawUnits_i * totalSupply() for every i, at all times.
interface IBasket is IERC20 {
    // ---------------------------------------------------------------- events
    event Initialized(address indexed curator, address[] tokens, uint256[] rawUnits, DividendMode mode);
    event Minted(
        address indexed caller,
        address indexed receiver,
        address indexed referrer,
        uint256 shares,
        uint256 feeShares,
        uint256[] amountsIn
    );
    event Redeemed(
        address indexed owner,
        address indexed receiver,
        uint256 shares,
        uint256 feeShares,
        uint256[] amountsOut
    );
    event IOURecorded(address indexed account, address indexed token, uint256 amount);
    event IOUClaimed(address indexed account, address indexed token, address to, uint256 amount);
    /// @param dividend true if this sync was treated as a cash dividend (PayInWif and 1 < new/old <= 1.03)
    event MultiplierSynced(
        address indexed token,
        uint256 oldMultiplier,
        uint256 newMultiplier,
        bool dividend,
        uint256 newRawUnits,
        uint256 skimmed
    );
    event WifDividendNotified(uint256 amount, uint256 accWifPerShare);
    event WifDividendClaimed(address indexed account, address indexed to, uint256 amount);

    // ---------------------------------------------------------------- errors
    error AlreadyInitialized();
    error OnlyHarvester();
    error ZeroShares();
    error BelowMinimumMint(uint256 shares, uint256 minimum);
    error ZeroAddress();
    error NothingOwed();
    error NotPayInWif();
    error NoSupply();

    // ---------------------------------------------------------------- constants
    /// @return 30 (0.30%) on mint and redeem.
    function FEE_BPS() external pure returns (uint256);
    /// @return 1000: the share of each fee attributed to the referrer (10% of the fee), if one is given.
    function REFERRAL_SHARE_BPS() external pure returns (uint256);
    /// @return 1.03e18: the largest multiplier step treated as a cash dividend (ADR-0006).
    function MAX_DIVIDEND_STEP() external pure returns (uint256);
    /// @return 1e12: the minimum shares per mint (dust guard).
    function MIN_MINT_SHARES() external pure returns (uint256);

    // ---------------------------------------------------------------- lifecycle
    /// @notice Called once by the factory immediately after cloning. It sets lastMultiplier_i = uiMultiplier() for each token.
    function initialize(BasketInit calldata init) external;

    // ---------------------------------------------------------------- core
    /// @notice Pulls components from msg.sender and mints shares.
    /// @param shares gross shares. The receiver gets shares - fee (or all of them if msg.sender is the harvester).
    /// @param referrer optional (address(0) = none). Forwarded to harvester.onFeeShares.
    /// @return sharesOut shares credited to the receiver
    /// @return amountsIn components pulled (ceil-rounded)
    function mint(
        uint256 shares,
        address receiver,
        address referrer
    ) external returns (uint256 sharesOut, uint256[] memory amountsIn);

    /// @notice Burns msg.sender's shares and sends the components to `receiver`. It never reverts because of one failed leg.
    /// @return amountsOut the amounts per component attributed to the receiver (paid now or recorded as an IOU)
    function redeem(uint256 shares, address receiver) external returns (uint256[] memory amountsOut);

    /// @notice Permissionless. Applies multiplier changes (section 5.3 of ARCHITECTURE.md). Idempotent.
    function sync() external;

    /// @notice Pays an IOU once the token transfers again. Reverts NothingOwed if the amount is 0.
    function claimIOU(address token, address to) external returns (uint256 amount);

    /// @notice Harvester only. The $WIF is already transferred in. accWifPerShare += amount * 1e18 / totalSupply().
    /// @dev Reverts NotPayInWif in Reinvest mode, and NoSupply if totalSupply() == 0.
    function notifyWifDividend(uint256 amount) external;

    function claimWifDividend(address to) external returns (uint256 amount);

    // ---------------------------------------------------------------- views
    function factory() external view returns (address);
    function curator() external view returns (address);
    function harvester() external view returns (address);
    function mode() external view returns (DividendMode);
    function components() external view returns (address[] memory tokens, uint256[] memory rawUnits);
    function lastMultipliers() external view returns (uint256[] memory);
    function effectiveBalances() external view returns (uint256[] memory);
    function owed(address account, address token) external view returns (uint256);
    function totalOwed(address token) external view returns (uint256);
    function pendingWifDividend(address account) external view returns (uint256);
    /// @notice Component amounts needed to mint `shares` at the CURRENT rawUnits (it does not simulate a pending sync).
    function previewMint(uint256 shares) external view returns (uint256[] memory amountsIn);
    /// @notice Component amounts `owner` would receive for redeeming `shares` (after the fee, unless owner is the harvester).
    function previewRedeem(uint256 shares, address owner) external view returns (uint256[] memory amountsOut);
}
