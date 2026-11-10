// $0.02 quick token verdict: scoring thresholds, 402 + Bazaar metadata per chain, free 400 on bad input, live sells on 3 chains.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "fs";
import net from "node:net"; import { keccak256, toHex, pad } from "viem";
const sockets = new Set(); const hang = net.createServer(x => { sockets.add(x); x.on("error", () => {}); }); await new Promise(r => hang.listen(0, "127.0.0.1", r)); hang.unref();
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: `http://127.0.0.1:${hang.address().port}`, X402_NETWORK: "eip155:8453" });
const { default: app } = await import("../server.js");
const { scoreTokenVerdict, verdictSummary, tokenVerdict } = await import("../verdict.js");
const { CHAINS } = await import("../lib.js");
const srv = app.listen(0); await new Promise(r => srv.once("listening", r)); srv.unref();
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); for (const x of sockets) x.destroy(); hang.close(); });

const clean = { sellable: true, buyTaxPct: 0, sellTaxPct: 0, ownerRenounced: true, isProxy: false, canMint: false, canPause: false, canBlacklist: false, canChangeFees: false, lpBurnedOrLockedPct: 95, top10HolderPct: 10, copycatName: false };
const v = (patch) => scoreTokenVerdict({ ...clean, ...patch }).verdict;
test("verdict thresholds", () => {
  assert.equal(v({}), "SAFE");
  assert.equal(scoreTokenVerdict(clean).riskLevel, "low");
  assert.equal(v({ sellable: false, sellFail: "sell swap reverted" }), "AVOID");
  assert.equal(scoreTokenVerdict({ ...clean, sellable: false }).riskLevel, "critical");
  assert.equal(v({ buyTaxPct: 6, sellTaxPct: 4 }), "AVOID"); // sum, not max
  assert.equal(v({ buyTaxPct: 0, sellTaxPct: 9.99 }), "CAUTION");
  assert.equal(v({ buyTaxPct: 3, sellTaxPct: 0 }), "CAUTION");
  assert.equal(v({ buyTaxPct: 2.99, sellTaxPct: 0 }), "SAFE");
  assert.equal(scoreTokenVerdict({ ...clean, buyTaxPct: 40, sellTaxPct: 20 }).riskLevel, "critical");
  assert.equal(v({ ownerRenounced: false, canMint: true }), "AVOID");
  assert.equal(v({ ownerRenounced: false, canBlacklist: true }), "AVOID");
  assert.equal(v({ ownerRenounced: true, canMint: true, canBlacklist: true }), "SAFE");
  assert.equal(v({ ownerRenounced: false }), "SAFE");
  assert.equal(v({ ownerRenounced: false, canPause: true }), "CAUTION");
  assert.equal(v({ ownerRenounced: false, canChangeFees: true }), "CAUTION");
  assert.equal(v({ paused: true }), "CAUTION");
  assert.equal(v({ isProxy: true }), "CAUTION");
  assert.equal(v({ lpBurnedOrLockedPct: null }), "CAUTION");
  assert.equal(v({ lpBurnedOrLockedPct: 49.99 }), "CAUTION");
  assert.equal(v({ lpBurnedOrLockedPct: 50 }), "SAFE");
  assert.equal(v({ lpBurnedOrLockedPct: 80, lpUncertain: true }), "CAUTION");
  assert.equal(v({ top10HolderPct: 50 }), "AVOID");
  assert.equal(v({ top10HolderPct: 49.99 }), "CAUTION");
  assert.equal(v({ top10HolderPct: 20 }), "CAUTION");
  assert.equal(v({ top10HolderPct: 19.99 }), "SAFE");
  assert.equal(v({ top10HolderPct: null }), "SAFE");
  assert.equal(v({ top10Partial: true, top10HolderPct: 10 }), "CAUTION");
  assert.equal(v({ top10Partial: true, top10HolderPct: 55 }), "AVOID");
  assert.equal(v({ copycatName: true, copycatNote: "name copies a major token (USDC) but isn't the real contract" }), "AVOID");
  assert.equal(scoreTokenVerdict({ ...clean, copycatName: true }).riskLevel, "high");
  assert.equal(v({ contractRiskUnknown: true }), "CAUTION");
  const both = scoreTokenVerdict({ ...clean, copycatName: true, isProxy: true });
  assert.equal(both.verdict, "AVOID");
  assert.ok(both.findings.some(f => /proxy/i.test(f.note)));
  const line = verdictSummary("BRETT", "Base", scoreTokenVerdict(clean));
  assert.match(line, /^BRETT on Base: SAFE because simulated buy and sell both worked/);
  assert.equal(line.split(".").length, 2);
  assert.match(verdictSummary("BRETT", "Base", scoreTokenVerdict({ ...clean, lpBurnedOrLockedPct: null })), /because LP burn\/lock share could not be determined\.$/);
  assert.match(verdictSummary("X", "Base", scoreTokenVerdict({ ...clean, sellable: false })), /because not sellable:/);
  assert.match(verdictSummary("CAKE", "BNB Smart Chain", scoreTokenVerdict({ ...clean, ownerRenounced: false, canMint: true, ownerType: "contract (possibly multisig/timelock)" })), /because owner has not renounced \(a contract\) and the contract can mint new supply\.$/);
});

for (const c of ["base", "ethereum", "bsc"]) test(`402 for /v1/${c}/verdict: $0.02 USDC on Base with Bazaar discovery; bad input is a free 400`, { timeout: 20000 }, async () => {
  const r = await fetch(`${BASE}/v1/${c}/verdict`); assert.equal(r.status, 402);
  const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString()); const a = req.accepts[0];
  assert.equal(a.amount, "20000"); assert.equal(a.network, "eip155:8453"); assert.equal(a.payTo.toLowerCase(), "0x679af3a893edd0aef4ac4c7776ba581b238c0717");
  assert.ok(req.extensions?.bazaar?.info?.input); assert.match(req.resource.description, /^Use when: /); assert.ok(req.resource.description.length <= 500, String(req.resource.description.length));
  assert.equal((await fetch(`${BASE}/v1/${c}/verdict?token=0x123`)).status, 400);
  assert.equal((await fetch(`${BASE}/v1/${c}/verdict?token=0x123`)).headers.get("payment-required"), null);
  const o = await (await fetch(BASE + "/openapi.json")).json();
  assert.equal(o.paths[`/v1/${c}/verdict`].get.operationId, `${c}_token_verdict`);
  assert.equal(o.info.version, "1.14.0");
  assert.match(o.paths[`/v1/${c}/verdict`].get.description, /^Use when: /);
  const w = await (await fetch(BASE + "/.well-known/x402")).json();
  assert.ok(w.resources.some(u => u.endsWith(`/v1/${c}/verdict`)));
});

test("/check offers the quick verdict", async () => {
  const html = await (await fetch(BASE + "/check")).text();
  assert.match(html, /value="verdict"/);
  assert.match(html, /Quick verdict/);
  const js = await (await fetch(BASE + "/check/app.js")).text();
  assert.match(js, /\/verdict\?token=/);
});

const LIVE = { base: "0x532f27101965dd16442E59d40670FaF5eBB142E4", ethereum: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", bsc: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" };
const FLAG_KEYS = ["sellable", "buyTaxPct", "sellTaxPct", "ownerRenounced", "isProxy", "canMint", "canPause", "canBlacklist", "canChangeFees", "lpBurnedOrLockedPct", "top10HolderPct", "copycatName"];
for (const [c, t] of Object.entries(LIVE)) test(`live ${c}: known sellable token returns a verdict`, { timeout: 90000 }, async () => {
  const r = await tokenVerdict(c, t); console.log(`  ${c}: ${r.summary}`);
  assert.equal(r.type, "token-verdict"); assert.equal(r.chain, c); assert.equal(r.flags.sellable, true);
  assert.ok(r.flags.buyTaxPct < 1 && r.flags.sellTaxPct < 1); assert.equal(r.flags.copycatName, false);
  assert.ok(["SAFE", "CAUTION", "AVOID"].includes(r.verdict)); assert.ok(["low", "medium", "high", "critical"].includes(r.riskLevel));
  assert.match(r.summary, new RegExp(`: ${r.verdict} because .+\\.$`));
  for (const k of FLAG_KEYS) assert.ok(k in r.flags, k);
  assert.ok(Array.isArray(r.findings) && r.findings.length); assert.ok(Array.isArray(r.couldNotDetermine)); assert.ok(r.disclaimer);
  assert.equal(r.token.address.toLowerCase(), t.toLowerCase()); assert.ok(r.token.symbol);
});

test("not a contract -> 404 (not charged)", { timeout: 20000 }, async () => {
  await assert.rejects(tokenVerdict("base", "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717"), e => e.status === 404);
});
test("bad chain -> 400", async () => {
  await assert.rejects(tokenVerdict("solana", LIVE.base), e => e.status === 400);
});

const hpOverrides = async mode => { const token = LIVE.bsc, IMPL = "0x5130000000000000000000000000000000009999", code = await CHAINS.bsc.rpc.getCode({ address: token });
  const hp = JSON.parse(readFileSync(new URL("./hpwrap-code.json", import.meta.url)));
  return p => p.kind === "v2" ? { [IMPL]: { code }, [token]: { code: hp, stateDiff: { [keccak256(toHex("hpwrap.pair"))]: pad(p.address), [keccak256(toHex("hpwrap.impl"))]: pad(IMPL), [keccak256(toHex("hpwrap.mode"))]: pad(toHex(mode)) } } } : {}; };
test("synthetic honeypot on BNB -> AVOID, not sellable", { timeout: 90000 }, async () => {
  const r = await tokenVerdict("bsc", LIVE.bsc, { overrides: await hpOverrides(1) }); console.log("  synthetic:", r.summary);
  assert.equal(r.flags.sellable, false); assert.equal(r.verdict, "AVOID"); assert.equal(r.riskLevel, "critical");
});
