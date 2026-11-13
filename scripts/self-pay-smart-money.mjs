// Pay each BNB smart-money route once so CDP Bazaar indexes it.
// Two calls at $0.02 USDC on Base ($0.04 total). The payment settles to the service payTo wallet.
// Run only after this code is deployed. No key is stored in the repo. Do not run it from CI.
//
//   PRIVATE_KEY=0x... node scripts/self-pay-smart-money.mjs
//   ORIGIN=https://automaton-tx-explainer.vercel.app   (default)
//   PRIVATE_KEY is the buyer wallet, the same pattern as the README x402 fetch example.
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const ORIGIN = (process.env.ORIGIN || "https://automaton-tx-explainer.vercel.app").replace(/\/$/, "");
const KEY = process.env.PRIVATE_KEY;
if (!KEY) {
  console.error("PRIVATE_KEY is not set. Export the buyer wallet key and re-run.");
  console.error("Example: PRIVATE_KEY=0x... node scripts/self-pay-smart-money.mjs");
  process.exit(1);
}
const paths = [
  ["/v1/bsc/smart-money?limit=5&minHits=1", "bsc-smart-money"],
  ["/v1/bsc/smart-money/0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717", "bsc-smart-money-wallet"],
];
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(KEY) });
const pay = wrapFetchWithPayment(fetch, client);
let failed = 0;
for (const [p, type] of paths) {
  const r = await pay(ORIGIN + p);
  const body = await r.json().catch(() => ({}));
  console.log(type, r.status, body.lookback_hours ?? "", body.error || body.detail || "");
  if (r.status !== 200 || body.type !== type || typeof body.lookback_hours !== "number") failed++;
}
if (failed) { console.error(`${failed} of ${paths.length} self-pays did not return a smart-money payload.`); process.exit(1); }
console.log("Indexed 2 smart-money routes ($0.04 USDC on Base).");
