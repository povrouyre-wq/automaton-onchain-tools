// $0.01 honeypot check: can you sell this token, and what are the buy and sell taxes?
// Reuses the deep scan's pool finder and simulator: one eth_call with a state override buys with the wrapped native coin
// and sells everything back into the same pool. Nothing is ever sent onchain.
import { getAddress, formatUnits, parseAbi } from "viem";
import { CHAINS } from "./lib.js";
import { DEX, findPools, simulate } from "./deepscan.js";

const ERC = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)", "function name() view returns (string)"]);
const low = a => a.toLowerCase();
const fail = (status, msg) => Object.assign(new Error(msg), { status });
export const HONEYPOT_CHAINS = ["base", "ethereum", "bsc"];

// Verdict from a completed simulation. Only called when the sim answered the question (sell worked, or sell reverted after a good buy).
export function verdict(sim) {
  if (sim.canSell === false) return { verdict: "honeypot", riskLevel: "critical", sellable: false, why: `the simulated sell failed (${sim.failedAt}${sim.revertReason ? `: ${sim.revertReason}` : ""})` };
  const tax = Math.round(Math.max(sim.buyTaxPct || 0, sim.sellTaxPct || 0) * 100) / 100; // 9.9999 measured -> 10
  if (tax >= 50) return { verdict: "honeypot (extreme tax)", riskLevel: "critical", sellable: true, why: `selling works but taxes eat most of it (buy ${sim.buyTaxPct}%, sell ${sim.sellTaxPct}%)` };
  if (tax >= 10) return { verdict: "high tax", riskLevel: "high", sellable: true, why: `buy ${sim.buyTaxPct}%, sell ${sim.sellTaxPct}%` };
  if (tax >= 3) return { verdict: "taxed", riskLevel: "medium", sellable: true, why: `buy ${sim.buyTaxPct}%, sell ${sim.sellTaxPct}%` };
  return { verdict: "sellable", riskLevel: "low", sellable: true, why: `buy ${sim.buyTaxPct}%, sell ${sim.sellTaxPct}%` };
}

// opts.overrides(pool) -> extra state overrides (tests only).
export async function honeypotCheck(chain, address, opts = {}) {
  if (!HONEYPOT_CHAINS.includes(chain)) throw fail(400, "chain must be base, ethereum or bsc");
  const C = CHAINS[chain], D = DEX[chain], t0 = Date.now(), token = getAddress(address);
  const wn = C.native === "BNB" ? "WBNB" : "WETH", dexes = [...D.v2, ...D.v3].map(d => d.name).join(", ");
  const [code, meta] = await Promise.all([C.rpc.getCode({ address: token }).catch(() => null),
    C.rpc.multicall({ contracts: ["decimals", "symbol", "name"].map(f => ({ address: token, abi: ERC, functionName: f })), allowFailure: true }).catch(() => null)]);
  if (!code || code === "0x") throw fail(404, `no contract at ${token} on ${C.name}`);
  const decimals = meta?.[0]?.status === "success" ? Number(meta[0].result) : null;
  if (decimals === null) throw fail(404, "not an ERC-20 token (no decimals())");
  const symbol = meta[1]?.status === "success" ? meta[1].result : null, name = meta[2]?.status === "success" ? meta[2].result : null;
  if (low(token) === low(D.wnative)) throw fail(404, `${wn} is the quote coin itself; nothing to test`);
  let pools; try { pools = await findPools(chain, token); } catch (e) { throw fail(502, "pool discovery failed: " + String(e.shortMessage || e.message).slice(0, 100)); }
  const native = pools.filter(p => low(p.quote) === low(D.wnative) && p.quoteBal > 0n).sort((a, b) => (b.quoteBal > a.quoteBal ? 1 : b.quoteBal < a.quoteBal ? -1 : 0));
  if (!native.length) throw fail(404, pools.length ? `only ${D.stable[2]}-paired pools found; the simulator needs a ${wn} pool` : `no ${wn} pool on ${dexes}. Liquidity may be on Uniswap V4 or another DEX, which this check doesn't cover`);
  // Try the deepest native pool; if it can't give an answer (buy reverted, too small), try the next one. Max 2 pools to stay well under the deadline.
  const tried = []; let sim = null, pool = null;
  for (const p of native.slice(0, 2)) {
    const s = await simulate(chain, token, p, decimals, opts.overrides ? opts.overrides(p) : {});
    tried.push({ pool: p.address, dex: p.dex + (p.fee ? ` ${p.fee / 10000}%` : ""), result: s.ran ? (s.canSell === true ? "sell ok" : s.canSell === false ? "sell reverted" : s.failedAt) : s.reason });
    if (s.ran && (s.canSell === true || s.canSell === false)) { sim = s; pool = p; break; }
  }
  if (!sim) throw fail(422, `inconclusive, not charged: ${tried.map(t => `${t.dex} ${short(t.pool)}: ${t.result}`).join("; ")}`);
  const v = verdict(sim), N = symbol || name || short(token);
  const summary = v.sellable === false ? `${N} on ${C.name}: HONEYPOT. A simulated buy worked but the sell back into ${sim.dex} failed (${sim.failedAt}${sim.revertReason ? `: ${sim.revertReason}` : ""}). Don't buy.`
    : `${N} on ${C.name}: ${v.verdict}. A simulated buy and sell on ${sim.dex} both worked: buy tax ${sim.buyTaxPct}%, sell tax ${sim.sellTaxPct}%.`;
  const notes = [`Simulated on the deepest ${wn}-paired pool found on ${dexes}. Uniswap V4, four.meme bonding curves and other DEXes are not covered.`,
    `Trade size ${sim.tradeSize} (about 0.5% of the pool's ${wn} side, capped at 0.05). Nothing is sent onchain.`,
    "A clean result now doesn't stop an owner changing taxes, blacklisting wallets or pulling liquidity later."];
  if (sim.sellTaxNote) notes.push(sim.sellTaxNote);
  if (sim.caveat) notes.push(sim.caveat);
  if (tried.length > 1) notes.push(`First pool tried couldn't answer (${tried[0].result}); used the next one.`);
  const findings = [{ severity: v.riskLevel === "critical" ? "high" : v.riskLevel === "low" ? "info" : v.riskLevel, note: v.verdict === "sellable" ? `Buy and sell both worked in simulation (${v.why}).` : `${v.verdict[0].toUpperCase() + v.verdict.slice(1)}: ${v.why}.` }];
  return { type: "honeypot-check", chain, chainId: C.chainId, address: token, token: { address: token, name, symbol, decimals },
    sellable: v.sellable, buyTaxPct: sim.buyTaxPct ?? null, sellTaxPct: sim.sellTaxPct ?? null, verdict: v.verdict, riskLevel: v.riskLevel, summary, findings,
    pool: { address: getAddress(pool.address), dex: sim.dex, type: pool.kind === "v3" ? "concentrated (V3)" : "constant-product (V2)", pairedWith: wn, nativeSideReserve: formatUnits(pool.quoteBal, 18), poolsFound: pools.length },
    simulation: { tradeSize: sim.tradeSize, tokensBought: sim.tokensBought ?? null, roundTripReturnPct: sim.roundTripReturnPct ?? null, failedAt: sim.failedAt ?? null, revertReason: sim.revertReason ?? null, method: sim.method },
    coverage: { poolsTried: tried, notes }, elapsedMs: Date.now() - t0,
    disclaimer: "Automated simulation from public RPC data (eth_call with state override, never sent onchain). Not financial or security advice." };
}
const short = a => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
