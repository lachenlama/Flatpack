#!/usr/bin/env bash
# Runs a command inside WSL from web/, with Node 24 (via nvm) on PATH.
# From Windows Git Bash:
#   MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run-keeper.sh npm test
#   MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /home/bytemycode/wif/tools/run-web.sh npm run build
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null
nvm use 24 >/dev/null
export RH_RPC_URL="${RH_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
cd "$(dirname "$0")/../web"
exec "$@"
