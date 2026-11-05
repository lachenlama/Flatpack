#!/usr/bin/env bash
# Deploy-day dress rehearsal (WP4c): local mainnet-fork node -> Ignition deploy -> smoke -> export -> demo baskets ->
# buys -> keeper dry-run -> keeper harvestFees -> time travel -> keeper settle -> (stretch) dividend -> idle tick.
#   MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/rehearse.sh
# Idempotent: wipes its own journal/params/export/state each run, and ALWAYS kills the node it started.
# Local node only. The keys below are the PUBLIC Hardhat test keys (accounts #0, #1) and only ever target 127.0.0.1.
# Flag --keep: after a successful run leave the fork node running and print the env for the web app.
# Env: RH_PORT (fork node port, default 8545; OUT dir gets a -<port> suffix when not 8545), BUY_USDG (per basket, default 1000), MIN_HARVEST_WIF (keeper threshold, default: keeper default),
#      RH_RPC_URL (fork source, default the public RPC), SKIP_STRETCH=1.
set -uo pipefail
KEEP=0
for a in "$@"; do case "$a" in --keep) KEEP=1;; *) echo "unknown argument: $a"; exit 2;; esac; done
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null
nvm use 24 >/dev/null

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${RH_PORT:-8545}"
OUT=/tmp/flatpack-rehearsal; [ "$PORT" = 8545 ] || OUT=/tmp/flatpack-rehearsal-$PORT
RPC=http://127.0.0.1:$PORT
export REHEARSAL_RPC="$RPC" RH_PORT="$PORT"
export RH_RPC_URL="${RH_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
export REHEARSAL_STATE="$OUT/state.json"
ID=rehearsal; [ "$PORT" = 8545 ] || ID=rehearsal-$PORT   # per-port artifacts so parallel rehearsals do not clobber each other
export DEPLOYMENT="$ROOT/shared/deployments/$ID.json"
export FLATPACK_DEPLOYMENT="$DEPLOYMENT"
KEEPER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d # Hardhat account #1 (public test key)
KEEPER_ADDR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
BUY_USDG="${BUY_USDG:-1000}"

rm -rf "$OUT"; mkdir -p "$OUT"
NODE_PID=""
cleanup() {
  if [ "${KEEP_NODE:-0}" = 1 ]; then return; fi
  if [ -n "$NODE_PID" ]; then kill "$NODE_PID" 2>/dev/null; sleep 1; kill -9 "$NODE_PID" 2>/dev/null; fi
  pkill -f "hardhat node.*--port $PORT( |\$)" 2>/dev/null
}
trap cleanup EXIT INT TERM

FAILED=0
step() { echo; echo "=== $* ==="; }
fail() { echo "STEP FAILED: $*"; FAILED=1; }
rpc_call() { curl -s -X POST -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}" "$RPC"; }

cd "$ROOT/contracts"
rm -rf "ignition/deployments/$ID" "$DEPLOYMENT"

# ---------------------------------------------------------------- 1. node
step "1. start the fork node (chain id 4663)"
pkill -f "hardhat node.*--port $PORT( |\$)" 2>/dev/null; sleep 1
setsid nohup npx hardhat node --fork "$RH_RPC_URL" --chain-id 4663 --hostname 127.0.0.1 --port "$PORT" > "$OUT/node.log" 2>&1 &
NODE_PID=$!
for _ in $(seq 1 90); do
  r=$(rpc_call eth_chainId); case "$r" in *result*) break;; esac; sleep 1
done
echo "eth_chainId -> $r"
case "$r" in *0x1237*) ;; *) fail "node did not come up with chain id 4663"; exit 1;; esac
echo "fork head block: $(rpc_call eth_blockNumber)"

# ---------------------------------------------------------------- 2. params + deploy
step "2. params (owner = #0, keeper = #1) and Ignition deploy"
node scripts/params.ts --rehearsal --name "$ID" || { fail params; exit 1; }
printf 'y\n' | npx hardhat ignition deploy ignition/modules/Flatpack.ts --network rehearsal \
  --parameters "ignition/parameters/$ID.json" --deployment-id "$ID" 2>&1 | tee "$OUT/deploy.log" | tail -40
[ -f "ignition/deployments/$ID/deployed_addresses.json" ] || { fail "deploy"; exit 1; }

# ---------------------------------------------------------------- 3. smoke
step "3. smoke check against the local node"
RH_RPC_URL=$RPC node scripts/smoke.ts --params "ignition/parameters/$ID.json" \
  --addresses "ignition/deployments/$ID/deployed_addresses.json" 2>&1 | tee "$OUT/smoke.log" | tail -15
[ "${PIPESTATUS[0]}" = 0 ] || fail "smoke"

# ---------------------------------------------------------------- 4. export
step "4. export deployment -> shared/deployments/$ID.json"
node scripts/export-deployment.ts --deployment-id "$ID" --out "$ID" || { fail export; exit 1; }
cat "$DEPLOYMENT"

# ---------------------------------------------------------------- 5. fund, demo baskets, buys
step "5. fund #0, create demo baskets, buy (referrer on basket 2)"
node scripts/rehearsal/steps.ts fund || { fail fund; exit 1; }
npx hardhat run scripts/demo-baskets.ts --network rehearsal 2>&1 | tee "$OUT/demo.log" | tail -10
node scripts/rehearsal/steps.ts buy "$BUY_USDG" 2>&1 | tee "$OUT/buy.log" || { fail buy; exit 1; }
node scripts/rehearsal/steps.ts snapshot pre

keeper() { # keeper <name> [--dry-run]
  local name=$1; shift
  ( cd "$ROOT/keeper" && RPC_URL=$RPC DEPLOYMENT="$DEPLOYMENT" KEEPER_PRIVATE_KEY=$KEEPER_KEY \
      node src/tick.ts "$@" ) 2>&1 | tee "$OUT/keeper-$name.log"
  return "${PIPESTATUS[0]}"
}

# ---------------------------------------------------------------- 6. keeper dry-run
step "6. keeper --dry-run (no key needed: harvester.keeper() is used for simulation)"
( cd "$ROOT/keeper" && RPC_URL=$RPC DEPLOYMENT="$DEPLOYMENT" node src/tick.ts --dry-run ) 2>&1 | tee "$OUT/keeper-dry.log"
[ "${PIPESTATUS[0]}" = 0 ] || fail "keeper dry-run exited non-zero"
grep -c '"action":"harvestFees"' "$OUT/keeper-dry.log" | sed 's/^/harvestFees result lines: /'

# ---------------------------------------------------------------- 7. keeper real tick
step "7. keeper real tick (harvestFees)"
keeper harvest || fail "keeper harvest tick exited non-zero"
node scripts/rehearsal/steps.ts assert-harvest || fail "assert-harvest"

# ---------------------------------------------------------------- 8. time travel + settle
step "8. time travel past nextSettleAt, keeper settles"
node scripts/rehearsal/steps.ts snapshot pre_settle
node scripts/rehearsal/steps.ts warp
keeper settle || fail "keeper settle tick exited non-zero"
node scripts/rehearsal/steps.ts assert-settle || fail "assert-settle"

# ---------------------------------------------------------------- 9. stretch: dividend
if [ "${SKIP_STRETCH:-0}" != 1 ]; then
  step "9. (stretch) simulate an AAPL dividend, keeper syncs then harvests dividends"
  node scripts/rehearsal/steps.ts snapshot pre_dividend
  if node scripts/rehearsal/steps.ts bump-dividend 10; then
    keeper dividend1 || fail "keeper dividend tick 1"
    keeper dividend2 || fail "keeper dividend tick 2"
    node scripts/rehearsal/steps.ts assert-dividend || fail "assert-dividend"
  else
    echo "STRETCH SKIPPED: could not locate the AAPL uiMultiplier storage slot"
  fi
fi

# ---------------------------------------------------------------- 10. idle tick
step "10. idle tick (must plan nothing)"
keeper idle || fail "keeper idle tick exited non-zero"
if grep -q '"msg":"plan".*"actions":\[\]' "$OUT/keeper-idle.log"; then echo "PASS  idle tick planned 0 actions"; else fail "idle tick planned actions"; fi

# ---------------------------------------------------------------- gas
step "gas per keeper action"
GASLOGS=()
for f in harvest settle dividend1 dividend2; do [ -f "$OUT/keeper-$f.log" ] && GASLOGS+=("$OUT/keeper-$f.log"); done
node scripts/rehearsal/steps.ts gas "${GASLOGS[@]}" | tee "$OUT/gas.log"

echo
if [ "$FAILED" = 0 ]; then echo "REHEARSAL OK"; else echo "REHEARSAL HAD FAILURES"; fi
if [ "$KEEP" = 1 ] && [ "$FAILED" = 0 ]; then
  KEEP_NODE=1
  echo "fork node left running (port $PORT). Stop it with: pkill -f 'hardhat node.*--port $PORT'"
  echo "NEXT_PUBLIC_DEPLOYMENT=$ID NEXT_PUBLIC_RPC_URL=$RPC"
fi
exit "$FAILED"
