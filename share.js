// Share cards for every token verdict (base / ethereum / bsc / solana): a quotable one-line take, a public page and a
// 1200x630 PNG. Everything is templated from the verdict's own flags. No LLM, no storage: the card data rides in the URL,
// deflated and HMAC-signed, so nobody can mint a fake "SAFE" card under our name. Key: SHARE_SECRET, else CRON_SECRET.
// Without a key, verdicts still return a take but no share links.
import { createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";

const CHAIN_NAME = { base: "Base", ethereum: "Ethereum", bsc: "BNB Chain", solana: "Solana" };
const EXPLORER = { base: "https://basescan.org/token/", ethereum: "https://etherscan.io/token/", bsc: "https://bscscan.com/token/", solana: "https://solscan.io/token/" };
const COLOR = { SAFE: "#22c55e", CAUTION: "#f59e0b", AVOID: "#ef4444" };
const b64u = b => Buffer.from(b).toString("base64url");
const r2 = n => Math.round(Number(n) * 100) / 100;
const usd = n => "$" + Math.round(n).toLocaleString("en-US");
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const shortAddr = a => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const shareKey = () => process.env.SHARE_SECRET || process.env.CRON_SECRET || null;
const ticker = v => { const s = v.token?.symbol || v.token?.name; return s ? (/^\$/.test(s) ? s : "$" + clip(s, 16)) : shortAddr(v.address); };

// One quotable line, picked by the same priority the verdict rules use. Deterministic: same flags -> same line.
export function oneLineTake(v) {
  const f = v.flags || {}, T = ticker(v), sol = v.chain === "solana", tax = r2(Number(f.buyTaxPct || 0) + Number(f.sellTaxPct || 0));
  if (v.verdict === "AVOID") {
    if (f.copycatName) return `${T} is wearing a famous name at the wrong address. Copycat.`;
    if (!sol && f.sellable === false) return `${T}: the buy button works, the sell button doesn't. Roach motel.`;
    if (sol && (f.nonTransferable || f.paused || f.defaultFrozen)) return `${T}: transfers are locked. You can't sell what can't move.`;
    if (sol && f.permanentDelegate) return `${T}: someone holds a key that can pull tokens out of any wallet, yours included.`;
    if (!sol && tax >= 10) return `${T}: ${tax}% round-trip tax. The chart isn't the only thing eating your bag.`;
    if (sol && Number(f.transferFeePct) >= 5) return `${T}: ${r2(f.transferFeePct)}% skimmed on every transfer. The house always wins.`;
    if (sol && f.mintAuthorityActive) return `${T}: the mint is still open. Your share of supply is a suggestion.`;
    if (sol && f.freezeAuthorityActive) return `${T}: someone can freeze your tokens whenever they like.`;
    if (!sol && f.ownerRenounced === false && f.canMint) return `${T}: the owner can still print more. Your share of supply is a suggestion.`;
    if (!sol && f.ownerRenounced === false && f.canBlacklist) return `${T}: the owner can blacklist your wallet and leave you holding.`;
    if (f.top10HolderPct >= 50) return `${T}: top 10 wallets hold ${r2(f.top10HolderPct)}%. You'd be the exit liquidity.`;
    if (sol && f.transferHook) return `${T}: custom code runs on every transfer, and it can still be changed. That's a sell switch.`;
    return `${T}: too many red flags to call it anything but AVOID.`;
  }
  if (v.verdict === "CAUTION") {
    if (sol && f.officialIssuerMint) return `${T}: the real one, but the issuer holds the keys. Fine for a stablecoin, not for a meme.`;
    if (!sol && tax >= 3) return `${T}: ${tax}% round-trip tax. Priced in?`;
    if (!sol && f.isProxy) return `${T}: upgradeable contract. Today's code might not be tomorrow's.`;
    if (f.top10HolderPct >= 20) return `${T}: top 10 wallets hold ${r2(f.top10HolderPct)}%. Watch the whales.`;
    if (sol && f.liquidityUsd != null && f.liquidityUsd < 10000) return `${T}: about ${usd(f.liquidityUsd)} of liquidity. One big seller and it's a ghost town.`;
    if (sol && f.metadataMutable) return `${T}: no smoking gun, but the name and logo can still be swapped overnight.`;
    if (f.lpBurnedOrLockedPct == null) return `${T}: no obvious traps, but nobody can prove the liquidity is locked.`;
    if (f.lpBurnedOrLockedPct < 50) return `${T}: only ${r2(f.lpBurnedOrLockedPct)}% of LP is burned or locked. The rest can walk.`;
    return `${T}: not a rug on paper, not spotless either. Size accordingly.`;
  }
  if (sol && f.pumpfun === "on-curve") return `${T}: mint and freeze revoked, metadata locked, still on the bonding curve. Clean on paper, early as it gets.`;
  return sol ? `${T}: mint and freeze revoked, metadata locked, LP burned. Clean on paper. Still not an audit.`
    : `${T}: sellable, low tax, no live admin traps found. Clean on paper. Still not an audit.`;
}

// Compact card payload: only what the card and page show.
function cardData(v) {
  const rank = { high: 0, medium: 1, low: 2, info: 3 };
  const notes = [...(v.findings || [])].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)).slice(0, 3).map(x => [x.severity, clip(x.note, 150)]);
  return { v: 1, c: v.chain, a: v.address, s: clip(v.token?.symbol || "", 24), n: clip(v.token?.name || "", 48), V: v.verdict, r: v.riskLevel, t: v.take, f: notes, ts: Math.floor(Date.now() / 1000) };
}
const sign = (key, body) => b64u(createHmac("sha256", key).update(body).digest().subarray(0, 12));

export function makeShareId(v, key = shareKey()) {
  if (!key) return null;
  const body = b64u(deflateRawSync(Buffer.from(JSON.stringify(cardData(v))), { level: 9 }));
  return `${body}.${sign(key, body)}`;
}
export function readShareId(id, key = shareKey()) {
  if (!key || typeof id !== "string" || id.length > 4000) return null;
  const m = id.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{16})$/); if (!m) return null;
  const want = Buffer.from(sign(key, m[1])), got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try { const d = JSON.parse(inflateRawSync(Buffer.from(m[1], "base64url"), { maxOutputLength: 8192 }).toString("utf8")); return d && d.v === 1 && COLOR[d.V] ? d : null; } catch { return null; }
}

// Adds take + share links to a verdict response. Mutates and returns it.
export function withShare(v, origin) {
  v.take = oneLineTake(v);
  const id = makeShareId(v);
  v.share = id ? { url: `${origin}/v/${id}`, image: `${origin}/v/${id}.png`, text: `${v.take} ${origin}/v/${id}` } : null;
  return v;
}

// ---- public page ----
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function sharePageHtml(d, id, origin) {
  const N = CHAIN_NAME[d.c] || d.c, label = d.s ? `${d.s}${d.n && d.n !== d.s ? ` (${d.n})` : ""}` : shortAddr(d.a);
  const title = `${d.V}: ${label} on ${N} · Automaton token verdict`, img = `${origin}/v/${id}.png`, url = `${origin}/v/${id}`;
  const when = new Date(d.ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(d.t)}"><meta name="robots" content="noindex">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(d.t)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(d.t)}"><meta name="twitter:image" content="${esc(img)}">
<style>body{margin:0;background:#0b0f17;color:#e6e9ef;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}main{max-width:760px;margin:0 auto;padding:32px 20px}
img{width:100%;height:auto;border-radius:14px;border:1px solid #1f2633}h1{font-size:22px;margin:22px 0 6px}.v{color:${COLOR[d.V]}}.mu{color:#8b93a7}a{color:#7aa7ff}
code{background:#151b26;padding:2px 6px;border-radius:6px;word-break:break-all}ul{padding-left:20px}.cta{display:inline-block;margin:10px 10px 0 0;padding:10px 16px;border-radius:10px;background:#1f6feb;color:#fff;text-decoration:none}</style></head>
<body><main><img src="${esc(img)}" alt="${esc(title)}" width="1200" height="630">
<h1><span class="v">${esc(d.V)}</span> · ${esc(label)} on ${esc(N)}</h1><p>“${esc(d.t)}”</p>
<ul>${(d.f || []).map(([s, n]) => `<li><span class="mu">${esc(s)}:</span> ${esc(n)}</li>`).join("")}</ul>
<p class="mu">Token <code>${esc(d.a)}</code> · <a href="${esc((EXPLORER[d.c] || "") + d.a)}" rel="noopener" target="_blank">explorer</a> · checked ${esc(when)}</p>
<p><a class="cta" href="${esc(origin)}/check">Check another token</a><a class="cta" href="${esc(origin)}/openapi.json">API ($0.02 per verdict via x402)</a></p>
<p class="mu" style="font-size:13px">Automated verdict from public onchain data by Automaton, an autonomous agent. Results can change after this snapshot. SAFE is not an audit. Not financial or security advice.</p>
</main></body></html>`;
}

// ---- PNG card ----
let fonts = null;
const loadFonts = () => fonts ||= [
  { name: "Noto Sans", data: readFileSync(new URL("./assets/noto-sans-400.ttf", import.meta.url)), weight: 400, style: "normal" },
  { name: "Noto Sans", data: readFileSync(new URL("./assets/noto-sans-800.ttf", import.meta.url)), weight: 800, style: "normal" }];
const el = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat().filter(c => c != null && c !== false) } });

export function cardTree(d) {
  const N = CHAIN_NAME[d.c] || d.c, col = COLOR[d.V], label = d.s || shortAddr(d.a);
  const when = new Date(d.ts * 1000).toISOString().slice(0, 10);
  const sev = { high: "#ef4444", medium: "#f59e0b", low: "#8b93a7", info: "#8b93a7" };
  return el("div", { width: "100%", height: "100%", flexDirection: "column", background: "#0b0f17", color: "#e6e9ef", fontFamily: "Noto Sans", padding: "48px 60px", borderTop: `14px solid ${col}` },
    el("div", { justifyContent: "space-between", alignItems: "center", fontSize: 26, color: "#8b93a7" },
      el("div", { letterSpacing: 3, fontWeight: 800 }, "AUTOMATON · TOKEN VERDICT"),
      el("div", { border: "2px solid #2a3344", borderRadius: 999, padding: "4px 18px", color: "#c9d1e0" }, N)),
    el("div", { alignItems: "baseline", marginTop: 26 },
      el("div", { fontSize: 120, fontWeight: 800, color: col, lineHeight: 1 }, d.V),
      el("div", { flexDirection: "column", marginLeft: 36, maxWidth: 640 },
        el("div", { fontSize: 50, fontWeight: 800, lineHeight: 1.1 }, clip(label, 18)),
        el("div", { fontSize: 24, color: "#8b93a7", marginTop: 6 }, clip(`${d.n && d.n !== d.s ? d.n + " · " : ""}${shortAddr(d.a)}`, 48)))),
    el("div", { fontSize: 36, lineHeight: 1.3, marginTop: 30, color: "#f1f4f9" }, `“${clip(d.t, 130)}”`),
    el("div", { flexDirection: "column", marginTop: 22, fontSize: 23, color: "#c9d1e0" },
      (d.f || []).filter(([s]) => s !== "info").slice(0, 2).map(([s, n]) => el("div", { alignItems: "center", marginTop: 6 },
        el("div", { width: 14, height: 14, borderRadius: 7, background: sev[s] || "#8b93a7", marginRight: 14 }), clip(n, 88)))),
    el("div", { marginTop: "auto", justifyContent: "space-between", fontSize: 21, color: "#6b7385" },
      el("div", {}, `automaton-tx-explainer.vercel.app · $0.02 per verdict (x402)`),
      el("div", {}, `${when} · automated, not advice`)));
}
export async function cardPng(d) {
  const { ImageResponse } = await import("@vercel/og");
  const r = new ImageResponse(cardTree(d), { width: 1200, height: 630, fonts: loadFonts() });
  return Buffer.from(await r.arrayBuffer());
}

export function mountShare(app, { ORIGIN }) {
  app.get("/v/:id", async (req, res) => {
    const raw = String(req.params.id || ""), png = raw.endsWith(".png"), id = png ? raw.slice(0, -4) : raw;
    const d = readShareId(id);
    if (!d) return res.status(404).type(png ? "text/plain" : "text/html").send(png ? "unknown or tampered card" : "<!doctype html><p>Unknown or tampered verdict card.</p>");
    res.set("cache-control", "public, max-age=86400, s-maxage=31536000, immutable");
    if (!png) return res.type("text/html").send(sharePageHtml(d, id, ORIGIN));
    try { res.type("image/png").send(await cardPng(d)); }
    catch (e) { res.set("cache-control", "no-store").status(500).type("text/plain").send("card render failed"); }
  });
}
