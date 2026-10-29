// Landing page, llms.txt, robots, sitemap, agent card. Pure functions of ROUTES.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function mountLanding(app, { ROUTES, ORIGIN, PAY_TO, health }) {
  const REPO = "https://github.com/povrouyre-wq/automaton-onchain-tools";
  const TITLE = "Automaton Onchain Tools: pay-per-call crypto APIs for AI agents (x402)";
  const DESC = `${ROUTES.length} pay-per-call APIs for AI agents: transaction explainer, token approvals, address inspector, contract risk, wallet portfolio, gas snapshot, ENS resolver, calldata decoder, URL phishing check, a Solana token check (SPL, Token-2022, pump.fun), plus premium wallet and token due-diligence reports and a token deep scan with honeypot buy/sell simulation across Base, Ethereum and BNB Smart Chain, plus Solana token checks, and a live new-token launch feed for Base and Solana/pump.fun with risk flags on every launch ($0.01-$0.02, free delayed version at /free/launches). $0.005-$0.01 per call ($0.25 for premium reports, $1.50 for the deep scan) in USDC via x402. No signup, no API key. MCP server included.`;
  const groups = {}; for (const r of ROUTES) { const m = r.path.match(/^\/v1\/(base|ethereum|bsc)\/(.+)$/); const k = m ? m[2] : r.path; (groups[k] ||= { r, chains: [] }); if (m) groups[k].chains.push(m[1]); }
  const CN = { base: "Base", ethereum: "Ethereum", bsc: "BNB" };
  const cards = Object.values(groups).map(({ r, chains }) => `<div class="card"><div class="ch"><h3>${esc(r.name.replace(/^(Base|Ethereum|BNB Smart Chain) /, ""))}</h3><span class="price">${esc(r.price)}</span></div>
<p>${esc(r.desc.replace(/(Base|Ethereum|BNB Smart Chain) /, ""))}</p><div class="tags">${(chains.length ? chains.map(c => CN[c]) : [r.chainLabel || "Multi-chain"]).map(c => `<span>${esc(c)}</span>`).join("")}</div>
<code class="ep">GET ${esc(chains.length ? r.path.replace(/\/(base|ethereum|bsc)\//, "/{chain}/") : r.path)}?${esc(r.param)}=…</code></div>`).join("");
  const ex = ROUTES[0];
  const ld = { "@context": "https://schema.org", "@type": "WebAPI", name: "Automaton Onchain Tools", description: DESC, url: ORIGIN, documentation: ORIGIN + "/openapi.json", sameAs: [REPO],
    offers: { "@type": "Offer", price: "0.005", priceCurrency: "USD" } };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(TITLE)}</title><meta name="description" content="${esc(DESC)}"><link rel="canonical" href="${ORIGIN}/"><meta name="theme-color" content="#0b0d12">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(TITLE)}"><meta property="og:description" content="${esc(DESC)}"><meta property="og:url" content="${ORIGIN}/">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(TITLE)}"><meta name="twitter:description" content="${esc(DESC)}">
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt"><link rel="service-desc" type="application/json" href="/openapi.json">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--bg:#0b0d12;--pn:#12151d;--ln:#232836;--tx:#e6e8ee;--mu:#9aa3b5;--ac:#4f8cff;--ac2:#7c5cff;--ok:#2ecc8f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--ac);text-decoration:none}a:hover{text-decoration:underline}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.w{max-width:1120px;margin:0 auto;padding:0 24px}nav{display:flex;justify-content:space-between;align-items:center;padding:20px 0}
.logo{font-weight:700;letter-spacing:.3px}.logo b{background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;color:transparent}
nav .l a{color:var(--mu);margin-left:20px;font-size:14px}
.hero{padding:64px 0 40px;text-align:center;background:radial-gradient(600px 260px at 50% 0,rgba(79,140,255,.18),transparent)}
.pill{display:inline-block;border:1px solid var(--ln);border-radius:99px;padding:4px 14px;font-size:13px;color:var(--mu);margin-bottom:18px}
h1{font-size:clamp(32px,5vw,54px);line-height:1.1;margin:0 0 16px}h1 span{background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;color:transparent}
.sub{color:var(--mu);font-size:18px;max-width:720px;margin:0 auto 28px}.btns a{display:inline-block;padding:11px 20px;border-radius:10px;margin:4px;font-weight:600}
.b1{background:var(--ac);color:#fff}.b2{border:1px solid var(--ln);color:var(--tx)}.btns a:hover{text-decoration:none;opacity:.9}
h2{font-size:26px;margin:56px 0 18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px}
.card{background:var(--pn);border:1px solid var(--ln);border-radius:14px;padding:18px;display:flex;flex-direction:column}
.card:hover{border-color:#34405a}.ch{display:flex;justify-content:space-between;align-items:start;gap:8px}.card h3{margin:0;font-size:17px}
.price{background:rgba(46,204,143,.12);color:var(--ok);border-radius:8px;padding:2px 8px;font-size:13px;font-weight:600;white-space:nowrap}
.card p{color:var(--mu);font-size:14px;flex:1;margin:10px 0}.tags span{display:inline-block;font-size:12px;border:1px solid var(--ln);border-radius:6px;padding:1px 7px;margin:0 4px 6px 0;color:var(--mu)}
.ep{color:#b8c4ff;font-size:12px;word-break:break-all}.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
pre{background:#0f1218;border:1px solid var(--ln);border-radius:12px;padding:16px;overflow:auto;margin:0;color:#cfd6e4}.lbl{font-size:13px;color:var(--mu);margin:0 0 8px}
.trust{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.trust div{background:var(--pn);border:1px solid var(--ln);border-radius:14px;padding:18px}
.trust b{display:block;margin-bottom:4px}.trust span{color:var(--mu);font-size:14px}ol{color:var(--mu)}ol b{color:var(--tx)}
footer{border-top:1px solid var(--ln);margin-top:64px;padding:28px 0;color:var(--mu);font-size:14px}footer a{color:var(--mu);margin-right:16px}
@media(max-width:760px){.two{grid-template-columns:1fr}nav .l a{margin-left:12px}}
</style></head><body>
<div class="w"><nav><div class="logo">◆ <b>Automaton</b> Onchain Tools</div><div class="l"><a href="/check">Check a wallet</a><a href="#tools">Tools</a><a href="#start">Quick start</a><a href="/openapi.json">API</a><a href="${REPO}">GitHub</a></div></nav></div>
<header class="hero"><div class="w"><div class="pill">x402 · MCP · USDC on Base</div>
<h1>Onchain intelligence,<br><span>pay-per-call for AI agents</span></h1>
<p class="sub">${ROUTES.length} crypto and security APIs your agent can call instantly. Pay $0.005–$0.01 per call, $0.25 for a full wallet or token report, or $1.50 for a token deep scan (honeypot sim, liquidity, holders), in USDC on Base via x402. New: a live launch feed of new Base and pump.fun tokens with risk flags on each, $0.01–$0.02 per call (<a href="/free/launches">free 15-min-delayed sample</a>). No signup, no API key, no subscription.</p>
<div class="btns"><a class="b1" href="#start">Get started</a><a class="b2" href="/check">Not an agent? Check a wallet or token</a><a class="b2" href="${REPO}">View source</a></div></div></header>
<main class="w">
<h2 id="tools">Tools</h2><div class="grid">${cards}</div>
<h2 id="start">Quick start</h2><div class="two"><div><p class="lbl">HTTP with x402 fetch (Node)</p><pre>npm i @x402/fetch @x402/evm viem

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
registerExactEvmScheme(client, {
  signer: privateKeyToAccount(process.env.PRIVATE_KEY) });
const pay = wrapFetchWithPayment(fetch, client);
const r = await pay("${ORIGIN}${ex.path}?${ex.param}=0x…");
console.log(await r.json());</pre></div>
<div><p class="lbl">MCP client config (streamable HTTP)</p><pre>{
  "mcpServers": {
    "automaton-onchain-tools": {
      "type": "http",
      "url": "${ORIGIN}/mcp"
    }
  }
}</pre><p class="lbl" style="margin-top:16px">Try it: an unpaid call returns 402 with requirements</p><pre>curl -i "${ORIGIN}/v1/gas?chain=all"</pre></div></div>
<h2>How it works</h2><ol><li><b>Call an endpoint.</b> The server answers <code>402 Payment Required</code> with price, asset (USDC), network (Base) and payTo.</li>
<li><b>Your client signs</b> an EIP-3009 USDC authorization. The buyer needs no gas.</li><li><b>Retry with <code>PAYMENT-SIGNATURE</code>.</b> The facilitator settles and you get JSON. Invalid input gets a free <code>400</code> before any charge.</li></ol>
<h2>Why trust it</h2><div class="trust"><div><b>No signup, no API key</b><span>Pay per call with a wallet. Nothing to register.</span></div>
<div><b>Open source</b><span>Read every line on <a href="${REPO}">GitHub</a> (MIT).</span></div><div><b>Free public data</b><span>Public RPCs, openchain, Sourcify, ENS, MetaMask phishing lists, RDAP.</span></div>
<div><b>No trackers</b><span>No cookies or analytics on this page. Payments go to <code>${esc(PAY_TO.slice(0, 8))}…${esc(PAY_TO.slice(-4))}</code>.</span></div></div>
</main>
<footer><div class="w"><a href="${REPO}">GitHub</a><a href="/openapi.json">OpenAPI</a><a href="/llms.txt">llms.txt</a><a href="/.well-known/x402">x402 discovery</a><a href="/health">Health</a>
<p>Risk and safety outputs are heuristics, not audits, security advice or financial advice. Operated by an autonomous agent ("Automaton").</p></div></footer>
</body></html>`;
  const llms = `# Automaton Onchain Tools\n\n> ${DESC}\n\nPayment: x402 v2, exact scheme, USDC on Base (eip155:8453), payTo ${PAY_TO}. Request without payment returns 402 with requirements; retry with PAYMENT-SIGNATURE header. Invalid input returns 400 free.\n\n## Docs\n- [OpenAPI](${ORIGIN}/openapi.json)\n- [x402 discovery](${ORIGIN}/.well-known/x402)\n- [Health/endpoint list JSON](${ORIGIN}/health)\n- MCP (streamable HTTP, POST): ${ORIGIN}/mcp\n\n## Endpoints\n${ROUTES.map(r => `- GET ${ORIGIN}${r.path}?${r.param}=<${r.param}>${r.extra ? `&${r.extra.name}=<${r.extra.name}>` : ""} (${r.price}): ${r.desc}`).join("\n")}\n`;
  const card = { name: "Automaton Onchain Tools", description: DESC, url: ORIGIN, version: "1.3.0", documentationUrl: REPO, provider: { organization: "Automaton", url: ORIGIN },
    capabilities: {}, defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"],
    skills: ROUTES.map(r => ({ id: r.key, name: r.name, description: `${r.desc} Price ${r.price} via x402.`, tags: ["x402", "crypto", r.param === "url" ? "security" : "onchain"] })),
    "x-x402": { network: "eip155:8453", asset: "USDC", payTo: PAY_TO, openapi: ORIGIN + "/openapi.json" }, "x-mcp": ORIGIN + "/mcp" };
  app.get("/", (req, res, next) => req.accepts(["json", "html"]) === "html" ? res.type("html").send(html) : health(req, res, next));
  app.get("/llms.txt", (_, res) => res.type("text/plain").send(llms));
  app.get("/robots.txt", (_, res) => res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`));
  app.get("/sitemap.xml", (_, res) => res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/check", "/llms.txt", "/openapi.json"].map(p => `<url><loc>${ORIGIN}${p}</loc></url>`).join("")}</urlset>`));
  app.get("/.well-known/agent-card.json", (_, res) => res.json(card));
  app.get("/.well-known/agent.json", (_, res) => res.json(card));
}
