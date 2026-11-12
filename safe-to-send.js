// $0.005 pre-transfer recipient check: safe / caution / danger.
// Free public data only: the same Blockscout / Routescan hosts as the approval sweep, public RPCs, and GoPlus address security
// (the free flag source the sweep already uses for malicious spenders). No paid third-party APIs.
// Every signal is a heuristic. A "safe" verdict is not a guarantee, and a flag is not proof of theft.
import { formatUnits, parseAbiItem } from "viem";
import { CHAINS } from "./lib.js";
import { isPubkey, isOnCurve, b58decode, P } from "./solana.js";
import { makeRpc } from "./solana-wallet.js";

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const UA = { accept: "application/json", "user-agent": "automaton-onchain-tools/1.15 (+https://automaton-tx-explainer.vercel.app)" };
// Move-token selectors (PUSH4). Generic execute/execTransaction counts: multisigs move tokens without an ERC-20 transfer selector.
const MOVE_SELECTORS = { "0xa9059cbb": "transfer(address,uint256)", "0x23b872dd": "transferFrom(address,address,uint256)", "0x6a761202": "execTransaction", "0xb61d27f6": "execute(address,uint256,bytes)", "0x1cff79cd": "execute(address,bytes)" };
const DISCLAIMER = "Every check is a heuristic from public data: recent explorer or RPC history (not a full archive), free GoPlus address flags on EVM, bytecode selectors, and nonce plus native balance. safe is not proof the recipient is trustworthy. danger is not proof this transfer will be stolen. Not security or financial advice.";

// Same explorer hosts as sweep.js LOG_SOURCES. BSC has none there; Routescan does not serve BNB Chain account history.
export const TX_SOURCES = {
  ethereum: [["routescan", "https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api"], ["blockscout", "https://eth.blockscout.com/api"]],
  base: [["blockscout", "https://base.blockscout.com/api"]],
  optimism: [["blockscout", "https://explorer.optimism.io/api"]],
  arbitrum: [["blockscout", "https://arbitrum.blockscout.com/api"]],
  polygon: [["blockscout", "https://polygon.blockscout.com/api"]],
  avalanche: [["routescan", "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api"]],
  bsc: [],
};
// GoPlus address-security chain ids that answered for a sample address (Nov 2026). Solana's address endpoint is not a free unsigned API.
const GOPLUS_CHAINS = new Set([1, 56, 137, 10, 42161, 43114, 8453]);
const DANGER_FLAGS = { stealing_attack: "stealing attack / drainer", phishing_activities: "phishing", honeypot_related_address: "honeypot-related", blackmail_activities: "blackmail", cybercrime: "cybercrime" };
const CAUTION_FLAGS = { money_laundering: "money laundering", financial_crime: "financial crime", darkweb_transactions: "darkweb transactions", sanctioned: "sanctioned", blacklist_doubt: "blacklist doubt", mixer: "mixer", fake_kyc: "fake KYC", gas_abuse: "gas abuse", fake_token: "fake token", malicious_mining_activities: "malicious mining", reinit: "reinit", fake_standard_interface: "fake standard interface" };
const SOL_PROGRAMS = new Set([P.system, P.token, P.token2022, P.metaplex, P.pump, P.pumpAmm, "ComputeBudget111111111111111111111111111111", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "11111111111111111111111111111111"]);

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const timeout = (p, ms, what = "timeout") => { let t; return Promise.race([p, new Promise((_, r) => { t = setTimeout(() => r(new Error(what)), ms); })]).finally(() => clearTimeout(t)); };
const same = (a, b, ci) => ci ? String(a).toLowerCase() === String(b).toLowerCase() : a === b;

export function selectorsIn(code) {
  const s = new Set(); if (!code || code === "0x") return s; const b = code.slice(2).toLowerCase();
  for (let i = 0; i < b.length; i += 2) { const op = parseInt(b.slice(i, i + 2), 16);
    if (op === 0x63) { s.add("0x" + b.slice(i + 2, i + 10)); i += 8; } else if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2; }
  return s;
}
function cloneImpl(code) {
  if (/^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/i.test(code)) return "0x" + code.slice(22, 62);
  if (/^0x3d3d3d3d363d3d37363d73[0-9a-f]{40}5af43d3d93803e602a57fd5bf3$/i.test(code)) return "0x" + code.slice(24, 64);
  return null;
}

// Prefix AND suffix, each at least 4 characters (the usual poisoning window is 4-6). Longer matches still count.
// EVM compares hex case-insensitively. Solana compares the base58 string as-is (case-sensitive).
export function lookalikeMatch(a, b, { min = 4, caseInsensitive = true } = {}) {
  if (a == null || b == null) return null;
  let x = String(a), y = String(b);
  if (caseInsensitive) { x = x.toLowerCase(); y = y.toLowerCase(); }
  if (x.startsWith("0x")) x = x.slice(2); if (y.startsWith("0x")) y = y.slice(2);
  if (!x || !y || x === y) return null;
  let pre = 0; while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  let suf = 0; while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  if (pre >= min && suf >= min) return { prefix: pre, suffix: suf };
  return null;
}

export function collectCounterparties(self, native, tokens, caseInsensitive = true) {
  const out = new Map();
  const add = a => { if (!a || typeof a !== "string") return; const k = caseInsensitive ? a.toLowerCase() : a; if (same(k, self, caseInsensitive)) return; if (!out.has(k)) out.set(k, caseInsensitive ? k : a); };
  for (const t of [...(native || []), ...(tokens || [])]) { add(t.from); add(t.to); }
  return [...out.values()];
}

function isDustRow(t) {
  let v; try { v = BigInt(t.value ?? "0"); } catch { return false; }
  if (v === 0n) return true;
  if (t.kind === "native" || !t.token) return v <= 1n; // 1 wei or 1 lamport
  if (t.tokenDecimal == null || Number.isNaN(Number(t.tokenDecimal))) return false; // unknown decimals: only exact zero counts
  const dec = Math.max(0, Math.min(30, Number(t.tokenDecimal)));
  return v < 10n ** BigInt(Math.max(0, dec - 4)); // under 0.0001 token
}

// True only when every visible incoming transfer is zero-value or dust, nothing was sent out, and the senders
// look like poisoning spam (a lookalike of the sender or a counterparty, lookalikes of each other, or 3+ zero-value senders).
export function dustSpam(address, history, { seeds = [], caseInsensitive = true } = {}) {
  const rows = [...(history?.native || []).map(t => ({ kind: "native", ...t })), ...(history?.tokens || []).map(t => ({ kind: "token", ...t }))];
  const incoming = rows.filter(t => t.to && same(t.to, address, caseInsensitive) && !same(t.from, address, caseInsensitive));
  const outgoing = rows.filter(t => t.from && same(t.from, address, caseInsensitive) && !same(t.to, address, caseInsensitive));
  if (outgoing.length || !incoming.length || !incoming.every(isDustRow)) return { dustOnly: false, incoming: incoming.length, outgoing: outgoing.length, senders: 0, lookalikeSenders: 0, manyZero: false };
  const senders = [...new Set(incoming.map(t => caseInsensitive ? String(t.from).toLowerCase() : t.from).filter(Boolean))];
  const lookalikeSenders = senders.filter(s => seeds.some(k => lookalikeMatch(s, k, { caseInsensitive }))).length;
  const mutual = senders.some(s => senders.some(o => o !== s && lookalikeMatch(s, o, { caseInsensitive })));
  const zeroSenders = new Set(incoming.filter(t => { try { return BigInt(t.value ?? "0") === 0n; } catch { return false; } }).map(t => caseInsensitive ? String(t.from).toLowerCase() : t.from));
  const manyZero = zeroSenders.size >= 3;
  return { dustOnly: lookalikeSenders > 0 || mutual || manyZero, incoming: incoming.length, outgoing: outgoing.length, senders: senders.length, lookalikeSenders, manyZero };
}

function isFresh(account, history) {
  const nonce = account?.nonce ?? null;
  const label = nonce == null ? "unknown" : String(nonce);
  const zeroBal = account?.balanceRaw === "0";
  if (!account || !zeroBal) return { fresh: false, partial: false, nonceLabel: label };
  if (nonce == null) return { fresh: false, partial: true, nonceLabel: "unknown" };
  if (nonce !== 0) return { fresh: false, partial: false, nonceLabel: label };
  if (!history || history.status === "unavailable") return { fresh: false, partial: true, nonceLabel: label };
  const saw = (history.native?.length || 0) + (history.tokens?.length || 0) + (history.signatureCount || 0) > 0;
  if (saw) return { fresh: false, partial: false, nonceLabel: label };
  if (history.status === "ok") return { fresh: true, partial: false, nonceLabel: label };
  return { fresh: false, partial: true, nonceLabel: label };
}

export function buildSafeToSend({ chain, chainName, chainId = null, to, from = null, token = null, account, toHistory, fromHistory, flags, tokenHandle }) {
  const reasons = []; const could = [];
  const add = (code, severity, note, short) => reasons.push({ code, severity, heuristic: true, note, ...(short ? { short } : {}) });
  const ci = chain !== "solana";
  let poisoning = { heuristic: true, checked: false, status: "skipped", counterparties: 0, lookalikes: [] };

  if (!from) add("address_poisoning_lookalike", "info", "Heuristic: sender (from) was not provided, so the recipient was not compared with the sender's recent counterparties. Pass from to run that lookalike check.");
  else if (!fromHistory || fromHistory.status === "unavailable") {
    poisoning = { heuristic: true, checked: false, status: "unavailable", counterparties: 0, lookalikes: [], coverage: fromHistory?.coverage || null };
    could.push("Address-poisoning lookalikes: the sender's recent counterparties could not be loaded" + (fromHistory?.coverage ? ` (${fromHistory.coverage})` : "") + ". This is not a clean result.");
  } else {
    const cps = fromHistory.counterparties || collectCounterparties(from, fromHistory.native, fromHistory.tokens, ci);
    const hits = [];
    for (const c of cps) { const m = lookalikeMatch(to, c, { caseInsensitive: ci }); if (m) hits.push({ address: c, prefixChars: m.prefix, suffixChars: m.suffix }); }
    hits.sort((a, b) => (b.prefixChars + b.suffixChars) - (a.prefixChars + a.suffixChars));
    poisoning = { heuristic: true, checked: true, status: fromHistory.status, source: fromHistory.source || null, counterparties: cps.length, lookalikes: hits.slice(0, 5), coverage: fromHistory.coverage };
    if (hits.length) {
      const h = hits[0]; const unit = ci ? "hex characters" : "base58 characters";
      add("address_poisoning_lookalike", "danger", `Heuristic: recipient shares the first ${h.prefixChars} and last ${h.suffixChars} ${unit} with a recent counterparty (${h.address}) but is a different address. Common address-poisoning pattern. A random vanity collision is possible, so this is not proof of theft. Window: ${fromHistory.coverage}`, "it shares a prefix and suffix with a recent counterparty but is a different address");
    } else add("address_poisoning_lookalike", "info", `Heuristic: no recent counterparty shares both a 4+ character prefix and a 4+ character suffix with the recipient (${cps.length} compared). ${fromHistory.coverage}`);
  }

  let dust = { heuristic: true, dustOnly: false, status: toHistory?.status || "unavailable" };
  if (!toHistory || toHistory.status === "unavailable") could.push("Dust / zero-value spam history for the recipient could not be loaded" + (toHistory?.coverage ? ` (${toHistory.coverage})` : "") + ". This is not a clean result.");
  else if (toHistory.status !== "ok" && !(toHistory.native?.length || toHistory.tokens?.length)) could.push(`Dust / zero-value check: history was partial and no transfers were parsed (${toHistory.coverage || "no rows"}). Not treated as spam and not treated as clean.`);
  else {
    const seeds = []; if (from) seeds.push(from);
    if (fromHistory && fromHistory.status !== "unavailable") seeds.push(...(fromHistory.counterparties || collectCounterparties(from, fromHistory.native, fromHistory.tokens, ci)));
    dust = { heuristic: true, ...dustSpam(to, toHistory, { seeds, caseInsensitive: ci }), status: toHistory.status, coverage: toHistory.coverage };
    if (dust.dustOnly) add("dust_spam_history", "caution", `Heuristic: visible history is only zero-value or dust incoming transfers (${dust.incoming} in, ${dust.senders} sender(s)${dust.lookalikeSenders ? `, ${dust.lookalikeSenders} look like a known counterparty` : ""}${dust.manyZero ? ", several distinct zero-value senders" : ""}). That pattern is used to plant poisoning spam. It does not prove this address will steal funds. Window: ${toHistory.coverage}`, "visible history is only dust or zero-value spam");
    else add("dust_spam_history", "info", `Heuristic: recipient history in this window is not only zero-value or dust spam (${dust.incoming} incoming, ${dust.outgoing} outgoing). ${toHistory.coverage}`);
  }

  const flagList = flags?.flags || [];
  if (!flags || flags.status === "unavailable") could.push("Scam/drainer flags: " + (flags?.note || "the free flag source could not be reached") + ". A missing result is not a clean bill.");
  else if (flags.status === "unsupported") could.push("Scam/drainer flags: " + (flags.note || "no free flag source for this chain") + ". A missing result is not a clean bill.");
  else {
    const dangerF = flagList.filter(f => f.tier === "danger"), cautionF = flagList.filter(f => f.tier === "caution");
    if (dangerF.length) add("scam_drainer_flag", "danger", `Heuristic: free GoPlus address-security reports ${dangerF.map(f => f.label).join(", ")}. A third-party flag is not proof this transfer will be stolen, and labels can be wrong.`, "GoPlus reports a scam or drainer flag");
    else if (cautionF.length) add("scam_drainer_flag", "caution", `Heuristic: free GoPlus address-security reports ${cautionF.map(f => f.label).join(", ")}. These are not specifically a drainer label. A report is not proof, and no report would not be a clean bill either.`, "GoPlus reports a non-drainer risk flag");
    else add("scam_drainer_flag", "info", "Heuristic: free GoPlus address-security returned no scam, drainer, or crime flag for this address. No flag is not a clean bill of health.");
  }

  const th = tokenHandle?.status;
  if (th === "token_itself") add("token_contract_itself", "danger", "Heuristic: the recipient is the token contract itself. Sending that token to its own contract often sticks or burns the tokens. Some tokens handle this on purpose. This is not proof of a scam.", "the recipient is the token contract itself");
  else if (th === "no_code_path") add("token_no_code_path", "caution", "Heuristic: the recipient is a contract and its runtime bytecode (plus proxy implementation, if one was found) has no PUSH4 for transfer, transferFrom, or a generic execute/execTransaction. It may be unable to move this token back out, so a transfer can get stuck. Selector scans miss odd dispatch and can be wrong.", "the contract shows no code path for this token");
  else if (th === "token_account_mismatch") add("token_account_mismatch", "caution", "Heuristic: the recipient is a Solana token account for a different mint than the token you intend to send. A transfer of that token does not land in this account.", "this token account is for a different mint");
  else if (th === "program") add("recipient_is_program", "caution", "Heuristic: the recipient is an executable Solana program. Programs do not hold SPL balances at the program address, so sending a token here is not a normal transfer.", "the recipient is a program, not a wallet");
  else if (th === "program_owned") add("program_owned_account", "caution", "Heuristic: the recipient is a program-owned Solana account, not a wallet and not a token account for this mint. A token sent here often cannot be moved back out. This is a best-effort guess, not proof the tokens would be stuck.", "the account is program-owned and may not hold this token");
  else if (th === "mint") add("recipient_is_mint", "caution", "Heuristic: the recipient is a Solana token mint, not a wallet. Tokens sent to a mint address do not show up as a normal balance.", "the recipient is a token mint, not a wallet");
  else if (account?.kind === "eoa-7702" || th === "delegated") add("eip7702_delegate", "caution", `Heuristic: the recipient is an EOA with EIP-7702 delegated code${account?.delegatedTo ? ` (${account.delegatedTo})` : ""}. The delegate controls how the account behaves. This is not by itself a drainer label.`, "the recipient is an EIP-7702 delegated account");
  else if (th === "has_code_path" || th === "token_account") add("contract_token_path", "info", th === "token_account" ? "Heuristic: the recipient is a token account for this mint, so it can hold the token. That does not mean the owner is trustworthy." : "Heuristic: bytecode contains a transfer, transferFrom, or generic execute selector, so a code path that could move this token may exist. That does not mean a transfer to this contract will be credited or recoverable.");
  else if (account && !account.isContract) add("recipient_not_contract", "info", chain === "solana" ? "Heuristic: the recipient is not an executable program. A Solana token send to a wallet uses an associated token account, which this check does not create." : "Heuristic: the recipient has no contract code, so it looks like a normal wallet or an empty address. That does not mean it is safe to pay.");
  else if (account?.isContract) add("recipient_is_contract", "info", account.kind === "mint" ? "Heuristic: the recipient is a Solana token mint (the token's own account), not a wallet. Pass token to run the handling check. Being a mint is not itself a scam flag." : "Heuristic: the recipient is a contract. Pass token to check whether it looks able to handle that token. Being a contract is not itself a scam flag.");

  const fresh = isFresh(account, toHistory);
  if (fresh.partial) add("fresh_address", "caution", `Heuristic: native balance is zero and nonce/tx-count is ${fresh.nonceLabel}, but transaction history could not be fully loaded, so this fresh/empty warning is only partial. A new wallet can look like this too.`, "it looks empty, but history could not be fully loaded");
  else if (fresh.fresh) add("fresh_address", "caution", `Heuristic: no transaction history in the window we could read, nonce/tx-count is ${fresh.nonceLabel}, and native balance is zero. It may be unused, a typo, or a brand-new wallet. This is not proof it is malicious.`, "it is a fresh empty address (no history, zero balance)");
  else if (account) add("fresh_address", "info", `Heuristic: not a fresh empty address (nonce/tx-count ${fresh.nonceLabel}, native balance ${account.balance}${account.nativeSymbol ? " " + account.nativeSymbol : ""}).`);

  const verdict = reasons.some(r => r.severity === "danger") ? "danger" : reasons.some(r => r.severity === "caution") ? "caution" : "safe";
  const riskLevel = verdict === "danger" ? "high" : verdict === "caution" ? "medium" : "low";
  const why = reasons.filter(r => r.severity === "danger" || r.severity === "caution").map(r => r.short || r.note);
  const missed = could.length ? ` Not checked: ${could.length} item(s) in couldNotDetermine.` : "";
  const summary = verdict === "safe"
    ? `${chainName} recipient: safe on the checks that completed.${missed} Heuristic only, not a guarantee.`
    : `${chainName} recipient: ${verdict} because ${why.slice(0, 2).join("; ")}.`;
  return {
    type: "safe-to-send", heuristics: true, chain, chainId, to, from, token, verdict, riskLevel, summary, reasons,
    checks: {
      addressPoisoning: poisoning,
      dustSpam: dust,
      scamFlags: { heuristic: true, source: flags?.source ?? null, status: flags?.status || "unavailable", flagged: flagList.length > 0, flags: flagList },
      contract: { heuristic: true, kind: account?.kind ?? null, isContract: !!account?.isContract, delegatedTo: account?.delegatedTo ?? null, token: token || null, tokenHandling: th || null },
      freshAddress: { heuristic: true, fresh: !!fresh.fresh, partial: !!fresh.partial, nonce: account?.nonce ?? null, nativeBalance: account?.balance ?? null },
    },
    couldNotDetermine: could, disclaimer: DISCLAIMER,
  };
}

async function explorerPage(fetchImpl, url, action, address) {
  const q = `${url}?module=account&action=${action}&address=${address}&page=1&offset=80&sort=desc`;
  const r = await timeout(fetchImpl(q, { headers: UA, signal: AbortSignal.timeout(7000) }), 8000, "explorer timeout");
  const ct = r.headers.get("content-type") || "";
  if (!r.ok || !ct.includes("json")) throw new Error(r.ok ? "non-JSON (bot protection)" : "HTTP " + r.status);
  const d = await r.json();
  if (Array.isArray(d.result)) return d.result;
  if (/no (transactions|records|token)|not found/i.test(String(d.message || ""))) return [];
  throw new Error(String(d.message || d.result || "bad explorer response").slice(0, 80));
}
const normNative = t => ({ from: t.from || null, to: t.to || null, value: String(t.value ?? "0"), kind: "native" });
const normToken = t => ({ from: t.from || null, to: t.to || null, value: String(t.value ?? "0"), kind: "token", token: t.contractAddress || null, tokenDecimal: t.tokenDecimal != null && t.tokenDecimal !== "" ? Number(t.tokenDecimal) : null, tokenSymbol: t.tokenSymbol || null });

async function rpcTransferLogs(rpc, address) {
  const latest = await rpc.getBlockNumber();
  const span = 800n; const fromBlock = latest > span ? latest - span : 0n;
  const [sent, got] = await Promise.all([
    rpc.getLogs({ event: TRANSFER, args: { from: address }, fromBlock, toBlock: latest }),
    rpc.getLogs({ event: TRANSFER, args: { to: address }, fromBlock, toBlock: latest }),
  ]);
  return [...sent, ...got].slice(0, 200).map(l => ({ from: l.args.from, to: l.args.to, value: l.args.value.toString(), kind: "token", token: l.address, tokenDecimal: null }));
}

export async function evmHistory(chain, address, { fetchImpl = fetch, rpc } = {}) {
  const errors = [];
  for (const [name, url] of TX_SOURCES[chain] || []) {
    try {
      const [native, tokens] = await Promise.all([explorerPage(fetchImpl, url, "txlist", address), explorerPage(fetchImpl, url, "tokentx", address)]);
      const n = native.map(normNative), tok = tokens.map(normToken);
      return { status: "ok", source: name, native: n, tokens: tok, counterparties: collectCounterparties(address, n, tok, true), coverage: `most recent ${n.length} native txs and ${tok.length} token transfers from ${name}. Not full history.` };
    } catch (e) { errors.push(`${name}: ${String(e.message).slice(0, 70)}`); }
  }
  try {
    const tokens = await timeout(rpcTransferLogs(rpc || CHAINS[chain].rpc, address), 6000, "rpc log timeout");
    return { status: "partial", source: "rpc-logs", native: [], tokens, counterparties: collectCounterparties(address, [], tokens, true), coverage: `Explorer unavailable (${errors.join("; ") || "no indexer for this chain"}). ERC-20 Transfer logs over the last ~800 blocks only; native transfers were not read. Decimals unknown, so only exact-zero token amounts count as dust. Not full history.` };
  } catch (e) { errors.push(`rpc-logs: ${String(e.shortMessage || e.message).slice(0, 70)}`); }
  return { status: "unavailable", source: null, native: [], tokens: [], counterparties: [], coverage: errors.join("; ") || "no history source" };
}

async function evmAccount(chain, address, rpc) {
  const [code, bal, nonce] = await Promise.all([rpc.getCode({ address }), rpc.getBalance({ address }), rpc.getTransactionCount({ address })]);
  const raw = code || "0x"; const delegated = raw.startsWith("0xef0100") && raw.length >= 48;
  const isContract = !!raw && raw !== "0x" && !delegated;
  const selectors = isContract ? selectorsIn(raw) : new Set(); let impl = null;
  if (isContract) {
    impl = cloneImpl(raw); if (!impl) { const v = await rpc.getStorageAt({ address, slot: IMPL_SLOT }).catch(() => null); if (v && BigInt(v) !== 0n) impl = "0x" + v.slice(-40); }
    if (impl) { const ic = await rpc.getCode({ address: impl }).catch(() => "0x"); if (ic && ic !== "0x") for (const s of selectorsIn(ic)) selectors.add(s); }
  }
  return { kind: delegated ? "eoa-7702" : isContract ? "contract" : "eoa", isContract, delegatedTo: delegated ? "0x" + raw.slice(8, 48) : null, implementation: impl, nonce: Number(nonce), balance: formatUnits(bal, 18), balanceRaw: bal.toString(), nativeSymbol: CHAINS[chain].native, selectors: [...selectors] };
}
function evmTokenHandle(account, token, to) {
  if (to.toLowerCase() === token.toLowerCase()) return { status: "token_itself" };
  if (account.kind === "eoa-7702") return { status: "delegated" };
  if (!account.isContract) return { status: "not_a_contract" };
  const sels = new Set(account.selectors.map(s => s.toLowerCase()));
  if ([...Object.keys(MOVE_SELECTORS)].some(s => sels.has(s))) return { status: "has_code_path" };
  return { status: "no_code_path" };
}
async function evmFlags(chain, address, fetchImpl) {
  const id = CHAINS[chain].chainId;
  if (!GOPLUS_CHAINS.has(id)) return { status: "unsupported", source: "goplus", flags: [], note: "GoPlus address security does not cover this chain in this service." };
  try {
    const r = await timeout(fetchImpl(`https://api.gopluslabs.io/api/v1/address_security/${address}?chain_id=${id}`, { headers: UA, signal: AbortSignal.timeout(8000) }), 9000, "goplus timeout");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json(); if (d.code !== 1 || !d.result) throw new Error(String(d.message || d.code));
    const row = d.result.stealing_attack != null || d.result.phishing_activities != null ? d.result : Object.values(d.result).find(x => x && typeof x === "object" && ("stealing_attack" in x || "phishing_activities" in x));
    if (!row) throw new Error("empty result");
    const flags = [];
    for (const [k, label] of Object.entries(DANGER_FLAGS)) if (row[k] === "1") flags.push({ key: k, label, tier: "danger" });
    if (Number(row.number_of_malicious_contracts_created) > 0) flags.push({ key: "number_of_malicious_contracts_created", label: `created ${row.number_of_malicious_contracts_created} flagged malicious contract(s)`, tier: "danger" });
    for (const [k, label] of Object.entries(CAUTION_FLAGS)) if (row[k] === "1") flags.push({ key: k, label, tier: "caution" });
    return { status: "ok", source: "goplus", flags };
  } catch (e) { return { status: "unavailable", source: "goplus", flags: [], note: String(e.message || e).slice(0, 140) }; }
}

const solStr = lamports => { const b = BigInt(lamports), w = b / 1000000000n, f = (b % 1000000000n).toString().padStart(9, "0").replace(/0+$/, ""); return f ? `${w}.${f}` : `${w}`; };
function solTransfers(tx) {
  const out = []; const walk = ix => { const p = ix?.parsed; if (!p || typeof p !== "object") return; const info = p.info || {};
    if (p.type === "transfer" && info.lamports != null) out.push({ from: info.source || null, to: info.destination || null, value: String(info.lamports), kind: "native" });
    else if ((p.type === "transfer" || p.type === "transferChecked") && (info.amount != null || info.tokenAmount)) out.push({ from: info.authority || info.source || null, to: info.destination || null, value: String(info.tokenAmount?.amount ?? info.amount ?? "0"), kind: "token", token: info.mint || null, tokenDecimal: info.tokenAmount?.decimals ?? null }); };
  for (const ix of tx?.transaction?.message?.instructions || []) walk(ix);
  for (const inn of tx?.meta?.innerInstructions || []) for (const ix of inn.instructions || []) walk(ix);
  return out;
}
function solKeys(tx) {
  return (tx?.transaction?.message?.accountKeys || []).map(k => typeof k === "string" ? k : k?.pubkey).filter(k => k && !SOL_PROGRAMS.has(k));
}
async function solHistory(address, rpc) {
  let sigs;
  try { sigs = await rpc("getSignaturesForAddress", [address, { limit: 20 }], { deadline: Date.now() + 12000 }) || []; }
  catch (e) { return { status: "unavailable", source: "solana-rpc", native: [], tokens: [], counterparties: [], signatureCount: null, coverage: `signature lookup failed (${String(e.message).slice(0, 80)}). Not full history.` }; }
  const slice = sigs.slice(0, 8);
  const txs = await Promise.all(slice.map(s => rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], { deadline: Date.now() + 10000 }).catch(() => null)));
  const native = [], tokens = [], parties = new Set();
  txs.forEach(tx => { if (!tx) return; for (const t of solTransfers(tx)) { if (t.kind === "native") native.push(t); else tokens.push(t); } for (const k of solKeys(tx)) if (k !== address) parties.add(k); });
  const parsed = txs.filter(Boolean).length;
  return { status: parsed || !slice.length ? "ok" : "partial", source: "solana-rpc", native, tokens, counterparties: [...parties], signatureCount: sigs.length, coverage: `Parsed ${parsed} of the most recent ${slice.length} transactions (${sigs.length} signatures fetched, max 20). Solana dust rows are system or token transfers where this address is source or destination, not associated token accounts. Not full history.` };
}
async function solAccount(address, rpc, signatureCount) {
  const acct = await rpc("getAccountInfo", [address, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const info = acct?.value; const lamports = info ? BigInt(info.lamports ?? 0) : 0n;
  let kind = "empty", mint = null;
  if (!info) kind = "empty";
  else if (info.executable) kind = "program";
  else if (info.data?.parsed?.type === "mint") kind = "mint";
  else if (info.data?.parsed?.type === "account") { kind = "token-account"; mint = info.data.parsed.info?.mint || null; }
  else if (info.owner === P.system || isOnCurve(b58decode(address))) kind = "wallet";
  else kind = "program-owned";
  return { kind, isContract: kind === "program" || kind === "mint", mint, nonce: signatureCount, balance: solStr(lamports), balanceRaw: lamports.toString(), nativeSymbol: "SOL", selectors: [] };
}
function solTokenHandle(account, token, to) {
  if (token === to) return { status: "token_itself" };
  if (account.kind === "token-account") return { status: account.mint === token ? "token_account" : "token_account_mismatch" };
  if (account.kind === "program") return { status: "program" };
  if (account.kind === "mint") return { status: "mint" };
  if (account.kind === "program-owned") return { status: "program_owned" };
  return { status: "not_a_contract" };
}

export async function safeToSend(chain, to, opts = {}) {
  const sol = chain === "solana";
  if (!sol && !CHAINS[chain]) throw bad("unsupported chain");
  if (sol ? !isPubkey(to) : !ADDR.test(to || "")) throw bad("query param to must be an address on this chain");
  const from = opts.from || null, token = opts.token || null;
  if (from && (sol ? !isPubkey(from) : !ADDR.test(from))) throw bad("query param from must be an address on this chain");
  if (token && (sol ? !isPubkey(token) : !ADDR.test(token))) throw bad("query param token must be an address on this chain");
  const fetchImpl = opts.fetchImpl || fetch;
  if (sol) {
    const rpc = opts.solRpc || makeRpc();
    let toHistory, fromHistory, account;
    try {
      [toHistory, fromHistory] = await Promise.all([solHistory(to, rpc), from ? solHistory(from, rpc) : null]);
      account = await solAccount(to, rpc, toHistory.signatureCount);
    } catch (e) { throw Object.assign(new Error("could not read the recipient on Solana: " + String(e.message).slice(0, 160)), { status: 502 }); }
    const flags = { status: "unsupported", source: null, flags: [], note: "No free address-flag source in this service covers Solana. GoPlus address security here is EVM-only, and its Solana address endpoint is not an unsigned free API. This is not a clean result." };
    const tokenHandle = token ? solTokenHandle(account, token, to) : (account.isContract ? { status: "unspecified" } : { status: "not_a_contract" });
    return buildSafeToSend({ chain, chainName: "Solana", chainId: null, to, from, token, account, toHistory, fromHistory, flags, tokenHandle });
  }
  const rpc = opts.evmRpc || CHAINS[chain].rpc;
  let account;
  try { account = await evmAccount(chain, to, rpc); }
  catch (e) { throw Object.assign(new Error("could not read the recipient onchain: " + String(e.shortMessage || e.message).slice(0, 160)), { status: 502 }); }
  const [toHistory, fromHistory, flags] = await Promise.all([
    evmHistory(chain, to, { fetchImpl, rpc }),
    from ? evmHistory(chain, from, { fetchImpl, rpc }) : null,
    evmFlags(chain, to, fetchImpl),
  ]);
  const tokenHandle = token ? evmTokenHandle(account, token, to) : (account.isContract ? { status: "unspecified" } : { status: "not_a_contract" });
  return buildSafeToSend({ chain, chainName: CHAINS[chain].name, chainId: CHAINS[chain].chainId, to, from, token, account, toHistory, fromHistory, flags, tokenHandle });
}
