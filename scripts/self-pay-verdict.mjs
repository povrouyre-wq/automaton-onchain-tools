// Pay each quick-verdict route once so CDP Bazaar indexes it.
// Three calls at $0.02 USDC on Base ($0.06 total). The payment settles to the service payTo wallet.
// Run only after this code is deployed. No key is stored in the repo.
//
//   PRIVATE_KEY=0x... node scripts/self-pay-verdict.mjs
//   ORIGIN=https://automaton-tx-explainer.vercel.app   (default)
//   PRIVATE_KEY is the buyer wallet, the same pattern as the README x402 fetch example.
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const ORIGIN = (process.env.ORIGIN || "https://automaton-tx-explainer.vercel.app").replace(/\/$/, "");
const KEY = process.env.PRIVATE_KEY;
if (!KEY) {
  console.error("PRIVATE_KEY is not set. Export the buyer wallet key and re-run.");
  console.error("Example: PRIVATE_KEY=0x... node scripts/self-pay-verdict.mjs");
  process.exit(1);
}
const paths = [
  ["/v1/base/verdict?token=0x532f27101965dd16442E59d40670FaF5eBB142E4", "base BRETT"],
  ["/v1/ethereum/verdict?token=0x6982508145454Ce325dDbE47a25d4ec3d2311933", "ethereum PEPE"],
  ["/v1/bsc/verdict?token=0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", "bsc CAKE"],
];
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(KEY) });
const pay = wrapFetchWithPayment(fetch, client);
let failed = 0;
for (const [p, label] of paths) {
  const url = ORIGIN + p;
  const r = await pay(url);
  const body = await r.json().catch(() => ({}));
  console.log(label, r.status, body.verdict || body.error || body.detail || "");
  if (r.status !== 200 || body.type !== "token-verdict") failed++;
}
if (failed) { console.error(`${failed} of ${paths.length} self-pays did not return a verdict.`); process.exit(1); }
console.log("Indexed 3 verdict routes ($0.06 USDC on Base).");
