// Onchain + URL helpers. Free public data only: public RPCs, openchain.xyz signatures, Sourcify, RDAP, open-source phishing lists.
import { createPublicClient, http, fallback, decodeFunctionData, parseAbiItem, formatUnits, erc20Abi, parseAbi } from "viem";
import { base, mainnet, bsc, arbitrum, optimism, polygon, avalanche } from "viem/chains";
import { impersonation } from "./impersonation.js";
import { domainToASCII, domainToUnicode } from "node:url";

// Public RPCs with short per-call timeouts and a fallback chain: a hung or rate-limited endpoint costs at most RPC_TIMEOUT_MS before the next one is tried
// (viem's default is 10 s x 3 retries per call, which could stall one paid request for over a minute). Env URLs (comma-separated) go first.
export const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 4000);
export function rpcFor(chain, env, ...urls) { const list = [...new Set([...(env ? env.split(",").map(x => x.trim()).filter(Boolean) : []), ...urls])];
  const t = list.map(u => http(u, { timeout: RPC_TIMEOUT_MS, retryCount: list.length > 1 ? 0 : 2, retryDelay: 150 }));
  return createPublicClient({ chain, transport: t.length > 1 ? fallback(t, { retryCount: 0 }) : t[0] }); }
const P2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3", ZX = "0xDef1C0ded9bec7F1a1670819833240f027b25EfF", INCH = "0x111111125421cA6dc452d289314280a0f8842A65", LIFI = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
export const CHAINS = {
  base: { name: "Base", chainId: 8453, native: "ETH", rpc: rpcFor(base, process.env.BASE_RPC, "https://mainnet.base.org", "https://base-rpc.publicnode.com"),
    tokens: { USDC: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6], WETH: ["0x4200000000000000000000000000000000000006", 18], USDbC: ["0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", 6], DAI: ["0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", 18], cbETH: ["0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", 18], cbBTC: ["0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", 8], AERO: ["0x940181a94A35A4569E4529A3CDfB74e38FD98631", 18], EURC: ["0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", 6] },
    spenders: { "Permit2": P2, "Uniswap Universal Router": "0x6fF5693b99212Da76ad316178A184AB56D299b43", "Uniswap SwapRouter02": "0x2626664c2603336E57B271c5C0b26F421741e481", "Aerodrome Router": "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43", "0x Exchange Proxy": ZX, "1inch v6 Router": INCH, "LI.FI Diamond": LIFI, "Odos v2 Router": "0x19cEeAd7105607Cd444F5ad10dd51356436095a1" } },
  ethereum: { name: "Ethereum", chainId: 1, native: "ETH", rpc: rpcFor(mainnet, process.env.ETH_RPC, "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"),
    tokens: { USDC: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6], USDT: ["0xdAC17F958D2ee523a2206206994597C13D831ec7", 6], WETH: ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18], DAI: ["0x6B175474E89094C44Da98b954EedeAC495271d0F", 18], WBTC: ["0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8], LINK: ["0x514910771AF9Ca656af840dff83E8264EcF986CA", 18], UNI: ["0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18], stETH: ["0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", 18] },
    spenders: { "Permit2": P2, "Uniswap Universal Router v4": "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af", "Uniswap Universal Router": "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", "Uniswap SwapRouter02": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", "0x Exchange Proxy": ZX, "1inch v6 Router": INCH, "LI.FI Diamond": LIFI, "Odos v2 Router": "0xCf5540fFFCdC3d510B18bFcA6d2b9987b0772559", "CoW Vault Relayer": "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110" } },
  bsc: { name: "BNB Smart Chain", chainId: 56, native: "BNB", rpc: rpcFor(bsc, process.env.BSC_RPC, "https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"),
    tokens: { USDT: ["0x55d398326f99059fF775485246999027B3197955", 18], USDC: ["0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18], WBNB: ["0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", 18], BUSD: ["0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", 18], CAKE: ["0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", 18], ETH: ["0x2170Ed0880ac9A755fd29B2688956BD959F933F8", 18], BTCB: ["0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", 18], FDUSD: ["0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", 18] },
    spenders: { "Permit2": P2, "PancakeSwap v2 Router": "0x10ED43C718714eb63d5aA57B78B54704E256024E", "PancakeSwap Smart Router": "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4", "PancakeSwap Universal Router": "0x1A0A18AC4BECDDbd6389559687d1A73d8927E416", "0x Exchange Proxy": ZX, "1inch v6 Router": INCH, "LI.FI Diamond": LIFI, "Odos v2 Router": "0x89b8AA89FDd0507a99d334CBe3C808fAFC7d850E" } },
  // Lookup-only chains (tx, approvals, address, contract-risk). Token addresses: Circle (USDC), USDT0/Tether, chain docs, checked onchain (symbol/decimals) Oct 30 2026.
  // Spenders: Uniswap deployment docs (Universal Router v4) and Sourcify/Routescan verified contract names (UniversalRouter, SwapRouter02, OdosRouterV2, LBRouter...).
  arbitrum: { name: "Arbitrum", chainId: 42161, native: "ETH", copycat: true, rpc: rpcFor(arbitrum, process.env.ARB_RPC, "https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org"),
    tokens: { USDC: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6], "USDC.e": ["0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", 6], USDT0: ["0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6], WETH: ["0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 18], WBTC: ["0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", 8], DAI: ["0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18], ARB: ["0x912CE59144191C1204E64559FE8253a0e49E6548", 18], LINK: ["0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", 18] },
    spenders: { "Permit2": P2, "Uniswap Universal Router v4": "0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3", "Uniswap Universal Router": "0x5E325eDA8064b456f4781070C0738d849c824258", "Uniswap SwapRouter02": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", "0x Exchange Proxy": ZX, "1inch v6 Router": INCH, "LI.FI Diamond": LIFI, "Odos v2 Router": "0xa669e7A0d4b3e4Fa48af2dE86BD4CD7126Be4e13" } },
  optimism: { name: "Optimism", chainId: 10, native: "ETH", copycat: true, rpc: rpcFor(optimism, process.env.OP_RPC, "https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com", "https://optimism.drpc.org"),
    tokens: { USDC: ["0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6], "USDC.e": ["0x7F5c764cBc14f9669B88837ca1490cCa17c31607", 6], USDT: ["0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", 6], USDT0: ["0x01bFF41798a0BcF287b996046Ca68b395DbC1071", 6], WETH: ["0x4200000000000000000000000000000000000006", 18], WBTC: ["0x68f180fcCe6836688e9084f035309E29Bf0A2095", 8], DAI: ["0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18], OP: ["0x4200000000000000000000000000000000000042", 18] },
    spenders: { "Permit2": P2, "Uniswap Universal Router v4": "0x851116D9223fabED8E56C0E6b8Ad0c31d98B3507", "Uniswap Universal Router": "0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8", "Uniswap SwapRouter02": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", "Velodrome v2 Router": "0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858", "1inch v6 Router": INCH, "LI.FI Diamond": LIFI, "Odos v2 Router": "0xCa423977156BB05b13A2BA3b76Bc5419E2fE9680" } },
  polygon: { name: "Polygon", chainId: 137, native: "POL", copycat: true, rpc: rpcFor(polygon, process.env.POLYGON_RPC, "https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://polygon-rpc.com"),
    tokens: { USDC: ["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6], "USDC.e": ["0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", 6], USDT0: ["0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6], WETH: ["0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", 18], WPOL: ["0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", 18], WBTC: ["0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", 8], DAI: ["0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", 18], LINK: ["0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", 18] },
    spenders: { "Permit2": P2, "Uniswap Universal Router v4": "0x1095692A6237d83C6a72F3F5eFEdb9A670C49223", "Uniswap Universal Router": "0xec7BE89e9d109e7e3Fec59c222CF297125FEFda2", "Uniswap SwapRouter02": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", "QuickSwap v2 Router": "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", "0x Exchange Proxy": ZX, "1inch v6 Router": INCH, "LI.FI Diamond": LIFI, "Odos v2 Router": "0x4E3288c9ca110bCC82bf38F09A7b425c095d92Bf" } },
  avalanche: { name: "Avalanche C-Chain", chainId: 43114, native: "AVAX", copycat: true, rpc: rpcFor(avalanche, process.env.AVAX_RPC, "https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com", "https://avalanche.drpc.org"),
    tokens: { USDC: ["0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 6], USDt: ["0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", 6], "USDC.e": ["0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664", 6], "USDT.e": ["0xc7198437980c041c805A1EDcbA50c1Ce5db95118", 6], WAVAX: ["0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", 18], "WETH.e": ["0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", 18], "BTC.b": ["0x152b9d0FdC40C096757F570A51E494bd4b943E50", 8], JOE: ["0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd", 18] },
    spenders: { "Permit2": P2, "Uniswap Universal Router v4": "0x94b75331AE8d42C1b61065089B7d48FE14aA73b7", "Uniswap Universal Router": "0x4Dae2f939ACf50408e13d58534Ff8c2776d45265", "Uniswap SwapRouter02": "0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE", "LFJ (Trader Joe) LB Router v2.2": "0x18556DA13313f3532c54711497A8FedAC273220E", "LFJ (Trader Joe) Router v1": "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", "0x Exchange Proxy": ZX, "1inch v6 Router": INCH, "LI.FI Diamond": LIFI, "Odos v2 Router": "0x88de50B233052e4Fb783d4F6db78Cc34fEa3e9FC" } },
};
// Chains covered by the multi-chain tools (gas, portfolio, wallet report). The lookup-only chains above are not included there.
export const CORE_CHAINS = ["base", "ethereum", "bsc"];
export const LOOKUP_ONLY_CHAINS = Object.keys(CHAINS).filter(c => !CORE_CHAINS.includes(c));
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const cache = new Map();
const j = v => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));
const T = (p, ms = 5000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);

async function lookupSig(selector) {
  if (cache.has(selector)) return cache.get(selector);
  try { const r = await T(fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${selector}&filter=true`));
    const s = (await r.json())?.result?.function?.[selector]?.map(x => x.name) || []; cache.set(selector, s); return s; } catch { return []; }
}
async function tokenMeta(C, addr) {
  const k = C.chainId + "t" + addr; if (cache.has(k)) return cache.get(k);
  try { const [symbol, decimals] = await Promise.all(["symbol", "decimals"].map(f => C.rpc.readContract({ address: addr, abi: erc20Abi, functionName: f })));
    const m = { symbol, decimals }; cache.set(k, m); return m; } catch { return null; }
}

export async function explain(chain, hash) {
  const C = CHAINS[chain];
  const [tx, rc] = await Promise.all([C.rpc.getTransaction({ hash }), C.rpc.getTransactionReceipt({ hash })]);
  const selector = tx.input.slice(0, 10); let method = null, args = null, candidates = [];
  if (tx.input && tx.input !== "0x") { candidates = await lookupSig(selector);
    for (const sig of candidates) { try { const d = decodeFunctionData({ abi: [parseAbiItem("function " + sig)], data: tx.input }); method = sig; args = d.args; break; } catch {} } }
  const transfers = [];
  for (const l of rc.logs) { if (l.topics[0] !== TRANSFER || l.topics.length !== 3) continue;
    const m = await tokenMeta(C, l.address); const raw = BigInt(l.data);
    transfers.push({ token: l.address, symbol: m?.symbol ?? null, from: "0x" + l.topics[1].slice(26), to: "0x" + l.topics[2].slice(26), amount: m ? formatUnits(raw, m.decimals) : raw.toString() }); }
  const value = formatUnits(tx.value, 18), fee = formatUnits(rc.gasUsed * rc.effectiveGasPrice, 18);
  return j({ chain, chainId: C.chainId, hash, status: rc.status, block: rc.blockNumber, from: tx.from, to: tx.to, nativeSymbol: C.native, value, fee,
    ...(C.native === "ETH" ? { valueEth: value, feeEth: fee } : {}), gasUsed: rc.gasUsed, selector: tx.input === "0x" ? null : selector,
    method, args, signatureCandidates: candidates, tokenTransfers: transfers,
    summary: `${rc.status} · ${method ? method.split("(")[0] : (tx.input === "0x" ? C.native + " transfer" : "unknown method " + selector)} · ${transfers.length} token transfer(s)` });
}

const MAXISH = 2n ** 255n;
export async function approvals(chain, owner) {
  const C = CHAINS[chain]; const pairs = [];
  for (const [t, [ta]] of Object.entries(C.tokens)) for (const [sp, sa] of Object.entries(C.spenders)) pairs.push([t, ta, sp, sa]);
  const res = await C.rpc.multicall({ contracts: pairs.map(([, ta, , sa]) => ({ address: ta, abi: erc20Abi, functionName: "allowance", args: [owner, sa] })), allowFailure: true });
  const out = []; let failed = 0;
  res.forEach((r, i) => { if (r.status !== "success") { failed++; return; } if (r.result === 0n) return; const [t, ta, sp, sa] = pairs[i];
    out.push({ token: t, tokenAddress: ta, spender: sp, spenderAddress: sa, unlimited: r.result >= MAXISH, allowance: r.result >= MAXISH ? "unlimited" : formatUnits(r.result, C.tokens[t][1]) }); });
  return { chain, chainId: C.chainId, owner, checkedPairs: pairs.length, failedReads: failed, nonZeroApprovals: out, unlimitedCount: out.filter(x => x.unlimited).length,
    coverage: `Checks ERC-20 allowance() for ${Object.keys(C.tokens).length} major ${C.name} tokens x ${Object.keys(C.spenders).length} widely used spenders. Not exhaustive: approvals to other spenders/tokens are not detected.`,
    tokens: Object.fromEntries(Object.entries(C.tokens).map(([k, [a]]) => [k, a])), spenders: C.spenders };
}

const SLOTS = { impl: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50", zos: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3" };
const slotAddr = v => (!v || BigInt(v) === 0n) ? null : "0x" + v.slice(-40);
async function proxyInfo(C, address, code) {
  if (/^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/i.test(code)) return { standard: "EIP-1167", implementation: "0x" + code.slice(22, 62), admin: null };
  if (/^0x3d3d3d3d363d3d37363d73[0-9a-f]{40}5af43d3d93803e602a57fd5bf3$/i.test(code)) return { standard: "EIP-1167", variant: "ERC-7511 PUSH0 minimal clone", implementation: "0x" + code.slice(24, 64), admin: null };
  const [impl, admin, beacon, zos] = await Promise.all(Object.values(SLOTS).map(slot => C.rpc.getStorageAt({ address, slot }).catch(() => null)));
  if (slotAddr(beacon)) { let im = null; try { im = await C.rpc.readContract({ address: slotAddr(beacon), abi: parseAbi(["function implementation() view returns (address)"]), functionName: "implementation" }); } catch {}
    return { standard: "EIP-1967 beacon", beacon: slotAddr(beacon), implementation: im, admin: slotAddr(admin) }; }
  if (slotAddr(impl)) return { standard: "EIP-1967", implementation: slotAddr(impl), admin: slotAddr(admin) };
  if (slotAddr(zos)) return { standard: "OpenZeppelin legacy (zos)", implementation: slotAddr(zos), admin: null };
  return null;
}
export async function inspect(chain, address) {
  const C = CHAINS[chain];
  const [code, bal, nonce] = await Promise.all([C.rpc.getCode({ address }), C.rpc.getBalance({ address }), C.rpc.getTransactionCount({ address })]);
  const isContract = !!code && code !== "0x"; const nb = formatUnits(bal, 18);
  const o = { chain, chainId: C.chainId, address, type: isContract ? "contract" : "eoa", nativeSymbol: C.native, nativeBalance: nb, ...(C.native === "ETH" ? { ethBalance: nb } : {}), nonce, codeSize: isContract ? (code.length - 2) / 2 : 0 };
  if (isContract) {
    if (code.startsWith("0xef0100")) { o.type = "eoa-7702-delegated"; o.delegatesTo = "0x" + code.slice(8, 48); }
    else { const p = await proxyInfo(C, address, code); if (p) { if (p.standard === "EIP-1167") o.minimalProxy = p; else o.proxy = p; }
      const f = n => C.rpc.readContract({ address, abi: erc20Abi, functionName: n }).catch(() => undefined);
      const [name, symbol, decimals, totalSupply] = await Promise.all(["name", "symbol", "decimals", "totalSupply"].map(f));
      if (symbol !== undefined && decimals !== undefined) o.erc20 = { name: name ?? null, symbol, decimals, totalSupply: totalSupply !== undefined ? formatUnits(totalSupply, decimals) : null };
      if (C.copycat && o.erc20) { const imp = impersonation(chain, address, o.erc20); o.copycat = imp ? { flagged: true, copies: imp.copies, note: imp.note } : { flagged: false }; } }
  }
  o.summary = `${o.type}${o.proxy ? ` (${o.proxy.standard} proxy)` : ""}${o.minimalProxy ? " (EIP-1167 clone)" : ""}${o.erc20 ? " · ERC-20 " + o.erc20.symbol : ""}${o.copycat?.flagged ? ` · COPYCAT of ${o.copycat.copies}` : ""} · ${nb} ${C.native}`;
  return j(o);
}

// ---- contract risk heuristics ----
// Selectors present as PUSH4 operands in runtime bytecode (heuristic: dispatcher table).
function selectorsIn(code) {
  const s = new Set(); const b = code.slice(2).toLowerCase();
  for (let i = 0; i < b.length; i += 2) { const op = parseInt(b.slice(i, i + 2), 16);
    if (op === 0x63) { s.add("0x" + b.slice(i + 2, i + 10)); i += 8; } else if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2; }
  return s;
}
const CAPS = {
  mint: { "0x40c10f19": "mint(address,uint256)", "0xa0712d68": "mint(uint256)", "0x4e6ec247": "_mint(address,uint256)" },
  pause: { "0x8456cb59": "pause()", "0x3f4ba83a": "unpause()", "0x5c975abb": "paused()" },
  blacklist: { "0xf9f92be4": "blacklist(address)", "0x0ecb93e0": "addBlackList(address)", "0xfe575a87": "isBlacklisted(address)", "0xe47d6060": "isBlackListed(address)", "0x44337ea1": "addToBlacklist(address)", "0x537df3b6": "removeFromBlacklist(address)" },
  fees: { "0x69fe0e2d": "setFee(uint256)", "0x8c0b5e22": "maxTransactionAmount()", "0xc0246668": "excludeFromFees(address,bool)", "0x2f7ba5a2": "setTaxes(uint256,uint256)" },
  upgrade: { "0x3659cfe6": "upgradeTo(address)", "0x4f1ef286": "upgradeToAndCall(address,bytes)" },
  ownership: { "0x8da5cb5b": "owner()", "0xf2fde38b": "transferOwnership(address)", "0x715018a6": "renounceOwnership()", "0x91d14854": "hasRole(bytes32,address)" },
};
async function sourcify(chainId, address) {
  try { const r = await T(fetch(`https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=compilation`), 6000);
    if (r.status === 404) return { verified: false }; if (!r.ok) return { verified: null, error: "sourcify HTTP " + r.status };
    const d = await r.json(); return { verified: !!d.match, match: d.match, name: d.compilation?.name ?? null, compiler: d.compilation?.compilerVersion ?? null, verifiedAt: d.verifiedAt ?? null };
  } catch (e) { return { verified: null, error: "sourcify unavailable" }; }
}
export async function contractRisk(chain, address) {
  const C = CHAINS[chain]; const code = await C.rpc.getCode({ address });
  if (!code || code === "0x") return { chain, chainId: C.chainId, address, isContract: false, riskLevel: "n/a", findings: [{ severity: "info", note: "Address has no contract code (EOA or undeployed)." }], disclaimer: DISCLAIMER };
  if (code.startsWith("0xef0100")) return { chain, chainId: C.chainId, address, isContract: false, type: "eoa-7702-delegated", delegatesTo: "0x" + code.slice(8, 48), riskLevel: "review", findings: [{ severity: "medium", note: "EIP-7702 delegated EOA: behaviour is defined by the delegate contract." }], disclaimer: DISCLAIMER };
  const proxy = await proxyInfo(C, address, code);
  let implCode = null; if (proxy?.implementation) implCode = await C.rpc.getCode({ address: proxy.implementation }).catch(() => null);
  const sels = selectorsIn(code); if (implCode && implCode !== "0x") for (const x of selectorsIn(implCode)) sels.add(x);
  const capabilities = {}; for (const [cap, m] of Object.entries(CAPS)) { const hit = Object.entries(m).filter(([s]) => sels.has(s)).map(([, n]) => n); if (hit.length) capabilities[cap] = hit; }
  const rd = (abi, fn, addr = address) => C.rpc.readContract({ address: addr, abi: parseAbi([abi]), functionName: fn }).catch(() => undefined);
  const [owner, paused, srcSelf, srcImpl, tName, tSymbol] = await Promise.all([rd("function owner() view returns (address)", "owner"), rd("function paused() view returns (bool)", "paused"),
    sourcify(C.chainId, address), proxy?.implementation ? sourcify(C.chainId, proxy.implementation) : null,
    C.copycat ? rd("function name() view returns (string)", "name") : undefined, C.copycat ? rd("function symbol() view returns (string)", "symbol") : undefined]);
  let ownerType = null; if (owner && owner !== "0x0000000000000000000000000000000000000000") { const oc = await C.rpc.getCode({ address: owner }).catch(() => null); ownerType = oc && oc !== "0x" ? "contract (possibly multisig/timelock)" : "eoa"; }
  const findings = []; let score = 0; const add = (sev, pts, note) => { findings.push({ severity: sev, note }); score += pts; };
  const imp = C.copycat && (tName !== undefined || tSymbol !== undefined) ? impersonation(chain, address, { name: tName, symbol: tSymbol }) : null;
  if (imp) add(imp.severity, 3, imp.note[0].toUpperCase() + imp.note.slice(1) + ".");
  if (srcSelf.verified === null) findings.push({ severity: "info", note: "Sourcify verification status could not be checked right now (lookup failed); not counted in the score." });
  if (srcSelf.verified === false && !(srcImpl?.verified)) add("high", 3, "Source not verified on Sourcify (other explorers may have it).");
  if (proxy && proxy.standard !== "EIP-1167") add("medium", 2, `Upgradeable proxy (${proxy.standard}); logic can change.${proxy.admin ? " Admin: " + proxy.admin : ""}`);
  if (proxy?.implementation && srcImpl && srcImpl.verified === false) add("medium", 1, "Implementation not verified on Sourcify.");
  if (owner === "0x0000000000000000000000000000000000000000") add("info", 0, "owner() is the zero address (ownership renounced).");
  else if (ownerType === "eoa") add("medium", 2, `Owned by a single EOA ${owner}.`);
  else if (ownerType) add("low", 1, `Owned by a contract ${owner}.`);
  if (capabilities.mint) add("medium", 2, "Mint function present: supply may be increased.");
  if (capabilities.blacklist) add("medium", 2, "Blacklist function present: addresses can be blocked.");
  if (capabilities.pause) add("low", 1, `Pause capability present${paused === true ? " and contract is currently PAUSED" : ""}.`);
  if (paused === true) score += 2;
  if (capabilities.fees) add("medium", 2, "Fee/tax or max-transaction controls present.");
  if (capabilities.upgrade && !proxy) add("medium", 1, "UUPS-style upgrade function present.");
  const codeSize = (code.length - 2) / 2; if (codeSize < 100 && !proxy) add("low", 1, `Very small bytecode (${codeSize} bytes).`);
  let riskLevel = score >= 10 ? "high" : score >= 3 ? "medium" : "low"; if (imp && riskLevel === "low") riskLevel = "medium";
  return j({ chain, chainId: C.chainId, address, isContract: true, codeSize, proxy, sourcify: { contract: srcSelf, implementation: srcImpl }, owner: owner ?? null, ownerType, paused: paused ?? null,
    ...(C.copycat ? { token: tSymbol !== undefined || tName !== undefined ? { name: tName ?? null, symbol: tSymbol ?? null } : null, copycat: imp ? { flagged: true, copies: imp.copies, note: imp.note } : { flagged: false } } : {}),
    capabilities, findings, heuristicScore: score, riskLevel, method: "Bytecode PUSH4 selector scan (proxy + implementation), EIP-1967/1167/zos slots, owner()/paused() reads, Sourcify v2 verification.", disclaimer: DISCLAIMER });
}
const DISCLAIMER = "Automated heuristics from public data only. Common admin powers (mint, pause, blacklist, upgrade) are normal for many legitimate tokens such as USDC. Selector detection can miss or misattribute functions. Not an audit, not financial or security advice.";

// ---- URL safety ----
const LISTS = { metamask: "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json",
  phishingDb: "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt" };
let lists = null, listsAt = 0, listsP = null;
async function loadLists() {
  if (lists && Date.now() - listsAt < 6 * 3600e3) return lists;
  listsP ??= (async () => {
    const [mm, pdb] = await Promise.allSettled([T(fetch(LISTS.metamask).then(r => r.json()), 15000), T(fetch(LISTS.phishingDb).then(r => r.text()), 15000)]);
    const n = { mmBlack: new Set(), mmWhite: new Set(), mmFuzzy: [], pdb: new Set(), status: {} };
    if (mm.status === "fulfilled") { mm.value.blacklist.forEach(d => n.mmBlack.add(d)); mm.value.whitelist.forEach(d => n.mmWhite.add(d)); n.mmFuzzy = mm.value.fuzzylist; n.status.metamask = "ok"; } else n.status.metamask = "unavailable";
    if (pdb.status === "fulfilled") { for (const l of pdb.value.split("\n")) { const d = l.trim(); if (d && !d.startsWith("#")) n.pdb.add(d.toLowerCase()); } n.status.phishingDatabase = "ok"; } else n.status.phishingDatabase = "unavailable";
    lists = n; listsAt = Date.now(); listsP = null; return n; })();
  return listsP;
}
const BRANDS = ["google.com", "paypal.com", "apple.com", "microsoft.com", "amazon.com", "facebook.com", "instagram.com", "netflix.com", "coinbase.com", "binance.com", "metamask.io", "opensea.io", "uniswap.org", "etherscan.io", "basescan.org", "bscscan.com", "kraken.com", "crypto.com", "ledger.com", "trezor.io", "phantom.app", "x.com", "twitter.com", "github.com", "chase.com", "wellsfargo.com", "bankofamerica.com", "dropbox.com", "linkedin.com", "outlook.com", "office.com", "icloud.com", "whatsapp.com", "telegram.org", "discord.com", "steamcommunity.com", "aave.com", "lido.fi", "pancakeswap.finance", "rainbow.me"];
const CONF = { "0": "o", "1": "l", "3": "e", "5": "s", "rn": "m", "vv": "w", "і": "i", "о": "o", "а": "a", "е": "e", "р": "p", "с": "c", "ԁ": "d", "ӏ": "l" };
const skel = s => { let x = s.toLowerCase(); for (const [k, v] of Object.entries(CONF)) x = x.split(k).join(v); return x; };
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const label = h => { const p = h.split("."); return p.length >= 2 ? p.slice(-2).join(".") : h; }; // naive registrable domain (no PSL)
let boot = null;
async function rdapBase(tld) {
  boot ??= T(fetch("https://data.iana.org/rdap/dns.json").then(r => r.json()), 8000).then(d => { const m = {}; for (const [tlds, urls] of d.services) for (const t of tlds) m[t] = urls.find(u => u.startsWith("https")) || urls[0]; return m; }).catch(e => { boot = null; throw e; });
  return (await boot)[tld];
}
async function rdapAge(domain) {
  try { const b = await rdapBase(domain.split(".").pop()); if (!b) return { status: "no RDAP server for TLD" };
    const r = await T(fetch(b.replace(/\/?$/, "/") + "domain/" + domain, { headers: { accept: "application/rdap+json", "user-agent": "automaton-url-safety/1.0" } }), 6000);
    if (r.status === 404) return { status: "not found in RDAP (unregistered?)" }; if (!r.ok) return { status: "unavailable", http: r.status };
    const d = await r.json(); const reg = d.events?.find(e => e.eventAction === "registration")?.eventDate;
    return reg ? { status: "ok", registered: reg, ageDays: Math.floor((Date.now() - Date.parse(reg)) / 864e5) } : { status: "no registration date" }; } catch { return { status: "unavailable" }; }
}
const PRIVATE = /^(localhost|.*\.local|.*\.internal)$|^(\d+\.){3}\d+$|^\[|:/i;
async function httpsProbe(host) {
  if (PRIVATE.test(host)) return { checked: false, reason: "IP literal or private host not probed" };
  try { const r = await T(fetch("https://" + host + "/", { method: "HEAD", redirect: "manual" }), 5000); return { checked: true, httpsReachable: true, status: r.status, redirectsTo: r.headers.get("location")?.slice(0, 200) ?? null }; }
  catch (e) { return { checked: true, httpsReachable: false, error: String(e.cause?.code || e.message).slice(0, 80) }; }
}
export async function urlSafety(raw) {
  let u; try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const host = domainToASCII(u.hostname.toLowerCase()) || u.hostname.toLowerCase(); const uni = domainToUnicode(host); const reg = label(host);
  const L = await loadLists(); const signals = []; let score = 0; const add = (sev, pts, note) => { signals.push({ severity: sev, note }); score += pts; };
  const inMM = L.mmBlack.has(host) || L.mmBlack.has(reg), inPDB = L.pdb.has(host) || L.pdb.has(reg), whitelisted = L.mmWhite.has(host) || L.mmWhite.has(reg);
  if (inMM) add("high", 10, "Listed on MetaMask eth-phishing-detect blocklist.");
  if (inPDB) add("high", 10, "Listed on Phishing.Database active phishing domains.");
  if (u.protocol === "http:") add("low", 1, "URL uses plain HTTP.");
  if (/^(\d+\.){3}\d+$/.test(u.hostname)) add("medium", 3, "Host is a raw IP address.");
  if (u.username || u.password) add("medium", 3, "URL contains embedded credentials (user@host trick).");
  if (host.split(".").some(p => p.startsWith("xn--"))) add("medium", 3, `Punycode/IDN host (displays as ${uni}).`);
  if (host.split(".").length > 4) add("low", 1, "Deeply nested subdomains.");
  let lookalike = null;
  if (!whitelisted) for (const b of [...BRANDS, ...L.mmFuzzy]) { if (reg === b || host.endsWith("." + b)) { lookalike = null; break; }
    const a = skel(reg.split(".")[0]), bb = skel(b.split(".")[0]); const dist = lev(a, bb);
    if ((a === bb || (bb.length >= 5 && dist <= 1)) && reg !== b) { lookalike = b; break; }
    if (bb.length >= 5 && host.includes(b.split(".")[0]) && !host.endsWith(b)) lookalike ??= b; }
  if (lookalike) add("medium", 4, `Resembles or embeds brand domain ${lookalike}.`);
  const [age, tls] = await Promise.all([rdapAge(reg), httpsProbe(host)]);
  if (age.ageDays !== undefined && age.ageDays < 30) add("medium", 3, `Domain registered ${age.ageDays} days ago.`); else if (age.ageDays !== undefined && age.ageDays < 180) add("low", 1, `Domain is young (${age.ageDays} days).`);
  if (tls.checked && !tls.httpsReachable) add("low", 1, "HTTPS not reachable on this host.");
  const verdict = (inMM || inPDB) ? "malicious" : score >= 5 ? "suspicious" : score >= 2 ? "caution" : "no known issues";
  return { url: u.href, host, hostUnicode: uni, registrableDomain: reg, verdict, score, signals, blocklists: { metamask: inMM, phishingDatabase: inPDB, metamaskAllowlisted: whitelisted, sourceStatus: L.status },
    domainAge: age, https: tls, sources: ["MetaMask eth-phishing-detect (open source)", "Phishing.Database by mitchellkrogza (MIT)", "RDAP via rdap.org"],
    disclaimer: "Heuristic check against open blocklists and simple signals. Absence from lists does not mean a URL is safe. Not security advice." };
}

// ---- v1.3 tools ----
const ENS_RPC = createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC || "https://ethereum-rpc.publicnode.com") });
export async function gasSnapshot(which) {
  const keys = which === "all" ? CORE_CHAINS : [which];
  const out = await Promise.all(keys.map(async c => { const C = CHAINS[c];
    try { const [gp, blk] = await Promise.all([T(C.rpc.getGasPrice()), T(C.rpc.getBlock())]);
      const base = blk.baseFeePerGas ?? null;
      return { chain: c, chainId: C.chainId, block: blk.number, gasPriceGwei: formatUnits(gp, 9), baseFeeGwei: base === null ? null : formatUnits(base, 9),
        estNativeCost: { transfer21k: formatUnits(gp * 21000n, 18), erc20Transfer65k: formatUnits(gp * 65000n, 18), swap180k: formatUnits(gp * 180000n, 18) }, nativeSymbol: C.native,
        blockUtilization: blk.gasLimit ? Number(blk.gasUsed * 10000n / blk.gasLimit) / 100 : null }; }
    catch (e) { return { chain: c, error: "rpc unavailable" }; } }));
  return j({ timestamp: new Date().toISOString(), chains: out, note: "Native-unit costs at current gas price; USD not included." });
}
export async function ensResolve(q) {
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) { const name = await T(ENS_RPC.getEnsName({ address: q }), 8000).catch(() => null);
    return { input: q, type: "reverse", name, verifiedForward: !!name }; }
  const name = q.toLowerCase(); const address = await T(ENS_RPC.getEnsAddress({ name }), 8000).catch(() => null);
  let records = {};
  if (address) for (const key of ["url", "com.twitter", "com.github", "description"]) { try { const v = await T(ENS_RPC.getEnsText({ name, key }), 4000); if (v) records[key] = v; } catch {} }
  return { input: q, type: "forward", name, address, textRecords: records, note: "Resolved via ENS on Ethereum mainnet (CCIP-read enabled, so Base names like x.base.eth work)." };
}
export async function decodeCalldata(data) {
  const selector = data.slice(0, 10).toLowerCase(); const candidates = await lookupSig(selector); const decoded = [];
  for (const sig of candidates) { try { const d = decodeFunctionData({ abi: [parseAbiItem("function " + sig)], data }); decoded.push({ signature: sig, args: d.args }); } catch {} }
  const KNOWN = { approve: "Grants a spender permission to move your tokens", setApprovalForAll: "Grants an operator control over ALL your NFTs in a collection", permit: "Off-chain-signed approval", transferFrom: "Moves tokens on someone's behalf", increaseAllowance: "Raises a spender's allowance" };
  const warnings = []; const fn = decoded[0]?.signature.split("(")[0];
  if (fn && KNOWN[fn]) warnings.push(KNOWN[fn]);
  if (fn === "approve" && decoded[0].args[1] >= MAXISH) warnings.push("Unlimited approval amount");
  if (fn === "setApprovalForAll" && decoded[0].args[1] === true) warnings.push("Common in NFT drainer phishing; only sign for marketplaces you trust");
  return j({ selector, signatureCandidates: candidates, decoded, bestMatch: decoded[0] || null, warnings, bytes: (data.length - 2) / 2 });
}
export async function portfolio(address) {
  const chains = await Promise.all(CORE_CHAINS.map(c => [c, CHAINS[c]]).map(async ([c, C]) => {
    try { const ent = Object.entries(C.tokens);
      const [nat, res] = await Promise.all([T(C.rpc.getBalance({ address })), T(C.rpc.multicall({ contracts: ent.map(([, [a]]) => ({ address: a, abi: erc20Abi, functionName: "balanceOf", args: [address] })), allowFailure: true }), 8000)]);
      const tokens = []; res.forEach((r, i) => { if (r.status === "success" && r.result > 0n) tokens.push({ symbol: ent[i][0], address: ent[i][1][0], balance: formatUnits(r.result, ent[i][1][1]) }); });
      return { chain: c, chainId: C.chainId, native: { symbol: C.native, balance: formatUnits(nat, 18) }, tokens }; }
    catch { return { chain: c, error: "rpc unavailable" }; } }));
  return j({ address, chains, coverage: "Native balance + 8 major tokens per chain (Base, Ethereum, BNB Smart Chain). Not exhaustive; no USD pricing." });
}
