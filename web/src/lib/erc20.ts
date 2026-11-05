import { parseAbi } from "viem";

/** Minimal ERC-20 ABI: balanceOf, allowance, approve, symbol, decimals. */
export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
