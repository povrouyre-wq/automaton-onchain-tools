// Solana USDC is a second x402 exact accept only when SOLANA_PAY_TO is a Solana address.
// Base stays accepts[0]. feePayer is copied from the facilitator's /supported kind, not hardcoded.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

const SOL_NET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FEE = "So11111111111111111111111111111111111111112";
const PAY = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_PAY = "0x679af3a893edd0aef4ac4c7776ba581b238c0717";

if (process.env.SOLANA_PAY_CHILD === "1") {
  const { default: app } = await import("../server.js");
  const srv = app.listen(0);
  await once(srv, "listening");
  process.stdout.write(`READY ${srv.address().port}\n`);
  await new Promise(() => {});
}

function facilitator({ delay = 0 } = {}) {
  const fac = http.createServer((req, res) => {
    if (!String(req.url || "").startsWith("/supported")) { res.statusCode = 404; res.end("no"); return; }
    const body = JSON.stringify({
      kinds: [
        { x402Version: 2, scheme: "exact", network: "eip155:8453" },
        { x402Version: 2, scheme: "exact", network: SOL_NET, extra: { feePayer: FEE } },
      ],
      extensions: [],
      signers: {},
    });
    setTimeout(() => { res.setHeader("content-type", "application/json"); res.end(body); }, delay);
  });
  return new Promise(resolve => fac.listen(0, "127.0.0.1", () => resolve(fac)));
}

async function startApp(fac, env) {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname], {
    env: {
      ...process.env,
      SOLANA_PAY_CHILD: "1",
      NO_LISTEN: "1",
      X402_NETWORK: "eip155:8453",
      FACILITATOR_URL: `http://127.0.0.1:${fac.address().port}`,
      SUPPORTED_WAIT_MS: "2000",
      SOLANA_PAY_TO: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "", err = "";
  const port = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(t); fn(value); };
    const t = setTimeout(() => { child.kill(); finish(reject, new Error(`child did not start\n${out}\n${err}`)); }, 20000);
    child.stdout.on("data", d => { out += d; const m = out.match(/READY (\d+)/); if (m) finish(resolve, m[1]); });
    child.stderr.on("data", d => { err += d; });
    child.on("exit", code => finish(reject, new Error(`child exited ${code}\n${out}\n${err}`)));
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => child.kill(), logs: () => err };
}

const pay = async url => {
  const r = await fetch(url);
  assert.equal(r.status, 402, url);
  return JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString());
};

test("SOLANA_PAY_TO unset: 402 lists only Base, even if the facilitator advertises Solana", { timeout: 30000 }, async () => {
  const fac = await facilitator();
  const app = await startApp(fac, { SOLANA_PAY_TO: "" });
  try {
    const req = await pay(app.base + "/v1/gas");
    assert.equal(req.accepts.length, 1);
    const a = req.accepts[0];
    assert.equal(a.scheme, "exact");
    assert.equal(a.network, "eip155:8453");
    assert.equal(a.amount, "5000");
    assert.equal(a.asset, BASE_USDC);
    assert.equal(a.payTo.toLowerCase(), BASE_PAY);
    assert.deepEqual(a.extra, { name: "USD Coin", version: "2" });
    assert.ok(req.extensions?.bazaar);
    const o = await (await fetch(app.base + "/openapi.json")).json();
    assert.equal(o.info.version, "1.20.0");
    assert.match(o.info.description, /^Pay-per-call utilities via x402 \(USDC on Base\):/);
    assert.equal(o.info["x-guidance"].includes(SOL_NET), false);
    assert.equal(o.paths["/v1/gas"].get["x-payment-info"].networks, undefined);
    const health = await (await fetch(app.base + "/health")).json();
    assert.equal(health.solanaPayTo, undefined);
    assert.equal(health.network, "eip155:8453");
    const html = await (await fetch(app.base + "/check")).text();
    assert.equal(html.includes(SOL_NET), false);
    assert.match(html, /in USDC on Base</);
    const llms = await (await fetch(app.base + "/llms.txt")).text();
    assert.match(llms, /USDC on Base \(eip155:8453\), payTo 0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717\./);
    assert.equal(llms.includes(SOL_NET), false);
    const card = await (await fetch(app.base + "/.well-known/agent-card.json")).json();
    assert.equal(card["x-x402"].networks, undefined);
    assert.equal(card["x-x402"].network, "eip155:8453");
    const reg = await (await fetch(app.base + "/.well-known/agent-registration.json")).json();
    assert.equal(reg.endpoints[0].networks, undefined);
    assert.equal(reg.endpoints[0].network, "eip155:8453");
    assert.equal(reg.services.some(s => s.name === "agentWalletSolana"), false);
  } finally { app.stop(); fac.close(); }
});

test("SOLANA_PAY_TO set: every sampled paid route lists Base then Solana USDC, with the facilitator's feePayer", { timeout: 30000 }, async () => {
  const fac = await facilitator();
  const app = await startApp(fac, { SOLANA_PAY_TO: PAY });
  try {
    const samples = [["/v1/gas", "5000"], ["/v1/base/tx", "10000"], ["/v1/base/verdict", "20000"], ["/v1/base/approvals/batch", "50000"], ["/v1/wallet-report", "250000"], ["/v1/token/deep-scan", "1500000"]];
    for (const [path, amount] of samples) {
      const req = await pay(app.base + path);
      assert.equal(req.accepts.length, 2, path);
      const [base, sol] = req.accepts;
      assert.equal(base.scheme, "exact");
      assert.equal(base.network, "eip155:8453");
      assert.equal(base.amount, amount, path);
      assert.equal(base.asset, BASE_USDC);
      assert.equal(base.payTo.toLowerCase(), BASE_PAY);
      assert.deepEqual(base.extra, { name: "USD Coin", version: "2" });
      assert.equal(sol.scheme, "exact");
      assert.equal(sol.network, SOL_NET);
      assert.equal(sol.amount, amount, path);
      assert.equal(sol.asset, USDC);
      assert.equal(sol.payTo, PAY);
      assert.equal(sol.extra.feePayer, FEE);
      assert.ok(req.extensions?.bazaar, path);
      assert.ok(req.resource.description.length <= 500);
    }
    const o = await (await fetch(app.base + "/openapi.json")).json();
    assert.equal(o.info.version, "1.20.0");
    assert.match(o.info.description, /USDC on Solana mainnet/);
    assert.match(o.info["x-guidance"], new RegExp(`eip155:8453 \\(default, first accepts entry\\) or ${SOL_NET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.deepEqual(o.paths["/v1/base/tx"].get["x-payment-info"].networks, ["eip155:8453", SOL_NET]);
    assert.equal(o.paths["/v1/base/tx"].get["x-payment-info"].price.amount, "0.01");
    const health = await (await fetch(app.base + "/health")).json();
    assert.equal(health.network, "eip155:8453");
    assert.equal(health.payTo.toLowerCase(), BASE_PAY);
    assert.equal(health.solanaNetwork, SOL_NET);
    assert.equal(health.solanaPayTo, PAY);
    const html = await (await fetch(app.base + "/check")).text();
    assert.match(html, /in USDC on Base or Solana/);
    assert.match(html, new RegExp(SOL_NET));
    assert.match(html, /this page still pays on Base/);
    const llms = await (await fetch(app.base + "/llms.txt")).text();
    assert.match(llms, new RegExp(`USDC on Solana \\(${SOL_NET}, payTo ${PAY}\\)`));
    assert.match(llms, /Base is the first accepts entry/);
    const card = await (await fetch(app.base + "/.well-known/agent-card.json")).json();
    assert.deepEqual(card["x-x402"].networks, ["eip155:8453", SOL_NET]);
    assert.equal(card["x-x402"].payTo.toLowerCase(), BASE_PAY);
    assert.equal(card["x-x402"].solanaPayTo, PAY);
    const home = await (await fetch(app.base + "/", { headers: { accept: "text/html" } })).text();
    assert.match(home, /USDC on Base or Solana/);
    assert.match(home, /network \(Base first, or Solana\)/);
    const reg = await (await fetch(app.base + "/.well-known/agent-registration.json")).json();
    assert.ok(reg.endpoints.every(e => e.network === "eip155:8453" && e.networks[0] === "eip155:8453" && e.networks[1] === SOL_NET));
    assert.ok(reg.services.some(s => s.name === "agentWalletSolana" && s.endpoint === `${SOL_NET}:${PAY}`));
    assert.match(reg.description, new RegExp(SOL_NET));
  } finally { app.stop(); fac.close(); }
});

test("invalid SOLANA_PAY_TO is ignored and the 402 stays Base-only", { timeout: 30000 }, async () => {
  const fac = await facilitator();
  const app = await startApp(fac, { SOLANA_PAY_TO: "not-a-solana-address" });
  try {
    const req = await pay(app.base + "/v1/base/tx");
    assert.equal(req.accepts.length, 1);
    assert.equal(req.accepts[0].network, "eip155:8453");
    assert.equal(req.accepts[0].amount, "10000");
  } finally { app.stop(); fac.close(); }
});

test("a late /supported response fills feePayer on the next 402 without dropping Base", { timeout: 30000 }, async () => {
  const fac = await facilitator({ delay: 700 });
  const app = await startApp(fac, { SOLANA_PAY_TO: PAY, SUPPORTED_WAIT_MS: "200" });
  try {
    const early = await pay(app.base + "/v1/base/tx");
    assert.equal(early.accepts.length, 2);
    assert.equal(early.accepts[0].network, "eip155:8453");
    assert.equal(early.accepts[0].amount, "10000");
    assert.deepEqual(early.accepts[0].extra, { name: "USD Coin", version: "2" });
    assert.equal(early.accepts[1].network, SOL_NET);
    assert.equal(early.accepts[1].amount, "10000");
    assert.equal(early.accepts[1].asset, USDC);
    assert.equal(early.accepts[1].payTo, PAY);
    assert.equal(early.accepts[1].extra?.feePayer, undefined);
    await new Promise(r => setTimeout(r, 1200));
    const late = await pay(app.base + "/v1/base/tx");
    assert.equal(late.accepts[0].network, "eip155:8453");
    assert.equal(late.accepts[1].extra.feePayer, FEE);
    assert.equal(late.accepts[1].amount, late.accepts[0].amount);
  } finally { app.stop(); fac.close(); }
});
