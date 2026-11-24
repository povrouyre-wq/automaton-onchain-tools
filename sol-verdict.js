// $0.02 Solana quick token verdict: SAFE / CAUTION / AVOID from our own Solana mint check (solana.js) plus DEX liquidity
// from DexScreener's free public API. Same packaging as the EVM verdict (verdict.js). Nothing is sent onchain, no sell
// simulation is run (Solana has no free eth_call-style quote path we trust), and nothing here calls an LLM.
// Not a mint (wallet, token account, unknown address) is a 422 and is not charged.
import { solanaToken, isPubkey } from "./solana.js";
import { OFFICIAL_ADDRESSES } from "./impersonation.js";
import { verdictSummary } from "./verdict.js";

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const r2 = n => (n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
const usd = n => "$" + Math.round(n).toLocaleString("en-US");
const short = a => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "");
const DS = "https://api.dexscreener.com/latest/dex/tokens/";
export const THIN_LIQ_USD = 10000;

// Verdict rules for Solana. Thresholds are inclusive on the risky side and mirror the EVM verdict where the concept maps.
//
// AVOID when any of these is true:
//   - token can't move: non-transferable, accounts start frozen, or transfers are paused right now
//   - a permanent delegate is set (it can move or burn tokens out of any wallet)
//   - mint authority is live (more supply can be printed) on a token that isn't a known official issuer mint
//   - freeze authority is live (any holder can be frozen) on a token that isn't a known official issuer mint
//   - a transfer hook program is set AND its authority can still change it (it can block sells)
//   - Token-2022 transfer fee >= 5% per transfer (>= 10% round trip, same as the EVM tax line)
//   - top 10 wallets, excluding pools and the bonding curve, hold >= 50% of supply
//   - copycat: name or symbol copies a known major token at a non-official mint
//
// CAUTION when it is not AVOID and any of these is true:
//   - a known official issuer mint (USDC, USDT, PYUSD...) keeps mint/freeze/delegate/hook powers: normal for a stablecoin
//   - transfer fee >= 1.5% per transfer, or the fee authority can still change it
//   - transfers can be paused (pause authority set), or a transfer hook is set but fixed / empty but changeable
//   - metadata is mutable (name, symbol and image can be swapped)
//   - top 10 (excl. pools/curve) >= 20% and < 50%, or one wallet holds >= 10%
//   - liquidity: under $10k in DEX pools, no DEX pool found, a pump.fun curve under 2% filled,
//     or the LP burn/lock share is unknown or under 50% (for non-pump.fun tokens it can't be read from free data)
//
// SAFE only when none of the above fired. Unknown holder concentration is an info finding, not a pass on a made-up number.
// riskLevel: critical when the token can't move or has a permanent delegate; high for any other AVOID; medium for CAUTION; low for SAFE.
export function scoreSolanaVerdict(f) {
  const findings = [];
  const add = (tier, severity, note) => findings.push({ tier, severity, note });
  const off = !!f.official;
  if (f.nonTransferable) add("AVOID", "high", "Token is non-transferable, so it can't be sold.");
  if (f.defaultFrozen) add("AVOID", "high", "New token accounts start frozen, so buyers may not be able to move or sell.");
  if (f.paused) add("AVOID", "high", "Transfers are paused right now.");
  const issuer = [f.mintAuthorityActive && "mint", f.freezeAuthorityActive && "freeze", f.permanentDelegate && "move any holder's tokens", f.transferHook && "run a transfer hook"].filter(Boolean);
  if (off && issuer.length) add("CAUTION", "medium", `Official issuer mint: the issuer can ${issuer.join(", ")}. Normal for a stablecoin or wrapped asset, but it is central control.`);
  if (!off) {
    if (f.permanentDelegate) add("AVOID", "high", "A permanent delegate can move or burn tokens out of any holder's wallet.");
    if (f.mintAuthorityActive) add("AVOID", "high", "Mint authority is still active, so more supply can be printed.");
    if (f.freezeAuthorityActive) add("AVOID", "high", "Freeze authority is still active, so any holder's tokens can be frozen.");
    if (f.transferHook && f.transferHookChangeable) add("AVOID", "high", "A transfer hook runs on every transfer and its authority can still change it, which can block sells.");
    else if (f.transferHook) add("CAUTION", "medium", "A transfer hook program runs on every transfer (authority revoked, so it is fixed).");
    else if (f.transferHookChangeable) add("CAUTION", "medium", "Transfer hook is empty now, but its authority can set one later.");
  }
  const fee = Number(f.transferFeePct ?? 0);
  if (fee >= 5) add("AVOID", "high", `Transfer fee is ${r2(fee)}% on every transfer (${r2(fee * 2)}% on a buy plus a sell).`);
  else if (fee >= 1.5) add("CAUTION", "medium", `Transfer fee is ${r2(fee)}% on every transfer.`);
  else if (fee > 0) add("INFO", "info", `Transfer fee is ${r2(fee)}% on every transfer.`);
  if (f.transferFeeChangeable && !off) add("CAUTION", "medium", "The transfer fee can still be changed (fee authority is set).");
  if (f.pausable && !f.paused && !off) add("CAUTION", "medium", "Transfers can be paused (pause authority is set).");

  if (f.metadataMutable === true && !off) add("CAUTION", "medium", "Metadata is mutable, so the name, symbol and image can still be changed.");
  else if (f.metadataMutable == null) add("INFO", "info", "Metadata mutability could not be read.");

  if (f.top10HolderPct != null && f.top10HolderPct >= 50) add("AVOID", "high", `Top 10 wallets excluding pools and the curve hold ${r2(f.top10HolderPct)}% of supply.`);
  else if (f.top10HolderPct != null && f.top10HolderPct >= 20 && !off) add("CAUTION", "medium", `Top 10 wallets excluding pools and the curve hold ${r2(f.top10HolderPct)}% of supply.`);
  if (f.largestWalletPct != null && f.largestWalletPct >= 10 && !(f.top10HolderPct >= 50) && !off) add("CAUTION", "medium", `One wallet holds ${r2(f.largestWalletPct)}% of supply.`);

  if (!off) {
    if (f.pumpfunStatus === "on-curve") {
      if (f.curveProgressPct != null && f.curveProgressPct < 2) add("CAUTION", "medium", "Still on the pump.fun bonding curve and under 2% filled, so liquidity is extremely thin.");
      else add("INFO", "info", `Still on the pump.fun bonding curve${f.curveProgressPct != null ? ` (~${f.curveProgressPct}% to graduation)` : ""}. Liquidity sits in the curve, there is no LP to pull yet.`);
    } else {
      if (f.liquidityUsd == null && f.liquidityError) add("CAUTION", "medium", "DEX liquidity could not be read.");
      else if (f.liquidityUsd == null || f.poolCount === 0) add("CAUTION", "medium", "No DEX pool was found for this token, so it may be hard to sell.");
      else if (f.liquidityUsd < THIN_LIQ_USD) add("CAUTION", "medium", `Thin liquidity: about ${usd(f.liquidityUsd)} across ${f.poolCount} DEX pool${f.poolCount === 1 ? "" : "s"}.`);
      if (f.lpBurnedOrLockedPct == null) add("CAUTION", "medium", "LP burn/lock share could not be determined.");
      else if (f.lpBurnedOrLockedPct < 50) add("CAUTION", "medium", `Only ${r2(f.lpBurnedOrLockedPct)}% of LP is burned.`);
    }
  }
  if (f.copycatName) {
    const note = f.copycatNote || "Name or symbol copies a major token but this is not the official mint.";
    add("AVOID", "high", (note[0].toUpperCase() + note.slice(1)).replace(/([^.])$/, "$1."));
  }
  if (!findings.some(x => x.tier === "AVOID" || x.tier === "CAUTION")) findings.unshift({ tier: "INFO", severity: "info", note: f.pumpfunStatus === "on-curve"
    ? "Mint and freeze authority revoked, metadata locked, no risky Token-2022 extensions and holders spread out; still on the pump.fun curve, so there is no LP to pull yet."
    : "Mint and freeze authority revoked, metadata locked, no risky Token-2022 extensions, holders spread out and LP burned." });

  const verdict = findings.some(x => x.tier === "AVOID") ? "AVOID" : findings.some(x => x.tier === "CAUTION") ? "CAUTION" : "SAFE";
  const critical = !off && (f.nonTransferable || f.defaultFrozen || f.paused || f.permanentDelegate);
  const riskLevel = verdict === "AVOID" ? (critical ? "critical" : "high") : verdict === "CAUTION" ? "medium" : "low";
  return { verdict, riskLevel, findings: findings.map(({ severity, note }) => ({ severity, note })) };
}

// DEX pools for a mint from DexScreener's free API (no key, ~300 req/min). Pools where the mint is base or quote.
export async function dexLiquidity(mint, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const r = await fetchImpl(DS + mint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`DexScreener ${r.status}`);
  const j = await r.json();
  const pairs = (j.pairs || []).filter(p => p.chainId === "solana" && (p.baseToken?.address === mint || p.quoteToken?.address === mint));
  const pools = pairs.map(p => ({ dex: [p.dexId, ...(p.labels || [])].filter(Boolean).join(" "), address: p.pairAddress,
    pairedWith: p.baseToken?.address === mint ? p.quoteToken?.symbol : p.baseToken?.symbol, liquidityUsd: r2(p.liquidity?.usd ?? null), createdAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null }))
    .sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  const total = pools.reduce((s, p) => s + (p.liquidityUsd || 0), 0);
  const top = pairs.find(p => p.pairAddress === pools[0]?.address);
  return { source: "dexscreener", poolCount: pools.length, totalUsd: pools.length ? r2(total) : null, pools: pools.slice(0, 5),
    priceUsd: top?.priceUsd ? Number(top.priceUsd) : null, fdvUsd: top?.fdv ?? null, capped: (j.pairs || []).length >= 30 };
}

export async function solanaVerdict(mint, opts = {}) {
  if (!isPubkey(mint)) throw fail(400, "token must be a Solana mint address (base58, 32 bytes)");
  const t0 = Date.now();
  const [chk, liq] = await Promise.all([
    (opts.solanaToken || solanaToken)(mint),
    (opts.dexLiquidity || dexLiquidity)(mint).catch(e => ({ error: String(e?.message || e).slice(0, 160) })),
  ]);
  if (chk.kind !== "mint") throw fail(422, (chk.summary || "Not a Solana token mint.") + " Not charged.");
  const ex = chk.extensions || {}, h = chk.holders || {}, pf = chk.pumpfun || {};
  const official = OFFICIAL_ADDRESSES.solana.has(mint.toLowerCase());
  const lpPct = pf.isPumpFun && pf.status === "graduated" ? (pf.pool?.lpBurnedPct ?? null) : null;
  const input = {
    official, mintAuthorityActive: !!chk.mintAuthority?.active, freezeAuthorityActive: !!chk.freezeAuthority?.active,
    permanentDelegate: !!ex.permanentDelegate, transferHook: !!ex.transferHook, transferHookChangeable: !!ex.transferHookAuthority,
    transferFeePct: ex.transferFeeBps != null ? ex.transferFeeBps / 100 : 0, transferFeeChangeable: !!ex.transferFeeAuthority,
    nonTransferable: !!ex.nonTransferable, defaultFrozen: !!ex.defaultFrozen, paused: !!ex.paused, pausable: !!ex.pauseAuthority,
    metadataMutable: chk.metadata?.isMutable ?? null,
    top10HolderPct: h.available ? h.top10ExcludingPoolsPct : null, largestWalletPct: h.available ? h.largestWalletPct : null,
    pumpfunStatus: pf.isPumpFun ? pf.status : null, curveProgressPct: pf.progressPct ?? null,
    lpBurnedOrLockedPct: lpPct, liquidityUsd: liq.error ? null : liq.totalUsd, poolCount: liq.error ? null : liq.poolCount, liquidityError: !!liq.error,
    copycatName: !!chk.copycat, copycatNote: chk.copycat?.note || null,
  };
  const scored = scoreSolanaVerdict(input);
  const findings = scored.findings.map(x => ({ ...x }));
  if (!h.available) findings.push({ severity: "info", note: "Top-holder concentration could not be determined, so it was not used in the verdict." });
  const could = [...(chk.couldNotDetermine || []).filter(x => !/^LP burn\/lock is only checked/.test(x))];
  if (liq.error) could.push("DEX liquidity: " + liq.error + ".");
  if (!pf.isPumpFun && !official) could.push("LP burn/lock: for non-pump.fun tokens the pools are mostly concentrated-liquidity (Orca, Raydium CLMM, Meteora), where LP is held as positions, so burn/lock can't be read from free data.");
  const flags = {
    mintAuthorityActive: input.mintAuthorityActive, freezeAuthorityActive: input.freezeAuthorityActive, metadataMutable: input.metadataMutable,
    permanentDelegate: input.permanentDelegate, transferHook: input.transferHook, transferFeePct: r2(input.transferFeePct), nonTransferable: input.nonTransferable,
    pausable: input.pausable || input.paused, paused: input.paused, defaultFrozen: input.defaultFrozen, top10HolderPct: input.top10HolderPct, largestWalletPct: input.largestWalletPct,
    liquidityUsd: input.liquidityUsd, lpBurnedOrLockedPct: lpPct, pumpfun: pf.isPumpFun ? pf.status : null, officialIssuerMint: official, copycatName: input.copycatName,
  };
  const t = chk.token || {}, N = t.symbol || t.name || short(mint);
  return {
    type: "token-verdict", chain: "solana", address: mint, tokenProgram: chk.tokenProgram,
    token: { address: mint, symbol: t.symbol ?? null, name: t.name ?? null, decimals: t.decimals ?? null, supply: t.supply ?? null },
    verdict: scored.verdict, riskLevel: scored.riskLevel, summary: verdictSummary(N, "Solana", scored),
    flags, findings,
    liquidity: liq.error ? { source: "dexscreener", error: liq.error } : liq,
    coverage: { holderBasis: h.available ? h.basis : null, pumpfun: pf.isPumpFun ? pf : null, notes: ["No sell simulation is run on Solana. Sellability is inferred from authorities, extensions and liquidity."] },
    couldNotDetermine: could, elapsedMs: Date.now() - t0,
    disclaimer: "Automated verdict from public Solana data: mint and freeze authority, metadata, Token-2022 extensions, top holders, and DEX liquidity (DexScreener). No sell simulation. SAFE is not an audit. Authorities and liquidity can change later. Not financial or security advice.",
  };
}
