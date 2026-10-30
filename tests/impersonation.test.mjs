// Copycat / impersonation flag: offline unit tests + live checks on real and fake tokens. Run: node --test tests/
import test from "node:test"; import assert from "node:assert/strict";
import { impersonation, normalize, atLeastMedium, OFFICIAL_ADDRESSES, IMPERSONATION_NOTE } from "../impersonation.js";
import { withImpersonation } from "../launches.js";
import { solanaToken } from "../solana.js";
import { tokenReport } from "../reports.js";

const FAKE_SOL = "FakeUsdc1111111111111111111111111111111pump", FAKE_EVM = "0x1234567890abcdef1234567890abcdef12345678";
// Every official address with the symbol and name GeckoTerminal reports for it (Oct 30 2026). None may ever be flagged.
const REAL = {
  base: [["0x4200000000000000000000000000000000000006", "WETH", "Wrapped Ether"], ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USD Coin"], ["0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", "USDbC", "USD Base Coin"],
    ["0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", "DAI", "Dai Stablecoin"], ["0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "cbBTC", "Coinbase Wrapped BTC"], ["0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", "cbETH", "Coinbase Wrapped Staked ETH"],
    ["0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", "WBTC", "Wrapped BTC"], ["0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", "EURC", "EURC"], ["0x820C137fa70C8691f0e44Dc420a5e53c168921Dc", "USDS", "USDS Stablecoin"],
    ["0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", "USDe", "USDe"], ["0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", "wstETH", "Wrapped liquid staked Ether 2.0"], ["0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", "USDT", "Tether USD"]],
  bsc: [["0x55d398326f99059fF775485246999027B3197955", "USDT", "Tether USD"], ["0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", "USDC", "USD Coin"], ["0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", "WBNB", "Wrapped BNB"],
    ["0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", "BUSD", "BUSD Token"], ["0x2170Ed0880ac9A755fd29B2688956BD959F933F8", "ETH", "Ethereum Token"], ["0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", "BTCB", "BTCB Token"],
    ["0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", "FDUSD", "First Digital USD"], ["0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", "USD1", "World Liberty Financial USD"], ["0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", "DAI", "Dai Token"],
    ["0x40af3827F39D0EAcBF4A168f8D4ee67c121D11c9", "TUSD", "TrueUSD"], ["0x570A5D26f7765Ecb712C0924E4De545B89fD43dF", "SOL", "SOLANA"], ["0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", "USDe", "USDe"]],
  ethereum: [["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USD Coin"], ["0xdAC17F958D2ee523a2206206994597C13D831ec7", "USDT", "Tether USD"], ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "WETH", "Wrapped Ether"],
    ["0x6B175474E89094C44Da98b954EedeAC495271d0F", "DAI", "Dai Stablecoin"], ["0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", "WBTC", "Wrapped BTC"], ["0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", "stETH", "Liquid staked Ether 2.0"],
    ["0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", "wstETH", "Wrapped liquid staked Ether 2.0"], ["0x4Fabb145d64652a948d72533023f6E7A623C7C53", "BUSD", "Binance USD"], ["0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", "PYUSD", "PayPal USD"],
    ["0x4c9EDD5852cd905f086C759E8383e09bff1E68B3", "USDe", "USDe"], ["0xdC035D45d973E3EC169d2276DDab16f1e407384F", "USDS", "USDS Stablecoin"], ["0x0000000000085d4780B73119b644AE5ecd22b376", "TUSD", "TrueUSD"],
    ["0xBe9895146f7AF43049ca1c1AE358B0541Ea49704", "cbETH", "Coinbase Wrapped Staked ETH"], ["0xB8c77482e45F1F44dE1745F52C74426C631bDD52", "BNB", "BNB"], ["0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", "EUROC", "Euro Coin"],
    ["0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", "FDUSD", "First Digital USD"], ["0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", "USD1", "World Liberty Financial USD"], ["0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "cbBTC", "Coinbase Wrapped BTC"]],
  solana: [["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC", "USD Coin"], ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT", "USDT"], ["So11111111111111111111111111111111111111112", "SOL", "Wrapped SOL"],
    ["2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", "PYUSD", "PayPal USD"], ["USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB", "USD1", "World Liberty Financial USD"], ["7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", "WETH", "Wrapped Ether (Wormhole)"],
    ["cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", "cbBTC", "Coinbase Wrapped BTC"], ["3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", "WBTC", "Wrapped BTC (Wormhole)"], ["USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", "USDS", "USDS"],
    ["9gP2kCy3wA1ctvYWQk75guqXuHfrEomqydHLtcTCqiLa", "WBNB", "Wrapped BNB (Wormhole)"], ["DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT", "USDe", "USDe"], ["9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u", "FDUSD", "First Digital USD"],
    ["EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCWNWqxWV4J6o", "DAI", "Dai Stablecoin (Wormhole)"]],
  // Lookup-only chains: symbol and name as read onchain (Oct 30 2026).
  arbitrum: [["0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "USDC", "USD Coin"], ["0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", "USDC", "USD Coin (Arb1)"], ["0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", "USD₮0", "USD₮0"], ["0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "WETH", "Wrapped Ether"], ["0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", "WBTC", "Wrapped BTC"], ["0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", "DAI", "Dai Stablecoin"], ["0x912CE59144191C1204E64559FE8253a0e49E6548", "ARB", "Arbitrum"], ["0x5979D7b546E38E414F7E9822514be443A4800529", "wstETH", "Wrapped liquid staked Ether 2.0"], ["0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "cbBTC", "Coinbase Wrapped BTC"], ["0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", "USDe", "USDe"], ["0x46850aD61C2B7d64d08c9C754F45254596696984", "PYUSD", "PayPal USD"]],
  optimism: [["0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "USDC", "USD Coin"], ["0x7F5c764cBc14f9669B88837ca1490cCa17c31607", "USDC", "USD Coin"], ["0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", "USDT", "Tether USD"], ["0x01bFF41798a0BcF287b996046Ca68b395DbC1071", "USD₮0", "USD₮0"], ["0x4200000000000000000000000000000000000006", "WETH", "Wrapped Ether"], ["0x68f180fcCe6836688e9084f035309E29Bf0A2095", "WBTC", "Wrapped BTC"], ["0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", "DAI", "Dai Stablecoin"], ["0x4200000000000000000000000000000000000042", "OP", "Optimism"], ["0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb", "wstETH", "Wrapped liquid staked Ether 2.0"], ["0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", "USDe", "USDe"]],
  polygon: [["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "USDC", "USD Coin"], ["0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", "USDC", "USD Coin (PoS)"], ["0xc2132D05D31c914a87C6611C10748AEb04B58e8F", "USDT0", "USDT0"], ["0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", "WETH", "Wrapped Ether"], ["0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "WPOL", "Wrapped Polygon Ecosystem Token"], ["0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", "WBTC", "(PoS) Wrapped BTC"], ["0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", "DAI", "(PoS) Dai Stablecoin"], ["0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD", "wstETH", "Wrapped liquid staked Ether 2.0 (PoS)"], ["0x99aF3EeA856556646C98c8B9b2548Fe815240750", "PYUSD", "PayPal USD"], ["0x0000000000000000000000000000000000001010", "POL", "Polygon Ecosystem Token"]],
  avalanche: [["0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", "USDC", "USD Coin"], ["0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", "USDt", "TetherToken"], ["0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664", "USDC.e", "USD Coin"], ["0xc7198437980c041c805A1EDcbA50c1Ce5db95118", "USDT.e", "Tether USD"], ["0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", "WAVAX", "Wrapped AVAX"], ["0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", "WETH.e", "Wrapped Ether"], ["0x152b9d0FdC40C096757F570A51E494bd4b943E50", "BTC.b", "Bitcoin"], ["0x50b7545627a5162F82A992c33b87aDc75187B218", "WBTC.e", "Wrapped BTC"], ["0xd586E7F844cEa2F87f50152665BCbc2C279D8d70", "DAI.e", "Dai Stablecoin"], ["0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD", "EURC", "Euro Coin"], ["0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", "USDe", "USDe"]],
};

test("normalize: case, spaces, punctuation, fullwidth and lookalike letters", () => {
  assert.equal(normalize(" u.s.d-c "), "USDC"); assert.equal(normalize("$USDC"), "USDC"); assert.equal(normalize("ＵＳＤＣ"), "USDC");
  assert.equal(normalize("USDС"), "USDC"); /* Cyrillic С */ assert.equal(normalize("ЕТН"), "ETH"); assert.equal(normalize("Wrapped Ether\0\0"), "WRAPPEDETHER"); assert.equal(normalize(null), "");
});
test("fake majors are flagged on every chain, symbol or name", () => {
  const cases = [["solana", FAKE_SOL, { name: "USDC", symbol: "USDC" }, "USDC"], ["solana", FAKE_SOL, { name: "my coin", symbol: "usdc" }, "USDC"], ["solana", FAKE_SOL, { name: "Solana", symbol: "SOLANA2" }, "SOL"],
    ["base", FAKE_EVM, { name: "Tether USD", symbol: "TETHER" }, "USDT"], ["base", FAKE_EVM, { name: "x", symbol: "w eth" }, "WETH"], ["bsc", FAKE_EVM, { name: "Wrapped BNB", symbol: "WBNB" }, "WBNB"],
    ["bsc", FAKE_EVM, { name: "z", symbol: "B.T.C" }, "BTC"], ["bsc", FAKE_EVM, { name: "z", symbol: "USD1" }, "USD1"], ["ethereum", FAKE_EVM, { name: "PayPal USD", symbol: "x" }, "PYUSD"],
    ["solana", FAKE_SOL, { name: "First Digital USD", symbol: "FD" }, "FDUSD"], ["base", FAKE_EVM, { name: "Dai", symbol: "dai" }, "DAI"], ["bsc", FAKE_EVM, { name: "busd", symbol: "BUSD" }, "BUSD"]];
  for (const [c, a, t, sym] of cases) { const f = impersonation(c, a, t); assert.ok(f, `${c} ${JSON.stringify(t)} should be flagged`); assert.equal(f.copies, sym); assert.equal(f.severity, "medium");
    assert.equal(f.note, `name copies a major token (${sym}) but isn't the real contract`); }
  // A real token's address on another chain is still a copy there; a native placeholder doesn't count on Solana.
  assert.ok(impersonation("bsc", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", { symbol: "USDC" }));
});
test("ordinary tokens are not flagged", () => {
  for (const t of [{ name: "Pepe", symbol: "PEPE" }, { name: "USDC-SOL", symbol: "USDC-SOL" }, { name: "Syrup USDC", symbol: "syrupUSDC" }, { name: "Bonk", symbol: "Bonk" }, { name: null, symbol: null }, {}, { name: "Brett", symbol: "BRETT" }])
    for (const c of ["base", "bsc", "solana"]) assert.equal(impersonation(c, c === "solana" ? FAKE_SOL : FAKE_EVM, t), null, JSON.stringify(t));
});
test("real official tokens are never flagged (any case of address)", () => {
  let n = 0;
  for (const [c, list] of Object.entries(REAL)) for (const [a, symbol, name] of list) {
    for (const addr of [a, a.toLowerCase(), c === "solana" ? a : a.toUpperCase().replace(/^0X/, "0x")]) assert.equal(impersonation(c, addr, { name, symbol }), null, `${c} ${symbol} ${addr}`);
    assert.ok(OFFICIAL_ADDRESSES[c].has(a.toLowerCase())); n++; }
  // Native ETH/BNB placeholders, as GeckoTerminal reports them for Uniswap v4 native pools.
  for (const [c, symbol, name] of [["base", "ETH", "Ether"], ["bsc", "BNB", "BNB"], ["ethereum", "ETH", "Ether"], ["arbitrum", "ETH", "Ether"], ["optimism", "ETH", "Ether"], ["polygon", "POL", "POL"], ["avalanche", "AVAX", "Avalanche"]]) for (const a of ["0x0000000000000000000000000000000000000000", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"]) {
    assert.equal(impersonation(c, a, { name, symbol }), null, `${c} native ${a}`); n++; }
  assert.equal(n, Object.values(OFFICIAL_ADDRESSES).reduce((s, x) => s + x.size, 0), "every official address has a fixture");
});
test("atLeastMedium never lowers risk", () => {
  assert.deepEqual(["low", "n/a", "unknown", "review", undefined, "medium", "medium-high", "high", "critical"].map(atLeastMedium), ["medium", "medium", "medium", "medium", "medium", "medium", "medium-high", "high", "critical"]);
});
test("launch feed: low-risk copycat becomes medium with the flag first; real token untouched; no duplicate flag", () => {
  const low = { checkedAt: "t", riskLevel: "low", flags: [{ severity: "low", note: "other" }] };
  const r = withImpersonation("solana", { address: FAKE_SOL, name: "USDC", symbol: "USDC" }, low);
  assert.equal(r.riskLevel, "medium"); assert.equal(r.impersonates, "USDC"); assert.equal(r.flags[0].note, IMPERSONATION_NOTE("USDC")); assert.equal(r.flags.length, 2);
  assert.equal(withImpersonation("solana", { address: FAKE_SOL, name: "USDC", symbol: "USDC" }, { riskLevel: "high", flags: [] }).riskLevel, "high");
  const again = withImpersonation("solana", { address: FAKE_SOL, name: "USDC", symbol: "USDC" }, { riskLevel: "medium", flags: [{ severity: "medium", note: IMPERSONATION_NOTE("USDC") }] });
  assert.equal(again.flags.length, 1);
  assert.equal(withImpersonation("unknown-check", { address: FAKE_EVM, symbol: "WETH" }, { riskLevel: "unknown", flags: [] }).riskLevel, "medium");
  const real = { riskLevel: "low", flags: [] };
  assert.equal(withImpersonation("solana", { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", name: "USD Coin", symbol: "USDC" }, real), real);
  assert.equal(withImpersonation("base", { address: "0x4200000000000000000000000000000000000006", name: "Wrapped Ether", symbol: "WETH" }, real), real);
});

test("live: real Solana USDC is not flagged as a copycat", { timeout: 60000 }, async () => {
  const r = await solanaToken("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(r.token.symbol, "USDC"); assert.ok(!r.findings.some(f => /copies a major token/.test(f.note)));
});
test("live: real Base USDC and BNB Chain USDT token reports are not flagged", { timeout: 90000 }, async () => {
  for (const [c, a] of [["base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"], ["bsc", "0x55d398326f99059fF775485246999027B3197955"]]) {
    const r = await tokenReport(a, c); assert.ok(r.inspect.erc20, c); assert.ok(!r.findings.some(f => /copies a major token/.test(f.note)), c); }
});
