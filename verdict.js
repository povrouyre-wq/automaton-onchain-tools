// $0.02 quick token verdict: SAFE / CAUTION / AVOID, plus the raw flags the other routes sell separately.
// Reuses honeypot.js (buy/sell sim), contractRisk() from lib.js, and holders() + lpStatus() from deepscan.js.
// Same public RPCs as those modules. Nothing is sent onchain. Inconclusive sims throw (422) and are not charged.
import { getAddress, parseAbi } from "viem";
import { CHAINS, contractRisk } from "./lib.js";
import { impersonation } from "./impersonation.js";
import { honeypotCheck, HONEYPOT_CHAINS } from "./honeypot.js";
import { findPools, holders, lpStatus } from "./deepscan.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const SUPPLY = parseAbi(["function totalSupply() view returns (uint256)"]);
const low = a => String(a || "").toLowerCase();
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const r2 = n => (n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
const short = a => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

// Verdict rules. Tuned to be honest, not clickbait. Thresholds are inclusive on the risky side.
// Combined tax is buyTaxPct + sellTaxPct (not the max). A 6% buy and a 6% sell is AVOID here.
//
// AVOID when any of these is true:
//   - not sellable (simulated sell failed: honeypot)
//   - buy tax + sell tax >= 10% ( >= 50% is riskLevel critical, same as a failed sell )
//   - owner is not renounced AND the bytecode has mint or blacklist
//   - top 10 holders, excluding pools and burn, own >= 50% of supply
//   - copycat: name or symbol copies a known major token at a non-official address
//
// CAUTION when it is not AVOID and any of these is true:
//   - combined tax >= 3% and < 10%
//   - proxy or upgradeable (including a minimal proxy, or a UUPS upgrade selector)
//   - LP burned-or-locked share < 50%, unknown, or a lower bound that is not conclusive
//   - top 10 (excl. pools/burn) >= 20% and < 50%
//   - holder list is only a partial recent-transfer sample (real concentration may be higher)
//   - a live owner can pause or change fees, or paused() is currently true
//   - the contract-risk read failed, so owner powers are unknown
//
// SAFE only when it is sellable, combined tax < 3%, LP burn/lock >= 50% and conclusive,
// holder concentration is a full read under 20% (or was not available — that gap is an info
// finding, not a silent pass on a made-up number), and none of the triggers above fired.
// Residual caveats (renounced admin selectors, unverified source, a non-renounced owner with
// no mint/blacklist/pause/fee selector) stay in findings and do not raise the verdict.
//
// riskLevel: critical for a failed sell or combined tax >= 50%; high for any other AVOID;
// medium for CAUTION; low for SAFE.
export function scoreTokenVerdict(f) {
  const buy = Number(f.buyTaxPct ?? 0), sell = Number(f.sellTaxPct ?? 0);
  const tax = r2(buy + sell);
  const findings = [];
  const add = (tier, severity, note) => findings.push({ tier, severity, note });
  if (f.sellable === false) add("AVOID", "high", `Not sellable: the simulated sell failed${f.sellFail ? ` (${f.sellFail})` : ""}.`);
  else if (tax >= 50) add("AVOID", "high", `Buy plus sell tax is ${tax}% (buy ${r2(buy)}%, sell ${r2(sell)}%), which takes most of a round trip.`);
  else if (tax >= 10) add("AVOID", "high", `Buy plus sell tax is ${tax}% (buy ${r2(buy)}%, sell ${r2(sell)}%).`);
  else if (tax >= 3) add("CAUTION", "medium", `Buy plus sell tax is ${tax}% (buy ${r2(buy)}%, sell ${r2(sell)}%).`);
  else add("INFO", "info", `Simulated buy and sell both worked (buy ${r2(buy)}%, sell ${r2(sell)}%).`);

  if (f.contractRiskUnknown) add("CAUTION", "medium", "Owner powers could not be read, so this cannot be called safe.");
  else {
    if (f.ownerRenounced === false && (f.canMint || f.canBlacklist)) {
      const bits = [f.canMint && "mint new supply", f.canBlacklist && "blacklist wallets"].filter(Boolean).join(" and ");
      const who = f.ownerType === "eoa" ? "a single wallet" : typeof f.ownerType === "string" && f.ownerType.startsWith("contract") ? "a contract" : "an address";
      add("AVOID", "high", `Owner has not renounced (${who}) and the contract can ${bits}.`);
    }
    if (f.isProxy) add("CAUTION", "medium", f.proxyNote || "Contract is a proxy, so the code buyers interact with can change.");
    if (f.canPause && f.ownerRenounced === false) add("CAUTION", "medium", f.paused ? "Owner can pause transfers, and paused() is currently true." : "Owner can pause transfers.");
    else if (f.paused) add("CAUTION", "medium", "paused() is currently true.");
    if (f.canChangeFees && f.ownerRenounced === false) add("CAUTION", "medium", "Owner can change fees or max-transaction limits.");
    if (f.ownerRenounced && (f.canMint || f.canBlacklist || f.canPause || f.canChangeFees)) add("INFO", "info", "Admin selectors are in the bytecode, but ownership is renounced so they should be unreachable.");
    else if (f.ownerRenounced === false && !f.canMint && !f.canBlacklist && !f.canPause && !f.canChangeFees && !f.isProxy) add("INFO", "info", "Ownership is not renounced. No mint, pause, blacklist or fee selector was found.");
  }

  if (f.lpBurnedOrLockedPct == null) add("CAUTION", "medium", "LP burn/lock share could not be determined.");
  else if (f.lpBurnedOrLockedPct < 50) add("CAUTION", "medium", `Only ${f.lpBurnedOrLockedPct}% of LP is burned or locked.`);
  else if (f.lpUncertain) add("CAUTION", "medium", `${f.lpBurnedOrLockedPct}% of LP looks burned or locked, but a large holder is an unlabeled contract, so the lock is not conclusive.`);

  if (f.top10HolderPct != null && f.top10HolderPct >= 50) add("AVOID", "high", `Top 10 holders excluding pools and burn own ${f.top10HolderPct}% of supply.`);
  else if (f.top10HolderPct != null && f.top10HolderPct >= 20) add("CAUTION", "medium", `Top 10 holders excluding pools and burn own ${f.top10HolderPct}% of supply.`);
  if (f.top10Partial && !(f.top10HolderPct >= 50)) add("CAUTION", "medium", "Holder concentration is only a partial sample of recent transfers, so the real top-10 share may be higher.");
  if (f.copycatName) {
    const note = f.copycatNote || "Name or symbol copies a major token but this is not the official contract.";
    add("AVOID", "high", note.endsWith(".") ? note[0].toUpperCase() + note.slice(1) : note[0].toUpperCase() + note.slice(1) + ".");
  }

  const verdict = findings.some(x => x.tier === "AVOID") ? "AVOID" : findings.some(x => x.tier === "CAUTION") ? "CAUTION" : "SAFE";
  const riskLevel = verdict === "AVOID" ? (f.sellable === false || tax >= 50 ? "critical" : "high") : verdict === "CAUTION" ? "medium" : "low";
  return { verdict, riskLevel, tax, findings: findings.map(({ severity, note }) => ({ severity, note })) };
}

// One sentence, no second clause hiding a worse flag. The lead is the highest-severity finding.
export function verdictSummary(name, chainName, scored) {
  const rank = { high: 0, medium: 1, low: 2, info: 3 };
  const lead = [...scored.findings].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))[0];
  const why = (lead?.note || "a simulated buy and sell worked, tax is low, and no high-risk owner powers were found").replace(/\.$/, "");
  // Lowercase a normal first word ("Not sellable" -> "not sellable") and leave acronyms ("LP") alone.
  const body = /^[A-Z][^A-Z]/.test(why) ? why.charAt(0).toLowerCase() + why.slice(1) : why;
  return `${name} on ${chainName}: ${scored.verdict} because ${body}.`;
}

const V4 = ["0x498581fF718922c3f8e6A244956aF099B2652b2b", "0x000000000004444c5dc75cB358380D2e3dE08A90", "0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF"];

export async function tokenVerdict(chain, address, opts = {}) {
  if (!HONEYPOT_CHAINS.includes(chain)) throw fail(400, "chain must be base, ethereum or bsc");
  const C = CHAINS[chain], t0 = Date.now(), token = getAddress(address);
  const [hp, risk, pools, supply] = await Promise.all([
    honeypotCheck(chain, token, opts),
    contractRisk(chain, token).catch(e => ({ _error: String(e.shortMessage || e.message).slice(0, 160) })),
    findPools(chain, token).catch(() => null),
    C.rpc.readContract({ address: token, abi: SUPPLY, functionName: "totalSupply" }).catch(() => null),
  ]);
  const unknown = !!risk._error;
  const owner = unknown ? null : risk.owner ?? null;
  const caps = risk.capabilities || {};
  const poolObj = (pools || []).find(p => low(p.address) === low(hp.pool?.address))
    || (hp.pool?.address ? { kind: String(hp.pool.type || "").startsWith("concentrated") ? "v3" : "v2", address: hp.pool.address } : null);
  const known = { [low(DEAD)]: "dead address (burn)", [low(ZERO)]: "zero address (burn)", [low(token)]: "token contract itself" };
  for (const p of pools || []) known[low(p.address)] = `${p.dex}${p.fee ? " " + p.fee / 10000 + "%" : ""} pool`;
  if (hp.pool?.address && !known[low(hp.pool.address)]) known[low(hp.pool.address)] = `${hp.pool.dex || "pool"} pool`;
  if (owner && owner !== ZERO && !known[low(owner)]) known[low(owner)] = "owner (kept in concentration)";
  for (const k of V4) known[low(k)] = "Uniswap V4 PoolManager";

  const decimals = hp.token?.decimals;
  const [hold, lp] = await Promise.all([
    supply == null ? { available: false, reason: "totalSupply() could not be read." }
      : supply === 0n ? { available: false, reason: "total supply is zero." }
      : decimals == null ? { available: false, reason: "token decimals were not readable." }
      : holders(chain, token, supply, decimals, known).catch(e => ({ available: false, reason: String(e.message).slice(0, 160) })),
    poolObj ? lpStatus(chain, poolObj, token, owner).catch(e => ({ determinable: false, note: String(e.message).slice(0, 160) })) : null,
  ]);

  let lpPct = null, lpUncertain = false;
  const could = [];
  if (!poolObj) could.push("LP lock: the pool used for the sell simulation had no address to read.");
  else if (poolObj.kind === "v3") could.push("LP lock: V3 liquidity is held as position NFTs, so burn/lock cannot be read from the pool.");
  else if (!lp || (lp.safeSharePct == null && lp.burnedPct == null)) could.push("LP lock: " + (lp?.note || "could not read LP supply."));
  else {
    lpPct = r2(lp.safeSharePct ?? lp.burnedPct);
    if (lp.determinable === false) { lpUncertain = true; could.push("LP lock: " + (lp.verdict || lp.note || "burned share is a lower bound; unlabeled lockers are missed.")); }
  }
  if (pools == null) could.push("Pool list for holder labels failed; concentration may count a pool as a wallet.");
  if (!hold?.available) could.push("Top holders: " + (hold?.reason || "unavailable."));
  else if (hold.partial && hold.note) could.push(hold.note);
  if (unknown) could.push("Contract risk: " + risk._error);
  else if (risk.sourcify?.contract?.verified == null) could.push("Sourcify verification could not be checked.");

  const imp = impersonation(chain, token, { name: hp.token?.name, symbol: hp.token?.symbol });
  const proxy = !unknown && (risk.proxy || caps.upgrade);
  const proxyNote = !proxy ? null : risk.proxy
    ? `Contract is a proxy (${risk.proxy.standard})${risk.proxy.standard === "EIP-1167" ? ", a minimal clone" : ", so its logic can change"}.`
    : "UUPS-style upgrade function is present, so the logic can change.";
  const sellFail = hp.sellable === false ? [hp.simulation?.failedAt, hp.simulation?.revertReason].filter(Boolean).join(": ") : "";
  const input = {
    sellable: hp.sellable === true, buyTaxPct: r2(hp.buyTaxPct), sellTaxPct: r2(hp.sellTaxPct), sellFail,
    ownerRenounced: unknown ? null : owner === ZERO || owner == null, ownerType: unknown ? null : risk.ownerType ?? null,
    isProxy: unknown ? null : !!proxy, proxyNote, paused: !unknown && risk.paused === true,
    canMint: unknown ? null : !!caps.mint, canPause: unknown ? null : !!caps.pause,
    canBlacklist: unknown ? null : !!caps.blacklist, canChangeFees: unknown ? null : !!caps.fees,
    lpBurnedOrLockedPct: lpPct, lpUncertain,
    top10HolderPct: hold?.available ? hold.top10ExcludingPoolsAndBurnPct : null,
    top10Partial: !!hold?.partial, copycatName: !!imp, copycatNote: imp?.note || null, contractRiskUnknown: unknown,
  };
  const scored = scoreTokenVerdict(input);
  const findings = scored.findings.map(x => ({ ...x }));
  if (!unknown && owner == null) findings.push({ severity: "info", note: "No owner() address was returned." });
  if (!unknown && risk.sourcify?.contract?.verified === false && risk.sourcify?.implementation?.verified !== true) findings.push({ severity: "info", note: "Source is not verified on Sourcify. Another explorer may still have it, and this alone does not change the verdict." });
  if (!hold?.available) findings.push({ severity: "info", note: "Top-holder concentration could not be determined, so it was not used in the verdict." });

  const flags = {
    sellable: input.sellable, buyTaxPct: input.buyTaxPct, sellTaxPct: input.sellTaxPct,
    ownerRenounced: input.ownerRenounced, isProxy: input.isProxy, canMint: input.canMint, canPause: input.canPause,
    canBlacklist: input.canBlacklist, canChangeFees: input.canChangeFees,
    lpBurnedOrLockedPct: lpPct, top10HolderPct: input.top10HolderPct, copycatName: input.copycatName,
  };
  const N = hp.token?.symbol || hp.token?.name || short(token);
  const notes = [...(hp.coverage?.notes || [])];
  if (hold?.partial) notes.push("Top-holder share excludes pools, burn and the token contract, but the list is only addresses seen in recent transfers.");
  if (lpPct != null && lp?.note) notes.push(lp.note);
  return {
    type: "token-verdict", chain, chainId: C.chainId, address: token,
    token: { address: token, symbol: hp.token?.symbol ?? null, name: hp.token?.name ?? null, decimals: hp.token?.decimals ?? null },
    verdict: scored.verdict, riskLevel: scored.riskLevel, summary: verdictSummary(N, C.name, scored),
    flags, findings, coverage: { pool: hp.pool, simulation: hp.simulation, holdersPartial: !!hold?.partial, holderSource: hold?.source || null, notes },
    couldNotDetermine: could, elapsedMs: Date.now() - t0,
    disclaimer: "Automated verdict from public onchain data: a simulated buy and sell (eth_call, nothing traded), contract-risk heuristics, and holder and LP reads. SAFE is not an audit. An owner can still change taxes, blacklist wallets or pull liquidity later. Not financial or security advice.",
  };
}
