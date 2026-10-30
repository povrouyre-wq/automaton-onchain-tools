// Regression (Oct 30 2026): unpaid requests must get their 402 fast even if the facilitator or an RPC hangs, and paid work is capped.
// A hanging TCP server stands in for the facilitator and for the first Arbitrum RPC. Run: node --test tests/
import test from "node:test"; import assert from "node:assert/strict";
import net from "node:net";
const sockets = new Set();
const hang = net.createServer(s => { sockets.add(s); s.on("error", () => {}); }); // accepts, never answers
await new Promise(r => hang.listen(0, "127.0.0.1", r)); hang.unref();
const HANG = `http://127.0.0.1:${hang.address().port}`;
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: HANG, X402_NETWORK: "eip155:8453", ARB_RPC: HANG, RPC_TIMEOUT_MS: "1500", ROUTE_DEADLINE_MS: "20000" });
const { default: app, withDeadline, SUPPORTED_FALLBACK } = await import("../server.js");
const { inspect, CHAINS } = await import("../lib.js");
const srv = app.listen(0); await new Promise(r => srv.once("listening", r)); srv.unref();
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); for (const s of sockets) s.destroy(); hang.close(); });

test("402 comes back fast while the facilitator hangs (cold start)", { timeout: 30000 }, async () => {
  for (const [path, amount] of [["/v1/arbitrum/address", "5000"], ["/v1/avalanche/address", "5000"], ["/v1/polygon/address", "5000"], ["/v1/optimism/tx", "5000"], ["/v1/base/tx", "10000"]]) {
    for (let i = 0; i < 2; i++) { const t = Date.now(); const r = await fetch(BASE + path); const ms = Date.now() - t;
      assert.equal(r.status, 402, path); assert.ok(ms < 4000, `${path} took ${ms} ms`);
      const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString()); const a = req.accepts[0];
      assert.equal(a.scheme, "exact"); assert.equal(a.network, "eip155:8453"); assert.equal(a.amount, amount);
      assert.equal(a.asset, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"); assert.equal(a.payTo.toLowerCase(), "0x679af3a893edd0aef4ac4c7776ba581b238c0717");
      assert.deepEqual(a.extra, { name: "USD Coin", version: "2" }); assert.ok(req.extensions?.bazaar, "bazaar discovery metadata still declared"); } }
  assert.deepEqual(SUPPORTED_FALLBACK.kinds, [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }]);
});
test("a hung RPC falls through to the next public RPC within the per-call timeout", { timeout: 60000 }, async () => {
  const t = Date.now(); const o = await inspect("arbitrum", CHAINS.arbitrum.tokens.USDC[0]); const ms = Date.now() - t;
  assert.equal(o.erc20.symbol, "USDC"); assert.ok(ms < 25000, `took ${ms} ms`);
});
test("withDeadline caps a stuck call with a 504 (never settled, so never charged)", async () => {
  const t = Date.now(); await assert.rejects(withDeadline(new Promise(() => {}), 300), e => e.status === 504); assert.ok(Date.now() - t < 1500);
  assert.equal(await withDeadline(Promise.resolve(7), 300), 7);
});
