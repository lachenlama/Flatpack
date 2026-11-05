import { formatAmount, type AmountOptions } from "../../lib/format.ts";

/** Props of {@link Amount}. */
export interface AmountProps extends AmountOptions {
  /** Raw on-chain integer. */
  value: bigint;
  /** Token decimals: 6 for USDG, 18 for shares/$WIF/Stock Tokens. */
  decimals: number;
  /** Unit suffix, e.g. "USDG" or "$WIF". */
  symbol?: string;
}

/** Formats a bigint token amount exactly, in mono tabular figures. `<Amount value={v} decimals={6} symbol="USDG" />` */
export function Amount({ value, decimals, symbol, ...opts }: AmountProps) {
  return (
    <span className="num">
      {formatAmount(value, decimals, opts)}
      {symbol ? <span className="muted"> {symbol}</span> : null}
    </span>
  );
}
