// Premium bundled reports: combine existing free-data tools into one plain-English answer.
import { formatUnits, parseAbi } from "viem";
import { CHAINS, CORE_CHAINS, approvals, inspect, contractRisk, portfolio } from "./lib.js";
import { impersonation, atLeastMedium } from "./impersonation.js";
const ZERO = "0x0000000000000000000000000000000000000000";
const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e.shortMessage || e.message).slice(0, 160) }));
const DISC = "Automated report from free public onchain data. Heuristic, not an audit, not financial or security advice. No USD pricing; balances cover native coin plus major tokens only.";

export async function walletReport(address) {
  const chains = CORE_CHAINS;
  const [pf, ...rest] = await Promise.all([settle(portfolio(address)), ...chains.map(c => settle(inspect(c, address))), ...chains.map(c => settle(approvals(c, address)))]);
  const ins = Object.fromEntries(chains.map((c, i) => [c, rest[i]])), apr = Object.fromEntries(chains.map((c, i) => [c, rest[chains.length + i]]));
  const findings = []; const say = (sev, note) => findings.push({ severity: sev, note });
  let unlimited = 0, nonzero = 0, active = [];
  for (const c of chains) {
    const I = ins[c].ok ? ins[c].v : null, A = apr[c].ok ? apr[c].v : null, N = CHAINS[c].name;
    if (I) { if (I.nonce > 0 || Number(I.nativeBalance) > 0) active.push(N);
      if (I.type === "contract") say("info", `On ${N} this address is a smart contract (smart wallet, multisig or app), not a plain wallet.`);
      if (I.type === "eoa-7702-delegated") say("medium", `On ${N} this wallet delegates its code to ${I.delegatesTo} (EIP-7702). That contract controls how the wallet behaves; make sure you trust it.`); }
    if (A) { nonzero += A.nonZeroApprovals.length; unlimited += A.unlimitedCount;
      for (const x of A.nonZeroApprovals) say(x.unlimited ? "medium" : "low", `${N}: ${x.unlimited ? "UNLIMITED" : x.allowance} ${x.token} approval to ${x.spender}. ${x.unlimited ? "That spender can move all of this token; revoke it if you no longer use it." : ""}`.trim()); }
  }
  const held = []; if (pf.ok) for (const ch of pf.v.chains || []) { if (ch.error) continue;
    if (Number(ch.native.balance) > 0) held.push(`${ch.native.balance} ${ch.native.symbol} on ${CHAINS[ch.chain].name}`);
    for (const t of ch.tokens || []) if (Number(t.balance) > 0) held.push(`${t.balance} ${t.symbol} on ${CHAINS[ch.chain].name}`); }
  const riskLevel = unlimited >= 3 ? "high" : unlimited >= 1 || findings.some(f => f.severity === "medium") ? "medium" : "low";
  const summary = [
    active.length ? `Active on ${active.join(", ")}.` : "No activity or native balance found on Base, Ethereum or BNB Smart Chain.",
    held.length ? `Holds ${held.slice(0, 8).join("; ")}${held.length > 8 ? ` and ${held.length - 8} more` : ""}.` : "No balances found among the major tokens checked.",
    nonzero ? `${nonzero} open token approval(s), ${unlimited} unlimited.` : "No open approvals found to the common spenders checked.",
    riskLevel === "low" ? "Overall hygiene looks good." : riskLevel === "medium" ? "Worth reviewing the approvals above." : "Several unlimited approvals: revoking unused ones is recommended."].join(" ");
  return { type: "wallet-report", address, riskLevel, summary, findings, portfolio: pf.ok ? pf.v : { error: pf.e },
    inspect: Object.fromEntries(chains.map(c => [c, ins[c].ok ? ins[c].v : { error: ins[c].e }])), approvals: Object.fromEntries(chains.map(c => [c, apr[c].ok ? apr[c].v : { error: apr[c].e }])), disclaimer: DISC };
}

export async function tokenReport(address, chain = "base") {
  const C = CHAINS[chain]; const N = C.name;
  const [I, R] = await Promise.all([inspect(chain, address), contractRisk(chain, address)]);
  const holders = { owner: R.owner ?? null, ownerType: R.ownerType ?? null, proxyAdmin: R.proxy?.admin ?? null, totalSupply: I.erc20?.totalSupply ?? null, note: "Top-holder lists need a paid indexer and are not included; balances below are read live from the token contract." };
  if (I.erc20) {
    const bal = a => C.rpc.readContract({ address, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [a] }).catch(() => undefined);
    const [sup, ob, cb, db] = await Promise.all([C.rpc.readContract({ address, abi: parseAbi(["function totalSupply() view returns (uint256)"]), functionName: "totalSupply" }).catch(() => undefined),
      R.owner && R.owner !== ZERO ? bal(R.owner) : undefined, bal(address), bal("0x000000000000000000000000000000000000dEaD")]);
    const pct = b => b !== undefined && sup ? Number((b * 1000000n) / sup) / 10000 : null; const fmt = b => b === undefined ? null : formatUnits(b, I.erc20.decimals);
    if (ob !== undefined) holders.ownerBalance = { amount: fmt(ob), pctOfSupply: pct(ob) };
    holders.tokenContractSelfBalance = { amount: fmt(cb), pctOfSupply: pct(cb) }; holders.deadAddressBalance = { amount: fmt(db), pctOfSupply: pct(db) };
  }
  const findings = [...(R.findings || [])];
  if (holders.ownerBalance?.pctOfSupply >= 10) findings.push({ severity: "high", note: `The owner wallet holds ${holders.ownerBalance.pctOfSupply}% of supply.` });
  let riskLevel = R.riskLevel; if (findings.some(f => f.severity === "high") && riskLevel !== "n/a") riskLevel = riskLevel === "low" ? "medium" : "high";
  const imp = I.erc20 ? impersonation(chain, address, I.erc20) : null; if (imp) { findings.unshift({ severity: imp.severity, note: imp.note }); riskLevel = atLeastMedium(riskLevel); }
  const what = I.erc20 ? `${I.erc20.name ?? "Unnamed"} (${I.erc20.symbol}), an ERC-20 on ${N} with ${I.erc20.totalSupply ?? "unknown"} supply` : `${I.type} on ${N} (not an ERC-20)`;
  const summary = [`${what}.`, I.proxy ? `It is upgradeable (${I.proxy.standard}), so its code can change.` : "Not an upgradeable proxy.",
    R.owner === ZERO ? "Ownership is renounced." : R.owner ? `Controlled by ${R.ownerType === "eoa" ? "a single wallet" : "a contract"} ${R.owner}.` : "No owner() found.",
    R.sourcify?.contract?.verified || R.sourcify?.implementation?.verified ? "Source is verified on Sourcify." : "Source not verified on Sourcify.",
    `Heuristic risk: ${riskLevel}${findings.length ? ` (${findings.length} finding(s))` : ""}.`, "Admin powers like mint, pause or blacklist are normal for many legitimate tokens such as USDC."].join(" ");
  return { type: "token-report", chain, chainId: C.chainId, address, riskLevel, summary, holders, findings, inspect: I, contractRisk: R, disclaimer: DISC };
}
