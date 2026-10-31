// Solana wallet lookups (/v1/solana/address, /v1/solana/delegates): offline tests with a mocked RPC, RPC failover,
// paywall checks for the new routes, and tolerant live tests on public Solana RPC. Run: node --test tests/
import test from "node:test"; import assert from "node:assert/strict";
import http from "node:http"; import net from "node:net";
import { solanaAddress, solanaDelegates, makeRpc, U64_MAX } from "../solana-wallet.js";
import { P } from "../solana.js";

const OWNER = "AfrpzTSG6F72B9kVQdXsMomqf1aLfDsLihe7SMhyhPtA";
const WALLET_DELEGATE = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"; // on-curve keypair address
const PDA = "5hpfC9VBxVcoW9opCnM2PqR6YWRLBzrBpabJTZnwwNiw";              // off-curve, no account in the mock
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const FAKE = "2TU8KK1dyBQfkZCR7Ziwc9LvWXFcD1rPd5MNqPzypump", T22 = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const ta = (pubkey, mint, amount, decimals, extra = {}) => ({ pubkey, account: { data: { parsed: { type: "account", info: { mint, owner: OWNER, state: extra.state || "initialized",
  tokenAmount: { amount: String(amount), decimals, uiAmountString: String(Number(amount) / 10 ** decimals) },
  ...(extra.delegate ? { delegate: extra.delegate, delegatedAmount: { amount: String(extra.delegated), decimals, uiAmountString: String(Number(extra.delegated) / 10 ** decimals) } } : {}),
  ...(extra.close ? { closeAuthority: extra.close } : {}) } } } } });
const SPL = [ta("A1", USDC, 5000000, 6, { delegate: WALLET_DELEGATE, delegated: U64_MAX }), ta("A2", BONK, 100000, 5, { delegate: JUP, delegated: 50000 }),
  ta("A3", FAKE, 1000, 0, { delegate: PDA, delegated: 1000 }), ta("A4", BONK, 0, 5, { delegate: PDA, delegated: 0, close: WALLET_DELEGATE }), ta("A5", FAKE, 7, 0, { state: "frozen" })];
const T2022 = [ta("B1", T22, 42, 0)];
const now = Date.parse("2026-10-31T18:00:00Z"), S = now / 1000;
function mockRpc({ sigPages = [[{ signature: "s1", blockTime: S - 3600, err: null }, { signature: "s0", blockTime: S - 30 * 86400, err: null, memo: "hi" }]], failTokens = false } = {}) {
  const calls = [];
  const fn = async (method, params) => { calls.push(method);
    if (method === "getAccountInfo") return { value: { owner: P.system, lamports: 1500000000, executable: false, data: ["", "base64"] } };
    if (method === "getTokenAccountsByOwner") { if (failTokens) throw new Error("rate limited"); return { value: params[1].programId === P.token ? SPL : T2022 }; }
    if (method === "getSignaturesForAddress") { const i = params[1].before ? Number(params[1].before.slice(1)) : 0; return sigPages[i] || []; }
    if (method === "getMultipleAccounts") { const enc = params[1].encoding;
      if (params[1].dataSlice) return { value: params[0].map(a => a === JUP ? { executable: true, owner: "BPFLoaderUpgradeab1e11111111111111111111111" } : a === WALLET_DELEGATE ? { executable: false, owner: P.system } : null) };
      if (enc === "jsonParsed") return { value: params[0].map(m => m === T22 ? { data: { parsed: { type: "mint", info: { extensions: [{ extension: "permanentDelegate", state: { delegate: WALLET_DELEGATE } }, { extension: "tokenMetadata", state: { name: "Odd", symbol: "ODD" } }] } } } }
        : m === FAKE ? { data: { parsed: { type: "mint", info: { extensions: [{ extension: "tokenMetadata", state: { name: "USD Coin", symbol: "USDC" } }] } } } } : { data: { parsed: { type: "mint", info: {} } } }) };
      return { value: params[0].map(() => null) }; }
    throw new Error("unexpected " + method); };
  fn.calls = calls; return fn;
}

test("invalid address -> 400, no RPC", async () => {
  const rpc = mockRpc();
  await assert.rejects(solanaAddress("0x532f27101965dd16442E59d40670FaF5eBB142E4", { rpc }), e => e.status === 400);
  await assert.rejects(solanaDelegates("1".repeat(43), { rpc }), e => e.status === 400); assert.equal(rpc.calls.length, 0);
});
test("delegates: unlimited wallet delegate is high, known program is low, unknown PDA medium; permanent delegate + close authority flagged", async () => {
  const r = await solanaDelegates(OWNER, { rpc: mockRpc() });
  assert.equal(r.type, "solana-delegates"); assert.equal(r.tokenAccountsChecked, 6); assert.equal(r.liveCount, 3); assert.equal(r.exhaustedDelegates, 1);
  assert.equal(r.unlimitedCount, 1); assert.equal(r.unknownCount, 2); assert.equal(r.riskLevel, "high");
  const [a, ...rest] = r.delegates; assert.equal(a.symbol, "USDC"); assert.equal(a.unlimited, true); assert.equal(a.delegatedAmount, "unlimited"); assert.equal(a.delegateType, "wallet"); assert.equal(a.severity, "high");
  const jup = r.delegates.find(d => d.delegate === JUP); assert.equal(jup.known, true); assert.equal(jup.delegateLabel, "Jupiter aggregator v6"); assert.equal(jup.severity, "low"); assert.equal(jup.coversFullBalance, false);
  const pda = r.delegates.find(d => d.delegate === PDA); assert.equal(pda.delegateType, "program-derived address"); assert.equal(pda.severity, "medium");
  assert.equal(r.permanentDelegates.length, 1); assert.equal(r.permanentDelegates[0].permanentDelegate, WALLET_DELEGATE);
  assert.ok(r.findings.some(f => /permanent delegate/.test(f.note) && f.severity === "high")); assert.ok(r.findings.some(f => /close authority/.test(f.note)));
  assert.match(r.findings[0].note, /UNLIMITED USDC/); assert.ok(r.howToRevoke); assert.match(r.summary, /3 live delegate/);
});
test("delegates: clean wallet is low risk; total RPC failure throws (no 200 for an empty answer)", async () => {
  const clean = async (m, p) => m === "getTokenAccountsByOwner" ? { value: [ta("C1", USDC, 1, 6)] } : { value: [] };
  const r = await solanaDelegates(OWNER, { rpc: clean }); assert.equal(r.riskLevel, "low"); assert.equal(r.liveCount, 0); assert.equal(r.howToRevoke, null);
  await assert.rejects(solanaDelegates(OWNER, { rpc: mockRpc({ failTokens: true }) }), /couldn't read token accounts/);
});
test("address: balances, copycat token, frozen, delegates, age and activity", async () => {
  const r = await solanaAddress(OWNER, { rpc: mockRpc(), now });
  assert.equal(r.kind, "wallet"); assert.equal(r.sol.balance, "1.5"); assert.equal(r.tokens.withBalance, 5); assert.equal(r.tokens.emptyAccounts, 1);
  assert.equal(r.tokens.list[0].symbol, "USDC", "known mints listed first"); assert.equal(r.liveDelegates, 3);
  assert.ok(r.findings.some(f => /copying a major asset/.test(f.note) && f.severity === "medium"), "fake USDC flagged");
  assert.ok(r.findings.some(f => /frozen/.test(f.note))); assert.ok(r.findings.some(f => /\/v1\/solana\/delegates/.test(f.note)));
  assert.equal(r.age.complete, true); assert.equal(r.age.firstSignature, "s0"); assert.equal(r.age.ageDays, 30);
  assert.equal(r.activity.totalTransactions, 2); assert.equal(r.activity.last24h, 1); assert.equal(r.activity.last7d, 1); assert.equal(r.activity.last30d, 2);
  assert.equal(r.activity.recent[1].memo, "hi"); assert.match(r.summary, /1\.5 SOL/);
});
test("address: busy wallet pages history back, then reports a lower bound", async () => {
  const page = (i) => Array.from({ length: 1000 }, (_, k) => ({ signature: `s${i + 1}`, blockTime: S - (i * 1000 + k) * 60, err: null }));
  const r = await solanaAddress(OWNER, { rpc: mockRpc({ sigPages: [page(0), page(1), page(2)] }), now, maxSigPages: 3 });
  assert.equal(r.age.complete, false); assert.equal(r.activity.totalTransactions, "3000+"); assert.ok(r.couldNotDetermine.some(x => /lower bound/.test(x)));
  assert.equal(r.activity.last24h, "1000+");
  const done = await solanaAddress(OWNER, { rpc: mockRpc({ sigPages: [page(0), page(1).slice(0, 10)] }), now });
  assert.equal(done.age.complete, true); assert.equal(done.activity.totalTransactions, 1010);
});

test("RPC failover: a hung RPC costs one timeout, then the next RPC answers", { timeout: 20000 }, async () => {
  const socks = new Set(); const hang = net.createServer(s => { socks.add(s); s.on("error", () => {}); }); await new Promise(r => hang.listen(0, "127.0.0.1", r));
  const good = http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: 7 } })); }); });
  await new Promise(r => good.listen(0, "127.0.0.1", r));
  try { const rpc = makeRpc([`http://127.0.0.1:${hang.address().port}`, `http://127.0.0.1:${good.address().port}`], { timeoutMs: 800 });
    const t = Date.now(); assert.deepEqual(await rpc("getBalance", ["x"]), { value: 7 }); const ms = Date.now() - t; assert.ok(ms >= 700 && ms < 3000, `took ${ms} ms`);
    const only = makeRpc([`http://127.0.0.1:${hang.address().port}`], { timeoutMs: 300 }); await assert.rejects(only("getBalance", ["x"]), /timeout after 300 ms/);
  } finally { for (const s of socks) s.destroy(); hang.close(); good.close(); }
});

test("paywall: new Solana paths answer 402 ($0.005, exact USDC on Base) and reject bad input free with 400", { timeout: 30000 }, async () => {
  Object.assign(process.env, { NO_LISTEN: "1", X402_NETWORK: "eip155:8453", SUPPORTED_WAIT_MS: "500" });
  const { default: app } = await import("../server.js");
  const srv = app.listen(0); await new Promise(r => srv.once("listening", r));
  try { const B = `http://127.0.0.1:${srv.address().port}`;
    for (const p of ["/v1/solana/address", "/v1/solana/delegates"]) {
      for (const q of ["", "?address=" + OWNER]) { const r = await fetch(B + p + q); assert.equal(r.status, 402, p + q);
        const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString()), a = req.accepts[0];
        assert.equal(a.scheme, "exact"); assert.equal(a.network, "eip155:8453"); assert.equal(a.amount, "5000"); assert.equal(a.asset, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
        assert.equal(a.payTo.toLowerCase(), "0x679af3a893edd0aef4ac4c7776ba581b238c0717"); assert.ok(req.extensions?.bazaar); assert.ok(req.resource.description.length <= 500); }
      const bad = await fetch(B + p + "?address=0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717", { headers: { "payment-signature": "x" } }); assert.equal(bad.status, 400); }
    const o = await (await fetch(B + "/openapi.json")).json();
    for (const p of ["/v1/solana/address", "/v1/solana/delegates"]) { assert.equal(o.paths[p].get["x-payment-info"].price.amount, "0.005"); assert.ok(o.paths[p].get.description.length <= 500); }
    const w = await (await fetch(B + "/.well-known/x402")).json(); assert.ok(w.resources.some(u => u.endsWith("/v1/solana/delegates")));
  } finally { srv.close(); }
});

test("live: address lookup + delegates on public Solana RPC", { timeout: 60000 }, async (t) => {
  const LIVE = "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S"; // a plain system-owned wallet
  const a = await solanaAddress(LIVE).catch(e => e);
  if (a instanceof Error) return t.skip("public Solana RPC unavailable: " + a.message);
  console.log(`  address: ${a.summary}`); assert.equal(a.type, "solana-address"); assert.ok(["wallet", "no-account"].includes(a.kind)); assert.ok(Array.isArray(a.findings));
  const d = await solanaDelegates(LIVE).catch(e => e);
  if (d instanceof Error) return t.skip("public Solana RPC unavailable: " + d.message);
  console.log(`  delegates: ${d.summary} risk=${d.riskLevel}`); assert.equal(d.type, "solana-delegates"); assert.ok(["low", "medium", "high"].includes(d.riskLevel));
  for (const x of d.delegates) { assert.ok(x.delegate && x.mint); assert.equal(typeof x.unlimited, "boolean"); }
});
