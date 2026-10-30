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
import { mountCheck } from "./check.js";
import { walletReport, tokenReport } from "./reports.js";
import { deepScan } from "./deepscan.js";
import { solanaToken, isPubkey, SOL_ADDR_RE } from "./solana.js";
import { launches, launchesDelayed } from "./launches.js";
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
    desc: "Premium one-call token due-diligence on Base, Ethereum or BNB Smart Chain: token metadata, proxy/upgradeability, owner and admin, owner/dead/self balances as % of supply, Sourcify verification, mint/pause/blacklist/fee flags, a flag for copycats of major tokens (USDC, USDT, WETH...), plain-English summary.",
    out: { type: "token-report", riskLevel: "medium", summary: "USD Coin (USDC), an ERC-20 on Base... It is upgradeable (EIP-1967)...", holders: { owner: "0x...", ownerBalance: { pctOfSupply: 0 } }, findings: [] } });

const PRICE_DEEP = process.env.PRICE_DEEP || "$1.50";
ROUTES.push({ key: "token_deep_scan", path: "/v1/token/deep-scan", param: "address", re: ADDR, pattern: AP, price: PRICE_DEEP, fn: (v, q) => deepScan(v, q.chain || "base"), name: "Token Deep Scan: honeypot sim + liquidity + holders (premium)", pdesc: "token contract address", example: EX.base.token, tag: "report",
  extra: { name: "chain", re: CHAIN_RE, pattern: "^(base|ethereum|bsc)$", desc: "base | ethereum | bsc (default base)", example: "base" },
  desc: "Premium token deep scan on Base, Ethereum or BNB Smart Chain: simulated buy+sell against the main DEX pool (honeypot + buy/sell tax detection via eth_call, nothing traded), main pool liquidity in USD, V2 LP burned/locked share, top-holder concentration (Blockscout; partial fallback from recent transfers), plus owner powers (proxy, owner, mint/pause/blacklist/fee). Lists anything it couldn't determine.",
  out: { type: "token-deep-scan", riskLevel: "medium", honeypot: "not detected", summary: "Brett (BRETT) on Base. Simulated buy and sell both worked (buy tax 0%, sell tax 0%). Main pool: Uniswap V3 1%, about $1,396,832 liquidity...", honeypotSimulation: { ran: true, canSell: true, buyTaxPct: 0, sellTaxPct: 0 }, liquidity: { mainPool: { dex: "Uniswap V3 1%", approxTotalUsd: 1396832 }, lp: { verdict: "..." } }, holders: { top10Pct: 8.9, top10ExcludingPoolsAndBurnPct: 7.3 }, couldNotDetermine: ["LP lock: V3 liquidity is held as position NFTs..."] } });

ROUTES.push({ key: "solana_token_check", path: "/v1/solana/token", param: "address", re: SOL_ADDR_RE, valid: isPubkey, pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", price: PRICE_SMALL, fn: v => solanaToken(v), name: "Solana Token Check (SPL / Token-2022 / pump.fun)", pdesc: "Solana token mint address (base58)", example: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", tag: "solana", tags: ["solana", "token", "security", "pumpfun", "crypto"], chainLabel: "Solana",
  desc: "Rug-check a Solana token mint from public RPC data: mint and freeze authority status, metadata mutability (Metaplex update authority / isMutable or Token-2022 metadata), Token-2022 extensions (transfer fee, permanent delegate, transfer hook, pausable, default-frozen), top-holder concentration excluding pools and the bonding curve where identifiable, pump.fun curve status, PumpSwap LP burn share, and copycats of major tokens like USDC. Lists what it couldn't determine. Not an audit.",
  out: { type: "solana-token-check", kind: "mint", tokenProgram: "spl-token", token: { name: "Bonk", symbol: "Bonk", decimals: 5 }, mintAuthority: { active: false }, freezeAuthority: { active: false }, metadata: { source: "metaplex", isMutable: true }, extensions: { present: [] }, pumpfun: { isPumpFun: false }, holders: { top10ExcludingPoolsPct: 38.2, largestWalletPct: 8.8 }, riskLevel: "medium", findings: [{ severity: "medium", note: "Metadata can still be changed..." }], couldNotDetermine: ["LP burn/lock is only checked for pump.fun coins..."] } });

// Launch feed: newest token launches (GeckoTerminal new pools) with our risk check on each. Query params are optional.
const PRICE_FEED = process.env.PRICE_FEED || "$0.01", PRICE_FEED_ALL = process.env.PRICE_FEED_ALL || "$0.02";
const LIMIT = { name: "limit", re: /^([1-9]|1[0-9]|20)$/, pattern: "^([1-9]|1[0-9]|20)$", desc: "rows per chain, 1-20 (default 10)", example: "10" };
const feedOut = { type: "launch-feed", generatedAt: "2026-10-29T18:21:11Z", count: 10, launches: [{ chain: "base", token: { address: "0x...", name: "...", symbol: "..." },
  pool: { address: "0x...", dex: "uniswap-v4-base", quote: "WETH", createdAt: "2026-10-29T18:12:07Z", ageMinutes: 9, liquidityUsd: 2968.41, fdvUsd: 5900, txnsH1: { buys: 12, sells: 3 } },
  risk: { riskLevel: "medium", verifiedSource: false, upgradeable: false, ownerType: "eoa", capabilities: ["mint"], flags: [{ severity: "high", note: "Source not verified on Sourcify..." }] } }], disclaimer: "..." };
ROUTES.push(
  { key: "launch_feed", path: "/v1/launches", param: "chain", optional: true, re: /^(all|base|bsc|solana)$/, pattern: "^(all|base|bsc|solana)$", price: PRICE_FEED_ALL, fn: (v, q) => launches({ chain: v || "all", limit: q.limit }),
    name: "New Token Launch Feed with Risk Flags (Base + BNB Chain + Solana)", pdesc: "all | base | bsc | solana (default all)", example: "all", tag: "launches", tags: ["launches", "new-tokens", "pumpfun", "fourmeme", "base", "bsc", "bnb", "solana", "security", "crypto"], chainLabel: "Base + BNB + Solana", extra: LIMIT,
    get cardDesc() { return this.desc; },
    desc: `Newest token launches on Base, BNB Chain (four.meme, PancakeSwap) and Solana (pump.fun), up to 20 per chain, each risk-checked at request time. Base/BNB: verified source, upgradeable proxy, owner type, mint/pause/blacklist/fee functions. Solana: mint/freeze authority, mutable metadata, Token-2022 extensions, holder concentration, curve progress. All: flags copycats of USDC/USDT/ETH/BTC/SOL/BNB etc. Plus age, liquidity, FDV, 1h buys/sells. Data: GeckoTerminal. Heuristics, not an audit.`, out: feedOut },
  { key: "base_launch_feed", path: "/v1/base/launches", param: "limit", optional: true, re: LIMIT.re, pattern: LIMIT.pattern, price: PRICE_FEED, fn: v => launches({ chain: "base", limit: v }),
    name: "Base New Token Launch Feed with Risk Flags", pdesc: LIMIT.desc, example: "10", tag: "launches", tags: ["launches", "new-tokens", "base", "security", "crypto"], chainLabel: "Base",
    cardDesc: "Latest new token launches on one chain, up to 20, each with our automated contract-risk check at request time (Sourcify verification, upgradeable proxy, owner type, mint/pause/blacklist/fee selectors, plus a flag for copycats of major tokens like USDC). Base covers Uniswap v2/v3/v4, Aerodrome, Bankr and launchpads (B20 native tokens are labeled as not checkable by bytecode); BNB Chain covers four.meme bonding curves, PancakeSwap v2/v3/Infinity and Uniswap v4. Includes pool DEX, age, liquidity, FDV and 1h buys/sells. Heuristics, not an audit.",
    desc: `Newest token launches on Base (Uniswap, Aerodrome, Bankr, launchpads), up to 20, each risk-checked at request time: Sourcify verification, upgradeable proxy, owner type, mint/pause/blacklist/fee functions, and a flag for copycats of major tokens (USDC, ETH, BTC...) that aren't the real contract. B20 native tokens are labeled as not checkable by bytecode. Plus pool DEX, age, liquidity, FDV and 1h buys/sells. Data: GeckoTerminal. Heuristics, not an audit.`, out: feedOut },
  { key: "bsc_launch_feed", path: "/v1/bsc/launches", param: "limit", optional: true, re: LIMIT.re, pattern: LIMIT.pattern, price: PRICE_FEED, fn: v => launches({ chain: "bsc", limit: v }),
    name: "BNB Chain New Token Launch Feed with Risk Flags", pdesc: LIMIT.desc, example: "10", tag: "launches", tags: ["launches", "new-tokens", "bsc", "bnb", "fourmeme", "pancakeswap", "security", "crypto"], chainLabel: "BNB",
    desc: `Newest token launches on BNB Chain (four.meme, PancakeSwap v2/v3/Infinity, Uniswap v4), up to 20, each risk-checked at request time: Sourcify verification, upgradeable proxy, owner type, mint/pause/blacklist/fee functions, and a flag for copycats of major tokens (USDT, BNB, ETH...) that aren't the real contract. Plus pool DEX, age, liquidity, FDV and 1h buys/sells. Data: GeckoTerminal. Heuristics, not an audit.`,
    out: { ...feedOut, launches: [{ ...feedOut.launches[0], chain: "bsc", pool: { ...feedOut.launches[0].pool, dex: "four-meme", quote: "BNB" } }] } },
  { key: "solana_launch_feed", path: "/v1/solana/launches", param: "limit", optional: true, re: LIMIT.re, pattern: LIMIT.pattern, price: PRICE_FEED, fn: v => launches({ chain: "solana", limit: v }),
    name: "Solana / pump.fun New Token Launch Feed with Risk Flags", pdesc: LIMIT.desc, example: "10", tag: "launches", tags: ["launches", "new-tokens", "solana", "pumpfun", "security", "crypto"], chainLabel: "Solana",
    desc: `Newest token launches on Solana (mostly pump.fun curves, plus PumpSwap/Meteora), up to 20, each with our Solana token check at request time: mint/freeze authority, mutable metadata, Token-2022 extensions, holder concentration excluding curve/pools, curve progress, and a flag for copycats of major tokens (USDC, SOL, USDT...) that aren't the real mint. Plus age, FDV, 1h buys/sells. Data: GeckoTerminal. Heuristics, not an audit.`, out: { ...feedOut, launches: [{ chain: "solana", token: { address: "...pump", symbol: "..." }, pool: { dex: "pump-fun", ageMinutes: 1, fdvUsd: 2866 }, risk: { riskLevel: "low", mintAuthorityActive: false, freezeAuthorityActive: false, metadataMutable: false, pumpfun: { status: "on-curve", progressPct: 2.8 }, top10HoldersPct: 2.2, flags: [] } }] } });

// CDP facilitator /verify rejects any paymentPayload whose resource.description is over 500 chars (x402 issue #2832). Keep every desc <= 500.
for (const r of ROUTES) if (r.desc.length > 500) console.error(`desc too long (${r.desc.length}) for ${r.path}: CDP will reject payments`);
const app = express();
app.set("trust proxy", true);
const server = new x402ResourceServer(new HTTPFacilitatorClient(facCfg)).register(NETWORK, new ExactEvmScheme()).registerExtension(bazaarResourceServerExtension).registerExtension(builderCodeResourceServerExtension);
server.onBeforeSettle(async (ctx) => { // backfill resource if a client omits it, so the facilitator can catalog
  const p = ctx?.paymentPayload; if (!p || p.resource?.url) return;
  const tc = ctx.transportContext || {}; const path = tc.request?.path || tc.adapter?.getPath?.() || tc.path || "";
  const r = ROUTES.find(r => path === r.path); if (r) p.resource = { url: ORIGIN + r.path, description: r.desc, mimeType: "application/json" };
});
const health = (_, res) => res.json({ ok: true, network: NETWORK, payTo: PAY_TO, mcp: ORIGIN + "/mcp", openapi: ORIGIN + "/openapi.json", chains: [...Object.keys(CHAINS), "solana"],
  endpoints: ROUTES.map(r => ({ url: `${ORIGIN}${r.path}?${r.param}=<${r.param}>`, price: r.price, description: r.desc })) });
app.get("/health", health); mountLanding(app, { ROUTES, ORIGIN, PAY_TO, health }); mountCheck(app, { ORIGIN, PAY_TO, PRICE: PRICE_PREMIUM, PRICE_DEEP, PRICE_SOL: PRICE_SMALL });

// Validate before charging: bare paymentless request -> 402 (discovery probes); bad input -> free 400.
const hasPay = req => !!(req.get("payment-signature") || req.get("x-payment"));
for (const r of ROUTES) app.get(r.path, (req, res, next) => {
  const v = req.query[r.param];
  if (r.optional && r.extra && req.query[r.extra.name] !== undefined && (typeof req.query[r.extra.name] !== "string" || !r.extra.re.test(req.query[r.extra.name]))) return res.status(400).json({ error: `query param ${r.extra.name} must match ${r.extra.pattern}` });
  if (v === undefined && (!hasPay(req) || r.optional)) return next();
  if (typeof v !== "string" || !r.re.test(v) || (r.valid && !r.valid(v))) return res.status(400).json({ error: `query param ${r.param} must match ${r.pattern}` });
  if (r.extra && req.query[r.extra.name] !== undefined && (typeof req.query[r.extra.name] !== "string" || !r.extra.re.test(req.query[r.extra.name]))) return res.status(400).json({ error: `query param ${r.extra.name} must match ${r.extra.pattern}` });
  if (r.param === "url") { try { const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v); if (!["http:", "https:"].includes(u.protocol)) throw 0; } catch { return res.status(400).json({ error: "url must be an http(s) URL or hostname" }); } }
  next();
});
const routeCfg = {};
for (const r of ROUTES) routeCfg["GET " + r.path] = {
  accepts: [{ scheme: "exact", price: r.price, network: NETWORK, payTo: PAY_TO }], description: r.desc, mimeType: "application/json",
  resource: ORIGIN + r.path, serviceName: r.name, tags: r.tags || (r.param === "url" ? ["security", "phishing", "url", "web"] : [r.tag || r.path.split("/")[2], "onchain", "evm", "crypto"]),
  extensions: { ...builderExt, ...declareDiscoveryExtension({ method: "GET", input: { [r.param]: r.example, ...(r.extra ? { [r.extra.name]: r.extra.example } : {}) },
    inputSchema: { properties: { [r.param]: { type: "string", pattern: r.pattern, ...(r.maxLen ? { maxLength: r.maxLen } : {}), description: r.pdesc }, ...(r.extra ? { [r.extra.name]: { type: "string", pattern: r.extra.pattern, description: r.extra.desc } } : {}) }, required: r.optional ? [] : [r.param] }, output: { example: r.out } }) } };
// Mirror the PAYMENT-REQUIRED header into the 402 body (it is otherwise "{}") so indexers and clients that read the body (x402 v1 style) see the same accepts[].
app.use((req, res, next) => { if (!req.path.startsWith("/v1/")) return next(); const end = res.end;
  res.end = function (chunk, ...rest) { try { if (res.statusCode === 402 && !res.headersSent && (!chunk || String(chunk) === "{}")) { const h = res.getHeader("payment-required");
    if (h) { chunk = Buffer.from(String(h), "base64").toString("utf8"); res.setHeader("content-type", "application/json; charset=utf-8"); res.setHeader("content-length", Buffer.byteLength(chunk)); } } } catch {}
    return end.call(this, chunk, ...rest); }; next(); });
app.use(paymentMiddleware(routeCfg, server));
for (const r of ROUTES) app.get(r.path, async (req, res) => {
  try { res.json(await r.fn(req.query[r.param], req.query)); }
  catch (e) { res.status(e.status || 404).json({ error: e.status === 400 ? e.message : "not found or upstream error", detail: String(e.shortMessage || e.message).slice(0, 300) }); }
});

// Free delayed launch feed (for posts, bots, and trying before buying). CDN-cached 10 min.
app.get("/free/launches", async (req, res) => {
  const c = req.query.chain ?? "all"; if (typeof c !== "string" || !/^(all|base|bsc|solana)$/.test(c)) return res.status(400).json({ error: "chain must be all | base | bsc | solana" });
  try { const d = await launchesDelayed({ chain: c }); res.set("cache-control", "public, max-age=60, s-maxage=600, stale-while-revalidate=300"); res.json(d); }
  catch (e) { res.status(503).json({ error: "upstream error", detail: String(e.message).slice(0, 200) }); }
});
app.get("/openapi.json", (_, res) => res.json({ openapi: "3.1.0",
  info: { title: "Automaton Onchain & URL Tools", version: "1.7.0", contact: { name: "Automaton", url: ORIGIN + "/health" },
    description: "Pay-per-call utilities via x402 (USDC on Base): tx explainer, token approvals, address inspector and contract-risk heuristics for Base, Ethereum and BNB Smart Chain, a Solana token check (SPL, Token-2022, pump.fun), URL safety checks, plus $0.25 premium wallet and token reports and a $1.50 token deep scan (honeypot buy/sell simulation, liquidity, LP lock, holder concentration), and a new-token launch feed for Base, BNB Chain (four.meme, PancakeSwap) and Solana/pump.fun with automated risk flags on each launch ($0.01 per chain, $0.02 for all three; free delayed sample at GET /free/launches).",
    "x-guidance": "GET an endpoint with its query param; answer the 402 with an x402 v2 exact-scheme USDC payment on eip155:8453 (PAYMENT-SIGNATURE header). Invalid input is rejected with 400 before any charge. MCP: POST /mcp (streamable HTTP, paid tools)." },
  servers: [{ url: ORIGIN }],
  paths: Object.fromEntries(ROUTES.map(r => [r.path, { get: { operationId: r.key, summary: r.name, description: r.desc,
    "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: r.price.replace("$", "") }, protocols: [{ x402: {} }] },
    parameters: [{ name: r.param, in: "query", required: !r.optional, description: r.pdesc, schema: { type: "string", pattern: r.pattern } }, ...(r.extra ? [{ name: r.extra.name, in: "query", required: false, description: r.extra.desc, schema: { type: "string", pattern: r.extra.pattern } }] : [])],
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
    extensions: { ...builderExt, ...declareDiscoveryExtension({ toolName: r.key, description: r.desc, inputSchema: { properties: { [r.param]: { type: "string", pattern: r.pattern, ...(r.maxLen ? { maxLength: r.maxLen } : {}), description: r.pdesc }, ...(r.extra ? { [r.extra.name]: { type: "string", pattern: r.extra.pattern, description: r.extra.desc } } : {}) }, required: r.optional ? [] : [r.param] }, example: { [r.param]: r.example, ...(r.extra ? { [r.extra.name]: r.extra.example } : {}) } }) } });
  return () => {
    const m = new McpServer({ name: "automaton-onchain-tools", version: "1.7.0" });
    const txt = o => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
    for (const r of ROUTES) { const zz = r.param === "url" ? z.string().min(4).max(r.param === "data" ? 8010 : 2048) : z.string().regex(r.re);
      m.tool(r.key, `${r.desc} Costs ${r.price}.`, { [r.param]: r.optional ? zz.optional() : zz, ...(r.extra ? { [r.extra.name]: z.string().regex(r.extra.re).optional() } : {}) }, wrap[r.key](async a => { try { return txt(await r.fn(a[r.param], a)); } catch (e) { return { isError: true, ...txt({ error: String(e.shortMessage || e.message).slice(0, 300) }) }; } })); }
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
