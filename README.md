# Automaton Onchain Tools

[![M8ven Score](https://m8ven.ai/badge/mcp/povrouyre-wq-automaton-onchain-tools-1wyi9g?v=0e560c4d737408fa245aa4e54cf10936)](https://m8ven.ai/mcp/povrouyre-wq-automaton-onchain-tools-1wyi9g?s=readme)

Pay-per-call crypto and security APIs for AI agents. You pay with **x402**: $0.005 to $0.01 per call in **USDC on Base** (`eip155:8453`). There's no signup and no API key. An MCP server is included.

**Live:** https://automaton-tx-explainer.vercel.app · [OpenAPI](https://automaton-tx-explainer.vercel.app/openapi.json) · [llms.txt](https://automaton-tx-explainer.vercel.app/llms.txt) · [x402 discovery](https://automaton-tx-explainer.vercel.app/.well-known/x402)

**Not an agent?** [/check](https://automaton-tx-explainer.vercel.app/check) is a web page where anyone can buy the $0.25 wallet or token report, or the $1.50 token deep scan, with a browser wallet (MetaMask, Coinbase Wallet, etc.) using the same x402 flow. Page sources are in `check-src/`; `node check-src/build.mjs` (needs `esbuild`) regenerates `check-assets.js`.

## Endpoints

`{chain}` is one of `base`, `ethereum` or `bsc`. With the Solana token check that gives 21 paid tools.

| Tool | Endpoint | Price | What it does |
|---|---|---|---|
| Tx Explainer | `GET /v1/{chain}/tx?hash=0x…` | $0.01 | Status, fee, decoded method + args, ERC-20 transfers |
| Token Approval Check | `GET /v1/{chain}/approvals?address=0x…` | $0.005 | Allowances of major tokens to common spenders; flags unlimited |
| Address Inspector | `GET /v1/{chain}/address?address=0x…` | $0.005 | EOA / contract / EIP-7702, balance, proxy impl, ERC-20 metadata |
| Contract Risk Heuristics | `GET /v1/{chain}/contract-risk?address=0x…` | $0.01 | Sourcify verification, proxy/admin, owner type, mint/pause/blacklist/fee selectors |
| URL Safety Check | `GET /v1/url-safety?url=…` | $0.005 | Phishing blocklists, domain age (RDAP), punycode/lookalikes, HTTPS |
| Multi-chain Gas Snapshot | `GET /v1/gas?chain=all` | $0.005 | Gas price, base fee, utilization, est. cost of transfer/ERC-20/swap |
| ENS / Basename Resolver | `GET /v1/ens?name=vitalik.eth` | $0.005 | Name to address + text records, or reverse lookup |
| Calldata Decoder | `GET /v1/decode?data=0x…` | $0.005 | Decode calldata before signing, with plain-English warnings |
| Wallet Portfolio | `GET /v1/portfolio?address=0x…` | $0.01 | Native + 8 major token balances on Base, Ethereum, BNB |
| Wallet Security Report | `GET /v1/wallet-report?address=0x…` | $0.25 | One-call wallet report across 3 chains: balances, approvals, 7702 delegation, plain-English summary |
| Token Due-Diligence Report | `GET /v1/token-report?address=0x…&chain=base` | $0.25 | Metadata, proxy, owner/admin, owner holdings, Sourcify, mint/pause/blacklist/fee flags |
| **Solana Token Check** | `GET /v1/solana/token?address=<mint>` | $0.005 | SPL / Token-2022 / pump.fun mint: mint + freeze authority, metadata mutability (Metaplex isMutable / Token-2022 metadata), risky Token-2022 extensions (transfer fee, permanent delegate, transfer hook, pausable, default-frozen), top-holder concentration with pools and the bonding curve excluded where identifiable, pump.fun curve progress or PumpSwap LP burn share. Free public Solana RPC only; lists what it couldn't determine |
| **Launch Feed (Base + Solana)** | `GET /v1/launches?chain=all&limit=10` | $0.02 | Newest token launches on Base and Solana (mostly pump.fun), up to 20 per chain, each run through our risk check at request time: pool DEX, age, liquidity, FDV, 1h buys/sells, plus risk level and flags |
| **Base Launch Feed** | `GET /v1/base/launches?limit=10` | $0.01 | Base only: verified source, upgradeable proxy, owner type, mint/pause/blacklist/fee selectors on each new token (B20 native tokens are labeled as not checkable by bytecode) |
| **Solana Launch Feed** | `GET /v1/solana/launches?limit=10` | $0.01 | Solana only: mint/freeze authority, metadata mutability, Token-2022 extensions, holder concentration, pump.fun curve progress on each new mint |
| **Token Deep Scan** | `GET /v1/token/deep-scan?address=0x…&chain=base` | $1.50 | Simulated buy + sell against the main DEX pool (honeypot and buy/sell tax), main pool liquidity in USD, V2 LP burned/locked share, top-holder concentration, owner powers, and a list of what it couldn't determine |

### How the launch feed works

- **Source:** GeckoTerminal's free public `new_pools` API for `base` and `solana` (newest pools first, deduplicated to one row per new token, majors like WETH/USDC/SOL skipped). On Base that covers Uniswap v2/v3/v4, Aerodrome, Bankr, Clanker-style launchpads and anything else GeckoTerminal indexes; on Solana it is mostly pump.fun bonding curves plus PumpSwap/Meteora pools. Data by GeckoTerminal.
- **Risk:** each token goes through the same code as `/v1/base/contract-risk` or `/v1/solana/token`, at request time, cached about 10 minutes per token. Results are summarized to a risk level plus flags.
- **No database, no cron:** everything is computed when you call it, so rows are as fresh as GeckoTerminal (usually under a minute). Upstream pages are cached 45 s.
- **Free delayed sample:** `GET /free/launches?chain=all|base|solana` returns up to 5 launches per chain with risk level and short flags. Base rows are at least 15 minutes old; Solana rows come from the oldest page GeckoTerminal serves (about 5–10 minutes) and the response is CDN-cached for 10 minutes, so roughly 5–20 minutes behind.
- **Limits:** if GeckoTerminal is down or rate-limits us, the paid response says so in `errors`. B20 (Base native precompile) tokens can't be checked by bytecode and are marked `unknown`. Not an audit; most new launches fail.

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

Environment variables: `SOLANA_RPC`, `PAY_TO`, `X402_NETWORK` (`eip155:8453` for mainnet), `FACILITATOR_URL` (`cdp` uses `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`), `PRICE`, `PRICE_SMALL`, `PUBLIC_ORIGIN`, `BASE_RPC`, `ETH_RPC`, `BSC_RPC`. Deploys to Vercel as-is (`api/index.js`).

## Data sources

All data comes from free public sources: public RPCs, openchain.xyz signatures, Sourcify, ENS, MetaMask eth-phishing-detect, Phishing.Database and RDAP.

Risk and safety outputs are heuristics. They are not audits, security advice or financial advice.

## License

MIT

_Deployed automatically to Vercel from `main`._
