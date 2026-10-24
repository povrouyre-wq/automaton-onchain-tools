// Live tests against real tokens on public RPCs. Run: node --test tests/
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "fs";
import { keccak256, toHex, pad } from "viem";
import { deepScan, findPools, simulate, DEX } from "../deepscan.js";
import { CHAINS } from "../lib.js";
const show = (n, r) => console.log(`  ${n}: risk=${r.riskLevel} honeypot=${r.honeypot} buyTax=${r.honeypotSimulation?.buyTaxPct} sellTax=${r.honeypotSimulation?.sellTaxPct} pool=${r.liquidity?.mainPool?.dex} liqUsd=${r.liquidity?.mainPool?.approxTotalUsd} lp=${r.liquidity?.lp?.verdict ?? r.liquidity?.lp?.type} holders=${r.holders?.available ? (r.holders.partial ? "partial " : "") + r.holders.top10ExcludingPoolsAndBurnPct + "%" : "n/a"} ${r.elapsedMs}ms`);

test("DEX factories are real (native/stable pool exists on every configured factory)", async () => {
  for (const [chain, D] of Object.entries(DEX)) {
    const pools = await findPools(chain, D.stable[0]);
    for (const d of [...D.v2, ...D.v3]) assert.ok(pools.some(p => p.dex === d.name && p.quote.toLowerCase() === D.wnative.toLowerCase()), `${chain} ${d.name} has no WNATIVE/${D.stable[2]} pool`);
  }
});
test("Base USDC: sellable, ~0 tax, admin powers flagged", async () => {
  const r = await deepScan("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "base"); show("base USDC", r);
  assert.equal(r.honeypot, "not detected"); assert.ok(r.honeypotSimulation.buyTaxPct < 1 && r.honeypotSimulation.sellTaxPct < 1);
  assert.ok(r.ownerPowers.proxy); assert.ok(r.liquidity.mainPool.approxTotalUsd > 100000); assert.ok(Array.isArray(r.couldNotDetermine));
});
test("Base BRETT (meme): sellable, 0 tax, renounced", async () => {
  const r = await deepScan("0x532f27101965dd16442E59d40670FaF5eBB142E4", "base"); show("base BRETT", r);
  assert.equal(r.honeypot, "not detected"); assert.equal(r.ownerPowers.owner, "0x0000000000000000000000000000000000000000"); assert.ok(r.holders.available);
});
test("Base DEGEN (meme)", async () => { const r = await deepScan("0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", "base"); show("base DEGEN", r); assert.ok(["not detected", "unknown"].includes(r.honeypot)); });
test("Ethereum PEPE: full holder list via Blockscout", async () => {
  const r = await deepScan("0x6982508145454Ce325dDbE47a25d4ec3d2311933", "ethereum"); show("eth PEPE", r);
  assert.equal(r.honeypot, "not detected"); assert.equal(r.holders.available, true); assert.equal(r.holders.partial, false); assert.ok(r.holders.top.length >= 10);
});
test("BNB Chain CAKE via PancakeSwap", async () => { const r = await deepScan("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", "bsc"); show("bsc CAKE", r); assert.equal(r.honeypot, "not detected"); assert.ok(r.liquidity.mainPool); });
async function synth(mode) {
  const chain = "bsc", token = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", C = CHAINS[chain];
  const pool = (await findPools(chain, token)).filter(p => p.kind === "v2" && p.quote.toLowerCase() === DEX.bsc.wnative.toLowerCase()).sort((a, b) => (b.quoteBal > a.quoteBal ? 1 : -1))[0];
  const IMPL = "0x5130000000000000000000000000000000009999", code = await C.rpc.getCode({ address: token });
  const hp = JSON.parse(readFileSync(new URL("./hpwrap-code.json", import.meta.url)));
  const ov = { [IMPL]: { code }, [token]: { code: hp, stateDiff: { [keccak256(toHex("hpwrap.pair"))]: pad(pool.address), [keccak256(toHex("hpwrap.impl"))]: pad(IMPL), [keccak256(toHex("hpwrap.mode"))]: pad(toHex(mode)) } } };
  return { clean: await simulate(chain, token, pool, 18), s: await simulate(chain, token, pool, 18, ov) };
}
test("Synthetic honeypot: CAKE with sells to its PancakeSwap V2 pair blocked -> detected", async () => {
  const { clean, s } = await synth(1); assert.equal(clean.canSell, true, "unmodified CAKE should sell");
  console.log("  synthetic HP:", s.failedAt, "|", s.revertReason);
  assert.equal(s.canSell, false); assert.equal(s.honeypot, "likely"); assert.match(s.revertReason, /selling disabled/);
});
test("Synthetic 10% sell tax on CAKE -> measured", async () => {
  const { s } = await synth(2); console.log("  synthetic tax: buy", s.buyTaxPct, "sell", s.sellTaxPct, "round trip", s.roundTripReturnPct);
  assert.equal(s.canSell, true); assert.ok(Math.abs(s.sellTaxPct - 10) < 0.01, "sell tax should be 10%"); assert.ok(s.buyTaxPct < 0.01);
});
test("EOA input is reported as not a token", async () => { const r = await deepScan("0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717", "base"); assert.match(r.summary, /Not an ERC-20/); });
