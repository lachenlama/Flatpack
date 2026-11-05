# Headless-browser e2e (CDP)

Dependency-free driver (`cdp.ts`) for Chrome/Edge over the DevTools Protocol, plus the write-path proof (`tx-e2e.ts`).

## API (`cdp.ts`)
- `launchBrowser({exe?, port?, headless?, args?}) -> Browser` (Edge/Chrome auto-detected; override `CDP_BROWSER`, `CDP_PORT`)
- `browser.newPage(url?) -> Page`, `browser.close()`
- `Page`: `goto(url)`, `eval(js)`, `waitFor(jsExpr, ms)`, `text()`, `waitForText(s, ms)`, `clickText(cssSelector, text)`, `click(css)`, `type(css, value)`, `screenshot(path)`, `logs` (console + exceptions)
- `rpc(url, method, params)` for on-chain assertions; `sleep(ms)`

## Run (needs Node 24 for type stripping and global `WebSocket`)
1. Start the node + deploy: `RH_PORT=8545 tools/rehearse.sh --keep` (prints the env line).
2. Build and start the app with the mock wallet, from `web/`:
   `NEXT_PUBLIC_E2E=1 NEXT_PUBLIC_DEPLOYMENT=rehearsal NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 NEXT_DIST_DIR=.next-b npm run build`
   then `NEXT_DIST_DIR=.next-b npx next start -p 3000`.
3. `node e2e/tx-e2e.ts` (set `APP_URL`, `RPC_URL`, `CDP_BROWSER` as needed).

Under WSL there is no browser: run step 3 with **Windows** Node (`node.exe`, Edge is detected at its default path). The app on WSL
localhost and the node on 8545 are reachable from Windows via localhost forwarding.

## Mock wallet guard
`NEXT_PUBLIC_E2E=1` adds wagmi's `mock` connector (Hardhat account #3, address only: the local node signs unlocked accounts) and
enables the `/e2e` test page. `lib/e2e.ts` THROWS if the flag is set with a non-local RPC or a non-localhost origin, so it cannot
ship in a real build. Never set it for production.

## Writing a flow for WP5b/WP5c
Connect with `clickText("button","Connect")` then `clickText("dialog button","Mock Connector")`. Account #3 has ETH on the fork but no
USDG/WIF: fund it first with `anvil_setBalance`-style cheats or by transferring from #0 with `eth_sendTransaction` (the node has all
Hardhat accounts unlocked). Assert toasts with `waitForText("... confirmed")` and chain effects with `rpc(...)`.
