// Human-facing /check page: buy the $0.25 wallet or token report with a browser wallet (x402, USDC on Base).
// Same paid endpoints agents use; the page just builds the x402 payment in the browser. Sources in check-src/.
import { APP_JS, PAY_JS, PAY_VER } from "./check-assets.js";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function mountCheck(app, { ORIGIN, PAY_TO, PRICE }) {
  const REPO = "https://github.com/povrouyre-wq/automaton-onchain-tools";
  const TITLE = "Check a wallet or token before you trust it | Automaton";
  const DESC = `Pay-per-report crypto safety check. Paste a wallet or token address, pay ${PRICE} in USDC on Base with your own wallet, and get a plain-English risk report. No signup.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(TITLE)}</title><meta name="description" content="${esc(DESC)}"><link rel="canonical" href="${ORIGIN}/check"><meta name="theme-color" content="#0b0d12">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(TITLE)}"><meta property="og:description" content="${esc(DESC)}"><meta property="og:url" content="${ORIGIN}/check">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(TITLE)}"><meta name="twitter:description" content="${esc(DESC)}">
<style>
:root{--bg:#0b0d12;--pn:#12151d;--ln:#232836;--tx:#e6e8ee;--mu:#9aa3b5;--ac:#4f8cff;--ac2:#7c5cff;--ok:#2ecc8f;--warn:#f0b429;--bad:#ff5d5d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--ac);text-decoration:none}a:hover{text-decoration:underline}.w{max-width:760px;margin:0 auto;padding:0 18px}
nav{display:flex;justify-content:space-between;align-items:center;padding:18px 0}.logo{font-weight:700}.logo b{background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;color:transparent}
nav a{color:var(--mu);font-size:14px;margin-left:14px}
h1{font-size:clamp(28px,6vw,42px);line-height:1.15;margin:18px 0 10px}h1 span{background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;color:transparent}
.sub{color:var(--mu);margin:0 0 22px}.panel{background:var(--pn);border:1px solid var(--ln);border-radius:14px;padding:18px;margin:0 0 16px}
label{display:block;font-size:14px;color:var(--mu);margin:0 0 6px}.kinds{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 14px}
.kinds label{margin:0;border:1px solid var(--ln);border-radius:10px;padding:12px;cursor:pointer;color:var(--tx)}.kinds input{margin-right:6px}
.kinds label:has(input:checked){border-color:var(--ac);background:rgba(79,140,255,.08)}.kinds small{display:block;color:var(--mu);font-size:13px;margin-top:2px}
input[type=text],select{width:100%;background:#0f1218;color:var(--tx);border:1px solid var(--ln);border-radius:10px;padding:12px;font:15px ui-monospace,Menlo,monospace}
.row{margin:0 0 14px}button{font:inherit;font-weight:600;border-radius:10px;padding:12px 18px;cursor:pointer;border:0}
.b1{background:var(--ac);color:#fff;width:100%}.b1:disabled{opacity:.6;cursor:wait}.b2{background:transparent;border:1px solid var(--ln);color:var(--tx)}
.price{font-size:28px;font-weight:700;color:var(--ok)}.muted{color:var(--mu)}.small{font-size:13px}
.status{border-radius:10px;padding:12px;margin:0 0 16px;background:#0f1218;border:1px solid var(--ln);font-size:15px}.status.err{border-color:var(--bad)}.status.warn{border-color:var(--warn)}.status.ok{border-color:var(--ok)}
.facts{list-style:none;padding:0;margin:0;display:grid;gap:8px}.facts li:before{content:"✓ ";color:var(--ok)}
.addr{word-break:break-all;font:13px ui-monospace,Menlo,monospace}
table{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 8px}td,th{border-bottom:1px solid var(--ln);padding:8px 6px;text-align:left;vertical-align:top}th{color:var(--mu);font-weight:500}
.rhead{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.risk{font-weight:700;border-radius:8px;padding:4px 10px;text-transform:capitalize}
.risk.low{background:rgba(46,204,143,.15);color:var(--ok)}.risk.medium{background:rgba(240,180,41,.15);color:var(--warn)}.risk.high{background:rgba(255,93,93,.15);color:var(--bad)}.risk.n\\/a{background:#1b2030}
.summary{font-size:17px}.summary,.finds,td,#qWhat{overflow-wrap:anywhere}.finds{padding-left:0;list-style:none}.finds li{margin:0 0 8px}.sev{display:inline-block;font-size:12px;border-radius:6px;padding:1px 7px;margin-right:6px;text-transform:uppercase;background:#1b2030;color:var(--mu)}
.sev.high{color:var(--bad)}.sev.medium{color:var(--warn)}.sev.low{color:var(--ok)}.bad{color:var(--bad)}h3{font-size:16px;margin:20px 0 8px}
pre{background:#0f1218;border:1px solid var(--ln);border-radius:10px;padding:12px;overflow:auto;font-size:12px;max-height:420px}
footer{border-top:1px solid var(--ln);margin-top:40px;padding:22px 0;color:var(--mu);font-size:13px}footer a{color:var(--mu);margin-right:14px}
@media(max-width:520px){.kinds{grid-template-columns:1fr}}
</style></head><body><div class="w">
<nav><a class="logo" href="/" style="color:var(--tx)">◆ <b>Automaton</b> Check</a><div><a href="/">For developers</a><a href="${REPO}">Source</a></div></nav>
<h1>Check a wallet or token<br><span>before you trust it</span></h1>
<p class="sub">Paste an address, pay <b>${esc(PRICE)} in USDC on Base</b> from your own wallet, and get a plain-English risk report. Pay per report. No signup, no account, no subscription.</p>

<form id="form" class="panel" novalidate>
<div class="kinds">
<label><input type="radio" name="kind" value="wallet" checked>Wallet check<small>Balances, risky token approvals and wallet type on Base, Ethereum and BNB Chain in one report.</small></label>
<label><input type="radio" name="kind" value="token">Token check<small>Upgradeability, owner powers, mint/pause/blacklist flags, source verification, owner holdings.</small></label>
</div>
<div class="row" id="chainRow" hidden><label for="chain">Chain the token is on</label><select id="chain"><option value="base">Base</option><option value="ethereum">Ethereum</option><option value="bsc">BNB Chain</option></select></div>
<div class="row"><label for="addr" id="addrLabel">Wallet address</label><input id="addr" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="0x…"></div>
<button class="b1" type="submit">See price &amp; continue</button>
<p class="muted small" style="margin:10px 0 0">Checking the price is free. Invalid addresses are rejected before any payment.</p>
</form>

<div id="status" class="status" hidden></div>

<div id="payBox" class="panel" hidden>
<div class="muted small">You're buying</div><div id="qWhat" style="margin:2px 0 10px"></div>
<div class="price" id="qPrice"></div><div class="muted small">in USDC on Base, paid to <a id="qPayTo" class="addr" target="_blank" rel="noopener"></a></div>
<p class="small muted">Your wallet will ask you to sign one USDC transfer authorization for exactly this amount. No ETH is needed for gas. The payment is only settled if the report is delivered.</p>
<div id="noWallet" hidden><p><b>No browser wallet detected.</b> On desktop, install MetaMask or Coinbase Wallet. On a phone, open this page inside your wallet app's browser:</p>
<p><a class="b2" style="display:inline-block;padding:10px 14px;border-radius:10px;margin:0 8px 8px 0" id="mmLink">Open in MetaMask</a><a class="b2" style="display:inline-block;padding:10px 14px;border-radius:10px" id="cbLink">Open in Coinbase Wallet</a></p></div>
<button class="b1" type="button" id="connectBtn" hidden>Connect wallet</button>
<button class="b1" type="button" id="payBtn" hidden>Pay ${esc(PRICE)} USDC &amp; get report</button>
<p id="acct" class="muted small" style="margin:8px 0 0"></p>
</div>

<div id="report" class="panel" hidden></div>

<div class="panel"><h3 style="margin-top:0">How it works</h3><ul class="facts">
<li>You need <b>at least ${esc(PRICE)} USDC on Base</b> in a browser wallet (MetaMask, Coinbase Wallet, Rabby…).</li>
<li>Payments use the open <a href="https://www.x402.org" target="_blank" rel="noopener">x402</a> standard: you sign a one-time USDC transfer, not an unlimited approval.</li>
<li>Reports are built live from free public onchain data (public RPCs, Sourcify, openchain).</li>
<li>Open source: every line is on <a href="${REPO}">GitHub</a>. No cookies, no analytics.</li>
</ul>
<p class="muted small">Reports are automated heuristics, not audits, and not financial or security advice. Balances cover native coins plus major tokens only, with no USD prices. Top-holder lists aren't included. Built and run by Automaton, an AI agent, under human oversight.</p></div>

<footer><a href="/">Home</a><a href="/openapi.json">API</a><a href="${REPO}">GitHub</a><a href="/health">Status</a></footer>
</div><script src="/check/app.js?v=${PAY_VER}" defer></script></body></html>`;
  app.get("/check", (_, res) => res.set("Cache-Control", "public, max-age=300").type("html").send(html));
  app.get("/check/app.js", (_, res) => res.set("Cache-Control", "public, max-age=300").type("application/javascript").send(APP_JS));
  app.get("/check/pay.js", (_, res) => res.set("Cache-Control", "public, max-age=86400").type("application/javascript").send(PAY_JS));
}
