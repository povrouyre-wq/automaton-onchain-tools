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
import { solanaAddress, solanaDelegates } from "./solana-wallet.js";
import { launches, launchesDelayed } from "./launches.js";
import { approvalSweep } from "./sweep.js";
import { bscBundles } from "./bundles.js";
import { honeypotCheck, HONEYPOT_CHAINS } from "./honeypot.js";
import { tokenVerdict } from "./verdict.js";
import { safeToSend } from "./safe-to-send.js";
import { bscSmartMoney, bscSmartMoneyWallet, runSmartMoneyCron } from "./smart-money.js";
import { CHAINS, CORE_CHAINS, LOOKUP_ONLY_CHAINS, explain, approvals, inspect, contractRisk, urlSafety, gasSnapshot, ensResolve, decodeCalldata, portfolio } from "./lib.js";
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
  bsc: { tx: "0xa98a72c04fb6ae896f69aa5d4488bda5e9efc34ed9b69e51cfc5b6c09100fac2", token: "0x55d398326f99059fF775485246999027B3197955", wallet: "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717" },
  arbitrum: { tx: "0x53869f15db3a9d9cf8dd05c7b5898a3b6df3866f25bebe4aa2e2f530e31d4f52", token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", wallet: "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717" },
  optimism: { tx: "0xc0f955bb7f363652ec6d91406b7f14be19bd0d6bbcb6ae370f1d2008b86980e1", token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", wallet: "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717" },
  polygon: { tx: "0x7a0c80c26ed4e6ed36746203bb7777fdd9d960d57496192b041e19e3a21ffc7a", token: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", wallet: "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717" },
  avalanche: { tx: "0xbd86b3d8d2a773d4381e1736863280731e80ae8ca88ccb1a5639a5e762f898dd", token: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", wallet: "0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717" } };

// Route table: one fixed resource URL per endpoint.
// Advertised patterns must be RE2-compatible (CDP Bazaar): no {m,n} repeat counts > 1000; use maxLength instead.
const ROUTES = [];
for (const [c, C] of Object.entries(CHAINS)) {
  const N = C.name, legacy = c === "base"; // keep original Base tool names
  // Lookup-only chains (Arbitrum, Optimism, Polygon, Avalanche) sell all four lookups at $0.005 and carry the copycat flag.
  const extra = LOOKUP_ONLY_CHAINS.includes(c), P1 = extra ? PRICE_SMALL : PRICE, cc = extra ? ", and a flag for copycats of major tokens (USDC, USDT, WETH...) at a non-official address" : "";
  ROUTES.push(
    { key: `${c}_tx_explain`, path: `/v1/${c}/tx`, param: "hash", re: HASH, pattern: HP, price: P1, fn: v => explain(c, v), name: `${N} Tx Explainer`, pdesc: `${N} transaction hash`, example: EX[c].tx,
      desc: `Explain a ${N} transaction: status, fee, decoded method + args (openchain signature DB), and ERC-20 transfers with symbols and human amounts.`,
      out: { chain: c, status: "success", method: "transfer(address,uint256)", fee: "0.00000027", tokenTransfers: [{ symbol: "USDC", amount: "1.028272", from: "0x...", to: "0x..." }], summary: "success · transfer · 1 token transfer(s)" } },
    { key: `${c}_token_approvals`, path: `/v1/${c}/approvals`, param: "address", re: ADDR, pattern: AP, price: PRICE_SMALL, fn: v => approvals(c, v), name: `${N} Token Approval Check`, pdesc: `${N} wallet address (owner)`, example: EX[c].wallet,
      desc: `Check a ${N} wallet's ERC-20 approvals: allowances for ${Object.keys(C.tokens).length} major tokens (${Object.keys(C.tokens).slice(0, 4).join(", ")}...) to common spenders (${Object.keys(C.spenders).slice(0, 4).join(", ")}...); flags unlimited approvals.`,
      out: { owner: "0x...", checkedPairs: 64, nonZeroApprovals: [{ token: "USDC", spender: "Permit2", unlimited: true, allowance: "unlimited" }], unlimitedCount: 1 } },
    { key: `${c}_address_inspect`, path: `/v1/${c}/address`, param: "address", re: ADDR, pattern: AP, price: PRICE_SMALL, fn: v => inspect(c, v), name: `${N} Address Inspector`, pdesc: `${N} address (EOA or contract)`, example: EX[c].token,
      desc: `Inspect any ${N} address: EOA vs contract vs EIP-7702 delegated, ${C.native} balance, nonce, proxy implementation (EIP-1967/1167/zos), and ERC-20 name/symbol/decimals/supply${cc}.`,
      out: { type: "contract", nativeBalance: "0", proxy: { standard: "EIP-1967", implementation: "0x..." }, erc20: { name: "USD Coin", symbol: "USDC", decimals: 6 }, summary: "contract (EIP-1967 proxy) · ERC-20 USDC" } },
    { key: `${c}_contract_risk`, path: `/v1/${c}/contract-risk`, param: "address", re: ADDR, pattern: AP, price: P1, fn: v => contractRisk(c, v), name: `${N} Contract Risk Heuristics`, pdesc: `${N} contract address`, example: EX[c].token,
      desc: `Heuristic risk flags for a ${N} contract from free public data: Sourcify verification, upgradeable proxy + admin, owner type, mint/pause/blacklist/fee selectors, bytecode size${cc}. Not an audit or financial advice.`,
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
  desc: "From public RPC data: mint and freeze authority status, mutable metadata (Metaplex or Token-2022), Token-2022 extensions (transfer fee, permanent delegate, transfer hook, pausable, default-frozen), top-holder concentration excluding pools and the bonding curve where identifiable, pump.fun curve status, PumpSwap LP burn share, and copycats of major tokens like USDC. Lists what it couldn't determine. Not an audit.",
  out: { type: "solana-token-check", kind: "mint", tokenProgram: "spl-token", token: { name: "Bonk", symbol: "Bonk", decimals: 5 }, mintAuthority: { active: false }, freezeAuthority: { active: false }, metadata: { source: "metaplex", isMutable: true }, extensions: { present: [] }, pumpfun: { isPumpFun: false }, holders: { top10ExcludingPoolsPct: 38.2, largestWalletPct: 8.8 }, riskLevel: "medium", findings: [{ severity: "medium", note: "Metadata can still be changed..." }], couldNotDetermine: ["LP burn/lock is only checked for pump.fun coins..."] } });

// Solana wallet lookups ($0.005 each): address lookup and live SPL token delegates (Solana's approvals).
const SOL_WALLET_EX = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
ROUTES.push(
  { key: "solana_address_lookup", path: "/v1/solana/address", param: "address", re: SOL_ADDR_RE, valid: isPubkey, pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", price: PRICE_SMALL, fn: v => solanaAddress(v), name: "Solana Address Lookup (SOL + SPL balances, wallet age, activity)", pdesc: "Solana wallet or account address (base58)", example: SOL_WALLET_EX, tag: "solana", tags: ["solana", "wallet", "address", "balances", "security", "crypto"], chainLabel: "Solana",
    desc: "Look up any Solana address from public RPC data: account type (wallet, token mint, token account, program, program-owned), SOL balance, SPL and Token-2022 balances with names, wallet age from its first transaction (lower bound for very busy wallets), last active time, tx counts for 24h/7d/30d, recent transactions, and flags for fake copycat tokens (scam airdrops), frozen accounts and live token delegates. No USD prices.",
    out: { type: "solana-address", kind: "wallet", sol: { balance: "4.2679" }, tokens: { withBalance: 3, list: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", balance: "12.5" }] }, liveDelegates: 0, age: { complete: true, firstSeen: "2024-03-02T10:11:12Z", ageDays: 973 }, activity: { lastActive: "2026-10-31T17:02:11Z", last7d: 14, recent: [{ signature: "...", status: "success" }] }, findings: [], summary: "Solana wallet. 4.2679 SOL. 3 token(s) with a balance..." } },
  { key: "solana_token_delegates", path: "/v1/solana/delegates", param: "address", re: SOL_ADDR_RE, valid: isPubkey, pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", price: PRICE_SMALL, fn: v => solanaDelegates(v), name: "Solana Token Delegate Check (SPL approvals)", pdesc: "Solana wallet address (base58)", example: SOL_WALLET_EX, tag: "solana", tags: ["solana", "approvals", "delegates", "drainer", "security", "crypto"], chainLabel: "Solana",
    desc: "Check a Solana wallet's live SPL and Token-2022 token delegates (Solana's version of token approvals, the way drainers move funds): every token account with a delegate, how much it can move, UNLIMITED flag, whether the delegate is a plain wallet, a known program (Jupiter, Raydium, Orca...) or unknown. Also flags held Token-2022 tokens with a permanent delegate and foreign close authorities. Risk level and how to revoke.",
    out: { type: "solana-delegates", tokenAccountsChecked: 28, liveCount: 1, unlimitedCount: 1, unknownCount: 1, delegates: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", delegate: "...", delegateType: "wallet", known: false, delegatedAmount: "unlimited", unlimited: true, severity: "high" }], riskLevel: "high", findings: [{ severity: "high", note: "USDC: an unknown wallet (...) can move UNLIMITED USDC from this wallet without asking..." }] } });

// All-chains approval sweep ($0.02): every live ERC-20 allowance and NFT setApprovalForAll on all 7 EVM chains, ranked by risk, with revoke txs.
const PRICE_SWEEP = process.env.PRICE_SWEEP || "$0.02";
ROUTES.push({ key: "approval_sweep_all_chains", path: "/v1/approvals/sweep", param: "address", re: ADDR, pattern: AP, price: PRICE_SWEEP, deadline: 40000, fn: v => approvalSweep(v),
  name: "All-Chain Approval Sweep + Revoke Txs (7 EVM chains)", pdesc: "EVM wallet address (owner)", example: EX.ethereum.wallet, tag: "approvals", chainLabel: "7 EVM chains",
  tags: ["approvals", "revoke", "allowance", "nft", "drainer", "security", "wallet", "multichain", "evm", "crypto"],
  desc: "Sweeps a wallet on Base, Ethereum, BNB, Arbitrum, Optimism, Polygon and Avalanche for live ERC-20 allowances and NFT setApprovalForAll approvals (GoPlus + explorer logs, re-read onchain), ranks them by risk (unlimited, unknown spender, unverified or non-contract spender, flagged) and returns a ready-to-sign revoke tx (to, data, chainId, value 0) for each risky one. Per-chain status; partial results if a chain fails.",
  out: { type: "approval-sweep", owner: "0x...", riskLevel: "high", summary: "4 live approval(s) across 7 of 7 chains. 1 high risk, 2 medium risk, each with a ready-to-sign revoke tx.", counts: { live: 4, high: 1, medium: 2, low: 1, unlimited: 3, nft: 1 },
    chains: [{ chain: "base", chainId: 8453, status: "ok", candidatesChecked: 71, live: 2, risky: 2, sources: { goplus: "ok", eventLogs: "ok (blockscout, 12 events)", knownPairs: "ok" } }],
    approvals: [{ chain: "base", chainId: 8453, kind: "erc20", token: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 }, spender: { address: "0x...", label: null, known: false, type: "eoa", verified: null, flagged: false },
      unlimited: true, allowance: "unlimited", tokenBalance: "12.5", riskScore: 11, severity: "high", reasons: ["spender is a plain wallet (EOA), not a contract: a common drainer pattern", "unlimited amount"],
      revokeTx: { chainId: 8453, to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", value: "0", data: "0x095ea7b3...", method: "approve(address,uint256)" } }] } });

// BNB Chain bundle + sniper check ($0.01): launch-block buyers, bundled txs, dev hand-outs and shared funders, % of supply grabbed and still held.
const PRICE_BUNDLE = process.env.PRICE_BUNDLE || "$0.01";
ROUTES.push({ key: "bsc_bundle_sniper_check", path: "/v1/bsc/bundles", param: "token", re: ADDR, pattern: AP, price: PRICE_BUNDLE, deadline: 40000, fn: v => bscBundles(v),
  name: "BNB Chain Bundle + Sniper Check (four.meme / PancakeSwap)", pdesc: "BNB Chain token contract address, launched within roughly the last 2 days (older launches are past free-RPC log history; such calls are not charged)", example: "0x284a907411bb2eacf580f3ec4d4585925d51ffff", tag: "bundles", chainLabel: "BNB Chain",
  tags: ["bundle", "sniper", "four.meme", "pancakeswap", "bsc", "bnb", "memecoin", "launch", "rug", "security", "crypto"],
  desc: "For a four.meme or PancakeSwap launch: finds the launch block, reads the next 10 blocks and clusters the wallets that bought in the launch block, were bundled in one tx, got tokens from the dev, or were BNB-funded by the dev or a shared wallet just before launch. Returns % of supply the cluster grabbed, % it still holds, whether the dev is in it, a risk verdict and a coverage field. Failed or timed-out calls are not charged.",
  out: { type: "bsc-bundle-check", token: "0x...", symbol: "CAPY", platform: "four.meme", deployer: "0x...", launchBlock: 131292657, riskLevel: "high",
    summary: "CAPY launched in block 131292657. 141 linked wallet(s) grabbed 20.80% of supply in the first 10 blocks and still hold 0.80%. Dev IS in the cluster. Risk: high.",
    cluster: { wallets: 141, supplyPctAtLaunch: 20.8, supplyPctHeldNow: 0.8, devInCluster: true, bundledTxs: [{ tx: "0x...", recipients: 141 }] },
    wallets: [{ address: "0x...", inCluster: true, isDev: false, blockOffset: 0, supplyPct: 0.0081, holdsPct: 0, why: ["bought in launch block", "bundled with other buyers in one tx"], funders: [] }],
    coverage: { firstBlocksWindow: [131292657, 131292667], fundingBlocksScanned: [131292617, 131292657], note: "..." } } });

// Honeypot check ($0.01 per chain): can you sell it, buy/sell tax. Simulated buy + sell on the deepest native pool via eth_call; inconclusive runs are not charged.
const PRICE_HONEYPOT = process.env.PRICE_HONEYPOT || "$0.01";
const HP_EX = { base: ["0x532f27101965dd16442E59d40670FaF5eBB142E4", "BRETT", "Uniswap V3 1%", "WETH"], ethereum: ["0x6982508145454Ce325dDbE47a25d4ec3d2311933", "PEPE", "Uniswap V2", "WETH"], bsc: ["0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", "Cake", "PancakeSwap V2", "WBNB"] };
const HP_DEX = { base: "Uniswap V2/V3 and Aerodrome", ethereum: "Uniswap V2/V3 and SushiSwap V2", bsc: "PancakeSwap V2/V3" };
for (const c of HONEYPOT_CHAINS) { const N = CHAINS[c].name, [ex, sym, dex, wn] = HP_EX[c];
  ROUTES.push({ key: `${c}_honeypot_check`, path: `/v1/${c}/honeypot`, param: "token", re: ADDR, pattern: AP, price: PRICE_HONEYPOT, deadline: 30000, fn: v => honeypotCheck(c, v),
    name: `${N} Honeypot Check (can I sell it? buy/sell tax)`, pdesc: `${N} token contract address`, example: ex, tag: "honeypot", chainLabel: N,
    tags: ["honeypot", "tax", "sell", "simulation", c === "bsc" ? "bnb" : c, "memecoin", "rug", "security", "crypto"],
    desc: `Can you actually sell this ${N} token? Simulates a small buy and a sell back into its deepest ${wn} pool (${HP_DEX[c]}) with an eth_call, so nothing trades. Returns sellable yes/no, buy tax %, sell tax %, the pool used, a verdict (sellable, taxed, high tax, honeypot) and coverage notes. No pool, not a token or an inconclusive simulation is not charged.`,
    out: { type: "honeypot-check", chain: c, token: { address: ex, symbol: sym, decimals: 18 }, sellable: true, buyTaxPct: 0, sellTaxPct: 0, verdict: "sellable", riskLevel: "low",
      summary: `${sym} on ${N}: sellable. A simulated buy and sell on ${dex} both worked: buy tax 0%, sell tax 0%.`, pool: { address: "0x...", dex, pairedWith: wn },
      simulation: { tradeSize: `0.05 ${wn}`, roundTripReturnPct: 98.5 }, coverage: { poolsTried: [{ pool: "0x...", dex, result: "sell ok" }], notes: ["..."] } } }); }

// Quick token verdict ($0.02 per chain): SAFE / CAUTION / AVOID from the honeypot sim, contract-risk flags, LP burn/lock and holders.
// Inconclusive sims throw 422 (not charged), same as the honeypot route. Bad input is a free 400.
const PRICE_VERDICT = process.env.PRICE_VERDICT || "$0.02";
for (const c of HONEYPOT_CHAINS) { const N = CHAINS[c].name, [ex, sym] = HP_EX[c];
  ROUTES.push({ key: `${c}_token_verdict`, path: `/v1/${c}/verdict`, param: "token", re: ADDR, pattern: AP, price: PRICE_VERDICT, deadline: 45000, fn: v => tokenVerdict(c, v),
    name: `${N} Quick Token Verdict (SAFE / CAUTION / AVOID)`, pdesc: `${N} token contract address`, example: ex, tag: "verdict", chainLabel: N,
    tags: ["verdict", "honeypot", "tax", "holders", "lp", "rug", c === "bsc" ? "bnb" : c, "memecoin", "security", "crypto"],
    cardDesc: "One call: SAFE, CAUTION or AVOID for a token on Base, Ethereum or BNB Chain, plus sellable, buy/sell tax, owner renounced, proxy, mint/pause/blacklist/fee, LP burned or locked, top 10 holders excluding pools and burn, and a copycat-name flag. Same honeypot sim, contract-risk scan and holder/LP reads. No pool, not a token, or an inconclusive simulation is not charged.",
    desc: `SAFE, CAUTION or AVOID for this ${N} token, plus sellable, buy/sell tax, owner renounced, proxy, mint/pause/blacklist/fee, LP burned or locked %, top 10 holders excluding pools and burn, and a copycat-of-a-major-token flag. Same honeypot sim, contract-risk scan and holder/LP reads. No pool, not a token, or an inconclusive sim is not charged.`,
    out: { type: "token-verdict", chain: c, token: { address: ex, symbol: sym, name: sym, decimals: 18 }, verdict: "CAUTION", riskLevel: "medium",
      summary: `${sym} on ${N}: CAUTION because LP burn/lock share could not be determined.`,
      flags: { sellable: true, buyTaxPct: 0, sellTaxPct: 0, ownerRenounced: true, isProxy: false, canMint: false, canPause: false, canBlacklist: false, canChangeFees: false, lpBurnedOrLockedPct: null, top10HolderPct: 12.4, copycatName: false },
      findings: [{ severity: "medium", note: "LP burn/lock share could not be determined." }, { severity: "info", note: "Simulated buy and sell both worked (buy 0%, sell 0%)." }],
      couldNotDetermine: ["LP lock: V3 liquidity is held as position NFTs, so burn/lock cannot be read from the pool."],
      disclaimer: "Automated verdict from public onchain data. SAFE is not an audit. Not financial or security advice." } }); }

// Safe to send? ($0.005, all 8 chains): pre-transfer recipient check. Bad input is a free 400. Upstream failure is not charged.
const PRICE_SAFE = process.env.PRICE_SAFE || "$0.005";
const SAFE_DESC = N => `Checks this ${N} recipient before a transfer: lookalike poisoning against the sender's recent counterparties when from is set, dust-only spam history, free GoPlus scam/drainer flags where that API covers the chain, whether a contract is the token itself or shows no code path for it, and a fresh empty address. Verdict safe, caution or danger. Heuristics, not proof.`;
const SAFE_CARD = "Before a transfer: safe, caution or danger for the recipient on any supported chain. Flags address-poisoning lookalikes when you pass the sender, dust-only spam history, free GoPlus scam/drainer reports on EVM, contracts that are the token itself or show no code path for it, and fresh empty addresses. Every signal is labeled a heuristic. Solana has no free address-flag source here, and the response says so.";
const safeOut = (c, N, to) => ({ type: "safe-to-send", heuristics: true, chain: c, to, from: null, token: null, verdict: "caution", riskLevel: "medium",
  summary: `${N} recipient: caution because it is a fresh empty address (no history, zero balance).`,
  reasons: [{ code: "fresh_address", severity: "caution", heuristic: true, note: "Heuristic: no transaction history in the window we could read, nonce/tx-count is 0, and native balance is zero. It may be unused, a typo, or a brand-new wallet. This is not proof it is malicious." }],
  checks: { addressPoisoning: { heuristic: true, checked: false, status: "skipped" }, scamFlags: { heuristic: true, source: c === "solana" ? null : "goplus", status: c === "solana" ? "unsupported" : "ok", flagged: false, flags: [] }, contract: { heuristic: true, kind: "eoa", isContract: false, tokenHandling: "not_a_contract" }, freshAddress: { heuristic: true, fresh: true, nonce: 0, nativeBalance: "0" } },
  couldNotDetermine: [], disclaimer: "Every check is a heuristic. safe is not a guarantee. Not security advice." });
for (const c of [...Object.keys(CHAINS), "solana"]) {
  const sol = c === "solana", N = sol ? "Solana" : CHAINS[c].name;
  const re = sol ? SOL_ADDR_RE : ADDR, pattern = sol ? "^[1-9A-HJ-NP-Za-km-z]{32,44}$" : AP, valid = sol ? isPubkey : undefined;
  const exTo = sol ? SOL_WALLET_EX : EX[c].wallet, exToken = sol ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : EX[c].token, exFrom = sol ? "So11111111111111111111111111111111111111112" : EX[c].token;
  ROUTES.push({ key: `${c}_safe_to_send`, path: `/v1/${c}/safe-to-send`, param: "to", re, pattern, ...(valid ? { valid } : {}), price: PRICE_SAFE, deadline: 25000,
    fn: (v, q) => safeToSend(c, v, { from: q.from, token: q.token }), name: `${N} Safe to Send? (pre-transfer recipient check)`, pdesc: `${N} recipient address`, example: exTo, tag: "safe-to-send", chainLabel: N,
    tags: ["safe-to-send", "poisoning", "scam", "drainer", "recipient", c === "bsc" ? "bnb" : c, "security", "crypto"], cardDesc: SAFE_CARD, desc: SAFE_DESC(N),
    extras: [
      { name: "from", re, pattern, ...(valid ? { valid } : {}), desc: `Sender address, optional. Recent counterparties of this ${N} wallet are compared with the recipient for address-poisoning lookalikes.`, example: exFrom },
      { name: "token", re, pattern, ...(valid ? { valid } : {}), desc: `Token contract or mint the sender intends to send, optional. Used only for the heuristic that asks whether a contract recipient looks able to handle that token.`, example: exToken },
    ],
    out: safeOut(c, N, exTo) });
}

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
    desc: `Newest launches (four.meme, PancakeSwap, pump.fun...), up to 20 per chain, risk-checked at request time. Base/BNB: verified source, proxy, owner type, mint/pause/blacklist/fee. Solana: mint/freeze authority, mutable metadata, Token-2022 extensions, holders, curve progress. All: copycat flags (USDC, ETH, SOL...). Plus age, liquidity, FDV, 1h buys/sells. Data: GeckoTerminal. Heuristics, not an audit.`, out: feedOut },
  { key: "base_launch_feed", path: "/v1/base/launches", param: "limit", optional: true, re: LIMIT.re, pattern: LIMIT.pattern, price: PRICE_FEED, fn: v => launches({ chain: "base", limit: v }),
    name: "Base New Token Launch Feed with Risk Flags", pdesc: LIMIT.desc, example: "10", tag: "launches", tags: ["launches", "new-tokens", "base", "security", "crypto"], chainLabel: "Base",
    cardDesc: "Latest new token launches on one chain, up to 20, each with our automated contract-risk check at request time (Sourcify verification, upgradeable proxy, owner type, mint/pause/blacklist/fee selectors, plus a flag for copycats of major tokens like USDC). Base covers Uniswap v2/v3/v4, Aerodrome, Bankr and launchpads (B20 native tokens are labeled as not checkable by bytecode); BNB Chain covers four.meme bonding curves, PancakeSwap v2/v3/Infinity and Uniswap v4. Includes pool DEX, age, liquidity, FDV and 1h buys/sells. Heuristics, not an audit.",
    desc: `Newest launches on Base (Uniswap, Aerodrome, Bankr, launchpads), up to 20, risk-checked at request time: Sourcify verification, upgradeable proxy, owner type, mint/pause/blacklist/fee functions, and a flag for copycats of USDC, ETH, BTC etc. B20 native tokens are labeled as not checkable by bytecode. Plus pool DEX, age, liquidity, FDV and 1h buys/sells. Data: GeckoTerminal. Heuristics, not an audit.`, out: feedOut },
  { key: "bsc_launch_feed", path: "/v1/bsc/launches", param: "limit", optional: true, re: LIMIT.re, pattern: LIMIT.pattern, price: PRICE_FEED, fn: v => launches({ chain: "bsc", limit: v }),
    name: "BNB Chain New Token Launch Feed with Risk Flags", pdesc: LIMIT.desc, example: "10", tag: "launches", tags: ["launches", "new-tokens", "bsc", "bnb", "fourmeme", "pancakeswap", "security", "crypto"], chainLabel: "BNB",
    desc: `Newest token launches on BNB Chain (four.meme, PancakeSwap v2/v3/Infinity, Uniswap v4), up to 20, each risk-checked at request time: Sourcify verification, upgradeable proxy, owner type, mint/pause/blacklist/fee functions, and a flag for copycats of major tokens (USDT, BNB, ETH...) that aren't the real contract. Plus pool DEX, age, liquidity, FDV and 1h buys/sells. Data: GeckoTerminal. Heuristics, not an audit.`,
    out: { ...feedOut, launches: [{ ...feedOut.launches[0], chain: "bsc", pool: { ...feedOut.launches[0].pool, dex: "four-meme", quote: "BNB" } }] } },
  { key: "solana_launch_feed", path: "/v1/solana/launches", param: "limit", optional: true, re: LIMIT.re, pattern: LIMIT.pattern, price: PRICE_FEED, fn: v => launches({ chain: "solana", limit: v }),
    name: "Solana / pump.fun New Token Launch Feed with Risk Flags", pdesc: LIMIT.desc, example: "10", tag: "launches", tags: ["launches", "new-tokens", "solana", "pumpfun", "security", "crypto"], chainLabel: "Solana",
    desc: `Newest token launches on Solana (mostly pump.fun curves, plus PumpSwap/Meteora), up to 20, each with our Solana token check at request time: mint/freeze authority, mutable metadata, Token-2022 extensions, holder concentration excluding curve/pools, curve progress, and a flag for copycats of major tokens (USDC, SOL, USDT...) that aren't the real mint. Plus age, FDV, 1h buys/sells. Data: GeckoTerminal. Heuristics, not an audit.`, out: { ...feedOut, launches: [{ chain: "solana", token: { address: "...pump", symbol: "..." }, pool: { dex: "pump-fun", ageMinutes: 1, fdvUsd: 2866 }, risk: { riskLevel: "low", mintAuthorityActive: false, freezeAuthorityActive: false, metadataMutable: false, pumpfun: { status: "on-curve", progressPct: 2.8 }, top10HoldersPct: 2.2, flags: [] } }] } });

// BNB smart money ($0.02): repeat early buyers of four.meme / PancakeSwap launches that actually ran. Free RPC lookback is about 2 days.
const PRICE_SMART = process.env.PRICE_SMART || "$0.02";
const SM_HITS = { name: "minHits", re: /^([1-9]|10)$/, pattern: "^([1-9]|10)$", desc: "minimum early hits (launches that ran), 1-10 (default 2)", example: "2" };
const smOut = { type: "bsc-smart-money", chain: "bsc", lookback_hours: 36.5, partial: true, count: 1, filters: { limit: 10, minHits: 2, runMultiple: 2, earlyBlocks: 10, firstBuyers: 20 },
  lookback_note: "Free public BNB Chain RPC answered logs about 36.5 hours back on this call. The usual cap is about 48 hours.",
  wallets: [{ wallet: "0x1111111111111111111111111111111111111111", earlyHits: 2, earlyEntries: 3, hitRate: 0.6667, lastSeen: "2026-11-13T18:00:00.000Z",
    sampleTokens: [{ token: "0x2222222222222222222222222222222222222222", symbol: "PECK", entryTime: "2026-11-13T12:00:00.000Z", multiple: 3.4, ran: true }] }],
  disclaimer: "Heuristic. Not financial advice." };
ROUTES.push(
  { key: "bsc_smart_money", path: "/v1/bsc/smart-money", param: "limit", optional: true, re: LIMIT.re, pattern: LIMIT.pattern, price: PRICE_SMART, deadline: 50000, fn: (v, q) => bscSmartMoney({ limit: v, minHits: q.minHits }),
    name: "BNB Chain Smart Money (early buyers of launches that ran)", pdesc: LIMIT.desc, example: "10", tag: "smart-money", chainLabel: "BNB Chain", extra: SM_HITS,
    tags: ["smart-money", "bsc", "bnb", "fourmeme", "pancakeswap", "launches"],
    cardDesc: "Ranks BNB wallets that repeatedly bought in the first blocks of four.meme and PancakeSwap launches that later reached about 2x and are still trading. Returns early hits, hit rate, sample tokens with entry time and an approximate multiple, and last seen. Routers, deployers and bundled sniper clusters are left out. Free BSC logs only cover about 2 days, and lookback_hours says how far this answer reached.",
    desc: "Ranks wallets that bought in the first blocks and first buyers of four.meme and PancakeSwap launches that later reached about 2x and are still trading. Returns early hits, hit rate, sample tokens with entry time and an approximate multiple, and last seen. Drops routers, deployers and bundled snipers. Free BSC logs only go back about 2 days; lookback_hours is the span read. Cached. Partial if a source fails. Not advice.",
    out: smOut },
  { key: "bsc_smart_money_wallet", path: "/v1/bsc/smart-money/:wallet", pathParam: true, param: "wallet", re: ADDR, pattern: AP, price: PRICE_SMART, deadline: 50000, fn: v => bscSmartMoneyWallet(v),
    name: "BNB Chain Smart Money Wallet (recent buys)", pdesc: "BNB Chain wallet address", example: EX.bsc.wallet, tag: "smart-money", chainLabel: "BNB Chain",
    tags: ["smart-money", "bsc", "bnb", "wallet", "launches"],
    cardDesc: "What one BNB wallet bought in the free-RPC window (about 2 days): token, time, size, whether the buy was in the first blocks of a four.meme or PancakeSwap launch, and whether that launch ran. Missing prices stay null.",
    desc: "Lists recent BNB Chain token receipts from a pool, router or other contract: token, time, size, whether the buy was in the first blocks of a four.meme or PancakeSwap launch, and whether that launch ran and is still trading. Same free-RPC window of about 2 days, reported as lookback_hours. Cached. Unknown prices or logs stay null and partial. Not advice.",
    out: { type: "bsc-smart-money-wallet", chain: "bsc", wallet: EX.bsc.wallet, lookback_hours: 30.2, partial: false, count: 1,
      buys: [{ token: "0x2222222222222222222222222222222222222222", symbol: "PECK", time: "2026-11-13T12:00:00.000Z", size: "1000000", early: true, earlyBasis: "first_blocks", status: "ran", multiple: 3.4, stillTrading: true }],
      disclaimer: "Heuristic. Not financial advice." } });

// "Use when" lead line: agents pick tools by reading descriptions, so each one opens with the exact question it answers.
const UW = (r) => { const N = r.chainLabel || (r.key.split("_")[0] in CHAINS ? CHAINS[r.key.split("_")[0]].name : ""); const k = r.key.replace(/^[a-z]+_(?=(tx_explain|token_approvals|address_inspect|contract_risk|honeypot_check|token_verdict|safe_to_send)$)/, "");
  return ({ tx_explain: `what did this ${N} transaction do?`, token_approvals: `which token approvals on this ${N} wallet should I revoke?`, address_inspect: `what is this ${N} address (wallet, contract, proxy, token)?`,
    contract_risk: `is this ${N} contract risky (owner, proxy, mint, pause, blacklist)?`, honeypot_check: `can I sell this ${N} token, and what is the buy/sell tax?`,
    token_verdict: `should I buy this ${N} token (quick SAFE / CAUTION / AVOID)?`,
    safe_to_send: `is it safe to send to this ${N} address?`,
    url_safety_check: "is this link a phishing or scam site?", gas_snapshot: "how much gas will a transfer or swap cost right now?", ens_resolve: "what address is behind this ENS name or Basename (or vice versa)?",
    calldata_decode: "what am I about to sign with this calldata?", wallet_portfolio: "what tokens does this wallet hold on Base, Ethereum and BNB?", wallet_report: "is this wallet safe (approvals, delegation, balances) in one report?",
    token_report: "should I trust this token contract (owner, supply, flags)?", token_deep_scan: "is this token a honeypot or rug (sell sim, liquidity, LP lock, holders)?",
    solana_token_check: "is this Solana or pump.fun token a rug (authorities, holders)?", solana_address_lookup: "what is this Solana address and what does it hold?",
    solana_token_delegates: "which token delegates on this Solana wallet should I revoke?", approval_sweep_all_chains: "which approvals on this wallet should I revoke, on every EVM chain?",
    bsc_bundle_sniper_check: "was this BNB token bundled or sniped at launch?",
    bsc_smart_money: "which BNB wallets keep buying early into launches that then run?",
    bsc_smart_money_wallet: "what did this BNB wallet buy recently, and was it early?" })[k] || (r.path.startsWith("/v1/launches") || /launch/.test(r.key) ? `what tokens just launched on ${N || "these chains"}, and are they risky?` : null); };
for (const r of ROUTES) { const q = UW(r); if (!q) { console.error("no use-when for", r.key); continue; } r.desc = `Use when: ${q} ${r.desc}`; }
// CDP facilitator /verify rejects any paymentPayload whose resource.description is over 500 chars (x402 issue #2832). Keep every desc <= 500.
for (const r of ROUTES) if (r.desc.length > 500) console.error(`desc too long (${r.desc.length}) for ${r.path}: CDP will reject payments`);
const app = express();
app.set("trust proxy", true);
// Never let a slow facilitator block the 402. On a cold instance the x402 middleware awaits facilitator /supported before answering
// (default timeout 90 s, plus 429 back-off). We wait at most SUPPORTED_WAIT_MS, then fall back to the one kind we use; the exact-EVM
// scheme ignores supported-kind details when building requirements, so the 402 is identical. verify/settle still go to the real facilitator.
const SUPPORTED_WAIT_MS = Number(process.env.SUPPORTED_WAIT_MS || 2000);
export const SUPPORTED_FALLBACK = { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: {} };
const facClient = new HTTPFacilitatorClient(facCfg); let supportedCache = null;
const liveSupported = facClient.getSupported.bind(facClient);
facClient.getSupported = () => {
  if (supportedCache) return Promise.resolve(supportedCache);
  const live = liveSupported().then(x => (supportedCache = x)); live.catch(e => console.warn("facilitator /supported unavailable, using fallback:", String(e?.message || e).slice(0, 160)));
  return Promise.race([live, new Promise(r => setTimeout(() => r(SUPPORTED_FALLBACK), SUPPORTED_WAIT_MS).unref?.())]).catch(() => SUPPORTED_FALLBACK);
};
// Hard cap per paid call, well under the 60 s function limit. A timed-out call answers 504 and, being >= 400, is never settled (no charge).
const ROUTE_DEADLINE_MS = Number(process.env.ROUTE_DEADLINE_MS || 25000);
export const withDeadline = (p, ms = ROUTE_DEADLINE_MS) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(`upstream timeout after ${ms} ms`), { status: 504 })), ms); })]).finally(() => clearTimeout(t)); };
const server = new x402ResourceServer(facClient).register(NETWORK, new ExactEvmScheme()).registerExtension(bazaarResourceServerExtension).registerExtension(builderCodeResourceServerExtension);
server.onBeforeSettle(async (ctx) => { // backfill resource if a client omits it, so the facilitator can catalog
  const p = ctx?.paymentPayload; if (!p || p.resource?.url) return;
  const tc = ctx.transportContext || {}; const path = tc.request?.path || tc.adapter?.getPath?.() || tc.path || "";
  const r = ROUTES.find(r => path === r.path); if (r) p.resource = { url: ORIGIN + r.path, description: r.desc, mimeType: "application/json" };
});
const routeValue = (r, req) => r.pathParam ? req.params[r.param] : req.query[r.param];
const health = (_, res) => res.json({ ok: true, network: NETWORK, payTo: PAY_TO, mcp: ORIGIN + "/mcp", openapi: ORIGIN + "/openapi.json", chains: [...Object.keys(CHAINS), "solana"], lookupOnlyChains: LOOKUP_ONLY_CHAINS,
  endpoints: ROUTES.map(r => ({ url: r.pathParam ? `${ORIGIN}${r.path.replace(/:([A-Za-z0-9_]+)/g, "<$1>")}` : `${ORIGIN}${r.path}?${r.param}=<${r.param}>`, price: r.price, description: r.desc })) });
app.get("/health", health); mountLanding(app, { ROUTES, ORIGIN, PAY_TO, health }); mountCheck(app, { ORIGIN, PAY_TO, PRICE: PRICE_PREMIUM, PRICE_DEEP, PRICE_SOL: PRICE_SMALL, PRICE_SWEEP, PRICE_BUNDLE, PRICE_HONEYPOT, PRICE_VERDICT, PRICE_SAFE });

// Validate before charging: bare paymentless request -> 402 (discovery probes); bad input -> free 400.
const hasPay = req => !!(req.get("payment-signature") || req.get("x-payment"));
const routeExtras = r => [r.extra, ...(r.extras || [])].filter(Boolean);
const extraOk = (ex, v) => typeof v === "string" && ex.re.test(v) && (!ex.valid || ex.valid(v));
for (const r of ROUTES) app.get(r.path, (req, res, next) => {
  const v = routeValue(r, req);
  for (const ex of routeExtras(r)) if (req.query[ex.name] !== undefined && !extraOk(ex, req.query[ex.name])) return res.status(400).json({ error: `query param ${ex.name} must match ${ex.pattern}` });
  if (v === undefined && (!hasPay(req) || r.optional)) return next();
  if (typeof v !== "string" || !r.re.test(v) || (r.valid && !r.valid(v))) return res.status(400).json({ error: `${r.pathParam ? "path" : "query"} param ${r.param} must match ${r.pattern}` });
  if (r.param === "url") { try { const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v); if (!["http:", "https:"].includes(u.protocol)) throw 0; } catch { return res.status(400).json({ error: "url must be an http(s) URL or hostname" }); } }
  next();
});
const prop = (pattern, desc, maxLen) => ({ type: "string", pattern, ...(maxLen ? { maxLength: maxLen } : {}), description: desc });
const routeCfg = {};
for (const r of ROUTES) { const extras = routeExtras(r);
  const discovery = r.pathParam
    ? declareDiscoveryExtension({ method: "GET", input: {}, inputSchema: { properties: {} }, pathParams: { [r.param]: r.example }, pathParamsSchema: { properties: { [r.param]: prop(r.pattern, r.pdesc, r.maxLen) }, required: [r.param] }, output: { example: r.out } })
    : declareDiscoveryExtension({ method: "GET", input: { [r.param]: r.example, ...Object.fromEntries(extras.filter(e => e.example != null).map(e => [e.name, e.example])) },
      inputSchema: { properties: { [r.param]: prop(r.pattern, r.pdesc, r.maxLen), ...Object.fromEntries(extras.map(e => [e.name, prop(e.pattern, e.desc, e.maxLen)])) }, required: r.optional ? [] : [r.param] }, output: { example: r.out } });
  routeCfg["GET " + r.path] = {
  accepts: [{ scheme: "exact", price: r.price, network: NETWORK, payTo: PAY_TO }], description: r.desc, mimeType: "application/json",
  resource: ORIGIN + r.path, serviceName: r.name, tags: r.tags || (r.param === "url" ? ["security", "phishing", "url", "web"] : [r.tag || r.path.split("/")[2], "onchain", "evm", "crypto"]),
  extensions: { ...builderExt, ...discovery } }; }
// Mirror the PAYMENT-REQUIRED header into the 402 body (it is otherwise "{}") so indexers and clients that read the body (x402 v1 style) see the same accepts[].
app.use((req, res, next) => { if (!req.path.startsWith("/v1/")) return next(); const end = res.end;
  res.end = function (chunk, ...rest) { try { if (res.statusCode === 402 && !res.headersSent && (!chunk || String(chunk) === "{}")) { const h = res.getHeader("payment-required");
    if (h) { chunk = Buffer.from(String(h), "base64").toString("utf8"); res.setHeader("content-type", "application/json; charset=utf-8"); res.setHeader("content-length", Buffer.byteLength(chunk)); } } } catch {}
    return end.call(this, chunk, ...rest); }; next(); });
// The bundle check only reaches ~2 days of BNB log history, so any fixed sample token ages out. Keep the advertised sample fresh:
// every 6 h (non-blocking) swap in a recent four.meme launch (new token, not just a new pool) from our own feed that is at least 3 min old (launch block + 10 blocks long done).
let bxAt = 0; const bxQ = () => routeCfg["GET /v1/bsc/bundles"]?.extensions?.bazaar?.info?.input?.queryParams;
app.use((req, res, next) => { if (Date.now() - bxAt > 6 * 3600e3 && bxQ()) { bxAt = Date.now();
  launches({ chain: "bsc", limit: 20 }).then(f => { const l = (f.launches || []).find(x => x.chain === "bsc" && /four/.test(x.pool?.dex || "") && (x.pool?.ageMinutes ?? 0) >= 3 && /^0x[0-9a-fA-F]{40}$/.test(x.token?.address || ""));
    if (l) bxQ().token = l.token.address; }).catch(() => { bxAt = Date.now() - 5.5 * 3600e3; }); } next(); });
// Precompute. Not a paid route. Vercel Cron sends Authorization: Bearer $CRON_SECRET when that env var is set.
app.get("/cron/smart-money", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get("authorization") !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });
  try { res.json(await runSmartMoneyCron()); }
  catch (e) { res.status(e.status || 500).json({ error: "smart-money cron failed", detail: String(e.message || e).slice(0, 300) }); }
});
app.use(paymentMiddleware(routeCfg, server));
for (const r of ROUTES) app.get(r.path, async (req, res) => {
  try { res.json(await withDeadline(r.fn(routeValue(r, req), req.query), r.deadline)); }
  catch (e) { res.status(e.status || 404).json({ error: e.status === 400 ? e.message : e.status === 504 ? "upstream timeout, not charged" : "not found or upstream error", detail: String(e.shortMessage || e.message).slice(0, 300) }); }
});

// Free delayed launch feed (for posts, bots, and trying before buying). CDN-cached 10 min.
app.get("/free/launches", async (req, res) => {
  const c = req.query.chain ?? "all"; if (typeof c !== "string" || !/^(all|base|bsc|solana)$/.test(c)) return res.status(400).json({ error: "chain must be all | base | bsc | solana" });
  try { const d = await launchesDelayed({ chain: c }); res.set("cache-control", "public, max-age=60, s-maxage=600, stale-while-revalidate=300"); res.json(d); }
  catch (e) { res.status(503).json({ error: "upstream error", detail: String(e.message).slice(0, 200) }); }
});
app.get("/openapi.json", (_, res) => res.json({ openapi: "3.1.0",
  info: { title: "Automaton Onchain & URL Tools", version: "1.16.0", contact: { name: "Automaton", url: ORIGIN + "/health" },
    description: "Pay-per-call utilities via x402 (USDC on Base): tx explainer, token approvals, address inspector and contract-risk heuristics for Base, Ethereum and BNB Smart Chain, plus the same four lookups for Arbitrum, Optimism, Polygon and Avalanche C-Chain at $0.005 each (with a copycat-token flag), a Solana token check (SPL, Token-2022, pump.fun), Solana address lookups and token-delegate (approval) checks at $0.005 each, URL safety checks, plus $0.25 premium wallet and token reports and a $1.50 token deep scan (honeypot buy/sell simulation, liquidity, LP lock, holder concentration), and a new-token launch feed for Base, BNB Chain (four.meme, PancakeSwap) and Solana/pump.fun with automated risk flags on each launch ($0.01 per chain, $0.02 for all three; free delayed sample at GET /free/launches), plus a $0.01 honeypot check for Base, Ethereum and BNB Chain (simulated buy + sell: sellable yes/no, buy and sell tax), a $0.02 quick token verdict for those three chains (SAFE / CAUTION / AVOID, bundling sellability, tax, owner powers, LP burn/lock and holder concentration), a $0.01 BNB Chain bundle + sniper check for four.meme / PancakeSwap launches (launch-block buyers, bundled txs, shared funders, % of supply grabbed and still held, dev in cluster), a $0.02 BNB Chain smart-money feed (wallets that repeatedly bought early into four.meme and PancakeSwap launches that then ran, plus one wallet's recent buys; free public RPC logs only, about 2 days, reported as lookback_hours), plus a $0.02 all-chain approval sweep (live ERC-20 allowances and NFT approvals on all 7 EVM chains, risk-ranked, with ready-to-sign revoke txs), plus a $0.005 safe-to-send pre-transfer recipient check on all 8 chains (safe / caution / danger: address-poisoning lookalikes, free scam/drainer flags, contract token handling, fresh empty addresses; every signal is a heuristic).",
    "x-guidance": "GET an endpoint with its query param; answer the 402 with an x402 v2 exact-scheme USDC payment on eip155:8453 (PAYMENT-SIGNATURE header). Invalid input is rejected with 400 before any charge. MCP: POST /mcp (streamable HTTP, paid tools)." },
  servers: [{ url: ORIGIN }],
  paths: Object.fromEntries(ROUTES.map(r => [r.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}"), { get: { operationId: r.key, summary: r.name, description: r.desc,
    "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: r.price.replace("$", "") }, protocols: [{ x402: {} }] },
    parameters: [...(r.pathParam ? [{ name: r.param, in: "path", required: true, description: r.pdesc, schema: { type: "string", pattern: r.pattern } }] : [{ name: r.param, in: "query", required: !r.optional, description: r.pdesc, schema: { type: "string", pattern: r.pattern } }]), ...routeExtras(r).map(e => ({ name: e.name, in: "query", required: false, description: e.desc, schema: { type: "string", pattern: e.pattern } }))],
    responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object" }, example: r.out } } }, 400: { description: "Invalid input (no charge)" }, 402: { description: "Payment Required" } } } }])) }));
app.get("/.well-known/mcp-registry-auth", (_, res) => res.type("text/plain").send("v=MCPv1; k=ed25519; p=Gkkq+F+PxBJofd16J+xJpg6E+nXM7MWO29cD3+IKe0U="));
app.get("/.well-known/x402", (_, res) => res.json({ version: 1, resources: ROUTES.map(r => ORIGIN + r.path) }));

// ---- MCP (stateless streamable HTTP; each paid tool call settles via x402) ----
let mcpReady;
async function buildMcp() {
  await server.initialize();
  const wrap = {};
  for (const r of ROUTES) { const extras = routeExtras(r); wrap[r.key] = createPaymentWrapper(server, {
    accepts: await server.buildPaymentRequirements({ scheme: "exact", network: NETWORK, payTo: PAY_TO, price: r.price }),
    resource: { url: `${ORIGIN}/mcp#${r.key}`, description: r.desc, mimeType: "application/json", serviceName: r.name, tags: ["mcp", ...(r.param === "url" ? ["security"] : ["onchain"])] },
    extensions: { ...builderExt, ...declareDiscoveryExtension({ toolName: r.key, description: r.desc, inputSchema: { properties: { [r.param]: prop(r.pattern, r.pdesc, r.maxLen), ...Object.fromEntries(extras.map(e => [e.name, prop(e.pattern, e.desc, e.maxLen)])) }, required: r.optional ? [] : [r.param] }, example: { [r.param]: r.example, ...Object.fromEntries(extras.filter(e => e.example != null).map(e => [e.name, e.example])) } }) } }); }
  return () => {
    const m = new McpServer({ name: "automaton-onchain-tools", version: "1.16.0" });
    const txt = o => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
    for (const r of ROUTES) { const zz = r.param === "url" ? z.string().min(4).max(r.param === "data" ? 8010 : 2048) : z.string().regex(r.re);
      m.tool(r.key, `${r.desc} Costs ${r.price}.`, { [r.param]: r.optional ? zz.optional() : zz, ...Object.fromEntries(routeExtras(r).map(e => [e.name, z.string().regex(e.re).optional()])) }, wrap[r.key](async a => { try { return txt(await withDeadline(r.fn(a[r.param], a), r.deadline)); } catch (e) { return { isError: true, ...txt({ error: String(e.shortMessage || e.message).slice(0, 300) }) }; } })); }
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
