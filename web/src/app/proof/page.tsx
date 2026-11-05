import type { Metadata } from "next";
import { Address } from "../../components/ui/Address.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { REPO_URL, explorerTx, NETWORK } from "../../lib/chain.ts";
import { CONTRACT_NAMES, DEPLOYMENT_NAME, DeploymentError, getDeployment, type Deployment } from "../../lib/deployment.ts";
import { formatDuration, formatUsd, formatUtc } from "../../lib/format.ts";
import { contractVerified, milestoneTransactions, oracleRows } from "../../lib/reads/proof.ts";
import s from "../page.module.css";

export const metadata: Metadata = { title: "Proof: security model, contracts and evidence" };

const adr = (file: string): string => `${REPO_URL}/blob/main/docs/adr/${file}`;

const SECURITY = [
  { text: "Redeem in kind works without any oracle: you always get your share of every component back.", href: adr("0001-fixed-unit-in-kind-baskets.md"), label: "ADR-0001" },
  { text: "Pause-proof: if an issuer pauses a Stock Token, redeem pays an IOU for that component that you claim later. Nothing blocks the others.", href: adr("0003-pause-tolerant-redeem-with-ious.md"), label: "ADR-0003" },
  { text: "Fees are taken in basket shares, not in your tokens, and only turn into $WIF when harvested.", href: adr("0002-fee-in-shares.md"), label: "ADR-0002" },
  { text: "The keeper can only trigger harvests and settles. It cannot choose where funds go: the split is fixed in the contract.", href: adr("0004-keeper-gated-harvest.md"), label: "ADR-0004" },
  { text: "No proxies and no upgrade keys: the deployed code is the code.", href: adr("0008-no-upgradeability.md"), label: "ADR-0008" },
  { text: "Admin power is limited to an allowlist of Stock Tokens and their Chainlink feeds (ComponentRegistry). It cannot touch balances.", href: `${REPO_URL}/blob/main/docs/architecture/ARCHITECTURE.md`, label: "Architecture" },
];

const EVIDENCE = [
  ["Unit, fuzz and invariant tests", "177 passing (Foundry-style suite in contracts/test)"],
  ["Mainnet-fork tests", "18 passing at a pinned block (router, harvester, end to end)"],
  ["Keeper tests", "32 passing"],
  ["Deploy smoke check", "52 of 52 checks on a mainnet fork"],
  ["Deploy-day rehearsal", "tools/rehearse.sh: deploy, demo baskets, buys, keeper harvest, time travel, settle and a dividend, on a local fork"],
];

export default async function ProofPage() {
  let dep: Deployment | undefined;
  let depError: string | undefined;
  try {
    dep = getDeployment();
  } catch (e) {
    depError = e instanceof DeploymentError ? e.message : "Deployment unavailable.";
  }
  const verified = dep ? await Promise.all(CONTRACT_NAMES.map((n) => contractVerified((dep as Deployment).addresses[n]))) : [];
  const [milestones, oracles] = await Promise.all([milestoneTransactions(), oracleRows()]);
  const now = Math.floor(Date.now() / 1000);

  return (
    <>
      <h1>Proof</h1>
      <p className="muted" style={{ maxWidth: "62ch" }}>
        Everything a reviewer needs: what can and cannot go wrong, the deployed contracts, how they were tested, and a live log of the
        flywheel running on Robinhood Chain.
      </p>

      <section className={s.section}>
        <h2>1. Security model</h2>
        <ul className={s.proofList}>
          {SECURITY.map((b) => (
            <li key={b.label}>
              {b.text}{" "}
              <a href={b.href} target="_blank" rel="noopener noreferrer">
                {b.label} {"↗"}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.section}>
        <h2>2. Contracts</h2>
        {dep ? (
          <>
            <p className="muted">
              Deployment: <span className="mono">{DEPLOYMENT_NAME}</span>, chain {dep.chainId}, from block <span className="num">{dep.blockNumber}</span>.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <caption className="visually-hidden">Flatpack contracts</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: "left", padding: 8 }}>Contract</th>
                    <th scope="col" style={{ textAlign: "left", padding: 8 }}>Address</th>
                    <th scope="col" style={{ textAlign: "left", padding: 8 }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRACT_NAMES.map((name, i) => {
                    const v = verified[i];
                    return (
                      <tr key={name} style={{ borderTop: "1px solid var(--rule)" }}>
                        <th scope="row" style={{ textAlign: "left", padding: 8 }} className="mono">{name}</th>
                        <td style={{ padding: 8 }}>
                          <Address address={dep.addresses[name]} full />
                        </td>
                        <td style={{ padding: 8 }}>
                          {v === true ? <Badge tone="good" icon={"✓"}>Verified</Badge> : v === false ? <Badge tone="warning">Not verified</Badge> : <Badge>Unknown (local or offline)</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState title="No deployment loaded">{depError}</EmptyState>
        )}
      </section>

      <section className={s.section}>
        <h2>3. Evidence</h2>
        <Card>
          <dl className={s.kv} style={{ margin: 0 }}>
            {EVIDENCE.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt style={{ fontWeight: 650 }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            Docs:{" "}
            <a href={`${REPO_URL}/tree/main/docs`} target="_blank" rel="noopener noreferrer">repo docs {"↗"}</a>
            {" · "}
            <a href={`${REPO_URL}/tree/main/docs/adr`} target="_blank" rel="noopener noreferrer">all ADRs {"↗"}</a>
            {" · "}
            <a href={`${REPO_URL}/blob/main/docs/runbooks/DEPLOY.md`} target="_blank" rel="noopener noreferrer">deploy runbook {"↗"}</a>
          </p>
        </Card>
      </section>

      <section className={s.section}>
        <h2>4. Live transaction log</h2>
        {milestones.length === 0 ? (
          <EmptyState title="No milestones yet">The first basket, buy, harvest and burn appear here as soon as they happen onchain.</EmptyState>
        ) : (
          <ol className={s.proofList}>
            {milestones.map((m) => (
              <li key={m.label}>
                <strong>{m.label}</strong>{" "}
                <a className="mono" href={explorerTx(m.transactionHash)} target="_blank" rel="noopener noreferrer">
                  {m.transactionHash.slice(0, 10)}{"…"}{m.transactionHash.slice(-6)} {"↗"}
                </a>{" "}
                <span className="muted">block {String(m.blockNumber)}{m.timestamp ? `, ${formatUtc(m.timestamp, true)}` : ""}</span>
              </li>
            ))}
          </ol>
        )}
        {dep ? (
          <p className="muted">
            Deployed at block <span className="num">{dep.blockNumber}</span> ({typeof dep.deployedAt === "string" ? dep.deployedAt : new Date(dep.deployedAt * 1000).toISOString()}). Network explorer:{" "}
            <a href={NETWORK.explorer} target="_blank" rel="noopener noreferrer">Blockscout {"↗"}</a>.
          </p>
        ) : null}
      </section>

      <section className={s.section}>
        <h2>5. Oracles</h2>
        <p className="muted">One Chainlink USD feed per Stock Token (8 decimals). Stock feeds update 24/5; a feed older than 2 hours means the market is closed.</p>
        {oracles.length === 0 ? (
          <EmptyState title="No feeds to show yet">Feeds appear once a basket exists.</EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption className="visually-hidden">Chainlink feeds in use</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left", padding: 8 }}>Token</th>
                  <th scope="col" style={{ textAlign: "left", padding: 8 }}>Feed</th>
                  <th scope="col" style={{ textAlign: "right", padding: 8 }}>Price</th>
                  <th scope="col" style={{ textAlign: "left", padding: 8 }}>Freshness</th>
                </tr>
              </thead>
              <tbody>
                {oracles.map((o) => {
                  const age = o.updatedAt ? now - o.updatedAt : undefined;
                  const stale = age === undefined || age > 7200;
                  return (
                    <tr key={o.feed} style={{ borderTop: "1px solid var(--rule)" }}>
                      <th scope="row" style={{ textAlign: "left", padding: 8 }} className="mono">{o.ticker}</th>
                      <td style={{ padding: 8 }}><Address address={o.feed} /></td>
                      <td style={{ padding: 8, textAlign: "right" }} className="num">{o.priceUsd ? formatUsd(o.priceUsd) : "n/a"}</td>
                      <td style={{ padding: 8 }}>
                        {age === undefined ? <Badge tone="warning">no reading</Badge> : stale ? <Badge tone="warning" icon={"○"}>closed, {formatDuration(age)} old</Badge> : <Badge tone="good" icon={"●"}>fresh, {formatDuration(age)} old</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
