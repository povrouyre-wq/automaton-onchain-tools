// All-chains approval sweep ($0.02): finds live ERC-20 allowances and NFT setApprovalForAll approvals for one wallet on all 7 EVM chains,
// ranks them by risk (unlimited, unknown spender, unverified or non-contract spender, flagged spender) and returns a ready-to-sign revoke tx for each risky one.
// Discovery (free, keyless): GoPlus approval-security API, Approval/ApprovalForAll event logs from Blockscout / Routescan explorers, and our
// known token x spender pairs. Every candidate is then re-read onchain (allowance / isApprovedForAll), so stale index data never shows up as live.
import { encodeFunctionData, erc20Abi, formatUnits, parseAbi } from "viem";
import { CHAINS } from "./lib.js";

const APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const APPROVAL_FOR_ALL = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";
const UA = { accept: "application/json", "user-agent": "automaton-onchain-tools/1.10 (+https://automaton-tx-explainer.vercel.app)" };
const NFT_ABI = parseAbi(["function isApprovedForAll(address owner, address operator) view returns (bool)", "function setApprovalForAll(address operator, bool approved)", "function name() view returns (string)"]);
// Effectively unlimited: >= 2^96-1 (covers uint256 max, Permit2-style uint160 max and uint96-capped tokens like UNI/COMP).
const UNLIMITED = 2n ** 96n - 1n;
const lc = a => String(a).toLowerCase();
const topicAddr = a => "0x" + lc(a).slice(2).padStart(64, "0");
const fromTopic = t => "0x" + t.slice(26);
const timeout = (p, ms, what = "timeout") => { let t; return Promise.race([p, new Promise((_, r) => { t = setTimeout(() => r(new Error(what)), ms); })]).finally(() => clearTimeout(t)); };
const budgetLeft = end => Math.max(0, end - Date.now());

// Event-log indexers (Etherscan-compatible getLogs). Explorers that sit behind bot protection simply report "unavailable" for that call.
export const LOG_SOURCES = {
  ethereum: [["routescan", "https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api"], ["blockscout", "https://eth.blockscout.com/api"]],
  base: [["blockscout", "https://base.blockscout.com/api"]],
  optimism: [["blockscout", "https://explorer.optimism.io/api"]],
  arbitrum: [["blockscout", "https://arbitrum.blockscout.com/api"]],
  polygon: [["blockscout", "https://polygon.blockscout.com/api"]],
  avalanche: [["routescan", "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api"]],
  bsc: [],
};
// GoPlus approval-security coverage (chain ids). Optimism and Avalanche are not supported by GoPlus for approvals.
const GOPLUS_ERC20 = new Set([1, 56, 8453, 42161, 137]), GOPLUS_NFT = new Set([1, 56, 42161, 137]);
// Extra well-known spenders. CHAIN_KNOWN entries were checked on Sourcify for that chain (Nov 1 2026). GLOBAL entries are deployed at the same
// address on many chains, but the same address can be a different contract elsewhere (0xE592... is Uniswap's SwapRouter on Ethereum but not on
// Base), so a GLOBAL label only counts when that chain's verified contract name (Sourcify or GoPlus) matches.
const CHAIN_KNOWN = {
  ethereum: { "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": "Uniswap V2 Router02", "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3 SwapRouter", "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f": "SushiSwap Router",
    "0xdef171fe48cf0115b1d80b88dc8eab59176fee57": "ParaSwap v5 Augustus", "0x216b4b4ba9f3e719726886d34a177484278bfcae": "ParaSwap v5 TokenTransferProxy", "0x00000000000111abe46ff893f3b2fdf1f759a8a8": "Blur Execution Delegate",
    "0x00000000000000adc04c56bf30ac9d3c0aaf14dc": "OpenSea Seaport 1.5" },
  base: { "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24": "Uniswap V2 Router02" },
};
export const GLOBAL_KNOWN = { "0x1111111254eeb25477b68fb85ed929f73a960582": ["1inch v5 Router", "AggregationRouterV5"], "0x6131b5fae19ea4f9d964eac0408e4408b66337b5": ["KyberSwap Meta Aggregation Router v2", "MetaAggregationRouterV2"],
  "0x6a000f20005980200259b80c5102003040001068": ["ParaSwap v6 Augustus", "AugustusV6"], "0x1e0049783f008a0085193e00003d00cd54003c71": ["OpenSea Seaport Conduit", "Conduit"],
  "0x0000000000000068f116a894984e2db1123eb395": ["OpenSea Seaport 1.6", "Seaport"], "0xe592427a0aece92de3edee1f18e0157c05861564": ["Uniswap V3 SwapRouter", "SwapRouter"],
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": ["Uniswap SwapRouter02", "SwapRouter02"], "0x000000000022d473030f116ddee9f6b43ac78ba3": ["Permit2", "Permit2"] };
export function knownLabel(chain, addr) { const a = lc(addr);
  for (const [n, s] of Object.entries(CHAINS[chain].spenders)) if (lc(s) === a) return n;
  return CHAIN_KNOWN[chain]?.[a] || null; }

async function getLogs(url, topic0, owner, end, maxPages = 6) {
  const seen = new Set(), out = []; let from = 0, pages = 0, truncated = false;
  while (pages < maxPages) {
    const left = budgetLeft(end); if (left < 800) { truncated = true; break; }
    const q = `${url}?module=logs&action=getLogs&fromBlock=${from}&toBlock=latest&topic0=${topic0}&topic1=${topicAddr(owner)}&topic0_1_opr=and&page=1&offset=1000`;
    const r = await timeout(fetch(q, { headers: UA, signal: AbortSignal.timeout(Math.min(left, 12000)) }), Math.min(left, 12000), "log indexer timeout");
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.includes("json")) throw new Error(r.ok ? "non-JSON (bot protection)" : "HTTP " + r.status);
    const d = await r.json(); const res = Array.isArray(d.result) ? d.result : null;
    if (!res) { if (/no (records|logs)/i.test(d.message || "") || d.result === null && /no/i.test(String(d.message))) break; throw new Error(String(d.message || d.result || "bad response").slice(0, 80)); }
    pages++;
    for (const l of res) { const k = l.transactionHash + ":" + l.logIndex; if (!seen.has(k)) { seen.add(k); out.push(l); } }
    if (res.length < 1000) break;
    const last = Number(BigInt(res[res.length - 1].blockNumber)); if (last <= from) { truncated = true; break; } from = last;
    if (pages >= maxPages) truncated = true;
  }
  return { logs: out, truncated };
}
async function logsDiscovery(chain, owner, end) {
  const srcs = LOG_SOURCES[chain] || []; if (!srcs.length) return { status: "unavailable", note: "no free keyless event-log indexer for this chain", erc20: [], nft: [] };
  const errors = [];
  for (const [name, url] of srcs) {
    try { const [a, b] = await Promise.all([getLogs(url, APPROVAL, owner, end), getLogs(url, APPROVAL_FOR_ALL, owner, end)]);
      const erc20 = [], nft = [];
      for (const l of a.logs) if (l.topics?.length === 3 && l.topics[2]) erc20.push([l.address, fromTopic(l.topics[2])]); // 4 topics = ERC-721 single-token approval (skipped)
      for (const l of b.logs) if (l.topics?.length >= 3 && l.topics[2]) nft.push([l.address, fromTopic(l.topics[2])]);
      return { status: a.truncated || b.truncated ? "truncated" : "ok", source: name, events: a.logs.length + b.logs.length, erc20, nft };
    } catch (e) { errors.push(`${name}: ${String(e.message).slice(0, 60)}`); }
  }
  return { status: "error", note: errors.join("; "), erc20: [], nft: [] };
}
async function goplusDiscovery(C, owner, end) {
  if (!GOPLUS_ERC20.has(C.chainId)) return { status: "unsupported", erc20: [], nft: [], info: new Map() };
  const get = async kind => { const r = await timeout(fetch(`https://api.gopluslabs.io/api/v2/${kind}/${C.chainId}?addresses=${owner}`, { headers: UA, signal: AbortSignal.timeout(Math.max(500, Math.min(budgetLeft(end), 9000))) }), Math.min(budgetLeft(end), 9000), "goplus timeout");
    if (!r.ok) throw new Error("HTTP " + r.status); const d = await r.json(); if (d.code !== 1 && !(d.code === 2 && Array.isArray(d.result))) throw new Error(String(d.message || d.code).slice(0, 60)); return d.result || []; };
  const kinds = ["token_approval_security", ...(GOPLUS_NFT.has(C.chainId) ? ["nft721_approval_security", "nft1155_approval_security"] : [])];
  const res = await Promise.allSettled(kinds.map(get));
  const erc20 = [], nft = [], info = new Map(); let ok = 0;
  res.forEach((r, i) => { if (r.status !== "fulfilled") return; ok++;
    for (const t of r.value) for (const a of t.approved_list || []) { const sp = a.approved_contract || a.approved_spender; if (!sp) continue;
      if (i === 0) erc20.push([t.token_address, sp]); else if (a.approved_for_all === 1 || a.approved_for_all === undefined) nft.push([t.nft_address, sp]);
      if (a.address_info) info.set(lc(sp), a.address_info); } });
  return { status: ok === kinds.length ? "ok" : ok ? "partial" : "error", ...(ok < kinds.length ? { note: res.filter(r => r.status === "rejected").map(r => String(r.reason?.message).slice(0, 60)).join("; ") } : {}), erc20, nft, info };
}

async function sourcify(chainId, address, ms) {
  try { const r = await timeout(fetch(`https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=compilation`, { headers: UA, signal: AbortSignal.timeout(ms) }), ms);
    if (r.status === 404) return { verified: false }; if (!r.ok) return { verified: null };
    const d = await r.json(); return { verified: !!d.match, name: d.compilation?.name ?? null }; } catch { return { verified: null }; }
}

export function revokeTx(chainId, kind, token, spender) {
  return kind === "erc20"
    ? { chainId, to: token, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 0n] }), method: "approve(address,uint256)", args: [spender, "0"] }
    : { chainId, to: token, value: "0", data: encodeFunctionData({ abi: NFT_ABI, functionName: "setApprovalForAll", args: [spender, false] }), method: "setApprovalForAll(address,bool)", args: [spender, false] };
}
// Risk score per live approval. Exported for tests.
export function scoreApproval(a) {
  const reasons = []; let s = 0; const add = (p, why) => { s += p; reasons.push(why); };
  const sp = a.spender;
  if (sp.flagged) add(10, "spender is flagged as malicious by GoPlus");
  if (sp.type === "eoa") add(5, "spender is a plain wallet (EOA), not a contract: a common drainer pattern");
  else if (sp.type === "eip-7702") add(4, "spender is a wallet with EIP-7702 delegated code, not a regular contract");
  else if (sp.type === "none") add(4, "spender address has no code");
  if (a.unlimited) add(3, a.kind === "erc20" ? "unlimited amount" : "approval for ALL NFTs in this collection");
  if (!sp.known) add(2, "unknown spender (not a well-known router, Permit2 or marketplace)");
  if (sp.type === "contract" && sp.verified === false) add(2, "spender contract source is not verified");
  if (a.kind === "erc20" && a.balanceRaw > 0n) add(1, "wallet currently holds this token");
  const severity = s >= 7 ? "high" : s >= 3 ? "medium" : "low";
  return { riskScore: s, severity, reasons };
}

async function sweepChain(chain, owner, end) {
  const C = CHAINS[chain], t0 = Date.now(), discEnd = Math.min(end - 7000, Date.now() + 13000);
  const [gp, lg] = await Promise.all([goplusDiscovery(C, owner, discEnd).catch(e => ({ status: "error", note: String(e.message).slice(0, 60), erc20: [], nft: [], info: new Map() })),
    logsDiscovery(chain, owner, discEnd).catch(e => ({ status: "error", note: String(e.message).slice(0, 60), erc20: [], nft: [] }))]);
  const cand = new Map(); const addC = (kind, tok, sp) => { if (!/^0x[0-9a-fA-F]{40}$/.test(tok) || !/^0x[0-9a-fA-F]{40}$/.test(sp)) return; const k = `${kind}:${lc(tok)}:${lc(sp)}`; if (!cand.has(k)) cand.set(k, { kind, token: lc(tok), spender: lc(sp) }); };
  for (const [, [ta]] of Object.entries(C.tokens)) for (const sa of Object.values(C.spenders)) addC("erc20", ta, sa);
  for (const [t, s] of [...gp.erc20, ...lg.erc20]) addC("erc20", t, s);
  for (const [t, s] of [...gp.nft, ...lg.nft]) addC("nft", t, s);
  let list = [...cand.values()]; const capped = list.length > 1500; if (capped) list = list.slice(0, 1500);
  // Live onchain check of every candidate.
  const reads = await timeout(C.rpc.multicall({ batchSize: 24000, allowFailure: true, contracts: list.map(c => c.kind === "erc20"
    ? { address: c.token, abi: erc20Abi, functionName: "allowance", args: [owner, c.spender] }
    : { address: c.token, abi: NFT_ABI, functionName: "isApprovedForAll", args: [owner, c.spender] }) }), Math.max(3000, budgetLeft(end) - 4500), "rpc timeout");
  let failedReads = 0; const live = [];
  reads.forEach((r, i) => { if (r.status !== "success") { failedReads++; return; } const c = list[i];
    if (c.kind === "erc20" ? r.result > 0n : r.result === true) live.push({ ...c, raw: c.kind === "erc20" ? r.result : null }); });
  // Token metadata + balances, spender code, spender verification.
  const toks = [...new Set(live.map(x => x.token))], sps = [...new Set(live.map(x => x.spender))];
  const metaCalls = toks.flatMap(t => [{ address: t, abi: erc20Abi, functionName: "symbol" }, { address: t, abi: erc20Abi, functionName: "decimals" }, { address: t, abi: erc20Abi, functionName: "balanceOf", args: [owner] }, { address: t, abi: NFT_ABI, functionName: "name" }]);
  const ms = Math.max(1500, budgetLeft(end) - 1500);
  const [meta, codes] = await Promise.all([
    metaCalls.length ? timeout(C.rpc.multicall({ batchSize: 24000, allowFailure: true, contracts: metaCalls }), ms).catch(() => []) : [],
    Promise.all(sps.map(s => timeout(C.rpc.getCode({ address: s }), ms).then(c => c || "0x").catch(() => null)))]);
  const tokMeta = new Map(toks.map((t, i) => { const m = k => meta[i * 4 + k]?.status === "success" ? meta[i * 4 + k].result : undefined;
    return [t, { symbol: m(0) ?? null, decimals: m(1) !== undefined ? Number(m(1)) : null, balanceRaw: typeof m(2) === "bigint" ? m(2) : 0n, name: m(3) ?? null }]; }));
  const spInfo = new Map(sps.map((s, i) => { const code = codes[i], g = gp.info.get(s);
    const type = code === null ? "unknown" : code === "0x" ? "eoa" : code.startsWith("0xef0100") ? "eip-7702" : "contract";
    const gk = GLOBAL_KNOWN[s]; let label = knownLabel(chain, s) || null; if (!label && gk && g?.contract_name === gk[1]) label = gk[0];
    const flagged = !!(g && ((g.malicious_behavior || []).length || g.doubt_list === 1));
    return [s, { address: s, label: label || g?.contract_name || null, ...(gk && !label ? { _gk: gk } : {}), known: !!label || g?.trust_list === 1, type, verified: type !== "contract" ? null : g?.is_open_source === 1 ? true : null, flagged,
      ...(flagged ? { flags: g.malicious_behavior || ["on GoPlus doubt list"] } : {}) }]; }));
  // Sourcify for unknown contracts that GoPlus didn't confirm as verified (max 15 per chain; same-address "global" spenders first, to confirm their name).
  const need = [...spInfo.values()].filter(s => s.type === "contract" && !s.known && (s.verified !== true || s._gk)).sort((a, b) => (b._gk ? 1 : 0) - (a._gk ? 1 : 0)).slice(0, 15);
  await Promise.all(need.map(async s => { const r = await sourcify(C.chainId, s.address, Math.min(5000, Math.max(800, budgetLeft(end) - 800)));
    if (r.verified !== null) s.verified = r.verified; if (s._gk && r.verified && r.name === s._gk[1]) { s.label = s._gk[0]; s.known = true; } else if (!s.label && r.name) s.label = r.name; }));
  for (const s of spInfo.values()) delete s._gk;
  const approvals = live.map(x => { const tm = tokMeta.get(x.token) || {}; const sp = spInfo.get(x.spender);
    const unlimited = x.kind === "erc20" ? x.raw >= UNLIMITED : true;
    const a = { chain, chainId: C.chainId, kind: x.kind === "erc20" ? "erc20" : "nft-approval-for-all", kind_: x.kind, token: { address: x.token, symbol: tm.symbol, ...(x.kind === "nft" ? { name: tm.name } : { decimals: tm.decimals }) },
      spender: sp, unlimited, allowance: x.kind === "erc20" ? (unlimited ? "unlimited" : tm.decimals !== null ? formatUnits(x.raw, tm.decimals) : x.raw.toString()) : "all tokens in collection",
      ...(x.kind === "erc20" ? { tokenBalance: tm.decimals !== null ? formatUnits(tm.balanceRaw, tm.decimals) : tm.balanceRaw.toString() } : {}), balanceRaw: tm.balanceRaw || 0n };
    Object.assign(a, scoreApproval(a)); if (a.severity !== "low") a.revokeTx = revokeTx(C.chainId, x.kind, x.token, x.spender);
    delete a.balanceRaw; delete a.kind_; return a; });
  const anyDiscovery = gp.status === "ok" || gp.status === "partial" || lg.status === "ok" || lg.status === "truncated";
  const status = failedReads === list.length && list.length ? "error" : (!anyDiscovery || capped || lg.status === "truncated" || gp.status === "partial" || failedReads > 0) ? "partial" : "ok";
  return { chain, chainId: C.chainId, status, ms: Date.now() - t0, candidatesChecked: list.length, failedReads, live: approvals.length, risky: approvals.filter(a => a.severity !== "low").length,
    sources: { goplus: gp.status, eventLogs: lg.status === "ok" || lg.status === "truncated" ? `${lg.status} (${lg.source}, ${lg.events} events)` : lg.status, knownPairs: "ok" },
    ...([gp.note, lg.note].filter(Boolean).length ? { notes: [gp.note && "goplus: " + gp.note, lg.note && "logs: " + lg.note].filter(Boolean) } : {}),
    ...(!anyDiscovery ? { coverage: `only our ${Object.keys(C.tokens).length} major tokens x ${Object.keys(C.spenders).length} common spenders could be checked on this chain right now` } : {}),
    approvals };
}

const ORDER = { high: 0, medium: 1, low: 2 };
export async function approvalSweep(owner, { budgetMs = 30000, chains = Object.keys(CHAINS) } = {}) {
  owner = lc(owner); const end = Date.now() + budgetMs;
  const per = await Promise.all(chains.map(c => timeout(sweepChain(c, owner, end), budgetMs + 500, "chain timeout")
    .catch(e => ({ chain: c, chainId: CHAINS[c].chainId, status: "error", error: String(e.shortMessage || e.message).slice(0, 120), approvals: [] }))));
  const approvals = per.flatMap(p => p.approvals).sort((a, b) => b.riskScore - a.riskScore || ORDER[a.severity] - ORDER[b.severity] || a.chain.localeCompare(b.chain));
  const chainsOut = per.map(({ approvals: _, ...rest }) => rest), MAX_OUT = 200;
  const n = s => approvals.filter(a => a.severity === s).length, high = n("high"), medium = n("medium");
  const riskLevel = high ? "high" : medium ? "medium" : "low";
  const failed = chainsOut.filter(c => c.status === "error").map(c => c.chain), partial = chainsOut.filter(c => c.status === "partial").map(c => c.chain);
  const findings = approvals.filter(a => a.severity !== "low").slice(0, 25).map(a => ({ severity: a.severity,
    note: `${CHAINS[a.chain].name}: ${a.kind === "erc20" ? `${a.unlimited ? "UNLIMITED" : a.allowance} ${a.token.symbol || a.token.address}` : `ALL ${a.token.name || a.token.symbol || a.token.address} NFTs`} approved to ${a.spender.label || a.spender.address} (${a.reasons.join("; ")}).` }));
  const summary = `${approvals.length} live approval(s) across ${chainsOut.length - failed.length} of ${chainsOut.length} chains. ${high} high risk, ${medium} medium risk${high + medium ? ", each with a ready-to-sign revoke tx" : ""}.${failed.length ? ` Couldn't read: ${failed.join(", ")}.` : ""}${partial.length ? ` Partial coverage on: ${partial.join(", ")}.` : ""}`;
  return JSON.parse(JSON.stringify({ type: "approval-sweep", owner, generatedAt: new Date().toISOString(), riskLevel, summary,
    counts: { live: approvals.length, high, medium, low: n("low"), unlimited: approvals.filter(a => a.unlimited).length, nft: approvals.filter(a => a.kind !== "erc20").length },
    chains: chainsOut, findings, approvals: approvals.slice(0, MAX_OUT), ...(approvals.length > MAX_OUT ? { approvalsTruncated: { shown: MAX_OUT, total: approvals.length, note: `Showing the ${MAX_OUT} riskiest; the rest are lower-ranked (see counts).` } } : {}),
    howToRevoke: "Send each revokeTx from the owner wallet on its chainId (to, data, value 0). It sets the allowance to 0 (approve(spender, 0)) or turns off setApprovalForAll. Costs only gas on that chain; nothing else is signed.",
    coverage: "ERC-20 allowances and NFT setApprovalForAll approvals found via GoPlus approval data (Ethereum, BNB, Base, Arbitrum, Polygon), Approval/ApprovalForAll event logs from Blockscout/Routescan where reachable, and our list of major tokens x common spenders, then re-read live onchain. Not covered: single-NFT approvals, Permit2 sub-allowances, off-chain signed permits not yet used.",
    disclaimer: "Automated heuristics from public data. Known spenders (Uniswap, Permit2, 1inch, OpenSea...) are normal to approve; unlimited approvals to them are still worth trimming. Not security or financial advice." },
    (_, x) => typeof x === "bigint" ? x.toString() : x));
}
