# Automaton Onchain Tools

[![M8ven Score](https://m8ven.ai/badge/mcp/povrouyre-wq-automaton-onchain-tools-1wyi9g?v=0e560c4d737408fa245aa4e54cf10936)](https://m8ven.ai/mcp/povrouyre-wq-automaton-onchain-tools-1wyi9g?s=readme)

Pay-per-call crypto and security APIs for AI agents. You pay with **x402**: $0.005 to $0.02 per call in **USDC on Base** (`eip155:8453`). There's no signup and no API key. An MCP server is included.

**Live:** https://automaton-tx-explainer.vercel.app · [OpenAPI](https://automaton-tx-explainer.vercel.app/openapi.json) · [llms.txt](https://automaton-tx-explainer.vercel.app/llms.txt) · [x402 discovery](https://automaton-tx-explainer.vercel.app/.well-known/x402)

**Not an agent?** [/check](https://automaton-tx-explainer.vercel.app/check) is a web page where anyone can buy the $0.005 safe-to-send check, the $0.02 quick token verdict, the $0.25 wallet or token report, or the $1.50 token deep scan, with a browser wallet (MetaMask, Coinbase Wallet, etc.) using the same x402 flow. Page sources are in `check-src/`; `node check-src/build.mjs` (needs `esbuild`) regenerates `check-assets.js`.

## Endpoints

`{chain}` is one of `base`, `ethereum`, `bsc`, `arbitrum`, `optimism`, `polygon` or `avalanche` (C-Chain). Safe to send also accepts `solana`. With the Solana token check, the Solana address and delegate lookups, the launch feeds, the three quick-verdict routes and the eight safe-to-send routes that gives 59 paid tools.

**Arbitrum, Optimism, Polygon and Avalanche** get the four per-chain lookups only (tx, approvals, address, contract-risk), all at **$0.005**, and their address and contract-risk responses carry the copycat-token flag (see below). They are not part of the gas snapshot, portfolio, wallet/token reports, deep scan or launch feeds, which stay on Base, Ethereum and BNB Chain.

| Tool | Endpoint | Price | What it does |
|---|---|---|---|
| Tx Explainer | `GET /v1/{chain}/tx?hash=0x…` | $0.01 ($0.005 on the four lookup-only chains) | Status, fee, decoded method + args, ERC-20 transfers |
| Token Approval Check | `GET /v1/{chain}/approvals?address=0x…` | $0.005 | Allowances of major tokens to common spenders; flags unlimited |
| Address Inspector | `GET /v1/{chain}/address?address=0x…` | $0.005 | EOA / contract / EIP-7702, balance, proxy impl, ERC-20 metadata |
| Contract Risk Heuristics | `GET /v1/{chain}/contract-risk?address=0x…` | $0.01 ($0.005 on the four lookup-only chains) | Sourcify verification, proxy/admin, owner type, mint/pause/blacklist/fee selectors |
| URL Safety Check | `GET /v1/url-safety?url=…` | $0.005 | Phishing blocklists, domain age (RDAP), punycode/lookalikes, HTTPS |
| Multi-chain Gas Snapshot | `GET /v1/gas?chain=all` | $0.005 | Gas price, base fee, utilization, est. cost of transfer/ERC-20/swap |
| ENS / Basename Resolver | `GET /v1/ens?name=vitalik.eth` | $0.005 | Name to address + text records, or reverse lookup |
| Calldata Decoder | `GET /v1/decode?data=0x…` | $0.005 | Decode calldata before signing, with plain-English warnings |
| Wallet Portfolio | `GET /v1/portfolio?address=0x…` | $0.01 | Native + 8 major token balances on Base, Ethereum, BNB |
| Wallet Security Report | `GET /v1/wallet-report?address=0x…` | $0.25 | One-call wallet report across 3 chains: balances, approvals, 7702 delegation, plain-English summary |
| Token Due-Diligence Report | `GET /v1/token-report?address=0x…&chain=base` | $0.25 | Metadata, proxy, owner/admin, owner holdings, Sourcify, mint/pause/blacklist/fee flags |
| **Solana Token Check** | `GET /v1/solana/token?address=<mint>` | $0.005 | SPL / Token-2022 / pump.fun mint: mint + freeze authority, metadata mutability (Metaplex isMutable / Token-2022 metadata), risky Token-2022 extensions (transfer fee, permanent delegate, transfer hook, pausable, default-frozen), top-holder concentration with pools and the bonding curve excluded where identifiable, pump.fun curve progress or PumpSwap LP burn share. Free public Solana RPC only; lists what it couldn't determine |
| **Solana Address Lookup** | `GET /v1/solana/address?address=<pubkey>` | $0.005 | Account type (wallet, mint, token account, program, program-owned), SOL balance, SPL and Token-2022 balances with names (no USD prices), wallet age from the first transaction (lower bound for very busy wallets), last active, tx counts for 24h/7d/30d, recent transactions, flags for fake copycat tokens, frozen accounts and live delegates |
| **Solana Token Delegate Check** | `GET /v1/solana/delegates?address=<pubkey>` | $0.005 | Live SPL / Token-2022 delegates (Solana's token approvals): how much each delegate can move, unlimited flag, whether it's a plain wallet, a known program (Jupiter, Raydium, Orca, Meteora, pump.fun) or unknown; also permanent delegates on held Token-2022 tokens and foreign close authorities. Risk level and how to revoke |
| **All-Chain Approval Sweep** | `GET /v1/approvals/sweep?address=0x...` | $0.02 | One call sweeps Base, Ethereum, BNB Chain, Arbitrum, Optimism, Polygon and Avalanche for live ERC-20 allowances and NFT `setApprovalForAll` approvals, ranks them by risk (unlimited amount, unknown spender, unverified or non-contract spender, GoPlus-flagged spender) and returns a ready-to-sign revoke tx (`to`, `data`, `chainId`, value 0) for each risky one. Per-chain status; one chain failing still returns the others |
| **Honeypot Check (Base, Ethereum, BNB Chain)** | `GET /v1/{base\|ethereum\|bsc}/honeypot?token=0x...` | $0.01 | Can you actually sell it? Simulates a small buy and a sell back into the token's deepest WETH/WBNB pool (Uniswap V2/V3, Aerodrome, SushiSwap V2, PancakeSwap V2/V3) with one `eth_call` + state override, so nothing trades. Returns `sellable`, `buyTaxPct`, `sellTaxPct`, the pool used, a verdict (sellable, taxed, high tax, honeypot) and coverage notes. No pool, not a token or an inconclusive simulation is not charged. |
| **Quick Token Verdict (Base, Ethereum, BNB Chain)** | `GET /v1/{base\|ethereum\|bsc}/verdict?token=0x...` | $0.02 | SAFE, CAUTION or AVOID in one call, plus the raw flags: sellable, buy/sell tax, owner renounced, proxy, mint/pause/blacklist/fee, LP burned or locked %, top 10 holders excluding pools and burn, and a copycat-of-a-major-token flag. Same simulation and reads as the honeypot check, contract-risk scan and deep-scan holder/LP code. No pool, not a token or an inconclusive simulation is not charged. MCP tools: `base_token_verdict`, `ethereum_token_verdict`, `bsc_token_verdict`. |
| **Safe to Send? (all 8 chains)** | `GET /v1/{chain}/safe-to-send?to=…&from=…&token=…` | $0.005 | Pre-transfer check of the recipient. Verdict is `safe`, `caution` or `danger`. `to` is required. `from` (optional) turns on the address-poisoning lookalike check against that sender's recent counterparties. `token` (optional) is the token the agent intends to send. Heuristics only: lookalike prefix/suffix, dust-only spam history, free GoPlus scam/drainer flags on EVM, whether a contract looks unable to handle the token, and a fresh empty address (no history, zero native balance). Solana is included; it has no free address-flag source here and the response says so. Bad input is a free 400. |
| **BNB Chain Bundle + Sniper Check** | `GET /v1/bsc/bundles?token=0x...` | $0.01 | For a four.meme or PancakeSwap launch: finds the launch block, reads the next 10 blocks and clusters launch-block buyers, bundled txs, dev hand-outs and wallets BNB-funded by the dev or a shared wallet in the 40 blocks before launch. Returns % of supply grabbed, % still held, dev-in-cluster, risk verdict and an honest `coverage` field (free public RPC: 50k-block log chunks, recent history only). Failed/timed-out calls are not charged. |
| **Launch Feed (Base + BNB + Solana)** | `GET /v1/launches?chain=all&limit=10` | $0.02 | Newest token launches on Base, BNB Chain (four.meme, PancakeSwap) and Solana (mostly pump.fun), up to 20 per chain, each run through our risk check at request time: pool DEX, age, liquidity, FDV, 1h buys/sells, plus risk level and flags |
| **Base Launch Feed** | `GET /v1/base/launches?limit=10` | $0.01 | Base only: verified source, upgradeable proxy, owner type, mint/pause/blacklist/fee selectors on each new token (B20 native tokens are labeled as not checkable by bytecode) |
| **BNB Chain Launch Feed** | `GET /v1/bsc/launches?limit=10` | $0.01 | BNB Chain only (four.meme bonding curves, PancakeSwap v2/v3/Infinity, Uniswap v4): verified source, upgradeable proxy, owner type, mint/pause/blacklist/fee selectors on each new token |
| **Solana Launch Feed** | `GET /v1/solana/launches?limit=10` | $0.01 | Solana only: mint/freeze authority, metadata mutability, Token-2022 extensions, holder concentration, pump.fun curve progress on each new mint |
| **Token Deep Scan** | `GET /v1/token/deep-scan?address=0x…&chain=base` | $1.50 | Simulated buy + sell against the main DEX pool (honeypot and buy/sell tax), main pool liquidity in USD, V2 LP burned/locked share, top-holder concentration, owner powers, and a list of what it couldn't determine |

### Arbitrum, Optimism, Polygon and Avalanche lookups

- **Data:** free public RPCs with a fallback (Arbitrum `arb1.arbitrum.io` + publicnode, Optimism `mainnet.optimism.io` + publicnode, Polygon publicnode + `polygon-rpc.com`, Avalanche `api.avax.network` + publicnode; override with `ARB_RPC`, `OP_RPC`, `POLYGON_RPC`, `AVAX_RPC`, comma-separated). Source verification is Sourcify, which supports all four chains; if Sourcify can't be reached the response says so (`verified: null` plus an info finding) instead of guessing.
- **Approvals:** 8 major tokens per chain (native USDC and bridged USDC.e, USDT/USDT0, WETH, WBTC/BTC.b, DAI, plus ARB, OP, WPOL or WAVAX/JOE) against 8-10 spenders: Permit2, Uniswap Universal Router (v4 and older), SwapRouter02, 1inch v6, LI.FI, Odos v2, the 0x Exchange Proxy where it is deployed (not on Optimism), Velodrome v2 (Optimism), QuickSwap (Polygon) and LFJ/Trader Joe (Avalanche). Addresses come from Circle, Uniswap's deployment docs and Sourcify/Routescan verified contract names, and were checked onchain.
- **Copycat flag:** `/address` adds `copycat` and `/contract-risk` adds `copycat` plus a finding (and raises risk to at least `medium`) when a token's name or symbol copies a major asset but its address isn't that chain's official one. On these chains ARB, OP, POL/WPOL/MATIC/WMATIC, AVAX/WAVAX and USDT0 count as majors too, only on their home chain.

### How the approval sweep works
- **Discovery (free, keyless):** GoPlus approval-security data (ERC-20 on Ethereum, BNB, Base, Arbitrum, Polygon; NFTs on Ethereum, BNB, Arbitrum, Polygon), `Approval` / `ApprovalForAll` event logs where the owner is the wallet from Routescan (Ethereum, Avalanche) and Blockscout (Ethereum, Optimism, Base, Arbitrum, Polygon, when reachable), plus our major-token x common-spender pairs on every chain.
- **Everything is re-read onchain** (`allowance()` / `isApprovedForAll()` via Multicall3), so revoked or stale index entries never show as live. Unlimited = at least 2^96-1.
- **Spender checks:** known label (per-chain list; same-address contracts like Uniswap's SwapRouter only count where that chain's verified name matches), EOA / EIP-7702 / contract via `eth_getCode`, verified source via GoPlus or Sourcify, GoPlus malicious flags.
- **Risk score:** flagged +10, plain-wallet spender +5, unlimited (or approve-all NFTs) +3, unknown spender +2, unverified contract +2, wallet holds the token +1. High >= 7, medium >= 3. Medium and high get a `revokeTx`.
- **Not covered:** single-NFT `approve`, Permit2 sub-allowances, unused off-chain permits. BNB Chain has no free event-log index, so it relies on GoPlus + known pairs. Output lists the 200 riskiest approvals.

### How the launch feed works

- **Source:** GeckoTerminal's free public `new_pools` API for `base`, `bsc` and `solana` (newest pools first, deduplicated to one row per new token, majors like WETH/WBNB/USDT/USDC/SOL skipped). On Base that covers Uniswap v2/v3/v4, Aerodrome, Bankr, Clanker-style launchpads and anything else GeckoTerminal indexes; on BNB Chain it is four.meme bonding curves, PancakeSwap v2/v3/Infinity and Uniswap v4; on Solana it is mostly pump.fun bonding curves plus PumpSwap/Meteora pools. Data by GeckoTerminal.
- **Risk:** each token goes through the same code as `/v1/base/contract-risk`, `/v1/bsc/contract-risk` or `/v1/solana/token`, at request time, cached about 10 minutes per token. Results are summarized to a risk level plus flags.
- **No database, no cron:** everything is computed when you call it, so rows are as fresh as GeckoTerminal (usually under a minute). Upstream pages are cached 45 s.
- **Copycat flag:** if a token's symbol or name matches a major asset (USDC, USDT, ETH, WETH, BTC, WBTC, cbBTC, SOL, BNB, WBNB, DAI, BUSD, FDUSD, PYUSD, USD1, USDe, USDS and similar, case-insensitive, ignoring spaces, punctuation and Cyrillic/Greek lookalike letters) but its address isn't that chain's official contract or mint, it gets the flag "name copies a major token (SYM) but isn't the real contract" and its risk is raised to at least `medium`. The official address list lives in `impersonation.js`; real tokens are never flagged. The same check runs in the Solana token check and the token report / deep scan.
- **Free delayed sample:** `GET /free/launches?chain=all|base|bsc|solana` returns up to 5 launches per chain with risk level and short flags. Base and BNB Chain rows are at least 15 minutes old; Solana rows come from the oldest page GeckoTerminal serves (about 5–10 minutes) and the response is CDN-cached for 10 minutes, so roughly 5–20 minutes behind.
- **Limits:** if GeckoTerminal is down or rate-limits us, the paid response says so in `errors`. B20 (Base native precompile) tokens can't be checked by bytecode and are marked `unknown`. On BNB Chain, four.meme tokens are owned by the launchpad contract while on the curve and its template exposes a blacklist-style function, so most of them show up as `medium`. Not an audit; most new launches fail.

### How the quick verdict works

`GET /v1/{base|ethereum|bsc}/verdict?token=0x…` is $0.02. It answers SAFE, CAUTION or AVOID and returns the same flags agents otherwise buy one at a time. Rules (also commented in `verdict.js`):

- **AVOID** if the simulated sell fails, buy tax + sell tax is at least 10% (at least 50% is `critical`), a non-renounced owner can mint or blacklist, the top 10 holders excluding pools and burn own at least 50%, or the name/symbol copies a major token at a non-official address.
- **CAUTION** if combined tax is 3% up to 10%, the contract is a proxy or upgradeable, LP burned/locked is under 50% or unknown (V3 positions are unknown), top 10 is 20% up to 50%, the holder list is only a partial recent-transfer sample, a live owner can pause or change fees, or the contract-risk read failed.
- **SAFE** only when it is sellable, combined tax is under 3%, LP burn/lock is at least 50% and conclusive, and none of the triggers above fired. Missing holder data is listed and does not invent a percentage. Leftover notes (renounced admin selectors, unverified Sourcify source, a non-renounced owner with no dangerous selector) stay in `findings`.

The sell test is the honeypot checker. Owner powers are `contractRisk`. Holders and LP burn/lock are the deep-scan helpers, on the same public RPCs. No pool, not a token, or an inconclusive simulation is a 422 and is not charged. Bad input is a free 400.

### How the safe-to-send check works

`GET /v1/{chain}/safe-to-send?to=…` is $0.005 on `base`, `ethereum`, `bsc`, `arbitrum`, `optimism`, `polygon`, `avalanche` and `solana`. It answers `safe`, `caution` or `danger` before a transfer. Optional `from` is the sender. Optional `token` is the token contract or mint being sent. Every reason has `heuristic: true`.

- **Address poisoning:** when `from` is set, recent counterparties come from the same Blockscout and Routescan hosts the approval sweep uses (tx list and token transfers, most recent 80). The recipient is flagged `danger` only when it is a different address that shares at least 4 leading and 4 trailing characters with one of those counterparties (hex on EVM, base58 on Solana). BNB Chain has no free keyless tx index here, so that chain falls back to recent ERC-20 `Transfer` logs over about 800 blocks and says so.
- **Dust spam:** `caution` when the recipient's visible history is only zero-value or dust incoming transfers and the senders look like poisoning spam (a lookalike of a known counterparty, lookalikes of each other, or three or more distinct zero-value senders). A normal small payment does not trip this.
- **Scam / drainer flags:** free GoPlus address security, the same vendor the approval sweep already uses. Stealing, phishing, honeypot-related, blackmail and cybercrime are `danger`. Other GoPlus crime labels are `caution`. No flag is not a clean bill. Solana is not covered by that free API; the response lists it under `couldNotDetermine` and does not call the address safe because of that gap.
- **Contract:** reports whether `to` has code. If `token` is set and `to` is that token's own contract, the verdict is `danger` (tokens sent to their own contract are often stuck). If `to` is some other contract and the bytecode, including a proxy implementation when one is found, has no `transfer`, `transferFrom` or generic execute selector, the verdict is `caution`. That selector scan misses odd dispatch and can be wrong. On Solana, a program, a mint, a token account for a different mint, or another program-owned account is `caution` when `token` is set.
- **Fresh / empty:** `caution` when nonce (or Solana signature count) is 0, native balance is 0, and the history source returned no transactions. If history could not be loaded, the warning is marked partial.

`safe` means none of those positive signals fired on the checks that completed. Items that could not be loaded stay in `couldNotDetermine` and do not get invented into a danger label. Bad input is a free 400. A failed recipient read is a 502 and is not charged.

After deploy, index the three routes on CDP Bazaar with one paid call each ($0.06 total, settled to the service wallet):

```bash
PRIVATE_KEY=0x... node scripts/self-pay-verdict.mjs
```

`PRIVATE_KEY` is the buyer wallet from the x402 fetch example above. This environment does not ship a key.

### How the deep scan works

- **Honeypot / tax test:** a small simulator contract (`sim-src/Sim.sol`) is injected with an `eth_call` state override, wraps native coin, buys from the deepest WETH/WBNB pool (Uniswap V2/V3, Aerodrome, SushiSwap, PancakeSwap V2/V3), then approves + `transferFrom`s the tokens back into the pool and sells. Nothing is ever sent onchain. Buy tax = requested vs received tokens; sell tax = sent vs what the pool received.
- **Liquidity:** pools are found onchain via the DEX factories; USD value uses the onchain native/stable price.
- **LP lock:** for V2-style pools, share of LP at `0x0`/`0x…dEaD`, held by the token contract, or by Blockscout-labeled lockers. V3 positions are NFTs, so lock status is reported as not determinable.
- **Holders:** Blockscout's public API where it answers (Ethereum; Base when reachable). Otherwise a clearly-marked *partial* list built from recent Transfer logs + live `balanceOf`.
- Tests: `node --test tests/` runs against real tokens (Base USDC, BRETT, DEGEN, Ethereum PEPE, BNB CAKE) plus synthetic honeypot and 10%-tax tokens built with state overrides.

### How the Solana check works

- Reads the mint with `getAccountInfo` (jsonParsed) for authorities and Token-2022 extensions, the Metaplex metadata PDA for name/symbol/update authority/`isMutable`, and `getTokenLargestAccounts` (top 20 accounts, grouped by owner) for holders.
- Owners that are off the ed25519 curve are program accounts. If the owning program is a known AMM (PumpSwap, Raydium, Orca, Meteora DLMM) or the pump.fun bonding curve, it's labeled and excluded from the top-10 wallet figure; unknown program owners are excluded and labeled *uncertain*.
- pump.fun: the bonding-curve PDA tells whether the coin is still on the curve (with approximate progress) or graduated. For graduated coins the PumpSwap pool's LP mint supply is compared with the LP originally minted to get the burned share. LP lock for non-pump.fun tokens is not determined. There is no sell simulation on Solana.
- RPC: `SOLANA_RPC` (comma-separated), default `api.mainnet-beta.solana.com` then `public.rpc.solanavibestation.com` as fallback. Tests: `tests/solana.test.mjs` (BONK, USDC, Fartcoin, a PumpSwap-graduated coin and a fresh on-curve pump.fun coin).

**Timeouts:** the 402 never waits on the facilitator for more than ~2 s on a cold start (it falls back to the one payment kind we use, exact USDC on Base; verify/settle still go to the real facilitator). Every RPC call has a 4 s timeout (`RPC_TIMEOUT_MS`) and falls through to the next public RPC for that chain, and each paid call is capped at 25 s (`ROUTE_DEADLINE_MS`); a capped call answers `504` and is not settled, so you aren't charged. Regression tests: `tests/resilience.test.mjs`.

A bare request with no payment returns `402 Payment Required` along with the payment requirements. If the input is invalid, you get a `400` and are not charged.

## Use over HTTP (x402)

```js
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.PRIVATE_KEY) });
const pay = wrapFetchWithPayment(fetch, client);
console.log(await (await pay("https://automaton-tx-explainer.vercel.app/v1/gas?chain=all")).json());
```

The buyer signs an EIP-3009 USDC authorization, so no gas is needed.

## Use over MCP

The server speaks streamable HTTP (stateless) at `POST https://automaton-tx-explainer.vercel.app/mcp`. Paid tools use the `@x402/mcp` payment flow, and a free `ping` tool is also available.

```json
{ "mcpServers": { "automaton-onchain-tools": { "type": "http", "url": "https://automaton-tx-explainer.vercel.app/mcp" } } }
```

## Run your own

```bash
npm install
PAY_TO=0xYourAddress node server.js   # Base Sepolia + x402.org facilitator by default
```

Environment variables: `SOLANA_RPC`, `PAY_TO`, `X402_NETWORK` (`eip155:8453` for mainnet), `FACILITATOR_URL` (`cdp` uses `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`), `PRICE`, `PRICE_SMALL`, `PRICE_SAFE` (default `$0.005`), `PRICE_VERDICT` (default `$0.02`), `PUBLIC_ORIGIN`, `BASE_RPC`, `ETH_RPC`, `BSC_RPC`. Deploys to Vercel as-is (`api/index.js`). A merge to `main` is what Vercel deploys.

## Data sources

All data comes from free public sources: public RPCs, openchain.xyz signatures, Sourcify, ENS, MetaMask eth-phishing-detect, Phishing.Database, RDAP, GoPlus (approval security and address security), and Blockscout / Routescan transaction lists.

Risk and safety outputs are heuristics. They are not audits, security advice or financial advice.

## License

MIT

_Deployed automatically to Vercel from `main`._
