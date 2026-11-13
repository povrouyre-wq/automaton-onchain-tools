// BNB Chain smart-money feed ($0.02): wallets that repeatedly bought in the first blocks of four.meme and PancakeSwap
// launches that then ran (about 2x vs the first public candle, and still trading). Free public BSC logs only, so the
// window is whatever those nodes still serve (about 2 days, often less). Prices come from GeckoTerminal. Nothing here
// is filled in when a source fails: the field stays null and partial is set.
import { FOURMEME, WINDOW, indexEarlyWallets, isCoordinatedSniper, bscRpc, bscCall } from "./bundles.js";

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
const FEED_TTL = 10 * 60 * 1000, LAUNCH_TTL = 20 * 60 * 1000, WALLET_TTL = 10 * 60 * 1000;
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
const topicAddr = a => "0x" + a.slice(2).padStart(64, "0");
const UA = { accept: "application/json", "user-agent": "automaton-onchain-tools/1.16 (+https://automaton-tx-explainer.vercel.app)" };
let gtPauseUntil = 0;
const DISCLAIMER = "Heuristic read of public BSC logs and GeckoTerminal prices. Early means among the first buyers in the launch block and the next 10 blocks. A hit is about a 2x move from the first public candle that is still trading. Not a copy-trade list and not financial advice.";

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
async function gt(path) {
  if (Date.now() < gtPauseUntil) throw Object.assign(new Error("GeckoTerminal rate limit"), { rateLimit: true });
  const r = await fetch(GT + path, { headers: UA, signal: AbortSignal.timeout(6000) });
  if (r.status === 429) { gtPauseUntil = Date.now() + 20000; throw Object.assign(new Error("GeckoTerminal rate limit"), { rateLimit: true }); }
  if (!r.ok) throw new Error("GeckoTerminal " + r.status);
  return r.json();
}

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
async function priceOf(token, pairHint) {
  const k = token + ":" + (pairHint || ""); const c = priceCache.get(k);
  if (c && Date.now() - c.at < LAUNCH_TTL && !(c.data && c.data.error)) return c.data;
  const data = await priceOfUncached(token, pairHint);
  if (!data.error) priceCache.set(k, { at: Date.now(), data });
  return data;
}
async function priceOfUncached(token, pairHint) {
  try {
    let poolAddr = pairHint, symbol = null, liquidityUsd = null, txnsH1 = null, dex = null;
    const pools = await gt(`/networks/bsc/tokens/${token}/pools?page=1`);
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
        const one = await gt(`/networks/bsc/pools/${poolAddr}`);
        const a = one.data?.attributes || {};
        if (liquidityUsd == null && a.reserve_in_usd != null && a.reserve_in_usd !== "") liquidityUsd = Number(a.reserve_in_usd);
        const h1 = a.transactions?.h1;
        if (txnsH1 == null && h1) txnsH1 = (Number(h1.buys) || 0) + (Number(h1.sells) || 0);
        if (!symbol) symbol = (a.name || "").split("/")[0].trim().slice(0, 24) || null;
        if (!createdAt) createdAt = a.pool_created_at || null;
      } catch { /* missing reserve stays null */ }
    }
    const candle = await gt(`/networks/bsc/pools/${poolAddr}/ohlcv/minute?aggregate=15&limit=200&currency=usd&token=base`);
    const { multiple, lastTradeTs } = multipleFromOhlcv(candle.data?.attributes?.ohlcv_list);
    const baseSym = candle.meta?.base?.symbol;
    if (baseSym) symbol = String(baseSym).slice(0, 24);
    if (!Number.isFinite(liquidityUsd)) liquidityUsd = null;
    if (!Number.isFinite(txnsH1)) txnsH1 = null;
    return { multiple: roundMultiple(multiple), liquidityUsd: liquidityUsd == null ? null : Math.round(liquidityUsd * 100) / 100, txnsH1, symbol, pool: poolAddr, dex, createdAt, lastTradeTs, error: multiple == null ? "no usable OHLCV candles" : null };
  } catch (e) {
    return { multiple: null, liquidityUsd: null, txnsH1: null, symbol: null, pool: pairHint || null, dex: null, error: String(e.message || e).slice(0, 140), rateLimit: !!e.rateLimit };
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
  const venues = launch.venue === "four.meme" ? new Set(FOURMEME) : new Set([launch.pair]);
  let creator = launch.creator;
  if (!creator && launch.tx) { try { const t = await bscRpc("eth_getTransactionByHash", [launch.tx], 6000); creator = lc(t?.from); } catch { creator = null; } }
  const devs = new Set(creator ? [creator] : []);
  let logs;
  try { logs = await bscRpc("eth_getLogs", [{ address: launch.token, topics: [TRANSFER], fromBlock: hex(Math.max(1, launch.block - 1)), toBlock: hex(launch.block + WINDOW) }], 8000); }
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
  const price = ctx.skipPrice ? { multiple: null, liquidityUsd: null, txnsH1: null, symbol: null, error: null } : await priceOf(launch.token, launch.pair);
  const ran = judgeRun(price);
  return { token: launch.token, symbol: price.symbol || null, venue: launch.venue, block: launch.block, pair: price.pool || launch.pair, buyers, ran, multiple: price.multiple ?? null, liquidityUsd: price.liquidityUsd ?? null, txnsH1: price.txnsH1 ?? null, priceError: price.error || null, error: null, creator };
}

async function markContracts(reads) {
  const addrs = [...new Set(reads.flatMap(r => (r.buyers || []).filter(b => b.early && !b.excluded).map(b => b.wallet)))];
  const code = new Map(); let failed = 0;
  await pool(addrs.slice(0, 80), 10, async a => {
    try { const c = await bscRpc("eth_getCode", [a, "latest"], 5000); code.set(a, !!(c && c !== "0x")); }
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

function ranges(head, oldest) {
  const width = 3500, n = 6, out = [];
  for (let i = 0; i < n; i++) {
    const end = i === 0 ? head : Math.max(oldest + width, head - Math.round((head - oldest) * i / (n - 1)));
    out.push([Math.max(oldest, end - width), Math.min(head, end)]);
  }
  return out;
}
async function discover(head, oldest, errors) {
  const found = { v2: [], v3: [], four: [] };
  await pool(ranges(head, oldest), 4, async ([from, to]) => {
    const q = async (address, topic, key) => {
      try { found[key].push(...await bscRpc("eth_getLogs", [{ address, topics: [topic], fromBlock: hex(from), toBlock: hex(to) }], 9000)); }
      catch (e) { errors.push(`${key} logs ${from}-${to} failed: ${String(e.message || e).slice(0, 100)}`); }
    };
    await Promise.all([q(V2_FACTORY, PAIR_CREATED, "v2"), q(V3_FACTORY, POOL_CREATED, "v3"), q(FOUR_MANAGER, TOKEN_CREATE, "four")]);
  });
  return parseFactoryLogs(found);
}

const feedCache = { at: 0, core: null }; let feedInflight = null; let knownLaunches = [];
async function computeFeed() {
  const errors = [];
  const head = Number(BigInt(await bscRpc("eth_blockNumber", [], 6000)));
  const headBlock = await bscRpc("eth_getBlockByNumber", [hex(head), false], 6000);
  const headTime = Number(BigInt(headBlock.timestamp));
  const past = await bscRpc("eth_getBlockByNumber", [hex(Math.max(1, head - 20000)), false], 6000);
  const blockTime = (headTime - Number(BigInt(past.timestamp))) / 20000 || 0.45;
  let oldest = Math.max(1, head - Math.round(LOOKBACK_CAP_HOURS * 3600 / blockTime));
  try { await bscRpc("eth_getLogs", [{ address: V2_FACTORY, topics: [PAIR_CREATED], fromBlock: hex(oldest), toBlock: hex(oldest + 5) }], 8000); }
  catch (e) {
    errors.push("logs at about 48h failed: " + String(e.message || e).slice(0, 100));
    let found = false;
    for (const h of [36, 24, 12, 6]) {
      const from = Math.max(1, head - Math.round(h * 3600 / blockTime));
      try { await bscRpc("eth_getLogs", [{ address: V2_FACTORY, topics: [PAIR_CREATED], fromBlock: hex(from), toBlock: hex(from + 5) }], 8000); oldest = from; found = true; break; }
      catch (err) { errors.push(`logs about ${h}h back failed: ${String(err.message || err).slice(0, 80)}`); }
    }
    if (!found) throw Object.assign(new Error("BNB Chain log history could not be read, not charged"), { status: 502 });
  }
  const lookbackHours = Math.round(((head - oldest) * blockTime / 3600) * 10) / 10;
  const discovered = await discover(head, oldest, errors);
  knownLaunches = discovered;
  if (!discovered.length && errors.length) throw Object.assign(new Error("BNB Chain launch logs failed, not charged: " + errors[0]), { status: 502 });
  const picked = pickLaunches(discovered, { head, blockTime });
  const ctx = { head, headTime, blockTime };
  const reads = (await pool(picked, 2, launch => readLaunch(launch, ctx))).filter(Boolean);
  if (picked.length && !reads.some(r => !r.error)) throw Object.assign(new Error("early-buy logs failed for every sampled launch, not charged"), { status: 502 });
  const code = await markContracts(reads);
  if (code.failed) errors.push(`contract-code read failed for ${code.failed} early wallet(s); those wallets were kept, not dropped`);
  const priced = reads.filter(r => !r.error && r.ran !== null).length;
  const priceErrors = reads.filter(r => r.priceError);
  if (priceErrors.length) errors.push(`price or liquidity missing for ${priceErrors.length} launch(es); they are not counted as hits or misses. Example: ${priceErrors[0].token} ${priceErrors[0].priceError}`);
  const ranked = rankSmartMoney(reads, { minHits: 1, limit: 100 });
  const partial = errors.length > 0 || discovered.length > reads.filter(r => !r.error).length || code.truncated || code.failed > 0;
  return {
    type: "bsc-smart-money", chain: "bsc", generatedAt: new Date().toISOString(), cached: false,
    lookback_hours: lookbackHours,
    lookback_note: `Free public BNB Chain RPC answered logs about ${lookbackHours} hours back on this call. The usual cap is about ${LOOKBACK_CAP_HOURS} hours and it moves as nodes prune. Early-buyer reads cover a sample of four.meme and PancakeSwap v2/v3 launches inside that window, not every launch.`,
    partial, errors,
    filters: { limit: 10, minHits: 2, runMultiple: RUN_MULTIPLE, earlyBlocks: WINDOW, firstBuyers: FIRST_N, minLiquidityUsd: MIN_LIQ_USD },
    coverage: {
      launchesDiscovered: discovered.length, launchesRead: reads.filter(r => !r.error).length, launchesPriced: priced,
      launchesRan: reads.filter(r => r.ran === true).length, launchesDidNotRun: reads.filter(r => r.ran === false).length,
      tooNewToScore: discovered.filter(l => l.block > head - Math.round(MIN_AGE_SEC / blockTime)).length,
      codeChecks: code, fundingLinks: "bundled transactions and dev hand-outs use the bundle-check classifier. Shared-funder links (full blocks before launch) are not re-read on this multi-launch call.",
      excluded: ranked.excluded,
      note: "Hit rate uses only launches where price, liquidity and recent trades were all read. A missing price is left out of the rate. About 2x is the first 15-minute candle's open versus the latest close, which is not the wallet's fill.",
    },
    wallets: ranked.wallets,
    disclaimer: DISCLAIMER,
  };
}
async function coreFeed() {
  if (feedCache.core && Date.now() - feedCache.at < FEED_TTL) return { ...feedCache.core, cached: true, generatedAt: feedCache.core.generatedAt };
  if (!feedInflight) feedInflight = computeFeed().then(core => { feedCache.at = Date.now(); feedCache.core = core; return core; }).finally(() => { feedInflight = null; });
  return feedInflight;
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
export async function bscSmartMoney({ limit, minHits } = {}) {
  const lim = clampLimit(limit), min = clampMinHits(minHits);
  let core;
  try { core = await coreFeed(); }
  catch (e) { if (e.status) throw e; throw Object.assign(new Error("BNB Chain smart-money feed failed, not charged: " + String(e.message || e).slice(0, 160)), { status: 502 }); }
  const wallets = core.wallets.filter(w => w.earlyHits >= min).slice(0, lim);
  return { ...core, cached: !!core.cached, filters: { ...core.filters, limit: lim, minHits: min }, count: wallets.length, wallets };
}

function formatUnits(raw, decimals) {
  if (decimals == null || raw == null) return null;
  const v = BigInt(raw), neg = v < 0n, s = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + (frac ? `${whole}.${frac}` : whole);
}
async function decimalsOf(token) {
  try { const r = await bscRpc("eth_call", [{ to: token, data: "0x313ce567" }, "latest"], 5000); const n = Number(BigInt(r || "0x0")); return n >= 0 && n <= 36 ? n : null; }
  catch { return null; }
}

const walletCache = new Map();
export async function bscSmartMoneyWallet(walletIn) {
  const wallet = lc(walletIn);
  const hit = walletCache.get(wallet);
  if (hit && Date.now() - hit.at < WALLET_TTL) return { ...hit.data, cached: true };
  let data;
  try { data = await walletUncached(wallet); }
  catch (e) { if (e.status) throw e; throw Object.assign(new Error("BNB Chain wallet lookback failed, not charged: " + String(e.message || e).slice(0, 160)), { status: 502 }); }
  walletCache.set(wallet, { at: Date.now(), data });
  return { ...data, cached: false };
}
async function walletUncached(wallet) {
  const errors = [];
  // Public BSC RPCs reject eth_getLogs with no contract address, so receipts are read per launch we already found.
  await coreFeed();
  const launches = knownLaunches;
  if (!launches.length) throw Object.assign(new Error("no four.meme or PancakeSwap launches in the log window, not charged"), { status: 502 });
  const head = Number(BigInt(await bscRpc("eth_blockNumber", [], 6000)));
  const headBlock = await bscRpc("eth_getBlockByNumber", [hex(head), false], 6000);
  const headTime = Number(BigInt(headBlock.timestamp));
  const past = await bscRpc("eth_getBlockByNumber", [hex(Math.max(1, head - 20000)), false], 6000);
  const blockTime = (headTime - Number(BigInt(past.timestamp))) / 20000 || 0.45;
  const sorted = [...launches].sort((a, b) => b.block - a.block);
  const watched = spreadLaunches(sorted, 15);
  const floor = Math.max(1, Math.min(...watched.map(l => l.block)) - 5);
  const byToken = new Map(watched.map(l => [l.token, l]));
  // Public nodes reject big address batches and answer "forbidden" as plain text. Keep batches small.
  const batches = []; for (let i = 0; i < watched.length; i += 5) batches.push(watched.slice(i, i + 5).map(l => l.token));
  const events = []; let oldest = head, failed = false, stopped = false;
  const logUrls = (process.env.BSC_LOG_RPC || "https://bsc-rpc.publicnode.com").split(",");
  const until = Date.now() + 18000;
  await pool(batches, 2, async addrs => {
    let to = head, span = 50000;
    for (let guard = 0; guard < 10 && to >= floor && events.length < 1500; guard++) {
      if (Date.now() > until) { stopped = true; break; }
      const from = Math.max(floor, to - span + 1);
      try {
        const logs = await bscCall(logUrls, "eth_getLogs", [{ address: addrs, topics: [TRANSFER, null, topicAddr(wallet)], fromBlock: hex(from), toBlock: hex(to) }], 8000);
        for (const l of logs) events.push(l);
        oldest = Math.min(oldest, from); to = from - 1; span = 50000;
      } catch (e) {
        const msg = String(e.message || e);
        if (/max results|too many|exceed|limit|response size/i.test(msg) && span > 5000) { span = Math.max(5000, Math.floor(span / 4)); continue; }
        errors.push(`transfer logs ${from}-${to} failed: ${msg.slice(0, 120)}`);
        failed = true; break;
      }
    }
  });
  if (!events.length && failed && oldest === head) throw Object.assign(new Error("BNB Chain transfer logs failed, not charged: " + errors[0]), { status: 502 });
  const lookbackHours = Math.round(((head - oldest) * blockTime / 3600) * 10) / 10;
  const incoming = events.map(l => ({
    token: lc(l.address), block: Number(BigInt(l.blockNumber)), tx: l.transactionHash,
    from: wordAddr(l.topics?.[1]?.slice(2)), value: BigInt(l.data && l.data !== "0x" ? l.data : "0x0"),
  })).filter(e => e.token && e.from && e.value > 0n && !MAJORS.has(e.token) && e.token !== wallet);
  const grouped = new Map();
  for (const e of incoming) {
    const g = grouped.get(e.token) || { token: e.token, value: 0n, block: e.block, from: e.from, tx: e.tx };
    g.value += e.value; if (e.block < g.block) { g.block = e.block; g.from = e.from; g.tx = e.tx; }
    grouped.set(e.token, g);
  }
  const groups = [...grouped.values()].sort((a, b) => b.block - a.block);
  const truncated = groups.length > 8 || events.length >= 1500;
  const slice = groups.slice(0, 8);
  const buys = await pool(slice, 3, async g => {
    const launch = byToken.get(g.token);
    const [dec, code, detail] = await Promise.all([
      decimalsOf(g.token),
      bscRpc("eth_getCode", [g.from, "latest"], 5000).then(c => c && c !== "0x").catch(() => null),
      launch ? readLaunch(launch, { head, headTime, blockTime }).catch(e => ({ error: String(e.message || e).slice(0, 120), buyers: [], ran: null, multiple: null })) : Promise.resolve(null),
    ]);
    const launchBlock = launch?.block ?? null;
    let early = null, earlyBasis = null;
    if (launchBlock != null && g.block > launchBlock + WINDOW) { early = false; }
    else if (launchBlock != null && g.block >= launchBlock && detail && !detail.error) {
      const row = (detail.buyers || []).find(b => b.wallet === wallet);
      early = row ? row.early && !row.excluded : null;
      earlyBasis = early ? "first_blocks" : null;
    }
    const ran = detail ? detail.ran : null;
    const sec = headTime - (head - g.block) * blockTime;
    const via = ROUTERS.has(g.from) || FOURMEME.has(g.from) || (launch?.pair && g.from === launch.pair) ? "router_or_launchpad" : code === true ? "contract" : code === false ? "wallet" : "unknown";
    return {
      token: g.token, symbol: detail?.symbol || null, time: Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null, timeApprox: true,
      size: formatUnits(g.value, dec), sizeRaw: g.value.toString(), decimals: dec,
      via, early, earlyBasis, status: ran === true ? "ran" : ran === false ? "did_not_run" : "unknown",
      multiple: detail?.multiple ?? null, stillTrading: detail?.liquidityUsd == null || detail?.txnsH1 == null ? null : detail.liquidityUsd >= MIN_LIQ_USD && detail.txnsH1 > 0,
      liquidityUsd: detail?.liquidityUsd ?? null, priceError: detail?.priceError || detail?.error || null,
    };
  });
  const shown = buys.filter(b => b && b.via !== "wallet");
  if (buys.some(b => b?.priceError)) errors.push("one or more prices could not be read; status is unknown for those, not guessed");
  if (stopped && oldest > floor) errors.push("stopped early so the call stays inside the time limit; lookback_hours is only the span actually read");
  const partial = failed || stopped || truncated || errors.length > 0;
  return {
    type: "bsc-smart-money-wallet", chain: "bsc", wallet, generatedAt: new Date().toISOString(),
    lookback_hours: lookbackHours,
    lookback_note: `Free public BNB Chain RPC cannot filter every token transfer to a wallet, so this reads receipts of ${watched.length} launches about ${lookbackHours} hours back. The usual cap is about ${LOOKBACK_CAP_HOURS} hours. Plain wallet-to-wallet transfers are left out.`,
    partial, errors, count: shown.length,
    buys: shown,
    coverage: { launchesChecked: watched.length, receipts: incoming.length, tokens: groups.length, listed: shown.length, omittedWalletTransfers: buys.filter(b => b?.via === "wallet").length, truncated, note: "early is true only when this wallet is among the first 20 buyers in the launch block and the next 10 blocks, and not a bundled sniper, router or deployer. size is tokens received, not USD." },
    disclaimer: DISCLAIMER,
  };
}
