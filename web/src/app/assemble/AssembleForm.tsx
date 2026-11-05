"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseEventLogs, parseUnits, type Abi, type Address } from "viem";
import { useConnection, useReadContract } from "wagmi";
import { basketFactoryAbi } from "../../../../shared/abi/index.ts";
import { BarList } from "../../components/charts/BarList.tsx";
import { LineIndexChart } from "../../components/charts/LineIndexChart.tsx";
import { approveStep, TxButton, type TxStep } from "../../components/tx/index.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button, ButtonLink } from "../../components/ui/Button.tsx";
import { InfoTip } from "../../components/ui/Tooltip.tsx";
import { NETWORK, SITE_URL, robinhoodChain } from "../../lib/chain.ts";
import { getDeployment } from "../../lib/deployment.ts";
import { erc20Abi } from "../../lib/erc20.ts";
import { describeError } from "../../lib/errors.ts";
import { formatDuration, formatUsd, formatWif } from "../../lib/format.ts";
import type { AssembleData } from "./data.ts";
import s from "./assemble.module.css";
import {
  MAX_TOKENS,
  TARGET_SHARE_USD,
  buildCreateParams,
  checkWeights,
  errorNameOf,
  evenWeights,
  fieldForError,
  validateName,
  validateSymbol,
  type BasketInput,
  type Field,
} from "./plan.ts";

type Preview = {
  hypothetical: boolean;
  points: { t: number; basket: number; spy: number }[];
  units: { ticker: string; token: string; rawUnits: string }[];
};

const STALE_SEC = 4 * 86400;

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.step} aria-labelledby={`step-${n}`}>
      <div className={s.stepHead}>
        <span className={s.num} aria-hidden="true">{n}</span>
        <h2 id={`step-${n}`}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** The five-step curator flow (WP5-UX 4.4). Reads come from the server page; writes go through TxButton. */
export function AssembleForm({ data, nowSec }: { data: AssembleData; nowSec: number }) {
  const router = useRouter();
  const { address } = useConnection();
  const dep = getDeployment().addresses;
  const minStake = BigInt(data.minStake);

  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]); // tickers, in click order
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [mode, setMode] = useState<"Reinvest" | "PayInWif">("Reinvest");
  const [stake, setStake] = useState(formatUnits(minStake, 18));
  const [touched, setTouched] = useState({ name: false, symbol: false });
  const [serverErr, setServerErr] = useState<{ field: Field; message: string } | null>(null);
  const [created, setCreated] = useState<Address | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const byTicker = useMemo(() => new Map(data.tokens.map((t) => [t.ticker, t])), [data.tokens]);
  const tickers = data.tokens.map((t) => t.ticker);
  const wcheck = checkWeights(picked.map((t) => weights[t] ?? ""));
  const nameErr = validateName(name, tickers);
  const symErr = validateSymbol(symbol, tickers);

  let stakeRaw: bigint | undefined;
  try {
    stakeRaw = parseUnits(stake || "0", 18);
  } catch {
    stakeRaw = undefined;
  }
  const stakeErr =
    stakeRaw === undefined ? "Enter a number." : stakeRaw < minStake ? `Stake at least ${formatWif(minStake)} $WIF.` : undefined;

  const { data: wifBalance } = useReadContract({
    address: NETWORK.wif.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: robinhoodChain.id,
    query: { enabled: Boolean(address) },
  });
  const balanceErr =
    address && wifBalance !== undefined && stakeRaw !== undefined && wifBalance < stakeRaw
      ? `You hold ${formatWif(wifBalance)} $WIF; the stake needs ${formatWif(stakeRaw)}.`
      : undefined;

  const toggle = (ticker: string): void => {
    setServerErr(null);
    setPicked((p) => {
      if (p.includes(ticker)) {
        const next = p.filter((x) => x !== ticker);
        setWeights(Object.fromEntries(next.map((t, i) => [t, evenWeights(next.length)[i] as string])));
        return next;
      }
      if (p.length >= MAX_TOKENS) return p;
      const next = [...p, ticker];
      setWeights(Object.fromEntries(next.map((t, i) => [t, evenWeights(next.length)[i] as string])));
      return next;
    });
  };

  // 30-day hypothetical backtest, debounced, once weights are valid
  const recipeKey = wcheck.ok ? picked.map((t, i) => `${t}:${(wcheck.bps[i] as number) / 100}`).join(",") : "";
  useEffect(() => {
    if (!recipeKey) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      setPreviewErr(null);
      fetch(`/assemble/preview?w=${encodeURIComponent(recipeKey)}`, { signal: ctl.signal })
        .then(async (r) => {
          const j = (await r.json()) as Preview & { error?: string };
          if (!r.ok) throw new Error(j.error ?? "Preview unavailable.");
          setPreview(j);
        })
        .catch((e: unknown) => {
          if (!ctl.signal.aborted) {
            setPreview(null);
            setPreviewErr(e instanceof Error ? e.message : "Preview unavailable.");
          }
        });
    }, 400);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [recipeKey]);

  const input: BasketInput | undefined = wcheck.ok
    ? {
        name,
        symbol,
        mode,
        picks: picked.map((t, i) => ({ token: (byTicker.get(t) as { token: Address }).token, feed: (byTicker.get(t) as { feed: Address }).feed, weightBps: wcheck.bps[i] as number })),
      }
    : undefined;

  const ready = Boolean(input) && !nameErr && !symErr && !stakeErr && !balanceErr && !data.createPaused && stakeRaw !== undefined;
  const reason = data.createPaused
    ? "Creating baskets is paused right now."
    : !wcheck.ok
      ? (wcheck.message ?? "Fix the weights first.")
      : (nameErr ? `Name: ${nameErr}` : undefined) ?? (symErr ? `Symbol: ${symErr}` : undefined) ?? stakeErr ?? balanceErr;

  const steps: TxStep[] =
    input && stakeRaw !== undefined
      ? [
          approveStep({ token: NETWORK.wif.address, spender: dep.BasketFactory, amount: stakeRaw, symbol: "WIF" }),
          {
            id: "publish",
            label: "Publish",
            successTitle: "Basket published",
            call: async ({ account, publicClient }) => {
              const params = await buildCreateParams(publicClient, input);
              const call = {
                address: dep.BasketFactory,
                abi: basketFactoryAbi as Abi,
                functionName: "createBasket",
                args: [params, stakeRaw as bigint] as readonly unknown[],
              };
              try {
                await publicClient.simulateContract({ ...call, account } as Parameters<typeof publicClient.simulateContract>[0]);
                setServerErr(null);
              } catch (err) {
                const field = fieldForError(errorNameOf(err));
                setServerErr({ field, message: describeError(err) });
                throw err;
              }
              return call;
            },
          },
        ]
      : [];

  const onSuccess = async (hash: `0x${string}`): Promise<void> => {
    try {
      const { createPublicClient, http } = await import("viem");
      const client = createPublicClient({ chain: robinhoodChain, transport: http() });
      const rc = await client.getTransactionReceipt({ hash });
      const ev = parseEventLogs({ abi: basketFactoryAbi, logs: rc.logs, eventName: "BasketCreated" })[0];
      const basket = (ev?.args as { basket?: Address } | undefined)?.basket;
      if (basket) setCreated(basket);
    } catch {
      /* the receipt is already confirmed; the user can still find the basket in Explore */
    }
  };

  useEffect(() => {
    if (!created) return;
    const id = setTimeout(() => router.push(`/b/${created}?created=1`), 2500);
    return () => clearTimeout(id);
  }, [created, router]);

  if (created) {
    const url = `${SITE_URL}/b/${created}`;
    const text = `I just published ${name.trim()} on Flatpack, a basket of Stock Tokens on Robinhood Chain.`;
    return (
      <div className={s.done} role="status" data-testid="assemble-done">
        <h2>Published: {name.trim()}</h2>
        <p>Your basket is live on Robinhood Chain. Share it, so people can buy it in one transaction.</p>
        <div className={s.row}>
          <ButtonLink href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}>Share on X</ButtonLink>
          <ButtonLink variant="ghost" href={`/b/${created}?created=1`}>Open the basket page</ButtonLink>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>Taking you to the basket page…</p>
      </div>
    );
  }

  const filtered = data.tokens.filter((t) => t.ticker.toLowerCase().includes(search.trim().toLowerCase()));
  const fieldErr = (f: Field): React.ReactNode =>
    serverErr?.field === f ? (
      <p className={s.err} role="alert">
        {"▼ "}
        {serverErr.message}
      </p>
    ) : null;
  const sharePrice = TARGET_SHARE_USD;

  return (
    <div className={s.steps}>
      <Step n="①" title={`Pick 2 to ${MAX_TOKENS} Stock Tokens`}>
        <div className={s.field}>
          <label htmlFor="token-search">Search by ticker</label>
          <input id="token-search" className={s.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="NVDA, MSFT…" autoComplete="off" />
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.88rem" }}>
          Only Stock Tokens enabled in the ComponentRegistry (each has a Chainlink price feed and a USDG pool).
        </p>
        <div className={s.picker} role="group" aria-label="Stock Tokens">
          {filtered.map((t) => {
            const age = t.feedUpdatedAt ? nowSec - t.feedUpdatedAt : undefined;
            const on = picked.includes(t.ticker);
            return (
              <button type="button" key={t.ticker} className={s.pick} aria-pressed={on} onClick={() => toggle(t.ticker)} disabled={!on && picked.length >= MAX_TOKENS} data-ticker={t.ticker}>
                <span className={s.pickTop}>
                  <span>{on ? "✓ " : ""}{t.ticker}</span>
                  <span className="num">{t.priceUsd !== undefined ? formatUsd(t.priceUsd) : "n/a"}</span>
                </span>
                <span className={s.pickSub}>
                  {age === undefined ? "no feed reading" : age > STALE_SEC ? `feed stale: ${formatDuration(age)} old` : `feed updated ${formatDuration(age)} ago`}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 ? <p className="muted">No enabled token matches.</p> : null}
        </div>
        {picked.length < 2 ? <p className="muted" style={{ marginTop: 8 }}>{picked.length} selected. Pick at least 2.</p> : <p className="muted" style={{ marginTop: 8 }}>{picked.length} selected.</p>}
        {fieldErr("tokens")}
      </Step>

      <Step n="②" title="Set weights">
        {picked.length === 0 ? (
          <p className="muted">Pick tokens in step ① first.</p>
        ) : (
          <>
            {picked.map((t, i) => (
              <div className={s.wRow} key={t}>
                <span className="mono" style={{ fontWeight: 650 }}>{t}</span>
                <span>
                  <input
                    className={s.input}
                    style={{ width: "5.5rem" }}
                    inputMode="decimal"
                    aria-label={`${t} weight in percent`}
                    aria-invalid={wcheck.bps[i] === undefined}
                    value={weights[t] ?? ""}
                    onChange={(e) => setWeights((w) => ({ ...w, [t]: e.target.value }))}
                  />{" "}%
                </span>
              </div>
            ))}
            <BarList
              ariaLabel="Weights"
              items={picked.map((t, i) => ({ key: t, label: t, value: (wcheck.bps[i] ?? 0) / 100, display: `${(wcheck.bps[i] ?? 0) / 100}%` }))}
            />
            <p className={wcheck.ok ? s.ok : s.err} role="status" data-testid="weight-status">
              {wcheck.ok ? "✓ Weights total 100%" : `▼ ${wcheck.message}`}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setWeights(Object.fromEntries(picked.map((t, i) => [t, evenWeights(picked.length)[i] as string])))}>
              Even split
            </Button>
          </>
        )}
        {fieldErr("weights")}
      </Step>

      <Step n="③" title="Name it">
        <div className={s.two}>
          <div className={s.field}>
            <label htmlFor="b-name">Name (3 to 32 characters)</label>
            <input id="b-name" className={s.input} value={name} maxLength={40} aria-invalid={(touched.name && Boolean(nameErr)) || serverErr?.field === "name"} onBlur={() => setTouched((x) => ({ ...x, name: true }))} onChange={(e) => { setName(e.target.value); setServerErr(null); }} placeholder="AI Picks & Shovels" autoComplete="off" />
            {touched.name && nameErr ? <p className={s.err}>{"▼ "}{nameErr}</p> : null}
            {fieldErr("name")}
          </div>
          <div className={s.field}>
            <label htmlFor="b-symbol">Symbol (2 to 10 letters or digits)</label>
            <input id="b-symbol" className={s.input} value={symbol} maxLength={14} aria-invalid={(touched.symbol && Boolean(symErr)) || serverErr?.field === "symbol"} onBlur={() => setTouched((x) => ({ ...x, symbol: true }))} onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setServerErr(null); }} placeholder="AIPS" autoComplete="off" />
            {touched.symbol && symErr ? <p className={s.err}>{"▼ "}{symErr}</p> : null}
            {fieldErr("symbol")}
          </div>
        </div>
        <fieldset className={s.radios}>
          <legend className={s.legend}>Dividends</legend>
          <label><input type="radio" name="mode" checked={mode === "Reinvest"} onChange={() => setMode("Reinvest")} /> Reinvest (value stays in the basket)</label>
          <label><input type="radio" name="mode" checked={mode === "PayInWif"} onChange={() => setMode("PayInWif")} /> Pay in $WIF (dividends are sold for $WIF and streamed to holders)</label>
        </fieldset>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
          Names and symbols cannot contain "robinhood" or "official", and a ticker on its own is not allowed.
        </p>
      </Step>

      <Step n="④" title="Preview">
        {!wcheck.ok || !input ? (
          <p className="muted">Finish steps ① and ② to see the recipe.</p>
        ) : previewErr ? (
          <p className={s.err}>{previewErr}</p>
        ) : !preview ? (
          <p className="muted" aria-busy="true">Loading Chainlink history…</p>
        ) : (
          <>
            <p>
              One share ≈ <strong className="num">{formatUsd(sharePrice)}</strong> at today's feed prices.
              <InfoTip content="Source: the current Chainlink answer of each selected feed, applied to your weights. Units are rounded to whole raw units." />
            </p>
            <div className={s.hyp}><Badge tone="warning" icon="●">Hypothetical</Badge> 30-day backtest of this recipe against SPY, indexed to 100. It is not what any basket earned, and past performance does not predict anything.</div>
            {preview.points.length >= 2 ? (
              <LineIndexChart
                times={preview.points.map((p) => p.t)}
                ariaLabel="Hypothetical 30-day recipe backtest of your basket against SPY, indexed to 100"
                note="hypothetical"
                series={[
                  { id: "basket", label: "Your recipe", tone: "series-1", values: preview.points.map((p) => p.basket) },
                  { id: "spy", label: "SPY", tone: "series-2", dashed: true, values: preview.points.map((p) => p.spy) },
                ]}
              />
            ) : (
              <p className="muted">Not enough price history yet to draw the backtest.</p>
            )}
            <table className={s.units}>
              <caption className="visually-hidden">Units per share, sorted by token address</caption>
              <thead><tr><th>Token</th><th className="r">Weight</th><th className="r">Units per share</th></tr></thead>
              <tbody>
                {preview.units.map((u) => {
                  const i = picked.indexOf(u.ticker);
                  return (
                    <tr key={u.token}>
                      <td className="mono">{u.ticker}</td>
                      <td className="r num">{i >= 0 ? `${(wcheck.bps[i] ?? 0) / 100}%` : ""}</td>
                      <td className="r num">{Number(formatUnits(BigInt(u.rawUnits), 18)).toLocaleString("en-US", { maximumSignificantDigits: 6 })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Step>

      <Step n="⑤" title="Stake and publish">
        <div className={s.field} style={{ maxWidth: 320 }}>
          <label htmlFor="b-stake">
            Stake ($WIF) — at least {formatWif(minStake)}
            <InfoTip content="The curator stake goes to the BackingVault behind your basket. It is yours: you can unstake with a 7-day cooldown. Approval is for exactly this amount." />
          </label>
          <input id="b-stake" className={s.input} inputMode="decimal" value={stake} aria-invalid={Boolean(stakeErr) || serverErr?.field === "stake"} onChange={(e) => { setStake(e.target.value); setServerErr(null); }} />
          {stakeErr ? <p className={s.err}>{"▼ "}{stakeErr}</p> : null}
          {!stakeErr && balanceErr ? <p className={s.err}>{"▼ "}{balanceErr}</p> : null}
          {address && wifBalance !== undefined ? <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>Your balance: {formatWif(wifBalance)} $WIF</p> : null}
          {fieldErr("stake")}
        </div>
        <div style={{ marginTop: 16 }}>
          <TxButton steps={steps} disabled={!ready} disabledReason={reason} onSuccess={(h) => void onSuccess(h)}>
            Approve and publish
          </TxButton>
          {serverErr?.field === "general" ? <p className={s.err} role="alert">{"▼ "}{serverErr.message}</p> : null}
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 12 }}>
          Two transactions: ① approve exactly your stake in $WIF to the BasketFactory, ② create the basket. Nothing here is investment advice.
        </p>
      </Step>
    </div>
  );
}
