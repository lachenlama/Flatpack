import {
  BaseError,
  ContractFunctionRevertedError,
  RawContractError,
  UserRejectedRequestError,
  decodeErrorResult,
  type Abi,
  type Hex,
} from "viem";
import {
  backingVaultAbi,
  basketAbi,
  basketFactoryAbi,
  componentRegistryAbi,
  feeHarvesterAbi,
  flatpackRouterAbi,
} from "../../../shared/abi/index.ts";

import { formatWif } from "./format.ts";

type Args = readonly unknown[];
type Message = string | ((args: Args) => string);

const bigArg = (args: Args, i: number): bigint | undefined => (typeof args[i] === "bigint" ? (args[i] as bigint) : undefined);

/**
 * Plain-English text for EVERY custom error in shared/abi (tested: a new ABI error without an entry fails the test).
 * Function entries receive the decoded error args.
 */
export const ERROR_MESSAGES: Readonly<Record<string, Message>> = {
  // Router
  ExcessiveInput: "Price moved more than your slippage. Try again.",
  QuoteResult: "This is a price quote, not a failure.",
  IncompleteFill: "The market did not have enough depth to fill every component. Try fewer shares.",
  NotBasket: "That address is not a Flatpack basket.",
  Expired: "The transaction took too long and expired. Try again.",
  UnexpectedCallback: "Unexpected callback. Nothing was changed.",
  V3BadPair: "A Stock Token pool is not set up as expected. Nothing was changed.",
  V3QuoteFailed: "Could not get a price from a Stock Token pool. Try again shortly.",
  V3SwapQuote: "Internal price quote, not a failure.",
  PoolNotFound: "There is no trading pool for one of the Stock Tokens.",
  ComponentDisabled: "One of the Stock Tokens in this basket is currently switched off for buying.",
  ComponentNotEnabled: "One of the Stock Tokens is not enabled in Flatpack.",
  // Basket
  ZeroShares: "Enter an amount of shares greater than zero.",
  BelowMinimumMint: "That is below the minimum purchase size. Try a larger amount.",
  NoSupply: "This basket has no shares yet.",
  NotPayInWif: "This basket reinvests dividends, so there are no $WIF dividends to claim.",
  NothingOwed: "Nothing is waiting to be claimed.",
  AlreadyInitialized: "This basket is already set up.",
  InvalidInitialization: "This basket is already set up.",
  NotInitializing: "This basket is not ready yet.",
  OnlyHarvester: "Only the fee harvester can do that.",
  ERC20InsufficientAllowance: "Approval is too low. Approve the exact amount first.",
  ERC20InsufficientBalance: "Your balance is too low for this transaction.",
  ERC20InvalidApprover: "Invalid approver address.",
  ERC20InvalidReceiver: "Invalid receiver address.",
  ERC20InvalidSender: "Invalid sender address.",
  ERC20InvalidSpender: "Invalid spender address.",
  // Factory
  BadLength: "The token and weight lists do not line up.",
  BadName: "That basket name is not allowed. Use 3 to 32 characters and avoid reserved words.",
  BadSymbol: "That basket symbol is not allowed. Use 2 to 10 letters or digits.",
  CreatePaused: "Creating baskets is paused right now.",
  FailedDeployment: "The basket could not be created. Nothing was charged.",
  InsufficientBalance: "You do not have enough $WIF for the curator stake.",
  NotAscending: "Tokens must be sorted by address.",
  StakeTooLow: (a) => {
    const min = bigArg(a, 1);
    return min === undefined ? "Stake at least the minimum curator stake in $WIF." : `Stake at least ${formatWif(min)} $WIF to publish.`;
  },
  TooFewComponents: "A basket needs at least 2 Stock Tokens.",
  TooManyComponents: "A basket can hold at most 8 Stock Tokens.",
  ZeroUnits: "Each Stock Token needs a weight above zero.",
  InvalidFeeTier: "Unsupported pool fee tier.",
  // Vault
  AlreadyRegistered: "This basket is already registered for backing.",
  AlreadySet: "This setting was already applied.",
  InsufficientActive: "You do not have that much backing active. Warming-up stake cannot be withdrawn yet.",
  NotCurator: "Only the basket's curator can do that.",
  OnlyFactory: "Only the basket factory can do that.",
  StillLocked: "Your unstake is still in its cooldown. Withdraw after the countdown ends.",
  TooEarly: "This week's epoch has not ended yet. Settlement opens at the epoch end.",
  UnknownBasket: "That basket is not known to Flatpack.",
  ZeroAmount: "Enter an amount greater than zero.",
  // Harvester
  AlreadyClaimed: "You already claimed this cycle.",
  CycleNotClosed: "That cycle is still open. Claim after it closes.",
  FactoryAlreadySet: "Factory already configured.",
  FactoryNotSet: "Factory not configured yet.",
  InsufficientInput: "Not enough tokens available to harvest yet.",
  InsufficientWifOut: "The swap returned less $WIF than the minimum. It will be retried.",
  NothingToHarvest: "There is nothing to harvest right now.",
  OnlyBasket: "Only a basket can do that.",
  OnlyKeeper: "Only the keeper can do that.",
  UnauthorizedEthSender: "Unexpected ETH transfer rejected.",
  V4KeyNotNative: "The $WIF pool is not configured as expected.",
  V4PartialFill: "The $WIF swap only partly filled. It will be retried.",
  V4UnexpectedUnlock: "Unexpected pool callback. Nothing was changed.",
  // Ownable / common
  OwnableInvalidOwner: "Invalid owner address.",
  OwnableUnauthorizedAccount: "Only the contract owner can do that.",
  ReentrancyGuardReentrantCall: "Please wait for the previous step to finish.",
  SafeERC20FailedOperation: "A token transfer failed. The token may be paused or your balance/approval is too low.",
  ZeroAddress: "An address was empty.",
};

/** Combined ABI of every custom error in every Flatpack contract (deduped by signature), for decoding raw revert data. */
export const ALL_ERRORS_ABI: Abi = (() => {
  const seen = new Set<string>();
  const out: Abi[number][] = [];
  for (const abi of [flatpackRouterAbi, basketAbi, basketFactoryAbi, backingVaultAbi, feeHarvesterAbi, componentRegistryAbi] as readonly Abi[]) {
    for (const item of abi) {
      if (item.type !== "error") continue;
      const sig = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(item);
    }
  }
  return out;
})();

/** All distinct error names across the ABIs. */
export function abiErrorNames(): string[] {
  return [...new Set(ALL_ERRORS_ABI.flatMap((i) => (i.type === "error" ? [i.name] : [])))];
}

/** Message for an error name (+ decoded args). Unknown names get a generic message that includes the name. */
export function messageForError(name: string, args: Args = []): string {
  const m = ERROR_MESSAGES[name];
  if (m === undefined) return `The contract rejected this transaction (${name}).`;
  return typeof m === "function" ? m(args) : m;
}

/** Decodes raw revert data (hex) into plain English, or undefined when it matches no known error. */
export function describeErrorData(data: Hex): string | undefined {
  try {
    const d = decodeErrorResult({ abi: ALL_ERRORS_ABI, data });
    return messageForError(d.errorName, (d.args ?? []) as Args);
  } catch {
    return undefined;
  }
}

/** Decodes the arguments of a `QuoteResult(usdgIn)` revert from an error thrown by `simulateContract`/`call`. Undefined if not a quote revert. */
export function quoteFromError(err: unknown): bigint | undefined {
  const data = extractRevertData(err);
  if (!data) return undefined;
  try {
    const d = decodeErrorResult({ abi: flatpackRouterAbi, data });
    if (d.errorName === "QuoteResult") return (d.args as readonly [bigint])[0];
  } catch {
    /* not a QuoteResult */
  }
  return undefined;
}

function extractRevertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const raw = err.walk((e) => e instanceof RawContractError) as RawContractError | null;
  const rawData = raw?.data;
  if (typeof rawData === "string") return rawData as Hex;
  if (rawData && typeof rawData === "object" && "data" in rawData && typeof rawData.data === "string") return rawData.data as Hex;
  const rev = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  if (rev?.raw) return rev.raw;
  const anyData = err.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: string } | null;
  return anyData?.data as Hex | undefined;
}

/**
 * Turns anything thrown by viem/wagmi into one plain-English sentence for a toast:
 * wallet rejection, decoded custom errors (using ALL Flatpack ABIs, so nested errors decode too), then a short fallback.
 */
export function describeError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled the request in your wallet.";
    const rev = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (rev?.data?.errorName) return messageForError(rev.data.errorName, (rev.data.args ?? []) as Args);
    const data = extractRevertData(err);
    if (data) {
      const m = describeErrorData(data);
      if (m) return m;
    }
    if (/insufficient funds/i.test(err.message)) return "Not enough ETH on Robinhood Chain to pay network fees.";
    if (/User rejected|denied/i.test(err.message)) return "You cancelled the request in your wallet.";
    return err.shortMessage || "Something went wrong. Nothing was sent.";
  }
  if (err instanceof Error) return err.message.slice(0, 200);
  return "Something went wrong. Nothing was sent.";
}
