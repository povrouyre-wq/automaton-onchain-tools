// New-token launch feed: newest pools from GeckoTerminal's free public API (Base and BNB Chain: every DEX GeckoTerminal
// indexes, incl. four.meme and PancakeSwap on BNB; Solana: pump.fun bonding curves + other new pools), each new token run
// through our existing risk checks (contractRisk for Base/BNB, solanaToken for Solana). Computed on request with short in-memory caches; no database.
import { contractRisk } from "./lib.js";
import { solanaToken } from "./solana.js";

const GT = "https://api.geckoterminal.com/api/v2";
const NET = { base: "base", bsc: "bsc", solana: "solana" };
const EVM = new Set(["base", "bsc"]);
export const FEED_CHAINS = ["base", "bsc", "solana"];
const T = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);
const SKIP = new Set([ // quote/major tokens that are not "launches" even if GeckoTerminal lists them as base
  "0x4200000000000000000000000000000000000006", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "0x0000000000000000000000000000000000000000",
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0x55d398326f99059ff775485246999027b3197955", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // BNB: WBNB, USDT, USDC
  "0xe9e7cea3dedca5984780bafc599bd69add087d56", "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409", "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // BUSD, FDUSD, ETH
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", // BTCB, USD1, CAKE
  "so11111111111111111111111111111111111111112", "epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v", "es9vmfrzacermjfrf4h2fyd4kconky11mcce8benwnyb"]);

const pageCache = new Map(); // key -> { at, p }
function gtPage(chain, page) {
  const k = chain + ":" + page, c = pageCache.get(k);
  if (c && Date.now() - c.at < 45e3) return c.p;
  const p = T(fetch(`${GT}/networks/${NET[chain]}/new_pools?page=${page}&include=base_token,quote_token,dex`, { headers: { accept: "application/json", "user-agent": "automaton-onchain-tools/1.6" } })
    .then(async r => { if (!r.ok) throw Object.assign(new Error(`GeckoTerminal ${r.status}`), { status: 503 }); return r.json(); }), 10000);
  pageCache.set(k, { at: Date.now(), p }); p.catch(() => pageCache.delete(k));
  return p;
}

const num = v => (v == null || v === "" || isNaN(+v) ? null : Math.round(+v * 100) / 100);
function rows(chain, j) {
  const inc = new Map((j.included || []).map(x => [x.id, x]));
  const seen = new Set(), out = [];
  for (const p of j.data || []) {
    const a = p.attributes || {}, rel = p.relationships || {};
    const bt = inc.get(rel.base_token?.data?.id), qt = inc.get(rel.quote_token?.data?.id);
    const addr = bt?.attributes?.address || (rel.base_token?.data?.id || "").replace(/^[^_]+_/, "");
    if (!addr || SKIP.has(addr.toLowerCase()) || seen.has(addr.toLowerCase())) continue; seen.add(addr.toLowerCase());
    const created = a.pool_created_at ? Date.parse(a.pool_created_at) : null;
    out.push({ chain, token: { address: addr, name: bt?.attributes?.name ?? null, symbol: bt?.attributes?.symbol ?? null },
      pool: { address: a.address, dex: rel.dex?.data?.id ?? null, name: a.name ?? null, quote: qt?.attributes?.symbol ?? null, createdAt: a.pool_created_at ?? null,
        ageMinutes: created ? Math.max(0, Math.round((Date.now() - created) / 6e4)) : null, liquidityUsd: num(a.reserve_in_usd), fdvUsd: num(a.fdv_usd), priceUsd: a.base_token_price_usd ? +(+a.base_token_price_usd).toPrecision(6) : null,
        txnsH1: a.transactions?.h1 ? { buys: a.transactions.h1.buys, sells: a.transactions.h1.sells } : null, volumeH1Usd: num(a.volume_usd?.h1) } });
  }
  return out;
}

// Risk check cache (per warm instance). Results are point-in-time; recheck after 10 min.
const riskCache = new Map();
function summarize(chain, r) {
  const flags = (r.findings || []).filter(f => f.severity !== "info").map(f => ({ severity: f.severity, note: f.note }));
  if (chain === "base" && r.codeSize === 1 && /^0xb2000000000000000000/i.test(r.address || "")) return { riskLevel: "unknown", tokenStandard: "B20 (Base native precompile token)",
    flags: [{ severity: "info", note: "B20 token: its logic is a Base precompile, not contract bytecode, so our bytecode/owner/Sourcify checks don't apply. B20 tokens can carry issuer roles (freeze, transfer policies, supply caps) that this feed doesn't read yet." }] };
  if (EVM.has(chain)) return { riskLevel: r.riskLevel, heuristicScore: r.heuristicScore ?? null, verifiedSource: !!(r.sourcify?.contract?.verified || r.sourcify?.implementation?.verified),
    upgradeable: !!(r.proxy && r.proxy.standard !== "EIP-1167"), owner: r.owner ?? null, ownerType: r.ownerType ?? null, capabilities: Object.keys(r.capabilities || {}), flags };
  return { riskLevel: r.riskLevel, mintAuthorityActive: r.mintAuthority?.active ?? null, freezeAuthorityActive: r.freezeAuthority?.active ?? null, metadataMutable: r.metadata?.isMutable ?? null,
    pumpfun: r.pumpfun?.isPumpFun ? { status: r.pumpfun.status ?? null, progressPct: r.pumpfun.progressPct ?? null } : null,
    top10HoldersPct: r.holders?.top10ExcludingPoolsPct ?? null, largestWalletPct: r.holders?.largestWalletPct ?? null, flags };
}
function risk(chain, addr) {
  const k = chain + ":" + addr.toLowerCase(), c = riskCache.get(k);
  if (c && Date.now() - c.at < 10 * 6e4) return c.p;
  const p = T(EVM.has(chain) ? contractRisk(chain, addr) : solanaToken(addr), EVM.has(chain) ? 12000 : 15000)
    .then(r => ({ checkedAt: new Date().toISOString(), ...summarize(chain, r) }))
    .catch(e => ({ checkedAt: new Date().toISOString(), riskLevel: "unknown", error: "risk check failed or timed out: " + String(e.shortMessage || e.message).slice(0, 120), flags: [] }));
  riskCache.set(k, { at: Date.now(), p });
  if (riskCache.size > 3000) for (const key of [...riskCache.keys()].slice(0, 1000)) riskCache.delete(key);
  return p;
}
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

const RISK_NOTE = "Risk flags are automated heuristics from public data at check time (Base and BNB Chain: bytecode selectors, proxy slots, owner(), Sourcify; Solana: mint/freeze authority, metadata mutability, Token-2022 extensions, holder concentration, pump.fun curve). Not an audit or financial advice. New tokens change fast; most launches fail.";

export async function launches({ chain = "all", limit = 10 } = {}) {
  const chains = chain === "all" ? FEED_CHAINS : [chain];
  limit = Math.max(1, Math.min(20, +limit || 10));
  const per = await Promise.all(chains.map(async c => {
    let list; try { list = rows(c, await gtPage(c, 1)).slice(0, limit); } catch (e) { return { chain: c, error: String(e.message), launches: [] }; }
    const risks = await pool(list, c === "base" ? 10 : c === "bsc" ? 6 : 4, x => risk(c, x.token.address));
    return { chain: c, launches: list.map((x, i) => ({ ...x, risk: risks[i] })) };
  }));
  const all = per.flatMap(p => p.launches).sort((a, b) => Date.parse(b.pool.createdAt || 0) - Date.parse(a.pool.createdAt || 0));
  return { type: "launch-feed", generatedAt: new Date().toISOString(), chains, count: all.length, launches: all,
    errors: per.filter(p => p.error).map(p => ({ chain: p.chain, error: p.error })),
    source: "New pools from GeckoTerminal's public API (newest first, one row per new token); risk checks by Automaton.", disclaimer: RISK_NOTE };
}

// Free delayed feed: only launches whose pool is at least `delayMin` old, few rows, short risk summary.
export async function launchesDelayed({ chain = "all", delayMin = 15, limit = 5 } = {}) {
  const chains = chain === "all" ? FEED_CHAINS : [chain];
  const cutoff = Date.now() - delayMin * 6e4;
  const per = await Promise.all(chains.map(async c => {
    const pages = c === "base" ? [1, 2] : c === "bsc" ? [2, 3] : [10]; // BNB: ~20 pools per 5 min, so pages 2-3 reach 15+ min; Solana: page 10 is the oldest GeckoTerminal serves (~5-10 min); delay topped up by CDN cache
    let list = [];
    for (const pg of pages) { try { list.push(...rows(c, await gtPage(c, pg))); } catch {} }
    const minAge = EVM.has(c) ? cutoff : Infinity;
    const seen = new Set(); // pages can overlap as new pools shift pagination
    list = list.filter(x => x.pool.createdAt && Date.parse(x.pool.createdAt) <= minAge && !seen.has(x.token.address.toLowerCase()) && seen.add(x.token.address.toLowerCase())).slice(0, limit);
    const risks = await pool(list, 4, x => risk(c, x.token.address));
    return list.map((x, i) => ({ chain: c, token: x.token, dex: x.pool.dex, pool: x.pool.address, createdAt: x.pool.createdAt, liquidityUsd: x.pool.liquidityUsd,
      riskLevel: risks[i].riskLevel, flags: (risks[i].flags || []).filter(f => f.severity !== "info" || risks[i].riskLevel === "unknown").map(f => f.note).slice(0, 4) }));
  }));
  return { type: "launch-feed-delayed", generatedAt: new Date().toISOString(), delay: "Base and BNB Chain: pools at least 15 min old. Solana: the oldest page GeckoTerminal serves (~5-10 min old) and this response is CDN-cached for 10 min, so ~5-20 min behind.",
    count: per.flat().length, launches: per.flat(), paid: "Live feed with full risk detail, up to 20 per chain: GET /v1/launches (x402, $0.02, all three chains), /v1/base/launches, /v1/bsc/launches or /v1/solana/launches ($0.01).", disclaimer: RISK_NOTE };
}
