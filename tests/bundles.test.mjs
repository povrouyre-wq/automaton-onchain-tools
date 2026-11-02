// BNB Chain bundle + sniper check: verdict scoring, 402 + Bazaar metadata, free 400 on bad input, live run on a bundled launch.
import test from "node:test"; import assert from "node:assert/strict";
import net from "node:net";
const sockets = new Set(); const hang = net.createServer(x => { sockets.add(x); x.on("error", () => {}); }); await new Promise(r => hang.listen(0, "127.0.0.1", r)); hang.unref();
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: `http://127.0.0.1:${hang.address().port}`, X402_NETWORK: "eip155:8453" });
const { default: app } = await import("../server.js");
const { verdict, bscBundles } = await import("../bundles.js");
const srv = app.listen(0); await new Promise(r => srv.once("listening", r)); srv.unref();
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); for (const x of sockets) x.destroy(); hang.close(); });
test("verdict: big dev-linked bundle is high, tiny dev buy is low", () => {
  assert.equal(verdict({ clusterPct: 40, holdPct: 25, devInCluster: true, bundledTxs: 1 }).riskLevel, "high");
  assert.equal(verdict({ clusterPct: 0.01, holdPct: 0, devInCluster: true, bundledTxs: 0 }).riskLevel, "low");
  assert.equal(verdict({ clusterPct: 12, holdPct: 1, devInCluster: false, bundledTxs: 0 }).riskLevel, "medium");
});
test("402 for /v1/bsc/bundles: $0.01 USDC on Base with Bazaar discovery; bad input is a free 400", { timeout: 20000 }, async () => {
  const r = await fetch(BASE + "/v1/bsc/bundles"); assert.equal(r.status, 402);
  const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString()); const a = req.accepts[0];
  assert.equal(a.amount, "10000"); assert.equal(a.network, "eip155:8453"); assert.ok(req.extensions?.bazaar?.info?.input); assert.ok(req.resource.description.length <= 500);
  assert.equal((await fetch(BASE + "/v1/bsc/bundles?token=0x123")).status, 400);
  const o = await (await fetch(BASE + "/openapi.json")).json(); assert.ok(o.paths["/v1/bsc/bundles"]);
});
test("live: returns a cluster, coverage and verdict for a recent four.meme launch (or a clear 404 if it aged out of free RPC range)", { timeout: 60000 }, async () => {
  try { const r = await bscBundles("0x1efbd1942871353b854f84fcccba240544d9ffff"); assert.equal(r.type, "bsc-bundle-check"); assert.ok(r.coverage.firstBlocksWindow); assert.ok(["low", "medium", "high"].includes(r.riskLevel)); }
  catch (e) { assert.ok([404, 502].includes(e.status), e.message); }
});
