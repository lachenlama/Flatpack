#!/usr/bin/env bash
# One command for the local demo: fork node + deploy + demo baskets + fund mock wallet + web app + warm-up.
#   bash tools/demo.sh             start (stops any previous demo first)
#   bash tools/demo.sh --rebuild   same, but rebuild the web app first (after web code changes)
#   bash tools/demo.sh --stop      stop the fork node, the web app and any warm-up
# Why: the fork reads state lazily from its source RPC. The public RPC only serves that state for ~10 minutes after the node starts,
# so this script keeps the setup short (rehearse --fast) and warms every page and buy path before that window ends.
# With an archive-capable RPC in ~/.flatpack.env (RH_RPC_URL=...; kept outside the repo because the URL is a secret) the fork
# does not expire at all, and the warm-up is only a speed-up.
# Local only: the mock wallet build (NEXT_PUBLIC_E2E=1) must never be deployed.
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null
nvm use 24 >/dev/null
# shellcheck disable=SC1091
[ -f "$HOME/.flatpack.env" ] && . "$HOME/.flatpack.env"
if [ -n "${RH_RPC_URL:-}" ]; then FORK_SRC="private RPC from ~/.flatpack.env (no 10-minute limit)"; else FORK_SRC="public RPC (state expires ~10 minutes after start)"; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8545
APP_PORT=3000
export NEXT_PUBLIC_E2E=1 NEXT_PUBLIC_DEPLOYMENT=rehearsal NEXT_PUBLIC_RPC_URL=http://127.0.0.1:$PORT

port_busy() { ss -ltn | grep -qE "[:.]$1 "; }

# Patterns use the [x]yz trick so they never match this shell's own command line. `next start` renames itself to `next-server`.
stop_all() {
  pkill -f "[w]arm-demo" 2>/dev/null
  pkill -f "[n]ext-server" 2>/dev/null
  pkill -f "[n]ext start" 2>/dev/null
  pkill -f "[h]ardhat node.*--port $PORT" 2>/dev/null
  for _ in $(seq 1 20); do
    port_busy $APP_PORT || port_busy $PORT || return 0
    sleep 0.5
  done
  pkill -9 -f "[n]ext-server" 2>/dev/null
  pkill -9 -f "[h]ardhat node.*--port $PORT" 2>/dev/null
  sleep 1
  if port_busy $APP_PORT || port_busy $PORT; then
    echo "Could not free port $APP_PORT or $PORT. Something else is using it:"; ss -ltnp | grep -E "[:.]($APP_PORT|$PORT) "
    return 1
  fi
}

case "${1:-}" in
  --stop) stop_all && echo "demo stopped (ports $APP_PORT and $PORT free)"; exit $?;;
  ""|--rebuild) ;;
  *) echo "unknown argument: $1 (use --rebuild or --stop)"; exit 2;;
esac

echo "== stop any previous demo"
stop_all || exit 1

echo "== fork node + deploy + demo baskets (fast rehearsal); fork source: $FORK_SRC"
START=$(date +%s)
RH_PORT=$PORT bash "$ROOT/tools/rehearse.sh" --keep --fast >/tmp/flatpack-demo-rehearsal.log 2>&1 || { tail -40 /tmp/flatpack-demo-rehearsal.log; echo "REHEARSAL FAILED (full log: /tmp/flatpack-demo-rehearsal.log)"; exit 1; }
echo "   rehearsal done after $(( $(date +%s) - START ))s"

cd "$ROOT/web"
# The build inlines shared/deployments/rehearsal.json (addresses AND the start block of every getLogs scan). The addresses repeat
# between rehearsals but the block does not: a stale build scans from an old block, which is slow on the public RPC and rejected
# by range-capped RPCs ("Block range is too large"). So rebuild whenever that file changed since the last build (or --rebuild).
# Runs before `next start`, never under a live server (it would keep serving pages whose client files no longer exist).
DEP_SUM=$(sha256sum "$ROOT/shared/deployments/rehearsal.json" | cut -d' ' -f1)
if [ ! -f .next/BUILD_ID ] || [ "${1:-}" = "--rebuild" ] || [ "$(cat .next/.demo-deployment 2>/dev/null)" != "$DEP_SUM" ]; then
  echo "== build web for this deployment (~1 min)"
  npm run build >/tmp/flatpack-web-build.log 2>&1 || { tail -30 /tmp/flatpack-web-build.log; echo "BUILD FAILED"; exit 1; }
  echo "$DEP_SUM" > .next/.demo-deployment
fi

echo "== fund mock wallet"
node e2e/fund-demo.ts || exit 1

echo "== start web app on :$APP_PORT"
setsid nohup npx next start -p $APP_PORT >/tmp/flatpack-web.log 2>&1 &
UP=0
for _ in $(seq 1 60); do
  if grep -q "EADDRINUSE\|Failed to start" /tmp/flatpack-web.log; then break; fi
  if curl -s -o /dev/null "http://localhost:$APP_PORT/proof"; then UP=1; break; fi
  sleep 1
done
if [ "$UP" != 1 ]; then cat /tmp/flatpack-web.log; echo "WEB APP DID NOT START"; exit 1; fi

echo "== warm up (loads the pages, simulates buys)"
node e2e/warm-demo.ts
WARM=$?
# The 30-day chart history (Chainlink round bisection) is thousands of cold reads that the fork node serves one at a time: ~4-5 min.
# Done BEFORE "READY" on purpose: while it runs every other request queues behind it, so clicking around then feels broken.
# A failure here is not fatal: the chart panel just shows "unavailable".
echo "== cache 30-day chart history (~4-5 min; do not open the app yet)"
node e2e/warm-demo.ts --charts || echo "   chart history incomplete: charts may show 'unavailable'; everything else works"

echo
echo "Fork age now: $(( $(date +%s) - START ))s. Fork source: $FORK_SRC."
if [ "$WARM" = 0 ]; then
  echo "READY  ->  open http://localhost:$APP_PORT  (Connect -> Mock Connector). The wallet has 5,000 USDG and a share costs roughly \$65-100, so buy tens of shares, not hundreds."
else
  echo "WARM-UP HAD PROBLEMS: the chain may already be stale. Run this script again."
fi
echo "Stop everything:  bash tools/demo.sh --stop"
