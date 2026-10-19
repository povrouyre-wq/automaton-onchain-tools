// Browser x402 client for /check: official @x402 packages + viem, signer = injected EIP-1193 wallet.
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";
export function makePayer(provider, address) {
  const wc = createWalletClient({ account: address, chain: base, transport: custom(provider) });
  const signer = { address, signTypedData: m => wc.signTypedData({ account: address, ...m }) };
  const client = new x402Client().register("eip155:8453", new ExactEvmScheme(signer));
  return new x402HTTPClient(client);
}
export function parser() { return new x402HTTPClient(new x402Client()); }
