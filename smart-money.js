// BNB Chain smart-money feed ($0.02): wallets that repeatedly bought in the first blocks of four.meme and PancakeSwap
// launches that then ran (about 2x vs the first public candle, and still trading). Free public BSC logs only, so the
// window is whatever those nodes still serve (about 2 days, often less). Prices come from GeckoTerminal. Nothing here
// is filled in when a source fails: the field stays null and partial is set.
import { FOURMEME, WINDOW, indexEarlyWallets, isCoordinatedSniper, bscRpc, bscBlockAt } from "./bundles.js";
import { activeStore } from "./smart-money-store.js";
export { setSmartMoneyStore, memoryStore } from "./smart-money-store.js";

const GT = "https://api.geckoterminal.com/api/v2";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PAIR_CREATED = "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9";
const POOL_CREATED = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";
const TOKEN_CREATE = "0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20";
const V2_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";
const V3_FACTORY = "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865";
const FOUR_MANAGER = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";
const ZERO = "0x0000000000000000000000000000000000000000", DEAD = "0x000000000000000000000000000000000000dead";
export const RUN_MULTIPLE = 2, MIN_LIQ_USD = 1000, FIRST_N = 20, MAX_SCORED = 8, LOOKBACK_CAP_HOURS = 48, MIN_AGE_SEC = 600;
const LAUNCH_TTL = 20 * 60 * 1000;
// Pancake routers and a couple of 1inch routers. Contracts found by eth_getCode are dropped too.
export const ROUTERS = new Set([
  "0x10ed43c718714eb63d5aa57b78b54704e256024e", "0x05ff2b0db69458a0750badebc4f9e13add608c7f",
  "0x13f4ea83d0bd40e75c8222255bc855a974568dd4", "0x1b81d678ffb9c0263b24a97847620c99d213eb14",
  "0x1a0a18ac4becddbd6389559687d1a73d8927e416", "0x1111111254eeb25477b68fb85ed929f73a960582",
  "0x111111125421ca6dc452d289314280a0f8842a65"]);
const QUOTES = new Set(["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0x55d398326f99059ff775485246999027b3197955", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", "0xe9e7cea3dedca5984780bafc599bd69add087d56"]);
const MAJORS = new Set([...QUOTES, "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409", "0x2170ed0880ac9a755fd29b2688956bd959f933f8", "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82"]);
const lc = a => String(a || "").toLowerCase();
const hex = n => "0x" + Number(n).toString(16);
const words = data => ((data || "0x").slice(2).match(/.{64}/g)) || [];
const wordAddr = w => w && w.length >= 40 ? "0x" + w.slice(-40).toLowerCase() : null;
const UA = { accept: "application/json", "user-agent": "automaton-onchain-tools/1.16 (+https://automaton-tx-explainer.vercel.app)" };
const gtState = { next: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// One GeckoTerminal call at a time, at least 1.2s apart. A 429 waits 1s, 2s, then 4s, then this tick stops.
export async function gtFetchWithBackoff(path, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const wait = opts.sleep || sleep;
  const gapMs = opts.gapMs ?? 1200;
  const now = opts.now || Date.now;
  const state = opts.state || gtState;
  const gap = state.next - now();
  if (gap > 0) await wait(gap);
  let lastErr = "GeckoTerminal rate limit";
  for (let i = 0; i < 3; i++) {
    let r;
    try { r = await fetchImpl(GT + path, { headers: UA, signal: AbortSignal.timeout(8000) }); }
    catch (e) { lastErr = String(e.message || e).slice(0, 140); await wait(500 * 2 ** i); continue; }
    if (r.status === 429) { lastErr = "GeckoTerminal rate limit"; await wait(1000 * 2 ** i); continue; }
    state.next = now() + gapMs;
    if (!r.ok) throw new Error("GeckoTerminal " + r.status);
    return typeof r.json === "function" ? r.json() : r;
  }
  throw Object.assign(new Error(lastErr), { rateLimit: /rate limit/i.test(lastErr) });
}
const DISCLAIMER = "Heuristic read of public BSC logs and GeckoTerminal prices. Early means among the first buyers in the launch block and the next 10 blocks. A hit is about a 2x move from the first public candle that is still trading. Not a copy-trade list and not financial advice.";

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const gt = path => gtFetchWithBackoff(path);

export function multipleFromOhlcv(list) {
  if (!Array.isArray(list) || !list.length) return { multiple: null, lastTradeTs: null };
  const newest = list[0], oldest = list[list.length - 1];
  const entry = Number(oldest?.[1]), current = Number(newest?.[4]), lastTradeTs = Number(newest?.[0]);
  if (!(entry > 0) || !(current >= 0) || !Number.isFinite(entry) || !Number.isFinite(current)) return { multiple: null, lastTradeTs: Number.isFinite(lastTradeTs) ? lastTradeTs : null };
  return { multiple: current / entry, lastTradeTs: Number.isFinite(lastTradeTs) ? lastTradeTs : null };
}
export function roundMultiple(m) { return m == null || !Number.isFinite(m) ? null : Math.round(m * 100) / 100; }

// null when price, liquidity or recent trades are missing. false is a real miss, not a guess.
export function judgeRun({ multiple, liquidityUsd, txnsH1 }) {
  if (multiple == null || liquidityUsd == null || txnsH1 == null) return null;
  if (!Number.isFinite(multiple) || !(multiple > 0) || !Number.isFinite(liquidityUsd) || !Number.isFinite(txnsH1)) return null;
  return multiple >= RUN_MULTIPLE && liquidityUsd >= MIN_LIQ_USD && txnsH1 > 0;
}
export function isSprayBot(earlyEntries, launchesRead) {
  return launchesRead >= 6 && earlyEntries >= 4 && earlyEntries / launchesRead >= 0.5;
}

function parsePairLog(log, venue) {
  const token0 = wordAddr(log.topics?.[1]?.slice(2)), token1 = wordAddr(log.topics?.[2]?.slice(2));
  if (!token0 || !token1) return null;
  const quote = QUOTES.has(token0) ? token0 : QUOTES.has(token1) ? token1 : null;
  const token = quote == null ? null : quote === token0 ? token1 : token0;
  if (!token || MAJORS.has(token)) return null;
  const w = words(log.data);
  const pair = venue === "pancakeswap-v3" ? wordAddr(w[1]) : wordAddr(w[0]);
  if (!pair || pair === ZERO) return null;
  return { token, pair, block: Number(BigInt(log.blockNumber)), tx: log.transactionHash, venue, creator: null };
}
function parseFourLog(log) {
  const w = words(log.data);
  const creator = wordAddr(w[0]), token = wordAddr(w[1]);
  if (!token || token === ZERO || MAJORS.has(token)) return null;
  return { token, pair: null, block: Number(BigInt(log.blockNumber)), tx: log.transactionHash, venue: "four.meme", creator };
}
export function parseFactoryLogs({ v2 = [], v3 = [], four = [] } = {}) {
  const rows = [];
  for (const log of v2) { const p = parsePairLog(log, "pancakeswap-v2"); if (p) rows.push(p); }
  for (const log of v3) { const p = parsePairLog(log, "pancakeswap-v3"); if (p) rows.push(p); }
  for (const log of four) { const p = parseFourLog(log); if (p) rows.push(p); }
  const by = new Map();
  for (const row of rows) { const prev = by.get(row.token); if (!prev || row.block < prev.block) by.set(row.token, row); }
  return [...by.values()].sort((a, b) => b.block - a.block);
}
function spreadLaunches(arr, max) {
  if (arr.length <= max) return arr;
  const newest = arr.slice(0, Math.min(4, max)), rest = arr.slice(newest.length), picked = [...newest];
  const need = max - picked.length;
  for (let i = 0; i < need; i++) picked.push(rest[Math.min(rest.length - 1, Math.floor((i + 0.5) * rest.length / need))]);
  const seen = new Set();
  return picked.filter(l => !seen.has(l.token) && seen.add(l.token));
}
export function pickLaunches(launches, { head, blockTime, max = MAX_SCORED, minAgeSec = MIN_AGE_SEC } = {}) {
  const bt = blockTime > 0 ? blockTime : 0.45;
  const minBlock = head - Math.round(minAgeSec / bt);
  const eligible = launches.filter(l => l.block <= minBlock).sort((a, b) => b.block - a.block);
  // four.meme launches are the ones GeckoTerminal usually prices. Pancake pairs fill the rest.
  const four = spreadLaunches(eligible.filter(l => l.venue === "four.meme"), max);
  if (four.length >= max) return four.slice(0, max);
  const seen = new Set(four.map(l => l.token));
  const cake = spreadLaunches(eligible.filter(l => l.venue !== "four.meme" && !seen.has(l.token)), max - four.length);
  return [...four, ...cake].slice(0, max);
}

function parseTransfers(logs) {
  return (logs || []).map(l => ({
    block: Number(BigInt(l.blockNumber)), logIndex: Number(BigInt(l.logIndex || "0x0")), tx: l.transactionHash,
    from: wordAddr(l.topics?.[1]?.slice(2)), to: wordAddr(l.topics?.[2]?.slice(2)), value: BigInt(l.data && l.data !== "0x" ? l.data : "0x0"),
  })).filter(e => e.from && e.to && e.value > 0n).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
}
function withRouterHops(ev, venues) {
  const hops = [];
  for (const e of ev) {
    if (!venues.has(e.from) || !ROUTERS.has(e.to)) continue;
    const nxt = ev.find(x => x.tx === e.tx && x.from === e.to && !venues.has(x.to) && !ROUTERS.has(x.to) && x.to !== ZERO && x.to !== DEAD);
    if (nxt) hops.push({ ...e, to: nxt.to, value: nxt.value, logIndex: nxt.logIndex });
  }
  return hops.length ? ev.concat(hops).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex) : ev;
}

export function rankSmartMoney(reads, { minHits = 2, limit = 10 } = {}) {
  const readable = (reads || []).filter(r => r && !r.error && Array.isArray(r.buyers));
  const launchesRead = readable.length;
  const by = new Map();
  for (const r of readable) {
    const early = r.buyers.filter(b => b.early && !b.excluded);
    const seen = new Set();
    for (const b of early) {
      if (seen.has(b.wallet)) continue; seen.add(b.wallet);
      const row = by.get(b.wallet) || { wallet: b.wallet, entries: [], contract: b.contract === true };
      if (b.contract === true) row.contract = true;
      row.entries.push({ token: r.token, symbol: r.symbol || null, entryTime: b.entryTime || null, multiple: r.multiple ?? null, ran: r.ran });
      by.set(b.wallet, row);
    }
  }
  const excluded = { coordinated: 0, routers: 0, contracts: 0, deployers: 0, spray: 0 };
  for (const r of readable) for (const b of r.buyers) if (b.early && b.excluded) excluded[b.excludeReason] = (excluded[b.excludeReason] || 0) + 1;
  const wallets = [];
  for (const row of by.values()) {
    if (row.contract) continue;
    const scored = row.entries.filter(e => e.ran === true || e.ran === false);
    if (isSprayBot(row.entries.length, launchesRead)) { excluded.spray++; continue; }
    const earlyHits = scored.filter(e => e.ran === true).length;
    const earlyEntries = scored.length;
    if (!earlyEntries || earlyHits < 1) continue;
    const times = row.entries.map(e => e.entryTime).filter(Boolean).sort();
    const sample = [...row.entries].sort((a, b) => (b.ran === true) - (a.ran === true) || (b.multiple || 0) - (a.multiple || 0)).slice(0, 4)
      .map(e => ({ token: e.token, symbol: e.symbol, entryTime: e.entryTime, multiple: e.multiple, ran: e.ran }));
    wallets.push({ wallet: row.wallet, earlyHits, earlyEntries, hitRate: Math.round((earlyHits / earlyEntries) * 10000) / 10000, sampleTokens: sample, lastSeen: times.at(-1) || null });
  }
  wallets.sort((a, b) => b.earlyHits - a.earlyHits || b.hitRate - a.hitRate || String(b.lastSeen).localeCompare(String(a.lastSeen)));
  return { launchesRead, excluded, wallets: wallets.filter(w => w.earlyHits >= minHits).slice(0, limit) };
}

const priceCache = new Map();
async function priceOf(token, pairHint, gtFn = gt, preset) {
  const k = token + ":" + (pairHint || "") + (preset ? ":p" : ""); const c = priceCache.get(k);
  if (c && Date.now() - c.at < LAUNCH_TTL && !(c.data && c.data.error)) return c.data;
  const data = await priceOfUncached(token, pairHint, gtFn, preset);
  if (!data.error) priceCache.set(k, { at: Date.now(), data });
  return data;
}
async function priceOfUncached(token, pairHint, gtFn, preset) {
  try {
    if (preset?.pool && preset.liquidityUsd != null && preset.txnsH1 != null) {
      const candle = await gtFn(`/networks/bsc/pools/${preset.pool}/ohlcv/minute?aggregate=15&limit=200&currency=usd&token=base`);
      const { multiple } = multipleFromOhlcv(candle.data?.attributes?.ohlcv_list);
      const multipleR = roundMultiple(multiple);
      const unusable = multipleR != null && (multipleR > 5000 || multipleR <= 0);
      const symbol = candle.meta?.base?.symbol || preset.symbol || null;
      return { multiple: unusable ? null : multipleR, liquidityUsd: Math.round(preset.liquidityUsd * 100) / 100, txnsH1: preset.txnsH1, symbol: symbol ? String(symbol).slice(0, 24) : null, pool: preset.pool, dex: preset.dex || null, createdAt: preset.createdAt || null, error: multipleR == null ? "no usable OHLCV candles" : unusable ? "candle ratio is not a usable price" : null };
    }
    let poolAddr = pairHint, symbol = null, liquidityUsd = null, txnsH1 = null, dex = null;
    const pools = await gtFn(`/networks/bsc/tokens/${token}/pools?page=1`);
    const list = pools.data || [];
    if (!list.length) return { multiple: null, liquidityUsd: null, txnsH1: null, symbol: null, pool: null, dex: null, createdAt: null, error: "no GeckoTerminal pool for this token" };
    const pick = pairHint ? list.find(p => lc(p.attributes?.address) === lc(pairHint)) || list[0] : list[0];
    let createdAt = null;
    if (pick?.attributes) {
      poolAddr = lc(pick.attributes.address || poolAddr);
      dex = pick.relationships?.dex?.data?.id || null;
      createdAt = pick.attributes.pool_created_at || null;
      if (pick.attributes.reserve_in_usd != null && pick.attributes.reserve_in_usd !== "") liquidityUsd = Number(pick.attributes.reserve_in_usd);
      const h1 = pick.attributes.transactions?.h1;
      if (h1) txnsH1 = (Number(h1.buys) || 0) + (Number(h1.sells) || 0);
      symbol = (pick.attributes.name || "").split("/")[0].trim().slice(0, 24) || null;
    }
    if (!poolAddr) return { multiple: null, liquidityUsd, txnsH1, symbol, pool: null, dex, error: "no GeckoTerminal pool for this token" };
    if (txnsH1 == null || liquidityUsd == null) {
      try {
        const one = await gtFn(`/networks/bsc/pools/${poolAddr}`);
        const a = one.data?.attributes || {};
        if (liquidityUsd == null && a.reserve_in_usd != null && a.reserve_in_usd !== "") liquidityUsd = Number(a.reserve_in_usd);
        const h1 = a.transactions?.h1;
        if (txnsH1 == null && h1) txnsH1 = (Number(h1.buys) || 0) + (Number(h1.sells) || 0);
        if (!symbol) symbol = (a.name || "").split("/")[0].trim().slice(0, 24) || null;
        if (!createdAt) createdAt = a.pool_created_at || null;
      } catch { /* missing reserve stays null */ }
    }
    const candle = await gtFn(`/networks/bsc/pools/${poolAddr}/ohlcv/minute?aggregate=15&limit=200&currency=usd&token=base`);
    const { multiple, lastTradeTs } = multipleFromOhlcv(candle.data?.attributes?.ohlcv_list);
    const baseSym = candle.meta?.base?.symbol;
    if (baseSym) symbol = String(baseSym).slice(0, 24);
    if (!Number.isFinite(liquidityUsd)) liquidityUsd = null;
    if (!Number.isFinite(txnsH1)) txnsH1 = null;
    const multipleR = roundMultiple(multiple);
    const unusable = multipleR != null && (multipleR > 5000 || multipleR <= 0);
    return { multiple: unusable ? null : multipleR, liquidityUsd: liquidityUsd == null ? null : Math.round(liquidityUsd * 100) / 100, txnsH1, symbol, pool: poolAddr, dex, createdAt, lastTradeTs, error: multipleR == null ? "no usable OHLCV candles" : unusable ? "candle ratio is not a usable price" : null };
  } catch (e) {
    return { multiple: null, liquidityUsd: null, txnsH1: null, symbol: null, pool: pairHint || null, dex: null, createdAt: null, error: String(e.message || e).slice(0, 140), rateLimit: !!e.rateLimit };
  }
}

function entryTimeIso(block, launch) {
  if (!launch.headTime || !launch.blockTime) return { entryTime: null, entryTimeApprox: false };
  const sec = launch.headTime - (launch.head - block) * launch.blockTime;
  if (!Number.isFinite(sec)) return { entryTime: null, entryTimeApprox: false };
  return { entryTime: new Date(sec * 1000).toISOString(), entryTimeApprox: block !== launch.block };
}

const launchCache = new Map();
async function readLaunch(launch, ctx) {
  const c = launchCache.get(launch.token);
  if (c && Date.now() - c.at < LAUNCH_TTL) return c.data;
  const data = await readLaunchUncached(launch, ctx);
  if (!data.error) launchCache.set(launch.token, { at: Date.now(), data });
  return data;
}
async function readLaunchUncached(launch, ctx) {
  const rpc = ctx.rpc || bscRpc;
  const venues = launch.venue === "four.meme" ? new Set(FOURMEME) : new Set([launch.pair]);
  let creator = launch.creator;
  if (!creator && launch.tx) { try { const t = await rpc("eth_getTransactionByHash", [launch.tx], 6000); creator = lc(t?.from); } catch { creator = null; } }
  const devs = new Set(creator ? [creator] : []);
  let logs;
  try { logs = await rpc("eth_getLogs", [{ address: launch.token, topics: [TRANSFER], fromBlock: hex(Math.max(1, launch.block - 1)), toBlock: hex(launch.block + WINDOW) }], 8000); }
  catch (e) { return { token: launch.token, venue: launch.venue, block: launch.block, error: "early-buy logs failed: " + String(e.message || e).slice(0, 120), buyers: [], ran: null, multiple: null, symbol: null }; }
  let ev = withRouterHops(parseTransfers(logs), venues);
  const indexed = indexEarlyWallets(ev, { venues, devs, token: launch.token, launchBlock: launch.block });
  const ordered = []; const seen = new Set();
  for (const e of indexed.buys) {
    if (ROUTERS.has(e.to) || venues.has(e.to) || MAJORS.has(e.to) || FOURMEME.has(e.to) || e.to === creator) continue;
    if (seen.has(e.to)) continue; seen.add(e.to); ordered.push(e.to);
  }
  const early = new Set(ordered.slice(0, FIRST_N));
  const timed = { ...launch, ...ctx };
  const buyers = indexed.all.filter(w => [...w.how].some(h => /bought/.test(h))).map(w => {
    const isDev = devs.has(w.address);
    const router = ROUTERS.has(w.address) || venues.has(w.address) || FOURMEME.has(w.address);
    const sniper = isCoordinatedSniper(w.how, { isDev });
    let excludeReason = null;
    if (isDev) excludeReason = "deployers";
    else if (router) excludeReason = "routers";
    else if (sniper) excludeReason = "coordinated";
    const t = entryTimeIso(w.firstBlock, timed);
    return { wallet: w.address, early: early.has(w.address), excluded: !!excludeReason, excludeReason, received: w.received.toString(), ...t };
  });
  const price = ctx.skipPrice ? { multiple: null, liquidityUsd: null, txnsH1: null, symbol: null, error: null } : await priceOf(launch.token, launch.pair, ctx.gt || gt, launch.preset);
  const ran = judgeRun(price);
  return { token: launch.token, symbol: price.symbol || null, venue: launch.venue, block: launch.block, pair: price.pool || launch.pair, buyers, ran, multiple: price.multiple ?? null, liquidityUsd: price.liquidityUsd ?? null, txnsH1: price.txnsH1 ?? null, priceError: price.error || null, rateLimit: !!price.rateLimit, error: null, creator };
}

async function markContracts(reads, rpc = bscRpc) {
  const addrs = [...new Set(reads.flatMap(r => (r.buyers || []).filter(b => b.early && !b.excluded).map(b => b.wallet)))];
  const code = new Map(); let failed = 0;
  await pool(addrs.slice(0, 40), 6, async a => {
    try { const c = await rpc("eth_getCode", [a, "latest"], 5000); code.set(a, !!(c && c !== "0x")); }
    catch { code.set(a, null); failed++; }
  });
  for (const r of reads) for (const b of r.buyers || []) {
    if (!b.early || b.excluded) continue;
    const isC = code.get(b.wallet);
    if (isC === true) { b.excluded = true; b.excludeReason = "contracts"; b.contract = true; }
    else b.contract = isC === false ? false : null;
  }
  return { checked: Math.min(addrs.length, 80), failed, truncated: addrs.length > 80 };
}


const PER_TICK = 4, SLICE_BLOCKS = 20000, MAX_STORED = 160;
const snapMemo = { at: 0, state: undefined };

function emptyState() {
  return { version: 1, updatedAt: null, cursorBlock: null, gtPage: 1, passes: 0, oldestBlock: null, head: null, headTime: null, blockTime: 0.45, queue: [], launches: {}, errors: [], ranked: [], partial: true, lookback_hours: null, coverage: {} };
}
function parseGtNewPools(j) {
  const inc = new Map((j?.included || []).map(x => [x.id, x]));
  const out = [];
  for (const p of j?.data || []) {
    const a = p.attributes || {};
    const dex = p.relationships?.dex?.data?.id || "";
    if (!/four|pancake/i.test(dex)) continue;
    const base = inc.get(p.relationships?.base_token?.data?.id);
    const token = lc(base?.attributes?.address || "");
    if (!/^0x[0-9a-f]{40}$/.test(token) || MAJORS.has(token)) continue;
    const h1 = a.transactions?.h1;
    const txnsH1 = h1 ? (Number(h1.buys) || 0) + (Number(h1.sells) || 0) : null;
    const liquidityUsd = a.reserve_in_usd == null || a.reserve_in_usd === "" ? null : Number(a.reserve_in_usd);
    out.push({
      token, pair: lc(a.address || ""), dex, createdAt: a.pool_created_at || null, txnsH1, liquidityUsd,
      symbol: base?.attributes?.symbol ? String(base.attributes.symbol).slice(0, 24) : null,
      venue: /four/i.test(dex) ? "four.meme" : /v3|infinity/i.test(dex) ? "pancakeswap-v3" : "pancakeswap-v2",
    });
  }
  return out;
}

export async function warmSmartMoneyTick(prev, opts = {}) {
  const rpc = opts.rpc || bscRpc;
  const gtFn = opts.gt || gt;
  const budgetMs = opts.budgetMs ?? 40000;
  const perTick = opts.perTick ?? PER_TICK;
  const sliceBlocks = opts.sliceBlocks ?? SLICE_BLOCKS;
  const until = Date.now() + budgetMs;
  const state = prev ? JSON.parse(JSON.stringify(prev)) : emptyState();
  state.queue ||= []; state.launches ||= {}; state.errors = [];
  const errors = [];
  const head = Number(BigInt(await rpc("eth_blockNumber", [], 6000)));
  const headBlock = await rpc("eth_getBlockByNumber", [hex(head), false], 6000);
  const headTime = Number(BigInt(headBlock.timestamp));
  const past = await rpc("eth_getBlockByNumber", [hex(Math.max(1, head - 20000)), false], 6000);
  const blockTime = (headTime - Number(BigInt(past.timestamp))) / 20000 || state.blockTime || 0.45;
  let oldest = Math.max(1, head - Math.round(LOOKBACK_CAP_HOURS * 3600 / blockTime));
  try { await rpc("eth_getLogs", [{ address: V2_FACTORY, topics: [PAIR_CREATED], fromBlock: hex(oldest), toBlock: hex(Math.min(head, oldest + 5)) }], 8000); }
  catch (e) {
    errors.push("logs at about 48h failed: " + String(e.message || e).slice(0, 100));
    oldest = Math.max(1, head - Math.round(24 * 3600 / blockTime));
  }
  state.head = head; state.headTime = headTime; state.blockTime = blockTime; state.oldestBlock = oldest;
  for (const token of Object.keys(state.launches)) if (state.launches[token].block < oldest) delete state.launches[token];
  state.queue = state.queue.filter(l => l.block >= oldest && !state.launches[l.token]);

  if (Date.now() < until && opts.gtPages !== false) {
    const page = state.gtPage >= 1 && state.gtPage <= 10 ? state.gtPage : 1;
    try {
      const listed = parseGtNewPools(await gtFn(`/networks/bsc/new_pools?page=${page}&include=base_token,dex`));
      const known = new Set([...Object.keys(state.launches), ...state.queue.map(l => l.token)]);
      const alive = listed.filter(l => !known.has(l.token) && l.txnsH1 >= 5 && l.liquidityUsd >= MIN_LIQ_USD && l.pair)
        .sort((a, b) => b.txnsH1 - a.txnsH1 || b.liquidityUsd - a.liquidityUsd);
      for (const l of alive.slice(0, perTick)) {
        if (Date.now() > until) break;
        let block = null;
        if (l.createdAt && Number.isFinite(Date.parse(l.createdAt))) {
          try { block = await (opts.blockAt || bscBlockAt)(Math.floor(Date.parse(l.createdAt) / 1000), head); } catch (e) { errors.push(`launch block for ${l.token} failed: ${String(e.message || e).slice(0, 80)}`); }
        }
        if (!block || block > head - Math.round(MIN_AGE_SEC / blockTime)) continue;
        state.queue.push({ token: l.token, pair: l.pair, block, tx: null, venue: l.venue, creator: null, tries: 0, preset: { pool: l.pair, liquidityUsd: l.liquidityUsd, txnsH1: l.txnsH1, symbol: l.symbol, dex: l.dex, createdAt: l.createdAt } });
        known.add(l.token);
      }
      state.gtPage = page >= 10 ? 1 : page + 1;
    } catch (e) { errors.push("GeckoTerminal new pools failed: " + String(e.message || e).slice(0, 120)); }
  }
  if (Date.now() < until) {
    // Always walk backward one slice per run, and keep only a few launches from it.
    // A long queue of the newest slice would stop the cursor and never reach launches old enough to have run.
    let cursor = state.cursorBlock;
    if (cursor == null || cursor <= oldest + 10) cursor = head;
    const to = Math.min(head, cursor);
    const from = Math.max(oldest, to - sliceBlocks + 1);
    const found = { v2: [], v3: [], four: [] };
    const pull = async (address, topic, key) => {
      try { found[key].push(...await rpc("eth_getLogs", [{ address, topics: [topic], fromBlock: hex(from), toBlock: hex(to) }], 9000)); }
      catch (e) { errors.push(`${key} logs ${from}-${to} failed: ${String(e.message || e).slice(0, 100)}`); }
    };
    await Promise.all([pull(V2_FACTORY, PAIR_CREATED, "v2"), pull(V3_FACTORY, POOL_CREATED, "v3"), pull(FOUR_MANAGER, TOKEN_CREATE, "four")]);
    const known = new Set([...Object.keys(state.launches), ...state.queue.map(l => l.token)]);
    const discovered = parseFactoryLogs(found).filter(l => !known.has(l.token));
    const picked = [...discovered.filter(l => l.venue === "four.meme"), ...discovered.filter(l => l.venue !== "four.meme")].slice(0, perTick);
    for (const l of picked) state.queue.push({ token: l.token, pair: l.pair, block: l.block, tx: l.tx, venue: l.venue, creator: l.creator, tries: 0 });
    const wrapped = from <= oldest + 1;
    state.cursorBlock = wrapped ? head : from - 1;
    if (wrapped && cursor !== head) state.passes = (state.passes || 0) + 1;
  }

  const minBlock = head - Math.round(MIN_AGE_SEC / blockTime);
  const ready = state.queue.filter(l => l.block <= minBlock).sort((a, b) => (b.preset ? 1 : 0) - (a.preset ? 1 : 0) || (b.venue === "four.meme") - (a.venue === "four.meme") || b.block - a.block);
  const scoredNow = [];
  for (const launch of ready.slice(0, perTick)) {
    if (Date.now() > until) { errors.push("stopped early so the cron stays inside the time limit"); break; }
    const row = await readLaunch(launch, { head, headTime, blockTime, rpc, gt: gtFn });
    state.queue = state.queue.filter(l => l.token !== launch.token);
    if (row.rateLimit && (launch.tries || 0) < 2) {
      state.queue.push({ ...launch, tries: (launch.tries || 0) + 1 });
      errors.push(`${launch.token} price was rate-limited; it stays queued`);
      continue;
    }
    let decimals = null;
    try { const d = await rpc("eth_call", [{ to: launch.token, data: "0x313ce567" }, "latest"], 5000); const n = Number(BigInt(d || "0x0")); if (n >= 0 && n <= 36) decimals = n; }
    catch { decimals = null; }
    row.buyers = (row.buyers || []).slice(0, 40);
    state.launches[launch.token] = { ...row, decimals, readAt: new Date().toISOString() };
    scoredNow.push(state.launches[launch.token]);
  }
  if (scoredNow.length) await markContracts(scoredNow, rpc);
  const kept = Object.values(state.launches).sort((a, b) => b.block - a.block).slice(0, MAX_STORED);
  state.launches = Object.fromEntries(kept.map(r => [r.token, r]));
  const reads = Object.values(state.launches);
  const ranked = rankSmartMoney(reads, { minHits: 1, limit: 100 });
  const priceErrors = reads.filter(r => r.priceError);
  if (priceErrors.length) errors.push(`price or liquidity missing for ${priceErrors.length} stored launch(es); they are not counted as hits or misses`);
  const oldestScored = reads.length ? Math.min(...reads.map(r => r.block)) : (state.cursorBlock || head);
  const lookbackHours = Math.round(((head - oldestScored) * blockTime / 3600) * 10) / 10;
  state.updatedAt = new Date().toISOString();
  state.errors = errors.slice(0, 12);
  state.lookback_hours = lookbackHours;
  state.partial = state.queue.length > 0 || (state.passes || 0) < 1 || priceErrors.length > 0 || errors.some(e => /failed|rate|stopped/i.test(e));
  state.ranked = ranked.wallets;
  state.coverage = {
    launchesScored: reads.length, launchesQueued: state.queue.length, launchesPriced: reads.filter(r => !r.error && r.ran !== null).length,
    launchesRan: reads.filter(r => r.ran === true).length, launchesDidNotRun: reads.filter(r => r.ran === false).length,
    passes: state.passes || 0, scoredThisTick: scoredNow.length, cursorBlock: state.cursorBlock,
    fundingLinks: "bundled transactions and dev hand-outs use the bundle-check classifier. Shared-funder links are not re-read.",
    excluded: ranked.excluded,
    note: "The cron samples more launches on each run and stores them. A paid call only reads this snapshot. Hit rate ignores a launch whose price is missing. About 2x is the first public candle versus the latest close, not the wallet's fill.",
  };
  return state;
}

export function feedFromState(state, { limit, minHits } = {}) {
  if (!state?.updatedAt) throw Object.assign(new Error("smart-money cache is empty (the cron has not filled it yet), not charged"), { status: 502 });
  const lim = clampLimit(limit), min = clampMinHits(minHits);
  const wallets = (state.ranked || []).filter(w => w.earlyHits >= min).slice(0, lim);
  return {
    type: "bsc-smart-money", chain: "bsc", generatedAt: state.updatedAt, cached: true, precomputed: true,
    lookback_hours: state.lookback_hours,
    lookback_note: `Precomputed from free public BNB Chain logs. The oldest scored launch in this snapshot is about ${state.lookback_hours} hours back. The usual cap is about ${LOOKBACK_CAP_HOURS} hours. Each cron run samples another slice; this is not every launch in that window.`,
    partial: !!state.partial, errors: state.errors || [],
    filters: { limit: lim, minHits: min, runMultiple: RUN_MULTIPLE, earlyBlocks: WINDOW, firstBuyers: FIRST_N, minLiquidityUsd: MIN_LIQ_USD },
    coverage: state.coverage || {}, count: wallets.length, wallets, disclaimer: DISCLAIMER,
  };
}

export function walletFromState(state, wallet) {
  if (!state?.updatedAt) throw Object.assign(new Error("smart-money cache is empty (the cron has not filled it yet), not charged"), { status: 502 });
  const buys = [];
  for (const row of Object.values(state.launches || {})) {
    for (const b of row.buyers || []) {
      if (b.wallet !== wallet) continue;
      const early = !!(b.early && !b.excluded);
      buys.push({
        token: row.token, symbol: row.symbol || null, time: b.entryTime || null, timeApprox: !!b.entryTimeApprox,
        size: formatUnits(b.received, row.decimals), sizeRaw: b.received || null, decimals: row.decimals ?? null,
        early, earlyBasis: early ? "first_blocks" : null,
        status: row.ran === true ? "ran" : row.ran === false ? "did_not_run" : "unknown",
        multiple: row.multiple ?? null,
        stillTrading: row.liquidityUsd == null || row.txnsH1 == null ? null : row.liquidityUsd >= MIN_LIQ_USD && row.txnsH1 > 0,
        liquidityUsd: row.liquidityUsd ?? null, priceError: row.priceError || null,
      });
    }
  }
  buys.sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
  const shown = buys.slice(0, 20);
  return {
    type: "bsc-smart-money-wallet", chain: "bsc", wallet, generatedAt: state.updatedAt, cached: true, precomputed: true,
    lookback_hours: state.lookback_hours,
    lookback_note: `Receipts come from the launches the cron has already scored, about ${state.lookback_hours} hours back. The usual cap is about ${LOOKBACK_CAP_HOURS} hours. This call does not scan logs.`,
    partial: !!state.partial || shown.some(b => b.status === "unknown"),
    errors: state.errors || [], count: shown.length, buys: shown,
    coverage: { launchesScored: Object.keys(state.launches || {}).length, receipts: buys.length, listed: shown.length, note: "Each row is a buy in a scored launch's first blocks. early is true only for the first 20 buyers who are not a router, deployer, or bundled sniper. size is tokens received, not USD." },
    disclaimer: DISCLAIMER,
  };
}

async function loadSnapshot() {
  if (snapMemo.state !== undefined && Date.now() - snapMemo.at < 20000) return snapMemo.state;
  const state = await (await activeStore()).load();
  snapMemo.at = Date.now(); snapMemo.state = state || null;
  return snapMemo.state;
}
export async function runSmartMoneyCron(opts = {}) {
  const store = opts.store || await activeStore();
  const prev = opts.prev !== undefined ? opts.prev : await store.load();
  const next = await warmSmartMoneyTick(prev, opts);
  await store.save(next);
  snapMemo.at = Date.now(); snapMemo.state = next;
  return { ok: true, lookback_hours: next.lookback_hours, partial: next.partial, launchesScored: next.coverage.launchesScored, launchesQueued: next.coverage.launchesQueued, launchesRan: next.coverage.launchesRan, scoredThisTick: next.coverage.scoredThisTick, wallets: next.ranked.length, passes: next.passes || 0, errors: next.errors };
}
export async function bscSmartMoney({ limit, minHits } = {}) {
  try { return feedFromState(await loadSnapshot(), { limit, minHits }); }
  catch (e) { if (e.status) throw e; throw Object.assign(new Error("smart-money cache read failed, not charged: " + String(e.message || e).slice(0, 160)), { status: 502 }); }
}
export async function bscSmartMoneyWallet(walletIn) {
  try { return walletFromState(await loadSnapshot(), lc(walletIn)); }
  catch (e) { if (e.status) throw e; throw Object.assign(new Error("smart-money cache read failed, not charged: " + String(e.message || e).slice(0, 160)), { status: 502 }); }
}

function formatUnits(raw, decimals) {
  if (decimals == null || raw == null) return null;
  let v; try { v = BigInt(raw); } catch { return null; }
  const neg = v < 0n, s = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + (frac ? `${whole}.${frac}` : whole);
}

export function clampLimit(v) {
  if (v == null || v === "") return 10;
  const n = +v; if (!Number.isInteger(n) || n < 1 || n > 20) throw Object.assign(new Error("limit must be an integer from 1 to 20"), { status: 400 });
  return n;
}
export function clampMinHits(v) {
  if (v == null || v === "") return 2;
  const n = +v; if (!Number.isInteger(n) || n < 1 || n > 10) throw Object.assign(new Error("minHits must be an integer from 1 to 10"), { status: 400 });
  return n;
}
