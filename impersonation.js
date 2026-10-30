// Impersonation check: flags tokens whose symbol or name copies a major asset (USDC, USDT, ETH, BTC, SOL, BNB, ...)
// but whose address isn't one of that chain's known official contracts/mints. Pure, no network calls.
// Official addresses below were checked against GeckoTerminal (symbol, name, market cap) on Oct 30 2026.
const OFFICIAL = {
  base: ["0x4200000000000000000000000000000000000006", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // WETH, USDC, USDbC
    "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // DAI, cbBTC, cbETH
    "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", "0x820C137fa70C8691f0e44Dc420a5e53c168921Dc", // WBTC, EURC, USDS
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"], // USDe, wstETH, bridged USDT
  bsc: ["0x55d398326f99059fF775485246999027B3197955", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // USDT, USDC, WBNB
    "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", // BUSD, ETH, BTCB
    "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", // FDUSD, USD1, DAI
    "0x40af3827F39D0EAcBF4A168f8D4ee67c121D11c9", "0x570A5D26f7765Ecb712C0924E4De545B89fD43dF", "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34"], // TUSD, SOL, USDe
  ethereum: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "0xdAC17F958D2ee523a2206206994597C13D831ec7", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // USDC, USDT, WETH
    "0x6B175474E89094C44Da98b954EedeAC495271d0F", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", // DAI, WBTC, stETH
    "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", "0x4Fabb145d64652a948d72533023f6E7A623C7C53", "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", // wstETH, BUSD, PYUSD
    "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3", // FDUSD, USD1, USDe
    "0xdC035D45d973E3EC169d2276DDab16f1e407384F", "0x0000000000085d4780B73119b644AE5ecd22b376", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // USDS, TUSD, cbBTC
    "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704", "0xB8c77482e45F1F44dE1745F52C74426C631bDD52", "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c"], // cbETH, BNB, EURC
  solana: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "So11111111111111111111111111111111111111112", // USDC, USDT, wSOL
    "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB", "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // PYUSD, USD1, WETH (Wormhole)
    "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", "DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT", // cbBTC, WBTC (Wormhole), USDe
    "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", "9gP2kCy3wA1ctvYWQk75guqXuHfrEomqydHLtcTCqiLa", "EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCWNWqxWV4J6o", // USDS, WBNB (Wormhole), DAI (Wormhole)
    "9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u"], // FDUSD
  // Lookup-only chains. Sources: Circle (USDC, EURC), USDT0 deployments, Tether, Paxos (PYUSD), Lido (wstETH), Ethena (USDe), Coinbase (cbBTC),
  // chain canonical bridges/wrappers; every address checked onchain (symbol, name, decimals) Oct 30 2026.
  arbitrum: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // USDC, USDC.e, USDT0
    "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", // WETH, WBTC, DAI
    "0x912CE59144191C1204E64559FE8253a0e49E6548", "0x5979D7b546E38E414F7E9822514be443A4800529", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // ARB, wstETH, cbBTC
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", "0x46850aD61C2B7d64d08c9C754F45254596696984"], // USDe, PYUSD
  optimism: ["0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", // USDC, USDC.e, USDT
    "0x01bFF41798a0BcF287b996046Ca68b395DbC1071", "0x4200000000000000000000000000000000000006", "0x68f180fcCe6836688e9084f035309E29Bf0A2095", // USDT0, WETH, WBTC
    "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", "0x4200000000000000000000000000000000000042", "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb", // DAI, OP, wstETH
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34"], // USDe
  polygon: ["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDC, USDC.e, USDT0
    "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", // WETH, WPOL, WBTC
    "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", "0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD", "0x99aF3EeA856556646C98c8B9b2548Fe815240750", // DAI, wstETH, PYUSD
    "0x0000000000000000000000000000000000001010"], // POL (native token contract)
  avalanche: ["0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664", // USDC, USDt, USDC.e
    "0xc7198437980c041c805A1EDcbA50c1Ce5db95118", "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", // USDT.e, WAVAX, WETH.e
    "0x152b9d0FdC40C096757F570A51E494bd4b943E50", "0x50b7545627a5162F82A992c33b87aDc75187B218", "0xd586E7F844cEa2F87f50152665BCbc2C279D8d70", // BTC.b, WBTC.e, DAI.e
    "0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD", "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34"], // EURC, USDe
};
// Native-coin placeholders (Uniswap v4 / GeckoTerminal use the zero address for native ETH/BNB; aggregators use 0xEeee...).
const NATIVE = ["0x0000000000000000000000000000000000000000", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"];
for (const c of ["base", "bsc", "ethereum", "arbitrum", "optimism", "polygon", "avalanche"]) OFFICIAL[c].push(...NATIVE);
export const OFFICIAL_ADDRESSES = Object.fromEntries(Object.entries(OFFICIAL).map(([c, a]) => [c, new Set(a.map(x => x.toLowerCase()))]));

// Normalized form -> display symbol. Symbols and well-known full names.
const MAJOR = Object.fromEntries(["USDC", "USDT", "ETH", "WETH", "BTC", "WBTC", "SOL", "WSOL", "BNB", "WBNB", "DAI", "BUSD", "FDUSD", "PYUSD", "USD1", "USDe", "USDS",
  "TUSD", "USDbC", "cbBTC", "cbETH", "BTCB", "stETH", "wstETH", "EURC"].map(s => [s.toUpperCase(), s]));
Object.assign(MAJOR, { USDCOIN: "USDC", TETHER: "USDT", TETHERUSD: "USDT", ETHER: "ETH", ETHEREUM: "ETH", WRAPPEDETHER: "WETH", WRAPPEDETH: "WETH", BITCOIN: "BTC",
  WRAPPEDBITCOIN: "WBTC", WRAPPEDBTC: "WBTC", SOLANA: "SOL", WRAPPEDSOL: "WSOL", WRAPPEDSOLANA: "WSOL", BINANCECOIN: "BNB", WRAPPEDBNB: "WBNB", DAISTABLECOIN: "DAI",
  BINANCEUSD: "BUSD", FIRSTDIGITALUSD: "FDUSD", PAYPALUSD: "PYUSD", WORLDLIBERTYFINANCIALUSD: "USD1", COINBASEWRAPPEDBTC: "cbBTC", EUROCOIN: "EURC", EUROC: "EURC" });

// Extra majors checked only on their home chain (so e.g. Binance-Peg AVAX on BNB Chain isn't affected).
const CHAIN_MAJOR = {
  arbitrum: { ARB: "ARB", ARBITRUM: "ARB", USDT0: "USDT0" },
  optimism: { OP: "OP", OPTIMISM: "OP", USDT0: "USDT0" },
  polygon: { POL: "POL", WPOL: "WPOL", MATIC: "MATIC", WMATIC: "WMATIC", POLYGON: "POL", POLYGONECOSYSTEMTOKEN: "POL", WRAPPEDPOL: "WPOL", WRAPPEDPOLYGONECOSYSTEMTOKEN: "WPOL", WRAPPEDMATIC: "WMATIC", USDT0: "USDT0" },
  avalanche: { AVAX: "AVAX", WAVAX: "WAVAX", AVALANCHE: "AVAX", WRAPPEDAVAX: "WAVAX" },
};

// Cyrillic/Greek letters that look like Latin ones (e.g. "USDС" with a Cyrillic С).
const LOOK = { "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I", "Ј": "J", "К": "K", "М": "M", "О": "O", "Р": "P", "Ѕ": "S", "Т": "T", "Х": "X", "У": "Y",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X" };
export const normalize = s => String(s ?? "").normalize("NFKC").toUpperCase().replace(/./gu, ch => LOOK[ch] ?? ch).replace(/[^A-Z0-9]/g, "");

export const IMPERSONATION_NOTE = sym => `name copies a major token (${sym}) but isn't the real contract`;

// Returns { severity: "medium", note, copies } or null.
export function impersonation(chain, address, { name, symbol } = {}) {
  if (!address) return null;
  if (OFFICIAL_ADDRESSES[chain]?.has(String(address).toLowerCase())) return null;
  for (const v of [symbol, name]) { const n = normalize(v), sym = MAJOR[n] ?? CHAIN_MAJOR[chain]?.[n]; if (sym) return { severity: "medium", note: IMPERSONATION_NOTE(sym), copies: sym }; }
  return null;
}

const ORDER = ["low", "medium", "medium-high", "high", "critical"];
// Raise a risk level to at least medium ("n/a", "unknown", "review" and "low" become "medium").
export const atLeastMedium = lvl => (ORDER.indexOf(lvl) >= 1 ? lvl : "medium");
