// Premium token deep scan: holders, liquidity + LP lock, honeypot buy/sell simulation, owner powers.
// Data: public RPCs (eth_call with state override, nothing is ever sent onchain), Blockscout public API (holders; Base/Ethereum), Sourcify.
import { parseAbi, formatUnits, decodeErrorResult, encodeFunctionData, decodeFunctionResult, getAddress } from "viem";
import { CHAINS } from "./lib.js";
import { tokenReport } from "./reports.js";
import { SIM_ABI, SIM_CODE } from "./sim-artifact.js";

const ZERO = "0x0000000000000000000000000000000000000000", DEAD = "0x000000000000000000000000000000000000dEaD";
const SIM = "0x5130000000000000000000000000000000005130", CALLER = "0x5130000000000000000000000000000000000001", FRESH = "0x5130000000000000000000000000000000000002";
const T = (p, ms = 8000) => { let t; return Promise.race([p, new Promise((_, r) => { t = setTimeout(() => r(new Error("timeout")), ms); })]).finally(() => clearTimeout(t)); };
const j = v => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));
const pct = (a, b) => b > 0n ? Number(a * 1000000n / b) / 10000 : null;
const low = a => a.toLowerCase();

// Per-chain DEX config. Factory addresses are checked live by the test suite (getPair/getPool for the native/stable pair must be non-zero).
export const DEX = {
  base: { wnative: "0x4200000000000000000000000000000000000006", stable: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6, "USDC"], blockscout: "https://base.blockscout.com",
    v2: [{ name: "Uniswap V2", factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6", feeBps: 30 }, { name: "Aerodrome (volatile)", factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", aero: true }],
    v3: [{ name: "Uniswap V3", factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", fees: [100, 500, 3000, 10000] }] },
  ethereum: { wnative: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", stable: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6, "USDC"], blockscout: "https://eth.blockscout.com",
    v2: [{ name: "Uniswap V2", factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", feeBps: 30 }, { name: "SushiSwap V2", factory: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac", feeBps: 30 }],
    v3: [{ name: "Uniswap V3", factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984", fees: [100, 500, 3000, 10000] }] },
  bsc: { wnative: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", stable: ["0x55d398326f99059fF775485246999027B3197955", 18, "USDT"], blockscout: null,
    v2: [{ name: "PancakeSwap V2", factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73", feeBps: 25 }],
    v3: [{ name: "PancakeSwap V3", factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", fees: [100, 500, 2500, 10000] }] },
};
const A = parseAbi(["function getPair(address,address) view returns (address)", "function getPool(address,address,bool) view returns (address)", "function getPool(address,address,uint24) view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)", "function token0() view returns (address)", "function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)",
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint32,bool)", "function decimals() view returns (uint8)"]);
const SLOT0_PCS = parseAbi(["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint32,bool)"]);

async function mc(C, calls) { // multicall with allowFailure
  const r = await T(C.rpc.multicall({ contracts: calls, allowFailure: true }), 10000);
  return r.map(x => x.status === "success" ? x.result : undefined);
}

// Native price in the chain's main stablecoin from the deepest native/stable V3 pool (onchain, no price API).
async function nativeUsd(chain) {
  const C = CHAINS[chain], D = DEX[chain], [st, sd] = D.stable, v3 = D.v3[0];
  const pools = (await mc(C, v3.fees.map(f => ({ address: v3.factory, abi: A, functionName: "getPool", args: [D.wnative, st, f] })))).filter(p => p && p !== ZERO);
  if (!pools.length) return null;
  const bals = await mc(C, pools.map(p => ({ address: D.wnative, abi: A, functionName: "balanceOf", args: [p] })));
  let best = 0, bi = -1; bals.forEach((b, i) => { if (b !== undefined && b > best) { best = b; bi = i; } }); if (bi < 0) return null;
  const pool = pools[bi]; const [s0, t0] = await mc(C, [{ address: pool, abi: SLOT0_PCS, functionName: "slot0" }, { address: pool, abi: A, functionName: "token0" }]);
  if (!s0 || !t0) return null;
  const p = Number(s0[0]) ** 2 / 2 ** 192; // token1 per token0, raw units
  return low(t0) === low(D.wnative) ? p * 10 ** (18 - sd) : (1 / p) * 10 ** (18 - sd);
}

export async function findPools(chain, token) {
  const C = CHAINS[chain], D = DEX[chain]; const quotes = [[D.wnative, 18, "native"], D.stable]; const calls = [], meta = [];
  for (const [q, qd, qs] of quotes) {
    if (low(q) === low(token)) continue;
    for (const d of D.v2) { if (d.aero) { calls.push({ address: d.factory, abi: A, functionName: "getPool", args: [token, q, false] }); meta.push({ kind: "v2", dex: d.name, aero: true, quote: q, qd, qs }); }
      else { calls.push({ address: d.factory, abi: A, functionName: "getPair", args: [token, q] }); meta.push({ kind: "v2", dex: d.name, feeBps: d.feeBps, quote: q, qd, qs }); } }
    for (const d of D.v3) for (const f of d.fees) { calls.push({ address: d.factory, abi: A, functionName: "getPool", args: [token, q, f] }); meta.push({ kind: "v3", dex: d.name, fee: f, quote: q, qd, qs }); }
  }
  const addrs = await mc(C, calls); const pools = [];
  addrs.forEach((a, i) => { if (a && a !== ZERO) pools.push({ ...meta[i], address: a }); });
  if (!pools.length) return [];
  const bal = await mc(C, pools.flatMap(p => [{ address: p.quote, abi: A, functionName: "balanceOf", args: [p.address] }, { address: token, abi: A, functionName: "balanceOf", args: [p.address] }]));
  pools.forEach((p, i) => { p.quoteBal = bal[2 * i] ?? 0n; p.tokenBal = bal[2 * i + 1] ?? 0n; });
  return pools;
}

const decodeErr = d => { if (!d || d === "0x") return null; try { const e = decodeErrorResult({ abi: [], data: d }); return e.args?.length ? String(e.args[0]) : e.errorName; } catch { return d.slice(0, 74); } };

export async function simulate(chain, token, pool, decimals, extraOverrides = {}) {
  const C = CHAINS[chain], D = DEX[chain];
  // Trade ~0.5% of the pool's native side, capped at 0.05 native, so the test reflects a small retail trade.
  let amountIn = pool.quoteBal / 200n; const cap = 5n * 10n ** 16n; if (amountIn > cap) amountIn = cap; if (amountIn < 10n ** 9n) return { ran: false, reason: "pool's native-side liquidity too small to simulate" };
  const fn = pool.kind === "v3" ? "v3" : "v2";
  const args = fn === "v3" ? [pool.address, D.wnative, token, amountIn] : [pool.address, D.wnative, token, amountIn, pool.aero ? 1n : 0n, BigInt(pool.feeBps || 30)];
  const data = encodeFunctionData({ abi: SIM_ABI, functionName: fn, args });
  let raw; try { raw = await T(C.rpc.request({ method: "eth_call", params: [{ from: CALLER, to: SIM, data, gas: "0x1c9c380" }, "latest", { ...extraOverrides, [SIM]: { code: SIM_CODE, balance: "0x56bc75e2d63100000" } }] }), 12000); }
  catch (e) { return { ran: false, reason: "RPC simulation call failed: " + String(e.shortMessage || e.message).slice(0, 120) }; }
  const [stage, r, err] = decodeFunctionResult({ abi: SIM_ABI, functionName: fn, data: raw });
  const S = Number(stage), f = (x, d) => formatUnits(x, d);
  const out = { ran: true, pool: pool.address, dex: pool.dex + (pool.fee ? ` ${pool.fee / 10000}%` : ""), tradeSize: `${f(amountIn, 18)} ${CHAINS[chain].native === "BNB" ? "WBNB" : "WETH"}`, method: "eth_call with state override from a fresh simulated contract: buy with wrapped native, then sell everything back into the same pool. Nothing is sent onchain." };
  const stages = { 1: "buy swap reverted", 2: "buy returned zero tokens", 3: "token transfer to the pool (sell) reverted", 4: "sell swap reverted", 9: "simulator setup failed" };
  if (S === 0 || S >= 3) { out.buyTaxPct = r[0] > 0n ? Math.max(0, pct(r[0] - r[1], r[0])) : null; out.tokensBought = f(r[1], decimals); }
  if (S === 0) {
    if (fn === "v2") { out.sellTaxPct = Math.max(0, pct(r[2] - r[3], r[2])); }
    else { out.sellTaxPct = 0; out.sellTaxNote = "V3 pools reject tokens that take a fee on transfer, so a successful V3 sell means no transfer tax on this path."; }
    out.roundTripReturnPct = pct(r[5], amountIn); out.roundTripNote = "Includes the pool's LP fee on both legs and a 0.5% safety margin per leg in the simulator, so ~1-3% loss is normal even with zero tax.";
    out.canSell = true; out.honeypot = out.sellTaxPct >= 50 || out.buyTaxPct >= 50;
  } else { out.canSell = S >= 3 ? false : null; out.failedAt = stages[S]; out.revertReason = decodeErr(err); out.honeypot = S === 3 || S === 4 ? "likely" : null;
    out.caveat = "Some tokens block contract callers, enforce max-transaction limits or anti-bot rules on new wallets; a failed simulation is strong evidence but not proof."; }
  return out;
}

// Fallback when no simulatable pool: can an existing holder transfer to the pool and to a fresh wallet?
async function transferTest(chain, token, holder, to, amt) {
  const C = CHAINS[chain];
  const data = encodeFunctionData({ abi: SIM_ABI, functionName: "xfer", args: [token, to, amt] });
  try { const raw = await T(C.rpc.request({ method: "eth_call", params: [{ from: CALLER, to: holder, data, gas: "0x989680" }, "latest", { [holder]: { code: SIM_CODE } }] }), 10000);
    const [ok, received, err] = decodeFunctionResult({ abi: SIM_ABI, functionName: "xfer", data: raw }); return { ok, taxPct: ok ? Math.max(0, pct(amt - received, amt)) : null, revertReason: ok ? null : decodeErr(err) }; }
  catch (e) { return { ok: null, error: String(e.shortMessage || e.message).slice(0, 120) }; }
}

async function blockscout(chain, path) {
  const b = DEX[chain].blockscout; if (!b) return null;
  const r = await T(fetch(b + path, { headers: { accept: "application/json", "user-agent": "automaton-onchain-tools/1.5 (+https://automaton-tx-explainer.vercel.app)" } }), 8000);
  if (!r.ok) throw new Error("blockscout HTTP " + r.status); const ct = r.headers.get("content-type") || ""; if (!ct.includes("json")) throw new Error("blockscout returned non-JSON (likely bot protection)");
  return r.json();
}

// Fallback holder discovery: addresses seen in recent Transfer logs (public RPC, ~10k blocks), then live balanceOf. Partial by design.
const LOG_RPC = { base: "https://base-rpc.publicnode.com", ethereum: "https://ethereum-rpc.publicnode.com", bsc: "https://bsc-rpc.publicnode.com" };
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
async function rpc(url, method, params, ms = 6000) { const r = await T(fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), ms); const d = await T(r.json(), ms); if (d.error) throw new Error(d.error.message); return d.result; }
async function holdersFromLogs(chain, token, supply, decimals, known) {
  const C = CHAINS[chain], url = LOG_RPC[chain]; const bn = parseInt(await rpc(url, "eth_blockNumber", []), 16);
  // Busy tokens overflow the RPC's result cap, so try several windows at once and keep the widest that succeeds.
  const wins = [9900, 1500, 200, 40]; const res = await Promise.allSettled(wins.map(w => rpc(url, "eth_getLogs", [{ fromBlock: "0x" + (bn - w).toString(16), toBlock: "0x" + bn.toString(16), address: token, topics: [TRANSFER] }])));
  const i = res.findIndex(r => r.status === "fulfilled"); if (i < 0) throw res[0].reason; const logs = res[i].value, span = wins[i];
  const seen = new Map(); for (const l of logs) for (const t of [l.topics[1], l.topics[2]]) if (t) { const a = "0x" + t.slice(26); seen.set(a, (seen.get(a) || 0) + 1); }
  for (const k of Object.keys(known)) if (/^0x[0-9a-f]{40}$/.test(k)) seen.set(k, seen.get(k) || 0);
  const addrs = [...seen.keys()].sort((a, b) => seen.get(b) - seen.get(a)).slice(0, 500);
  const bals = await mc(C, addrs.map(a => ({ address: token, abi: A, functionName: "balanceOf", args: [a] })));
  const rows = addrs.map((a, i) => ({ a, v: bals[i] ?? 0n })).filter(x => x.v > 0n).sort((x, y) => (y.v > x.v ? 1 : y.v < x.v ? -1 : 0)).slice(0, 20);
  const codes = await Promise.all(rows.map(x => C.rpc.getCode({ address: x.a }).catch(() => null)));
  return rows.map((x, i) => ({ address: getAddress(x.a), pctOfSupply: pct(x.v, supply), amount: formatUnits(x.v, decimals), isContract: !!codes[i] && codes[i] !== "0x" && !codes[i].startsWith("0xef0100"), label: known[low(x.a)] || null }))
    .concat([]).map(o => ({ ...o, _scan: { blocks: span, transfers: logs.length, addressesChecked: addrs.length } }));
}
const isExcluded = (known, a) => !!known[low(a)] && !known[low(a)].startsWith("owner");
function summarizeHolders(items, known, extra) {
  const ex = items.filter(x => !isExcluded(known, x.address)).slice(0, 10);
  const r = n => Math.round(n * 100) / 100;
  return { available: true, ...extra, top10Pct: r(items.slice(0, 10).reduce((s, x) => s + (x.pctOfSupply || 0), 0)), top10ExcludingPoolsAndBurnPct: r(ex.reduce((s, x) => s + (x.pctOfSupply || 0), 0)), largestNonPoolHolderPct: ex[0]?.pctOfSupply ?? null, top: items.slice(0, 15).map(({ _scan, ...o }) => o) };
}
export async function holders(chain, token, supply, decimals, known) {
  const viaLogs = async why => { try { const items = await holdersFromLogs(chain, token, supply, decimals, known); const sc = items[0]?._scan;
      if (!items.length) return { available: false, reason: why + " No holders found in recent transfers either." };
      return { ...summarizeHolders(items, known, { source: "Recent Transfer logs (public RPC) + live balanceOf", partial: true, scanned: sc }), note: `PARTIAL: ${why} Ranked the ${sc?.addressesChecked} addresses active in the last ~${sc?.blocks} blocks plus pools/burn/owner by live balance. Large holders that haven't moved tokens recently can be missed, so real concentration may be higher.` }; }
    catch (e) { return { available: false, reason: why + " Recent-transfer fallback failed: " + String(e.message).slice(0, 80) }; } };
  if (!DEX[chain].blockscout) return viaLogs("No free, keyless full holder list for BNB Chain (BscScan's needs a paid API key).");
  try {
    const [h, info] = await Promise.all([blockscout(chain, `/api/v2/tokens/${token}/holders`), blockscout(chain, `/api/v2/tokens/${token}`).catch(() => null)]);
    const items = (h?.items || []).slice(0, 20).map(x => { const a = x.address?.hash; const v = BigInt(x.value || "0"); const tag = known[low(a)] || x.address?.name || x.address?.metadata?.tags?.[0]?.name || null;
      return { address: a, pctOfSupply: pct(v, supply), amount: formatUnits(v, decimals), isContract: !!x.address?.is_contract, label: tag }; });
    return summarizeHolders(items, known, { source: "Blockscout public API", partial: false, holderCount: info?.holders_count ? Number(info.holders_count) : (info?.holders ? Number(info.holders) : null) });
  } catch (e) { return viaLogs(`Blockscout holder list unavailable (${String(e.message).slice(0, 60)}).`); }
}

async function lpStatus(chain, pool, token, owner) {
  const C = CHAINS[chain];
  if (pool.kind === "v3") return { type: "concentrated liquidity (V3 position NFTs)", determinable: false, note: "V3 liquidity is held as position NFTs, so lock/burn status can't be read from the pool; not determinable from free data." };
  const [sup, dead, zero, self] = await mc(C, [{ address: pool.address, abi: A, functionName: "totalSupply" }, { address: pool.address, abi: A, functionName: "balanceOf", args: [DEAD] }, { address: pool.address, abi: A, functionName: "balanceOf", args: [ZERO] }, { address: pool.address, abi: A, functionName: "balanceOf", args: [token] }]);
  if (!sup) return { type: "V2-style LP token", determinable: false, note: "Could not read LP supply." };
  const r2 = n => Math.round((n || 0) * 100) / 100;
  const o = { type: "V2-style LP token", lpToken: pool.address, burnedPct: pct((dead || 0n) + (zero || 0n), sup), heldByTokenContractPct: pct(self || 0n, sup), note: "Burned = LP tokens at 0x0 or 0x…dEaD (permanent). The zero address always holds a tiny minimum-liquidity amount." };
  const renounced = owner === ZERO;
  if (o.heldByTokenContractPct >= 1) o.tokenContractNote = renounced ? "LP held by the token contract itself with ownership renounced: usually stuck there, unless the contract has a public function that releases it." : "LP held by the token contract itself; whoever controls the contract (owner) may be able to withdraw it.";
  let lockedPct = 0, top = null;
  if (DEX[chain].blockscout) { try { const h = await blockscout(chain, `/api/v2/tokens/${pool.address}/holders`);
    o.topLpHolders = (h?.items || []).slice(0, 5).map(x => ({ address: x.address?.hash, pctOfLp: pct(BigInt(x.value || "0"), sup), isContract: !!x.address?.is_contract, label: x.address?.name || x.address?.metadata?.tags?.[0]?.name || null }));
    const lockers = o.topLpHolders.filter(x => /lock|uncx|unicrypt|team ?finance|pink|timelock/i.test(x.label || "")); lockedPct = lockers.reduce((s, x) => s + (x.pctOfLp || 0), 0);
    if (lockers.length) o.lockedPct = r2(lockedPct); o.lockerDetection = "Lockers recognized only by Blockscout name tags (UNCX/Unicrypt/Team Finance/PinkLock/timelock); unlabeled lockers are missed.";
    top = o.topLpHolders.find(x => ![low(DEAD), low(ZERO), low(token)].includes(low(x.address || "")) && !/lock|uncx|unicrypt|team ?finance|pink|timelock/i.test(x.label || ""));
  } catch (e) { o.lpHoldersNote = "LP holder list unavailable: " + String(e.message).slice(0, 80); } }
  const safe = (o.burnedPct || 0) + lockedPct + (renounced ? (o.heldByTokenContractPct || 0) : 0);
  const big = top && top.pctOfLp >= 10 ? top : null;
  o.safeSharePct = r2(safe);
  if (safe >= 95) { o.verdict = (o.burnedPct || 0) >= 95 ? "LP burned" : "LP effectively burned/locked"; o.determinable = true; }
  else if (big && !big.isContract) { o.verdict = `${big.pctOfLp}% of LP sits in a regular wallet, which can pull it at any time`; o.determinable = true; o.pullable = true; }
  else if (big) { o.verdict = `${big.pctOfLp}% of LP is held by a contract${big.label ? ` (${big.label})` : ""} that isn't a recognized locker; could be a locker, multisig or vault, not determinable`; o.determinable = false; }
  else if (safe >= 50) { o.verdict = "majority of LP burned/locked"; o.determinable = true; }
  else { o.verdict = DEX[chain].blockscout ? `only ${r2(safe)}% of LP burned/locked; holder detail unavailable` : `only ${r2(o.burnedPct)}% burned; the rest's lock status isn't determinable on this chain without a paid explorer key`; o.determinable = false; }
  return o;
}

export async function deepScan(address, chain = "base") {
  const C = CHAINS[chain]; const D = DEX[chain]; const t0 = Date.now();
  const tokenAddr = getAddress(address);
  const [rep, poolsR, px] = await Promise.all([tokenReport(tokenAddr, chain), findPools(chain, tokenAddr).catch(() => findPools(chain, tokenAddr)).then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e.message).slice(0, 120) })), nativeUsd(chain).catch(() => null)]);
  const erc = rep.inspect?.erc20; const cannot = [];
  if (!erc) return { type: "token-deep-scan", chain, chainId: C.chainId, address: tokenAddr, riskLevel: rep.riskLevel, summary: "Not an ERC-20 token (no name/symbol/decimals), so there's no market to scan. Owner-power findings below.", findings: rep.findings, tokenReport: rep, disclaimer: DISC };
  const decimals = Number(erc.decimals); const supply = BigInt(await C.rpc.readContract({ address: tokenAddr, abi: A, functionName: "totalSupply" }).catch(() => 0n));
  const pools = poolsR.ok ? poolsR.v : []; if (!poolsR.ok) cannot.push("Pool discovery failed: " + poolsR.e);
  const usdOf = p => low(p.quote) === low(D.wnative) ? (px ? Number(formatUnits(p.quoteBal, 18)) * px : null) : Number(formatUnits(p.quoteBal, p.qd));
  for (const p of pools) p.quoteSideUsd = usdOf(p);
  pools.sort((a, b) => (b.quoteSideUsd ?? 0) - (a.quoteSideUsd ?? 0));
  const main = pools[0] || null;
  const known = { [low(DEAD)]: "dead address (burn)", [low(ZERO)]: "zero address (burn)", [low(tokenAddr)]: "token contract itself" };
  for (const p of pools) known[low(p.address)] = `${p.dex}${p.fee ? " " + p.fee / 10000 + "%" : ""} pool`;
  const own = rep.contractRisk?.owner; if (own && own !== ZERO && !known[low(own)]) known[low(own)] = "owner (kept in concentration)";
  for (const k of ["0x498581fF718922c3f8e6A244956aF099B2652b2b", "0x000000000004444c5dc75cB358380D2e3dE08A90", "0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF"]) known[low(k)] = "Uniswap V4 PoolManager";
  const [hold, lp] = await Promise.all([holders(chain, tokenAddr, supply, decimals, known), main ? lpStatus(chain, main, tokenAddr, rep.contractRisk?.owner).catch(e => ({ determinable: false, note: String(e.message).slice(0, 100) })) : null]);
  if (!hold.available) cannot.push("Top holders: " + hold.reason);
  // Honeypot: simulate on the deepest native-paired pool.
  const simPool = pools.find(p => low(p.quote) === low(D.wnative) && p.quoteBal > 0n);
  let sim = simPool ? await simulate(chain, tokenAddr, simPool, decimals) : { ran: false, reason: main ? "Main liquidity isn't paired with the wrapped native coin, so the buy/sell simulation wasn't run." : `No pool found on the DEXes checked (${[...D.v2, ...D.v3].map(d => d.name).join(", ")}). Liquidity may be on Uniswap V4 or another DEX.` };
  if (!sim.ran) { cannot.push("Honeypot simulation: " + sim.reason);
    const holder = hold.top?.find(h => !h.isContract && !known[low(h.address)]);
    if (holder) { const amt = BigInt(Math.floor(Number(holder.amount) * 0.01 * 10 ** Math.min(decimals, 6))) * 10n ** BigInt(Math.max(0, decimals - 6)) || 1n;
      const to = main?.address || "0x498581fF718922c3f8e6A244956aF099B2652b2b";
      sim.transferTest = { from: holder.address, toPool: await transferTest(chain, tokenAddr, getAddress(holder.address), getAddress(to), amt), toFreshWallet: await transferTest(chain, tokenAddr, getAddress(holder.address), FRESH, amt), note: "Fallback: a top holder sends 1% of its balance to a pool address (like a sell) and to a fresh wallet, via eth_call. Not a full swap simulation." }; } }
  const liquidity = main ? { mainPool: { address: main.address, dex: main.dex + (main.fee ? ` ${main.fee / 10000}%` : ""), type: main.kind === "v3" ? "concentrated (V3)" : "constant-product (V2)", pairedWith: main.qs === "native" ? (C.native === "BNB" ? "WBNB" : "WETH") : main.qs,
      quoteSideReserve: formatUnits(main.quoteBal, main.qd), quoteSideUsd: main.quoteSideUsd === null ? null : Math.round(main.quoteSideUsd), tokenSideReserve: formatUnits(main.tokenBal, decimals), tokenSidePctOfSupply: pct(main.tokenBal, supply),
      approxTotalUsd: main.quoteSideUsd === null ? null : Math.round(main.quoteSideUsd * 2), approxNote: main.kind === "v3" ? "V3 USD figure is ~2x the paired-side balance held by the pool; actual in-range depth can be lower." : "~2x the paired-side reserve." },
    poolsFound: pools.length, otherPools: pools.slice(1, 6).map(p => ({ address: p.address, dex: p.dex + (p.fee ? ` ${p.fee / 10000}%` : ""), quoteSideUsd: p.quoteSideUsd === null ? null : Math.round(p.quoteSideUsd) })), lp, nativeUsdPrice: px ? Math.round(px * 100) / 100 : null,
    coverage: `Checked ${[...D.v2, ...D.v3].map(d => d.name).join(", ")} against ${C.native === "BNB" ? "WBNB" : "WETH"} and ${D.stable[2]}. Uniswap V4 and other DEXes are not scanned.` } : { mainPool: null, poolsFound: 0, coverage: `No pools on ${[...D.v2, ...D.v3].map(d => d.name).join(", ")}.` };
  if (lp && !lp.determinable) cannot.push("LP lock: " + (lp.note || lp.verdict));
  if (!px) cannot.push("Native USD price unavailable; liquidity shown in native units only.");

  // Findings + verdict
  const findings = [...(rep.findings || [])]; const add = (severity, note) => findings.push({ severity, note });
  if (sim.ran && sim.canSell === false) add("high", `Honeypot signal: the simulated sell failed (${sim.failedAt}${sim.revertReason ? `: ${sim.revertReason}` : ""}).`);
  else if (sim.ran && sim.failedAt) add("medium", `Simulation could not complete (${sim.failedAt}${sim.revertReason ? `: ${sim.revertReason}` : ""}).`);
  if (sim.ran && sim.canSell) { const tx = Math.max(sim.buyTaxPct || 0, sim.sellTaxPct || 0);
    if (tx >= 50) add("high", `Extreme tax: buy ${sim.buyTaxPct}%, sell ${sim.sellTaxPct}%.`); else if (tx >= 10) add("high", `High tax: buy ${sim.buyTaxPct}%, sell ${sim.sellTaxPct}%.`); else if (tx >= 3) add("medium", `Tax detected: buy ${sim.buyTaxPct}%, sell ${sim.sellTaxPct}%.`);
    else add("info", `Buy and sell both worked in simulation (buy tax ${sim.buyTaxPct}%, sell tax ${sim.sellTaxPct}%).`); }
  if (sim.transferTest?.toPool?.ok === false) add("high", `A real holder's transfer to the pool reverted in simulation${sim.transferTest.toPool.revertReason ? ` (${sim.transferTest.toPool.revertReason})` : ""}: sells may be blocked.`);
  const usd = liquidity.mainPool?.approxTotalUsd;
  if (!main) add("high", "No DEX liquidity found on the pools checked.");
  else if (usd !== null && usd !== undefined) { if (usd < 10000) add("high", `Very thin liquidity: ~$${usd.toLocaleString("en-US")} in the main pool.`); else if (usd < 100000) add("medium", `Modest liquidity: ~$${usd.toLocaleString("en-US")} in the main pool.`); }
  if (lp?.pullable) add("high", `Liquidity can be pulled: ${lp.verdict}.`);
  else if (lp?.type?.startsWith("V2") && !lp.determinable && (lp.safeSharePct ?? 0) < 50) add("medium", `LP lock unclear: ${lp.verdict}.`);
  if (hold.available) { const c = hold.top10ExcludingPoolsAndBurnPct; if (c >= 50) add("high", `Top 10 holders (excluding pools/burn) own ${c}% of supply.`); else if (c >= 25) add("medium", `Top 10 holders (excluding pools/burn) own ${c}% of supply.`);
    if (hold.largestNonPoolHolderPct >= 10) add("medium", `Largest non-pool holder owns ${hold.largestNonPoolHolderPct}% of supply.`); }
  const highs = findings.filter(f => f.severity === "high").length, meds = findings.filter(f => f.severity === "medium").length;
  const honeypot = (sim.ran && sim.canSell === false) || sim.honeypot === true;
  const riskLevel = honeypot ? "critical" : highs >= 2 ? "high" : highs === 1 || meds >= 3 ? "medium-high" : meds ? "medium" : "low";
  const s = [`${erc.name ?? "Unnamed"} (${erc.symbol}) on ${C.name}.`];
  if (sim.ran && sim.canSell) s.push(`Simulated buy and sell both worked (buy tax ${sim.buyTaxPct}%, sell tax ${sim.sellTaxPct}%).`); else if (sim.ran && sim.canSell === false) s.push(`The simulated sell FAILED: ${sim.failedAt}. Treat as a likely honeypot.`); else s.push("Buy/sell simulation not possible on the pools checked.");
  if (main) s.push(`Main pool: ${liquidity.mainPool.dex}${usd ? `, about $${usd.toLocaleString("en-US")} liquidity` : ""}${lp?.verdict ? `; ${lp.verdict}` : ""}.`);
  if (hold.available) s.push(`Top 10 holders own ${hold.top10Pct}% (${hold.top10ExcludingPoolsAndBurnPct}% excluding pools/burn).`);
  s.push(rep.contractRisk?.owner === ZERO ? "Ownership renounced." : rep.contractRisk?.owner ? `Owner: ${rep.contractRisk.ownerType === "eoa" ? "a single wallet" : "a contract"}.` : "No owner() found.");
  if (Object.keys(rep.contractRisk?.capabilities || {}).some(k => ["mint", "pause", "blacklist"].includes(k))) s.push("Mint/pause/blacklist powers are normal for regulated stablecoins like USDC but a red flag on a new meme token.");
  s.push(`Overall: ${riskLevel}.`);
  return j({ type: "token-deep-scan", version: "1.0", chain, chainId: C.chainId, address: tokenAddr, token: { name: erc.name, symbol: erc.symbol, decimals, totalSupply: formatUnits(supply, decimals) },
    riskLevel, honeypot: honeypot ? "likely" : sim.ran && sim.canSell ? "not detected" : "unknown", summary: s.join(" "), findings, honeypotSimulation: sim, liquidity, holders: hold,
    ownerPowers: { riskLevel: rep.riskLevel, owner: rep.contractRisk?.owner ?? null, ownerType: rep.contractRisk?.ownerType ?? null, proxy: rep.inspect?.proxy ?? null, capabilities: rep.contractRisk?.capabilities ?? {}, sourcify: rep.contractRisk?.sourcify ?? null, ownerBalance: rep.holders?.ownerBalance ?? null },
    couldNotDetermine: cannot, elapsedMs: Date.now() - t0, disclaimer: DISC });
}
const DISC = "Automated scan from public onchain data (public RPCs, simulated eth_calls that never touch the chain), Blockscout and Sourcify. A clean simulation now doesn't stop an owner changing taxes or pulling liquidity later. Not an audit, not financial or security advice.";
