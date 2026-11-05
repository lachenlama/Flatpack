# Engineering Standards and Definition of Done

These standards bind every contributor, human or agent.

## Solidity
- `pragma solidity 0.8.28;` (exact version). `evm_version = "cancun"`. The optimizer is on with 200 runs, and `via_ir = false` unless a stack-too-deep error forces it (note it in the PR if so).
- Follow the [Solidity style guide](https://docs.soliditylang.org/en/latest/style-guide.html) and run `npm run fmt` (Prettier with prettier-plugin-solidity). Layout order: types, constants, immutables, storage, events/errors (inherited from interfaces), modifiers, constructor/initializer, external, public, internal, private, then views.
- **Implement the interface exactly.** Contracts `is I<Name>` and must not change signatures, events, errors or documented behaviour. If the spec seems wrong, **stop and report it**. Don't improvise.
- **Custom errors only**, with no `require(string)`. Use the errors declared in the interface. Private helper errors are fine, but declare them in the contract.
- Full NatSpec on every external and public function (`@inheritdoc` is fine) and on non-obvious internals.
- OpenZeppelin v5: `SafeERC20`, `Ownable2Step`, `ReentrancyGuardTransient`, `Clones`, `ERC20Upgradeable` and `Initializable` for the basket clone. No other dependencies without an ADR. Uniswap v4 types come from `v4-core`.
- **Checks-Effects-Interactions.** `nonReentrant` on every state-changing external function that touches tokens.
- Approvals are exact (`forceApprove`) and reset to 0 after use. No infinite approvals.
- Never use `tx.origin`. No `selfdestruct` or `delegatecall`, except through OZ `Clones`.
- Rounding is always in the protocol's favour: `Math.mulDiv(a, b, c, Math.Rounding.Ceil)` for what users pay, and `Floor` for what they receive.
- Avoid magic numbers. Use named constants that match the interface getters.
- Events must be emitted for every state change, with the data the indexer needs.

## Tests
- Every function has success-path and revert-path tests. Every ID in `docs/TEST-PLAN.md` that belongs to your work package must exist and pass.
- Name tests `test_<ID>_<behaviour>` / `testFuzz_<ID>_...` / `invariant_<INV>_...`.
- Unit tests use mocks only, with no RPC. Fork tests pin a block number in a constant and read addresses from `config/mainnet-4663.json` (via `vm.readFile` + `vm.parseJson*`) or from constants copied from it with a comment.
- No `vm.skip`, no commented-out tests, and no "TODO" assertions.

## Definition of Done (per work package)
1. `npm run build` (Hardhat 3) has zero errors and no new warnings in owned files.
2. `npm run fmt:check` passes.
3. `npm test` passes for the whole suite, not just your files.
4. Every TEST-PLAN ID for the work package is implemented.
5. `npm run coverage` shows **≥ 95% line coverage** on owned `src/` files (report the numbers from the summary or `coverage/lcov.info`).

All commands run inside WSL from `contracts/` with Node 24. From Windows use `tools/run.sh` (see docs/TEST-PLAN.md, "How to run").
6. A short `docs/work-packages/WPn-REPORT.md` covering what was built, deviations from the spec (they should be none, or each one justified), open questions, and coverage numbers.
7. Only owned files are touched (see the work-package brief).
