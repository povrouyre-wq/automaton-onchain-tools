// /check page logic. Plain browser JS, no framework. The x402 signing code (official @x402 packages + viem)
// is lazy-loaded from /check/pay.js only when the user clicks Pay.
(() => {
  const $ = id => document.getElementById(id);
  const ADDR = /^0x[0-9a-fA-F]{40}$/;
  const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const CN = { base: "Base", ethereum: "Ethereum", bsc: "BNB Chain" };
  const EXPLORER = { base: "https://basescan.org", ethereum: "https://etherscan.io", bsc: "https://bscscan.com" };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const short = a => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
  const fmtUsdc = atomic => (Number(atomic) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const b64json = s => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))));
  let state = { pr: null, url: null, kind: null, chain: null, account: null };

  function eth() { return window.ethereum || null; }
  function setStatus(html, cls = "") { const s = $("status"); s.className = "status " + cls; s.innerHTML = html; s.hidden = !html; }
  function syncKind() { const k = document.querySelector("input[name=kind]:checked").value; $("chainRow").hidden = k !== "token";
    $("addrLabel").textContent = k === "token" ? "Token contract address" : "Wallet address";
    $("addr").placeholder = k === "token" ? "0x… token contract" : "0x… wallet"; reset(); }
  function reset() { state.pr = null; $("payBox").hidden = true; $("report").hidden = true; setStatus(""); }

  function buildUrl() {
    const kind = document.querySelector("input[name=kind]:checked").value, a = $("addr").value.trim(), chain = $("chain").value;
    if (!ADDR.test(a)) return { err: "That doesn't look like an address. It should start with 0x followed by 40 hex characters. ENS names aren't supported here." };
    const u = kind === "token" ? `/v1/token-report?address=${a}&chain=${chain}` : `/v1/wallet-report?address=${a}`;
    return { url: u, kind, chain: kind === "token" ? chain : null, addr: a };
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
      $("qWhat").textContent = b.kind === "token" ? `Token due-diligence report for ${short(b.addr)} on ${CN[b.chain]}` : `Wallet security report for ${short(b.addr)} across Base, Ethereum and BNB Chain`;
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
  function render(r, tx) {
    const lvl = String(r.riskLevel || "n/a").toLowerCase();
    $("report").innerHTML = `<div class=rhead><span class="risk ${esc(lvl)}">Risk: ${esc(lvl)}</span>
      <span class=muted>${r.type === "token-report" ? "Token report · " + esc(CN[r.chain] || r.chain) : "Wallet report · 3 chains"} · ${esc(short(r.address))}</span></div>
      <p class=summary>${esc(r.summary)}</p><h3>Findings</h3>${findingsHtml(r.findings)}
      ${r.type === "token-report" ? tokenHtml(r) : walletHtml(r)}
      <p class="muted small">${esc(r.disclaimer || "")}</p>
      ${tx ? `<p class="muted small">Paid: <a href="https://basescan.org/tx/${esc(tx)}" target=_blank rel=noopener>view payment on Basescan</a></p>` : ""}
      <details><summary>Raw JSON</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>
      <p><button type=button class=b2 id=dl>Download JSON</button></p>`;
    $("report").hidden = false; $("report").scrollIntoView({ behavior: "smooth", block: "start" });
    $("dl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" })); a.download = `${r.type}-${r.address}.json`; a.click(); };
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
  if (q.get("type") === "token") document.querySelector("input[value=token]").checked = true;
  if (q.get("chain") && CN[q.get("chain")]) $("chain").value = q.get("chain");
  syncKind(); if (q.get("address")) $("addr").value = q.get("address");
  mobileLinks(); updateWalletUi();
})();
