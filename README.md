# Automaton Onchain Tools

Pay-per-call crypto and security APIs for AI agents. You pay with **x402**: $0.005 to $0.01 per call in **USDC on Base** (`eip155:8453`). There's no signup and no API key. An MCP server is included.

**Live:** https://automaton-tx-explainer.vercel.app · [OpenAPI](https://automaton-tx-explainer.vercel.app/openapi.json) · [llms.txt](https://automaton-tx-explainer.vercel.app/llms.txt) · [x402 discovery](https://automaton-tx-explainer.vercel.app/.well-known/x402)

## Endpoints

`{chain}` is one of `base`, `ethereum` or `bsc`. That gives 17 paid tools.

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

Environment variables: `PAY_TO`, `X402_NETWORK` (`eip155:8453` for mainnet), `FACILITATOR_URL` (`cdp` uses `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`), `PRICE`, `PRICE_SMALL`, `PUBLIC_ORIGIN`, `BASE_RPC`, `ETH_RPC`, `BSC_RPC`. Deploys to Vercel as-is (`api/index.js`).

## Data sources

All data comes from free public sources: public RPCs, openchain.xyz signatures, Sourcify, ENS, MetaMask eth-phishing-detect, Phishing.Database and RDAP.

Risk and safety outputs are heuristics. They are not audits, security advice or financial advice.

## License

MIT

_Deployed automatically to Vercel from `main`._
