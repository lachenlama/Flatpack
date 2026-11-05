// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IBasket, BasketInit, DividendMode} from "./interfaces/IBasket.sol";
import {IFeeHarvester} from "./interfaces/IFeeHarvester.sol";
import {IScaledUIAmount} from "./interfaces/external/IExternal.sol";

/// @title Basket
/// @notice Immutable, fixed-unit, in-kind basket of Stock Tokens as an ERC-20 (ADR-0001). It has no owner.
/// @dev Deployed as an EIP-1167 clone of an implementation whose initialisers are disabled. See {IBasket} for the
///      normative behaviour. No oracle is read on the mint or redeem path. The only external reads in `sync` are the
///      components' own `uiMultiplier()`.
contract Basket is Initializable, ERC20Upgradeable, ReentrancyGuardTransient, IBasket {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    /// @inheritdoc IBasket
    uint256 public constant override FEE_BPS = 30;
    /// @inheritdoc IBasket
    uint256 public constant override REFERRAL_SHARE_BPS = 1000;
    /// @inheritdoc IBasket
    uint256 public constant override MAX_DIVIDEND_STEP = 1.03e18;
    /// @inheritdoc IBasket
    uint256 public constant override MIN_MINT_SHARES = 1e12;
    uint256 private constant BPS = 10_000;
    uint256 private constant WAD = 1e18;

    // ---------------------------------------------------------------- storage
    /// @inheritdoc IBasket
    address public override factory;
    /// @inheritdoc IBasket
    address public override curator;
    /// @inheritdoc IBasket
    address public override harvester;
    /// @inheritdoc IBasket
    DividendMode public override mode;
    /// @inheritdoc IBasket
    mapping(address account => mapping(address token => uint256)) public override owed;
    /// @inheritdoc IBasket
    mapping(address token => uint256) public override totalOwed;

    address private _wif;
    address[] private _tokens;
    uint256[] private _rawUnits;
    uint256[] private _lastMultiplier;

    /// @dev $WIF dividend accumulator (PayInWif only), scaled by 1e18.
    uint256 private _accWifPerShare;
    mapping(address account => uint256) private _rewardDebt;
    mapping(address account => uint256) private _accrued;

    // ---------------------------------------------------------------- constructor / initializer
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IBasket
    /// @dev `factory` doubles as the "already initialised" flag for clones. The implementation contract itself
    ///      reverts with OZ `InvalidInitialization` because its initialisers are disabled.
    function initialize(BasketInit calldata init) external override {
        if (factory != address(0)) revert AlreadyInitialized();
        _initialize(init);
    }

    // ---------------------------------------------------------------- core
    /// @inheritdoc IBasket
    function mint(
        uint256 shares,
        address receiver,
        address referrer
    ) external override nonReentrant returns (uint256 sharesOut, uint256[] memory amountsIn) {
        if (shares == 0) revert ZeroShares();
        if (shares < MIN_MINT_SHARES) revert BelowMinimumMint(shares, MIN_MINT_SHARES);
        if (receiver == address(0)) revert ZeroAddress();
        _sync();

        address h = harvester;
        uint256 fee = msg.sender == h ? 0 : (shares * FEE_BPS) / BPS;
        sharesOut = shares - fee;
        amountsIn = _previewMint(shares);

        // effects
        _mint(receiver, sharesOut);
        if (fee > 0) _mint(h, fee);

        // interactions
        address[] memory toks = _tokens;
        for (uint256 i; i < toks.length; ++i) {
            IERC20(toks[i]).safeTransferFrom(msg.sender, address(this), amountsIn[i]);
        }
        emit Minted(msg.sender, receiver, referrer, shares, fee, amountsIn);
        if (fee > 0) IFeeHarvester(h).onFeeShares(referrer, fee);
    }

    /// @inheritdoc IBasket
    function redeem(
        uint256 shares,
        address receiver
    ) external override nonReentrant returns (uint256[] memory amountsOut) {
        if (shares == 0) revert ZeroShares();
        if (receiver == address(0)) revert ZeroAddress();
        _sync();

        address h = harvester;
        uint256 fee = msg.sender == h ? 0 : (shares * FEE_BPS) / BPS;
        uint256 net = shares - fee;
        address[] memory toks = _tokens;
        amountsOut = _payouts(toks, net, totalSupply());

        // effects (fee shares stay in supply; only the net shares are burned)
        if (fee > 0) _transfer(msg.sender, h, fee);
        _burn(msg.sender, net);

        // interactions
        if (fee > 0) IFeeHarvester(h).onFeeShares(address(0), fee);
        for (uint256 i; i < toks.length; ++i) {
            uint256 amt = amountsOut[i];
            if (amt == 0) continue;
            if (!IERC20(toks[i]).trySafeTransfer(receiver, amt)) {
                owed[receiver][toks[i]] += amt;
                totalOwed[toks[i]] += amt;
                emit IOURecorded(receiver, toks[i], amt);
            }
        }
        emit Redeemed(msg.sender, receiver, shares, fee, amountsOut);
    }

    /// @inheritdoc IBasket
    function sync() external override nonReentrant {
        _sync();
    }

    /// @inheritdoc IBasket
    function claimIOU(address token, address to) external override nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        amount = owed[msg.sender][token];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender][token] = 0;
        totalOwed[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit IOUClaimed(msg.sender, token, to, amount);
    }

    /// @inheritdoc IBasket
    function notifyWifDividend(uint256 amount) external override nonReentrant {
        if (msg.sender != harvester) revert OnlyHarvester();
        if (mode != DividendMode.PayInWif) revert NotPayInWif();
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        _accWifPerShare += Math.mulDiv(amount, WAD, supply);
        emit WifDividendNotified(amount, _accWifPerShare);
    }

    /// @inheritdoc IBasket
    /// @dev Returns 0 (instead of reverting) when nothing is pending, so the harvester can claim unconditionally.
    function claimWifDividend(address to) external override nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        _settle(msg.sender);
        amount = _accrued[msg.sender];
        if (amount == 0) return 0;
        _accrued[msg.sender] = 0;
        IERC20(_wif).safeTransfer(to, amount);
        emit WifDividendClaimed(msg.sender, to, amount);
    }

    // ---------------------------------------------------------------- views
    /// @inheritdoc IBasket
    function components() external view override returns (address[] memory tokens, uint256[] memory rawUnits) {
        return (_tokens, _rawUnits);
    }

    /// @inheritdoc IBasket
    function lastMultipliers() external view override returns (uint256[] memory) {
        return _lastMultiplier;
    }

    /// @inheritdoc IBasket
    function effectiveBalances() external view override returns (uint256[] memory out) {
        address[] memory toks = _tokens;
        out = new uint256[](toks.length);
        for (uint256 i; i < toks.length; ++i) {
            out[i] = _effBal(toks[i]);
        }
    }

    /// @inheritdoc IBasket
    function pendingWifDividend(address account) external view override returns (uint256) {
        return _accrued[account] + _sat(Math.mulDiv(balanceOf(account), _accWifPerShare, WAD), _rewardDebt[account]);
    }

    /// @inheritdoc IBasket
    function previewMint(uint256 shares) external view override returns (uint256[] memory amountsIn) {
        return _previewMint(shares);
    }

    /// @inheritdoc IBasket
    function previewRedeem(uint256 shares, address owner_) external view override returns (uint256[] memory) {
        uint256 fee = owner_ == harvester ? 0 : (shares * FEE_BPS) / BPS;
        address[] memory toks = _tokens;
        uint256 supply = totalSupply();
        if (supply == 0) return new uint256[](toks.length);
        return _payouts(toks, shares - fee, supply);
    }

    // ---------------------------------------------------------------- internal
    function _initialize(BasketInit calldata init) private initializer {
        if (init.curator == address(0) || init.harvester == address(0) || init.wif == address(0)) {
            revert ZeroAddress();
        }
        __ERC20_init(init.name, init.symbol);
        factory = msg.sender;
        curator = init.curator;
        harvester = init.harvester;
        mode = init.mode;
        _wif = init.wif;
        _tokens = init.tokens;
        _rawUnits = init.rawUnits;
        uint256 n = init.tokens.length;
        for (uint256 i; i < n; ++i) {
            _lastMultiplier.push(IScaledUIAmount(init.tokens[i]).uiMultiplier());
        }
        emit Initialized(init.curator, init.tokens, init.rawUnits, init.mode);
    }

    /// @dev Per-component pro-rata amounts, rounded down (ADR-0003). Must be computed BEFORE any transfer.
    function _payouts(address[] memory toks, uint256 net, uint256 supply) private view returns (uint256[] memory out) {
        out = new uint256[](toks.length);
        for (uint256 i; i < toks.length; ++i) {
            out[i] = Math.mulDiv(_effBal(toks[i]), net, supply);
        }
    }

    function _previewMint(uint256 shares) private view returns (uint256[] memory amountsIn) {
        uint256 n = _rawUnits.length;
        amountsIn = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            amountsIn[i] = Math.mulDiv(_rawUnits[i], shares, WAD, Math.Rounding.Ceil);
        }
    }

    /// @dev balance minus IOUs reserved for claimants. Saturates at 0 so an exotic balance decrease can't block exits.
    function _effBal(address token) private view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 reserved = totalOwed[token];
        return bal > reserved ? bal - reserved : 0;
    }

    /// @dev Applies multiplier changes (ARCHITECTURE section 5.3). A token whose `uiMultiplier()` reverts or returns 0
    ///      is skipped so that it can never block mint or redeem.
    function _sync() private {
        uint256 n = _tokens.length;
        for (uint256 i; i < n; ++i) {
            address token = _tokens[i];
            uint256 last = _lastMultiplier[i];
            uint256 m;
            try IScaledUIAmount(token).uiMultiplier() returns (uint256 r) {
                m = r;
            } catch {
                continue;
            }
            if (m == 0 || m == last) continue;
            _applyMultiplier(i, token, last, m);
        }
    }

    function _applyMultiplier(uint256 i, address token, uint256 last, uint256 m) private {
        bool dividend = mode == DividendMode.PayInWif && m > last && m <= Math.mulDiv(last, MAX_DIVIDEND_STEP, WAD);
        uint256 units = _rawUnits[i];
        uint256 excess;
        _lastMultiplier[i] = m;
        if (dividend) {
            units = Math.mulDiv(units, last, m, Math.Rounding.Ceil);
            _rawUnits[i] = units;
            uint256 supply = totalSupply();
            if (supply > 0) {
                uint256 eff = _effBal(token);
                uint256 needed = Math.mulDiv(units, supply, WAD, Math.Rounding.Ceil);
                if (eff > needed) excess = eff - needed;
            }
        }
        // A skim that fails (e.g. paused token) is left in the basket as a donation to holders: it never blocks sync.
        uint256 skimmed;
        address h = harvester;
        if (excess > 0 && IERC20(token).trySafeTransfer(h, excess)) skimmed = excess;
        emit MultiplierSynced(token, last, m, dividend, units, skimmed);
        if (skimmed > 0) IFeeHarvester(h).onDividendSkim(token, skimmed);
    }

    /// @dev Moves `account`'s unclaimed accumulator share into `_accrued` and re-bases its reward debt.
    function _settle(address account) private {
        uint256 gross = Math.mulDiv(balanceOf(account), _accWifPerShare, WAD);
        _accrued[account] += _sat(gross, _rewardDebt[account]);
        _rewardDebt[account] = _debt(balanceOf(account));
    }

    /// @dev Reward debt rounds UP (review R-4, same fix as the vault R-3): earnings are floor(balance * acc) - debt, so
    ///      holders can never be credited more $WIF than notifyWifDividend delivered. Otherwise the last claimer, which
    ///      can be the harvester inside harvestFees, could revert and block harvesting for this basket.
    function _debt(uint256 balance) private view returns (uint256) {
        return Math.mulDiv(balance, _accWifPerShare, WAD, Math.Rounding.Ceil);
    }

    /// @dev Saturating subtraction (a ceil-rounded debt can exceed floor(balance * acc) by 1 wei).
    function _sat(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a - b : 0;
    }

    /// @dev Settles both parties BEFORE balances change and re-bases their debt after (PayInWif only).
    function _update(address from, address to, uint256 value) internal override {
        if (mode != DividendMode.PayInWif) {
            super._update(from, to, value);
            return;
        }
        if (from != address(0)) _settle(from);
        if (to != address(0)) _settle(to);
        super._update(from, to, value);
        if (from != address(0)) _rewardDebt[from] = _debt(balanceOf(from));
        if (to != address(0)) _rewardDebt[to] = _debt(balanceOf(to));
    }
}
