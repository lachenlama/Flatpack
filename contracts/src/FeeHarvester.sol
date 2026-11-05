// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IBasket} from "./interfaces/IBasket.sol";
import {IBasketFactory} from "./interfaces/IBasketFactory.sol";
import {IBackingVault} from "./interfaces/IBackingVault.sol";
import {IComponentRegistry} from "./interfaces/IComponentRegistry.sol";
import {IFeeHarvester} from "./interfaces/IFeeHarvester.sol";
import {IUniswapV3Factory, IWETH9} from "./interfaces/external/IExternal.sol";
import {UniswapV3Swapper} from "./libraries/UniswapV3Swapper.sol";
import {UniswapV4WifSwapper} from "./libraries/UniswapV4WifSwapper.sol";

/// @title FeeHarvester
/// @notice Receives basket fee shares and dividend skims, sells them for $WIF and splits the proceeds
///         (ARCHITECTURE.md sections 5.3 and 5.4, ADR-0002, ADR-0004).
/// @dev Swap path: component -(v3, registry fee tier)-> USDG -(v3 USDG/WETH)-> WETH -unwrap-> ETH -(v4 ETH/WIF)-> WIF.
///      The keeper chooses only timing and `minWifOut`; recipients and splits are constants.
///      IOUs: if a component leg of the fee-share redemption fails (e.g. the Stock Token is paused) the basket records
///      an IOU owed to this contract. That leg is skipped by the harvest. Anyone can later call {claimIOU}; the tokens
///      then wait in `iouPending` and are sold by the NEXT `harvestFees` of that basket (their $WIF joins that
///      harvest's split).
///      `onFeeShares` and `onDividendSkim` are called by a basket from inside its own nonReentrant functions, and also
///      during `harvestFees` itself, so they only do accounting and never carry this contract's reentrancy lock.
contract FeeHarvester is IFeeHarvester, Ownable2Step, ReentrancyGuardTransient, UniswapV3Swapper, UniswapV4WifSwapper {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- errors / events (not in the interface)
    error ZeroAddress();
    error PoolNotFound(address token);
    error UnexpectedCallback();
    error InsufficientInput(uint256 owed, uint256 balance);
    error UnauthorizedEthSender(address sender);
    error FactoryNotSet();
    error UnknownBasket(address basket);

    /// @notice A basket IOU owed to this contract was claimed and queued for the next harvest of that basket.
    event IOUClaimed(address indexed basket, address indexed token, uint256 amount);

    // ---------------------------------------------------------------- constants
    /// @inheritdoc IFeeHarvester
    uint256 public constant override BURN_BPS = 5000;
    /// @inheritdoc IFeeHarvester
    uint256 public constant override BACKER_BPS = 3000;
    /// @inheritdoc IFeeHarvester
    uint256 public constant override CURATOR_BPS = 2000;
    /// @inheritdoc IFeeHarvester
    uint256 public constant override REFERRAL_SHARE_BPS = 1000;
    /// @inheritdoc IFeeHarvester
    address public constant override DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant BPS = 10_000;

    // ---------------------------------------------------------------- immutables
    IComponentRegistry public immutable registry;
    address public immutable usdg;
    address public immutable weth;
    address public immutable wif;
    address public immutable usdgWethPool;
    address private immutable _v3Factory;

    // ---------------------------------------------------------------- storage
    address public factory;
    address public vault;
    address public keeper;

    mapping(address basket => uint256) private _currentCycle;
    mapping(address basket => uint256) private _pendingFeeShares;
    mapping(address basket => mapping(uint256 cycle => uint256)) private _cycleFeeShares;
    mapping(address basket => mapping(uint256 cycle => uint256)) private _cycleReferralShares;
    /// @dev $WIF set aside for the referrers of a closed cycle.
    mapping(address basket => mapping(uint256 cycle => uint256)) private _cycleReferralWif;
    mapping(address basket => mapping(uint256 cycle => mapping(address referrer => uint256))) private _referralShares;
    mapping(address basket => mapping(uint256 cycle => mapping(address referrer => bool))) private _claimed;

    mapping(address basket => mapping(address token => uint256)) private _pendingDividend;
    mapping(address basket => address[]) private _dividendTokens;
    /// @dev Claimed IOU tokens waiting for the next fee harvest of the basket.
    mapping(address basket => mapping(address token => uint256)) public iouPending;

    // ---------------------------------------------------------------- modifiers
    modifier onlyKeeper() {
        if (msg.sender != keeper) revert OnlyKeeper();
        _;
    }

    modifier onlyBasket() {
        address f = factory;
        if (f == address(0) || !IBasketFactory(f).isBasket(msg.sender)) revert OnlyBasket();
        _;
    }

    // ---------------------------------------------------------------- constructor
    /// @param owner_ Ownable2Step owner (also the initial keeper)
    /// @param registry_ the IComponentRegistry (source of per-token v3 fee tiers and the v3 factory)
    /// @param usdg_ USDG (6 decimals)
    /// @param weth_ WETH9
    /// @param wif_ the $WIF token
    /// @param usdgWethPool_ the USDG/WETH v3 pool (fee 100)
    /// @param poolManager_ the Uniswap v4 PoolManager
    /// @param wifPoolKey_ the ETH/WIF v4 pool key (currency0 must be native ETH)
    constructor(
        address owner_,
        address registry_,
        address usdg_,
        address weth_,
        address wif_,
        address usdgWethPool_,
        address poolManager_,
        PoolKey memory wifPoolKey_
    ) Ownable(owner_) UniswapV4WifSwapper(poolManager_, wifPoolKey_) {
        if (
            registry_ == address(0) ||
            usdg_ == address(0) ||
            weth_ == address(0) ||
            wif_ == address(0) ||
            usdgWethPool_ == address(0) ||
            poolManager_ == address(0)
        ) revert ZeroAddress();
        registry = IComponentRegistry(registry_);
        usdg = usdg_;
        weth = weth_;
        wif = wif_;
        usdgWethPool = usdgWethPool_;
        _v3Factory = IComponentRegistry(registry_).v3Factory();
        keeper = owner_;
        emit KeeperSet(owner_);
    }

    /// @dev Only WETH (unwrap) and the PoolManager may send ETH.
    receive() external payable {
        if (msg.sender != weth && msg.sender != address(POOL_MANAGER)) revert UnauthorizedEthSender(msg.sender);
    }

    // ---------------------------------------------------------------- admin
    /// @inheritdoc IFeeHarvester
    function setFactory(address factory_) external override onlyOwner {
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        vault = IBasketFactory(factory_).vault();
        emit FactorySet(factory_);
    }

    /// @inheritdoc IFeeHarvester
    function setKeeper(address keeper_) external override onlyOwner {
        if (keeper_ == address(0)) revert ZeroAddress();
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    // ---------------------------------------------------------------- basket callbacks (accounting only)
    /// @inheritdoc IFeeHarvester
    function onFeeShares(address referrer, uint256 shares) external override onlyBasket {
        uint256 cycle = _currentCycle[msg.sender];
        _pendingFeeShares[msg.sender] += shares;
        _cycleFeeShares[msg.sender][cycle] += shares;
        uint256 refShares;
        if (referrer != address(0)) {
            refShares = (shares * REFERRAL_SHARE_BPS) / BPS;
            _referralShares[msg.sender][cycle][referrer] += refShares;
            _cycleReferralShares[msg.sender][cycle] += refShares;
        }
        emit FeeSharesReceived(msg.sender, referrer, shares, refShares, cycle);
    }

    /// @inheritdoc IFeeHarvester
    function onDividendSkim(address token, uint256 amount) external override onlyBasket {
        if (_pendingDividend[msg.sender][token] == 0 && amount > 0) _dividendTokens[msg.sender].push(token);
        _pendingDividend[msg.sender][token] += amount;
        emit DividendSkimReceived(msg.sender, token, amount);
    }

    // ---------------------------------------------------------------- harvest
    /// @inheritdoc IFeeHarvester
    function harvestFees(
        address basket,
        uint256 minWifOut,
        uint256 deadline
    ) external override nonReentrant onlyKeeper returns (uint256 wifOut) {
        if (block.timestamp > deadline) revert Expired();
        _requireBasket(basket);
        IBasket b = IBasket(basket);
        b.sync(); // applies multiplier changes first, so skims are booked before we measure balances

        uint256 shares = _pendingFeeShares[basket];
        if (shares == 0) revert NothingToHarvest();
        uint256 cycle = _currentCycle[basket];
        // effects: close the cycle
        _pendingFeeShares[basket] = 0;
        _currentCycle[basket] = cycle + 1;

        uint256 wifBefore = IERC20(wif).balanceOf(address(this));
        uint256 usdgIn = _redeemAndSell(b, basket, shares);
        b.claimWifDividend(address(this)); // $WIF dividends accrued by the held fee shares (0 if none)
        _usdgToWif(usdgIn);
        wifOut = IERC20(wif).balanceOf(address(this)) - wifBefore;

        if (wifOut == 0) revert NothingToHarvest();
        if (wifOut < minWifOut) revert InsufficientWifOut(wifOut, minWifOut);
        _split(basket, cycle, shares, wifOut);
    }

    /// @inheritdoc IFeeHarvester
    function harvestDividends(
        address basket,
        uint256 minWifOut,
        uint256 deadline
    ) external override nonReentrant onlyKeeper returns (uint256 wifOut) {
        if (block.timestamp > deadline) revert Expired();
        _requireBasket(basket);
        IBasket(basket).sync();

        address[] memory toks = _dividendTokens[basket];
        if (toks.length == 0) revert NothingToHarvest();
        delete _dividendTokens[basket];

        uint256 usdgIn;
        for (uint256 i; i < toks.length; ++i) {
            uint256 amount = _pendingDividend[basket][toks[i]];
            _pendingDividend[basket][toks[i]] = 0;
            usdgIn += _sellToUsdg(toks[i], amount);
        }

        uint256 wifBefore = IERC20(wif).balanceOf(address(this));
        _usdgToWif(usdgIn);
        wifOut = IERC20(wif).balanceOf(address(this)) - wifBefore;

        if (wifOut == 0) revert NothingToHarvest();
        if (wifOut < minWifOut) revert InsufficientWifOut(wifOut, minWifOut);
        IERC20(wif).safeTransfer(basket, wifOut);
        IBasket(basket).notifyWifDividend(wifOut);
        emit DividendsHarvested(basket, wifOut);
    }

    /// @notice Claims an IOU the basket owes this contract (a fee-share redemption leg that failed). Permissionless: the
    ///         tokens can only land here and are sold by the next `harvestFees` of `basket`.
    /// @return amount the amount claimed (reverts with the basket's NothingOwed if zero)
    function claimIOU(address basket, address token) external nonReentrant returns (uint256 amount) {
        _requireBasket(basket);
        uint256 before = IERC20(token).balanceOf(address(this));
        IBasket(basket).claimIOU(token, address(this));
        amount = IERC20(token).balanceOf(address(this)) - before;
        iouPending[basket][token] += amount;
        emit IOUClaimed(basket, token, amount);
    }

    // ---------------------------------------------------------------- referrals
    /// @inheritdoc IFeeHarvester
    function claimReferral(
        address basket,
        uint256[] calldata cycles,
        address to
    ) external override nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        uint256 current = _currentCycle[basket];
        for (uint256 i; i < cycles.length; ++i) {
            uint256 c = cycles[i];
            if (c >= current) revert CycleNotClosed(c);
            if (_claimed[basket][c][msg.sender]) revert AlreadyClaimed(c);
            _claimed[basket][c][msg.sender] = true;
            uint256 part = _claimable(basket, c, msg.sender);
            amount += part;
            emit ReferralClaimed(basket, msg.sender, c, part);
        }
        if (amount > 0) IERC20(wif).safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- views
    /// @inheritdoc IFeeHarvester
    function currentCycle(address basket) external view override returns (uint256) {
        return _currentCycle[basket];
    }

    /// @inheritdoc IFeeHarvester
    function pendingFeeShares(address basket) external view override returns (uint256) {
        return _pendingFeeShares[basket];
    }

    /// @inheritdoc IFeeHarvester
    function pendingDividend(address basket, address token) external view override returns (uint256) {
        return _pendingDividend[basket][token];
    }

    /// @inheritdoc IFeeHarvester
    function referralOf(
        address basket,
        uint256 cycle,
        address referrer
    ) external view override returns (uint256 shares, uint256 claimableWif, bool claimed) {
        shares = _referralShares[basket][cycle][referrer];
        claimed = _claimed[basket][cycle][referrer];
        claimableWif = cycle < _currentCycle[basket] ? _claimable(basket, cycle, referrer) : 0;
    }

    /// @notice Cycle totals: (fee shares received, referral shares, $WIF reserved for referrers once closed).
    function cycleInfo(address basket, uint256 cycle) external view returns (uint256, uint256, uint256) {
        return (_cycleFeeShares[basket][cycle], _cycleReferralShares[basket][cycle], _cycleReferralWif[basket][cycle]);
    }

    // ---------------------------------------------------------------- swapper hooks
    function _revertUnexpectedCallback() internal pure override {
        revert UnexpectedCallback();
    }

    function _revertInsufficientInput(uint256 owed, uint256 balance) internal pure override {
        revert InsufficientInput(owed, balance);
    }

    // ---------------------------------------------------------------- internal
    function _requireBasket(address basket) private view {
        address f = factory;
        if (f == address(0)) revert FactoryNotSet();
        if (!IBasketFactory(f).isBasket(basket)) revert UnknownBasket(basket);
    }

    /// @dev Redeems `shares` (fee-exempt) and sells what was actually received, plus any claimed IOUs, for USDG.
    function _redeemAndSell(IBasket b, address basket, uint256 shares) private returns (uint256 usdgOut) {
        (address[] memory toks, ) = b.components();
        uint256[] memory held = new uint256[](toks.length);
        for (uint256 i; i < toks.length; ++i) {
            held[i] = IERC20(toks[i]).balanceOf(address(this));
        }
        b.redeem(shares, address(this));
        for (uint256 i; i < toks.length; ++i) {
            // a failed leg is an IOU owed to us: nothing arrived, so nothing is sold (see {claimIOU})
            uint256 amount = IERC20(toks[i]).balanceOf(address(this)) - held[i] + iouPending[basket][toks[i]];
            iouPending[basket][toks[i]] = 0;
            usdgOut += _sellToUsdg(toks[i], amount);
        }
    }

    /// @dev INV-8: burn + toReferrers + backers + curator == wifOut, exact to the wei.
    function _split(address basket, uint256 cycle, uint256 shares, uint256 wifOut) private {
        uint256 burned = (wifOut * BURN_BPS) / BPS;
        uint256 cycleFee = _cycleFeeShares[basket][cycle];
        uint256 toReferrers = cycleFee == 0 ? 0 : Math.mulDiv(wifOut, _cycleReferralShares[basket][cycle], cycleFee);
        uint256 rest = wifOut - burned - toReferrers;
        uint256 backers = (rest * BACKER_BPS) / (BACKER_BPS + CURATOR_BPS);
        uint256 curator = rest - backers;

        _cycleReferralWif[basket][cycle] = toReferrers;
        emit FeesHarvested(basket, cycle, shares, wifOut, burned, toReferrers, backers, curator);

        if (burned > 0) IERC20(wif).safeTransfer(DEAD, burned);
        if (rest > 0) {
            IERC20 w = IERC20(wif);
            w.forceApprove(vault, rest);
            IBackingVault(vault).queueRewards(basket, backers, curator);
            w.forceApprove(vault, 0);
        }
    }

    function _claimable(address basket, uint256 cycle, address referrer) private view returns (uint256) {
        uint256 total = _cycleReferralShares[basket][cycle];
        if (total == 0) return 0;
        return Math.mulDiv(_cycleReferralWif[basket][cycle], _referralShares[basket][cycle][referrer], total);
    }

    function _sellToUsdg(address token, uint256 amount) private returns (uint256) {
        if (amount == 0) return 0;
        if (token == usdg) return amount;
        uint24 fee = registry.component(token).v3Fee;
        address pool = IUniswapV3Factory(_v3Factory).getPool(token, usdg, fee);
        if (pool == address(0)) revert PoolNotFound(token);
        return _swapExactIn(pool, token, usdg, amount);
    }

    /// @dev USDG -> WETH (v3) -> ETH -> $WIF (v4). The $WIF lands in this contract (caller measures the delta).
    function _usdgToWif(uint256 usdgIn) private {
        if (usdgIn == 0) return;
        uint256 wethOut = _swapExactIn(usdgWethPool, usdg, weth, usdgIn);
        if (wethOut == 0) return;
        IWETH9(weth).withdraw(wethOut);
        _swapEthForWif(wethOut);
    }
}
