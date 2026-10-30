// Solana SPL / Token-2022 mint check from free public RPC only. Heuristics, not an audit.
// Covers: mint + freeze authority, metadata mutability (Metaplex or Token-2022 metadata), Token-2022 extensions,
// top-holder concentration (getTokenLargestAccounts, pools/curve excluded where identifiable),
// pump.fun bonding-curve status and, for graduated coins, the canonical PumpSwap pool's LP burn share.
import { createHash } from "node:crypto";
import { impersonation } from "./impersonation.js";

export const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RPCS = (process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com,https://public.rpc.solanavibestation.com").split(",").map(s => s.trim()).filter(Boolean);
export const P = {
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", system: "11111111111111111111111111111111",
  metaplex: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", pumpAmm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  wsol: "So11111111111111111111111111111111111111112", incinerator: "1nc1nerator11111111111111111111111111111111" };
const KNOWN_OWNERS = { "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": "Raydium AMM v4 pool", "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL": "Raydium CPMM pool", [P.incinerator]: "burn (incinerator)" };
const AMM_PROGRAMS = { [P.pumpAmm]: "PumpSwap pool", "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM v4 pool", "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP8C": "Raydium CPMM pool",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": "Raydium CLMM pool", "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": "Orca Whirlpool", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo": "Meteora DLMM pool",
  [P.pump]: "pump.fun bonding curve" };
const PUMP_AUTH = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"; // pump.fun mint/metadata authority

// ---- base58 ----
const ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58decode(s) { let n = 0n; for (const c of s) { const i = ALPH.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== "1") break; out.unshift(0); } return Uint8Array.from(out); }
export function b58encode(b) { let n = 0n; for (const x of b) n = (n << 8n) + BigInt(x); let s = ""; while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; } for (const x of b) { if (x !== 0) break; s = "1" + s; } return s; }
export function isPubkey(s) { if (typeof s !== "string" || !SOL_ADDR_RE.test(s)) return false; try { return b58decode(s).length === 32; } catch { return false; } }

// ---- ed25519 on-curve test (for PDA derivation and wallet-vs-program owner classification) ----
const Pm = 2n ** 255n - 19n, mod = a => ((a % Pm) + Pm) % Pm;
const pw = (b, e) => { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = r * b % Pm; b = b * b % Pm; e >>= 1n; } return r; };
const Dc = mod(-121665n * pw(121666n, Pm - 2n));
export function isOnCurve(bytes) {
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i] & (i === 31 ? 0x7f : 0xff)); y = mod(y);
  const y2 = y * y % Pm, u = mod(y2 - 1n), v = mod(Dc * y2 + 1n);
  const v3 = v * v % Pm * v % Pm, v7 = v3 * v3 % Pm * v % Pm; let x = u * v3 % Pm * pw(u * v7, (Pm - 5n) / 8n) % Pm;
  const vx2 = v * x % Pm * x % Pm; return vx2 === u || vx2 === mod(-u);
}
export function findPda(seeds, programId) {
  const prog = b58decode(programId);
  for (let bump = 255; bump >= 0; bump--) { const h = createHash("sha256"); for (const s of seeds) h.update(s); h.update(Uint8Array.of(bump)); h.update(prog); h.update(Buffer.from("ProgramDerivedAddress"));
    const d = h.digest(); if (!isOnCurve(d)) return b58encode(d); }
  throw new Error("no pda");
}
const enc = s => Buffer.from(s), pk = s => b58decode(s);

// ---- RPC with fallback across free public endpoints ----
async function rpc(method, params, ms = 9000) {
  let last;
  for (let round = 0; round < 2; round++) for (const url of RPCS) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    try { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: ac.signal });
      const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { throw new Error(`HTTP ${r.status} non-JSON`); }
      if (j.error) throw new Error(`${j.error.code} ${String(j.error.message).slice(0, 80)}`); return j.result;
    } catch (e) { last = e; } finally { clearTimeout(t); }
    if (round === 0) await new Promise(r => setTimeout(r, 150)); else await new Promise(r => setTimeout(r, 700));
  }
  throw new Error(`solana rpc ${method} failed: ${last?.message || last}`);
}
const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e?.message || e).slice(0, 160) }));
const acctData = v => v ? Buffer.from(v.data[0], "base64") : null;
const u64 = (b, o) => b.readBigUInt64LE(o);
const pctOf = (a, s) => s > 0n ? Math.round(Number(a * 1000000n / s)) / 10000 : null;
const ui = (a, d) => { const s = a.toString().padStart(d + 1, "0"); const w = s.slice(0, s.length - d), f = s.slice(s.length - d).replace(/0+$/, ""); return f ? `${w}.${f}` : w; };

// Metaplex Token Metadata account (borsh): key, update_authority, mint, name, symbol, uri, fee, creators?, primary_sale, is_mutable
export function parseMetaplex(b) {
  let o = 1; const ua = b58encode(b.subarray(o, o + 32)); o += 64;
  const str = () => { const n = b.readUInt32LE(o); o += 4; const s = b.subarray(o, o + n).toString("utf8").replace(/\0/g, "").trim(); o += n; return s; };
  const name = str(), symbol = str(), uri = str(); o += 2;
  if (b[o++] === 1) { const n = b.readUInt32LE(o); o += 4 + n * 34; }
  o += 1; const isMutable = b[o] === 1;
  return { updateAuthority: ua, name, symbol, uri, isMutable };
}

const BAD_EXT = { permanentDelegate: 1, transferHook: 1, transferFeeConfig: 1, defaultAccountState: 1, nonTransferable: 1, pausableConfig: 1 };
function readExtensions(list) {
  const out = { present: [], findings: [], transferFeeBps: null };
  for (const x of list || []) {
    const n = x.extension, s = x.state || {}; out.present.push(n);
    if (n === "permanentDelegate" && s.delegate) { out.permanentDelegate = s.delegate; out.findings.push({ severity: "high", note: `Permanent delegate ${s.delegate} can move or burn tokens from ANY holder's wallet.` }); }
    if (n === "transferHook" && s.programId) { out.transferHook = s.programId; out.findings.push({ severity: "high", note: `Transfer hook: program ${s.programId} runs on every transfer and could block sells.` }); }
    if (n === "transferHook" && !s.programId && s.authority) out.findings.push({ severity: "medium", note: "Transfer hook is empty now, but its authority can set one later." });
    if (n === "transferFeeConfig") { const bps = Number(s.newerTransferFee?.transferFeeBasisPoints ?? s.olderTransferFee?.transferFeeBasisPoints ?? 0); out.transferFeeBps = bps;
      if (bps > 0) out.findings.push({ severity: bps >= 500 ? "high" : "medium", note: `Transfer fee of ${bps / 100}% on every transfer.` });
      if (s.transferFeeConfigAuthority) out.findings.push({ severity: "medium", note: "Transfer fee can still be changed (fee authority is set)." }); }
    if (n === "defaultAccountState" && /frozen/i.test(s.accountState || "")) out.findings.push({ severity: "high", note: "New token accounts start FROZEN by default." });
    if (n === "nonTransferable") out.findings.push({ severity: "high", note: "Token is non-transferable (can't be sold)." });
    if (n === "pausableConfig") { if (s.paused) out.findings.push({ severity: "high", note: "Transfers are PAUSED right now." }); else if (s.authority) out.findings.push({ severity: "medium", note: "Transfers can be paused (pause authority set)." }); }
    if (n === "mintCloseAuthority" && s.closeAuthority) out.findings.push({ severity: "low", note: "Mint close authority is set." });
    if ((n === "interestBearingConfig" || n === "scaledUiAmountConfig") && (s.rateAuthority || s.authority)) out.findings.push({ severity: "low", note: `${n}: displayed balances can change over time.` });
  }
  return out;
}

export async function solanaToken(mint) {
  if (!isPubkey(mint)) throw Object.assign(new Error("not a valid Solana address (base58, 32 bytes)"), { status: 400 });
  const info = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const v = info?.value;
  if (!v) return { type: "solana-token-check", chain: "solana", address: mint, kind: "not-found", summary: "No account at this address on Solana mainnet (not a token, or never used)." };
  if (![P.token, P.token2022].includes(v.owner) || v.data?.parsed?.type !== "mint") {
    const kind = v.owner === P.system ? "wallet" : v.data?.parsed?.type === "account" ? "token-account" : v.executable ? "program" : "other-account";
    const extra = kind === "token-account" ? { mintOfThisAccount: v.data.parsed.info.mint } : {};
    return { type: "solana-token-check", chain: "solana", address: mint, kind, owner: v.owner, ...extra,
      summary: kind === "wallet" ? "This is a wallet, not a token mint." : kind === "token-account" ? `This is a token account (holds ${v.data.parsed.info.mint}), not the mint. Check the mint instead.` : "This is not an SPL token mint." };
  }
  const I = v.data.parsed.info, decimals = I.decimals, supply = BigInt(I.supply), is2022 = v.owner === P.token2022;
  const ext = readExtensions(I.extensions);
  const tm = (I.extensions || []).find(x => x.extension === "tokenMetadata")?.state;
  const metaPda = findPda([enc("metadata"), pk(P.metaplex), pk(mint)], P.metaplex);
  const curvePda = findPda([enc("bonding-curve"), pk(mint)], P.pump);
  const [metaR, curveR, largestR] = await Promise.all([
    settle(rpc("getAccountInfo", [metaPda, { encoding: "base64" }])), settle(rpc("getAccountInfo", [curvePda, { encoding: "base64" }])),
    settle(rpc("getTokenLargestAccounts", [mint, { commitment: "confirmed" }], 15000))]);
  const could = [], findings = [...ext.findings];

  // metadata
  let metadata = { source: null, updateAuthority: null, isMutable: null };
  let token = { name: null, symbol: null, uri: null, decimals, supply: ui(supply, decimals) };
  if (metaR.ok && metaR.v?.value && metaR.v.value.owner === P.metaplex) {
    try { const m = parseMetaplex(acctData(metaR.v.value)); metadata = { source: "metaplex", updateAuthority: m.updateAuthority, isMutable: m.isMutable }; Object.assign(token, { name: m.name, symbol: m.symbol, uri: m.uri }); }
    catch { could.push("Metaplex metadata account exists but couldn't be parsed."); }
  }
  if (tm) { if (!metadata.source) { metadata = { source: "token-2022", updateAuthority: tm.updateAuthority || null, isMutable: !!tm.updateAuthority }; }
    if (!token.name) Object.assign(token, { name: tm.name, symbol: tm.symbol, uri: tm.uri }); }
  if (!metaR.ok && !tm) could.push("Couldn't read Metaplex metadata (RPC error), so name/symbol and mutability are unknown.");
  else if (!metadata.source) could.push("No Metaplex or Token-2022 metadata found, so name/symbol are unknown.");
  const imp = impersonation("solana", mint, token); if (imp) findings.unshift({ severity: imp.severity, note: imp.note });
  if (metadata.isMutable) findings.push({ severity: "medium", note: `Metadata can still be changed (update authority ${metadata.updateAuthority === PUMP_AUTH ? "is pump.fun's" : metadata.updateAuthority}).` });

  // authorities
  const mintAuthority = { active: !!I.mintAuthority, address: I.mintAuthority || null };
  const freezeAuthority = { active: !!I.freezeAuthority, address: I.freezeAuthority || null };
  if (mintAuthority.active) findings.push({ severity: "high", note: `Mint authority is still active (${I.mintAuthority}): more tokens can be minted.` });
  if (freezeAuthority.active) findings.push({ severity: "high", note: `Freeze authority is still active (${I.freezeAuthority}): it can freeze any holder's tokens. Normal for stablecoins, a red flag on a meme.` });

  // pump.fun bonding curve / PumpSwap pool
  const known = {}; let pumpfun = { isPumpFun: false };
  if (!curveR.ok) could.push("Couldn't check for a pump.fun bonding curve (RPC error).");
  else if (curveR.v?.value && curveR.v.value.owner === P.pump) {
    const b = acctData(curveR.v.value), realTok = u64(b, 24), realSol = u64(b, 32), complete = b[48] === 1;
    known[curvePda] = "pump.fun bonding curve";
    pumpfun = { isPumpFun: true, bondingCurve: curvePda, status: complete ? "graduated" : "on-curve", solInCurve: ui(realSol, 9) };
    if (!complete) { const INIT = 793100000n * 10n ** BigInt(decimals); pumpfun.progressPct = realTok <= INIT ? Math.round(Number((INIT - realTok) * 1000n / INIT)) / 10 : null;
      if (pumpfun.progressPct != null && pumpfun.progressPct < 2) findings.push({ severity: "medium", note: "Almost nobody has bought on the bonding curve yet (under 2% filled), so liquidity is extremely thin." });
      findings.push({ severity: "info", note: `Still on the pump.fun bonding curve${pumpfun.progressPct != null ? ` (~${pumpfun.progressPct}% to graduation)` : ""}. Liquidity sits in the curve, there's no LP to pull yet.` }); }
    else pumpfun.pool = null; // filled in below from the canonical PDA or from the top holders
  }

  // holders (also used to spot pools: owners that are accounts of known AMM programs)
  let holders = { available: false }, poolsSeen = [];
  if (!largestR.ok) { holders.reason = "getTokenLargestAccounts failed on the free public RPCs (rate limit)"; could.push("Top holders: " + holders.reason + "."); }
  else if (supply > 0n) {
    const accts = largestR.v.value || [];
    const ownersR = await settle(rpc("getMultipleAccounts", [accts.map(a => a.address), { encoding: "jsonParsed" }]));
    const owners = accts.map((a, i) => ownersR.ok ? ownersR.v.value[i]?.data?.parsed?.info?.owner || null : null);
    const offCurve = [...new Set(owners.filter(o => o && !known[o] && !KNOWN_OWNERS[o] && !isOnCurve(b58decode(o))))];
    const progR = offCurve.length ? await settle(rpc("getMultipleAccounts", [offCurve, { encoding: "base64" }])) : { ok: true, v: { value: [] } };
    const ownerProg = {}; if (progR.ok) offCurve.forEach((o, i) => { const x = progR.v.value[i]; if (x) { ownerProg[o] = x.owner; if (x.owner === P.pumpAmm) poolsSeen.push({ address: o, data: acctData(x) }); } });
    const byOwner = new Map();
    accts.forEach((a, i) => { const ow = owners[i]; const key = ow || a.address;
      const label = known[a.address] || (ow && known[ow]) || (ow && KNOWN_OWNERS[ow]) || (ow && AMM_PROGRAMS[ownerProg[ow]]) || (ow ? (isOnCurve(b58decode(ow)) ? null : "program-owned (likely a pool, vault or locker; uncertain)") : "owner unknown");
      const cur = byOwner.get(key) || { owner: key, amount: 0n, label }; cur.amount += BigInt(a.amount); byOwner.set(key, cur); });
    const list = [...byOwner.values()].sort((a, b) => (b.amount > a.amount ? 1 : -1));
    const isPool = h => h.label && h.label !== "owner unknown";
    const sum = arr => arr.reduce((s, h) => s + h.amount, 0n);
    const wallets = list.filter(h => !isPool(h));
    holders = { available: true, basis: "largest 20 token accounts, grouped by owner", top10Pct: pctOf(sum(list.slice(0, 10)), supply),
      top10ExcludingPoolsPct: pctOf(sum(wallets.slice(0, 10)), supply), largestWalletPct: wallets[0] ? pctOf(wallets[0].amount, supply) : 0,
      top: list.slice(0, 10).map(h => ({ owner: h.owner, pctOfSupply: pctOf(h.amount, supply), label: h.label })) };
    if (!ownersR.ok) could.push("Couldn't resolve token-account owners, so pools may be counted as holders.");
    const t = holders.top10ExcludingPoolsPct;
    if (t >= 50) findings.push({ severity: "high", note: `Top 10 wallets (excluding pools/curve) hold ${t}% of supply.` });
    else if (t >= 25) findings.push({ severity: "medium", note: `Top 10 wallets (excluding pools/curve) hold ${t}% of supply.` });
    if (holders.largestWalletPct >= 10) findings.push({ severity: holders.largestWalletPct >= 20 ? "high" : "medium", note: `One wallet holds ${holders.largestWalletPct}% of supply.` });
  }

  // PumpSwap LP for graduated pump.fun coins: canonical pool PDA first, else a PumpSwap pool seen among the top holders.
  if (pumpfun.status === "graduated") {
    let pool = poolsSeen.find(x => x.data.length >= 211 && b58encode(x.data.subarray(43, 75)) === mint);
    if (!pool) { const auth = findPda([enc("pool-authority"), pk(mint)], P.pump);
      const addr = findPda([enc("pool"), Uint8Array.of(0, 0), pk(auth), pk(mint), pk(P.wsol)], P.pumpAmm);
      const pr = await settle(rpc("getAccountInfo", [addr, { encoding: "base64" }]));
      if (pr.ok && pr.v?.value && pr.v.value.owner === P.pumpAmm) pool = { address: addr, data: acctData(pr.v.value) }; }
    if (pool) {
      const pb = pool.data, lpMint = b58encode(pb.subarray(107, 139)), quoteAcct = b58encode(pb.subarray(171, 203)), lpMinted = u64(pb, 203);
      const [lpS, qB] = await Promise.all([settle(rpc("getTokenSupply", [lpMint])), settle(rpc("getTokenAccountBalance", [quoteAcct]))]);
      const quoteMint = b58encode(pb.subarray(75, 107)), QN = { [P.wsol]: "SOL", EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC", pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn: "PUMP" };
      pumpfun.pool = { dex: "PumpSwap", address: pool.address, lpMint, quoteMint, quoteSymbol: QN[quoteMint] || null, quoteReserve: qB.ok ? qB.v.value.uiAmountString : null };
      if (lpS.ok && lpMinted > 0n) { const left = BigInt(lpS.v.value.amount); const burned = lpMinted > left ? lpMinted - left : 0n;
        pumpfun.pool.lpBurnedPct = pctOf(burned, lpMinted);
        if (pumpfun.pool.lpBurnedPct < 95) findings.push({ severity: "medium", note: `Only ${pumpfun.pool.lpBurnedPct}% of the PumpSwap LP is burned. Someone holds the rest and could pull it.` });
        else findings.push({ severity: "info", note: `Graduated to PumpSwap; ${pumpfun.pool.lpBurnedPct}% of the pool's LP tokens are burned${pumpfun.pool.quoteReserve ? ` (pool holds ${pumpfun.pool.quoteReserve} ${pumpfun.pool.quoteSymbol || "of the paired token"})` : ""}.` }); }
      else could.push("Couldn't read the PumpSwap LP supply, so LP burn status is unknown.");
      if (pumpfun.pool.quoteSymbol === "SOL" && pumpfun.pool.quoteReserve != null && Number(pumpfun.pool.quoteReserve) < 10) findings.push({ severity: "medium", note: `Thin liquidity: the PumpSwap pool holds only ${Number(pumpfun.pool.quoteReserve).toFixed(2)} SOL.` });
    } else could.push("Graduated from pump.fun, but no PumpSwap pool was found (older coins migrated to Raydium). LP burn/lock status not checked.");
  }
  if (!pumpfun.isPumpFun) could.push("LP burn/lock is only checked for pump.fun coins (bonding curve / PumpSwap). For other tokens it wasn't determined.");

  const hi = findings.filter(f => f.severity === "high").length, med = findings.filter(f => f.severity === "medium").length;
  const riskLevel = hi ? "high" : med ? "medium" : "low";
  const nm = token.name ? `${token.name} (${token.symbol})` : "Unnamed token";
  const bits = [`${nm}, a ${is2022 ? "Token-2022" : "SPL"} token on Solana.`,
    mintAuthority.active ? "Mint authority is ACTIVE." : "Mint authority revoked.", freezeAuthority.active ? "Freeze authority is ACTIVE." : "Freeze authority revoked.",
    metadata.isMutable == null ? "" : metadata.isMutable ? "Metadata is mutable." : "Metadata is immutable.",
    pumpfun.isPumpFun ? (pumpfun.status === "on-curve" ? "Still on the pump.fun bonding curve." : `Graduated from pump.fun${pumpfun.pool?.lpBurnedPct != null ? `, ${pumpfun.pool.lpBurnedPct}% of LP burned` : ""}.`) : "",
    holders.available ? `Top 10 wallets excluding pools hold ${holders.top10ExcludingPoolsPct}%.` : ""].filter(Boolean);
  return { type: "solana-token-check", chain: "solana", kind: "mint", address: mint, tokenProgram: is2022 ? "token-2022" : "spl-token", token, mintAuthority, freezeAuthority, metadata,
    extensions: { present: ext.present, transferFeeBps: ext.transferFeeBps, permanentDelegate: ext.permanentDelegate || null, transferHook: ext.transferHook || null },
    pumpfun, holders, riskLevel, findings, summary: bits.join(" "), couldNotDetermine: could,
    disclaimer: "Automated heuristics from public Solana RPC data. Not an audit, not a guarantee, not financial advice. No sell simulation was run." };
}
