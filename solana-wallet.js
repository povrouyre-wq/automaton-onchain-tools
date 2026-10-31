// Solana wallet lookups from free public RPC only: address lookup (SOL + SPL balances, wallet age, recent activity)
// and live SPL token delegates (Solana's version of token approvals). Heuristics, not an audit.
import { isPubkey, isOnCurve, b58decode, findPda, parseMetaplex, P } from "./solana.js";
import { impersonation, OFFICIAL_ADDRESSES } from "./impersonation.js";

// Same pattern as the EVM chains: each attempt is capped at RPC_TIMEOUT_MS (4 s), then the next public RPC is tried.
// publicnode refuses indexed calls (getTokenAccountsByOwner) but serves balances/signatures, so it is a last fallback.
const RPCS = (process.env.SOLANA_WALLET_RPC || process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com,https://public.rpc.solanavibestation.com,https://solana-rpc.publicnode.com")
  .split(",").map(s => s.trim()).filter(Boolean);
const TIMEOUT = () => Number(process.env.RPC_TIMEOUT_MS || 4000);
const BUDGET_MS = Number(process.env.SOLANA_LOOKUP_BUDGET_MS || 20000); // stay under the 25 s paid-call cap
export const U64_MAX = 18446744073709551615n;
const LAMPORTS = 1000000000n;

export function makeRpc(urls = RPCS, { timeoutMs } = {}) {
  return async function rpc(method, params, { deadline = Infinity } = {}) {
    let last;
    for (const url of urls) {
      const left = deadline - Date.now(); if (left < 300) { last = last || new Error("lookup time budget used up"); break; }
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), Math.min(timeoutMs ?? TIMEOUT(), left));
      try { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: ac.signal });
        const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { throw new Error(`HTTP ${r.status} non-JSON`); }
        if (j.error) throw new Error(`${j.error.code} ${String(j.error.message).slice(0, 80)}`); return j.result;
      } catch (e) { last = ac.signal.aborted ? new Error(`timeout after ${timeoutMs ?? TIMEOUT()} ms`) : e; } finally { clearTimeout(t); }
    }
    throw new Error(`solana rpc ${method} failed: ${String(last?.message || last).slice(0, 120)}`);
  };
}
const defaultRpc = makeRpc();
const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e?.message || e).slice(0, 160) }));
const sol = l => { const b = BigInt(l), w = b / LAMPORTS, f = (b % LAMPORTS).toString().padStart(9, "0").replace(/0+$/, ""); return f ? `${w}.${f}` : `${w}`; };
const iso = t => t ? new Date(t * 1000).toISOString().replace(".000Z", "Z") : null;
const short = a => `${a.slice(0, 4)}…${a.slice(-4)}`;
const bad400 = () => Object.assign(new Error("not a valid Solana address (base58, 32 bytes)"), { status: 400 });

// Well-known mints (symbols without an extra RPC call) and delegate-owning programs we can name.
const KNOWN_MINTS = { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC", Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT", [P.wsol]: "wSOL",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "Bonk", JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": "PYUSD",
  pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn: "PUMP", USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: "USD1" };
export const KNOWN_PROGRAMS = { JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter aggregator v6", DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M: "Jupiter DCA",
  j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X: "Jupiter Limit Order", [P.pumpAmm]: "PumpSwap", [P.pump]: "pump.fun", "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM v4",
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP8C: "Raydium CPMM", CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM", whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpool",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM" };
const ACCOUNT_KIND = { [P.system]: "wallet", [P.token]: "token", [P.token2022]: "token", BPFLoaderUpgradeab1e11111111111111111111111: "program", BPFLoader2111111111111111111111111111111111: "program" };

// All SPL + Token-2022 token accounts owned by `owner` (jsonParsed). Returns { accounts, errors }.
async function tokenAccounts(rpc, owner, deadline) {
  const rs = await Promise.all([P.token, P.token2022].map(pid => settle(rpc("getTokenAccountsByOwner", [owner, { programId: pid }, { encoding: "jsonParsed", commitment: "confirmed" }], { deadline }))));
  const accounts = [], errors = [];
  rs.forEach((r, i) => { const prog = i ? "token-2022" : "spl-token";
    if (!r.ok) { errors.push(`${prog}: ${r.e}`); return; }
    for (const a of r.v?.value || []) { const I = a.account?.data?.parsed?.info; if (!I) continue;
      accounts.push({ tokenAccount: a.pubkey, program: prog, mint: I.mint, amount: BigInt(I.tokenAmount?.amount || "0"), decimals: I.tokenAmount?.decimals ?? 0, ui: I.tokenAmount?.uiAmountString ?? "0",
        state: I.state, delegate: I.delegate || null, delegated: I.delegatedAmount ? BigInt(I.delegatedAmount.amount) : 0n, delegatedUi: I.delegatedAmount?.uiAmountString ?? null,
        closeAuthority: I.closeAuthority || null, isNative: !!I.isNative }); } });
  return { accounts, errors };
}

// Name/symbol for up to `max` mints: Metaplex metadata PDAs + the mint accounts (Token-2022 metadata / permanent delegate) in two batched calls.
async function mintInfo(rpc, mints, deadline, max = 40) {
  const list = [...new Set(mints)].slice(0, max), out = {};
  for (const m of list) out[m] = { symbol: KNOWN_MINTS[m] || null, name: null };
  if (!list.length) return { info: out, ok: true };
  const pdas = list.map(m => findPda([Buffer.from("metadata"), b58decode(P.metaplex), b58decode(m)], P.metaplex));
  const [metaR, mintR] = await Promise.all([settle(rpc("getMultipleAccounts", [pdas, { encoding: "base64" }], { deadline })), settle(rpc("getMultipleAccounts", [list, { encoding: "jsonParsed" }], { deadline }))]);
  list.forEach((m, i) => {
    const x = metaR.ok ? metaR.v?.value?.[i] : null;
    if (x && x.owner === P.metaplex) { try { const md = parseMetaplex(Buffer.from(x.data[0], "base64")); out[m].name = md.name || null; out[m].symbol = out[m].symbol || md.symbol || null; } catch {} }
    const y = mintR.ok ? mintR.v?.value?.[i] : null, ext = y?.data?.parsed?.info?.extensions || [];
    const tm = ext.find(e => e.extension === "tokenMetadata")?.state; if (tm) { out[m].name ||= tm.name || null; out[m].symbol ||= tm.symbol || null; }
    const pd = ext.find(e => e.extension === "permanentDelegate")?.state?.delegate; if (pd) out[m].permanentDelegate = pd;
  });
  return { info: out, ok: metaR.ok || mintR.ok };
}

// Who is a delegate? wallet (on-curve keypair), program-derived address (owner program if the account exists), or a program.
async function classify(rpc, addrs, deadline) {
  const list = [...new Set(addrs)], out = {};
  const r = list.length ? await settle(rpc("getMultipleAccounts", [list, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }], { deadline })) : { ok: true, v: { value: [] } };
  list.forEach((a, i) => { const x = r.ok ? r.v?.value?.[i] : undefined, onCurve = isOnCurve(b58decode(a));
    if (KNOWN_PROGRAMS[a]) out[a] = { type: "program", label: KNOWN_PROGRAMS[a], known: true };
    else if (x?.executable) out[a] = { type: "program", label: null, known: false };
    else if (x && KNOWN_PROGRAMS[x.owner]) out[a] = { type: "program account", ownerProgram: x.owner, label: `${KNOWN_PROGRAMS[x.owner]} account`, known: true };
    else if (onCurve) out[a] = { type: "wallet", label: null, known: false, ...(x && x.owner !== P.system ? { ownerProgram: x.owner } : {}) };
    else out[a] = { type: x ? "program account" : "program-derived address", ownerProgram: x?.owner || null, label: null, known: false };
    if (!r.ok) out[a].lookupFailed = true; });
  return { info: out, ok: r.ok };
}

// ---------------- /v1/solana/address ----------------
export async function solanaAddress(address, { rpc = defaultRpc, maxSigPages = 5, now = Date.now() } = {}) {
  if (!isPubkey(address)) throw bad400();
  const deadline = Date.now() + BUDGET_MS, could = [], findings = [];
  const [acctR, toks, sigR] = await Promise.all([settle(rpc("getAccountInfo", [address, { encoding: "jsonParsed", commitment: "confirmed" }], { deadline })),
    tokenAccounts(rpc, address, deadline), settle(rpc("getSignaturesForAddress", [address, { limit: 1000 }], { deadline }))]);
  if (!acctR.ok && !sigR.ok && toks.errors.length === 2) throw new Error("all Solana RPCs failed: " + acctR.e);
  // account type
  const v = acctR.ok ? acctR.v?.value : undefined; let kind = "unknown", owner = null, lamports = null;
  if (!acctR.ok) could.push("Couldn't read the account itself (RPC error), so its type and SOL balance are unknown.");
  else if (!v) { kind = "no-account"; lamports = 0n; }
  else { owner = v.owner; lamports = BigInt(v.lamports);
    const pt = v.data?.parsed?.type; kind = v.executable ? "program" : owner === P.system ? "wallet" : ACCOUNT_KIND[owner] === "token" ? (pt === "mint" ? "token-mint" : pt === "account" ? "token-account" : "token-program-account") : "program-owned account"; }
  if (kind === "token-mint") findings.push({ severity: "info", note: "This is a token mint, not a wallet. Use /v1/solana/token to rug-check it." });
  if (kind === "token-account") findings.push({ severity: "info", note: `This is a token account (holds ${v.data.parsed.info.mint}) owned by ${v.data.parsed.info.owner}, not a wallet. Look up the owner instead.` });
  if (kind === "program") findings.push({ severity: "info", note: "This is an executable program, not a wallet." });
  if (kind === "program-owned account") findings.push({ severity: "info", note: `Account owned by program ${owner} (a pool, vault, multisig or other program state), not a plain wallet.` });
  if (kind === "wallet" && !isOnCurve(b58decode(address))) findings.push({ severity: "info", note: "Off-curve address (program-derived), so no private key controls it directly." });

  // tokens
  if (toks.errors.length) could.push(`Token balances may be incomplete: ${toks.errors.join("; ")}.`);
  // No USD prices: well-known mints first, then by displayed amount.
  const nonZero = toks.accounts.filter(a => a.amount > 0n).sort((a, b) => (!!KNOWN_MINTS[b.mint] - !!KNOWN_MINTS[a.mint]) || (Number(b.ui) - Number(a.ui)));
  const MAXT = 50, shown = nonZero.slice(0, MAXT);
  const mi = await mintInfo(rpc, shown.map(a => a.mint), deadline);
  const tokens = shown.map(a => ({ mint: a.mint, symbol: mi.info[a.mint]?.symbol || null, name: mi.info[a.mint]?.name || null, balance: a.ui, decimals: a.decimals, program: a.program,
    ...(a.state === "frozen" ? { frozen: true } : {}), ...(a.delegate ? { delegate: a.delegate } : {}) }));
  if (shown.length && !mi.ok) could.push("Couldn't read token metadata, so some names/symbols are missing.");
  const copy = tokens.map(t => ({ t, imp: impersonation("solana", t.mint, t) })).filter(x => x.imp);
  if (copy.length) findings.push({ severity: "medium", note: `Holds ${copy.length} token(s) copying a major asset at a fake mint (${copy.slice(0, 3).map(x => `"${x.t.symbol || x.t.name}" copies ${x.imp.copies}`).join(", ")}). Usually spam or scam airdrops: don't trade them or open links in their metadata.` });
  const frozen = toks.accounts.filter(a => a.state === "frozen" && a.amount > 0n).length;
  if (frozen) findings.push({ severity: "low", note: `${frozen} token account(s) are frozen by the token's issuer and can't be moved.` });
  const liveDel = toks.accounts.filter(a => a.delegate && a.delegated > 0n);
  if (liveDel.length) findings.push({ severity: "medium", note: `${liveDel.length} token account(s) have a live delegate that can move tokens without asking (${liveDel.filter(a => a.delegated === U64_MAX).length} unlimited). Run /v1/solana/delegates for details.` });

  // signatures: recent activity + wallet age (page back until the first signature or the budget/page cap)
  const page1 = sigR.ok ? sigR.v || [] : []; let pages = 1, seen = page1.length, complete = sigR.ok && page1.length < 1000, oldest = page1[page1.length - 1];
  if (!sigR.ok) could.push("Couldn't read transaction history (RPC error), so wallet age and activity are unknown.");
  while (sigR.ok && !complete && pages < maxSigPages && deadline - Date.now() > 4500) {
    const r = await settle(rpc("getSignaturesForAddress", [address, { limit: 1000, before: oldest.signature }], { deadline }));
    if (!r.ok) { could.push("History paging stopped early on an RPC error, so wallet age is a lower bound."); break; }
    pages++; seen += r.v.length; if (r.v.length) oldest = r.v[r.v.length - 1]; complete = r.v.length < 1000;
  }
  const first = page1.slice(0, 10);
  const nowS = Math.floor(now / 1000);
  const cnt = s => page1.filter(x => x.blockTime && nowS - x.blockTime <= s).length, p1full = page1.length >= 1000;
  const age = !sigR.ok ? { available: false } : !oldest ? { available: true, transactions: 0, note: "no transactions found" } : {
    available: true, complete, firstSeen: iso(oldest.blockTime), ...(complete ? { firstSignature: oldest.signature } : {}),
    ageDays: oldest.blockTime ? Math.floor((nowS - oldest.blockTime) / 86400) : null, basis: complete ? "first transaction on record" : `lower bound: paged back ${seen} transactions without reaching the first one` };
  if (sigR.ok && !complete) could.push(`Very active address: wallet age is a lower bound (stopped after ${seen} transactions).`);
  const activity = !sigR.ok ? { available: false } : { available: true, lastActive: iso(page1[0]?.blockTime), totalTransactions: complete ? seen : `${seen}+`,
    last24h: p1full && cnt(86400) === 1000 ? "1000+" : cnt(86400), last7d: p1full && cnt(604800) === 1000 ? "1000+" : cnt(604800), last30d: p1full && cnt(2592000) === 1000 ? "1000+" : cnt(2592000),
    failedInLast1000: page1.filter(x => x.err).length,
    recent: first.map(x => ({ signature: x.signature, time: iso(x.blockTime), status: x.err ? "failed" : "success", ...(x.memo ? { memo: String(x.memo).slice(0, 120) } : {}) })) };
  if (age.ageDays != null && age.complete && age.ageDays < 7 && kind === "wallet") findings.push({ severity: "low", note: `Brand-new wallet: first transaction ${age.ageDays === 0 ? "today" : age.ageDays + " day(s) ago"}.` });
  if (kind === "no-account" && sigR.ok && !page1.length) findings.push({ severity: "info", note: "Nothing at this address on Solana mainnet: no SOL, no transactions. Check the copy-paste." });
  const memos = page1.filter(x => x.memo).length; if (memos >= 5) findings.push({ severity: "low", note: `${memos} recent transactions carry memos. Spam and phishing 'dust' transfers often do; don't open links in them.` });

  const solBal = lamports == null ? null : sol(lamports);
  const bits = [kind === "wallet" ? "Solana wallet." : kind === "no-account" ? "No account at this address (0 SOL)." : `Solana ${kind}.`,
    solBal != null && kind !== "no-account" ? `${solBal} SOL.` : "", toks.errors.length < 2 ? `${nonZero.length} token(s) with a balance${toks.accounts.length > nonZero.length ? `, ${toks.accounts.length - nonZero.length} empty token account(s)` : ""}.` : "",
    age.firstSeen ? (age.complete ? `First transaction ${age.firstSeen.slice(0, 10)} (${age.ageDays} days ago).` : `Active since at least ${age.firstSeen.slice(0, 10)}.`) : "",
    activity.lastActive ? `Last active ${activity.lastActive.replace("T", " ").replace("Z", " UTC")}; ${activity.last7d} tx in the last 7 days.` : "",
    liveDel.length ? `${liveDel.length} live token delegate(s).` : ""].filter(Boolean);
  return { type: "solana-address", chain: "solana", address, kind, ownerProgram: owner, sol: { lamports: lamports?.toString() ?? null, balance: solBal },
    tokens: { available: toks.errors.length < 2, withBalance: nonZero.length, emptyAccounts: toks.accounts.length - nonZero.length, shown: tokens.length, list: tokens },
    liveDelegates: liveDel.length, age, activity, findings, summary: bits.join(" "), couldNotDetermine: could,
    disclaimer: "Public Solana RPC data, no USD prices. Not financial or security advice." };
}

// ---------------- /v1/solana/delegates ----------------
export async function solanaDelegates(address, { rpc = defaultRpc } = {}) {
  if (!isPubkey(address)) throw bad400();
  const deadline = Date.now() + BUDGET_MS, could = [], findings = [];
  const toks = await tokenAccounts(rpc, address, deadline);
  if (toks.errors.length === 2) throw new Error("couldn't read token accounts from any public Solana RPC: " + toks.errors[0]);
  if (toks.errors.length) could.push(`Only part of the token accounts could be read: ${toks.errors.join("; ")}.`);
  const live = toks.accounts.filter(a => a.delegate && a.delegated > 0n);
  const stale = toks.accounts.filter(a => a.delegate && a.delegated === 0n).length;
  const t22 = toks.accounts.filter(a => a.program === "token-2022" && a.amount > 0n);
  const otherClose = toks.accounts.filter(a => a.closeAuthority && a.closeAuthority !== address);
  const [cls, mi] = await Promise.all([classify(rpc, live.map(a => a.delegate), deadline), mintInfo(rpc, [...live.map(a => a.mint), ...t22.map(a => a.mint)], deadline)]);
  if (live.length && !cls.ok) could.push("Couldn't look up what the delegate addresses are (RPC error); wallet vs program is guessed from the address alone.");
  if (t22.length && !mi.ok) could.push("Couldn't read Token-2022 mints, so permanent delegates weren't checked.");
  const delegates = live.map(a => { const c = cls.info[a.delegate] || {}, unlimited = a.delegated === U64_MAX, m = mi.info[a.mint] || {};
    const severity = c.known ? (unlimited ? "medium" : "low") : (unlimited || c.type === "wallet") ? "high" : "medium";
    return { tokenAccount: a.tokenAccount, mint: a.mint, symbol: m.symbol || null, program: a.program, balance: a.ui, delegate: a.delegate, delegateType: c.type || "unknown",
      delegateLabel: c.label || null, delegateOwnerProgram: c.ownerProgram || null, known: !!c.known, delegatedAmount: unlimited ? "unlimited" : a.delegatedUi, unlimited, coversFullBalance: a.delegated >= a.amount, severity }; });
  const order = { high: 0, medium: 1, low: 2 }; delegates.sort((x, y) => order[x.severity] - order[y.severity]);
  const MAXF = 12;
  for (const d of delegates.slice(0, MAXF)) {
    const who = d.known ? d.delegateLabel : d.delegateType === "wallet" ? `an unknown wallet (${d.delegate})` : d.delegateOwnerProgram ? `an unknown ${d.delegateType} (${d.delegate}, owned by program ${d.delegateOwnerProgram})` : `an unknown ${d.delegateType} (${d.delegate})`;
    const amt = d.unlimited ? "UNLIMITED" : `up to ${d.delegatedAmount}`, tok = d.symbol || short(d.mint);
    findings.push({ severity: d.severity, note: `${tok}: ${who} can move ${amt} ${tok} from this wallet without asking${d.balance !== "0" ? ` (balance ${d.balance})` : ""}.${d.known ? "" : " Revoke it unless you set this up on purpose."}` });
  }
  if (delegates.length > MAXF) findings.push({ severity: delegates.slice(MAXF).some(d => d.severity === "high") ? "high" : "medium", note: `${delegates.length - MAXF} more live delegate(s), listed in delegates[].` });
  if (new Set([...live.map(a => a.mint), ...t22.map(a => a.mint)]).size > 40) could.push("Over 40 distinct mints: names and permanent-delegate checks cover the first 40 only.");
  const perm = t22.map(a => ({ a, pd: mi.info[a.mint]?.permanentDelegate })).filter(x => x.pd).map(({ a, pd }) => ({ mint: a.mint, symbol: mi.info[a.mint]?.symbol || null, balance: a.ui, permanentDelegate: pd, officialMint: OFFICIAL_ADDRESSES.solana.has(a.mint.toLowerCase()) }));
  for (const p of perm) findings.push({ severity: p.officialMint ? "low" : "high", note: `${p.symbol || short(p.mint)} is a Token-2022 token with a permanent delegate (${p.permanentDelegate}) that can move or burn it from any holder, you included. It can't be revoked.${p.officialMint ? " Normal for this regulated stablecoin." : ""}` });
  if (otherClose.length) findings.push({ severity: "low", note: `${otherClose.length} token account(s) have a close authority other than this wallet: it can close them once empty and take the rent (~0.002 SOL each).` });
  const hi = findings.filter(f => f.severity === "high").length, med = findings.filter(f => f.severity === "medium").length;
  const riskLevel = hi ? "high" : med ? "medium" : "low";
  const summary = [`Checked ${toks.accounts.length} token account(s).`, live.length ? `${live.length} live delegate(s): ${delegates.filter(d => d.unlimited).length} unlimited, ${delegates.filter(d => !d.known).length} unknown.` : "No live token delegates.",
    perm.length ? `${perm.length} held token(s) have a permanent delegate.` : "", stale ? `${stale} old delegate(s) with nothing left to move.` : ""].filter(Boolean).join(" ");
  return { type: "solana-delegates", chain: "solana", address, tokenAccountsChecked: toks.accounts.length, liveCount: live.length, unlimitedCount: delegates.filter(d => d.unlimited).length,
    unknownCount: delegates.filter(d => !d.known).length, delegates, permanentDelegates: perm, exhaustedDelegates: stale, riskLevel, findings, summary, couldNotDetermine: could,
    howToRevoke: live.length ? "Send a token Revoke instruction for each token account listed (most Solana wallets and revoke tools can do it, it costs a tiny network fee). Check the site's domain before you sign." : null,
    disclaimer: "Automated check of public Solana RPC data. Not an audit, not a guarantee, not financial advice." };
}
