// Lookup-only chains (Arbitrum, Optimism, Polygon, Avalanche C-Chain): route table, config sanity, copycat flag, plus live RPC checks.
// Run: node --test tests/
import test from "node:test"; import assert from "node:assert/strict";
import { getAddress } from "viem";
process.env.NO_LISTEN = "1";
const { CHAINS, CORE_CHAINS, LOOKUP_ONLY_CHAINS, approvals, inspect, contractRisk, explain, gasSnapshot } = await import("../lib.js");
const { impersonation, OFFICIAL_ADDRESSES } = await import("../impersonation.js");
const app = (await import("../server.js")).default;
const NEW = ["arbitrum", "optimism", "polygon", "avalanche"], FAKE = "0x1234567890abcdef1234567890abcdef12345678";
const withServer = async fn => { const s = app.listen(0); await new Promise(r => s.once("listening", r)); try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); } };

test("new chains are lookup-only; core chains unchanged", () => {
  assert.deepEqual(LOOKUP_ONLY_CHAINS, NEW); assert.deepEqual(CORE_CHAINS, ["base", "ethereum", "bsc"]);
  assert.deepEqual(NEW.map(c => CHAINS[c].chainId), [42161, 10, 137, 43114]);
  assert.deepEqual(NEW.map(c => CHAINS[c].native), ["ETH", "ETH", "POL", "AVAX"]);
});
test("token and spender addresses are valid checksummed; every approval-checked token is exempt from the copycat flag", () => {
  for (const c of NEW) { const C = CHAINS[c];
    assert.equal(Object.keys(C.tokens).length, 8, c); assert.ok(Object.keys(C.spenders).length >= 8, c);
    for (const [k, [a, d]] of Object.entries(C.tokens)) { assert.equal(getAddress(a), a, `${c} ${k}`); assert.ok([6, 8, 18].includes(d)); if (k !== "JOE" && k !== "LINK") assert.ok(OFFICIAL_ADDRESSES[c].has(a.toLowerCase()), `${c} ${k} official`); }
    for (const [k, a] of Object.entries(C.spenders)) assert.equal(getAddress(a), a, `${c} ${k}`); }
});
test("route table: 4 paid lookups per new chain at $0.005, descriptions <= 500 chars, 402 on bare request", async () => {
  await withServer(async base => {
    const h = await (await fetch(base + "/health")).json();
    for (const e of h.endpoints) assert.ok(e.description.length <= 500, e.url);
    for (const c of NEW) for (const p of ["tx", "approvals", "address", "contract-risk"]) {
      const e = h.endpoints.find(x => x.url.includes(`/v1/${c}/${p}?`)); assert.ok(e, `${c}/${p}`); assert.equal(e.price, "$0.005");
      const r = await fetch(`${base}/v1/${c}/${p}`); assert.equal(r.status, 402, `${c}/${p}`);
      const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString()); assert.equal(req.accepts[0].amount, "5000"); }
    // Existing chains keep their prices.
    assert.equal(h.endpoints.find(x => x.url.includes("/v1/base/tx?")).price, "$0.01");
    const bad = await fetch(`${base}/v1/polygon/address?address=0x123`); assert.equal(bad.status, 400);
    const html = await (await fetch(base + "/", { headers: { accept: "text/html" } })).text();
    for (const n of ["Arbitrum", "Optimism", "Polygon", "Avalanche"]) assert.ok(html.includes(`<span>${n}</span>`), n);
  });
});
test("copycat flag: chain-specific majors only on their home chain; fakes flagged, officials not", () => {
  assert.equal(impersonation("arbitrum", FAKE, { symbol: "ARB", name: "Arbitrum" }).copies, "ARB");
  assert.equal(impersonation("optimism", FAKE, { symbol: "OP" }).copies, "OP");
  assert.equal(impersonation("polygon", FAKE, { name: "Wrapped Matic", symbol: "WMATIC" }).copies, "WMATIC");
  assert.equal(impersonation("avalanche", FAKE, { name: "Avalanche", symbol: "AVAX" }).copies, "AVAX");
  assert.equal(impersonation("avalanche", FAKE, { symbol: "USDC.e" }), null); // "USDCE" isn't a major symbol...
  assert.equal(impersonation("avalanche", FAKE, { symbol: "x", name: "USD Coin" }).copies, "USDC"); // ...but the name still is
  assert.equal(impersonation("bsc", FAKE, { symbol: "AVAX" }), null); assert.equal(impersonation("base", FAKE, { symbol: "ARB" }), null);
  assert.equal(impersonation("polygon", "0x0000000000000000000000000000000000001010", { symbol: "POL" }), null);
  assert.ok(impersonation("polygon", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", { symbol: "USDC" })); // Arbitrum USDC address is not Polygon's
});
test("live: approvals, address, contract-risk and tx on every new chain", { timeout: 120000 }, async () => {
  for (const c of NEW) { const C = CHAINS[c], usdc = C.tokens.USDC[0];
    const a = await approvals(c, "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717"); assert.equal(a.failedReads, 0, c); assert.equal(a.checkedPairs, 8 * Object.keys(C.spenders).length);
    const i = await inspect(c, usdc); assert.equal(i.type, "contract"); assert.equal(i.erc20.symbol, "USDC"); assert.equal(i.copycat.flagged, false); assert.equal(i.nativeSymbol, C.native);
    const r = await contractRisk(c, usdc); assert.equal(r.isContract, true); assert.equal(r.copycat.flagged, false); assert.ok(r.proxy, `${c} USDC is a proxy`);
    assert.ok(!r.findings.some(f => /copies a major token/.test(f.note)));
  }
  const tx = await explain("arbitrum", "0x53869f15db3a9d9cf8dd05c7b5898a3b6df3866f25bebe4aa2e2f530e31d4f52"); assert.equal(tx.chainId, 42161); assert.ok(tx.tokenTransfers.length >= 1);
  const g = await gasSnapshot("all"); assert.deepEqual(g.chains.map(x => x.chain), CORE_CHAINS); // multi-chain tools stay on the core three
});
