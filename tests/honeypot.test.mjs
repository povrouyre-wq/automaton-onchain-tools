// $0.01 honeypot check: verdicts, 402 + Bazaar metadata per chain, free 400 on bad input, live sells on 3 chains, synthetic honeypot + tax.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "fs";
import net from "node:net"; import { keccak256, toHex, pad } from "viem";
const sockets = new Set(); const hang = net.createServer(x => { sockets.add(x); x.on("error", () => {}); }); await new Promise(r => hang.listen(0, "127.0.0.1", r)); hang.unref();
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: `http://127.0.0.1:${hang.address().port}`, X402_NETWORK: "eip155:8453" });
const { default: app } = await import("../server.js");
const { verdict, honeypotCheck } = await import("../honeypot.js");
const { CHAINS } = await import("../lib.js");
const srv = app.listen(0); await new Promise(r => srv.once("listening", r)); srv.unref();
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); for (const x of sockets) x.destroy(); hang.close(); });
test("verdict thresholds", () => {
  assert.equal(verdict({ canSell: false, failedAt: "sell swap reverted" }).verdict, "honeypot");
  assert.equal(verdict({ canSell: true, buyTaxPct: 0, sellTaxPct: 60 }).riskLevel, "critical");
  assert.equal(verdict({ canSell: true, buyTaxPct: 0, sellTaxPct: 10 }).verdict, "high tax");
  assert.equal(verdict({ canSell: true, buyTaxPct: 5, sellTaxPct: 5 }).verdict, "taxed");
  assert.equal(verdict({ canSell: true, buyTaxPct: 0, sellTaxPct: 0 }).verdict, "sellable");
});
for (const c of ["base", "ethereum", "bsc"]) test(`402 for /v1/${c}/honeypot: $0.01 USDC on Base with Bazaar discovery; bad input is a free 400`, { timeout: 20000 }, async () => {
  const r = await fetch(`${BASE}/v1/${c}/honeypot`); assert.equal(r.status, 402);
  const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString()); const a = req.accepts[0];
  assert.equal(a.amount, "10000"); assert.equal(a.network, "eip155:8453"); assert.ok(req.extensions?.bazaar?.info?.input); assert.ok(req.resource.description.length <= 500);
  assert.equal((await fetch(`${BASE}/v1/${c}/honeypot?token=0x123`)).status, 400);
  const o = await (await fetch(BASE + "/openapi.json")).json(); assert.ok(o.paths[`/v1/${c}/honeypot`]); assert.equal(o.info.version, "1.15.0");
});
const LIVE = { base: "0x532f27101965dd16442E59d40670FaF5eBB142E4", ethereum: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", bsc: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" };
for (const [c, t] of Object.entries(LIVE)) test(`live ${c}: blue-chip meme is sellable with ~0 tax`, { timeout: 40000 }, async () => {
  const r = await honeypotCheck(c, t); console.log(`  ${c}: ${r.summary}`);
  assert.equal(r.type, "honeypot-check"); assert.equal(r.sellable, true); assert.ok(r.buyTaxPct < 1 && r.sellTaxPct < 1); assert.ok(r.pool.address); assert.ok(r.coverage.notes.length);
});
test("not a contract -> 404 (not charged)", { timeout: 20000 }, async () => {
  await assert.rejects(honeypotCheck("base", "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717"), e => e.status === 404);
});
// Synthetic honeypot: CAKE wrapped so sells to its V2 pair revert (mode 1) or pay a 10% tax (mode 2).
const hpOverrides = async mode => { const token = LIVE.bsc, IMPL = "0x5130000000000000000000000000000000009999", code = await CHAINS.bsc.rpc.getCode({ address: token });
  const hp = JSON.parse(readFileSync(new URL("./hpwrap-code.json", import.meta.url)));
  return p => p.kind === "v2" ? { [IMPL]: { code }, [token]: { code: hp, stateDiff: { [keccak256(toHex("hpwrap.pair"))]: pad(p.address), [keccak256(toHex("hpwrap.impl"))]: pad(IMPL), [keccak256(toHex("hpwrap.mode"))]: pad(toHex(mode)) } } } : {}; };
test("synthetic honeypot on BNB -> sellable false, verdict honeypot", { timeout: 40000 }, async () => {
  const r = await honeypotCheck("bsc", LIVE.bsc, { overrides: await hpOverrides(1) }); console.log("  synthetic:", r.summary);
  assert.equal(r.sellable, false); assert.equal(r.verdict, "honeypot"); assert.equal(r.riskLevel, "critical");
});
test("synthetic 10% sell tax on BNB -> high tax", { timeout: 40000 }, async () => {
  const r = await honeypotCheck("bsc", LIVE.bsc, { overrides: await hpOverrides(2) });
  assert.equal(r.sellable, true); assert.ok(Math.abs(r.sellTaxPct - 10) < 0.01); assert.equal(r.verdict, "high tax");
});
