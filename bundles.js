// BNB Chain bundle + sniper check ($0.01): for a BNB Chain token (four.meme bonding curve or PancakeSwap launch), finds the launch block, reads
// the first blocks after it and clusters the wallets that bought in the launch block, were bundled in one tx, got tokens straight from the dev,
// or were funded (BNB) by the same wallet / the dev just before launch. Reports % of supply the cluster grabbed, % it still holds, whether the
// dev is in it, and a risk verdict. Free keyless data only: public BNB Chain RPCs + GeckoTerminal for the launch time. Coverage is reported honestly.
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000", DEAD = "0x000000000000000000000000000000000000dead";
// four.meme TokenManager contracts (bonding-curve venue: buys are transfers out of these).
export const FOURMEME = new Set(["0x5c952063c7fc8610ffdb798152d69f0b9550762b", "0xec4549cadce5da21df6e6422d448eaca7a5fca1b", "0xf251f83e40a78868fcfa3fa4599dad6494e46034"]);
const LOG_RPCS = (process.env.BSC_LOG_RPC || "https://bsc-rpc.publicnode.com").split(",");
const RPCS = (process.env.BSC_RPCS || "https://bsc-rpc.publicnode.com,https://bsc-dataseed.bnbchain.org,https://bsc-dataseed.binance.org,https://bsc-dataseed1.defibit.io,https://1rpc.io/bnb").split(",");
export const MAX_LOG_RANGE = 50000, WINDOW = 10, FUND_BLOCKS = 40, MAX_BUYERS = 40;
const lc = a => String(a).toLowerCase(), addr = t => "0x" + t.slice(26), hex = n => "0x" + n.toString(16);
const UA = { accept: "application/json", "user-agent": "automaton-onchain-tools/1.11 (+https://automaton-tx-explainer.vercel.app)" };

async function call(urls, method, params, ms = 6000) {
  let last;
  for (const u of urls) {
    try { const r = await fetch(u, { method: "POST", headers: { ...UA, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(ms) });
      const j = await r.json(); if (j.error) throw new Error(String(j.error.message || "rpc error").slice(0, 120)); return j.result; }
    catch (e) { last = e; }
  }
  throw Object.assign(new Error(`BNB Chain RPC failed (${method}): ${last?.message}`), { status: 502 });
}
const rpc = (m, p, ms) => call(RPCS, m, p, ms);
const getLogs = (token, from, to) => call(LOG_RPCS, "eth_getLogs", [{ address: token, topics: [TRANSFER], fromBlock: hex(from), toBlock: hex(to) }], 12000);
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const balanceOf = async (token, who) => BigInt(await ethCall(token, "0x70a08231" + who.slice(2).padStart(64, "0")) || "0x0");
async function strCall(token, sel) { try { const r = await ethCall(token, sel); if (!r || r === "0x") return null; if (r.length >= 194) { const len = Number(BigInt("0x" + r.slice(66, 130))); return Buffer.from(r.slice(130, 130 + len * 2), "hex").toString("utf8").replace(/\0/g, "").slice(0, 40); } return Buffer.from(r.slice(2), "hex").toString("utf8").replace(/\0/g, "").slice(0, 40) || null; } catch { return null; } }

// GeckoTerminal: the token's pools (venues) and the earliest pool creation time. Optional: we fall back to scanning back from the head.
async function geckoPools(token) {
  try { const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${token}/pools?page=1`, { headers: UA, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null; const d = await r.json();
    return (d.data || []).map(p => ({ address: lc(p.attributes.address), createdAt: p.attributes.pool_created_at, dex: p.relationships?.dex?.data?.id || null })); }
  catch { return null; }
}
async function blockAt(ts, head) { // block number near unix ts (seconds), by interpolation on headers (no archive state needed)
  const hb = await rpc("eth_getBlockByNumber", [hex(head), false]), ht = Number(BigInt(hb.timestamp));
  const pb = await rpc("eth_getBlockByNumber", [hex(head - 20000), false]); const bt = (ht - Number(BigInt(pb.timestamp))) / 20000 || 0.45;
  let est = Math.max(1, Math.min(head, Math.round(head - (ht - ts) / bt)));
  for (let i = 0; i < 2; i++) { const b = await rpc("eth_getBlockByNumber", [hex(est), false]); const d = ts - Number(BigInt(b.timestamp)); if (Math.abs(d) < 3) break; est = Math.max(1, Math.min(head, Math.round(est + d / bt))); }
  return est;
}

export function verdict({ clusterPct, holdPct, devInCluster, bundledTxs }) {
  const reasons = []; let score = 0;
  if (devInCluster && clusterPct < 1) reasons.push("the dev bought or handed out tokens at launch, but under 1% of supply");
  if (clusterPct >= 30) { score += 3; reasons.push(`the cluster grabbed ${clusterPct.toFixed(1)}% of supply at launch`); } else if (clusterPct >= 10) { score += 2; reasons.push(`the cluster grabbed ${clusterPct.toFixed(1)}% of supply at launch`); } else if (clusterPct >= 3) score += 1;
  if (holdPct >= 20) { score += 2; reasons.push(`it still holds ${holdPct.toFixed(1)}% of supply (dump risk)`); } else if (holdPct >= 5) { score += 1; reasons.push(`it still holds ${holdPct.toFixed(1)}% of supply`); }
  if (devInCluster && clusterPct >= 1) { score += 2; reasons.push("the dev/deployer is part of the cluster"); }
  if (bundledTxs > 0 && clusterPct >= 1) { score += 1; reasons.push(`${bundledTxs} transaction(s) sent launch tokens to several wallets at once (bundler pattern)`); }
  return { riskLevel: score >= 5 ? "high" : score >= 2 ? "medium" : "low", riskScore: score, reasons };
}

export async function bscBundles(tokenIn) {
  const token = lc(tokenIn), started = Date.now(), notes = [];
  const [code, head0, gp] = await Promise.all([rpc("eth_getCode", [token, "latest"]), rpc("eth_blockNumber", []), geckoPools(token)]);
  if (!code || code === "0x") throw Object.assign(new Error("not a contract on BNB Chain"), { status: 400 });
  const head = Number(BigInt(head0));
  const [supRaw, decRaw, symbol, name] = await Promise.all([ethCall(token, "0x18160ddd"), ethCall(token, "0x313ce567").catch(() => "0x12"), strCall(token, "0x95d89b41"), strCall(token, "0x06fdde03")]);
  const supply = BigInt(supRaw || "0x0"), decimals = Number(BigInt(decRaw || "0x12")); if (supply === 0n) throw Object.assign(new Error("token has zero totalSupply"), { status: 400 });
  const venues = new Set(FOURMEME); (gp || []).forEach(p => /^0x[0-9a-f]{40}$/.test(p.address) && p.address !== token && venues.add(p.address));
  if (!gp) notes.push("GeckoTerminal unavailable: launch time found by scanning back from the chain head");
  // 1) find the first Transfer logs (creation) near the launch time, in <=50k-block windows.
  let logs = [], scanFrom, scanTo, firstSeen = null;
  const times = (gp || []).map(p => Date.parse(p.createdAt)).filter(Number.isFinite);
  let anchor = times.length ? await blockAt(Math.floor(Math.min(...times) / 1000), head) : head;
  for (let step = 0, to = Math.min(head, anchor + 2000); step < 8 && Date.now() - started < 14000; step++) {
    const from = Math.max(1, to - MAX_LOG_RANGE + 1);
    let l; try { l = await getLogs(token, from, to); } catch (e) { notes.push(`log query ${from}-${to} failed: ${e.message.slice(0, 90)}`); break; }
    scanFrom = from; scanTo ??= to;
    if (l.length) { logs = l.concat(logs); firstSeen = Number(BigInt(l[0].blockNumber)); if (l.some(x => lc(addr(x.topics[1])) === ZERO)) break; }
    else if (logs.length) break; // nothing earlier: creation was in the window we already have
    to = from - 1;
  }
  if (!logs.length) throw Object.assign(new Error("no Transfer events found in the searchable range (token too old for free non-archive RPC log access, or never traded)"), { status: 404 });
  logs.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
  const ev = logs.map(l => ({ block: Number(BigInt(l.blockNumber)), tx: l.transactionHash, from: lc(addr(l.topics[1])), to: lc(addr(l.topics[2] || "0x" + "0".repeat(64))), value: BigInt(l.data === "0x" ? 0 : l.data) }));
  const mint = ev.find(e => e.from === ZERO), creationBlock = mint ? mint.block : null;
  if (!mint) notes.push("creation (mint) event is older than the scanned range; dev identified from the first liquidity add instead");
  // 2) dev = signer of the creation tx; also the wallet that first sent tokens into a venue (liquidity adder).
  const devs = new Set(); let dev = null;
  if (mint) { const t = await rpc("eth_getTransactionByHash", [mint.tx]); dev = lc(t.from); devs.add(dev); if (mint.to === token) venues.add(token); // supply minted to the token itself (self-selling curve)
    else if (mint.to !== ZERO && !venues.has(mint.to) && mint.to !== dev) { // supply minted to a launcher contract (treated as a venue) or to a dev-side wallet
      const c = await rpc("eth_getCode", [mint.to, "latest"]).catch(() => "0x1"); if (c === "0x") devs.add(mint.to); else { venues.add(mint.to); notes.push(`supply was minted to contract ${mint.to}; tokens it sent out are counted as launch buys`); } } }
  // Detect a pair GeckoTerminal didn't list: first address that gets >=5% of supply from a dev wallet and then sends tokens to 3+ others.
  for (const e of ev) if (devs.has(e.from) && !venues.has(e.to) && e.to !== DEAD && e.to !== ZERO && e.value * 20n >= supply && new Set(ev.filter(x => x.from === e.to).map(x => x.to)).size >= 3) { venues.add(e.to); break; }
  const lpAdd = ev.find(e => venues.has(e.to) && !venues.has(e.from) && e.from !== ZERO);
  if (lpAdd && !dev) { const t = await rpc("eth_getTransactionByHash", [lpAdd.tx]); dev = lc(t.from); devs.add(dev); }
  // 3) launch block = first block with a buy (tokens out of a venue to a non-venue).
  const isBuy = e => venues.has(e.from) && !venues.has(e.to) && e.to !== ZERO && e.to !== DEAD && e.to !== token;
  let firstBuy = ev.find(isBuy);
  if (!firstBuy) { // launch may be later than what we scanned: read forward from the last scanned block once
    const from = (scanTo || head) + 1, to = Math.min(head, from + MAX_LOG_RANGE - 1);
    if (from <= to) { try { const l = await getLogs(token, from, to); for (const x of l) ev.push({ block: Number(BigInt(x.blockNumber)), tx: x.transactionHash, from: lc(addr(x.topics[1])), to: lc(addr(x.topics[2])), value: BigInt(x.data === "0x" ? 0 : x.data) }); scanTo = to; } catch {} }
    firstBuy = ev.find(isBuy);
  }
  if (!firstBuy) throw Object.assign(new Error("no buys from a known pool or four.meme bonding curve found yet for this token"), { status: 404 });
  const L = firstBuy.block, W = L + WINDOW;
  if ((scanTo ?? 0) < W && W <= head) { try { const l = await getLogs(token, (scanTo ?? L) + 1, W); for (const x of l) ev.push({ block: Number(BigInt(x.blockNumber)), tx: x.transactionHash, from: lc(addr(x.topics[1])), to: lc(addr(x.topics[2])), value: BigInt(x.data === "0x" ? 0 : x.data) }); } catch (e) { notes.push("could not read the full first-blocks window: " + e.message.slice(0, 80)); } }
  // 4) early buyers (launch block .. +WINDOW) and pre-launch dev hand-outs.
  const buys = ev.filter(e => isBuy(e) && e.block >= L && e.block <= W);
  const handouts = ev.filter(e => devs.has(e.from) && !venues.has(e.to) && !devs.has(e.to) && e.to !== DEAD && e.to !== ZERO && e.to !== token && e.block <= W);
  const W8 = new Map(); const add = (a, v, blk, how) => { const w = W8.get(a) || { address: a, received: 0n, firstBlock: blk, how: new Set(), txs: new Set() }; w.received += v; w.firstBlock = Math.min(w.firstBlock, blk); w.how.add(how); W8.set(a, w); return w; };
  for (const e of buys) add(e.to, e.value, e.block, e.block === L ? "bought in launch block" : `bought in block +${e.block - L}`).txs.add(e.tx);
  for (const e of handouts) add(e.to, e.value, e.block, "got tokens straight from the dev").txs.add(e.tx);
  const byTx = new Map(); for (const e of buys) { const s = byTx.get(e.tx) || new Set(); s.add(e.to); byTx.set(e.tx, s); }
  const bundledTx = [...byTx].filter(([, s]) => s.size >= 2);
  for (const [, s] of bundledTx) for (const a of s) W8.get(a)?.how.add("bundled with other buyers in one tx");
  const all = [...W8.values()].sort((a, b) => a.firstBlock - b.firstBlock || Number(b.received - a.received)); for (const w of all) w.signers = new Set();
  const truncatedBuyers = all.length > MAX_BUYERS; const wallets = [...all].sort((a, b) => Number(b.received - a.received)).slice(0, MAX_BUYERS); // biggest early wallets get the signer + funding checks
  // 5) signer of each buy tx (a buyer that is a bundler-paid recipient has a different signer).
  const txs = [...new Set(wallets.flatMap(w => [...w.txs]))];
  const txFrom = new Map(); await pool(txs, 8, async h => { try { const t = await rpc("eth_getTransactionByHash", [h]); txFrom.set(h, lc(t.from)); } catch {} });
  for (const w of wallets) { w.signers = new Set([...w.txs].map(h => txFrom.get(h)).filter(Boolean)); if (devs.size && [...w.signers].some(s => devs.has(s)) && !devs.has(w.address)) w.how.add("buy signed by the dev"); }
  // 6) funding: native BNB sent to these wallets/signers in the blocks right before launch (and the launch block).
  const watch = new Set(wallets.flatMap(w => [w.address, ...w.signers])); devs.forEach(d => watch.add(d));
  const funder = new Map(); let fundFrom = L, fundOk = 0; const fundStart = Math.max(1, L - FUND_BLOCKS);
  const blocks = []; for (let b = L; b >= fundStart; b--) blocks.push(b);
  await pool(blocks, 6, async b => { if (Date.now() - started > 22000) return; try { const blk = await rpc("eth_getBlockByNumber", [hex(b), true], 8000); fundOk++; fundFrom = Math.min(fundFrom, b);
    for (const t of blk.transactions || []) if (t.to && watch.has(lc(t.to)) && BigInt(t.value) > 0n && lc(t.from) !== lc(t.to)) { const k = lc(t.to); const s = funder.get(k) || new Set(); s.add(lc(t.from)); funder.set(k, s); } } catch {} });
  const fundersOf = w => new Set([...(funder.get(w.address) || []), ...[...w.signers].flatMap(s => [...(funder.get(s) || [])])]);
  const devFunders = new Set(devs.size ? [...devs].flatMap(d => [...(funder.get(d) || [])]) : []);
  const fcount = new Map(); for (const w of wallets) for (const f of fundersOf(w)) fcount.set(f, (fcount.get(f) || 0) + 1);
  for (const w of wallets) for (const f of fundersOf(w)) { if (devs.has(f)) w.how.add("funded by the dev"); else if (devFunders.has(f)) w.how.add("same funder as the dev"); else if (fcount.get(f) >= 2) w.how.add("same funder as another early buyer"); w.funders = [...fundersOf(w)]; }
  // 7) cluster: launch-block buyers + bundled + dev hand-outs + dev-funded/shared-funder wallets + the dev itself if it bought.
  const linked = /launch block|bundled|straight from the dev|signed by the dev|funded by the dev|same funder/;
  const cluster = all.filter(w => [...w.how].some(h => linked.test(h)));
  const devInCluster = cluster.some(w => devs.has(w.address) || [...w.how].some(h => /dev/.test(h)));
  const bal = new Map(); await pool([...new Set([...devs, ...[...cluster].sort((a, b) => Number(b.received - a.received)).map(w => w.address), ...wallets.map(w => w.address)])].slice(0, 200), 10, async a => { try { bal.set(a, await balanceOf(token, a)); } catch { bal.set(a, null); } });
  const pct = v => Number((v * 1000000n) / supply) / 10000;
  const sum = arr => arr.reduce((s, w) => s + w.received, 0n), held = arr => arr.reduce((s, w) => s + (bal.get(w.address) || 0n), 0n);
  const clusterPct = pct(sum(cluster)), unread = cluster.filter(w => bal.get(w.address) == null).length, holdPct = pct(held(cluster)), earlyPct = pct(sum(wallets.filter(w => w.how.size && [...w.how].some(h => /bought/.test(h)))));
  const devHold = dev && bal.get(dev) != null ? pct(bal.get(dev)) : null;
  if (unread) notes.push(`current balance not read for ${unread} cluster wallet(s); supplyPctHeldNow counts only the ones read`);
  const v = verdict({ clusterPct, holdPct, devInCluster, bundledTxs: bundledTx.length });
  const fmt = x => { const s = (Number(x) / 10 ** decimals); return s >= 1 ? s.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(s); };
  const findings = v.reasons.map(n => ({ severity: v.riskLevel === "low" ? "info" : v.riskLevel, note: n }));
  if (!cluster.length) findings.push({ severity: "info", note: "no wallets linked to the launch block, a bundle tx, shared funding or the dev were found in the scanned window" });
  const platform = [...venues].some(x => FOURMEME.has(x)) && ev.some(e => FOURMEME.has(e.from)) ? "four.meme" : (gp || []).find(p => venues.has(p.address))?.dex || "unknown";
  return {
    type: "bsc-bundle-check", chain: "bsc", token, symbol, name, decimals, platform, totalSupply: fmt(supply),
    deployer: dev, devWallets: [...devs], devHoldsPct: devHold, creationBlock, launchBlock: L,
    riskLevel: v.riskLevel, riskScore: v.riskScore,
    summary: `${symbol || "Token"} launched in block ${L}${platform !== "unknown" ? " on " + platform : ""}. ${cluster.length} linked wallet(s) grabbed ${clusterPct.toFixed(2)}% of supply in the first ${WINDOW} blocks and still hold ${holdPct.toFixed(2)}%. Dev ${devInCluster ? "IS" : "is not"} in the cluster. Risk: ${v.riskLevel}.`,
    cluster: { wallets: cluster.length, supplyPctAtLaunch: clusterPct, supplyPctHeldNow: holdPct, devInCluster, bundledTxs: bundledTx.map(([h, s]) => ({ tx: h, recipients: s.size })) },
    earlyBuyersPct: earlyPct,
    walletsTotal: all.length,
    wallets: all.slice(0, 100).map(w => ({ address: w.address, inCluster: cluster.includes(w), isDev: devs.has(w.address), firstBlock: w.firstBlock, blockOffset: w.firstBlock - L, received: fmt(w.received), supplyPct: pct(w.received),
      holdsNow: bal.get(w.address) == null ? null : fmt(bal.get(w.address)), holdsPct: bal.get(w.address) == null ? null : pct(bal.get(w.address)), why: [...w.how], funders: w.funders || [], signers: [...(w.signers || [])] })),
    findings,
    coverage: { logsScannedBlocks: [scanFrom, Math.max(scanTo || 0, W)], firstBlocksWindow: [L, W], fundingBlocksScanned: fundOk ? [fundFrom, L] : null, fundingBlocksRead: fundOk, fundingCheckedWallets: wallets.length, fundingCheckTruncated: truncatedBuyers, holdingsUnread: unread, walletsListed: Math.min(all.length, 100),
      note: `Free public BNB Chain RPC only: logs are read in <=${MAX_LOG_RANGE.toLocaleString()}-block chunks and only within the node's recent (non-archive) history (roughly the last few days); early buyers = launch block + next ${WINDOW} blocks; funding links = native BNB sent to those wallets (or their tx signers) in the ${FUND_BLOCKS} blocks before launch (${fundOk} read). Older funding, token (non-BNB) funding, CEX withdrawals and links through intermediate wallets are not detected, so the cluster can be larger than shown.`, notes },
    elapsedMs: Date.now() - started,
    disclaimer: "Heuristic onchain analysis, not financial advice. A clean result does not prove a token is safe.",
  };
}
