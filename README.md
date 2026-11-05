# Flatpack

Build a basket of Stock Tokens on Robinhood Chain, share the link, and earn $WIF every time someone buys it.
Built for the [world is flat hackathon](https://worldisflat.fun/build).

> Not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc. Stock Tokens are not available
> to US persons or in restricted jurisdictions. Nothing here is investment advice.

| Doc | What it is |
|---|---|
| [FLATPACK-PLAN.md](FLATPACK-PLAN.md) | Product plan, edge cases, the $WIF design and schedule |
| [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | System architecture (components, flows, invariants) |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/TEST-PLAN.md](docs/TEST-PLAN.md) | Test strategy and the required test IDs |
| [docs/ENGINEERING-STANDARDS.md](docs/ENGINEERING-STANDARDS.md) | Coding standards and Definition of Done |
| [docs/work-packages/](docs/work-packages/) | Implementation briefs and reports |
| [config/mainnet-4663.json](config/mainnet-4663.json) | Verified onchain addresses |

## Layout
```
contracts/   Hardhat 3 project (src/, test/ with Solidity tests, ignition/ deploy modules)
keeper/      Keeper bot (TypeScript, viem)
config/      Chain addresses
docs/        Architecture, ADRs, test plan, work packages
tools/       run.sh: runs a command in contracts/ inside WSL with Node 24
```

## Develop
```bash
# inside WSL, Node 24 (nvm use 24)
cd contracts && npm install
npm run build          # hardhat build
npm test               # unit, fuzz and invariant Solidity tests (excludes fork tests)
npm run test:fork      # mainnet-fork tests (tests named test_F_*, RPC from RH_RPC_URL)
npm run coverage       # coverage/lcov.info and coverage/html
```
