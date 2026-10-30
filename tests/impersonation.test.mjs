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
  // A real token's address on another chain is still a copy there.
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
