# ADR-0011: Deploy with Hardhat Ignition, rehearsed on a mainnet fork first
- **Status:** Accepted
- **Date:** 2026-11-05

## Context
The owner has no budget for failed mainnet deploys, the public RPC is flaky, and the deploy has 6 contracts plus about 16 wiring and seeding calls. A partial deploy, such as a missing `setFactory`, would leave the system unusable.

## Decision
- A single Ignition module (`contracts/ignition/modules/Flatpack.ts`) declares every deployment and call. Ignition journals each step, so an interrupted run resumes where it stopped (D-3).
- The exact same module is first deployed to `robinhoodFork` (an EDR fork of mainnet, $0) and checked by `scripts/smoke.ts`. Only after that passes does it go to `robinhood`.
- Parameter files are generated from `config/mainnet-4663.json`, so addresses have a single source of truth.
- Keys live in hardhat-keystore (encrypted), never in plaintext `.env` files.

## Consequences
- (+) The mainnet deploy is a repeat of a passing rehearsal. Resuming is free.
- (−) Ignition's journal (`ignition/deployments/chain-4663/`) must be committed after mainnet. It's the deployment record.
