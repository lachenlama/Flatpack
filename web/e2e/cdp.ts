/**
 * Minimal Chrome DevTools Protocol driver for headless-browser e2e (no dependencies: Node 24 global fetch + WebSocket).
 * Works with Chrome or Edge. Run scripts with `node e2e/<file>.ts` (type stripping), on Windows or Linux.
 *
 *   const browser = await launchBrowser();
 *   const page = await browser.newPage("http://localhost:3000/e2e");
 *   await page.waitForText("disconnected");
 *   await page.clickText("button", "Connect");
 *   ...
 *   await browser.close();
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Json = Record<string, unknown>;

/** Candidate browser executables (override with CDP_BROWSER). */
const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** Sleep helper. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A page (tab) under CDP control. */
export class Page {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  /** console.* output and uncaught exceptions seen on the page, for debugging failed runs. */
  readonly logs: string[] = [];

  private ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Json; error?: { message: string }; method?: string; params?: Json };
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? {});
      } else if (msg.method === "Runtime.consoleAPICalled") {
        const args = (msg.params?.args as { value?: unknown; description?: string }[] | undefined) ?? [];
        this.logs.push(`[${String(msg.params?.type)}] ${args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = (msg.params?.exceptionDetails ?? {}) as { text?: string; exception?: { description?: string } };
        this.logs.push(`[exception] ${d.exception?.description ?? d.text ?? ""}`);
      }
    });
  }

  /** Sends a raw CDP command. */
  send(method: string, params: Json = {}): Promise<Json> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Enables the domains the helpers need. Called by `newPage`. */
  async init(): Promise<void> {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }

  /** Navigates and waits for `document.readyState === "complete"`. */
  async goto(url: string, timeoutMs = 60_000): Promise<void> {
    await this.send("Page.navigate", { url });
    await this.waitFor(`document.readyState === "complete" && location.href !== "about:blank"`, timeoutMs);
  }

  /** Evaluates a JS expression in the page (awaits promises) and returns its JSON value. */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = (await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })) as {
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? expression}`);
    return r.result?.value as T;
  }

  /** Polls a JS expression until it is truthy. Throws with the page logs on timeout. */
  async waitFor(expression: string, timeoutMs = 30_000, label = expression): Promise<void> {
    const end = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < end) {
      try {
        last = await this.eval(`Boolean(${expression})`);
        if (last === true) return;
      } catch {
        /* page navigating */
      }
      await sleep(150);
    }
    throw new Error(`timeout waiting for: ${label}\nvisible text: ${(await this.text().catch(() => "")).slice(0, 600)}\nlogs: ${this.logs.slice(-8).join(" | ")}`);
  }

  /** Visible page text (`document.body.innerText`). */
  text(): Promise<string> {
    return this.eval<string>("document.body.innerText");
  }

  /** Waits until the page text contains `needle`. */
  waitForText(needle: string, timeoutMs = 30_000): Promise<void> {
    return this.waitFor(`document.body.innerText.includes(${JSON.stringify(needle)})`, timeoutMs, `text "${needle}"`);
  }

  /** Clicks the first element matching `selector` whose text contains `text` (case-sensitive), waiting for it to appear and be enabled. */
  async clickText(selector: string, text: string, timeoutMs = 30_000): Promise<void> {
    const find = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)}) && !e.disabled)`;
    await this.waitFor(find, timeoutMs, `clickable ${selector} "${text}"`);
    await this.eval(`(${find}).click()`);
  }

  /** Clicks the first element matching a CSS selector. */
  async click(selector: string, timeoutMs = 30_000): Promise<void> {
    await this.waitFor(`document.querySelector(${JSON.stringify(selector)})`, timeoutMs, `selector ${selector}`);
    await this.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }

  /** Sets an input's value the React way (native setter + input event). */
  async type(selector: string, value: string): Promise<void> {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
      set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
  }

  /** Saves a PNG screenshot. */
  async screenshot(path: string): Promise<void> {
    const r = (await this.send("Page.captureScreenshot", { format: "png" })) as { data: string };
    writeFileSync(path, Buffer.from(r.data, "base64"));
  }
}

/** A launched (or attached) browser. */
export class Browser {
  private port: number;
  private proc?: ChildProcess;
  private userDataDir?: string;

  constructor(port: number, proc?: ChildProcess, userDataDir?: string) {
    this.port = port;
    this.proc = proc;
    this.userDataDir = userDataDir;
  }

  /** Opens a new tab at `url` and returns a controllable {@link Page}. */
  async newPage(url?: string): Promise<Page> {
    const r = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: "PUT" });
    const t = (await r.json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise<void>((res, rej) => {
      ws.addEventListener("open", () => res());
      ws.addEventListener("error", () => rej(new Error("CDP websocket error")));
    });
    const page = new Page(ws);
    await page.init();
    if (url) await page.goto(url);
    return page;
  }

  /** Closes the browser (if launched by us) and removes its temp profile. */
  async close(): Promise<void> {
    this.proc?.kill();
    await sleep(500);
    if (this.userDataDir) {
      try {
        rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {
        /* profile still locked: harmless temp dir */
      }
    }
  }
}

/** Options of {@link launchBrowser}. */
export interface LaunchOptions {
  /** Executable path (default: CDP_BROWSER env, else first existing of Edge/Chrome/Chromium). */
  exe?: string;
  /** Remote debugging port (default CDP_PORT env or 9222). */
  port?: number;
  /** Default true. */
  headless?: boolean;
  /** Extra browser flags. */
  args?: string[];
}

/** Launches headless Chrome/Edge with a throwaway profile and waits for the DevTools endpoint. */
export async function launchBrowser(opts: LaunchOptions = {}): Promise<Browser> {
  const exe = opts.exe ?? process.env.CDP_BROWSER ?? CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("No Chrome/Edge found. Set CDP_BROWSER to the executable path.");
  const port = opts.port ?? Number(process.env.CDP_PORT ?? 9222);
  const userDataDir = mkdtempSync(join(tmpdir(), "flatpack-cdp-"));
  const proc = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      ...(opts.headless === false ? [] : ["--headless=new"]),
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
      ...(opts.args ?? []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return new Browser(port, proc, userDataDir);
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  proc.kill();
  throw new Error(`browser DevTools endpoint did not come up on port ${port}`);
}

/** JSON-RPC call to a node (used to assert on-chain effects). */
export async function rpc<T = unknown>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}
