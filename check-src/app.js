// /check page logic. Plain browser JS, no framework. The x402 signing code (official @x402 packages + viem)
// is lazy-loaded from /check/pay.js only when the user clicks Pay.
(() => {
  const $ = id => document.getElementById(id);
  const ADDR = /^0x[0-9a-fA-F]{40}$/, SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const CN = { base: "Base", ethereum: "Ethereum", bsc: "BNB Chain", solana: "Solana" };
  const EXPLORER = { base: "https://basescan.org", ethereum: "https://etherscan.io", bsc: "https://bscscan.com" };
  const CN7 = { base: "Base", ethereum: "Ethereum", bsc: "BNB Chain", arbitrum: "Arbitrum", optimism: "Optimism", polygon: "Polygon", avalanche: "Avalanche" };
  const EX7 = { ...EXPLORER, arbitrum: "https://arbiscan.io", optimism: "https://optimistic.etherscan.io", polygon: "https://polygonscan.com", avalanche: "https://snowtrace.io" };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const short = a => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
  const fmtUsdc = atomic => (Number(atomic) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const b64json = s => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))));
  let state = { pr: null, url: null, kind: null, chain: null, account: null };

  function eth() { return window.ethereum || null; }
  function setStatus(html, cls = "") { const s = $("status"); s.className = "status " + cls; s.innerHTML = html; s.hidden = !html; }
  const SOLW = { solwallet: 1, soldelegates: 1 };
  function syncKind() { const k = document.querySelector("input[name=kind]:checked").value; $("chainRow").hidden = k === "wallet" || k === "sweep" || k === "bundles" || k === "solana" || !!SOLW[k];
    $("addrLabel").textContent = k === "solana" ? "Solana token mint address" : k === "bundles" ? "BNB Chain token contract address" : SOLW[k] ? "Solana wallet address" : k !== "wallet" && k !== "sweep" ? "Token contract address" : "Wallet address";
    $("addr").placeholder = k === "solana" ? "e.g. DezXAZ8z7Pnrn… or …pump" : SOLW[k] ? "Solana wallet (base58, no 0x)" : k !== "wallet" && k !== "sweep" ? "0x… token contract" : "0x… wallet"; reset(); }
  function reset() { state.pr = null; $("payBox").hidden = true; $("report").hidden = true; setStatus(""); }

  function buildUrl() {
    const kind = document.querySelector("input[name=kind]:checked").value, a = $("addr").value.trim(), chain = $("chain").value;
    if (kind === "solana") { if (!SOL.test(a)) return { err: "That doesn't look like a Solana mint address (base58, 32 to 44 characters, no 0x)." };
      return { url: `/v1/solana/token?address=${a}`, kind, chain: "solana", addr: a }; }
    if (SOLW[kind]) { if (!SOL.test(a)) return { err: "That doesn't look like a Solana address (base58, 32 to 44 characters, no 0x)." };
      return { url: `/v1/solana/${kind === "solwallet" ? "address" : "delegates"}?address=${a}`, kind, chain: "solana", addr: a }; }
    if (SOL.test(a) && !a.startsWith("0x")) return { err: "That looks like a Solana address. Pick one of the Solana options above." };
    if (!ADDR.test(a)) return { err: "That doesn't look like an address. It should start with 0x followed by 40 hex characters. ENS names aren't supported here." };
    if (kind === "bundles") return { url: `/v1/bsc/bundles?token=${a}`, kind, chain: "bsc", addr: a };
    if (kind === "honeypot") return { url: `/v1/${chain}/honeypot?token=${a}`, kind, chain, addr: a };
    if (kind === "verdict") return { url: `/v1/${chain}/verdict?token=${a}`, kind, chain, addr: a };
    if (kind === "sweep") return { url: `/v1/approvals/sweep?address=${a}`, kind, chain: null, addr: a };
    const u = kind === "deep" ? `/v1/token/deep-scan?address=${a}&chain=${chain}` : kind === "token" ? `/v1/token-report?address=${a}&chain=${chain}` : `/v1/wallet-report?address=${a}`;
    return { url: u, kind, chain: kind !== "wallet" ? chain : null, addr: a };
  }

  async function getQuote(ev) {
    ev.preventDefault(); reset();
    const b = buildUrl(); if (b.err) return setStatus(esc(b.err), "err");
    setStatus("Getting price…");
    try {
      const r = await fetch(b.url, { headers: { Accept: "application/json" } });
      if (r.status === 400) { const j = await r.json().catch(() => ({})); return setStatus("Invalid input (no charge): " + esc(j.error || "bad request"), "err"); }
      if (r.status !== 402) return setStatus("Unexpected response from server (" + r.status + "). Please try again.", "err");
      const h = r.headers.get("payment-required"); if (!h) return setStatus("Server didn't send payment details. Please retry.", "err");
      const pr = b64json(h);
      const acc = (pr.accepts || []).find(a => a.network === "eip155:8453" && a.scheme === "exact");
      if (!acc) return setStatus("No Base USDC payment option offered.", "err");
      state = { ...state, pr, url: b.url, kind: b.kind, chain: b.chain };
      $("qPrice").textContent = fmtUsdc(acc.amount) + " USDC";
      $("qWhat").textContent = b.kind === "verdict" ? `Quick token verdict (SAFE / CAUTION / AVOID, taxes, owner powers, LP, holders) for ${short(b.addr)} on ${CN[b.chain]}` : b.kind === "honeypot" ? `Honeypot check (simulated buy + sell: can you sell it, buy and sell tax) for ${short(b.addr)} on ${CN[b.chain]}` : b.kind === "bundles" ? `BNB Chain bundle + sniper check (launch-block buyers, bundles, shared funders, dev link) for ${short(b.addr)}` : b.kind === "sweep" ? `All-chain approval sweep (live token + NFT approvals on 7 chains, risk-ranked, with one-click revokes) for ${short(b.addr)}` : b.kind === "solwallet" ? `Solana wallet lookup (SOL + token balances, wallet age, recent activity) for ${short(b.addr)}` : b.kind === "soldelegates" ? `Solana token delegate check (live approvals, unlimited and unknown delegates) for ${short(b.addr)}` : b.kind === "solana" ? `Solana token check (authorities, metadata, extensions, holders, pump.fun curve / LP) for ${short(b.addr)}` : b.kind === "deep" ? `Token deep scan (honeypot sell test, liquidity, holders, owner powers) for ${short(b.addr)} on ${CN[b.chain]}` : b.kind === "token" ? `Token due-diligence report for ${short(b.addr)} on ${CN[b.chain]}` : `Wallet security report for ${short(b.addr)} across Base, Ethereum and BNB Chain`;
      $("qPayTo").textContent = acc.payTo; $("qPayTo").href = "https://basescan.org/address/" + acc.payTo;
      $("payBox").hidden = false; setStatus("");
      updateWalletUi();
    } catch (e) { setStatus("Couldn't reach the server: " + esc(e.message), "err"); }
  }

  async function ensureBase(p) {
    const cid = await p.request({ method: "eth_chainId" });
    if (cid === "0x2105") return;
    try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }); }
    catch (e) {
      if (e && (e.code === 4902 || /unrecognized|not added/i.test(e.message || ""))) {
        await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }] });
      } else throw e;
    }
  }
  async function usdcBalance(p, who) {
    const data = "0x70a08231" + who.slice(2).toLowerCase().padStart(64, "0");
    const r = await p.request({ method: "eth_call", params: [{ to: USDC_BASE, data }, "latest"] });
    return BigInt(r);
  }
  function updateWalletUi() {
    const has = !!eth();
    $("noWallet").hidden = has; $("connectBtn").hidden = !has || !!state.account; $("payBtn").hidden = !state.account;
    $("acct").textContent = state.account ? "Connected: " + short(state.account) : "";
  }
  async function connect() {
    const p = eth(); if (!p) return updateWalletUi();
    try {
      setStatus("Waiting for your wallet…");
      const [a] = await p.request({ method: "eth_requestAccounts" }); state.account = a;
      await ensureBase(p);
      const acc = state.pr.accepts.find(x => x.network === "eip155:8453");
      const bal = await usdcBalance(p, a).catch(() => null);
      updateWalletUi();
      if (bal !== null && bal < BigInt(acc.amount)) setStatus(`This wallet has ${fmtUsdc(bal)} USDC on Base. You need at least ${fmtUsdc(acc.amount)} USDC on Base to pay. (No ETH needed for gas.)`, "warn");
      else setStatus(bal !== null ? `Wallet has ${fmtUsdc(bal)} USDC on Base. Ready to pay.` : "Connected.", "ok");
    } catch (e) { setStatus("Wallet connection failed: " + esc(e.shortMessage || e.message || e), "err"); }
  }
  p_on();
  function p_on() { const p = eth(); if (p && p.on) { p.on("accountsChanged", a => { state.account = a[0] || null; updateWalletUi(); }); } }

  async function pay() {
    const p = eth(); if (!p || !state.account || !state.pr) return;
    $("payBtn").disabled = true;
    try {
      await ensureBase(p);
      setStatus("Loading payment module…");
      const mod = await import("/check/pay.js?v=__PAYVER__");
      const http = mod.makePayer(p, state.account);
      setStatus("Approve the signature in your wallet. It authorizes one USDC transfer of exactly the amount shown; it is not a blanket approval.");
      const payload = await http.createPaymentPayload(state.pr);
      setStatus("Payment signed. Generating your report (can take 10–30 seconds)…");
      const r = await fetch(state.url, { headers: { Accept: "application/json", ...http.encodePaymentSignatureHeader(payload) } });
      if (r.status === 200) {
        const report = await r.json(); let tx = null;
        try { const pr = r.headers.get("payment-response"); if (pr) tx = b64json(pr).transaction; } catch {}
        render(report, tx); setStatus(""); $("payBox").hidden = true; state.pr = null;
      } else if (r.status === 402) {
        let reason = ""; try { reason = b64json(r.headers.get("payment-required")).error || ""; } catch {}
        const low = /revert|insufficient|balance/i.test(reason);
        setStatus(low ? "Payment was not accepted: this wallet most likely doesn't have enough USDC on Base. You were not charged." : "Payment was not accepted" + (reason ? ": " + esc(reason) : "") + ". You were not charged. Common causes: not enough USDC on Base, or the signature expired.", "err");
      } else {
        const j = await r.json().catch(() => ({}));
        setStatus("The report couldn't be generated (" + r.status + (j.error ? ": " + esc(j.error) : "") + "). Payment is only settled when a report is delivered, so you should not have been charged.", "err");
      }
    } catch (e) {
      const m = e.shortMessage || e.message || String(e);
      setStatus(/reject|denied|cancel/i.test(m) ? "You cancelled the signature. Nothing was paid." : "Payment failed: " + esc(m), "err");
    } finally { $("payBtn").disabled = false; }
  }

  const sevOrder = { high: 0, medium: 1, low: 2, info: 3 };
  function findingsHtml(f) {
    if (!f || !f.length) return "<p class=muted>No findings.</p>";
    return "<ul class=finds>" + [...f].sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9))
      .map(x => `<li><span class="sev ${esc(x.severity)}">${esc(x.severity)}</span> ${esc(x.note)}</li>`).join("") + "</ul>";
  }
  function walletHtml(r) {
    let h = "";
    const rows = [];
    for (const ch of (r.portfolio && r.portfolio.chains) || []) {
      if (ch.error) { rows.push(`<tr><td>${esc(CN[ch.chain] || ch.chain)}</td><td colspan=2 class=muted>couldn't read</td></tr>`); continue; }
      const items = []; if (Number(ch.native?.balance) > 0) items.push(`${esc(ch.native.balance)} ${esc(ch.native.symbol)}`);
      for (const t of ch.tokens || []) if (Number(t.balance) > 0) items.push(`${esc(t.balance)} ${esc(t.symbol)}`);
      rows.push(`<tr><td>${esc(CN[ch.chain] || ch.chain)}</td><td>${items.length ? items.join("<br>") : '<span class=muted>none found</span>'}</td></tr>`);
    }
    if (rows.length) h += `<h3>Balances <small class=muted>(native coin + major tokens only, no USD prices)</small></h3><table><tbody>${rows.join("")}</tbody></table>`;
    const ap = [];
    for (const [c, a] of Object.entries(r.approvals || {})) for (const x of (a && a.nonZeroApprovals) || [])
      ap.push(`<tr><td>${esc(CN[c] || c)}</td><td>${esc(x.token)}</td><td>${esc(x.spender)}</td><td>${x.unlimited ? '<b class=bad>unlimited</b>' : esc(x.allowance)}</td></tr>`);
    h += `<h3>Token approvals</h3>` + (ap.length ? `<table><thead><tr><th>Chain</th><th>Token</th><th>Spender</th><th>Allowance</th></tr></thead><tbody>${ap.join("")}</tbody></table><p class=muted>To revoke, you can use a tool like revoke.cash with your own wallet.</p>` : "<p class=muted>No open approvals to the common spenders checked.</p>");
    const types = Object.entries(r.inspect || {}).map(([c, i]) => `${CN[c] || c}: ${i.error ? "unknown" : esc(i.type)}`).join(" · ");
    if (types) h += `<h3>Address type</h3><p>${types}</p>`;
    return h;
  }
  function tokenHtml(r) {
    const I = r.inspect || {}, R = r.contractRisk || {}, H = r.holders || {}, e = I.erc20 || {};
    const pct = o => o && o.pctOfSupply != null ? `${esc(o.amount)} (${esc(o.pctOfSupply)}% of supply)` : "n/a";
    const ex = EXPLORER[r.chain] || EXPLORER.base;
    const facts = [
      ["Name / symbol", e.name || e.symbol ? `${esc(e.name || "?")} (${esc(e.symbol || "?")})` : "Not an ERC-20"],
      ["Total supply", esc(e.totalSupply ?? "n/a")],
      ["Upgradeable", I.proxy ? `Yes (${esc(I.proxy.standard)})` : "No"],
      ["Owner", R.owner ? (R.owner === "0x0000000000000000000000000000000000000000" ? "Renounced" : `<a href="${ex}/address/${esc(R.owner)}" target=_blank rel=noopener>${esc(short(R.owner))}</a> (${esc(R.ownerType || "?")})`) : "No owner() found"],
      ["Source verified (Sourcify)", R.sourcify?.contract?.verified || R.sourcify?.implementation?.verified ? "Yes" : "No"],
      ["Owner balance", pct(H.ownerBalance)], ["Burned (dead address)", pct(H.deadAddressBalance)],
    ];
    return `<h3>Key facts</h3><table><tbody>${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>`;
  }
  function deepHtml(r) {
    const S = r.honeypotSimulation || {}, L = r.liquidity || {}, M = L.mainPool, H = r.holders || {}, O = r.ownerPowers || {};
    const ex = EXPLORER[r.chain] || EXPLORER.base, link = a => a ? `<a href="${ex}/address/${esc(a)}" target=_blank rel=noopener>${esc(short(a))}</a>` : "n/a";
    const sell = S.ran ? (S.canSell ? `<b style="color:var(--ok)">Yes</b> (buy tax ${esc(S.buyTaxPct)}%, sell tax ${esc(S.sellTaxPct)}%, round trip returned ${esc(S.roundTripReturnPct)}%)` : `<b class=bad>NO</b>: ${esc(S.failedAt)}${S.revertReason ? " (" + esc(S.revertReason) + ")" : ""}`) : `<span class=muted>Not simulated: ${esc(S.reason)}</span>`;
    let h = `<h3>Honeypot test</h3><table><tbody><tr><td>Can sell after buying?</td><td>${sell}</td></tr>${S.ran ? `<tr><td>Simulated on</td><td>${esc(S.dex)} ${link(S.pool)}, trade ${esc(S.tradeSize)}</td></tr>` : ""}</tbody></table>`;
    h += `<h3>Liquidity</h3>` + (M ? `<table><tbody><tr><td>Main pool</td><td>${esc(M.dex)} · ${esc(M.pairedWith)} · ${link(M.address)}</td></tr><tr><td>Size</td><td>${M.approxTotalUsd != null ? "~$" + Number(M.approxTotalUsd).toLocaleString() : esc(M.quoteSideReserve) + " " + esc(M.pairedWith) + " paired side"}</td></tr>
      <tr><td>LP burned / locked</td><td>${esc(L.lp?.verdict || L.lp?.note || "n/a")}</td></tr><tr><td>Pools found</td><td>${esc(L.poolsFound)}</td></tr></tbody></table>` : `<p class=muted>${esc(L.coverage || "No pool found.")}</p>`);
    if (H.available) { h += `<h3>Holders ${H.partial ? "<small class=muted>(partial: recently active addresses)</small>" : ""}</h3><p>Top 10 own <b>${esc(H.top10Pct)}%</b> of supply (${esc(H.top10ExcludingPoolsAndBurnPct)}% excluding pools and burn addresses)${H.holderCount ? ` · ${Number(H.holderCount).toLocaleString()} holders` : ""}.</p>
      <table><thead><tr><th>Holder</th><th>% supply</th><th>Note</th></tr></thead><tbody>${(H.top || []).slice(0, 10).map(x => `<tr><td>${link(x.address)}</td><td>${esc(x.pctOfSupply)}%</td><td>${esc(x.label || (x.isContract ? "contract" : ""))}</td></tr>`).join("")}</tbody></table>`; }
    else h += `<h3>Holders</h3><p class=muted>${esc(H.reason || "n/a")}</p>`;
    const caps = Object.keys(O.capabilities || {}).filter(k => k !== "ownership").join(", ") || "none detected";
    h += `<h3>Owner powers</h3><table><tbody><tr><td>Owner</td><td>${O.owner === "0x0000000000000000000000000000000000000000" ? "Renounced" : O.owner ? link(O.owner) + " (" + esc(O.ownerType) + ")" : "No owner() found"}</td></tr><tr><td>Upgradeable</td><td>${O.proxy ? "Yes (" + esc(O.proxy.standard) + ")" : "No"}</td></tr><tr><td>Admin functions</td><td>${esc(caps)}</td></tr></tbody></table>`;
    if ((r.couldNotDetermine || []).length) h += `<h3>What we couldn't determine</h3><ul>${r.couldNotDetermine.map(x => `<li class=muted>${esc(x)}</li>`).join("")}</ul>`;
    return h;
  }
  function solHtml(r) {
    if (r.kind !== "mint") return "";
    const sx = a => a ? `<a href="https://solscan.io/account/${esc(a)}" target=_blank rel=noopener>${esc(short(a))}</a>` : "n/a";
    const T = r.token || {}, M = r.metadata || {}, F = r.pumpfun || {}, H = r.holders || {};
    const auth = o => o && o.active ? `<b class=bad>Active</b> (${sx(o.address)})` : "Revoked";
    const facts = [["Name / symbol", `${esc(T.name || "?")} (${esc(T.symbol || "?")})`], ["Program", esc(r.tokenProgram)], ["Supply", esc(T.supply)],
      ["Mint authority", auth(r.mintAuthority)], ["Freeze authority", auth(r.freezeAuthority)],
      ["Metadata", M.source ? (M.isMutable ? `<b class=bad>Mutable</b> (update authority ${sx(M.updateAuthority)})` : "Immutable") + ` · ${esc(M.source)}` : "Not found"],
      ["Token-2022 extensions", esc((r.extensions?.present || []).join(", ") || "none")],
      ["pump.fun", F.isPumpFun ? (F.status === "on-curve" ? `On the bonding curve${F.progressPct != null ? ` (~${esc(F.progressPct)}% to graduation)` : ""}` : `Graduated${F.pool ? ` · PumpSwap ${sx(F.pool.address)}${F.pool.lpBurnedPct != null ? `, ${esc(F.pool.lpBurnedPct)}% LP burned` : ""}` : ""}`) : "Not a pump.fun coin"]];
    let h = `<h3>Key facts</h3><table><tbody>${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>`;
    if (H.available) h += `<h3>Holders <small class=muted>(${esc(H.basis)})</small></h3><p>Top 10 own <b>${esc(H.top10Pct)}%</b> (${esc(H.top10ExcludingPoolsPct)}% excluding pools and the curve).</p>
      <table><thead><tr><th>Owner</th><th>% supply</th><th>Note</th></tr></thead><tbody>${(H.top || []).map(x => `<tr><td>${sx(x.owner)}</td><td>${esc(x.pctOfSupply)}%</td><td>${esc(x.label || "")}</td></tr>`).join("")}</tbody></table>`;
    else h += `<h3>Holders</h3><p class=muted>${esc(H.reason || "n/a")}</p>`;
    if ((r.couldNotDetermine || []).length) h += `<h3>What we couldn't determine</h3><ul>${r.couldNotDetermine.map(x => `<li class=muted>${esc(x)}</li>`).join("")}</ul>`;
    return h;
  }
  const sxl = a => a ? `<a href="https://solscan.io/account/${esc(a)}" target=_blank rel=noopener>${esc(short(a))}</a>` : "n/a";
  function solAddrHtml(r) {
    const A = r.age || {}, V = r.activity || {}, T = r.tokens || {};
    const facts = [["Account type", esc(r.kind)], ["SOL balance", r.sol?.balance != null ? esc(r.sol.balance) + " SOL" : "unknown"],
      ["Tokens with a balance", T.available ? esc(T.withBalance) + (T.emptyAccounts ? ` (+${esc(T.emptyAccounts)} empty accounts)` : "") : "unknown"],
      ["Wallet age", A.firstSeen ? (A.complete ? `${esc(A.ageDays)} days (first tx ${esc(A.firstSeen.slice(0, 10))})` : `at least ${esc(A.ageDays)} days (since ${esc(A.firstSeen.slice(0, 10))} or earlier)`) : A.available ? "no transactions" : "unknown"],
      ["Last active", esc(V.lastActive || "n/a")], ["Transactions 24h / 7d / 30d", V.available ? `${esc(V.last24h)} / ${esc(V.last7d)} / ${esc(V.last30d)}` : "unknown"],
      ["Live token delegates", r.liveDelegates ? `<b class=bad>${esc(r.liveDelegates)}</b> (run the delegate check)` : "0"]];
    let h = `<h3>Key facts</h3><table><tbody>${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>`;
    if ((T.list || []).length) h += `<h3>Token balances <small class=muted>(no USD prices${T.withBalance > T.shown ? `, first ${esc(T.shown)} shown` : ""})</small></h3><table><thead><tr><th>Token</th><th>Balance</th><th>Mint</th></tr></thead><tbody>${T.list.slice(0, 25).map(t => `<tr><td>${esc(t.symbol || t.name || "?")}${t.frozen ? " <span class=bad>(frozen)</span>" : ""}</td><td>${esc(t.balance)}</td><td>${sxl(t.mint)}</td></tr>`).join("")}</tbody></table>`;
    if ((V.recent || []).length) h += `<h3>Recent transactions</h3><table><tbody>${V.recent.map(x => `<tr><td><a href="https://solscan.io/tx/${esc(x.signature)}" target=_blank rel=noopener>${esc(short(x.signature))}</a></td><td>${esc(x.time || "")}</td><td>${x.status === "failed" ? "<span class=bad>failed</span>" : "ok"}</td></tr>`).join("")}</tbody></table>`;
    if ((r.couldNotDetermine || []).length) h += `<h3>What we couldn't determine</h3><ul>${r.couldNotDetermine.map(x => `<li class=muted>${esc(x)}</li>`).join("")}</ul>`;
    return h;
  }
  function solDelHtml(r) {
    let h = `<h3>Live delegates</h3>` + ((r.delegates || []).length ? `<table><thead><tr><th>Token</th><th>Delegate</th><th>Can move</th></tr></thead><tbody>${r.delegates.map(d => `<tr><td>${esc(d.symbol || short(d.mint))}</td><td>${sxl(d.delegate)} ${esc(d.known ? d.delegateLabel : "unknown " + d.delegateType)}</td><td>${d.unlimited ? "<b class=bad>UNLIMITED</b>" : esc(d.delegatedAmount)} <span class=muted>(balance ${esc(d.balance)})</span></td></tr>`).join("")}</tbody></table>` : `<p>None. Nobody can move tokens out of this wallet through a token delegate.</p>`);
    if ((r.permanentDelegates || []).length) h += `<h3>Permanent delegates (Token-2022, can't be revoked)</h3><ul>${r.permanentDelegates.map(p => `<li>${esc(p.symbol || short(p.mint))}: ${sxl(p.permanentDelegate)}</li>`).join("")}</ul>`;
    if (r.howToRevoke) h += `<h3>How to revoke</h3><p>${esc(r.howToRevoke)}</p>`;
    if ((r.couldNotDetermine || []).length) h += `<h3>What we couldn't determine</h3><ul>${r.couldNotDetermine.map(x => `<li class=muted>${esc(x)}</li>`).join("")}</ul>`;
    return h;
  }
  function verdictHtml(r) {
    const f = r.flags || {};
    const yn = v => v == null ? "?" : v ? "yes" : "no";
    const pct = v => v == null ? "unknown" : esc(v) + "%";
    const rows = [["Verdict", `<b>${esc(r.verdict)}</b>`], ["Can you sell it?", `<b>${f.sellable ? "yes" : "NO"}</b>`], ["Buy tax", pct(f.buyTaxPct)], ["Sell tax", pct(f.sellTaxPct)],
      ["Owner renounced", yn(f.ownerRenounced)], ["Proxy / upgradeable", yn(f.isProxy)], ["Can mint", yn(f.canMint)], ["Can pause", yn(f.canPause)], ["Can blacklist", yn(f.canBlacklist)], ["Can change fees", yn(f.canChangeFees)],
      ["LP burned or locked", pct(f.lpBurnedOrLockedPct)], ["Top 10 holders (excl. pools/burn)", pct(f.top10HolderPct)], ["Copycat of a major token", f.copycatName ? "<b class=bad>yes</b>" : "no"]];
    let h = `<h3>Flags</h3><table><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>`;
    if (r.coverage?.pool) h += `<p class="muted small">Simulated on ${esc(r.coverage.pool.dex || "")} ${esc(r.coverage.simulation?.tradeSize || "")}.</p>`;
    if ((r.couldNotDetermine || []).length) h += `<h3>What we couldn't determine</h3><ul>${r.couldNotDetermine.map(x => `<li class=muted>${esc(x)}</li>`).join("")}</ul>`;
    if (r.coverage?.notes?.length) h += `<ul>${r.coverage.notes.map(x => `<li class="muted small">${esc(x)}</li>`).join("")}</ul>`;
    return h;
  }
  function honeypotHtml(r) {
    const ex = EXPLORER[r.chain] || EXPLORER.base, p = r.pool || {}, s = r.simulation || {};
    let h = `<h3>Result</h3><table><tbody><tr><td>Can you sell it?</td><td><b>${r.sellable ? "yes" : "NO"}</b></td></tr><tr><td>Buy tax</td><td>${r.buyTaxPct == null ? "?" : esc(r.buyTaxPct) + "%"}</td></tr><tr><td>Sell tax</td><td>${r.sellTaxPct == null ? "?" : esc(r.sellTaxPct) + "%"}</td></tr><tr><td>Verdict</td><td>${esc(r.verdict)}</td></tr><tr><td>Pool used</td><td><a href="${ex}/address/${esc(p.address)}" target=_blank rel=noopener>${esc(short(p.address))}</a> · ${esc(p.dex)} (${esc(p.pairedWith)})</td></tr><tr><td>Test trade</td><td>${esc(s.tradeSize)}</td></tr>${s.revertReason ? `<tr><td>Revert reason</td><td>${esc(s.revertReason)}</td></tr>` : ""}</tbody></table>`;
    if (r.coverage?.notes?.length) h += `<ul>${r.coverage.notes.map(x => `<li class="muted small">${esc(x)}</li>`).join("")}</ul>`;
    return h;
  }
  function bundleHtml(r) {
    const ex = a => `<a href="https://bscscan.com/address/${esc(a)}" target=_blank rel=noopener>${esc(short(a))}</a>`, c = r.cluster || {};
    let h = `<h3>Cluster</h3><table><tbody><tr><td>Linked wallets</td><td>${esc(c.wallets)}</td></tr><tr><td>Supply grabbed at launch</td><td>${esc(c.supplyPctAtLaunch)}%</td></tr><tr><td>Supply still held</td><td>${esc(c.supplyPctHeldNow)}%</td></tr><tr><td>Dev in cluster</td><td>${c.devInCluster ? "<b>yes</b>" : "no"}</td></tr><tr><td>Bundle txs</td><td>${esc((c.bundledTxs || []).length)}</td></tr><tr><td>Deployer</td><td>${r.deployer ? ex(r.deployer) : "unknown"}</td></tr><tr><td>Launch block</td><td>${esc(r.launchBlock)} (${esc(r.platform)})</td></tr></tbody></table>`;
    const list = (r.wallets || []).slice(0, 50);
    if (list.length) h += `<h3>Early wallets <small class=muted>(first ${list.length} of ${esc(r.walletsTotal)})</small></h3><table><thead><tr><th>Wallet</th><th>Block</th><th>Got</th><th>Holds</th><th>Why</th></tr></thead><tbody>${list.map(w => `<tr><td>${ex(w.address)}${w.isDev ? " (dev)" : ""}${w.inCluster ? " ●" : ""}</td><td>+${esc(w.blockOffset)}</td><td>${esc(w.supplyPct)}%</td><td>${w.holdsPct == null ? "?" : esc(w.holdsPct) + "%"}</td><td class=small>${esc((w.why || []).join("; "))}</td></tr>`).join("")}</tbody></table>`;
    if (r.coverage) h += `<p class="muted small">Coverage: ${esc(r.coverage.note)}</p>`;
    return h;
  }
  function sweepHtml(r) {
    const ex = (c, a, label) => `<a href="${EX7[c] || EX7.base}/address/${esc(a)}" target=_blank rel=noopener>${esc(label || short(a))}</a>`;
    let h = `<h3>Chains</h3><table><thead><tr><th>Chain</th><th>Status</th><th>Live</th><th>Risky</th></tr></thead><tbody>${(r.chains || []).map(c => `<tr><td>${esc(CN7[c.chain] || c.chain)}</td><td>${c.status === "ok" ? "ok" : c.status === "partial" ? '<span style="color:var(--warn)">partial</span>' : '<span class=bad>couldn\'t read</span>'}</td><td>${esc(c.live ?? "-")}</td><td>${c.risky ? `<b class=bad>${esc(c.risky)}</b>` : esc(c.risky ?? "-")}</td></tr>`).join("")}</tbody></table>`;
    const list = (r.approvals || []).slice(0, 100);
    h += `<h3>Approvals <small class=muted>(riskiest first${(r.approvals || []).length > 100 ? ", first 100 shown, all in the JSON" : ""})</small></h3>` + (list.length ? `<table><thead><tr><th>Risk</th><th>Token</th><th>Spender</th><th>Can move</th><th></th></tr></thead><tbody>${list.map((a, i) => `<tr><td><span class="sev ${esc(a.severity)}">${esc(a.severity)}</span><br><small class=muted>${esc(CN7[a.chain] || a.chain)}</small></td><td>${ex(a.chain, a.token.address, a.token.symbol || a.token.name)}${a.kind !== "erc20" ? " <small class=muted>(NFTs)</small>" : ""}</td><td>${ex(a.chain, a.spender.address, a.spender.label)}<br><small class=muted>${esc(a.spender.known ? "known" : "unknown")} · ${esc(a.spender.type)}${a.spender.verified === false ? " · unverified" : ""}</small></td><td>${a.unlimited ? `<b class=bad>${a.kind === "erc20" ? "unlimited" : "all"}</b>` : esc(a.allowance)}</td><td>${a.revokeTx ? `<button type=button class=b2 data-revoke="${i}">Revoke</button>` : ""}</td></tr><tr><td colspan=5 class="muted small">${esc((a.reasons || []).join("; ") || "known spender, limited amount")}</td></tr>`).join("")}</tbody></table>
      <p class="muted small">Revoke sends approve(spender, 0) or setApprovalForAll(operator, false) from your wallet on that chain. Connect the wallet that owns these approvals; it costs only gas there.</p><div id=revokeStatus class=status hidden></div>` : "<p>No live approvals found on the chains we could read.</p>");
    if (r.coverage) h += `<p class="muted small">${esc(r.coverage)}</p>`;
    return h;
  }
  async function revoke(r, i) {
    const a = r.approvals[i], t = a && a.revokeTx, p = eth(), st = $("revokeStatus"); if (!t || !st) return;
    const say = (m, c = "") => { st.className = "status " + c; st.innerHTML = m; st.hidden = false; };
    if (!p) return say("No browser wallet detected.", "err");
    try {
      const [acct] = await p.request({ method: "eth_requestAccounts" });
      if (String(acct).toLowerCase() !== String(r.owner).toLowerCase()) return say(`Revokes must come from the wallet that gave the approval (${esc(short(r.owner))}). You're connected as ${esc(short(acct))}.`, "warn");
      const hex = "0x" + Number(t.chainId).toString(16);
      if (await p.request({ method: "eth_chainId" }) !== hex) { try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
        catch (e) { return say(`Switch your wallet to ${esc(CN7[a.chain] || a.chain)} (chain id ${esc(t.chainId)}) and press Revoke again.`, "warn"); } }
      say("Confirm the revoke in your wallet…");
      const h = await p.request({ method: "eth_sendTransaction", params: [{ from: acct, to: t.to, data: t.data, value: "0x0" }] });
      say(`Revoke sent: <a href="${EX7[a.chain] || EX7.base}/tx/${esc(h)}" target=_blank rel=noopener>${esc(short(h))}</a>`, "ok");
    } catch (e) { const m = e.shortMessage || e.message || String(e); say(/reject|denied|cancel/i.test(m) ? "Cancelled. Nothing was sent." : "Revoke failed: " + esc(m), "err"); }
  }
  function render(r, tx) {
    const lvl = String(r.riskLevel || "n/a").toLowerCase();
    $("report").innerHTML = `<div class=rhead>${r.type === "solana-address" ? "" : `<span class="risk ${esc(lvl)}">Risk: ${esc(lvl)}</span>`}
      <span class=muted>${r.type === "token-verdict" ? "Quick verdict · " + esc(CN[r.chain] || r.chain) : r.type === "honeypot-check" ? "Honeypot check · " + esc(CN[r.chain] || r.chain) : r.type === "bsc-bundle-check" ? "Bundle + sniper check · BNB Chain" : r.type === "approval-sweep" ? "Approval sweep · 7 chains" : r.type === "solana-address" ? "Solana wallet lookup" : r.type === "solana-delegates" ? "Solana delegate check" : r.type === "solana-token-check" ? "Solana token check" : r.type === "token-deep-scan" ? "Token deep scan · " + esc(CN[r.chain] || r.chain) : r.type === "token-report" ? "Token report · " + esc(CN[r.chain] || r.chain) : "Wallet report · 3 chains"} · ${esc(short(r.address || r.owner))}</span></div>
      <p class=summary>${esc(r.summary)}</p><h3>Findings</h3>${findingsHtml(r.findings)}
      ${r.type === "token-verdict" ? verdictHtml(r) : r.type === "honeypot-check" ? honeypotHtml(r) : r.type === "bsc-bundle-check" ? bundleHtml(r) : r.type === "approval-sweep" ? sweepHtml(r) : r.type === "solana-address" ? solAddrHtml(r) : r.type === "solana-delegates" ? solDelHtml(r) : r.type === "solana-token-check" ? solHtml(r) : r.type === "token-deep-scan" ? deepHtml(r) : r.type === "token-report" ? tokenHtml(r) : walletHtml(r)}
      <p class="muted small">${esc(r.disclaimer || "")}</p>
      ${tx ? `<p class="muted small">Paid: <a href="https://basescan.org/tx/${esc(tx)}" target=_blank rel=noopener>view payment on Basescan</a></p>` : ""}
      <details><summary>Raw JSON</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>
      <p><button type=button class=b2 id=dl>Download JSON</button></p>`;
    $("report").hidden = false; $("report").scrollIntoView({ behavior: "smooth", block: "start" });
    $("dl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" })); a.download = `${r.type}-${r.address || r.owner}.json`; a.click(); };
    if (r.type === "approval-sweep") $("report").querySelectorAll("[data-revoke]").forEach(b => b.addEventListener("click", () => revoke(r, Number(b.dataset.revoke))));
  }

  function mobileLinks() {
    const here = location.host + location.pathname;
    $("mmLink").href = "https://metamask.app.link/dapp/" + here;
    $("cbLink").href = "https://go.cb-w.com/dapp?cb_url=" + encodeURIComponent(location.href);
  }
  document.querySelectorAll("input[name=kind]").forEach(el => el.addEventListener("change", syncKind));
  $("addr").addEventListener("input", reset); $("chain").addEventListener("change", reset);
  $("form").addEventListener("submit", getQuote); $("connectBtn").addEventListener("click", connect); $("payBtn").addEventListener("click", pay);
  const q = new URLSearchParams(location.search);
  if (["sweep", "honeypot", "verdict", "bundles", "token", "deep", "solana", "solwallet", "soldelegates"].includes(q.get("type"))) document.querySelector(`input[value=${q.get("type")}]`).checked = true;
  if (q.get("chain") === "solana" && !SOLW[q.get("type")]) document.querySelector("input[value=solana]").checked = true;
  if (q.get("chain") && CN[q.get("chain")]) $("chain").value = q.get("chain");
  syncKind(); if (q.get("address")) $("addr").value = q.get("address");
  mobileLinks(); updateWalletUi();
})();
