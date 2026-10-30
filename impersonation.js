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
};
export const OFFICIAL_ADDRESSES = Object.fromEntries(Object.entries(OFFICIAL).map(([c, a]) => [c, new Set(a.map(x => x.toLowerCase()))]));

// Normalized form -> display symbol. Symbols and well-known full names.
const MAJOR = Object.fromEntries(["USDC", "USDT", "ETH", "WETH", "BTC", "WBTC", "SOL", "WSOL", "BNB", "WBNB", "DAI", "BUSD", "FDUSD", "PYUSD", "USD1", "USDe", "USDS",
  "TUSD", "USDbC", "cbBTC", "cbETH", "BTCB", "stETH", "wstETH", "EURC"].map(s => [s.toUpperCase(), s]));
Object.assign(MAJOR, { USDCOIN: "USDC", TETHER: "USDT", TETHERUSD: "USDT", ETHER: "ETH", ETHEREUM: "ETH", WRAPPEDETHER: "WETH", WRAPPEDETH: "WETH", BITCOIN: "BTC",
  WRAPPEDBITCOIN: "WBTC", WRAPPEDBTC: "WBTC", SOLANA: "SOL", WRAPPEDSOL: "WSOL", WRAPPEDSOLANA: "WSOL", BINANCECOIN: "BNB", WRAPPEDBNB: "WBNB", DAISTABLECOIN: "DAI",
  BINANCEUSD: "BUSD", FIRSTDIGITALUSD: "FDUSD", PAYPALUSD: "PYUSD", WORLDLIBERTYFINANCIALUSD: "USD1", COINBASEWRAPPEDBTC: "cbBTC", EUROCOIN: "EURC", EUROC: "EURC" });

// Cyrillic/Greek letters that look like Latin ones (e.g. "USDС" with a Cyrillic С).
const LOOK = { "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I", "Ј": "J", "К": "K", "М": "M", "О": "O", "Р": "P", "Ѕ": "S", "Т": "T", "Х": "X", "У": "Y",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X" };
export const normalize = s => String(s ?? "").normalize("NFKC").toUpperCase().replace(/./gu, ch => LOOK[ch] ?? ch).replace(/[^A-Z0-9]/g, "");

export const IMPERSONATION_NOTE = sym => `name copies a major token (${sym}) but isn't the real contract`;

// Returns { severity: "medium", note, copies } or null.
export function impersonation(chain, address, { name, symbol } = {}) {
  if (!address) return null;
  if (OFFICIAL_ADDRESSES[chain]?.has(String(address).toLowerCase())) return null;
  for (const v of [symbol, name]) { const sym = MAJOR[normalize(v)]; if (sym) return { severity: "medium", note: IMPERSONATION_NOTE(sym), copies: sym }; }
  return null;
}

const ORDER = ["low", "medium", "medium-high", "high", "critical"];
// Raise a risk level to at least medium ("n/a", "unknown", "review" and "low" become "medium").
export const atLeastMedium = lvl => (ORDER.indexOf(lvl) >= 1 ? lvl : "medium");
