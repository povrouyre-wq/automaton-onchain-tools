// Automaton onchain + URL tools, sold per call via x402 (USDC on Base). Free public data only.
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { BUILDER_CODE, declareBuilderCodeExtension, builderCodeResourceServerExtension } from "@x402/extensions/builder-code";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPaymentWrapper } from "@x402/mcp";
import { z } from "zod";
import { mountLanding } from "./landing.js";
import { walletReport, tokenReport } from "./reports.js";
import { CHAINS, explain, approvals, inspect, contractRisk, urlSafety, gasSnapshot, ensResolve, decodeCalldata, portfolio } from "./lib.js";
export { explain, approvals, inspect, contractRisk, urlSafety, gasSnapshot, ensResolve, decodeCalldata, portfolio };

const PAY_TO = process.env.PAY_TO || "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717";
const NETWORK = process.env.X402_NETWORK || "eip155:84532"; // Base Sepolia testnet by default
const FACILITATOR = process.env.FACILITATOR_URL || "https://x402.org/facilitator";
// Base Builder Code (ERC-8021): declared as app code `a` in every 402; the facilitator appends it to settlement calldata.
const BUILDER = process.env.BUILDER_CODE || "bc_a1qq0mzd";
const builderExt = { [BUILDER_CODE]: declareBuilderCodeExtension(BUILDER) };
const facCfg = FACILITATOR === "cdp" ? createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET) : { url: FACILITATOR };
const PRICE = process.env.PRICE || "$0.01";
const PRICE_SMALL = process.env.PRICE_SMALL || "$0.005";
const ORIGIN = process.env.PUBLIC_ORIGIN || "https://automaton-tx-explainer.vercel.app";
const HASH = /^0x[0-9a-fA-F]{64}$/, ADDR = /^0x[0-9a-fA-F]{40}$/, URLRE = /^.{4,2048}$/;
const HP = "^0x[0-9a-fA-F]{64}$", AP = "^0x[0-9a-fA-F]{40}$";
const EX = { base: { tx: "0x45be0cb297d8e90038b2113ea608e7a80d84c5e8d9e9b649a2d1f027e9243d6e", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", wallet: "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717" },
  ethereum: { tx: "0xe85c8cd1d3f529cd7808ecdadad807f12f50aeff249784ed73e9d1f4f6bc2f2f", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", wallet: "0x28C6c06298d514Db089934071355E5743bf21d60" },
  bsc: { tx: "0xa98a72c04fb6ae896f69aa5d4488bda5e9efc34ed9b69e51cfc5b6c09100fac2", token: "0x55d398326f99059fF775485246999027B3197955", wallet: "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717" } };

// Route table: one fixed resource URL per endpoint.
// Advertised patterns must be RE2-compatible (CDP Bazaar): no {m,n} repeat counts > 1000; use maxLength instead.
const ROUTES = [];
for (const [c, C] of Object.entries(CHAINS)) {
  const N = C.name, legacy = c === "base"; // keep original Base tool names
  ROUTES.push(
    { key: `${c}_tx_explain`, path: `/v1/${c}/tx`, param: "hash", re: HASH, pattern: HP, price: PRICE, fn: v => explain(c, v), name: `${N} Tx Explainer`, pdesc: `${N} transaction hash`, example: EX[c].tx,
      desc: `Explain a ${N} transaction: status, fee, decoded method + args (openchain signature DB), and ERC-20 transfers with symbols and human amounts.`,
      out: { chain: c, status: "success", method: "transfer(address,uint256)", fee: "0.00000027", tokenTransfers: [{ symbol: "USDC", amount: "1.028272", from: "0x...", to: "0x..." }], summary: "success · transfer · 1 token transfer(s)" } },
    { key: `${c}_token_approvals`, path: `/v1/${c}/approvals`, param: "address", re: ADDR, pattern: AP, price: PRICE_SMALL, fn: v => approvals(c, v), name: `${N} Token Approval Check`, pdesc: `${N} wallet address (owner)`, example: EX[c].wallet,
      desc: `Check a ${N} wallet's ERC-20 approvals: allowances for ${Object.keys(C.tokens).length} major tokens (${Object.keys(C.tokens).slice(0, 4).join(", ")}...) to common spenders (${Object.keys(C.spenders).slice(0, 4).join(", ")}...); flags unlimited approvals.`,
      out: { owner: "0x...", checkedPairs: 64, nonZeroApprovals: [{ token: "USDC", spender: "Permit2", unlimited: true, allowance: "unlimited" }], unlimitedCount: 1 } },
    { key: `${c}_address_inspect`, path: `/v1/${c}/address`, param: "address", re: ADDR, pattern: AP, price: PRICE_SMALL, fn: v => inspect(c, v), name: `${N} Address Inspector`, pdesc: `${N} address (EOA or contract)`, example: EX[c].token,
      desc: `Inspect any ${N} address: EOA vs contract vs EIP-7702 delegated, ${C.native} balance, nonce, proxy implementation (EIP-1967/1167/zos), and ERC-20 name/symbol/decimals/supply.`,
      out: { type: "contract", nativeBalance: "0", proxy: { standard: "EIP-1967", implementation: "0x..." }, erc20: { name: "USD Coin", symbol: "USDC", decimals: 6 }, summary: "contract (EIP-1967 proxy) · ERC-20 USDC" } },
    { key: `${c}_contract_risk`, path: `/v1/${c}/contract-risk`, param: "address", re: ADDR, pattern: AP, price: PRICE, fn: v => contractRisk(c, v), name: `${N} Contract Risk Heuristics`, pdesc: `${N} contract address`, example: EX[c].token,
      desc: `Heuristic risk flags for a ${N} contract from free public data: Sourcify verification, upgradeable proxy + admin, owner type, mint/pause/blacklist/fee selectors, bytecode size. Not an audit or financial advice.`,
      out: { riskLevel: "medium", heuristicScore: 5, sourcify: { contract: { verified: true } }, proxy: { standard: "EIP-1967" }, ownerType: "eoa", capabilities: { mint: ["mint(address,uint256)"] }, findings: [{ severity: "medium", note: "Mint function present" }], disclaimer: "..." } });
}
ROUTES.push({ key: "url_safety_check", path: "/v1/url-safety", param: "url", re: URLRE, pattern: "^.{4,}$", maxLen: 2048, price: PRICE_SMALL, fn: async v => { const r = await urlSafety(v); if (!r) throw Object.assign(new Error("invalid http(s) URL"), { status: 400 }); return r; },
  name: "URL Safety Check", pdesc: "http(s) URL or hostname", example: "https://example.com/login",
  desc: "Check a URL for phishing/scam signals: MetaMask eth-phishing-detect + Phishing.Database blocklists, RDAP domain age, punycode and brand-lookalike detection, HTTPS reachability. Heuristic; not security advice.",
  out: { host: "example.com", verdict: "no known issues", score: 0, signals: [], blocklists: { metamask: false, phishingDatabase: false }, domainAge: { ageDays: 11000 } } });

ROUTES.push(
  { key: "gas_snapshot", path: "/v1/gas", param: "chain", re: /^(all|base|ethereum|bsc)$/, pattern: "^(all|base|ethereum|bsc)$", price: PRICE_SMALL, fn: v => gasSnapshot(v), name: "Multi-chain Gas Snapshot", pdesc: "all | base | ethereum | bsc", example: "all", tag: "gas",
    desc: "Live gas snapshot for Base, Ethereum and BNB Smart Chain: gas price, base fee, block utilization, and estimated native cost of a transfer, ERC-20 transfer and swap.",
    out: { chains: [{ chain: "base", gasPriceGwei: "0.005", baseFeeGwei: "0.004", estNativeCost: { transfer21k: "0.000000105" } }] } },
  { key: "ens_resolve", path: "/v1/ens", param: "name", re: /^(0x[0-9a-fA-F]{40}|[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,})$/, pattern: "^(0x[0-9a-fA-F]{40}|[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})$", price: PRICE_SMALL, fn: v => ensResolve(v), name: "ENS / Basename Resolver", pdesc: "ENS or Basename (vitalik.eth, jesse.base.eth) or 0x address for reverse lookup", example: "vitalik.eth", tag: "ens",
    desc: "Resolve an ENS name or Basename to an address (plus url/twitter/github text records), or reverse-resolve an address to its primary name.",
    out: { name: "vitalik.eth", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", textRecords: { url: "https://vitalik.ca" } } },
  { key: "calldata_decode", path: "/v1/decode", param: "data", re: /^0x[0-9a-fA-F]{8}([0-9a-fA-F]{2}){0,4000}$/, pattern: "^0x[0-9a-fA-F]{8,}$", maxLen: 8010, price: PRICE_SMALL, fn: v => decodeCalldata(v), name: "Calldata Decoder + Signing Warnings", pdesc: "hex calldata (0x + selector + args)", example: "0x095ea7b3000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", tag: "decode",
    desc: "Decode EVM calldata before signing: function signature candidates (openchain DB), decoded args, and plain-English warnings for approve/setApprovalForAll/permit/unlimited amounts.",
    out: { selector: "0x095ea7b3", bestMatch: { signature: "approve(address,uint256)", args: ["0x...", "115792..."] }, warnings: ["Unlimited approval amount"] } },
  { key: "wallet_portfolio", path: "/v1/portfolio", param: "address", re: ADDR, pattern: AP, price: PRICE, fn: v => portfolio(v), name: "Multi-chain Wallet Portfolio", pdesc: "EVM wallet address", example: EX.ethereum.wallet, tag: "portfolio",
    desc: "Wallet snapshot across Base, Ethereum and BNB Smart Chain: native balance plus balances of 8 major tokens per chain (USDC, USDT, WETH, DAI, WBTC/cbBTC...). No USD pricing.",
    out: { chains: [{ chain: "base", native: { symbol: "ETH", balance: "0.01" }, tokens: [{ symbol: "USDC", balance: "12.5" }] }] } });

const PRICE_PREMIUM = process.env.PRICE_PREMIUM || "$0.25";
const CHAIN_RE = /^(base|ethereum|bsc)$/;
ROUTES.push(
  { key: "wallet_report", path: "/v1/wallet-report", param: "address", re: ADDR, pattern: AP, price: PRICE_PREMIUM, fn: v => walletReport(v), name: "Wallet Security Report (premium)", pdesc: "EVM wallet address", example: EX.ethereum.wallet, tag: "report",
    desc: "Premium one-call wallet report across Base, Ethereum and BNB Smart Chain: balances, token approvals (flags unlimited), address type/EIP-7702 delegation, and a plain-English risk summary with findings.",
    out: { type: "wallet-report", riskLevel: "medium", summary: "Active on Base, Ethereum. Holds 12.5 USDC on Base. 2 open token approval(s), 1 unlimited. Worth reviewing the approvals above.", findings: [{ severity: "medium", note: "Base: UNLIMITED USDC approval to Permit2." }] } },
  { key: "token_report", path: "/v1/token-report", param: "address", re: ADDR, pattern: AP, price: PRICE_PREMIUM, fn: (v, q) => tokenReport(v, q.chain || "base"), name: "Token Due-Diligence Report (premium)", pdesc: "token/contract address", example: EX.base.token, tag: "report",
    extra: { name: "chain", re: CHAIN_RE, pattern: "^(base|ethereum|bsc)$", desc: "base | ethereum | bsc (default base)", example: "base" },
    desc: "Premium one-call token due-diligence on Base, Ethereum or BNB Smart Chain: token metadata, proxy/upgradeability, owner and admin, owner/dead/self balances as % of supply, Sourcify verification, mint/pause/blacklist/fee flags, plain-English summary.",
    out: { type: "token-report", riskLevel: "medium", summary: "USD Coin (USDC), an ERC-20 on Base... It is upgradeable (EIP-1967)...", holders: { owner: "0x...", ownerBalance: { pctOfSupply: 0 } }, findings: [] } });

const app = express();
app.set("trust proxy", true);
const server = new x402ResourceServer(new HTTPFacilitatorClient(facCfg)).register(NETWORK, new ExactEvmScheme()).registerExtension(bazaarResourceServerExtension).registerExtension(builderCodeResourceServerExtension);
server.onBeforeSettle(async (ctx) => { // backfill resource if a client omits it, so the facilitator can catalog
  const p = ctx?.paymentPayload; if (!p || p.resource?.url) return;
  const tc = ctx.transportContext || {}; const path = tc.request?.path || tc.adapter?.getPath?.() || tc.path || "";
  const r = ROUTES.find(r => path === r.path); if (r) p.resource = { url: ORIGIN + r.path, description: r.desc, mimeType: "application/json" };
});
const health = (_, res) => res.json({ ok: true, network: NETWORK, payTo: PAY_TO, mcp: ORIGIN + "/mcp", openapi: ORIGIN + "/openapi.json", chains: Object.keys(CHAINS),
  endpoints: ROUTES.map(r => ({ url: `${ORIGIN}${r.path}?${r.param}=<${r.param}>`, price: r.price, description: r.desc })) });
app.get("/health", health); mountLanding(app, { ROUTES, ORIGIN, PAY_TO, health });

// Validate before charging: bare paymentless request -> 402 (discovery probes); bad input -> free 400.
const hasPay = req => !!(req.get("payment-signature") || req.get("x-payment"));
for (const r of ROUTES) app.get(r.path, (req, res, next) => {
  const v = req.query[r.param];
  if (v === undefined && !hasPay(req)) return next();
  if (typeof v !== "string" || !r.re.test(v)) return res.status(400).json({ error: `query param ${r.param} must match ${r.pattern}` });
  if (r.extra && req.query[r.extra.name] !== undefined && (typeof req.query[r.extra.name] !== "string" || !r.extra.re.test(req.query[r.extra.name]))) return res.status(400).json({ error: `query param ${r.extra.name} must match ${r.extra.pattern}` });
  if (r.param === "url") { try { const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v); if (!["http:", "https:"].includes(u.protocol)) throw 0; } catch { return res.status(400).json({ error: "url must be an http(s) URL or hostname" }); } }
  next();
});
const routeCfg = {};
for (const r of ROUTES) routeCfg["GET " + r.path] = {
  accepts: [{ scheme: "exact", price: r.price, network: NETWORK, payTo: PAY_TO }], description: r.desc, mimeType: "application/json",
  resource: ORIGIN + r.path, serviceName: r.name, tags: r.param === "url" ? ["security", "phishing", "url", "web"] : [r.tag || r.path.split("/")[2], "onchain", "evm", "crypto"],
  extensions: { ...builderExt, ...declareDiscoveryExtension({ method: "GET", input: { [r.param]: r.example, ...(r.extra ? { [r.extra.name]: r.extra.example } : {}) },
    inputSchema: { properties: { [r.param]: { type: "string", pattern: r.pattern, ...(r.maxLen ? { maxLength: r.maxLen } : {}), description: r.pdesc }, ...(r.extra ? { [r.extra.name]: { type: "string", pattern: r.extra.pattern, description: r.extra.desc } } : {}) }, required: [r.param] }, output: { example: r.out } }) } };
app.use(paymentMiddleware(routeCfg, server));
for (const r of ROUTES) app.get(r.path, async (req, res) => {
  try { res.json(await r.fn(req.query[r.param], req.query)); }
  catch (e) { res.status(e.status || 404).json({ error: e.status === 400 ? e.message : "not found or upstream error", detail: String(e.shortMessage || e.message).slice(0, 300) }); }
});

app.get("/openapi.json", (_, res) => res.json({ openapi: "3.1.0",
  info: { title: "Automaton Onchain & URL Tools", version: "1.4.0", contact: { name: "Automaton", url: ORIGIN + "/health" },
    description: "Pay-per-call utilities via x402 (USDC on Base): tx explainer, token approvals, address inspector and contract-risk heuristics for Base, Ethereum and BNB Smart Chain, URL safety checks, plus $0.25 premium wallet and token reports.",
    "x-guidance": "GET an endpoint with its query param; answer the 402 with an x402 v2 exact-scheme USDC payment on eip155:8453 (PAYMENT-SIGNATURE header). Invalid input is rejected with 400 before any charge. MCP: POST /mcp (streamable HTTP, paid tools)." },
  servers: [{ url: ORIGIN }],
  paths: Object.fromEntries(ROUTES.map(r => [r.path, { get: { operationId: r.key, summary: r.name, description: r.desc,
    "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: r.price.replace("$", "") }, protocols: [{ x402: {} }] },
    parameters: [{ name: r.param, in: "query", required: true, description: r.pdesc, schema: { type: "string", pattern: r.pattern } }, ...(r.extra ? [{ name: r.extra.name, in: "query", required: false, description: r.extra.desc, schema: { type: "string", pattern: r.extra.pattern } }] : [])],
    responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object" }, example: r.out } } }, 400: { description: "Invalid input (no charge)" }, 402: { description: "Payment Required" } } } }])) }));
app.get("/.well-known/mcp-registry-auth", (_, res) => res.type("text/plain").send("v=MCPv1; k=ed25519; p=Gkkq+F+PxBJofd16J+xJpg6E+nXM7MWO29cD3+IKe0U="));
app.get("/.well-known/x402", (_, res) => res.json({ version: 1, resources: ROUTES.map(r => ORIGIN + r.path) }));

// ---- MCP (stateless streamable HTTP; each paid tool call settles via x402) ----
let mcpReady;
async function buildMcp() {
  await server.initialize();
  const wrap = {};
  for (const r of ROUTES) wrap[r.key] = createPaymentWrapper(server, {
    accepts: await server.buildPaymentRequirements({ scheme: "exact", network: NETWORK, payTo: PAY_TO, price: r.price }),
    resource: { url: `${ORIGIN}/mcp#${r.key}`, description: r.desc, mimeType: "application/json", serviceName: r.name, tags: ["mcp", ...(r.param === "url" ? ["security"] : ["onchain"])] },
    extensions: { ...builderExt, ...declareDiscoveryExtension({ toolName: r.key, description: r.desc, inputSchema: { properties: { [r.param]: { type: "string", pattern: r.pattern, ...(r.maxLen ? { maxLength: r.maxLen } : {}), description: r.pdesc }, ...(r.extra ? { [r.extra.name]: { type: "string", pattern: r.extra.pattern, description: r.extra.desc } } : {}) }, required: [r.param] }, example: { [r.param]: r.example, ...(r.extra ? { [r.extra.name]: r.extra.example } : {}) } }) } });
  return () => {
    const m = new McpServer({ name: "automaton-onchain-tools", version: "1.4.0" });
    const txt = o => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
    for (const r of ROUTES) { const zz = r.param === "url" ? z.string().min(4).max(r.param === "data" ? 8010 : 2048) : z.string().regex(r.re);
      m.tool(r.key, `${r.desc} Costs ${r.price}.`, { [r.param]: zz, ...(r.extra ? { [r.extra.name]: z.string().regex(r.extra.re).optional() } : {}) }, wrap[r.key](async a => { try { return txt(await r.fn(a[r.param], a)); } catch (e) { return { isError: true, ...txt({ error: String(e.shortMessage || e.message).slice(0, 300) }) }; } })); }
    m.tool("ping", "Free health check.", {}, async () => txt({ ok: true }));
    return m;
  };
}
app.post("/mcp", express.json({ limit: "64kb" }), async (req, res, next) => {
  try { mcpReady ??= buildMcp(); const make = await mcpReady;
    const m = make(); const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { t.close(); m.close(); }); await m.connect(t); await t.handleRequest(req, res, req.body);
  } catch (e) { mcpReady = undefined; next(e); }
});
app.all("/mcp", (_, res) => res.status(405).json({ error: "use POST (stateless streamable HTTP)" }));

app.use((err, req, res, next) => { const m = String(err?.message || err).replace(/[A-Za-z0-9+\/=_-]{32,}/g, "[redacted]").slice(0, 300); console.error("handler error:", m); res.status(500).json({ error: "internal", detail: m }); });
process.on("unhandledRejection", e => console.error("unhandled:", String(e?.message || e).slice(0, 300)));
export default app;
if (process.env.NO_LISTEN !== "1" && !process.env.VERCEL) app.listen(process.env.PORT || 4021, () => console.log("listening", process.env.PORT || 4021, NETWORK));
