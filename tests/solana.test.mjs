// Solana mint check: offline unit tests + live tests on public Solana RPC. Run: node --test tests/
import test from "node:test"; import assert from "node:assert/strict";
import { solanaToken, findPda, isOnCurve, isPubkey, b58decode, b58encode, parseMetaplex, P } from "../solana.js";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FARTCOIN = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump"; // pump.fun coin that graduated before PumpSwap existed
const QUACK = "2TU8KK1dyBQfkZCR7Ziwc9LvWXFcD1rPd5MNqPzypump";   // pump.fun coin graduated to PumpSwap (Oct 26 2026)
const show = (n, r) => console.log(`  ${n}: ${r.token?.name} (${r.token?.symbol}) risk=${r.riskLevel} mintAuth=${r.mintAuthority?.active} freeze=${r.freezeAuthority?.active} mutable=${r.metadata?.isMutable} pump=${r.pumpfun?.isPumpFun ? r.pumpfun.status + (r.pumpfun.pool?.lpBurnedPct != null ? " lpBurned=" + r.pumpfun.pool.lpBurnedPct + "%" : "") : "no"} top10ex=${r.holders?.top10ExcludingPoolsPct}%`);

test("base58 round trip + pubkey validation", () => {
  assert.equal(b58encode(b58decode(BONK)), BONK); assert.equal(b58decode(BONK).length, 32);
  assert.ok(isPubkey(P.system)); assert.ok(isPubkey(BONK));
  assert.equal(isPubkey("1".repeat(43)), false); assert.equal(isPubkey("0x532f27101965dd16442E59d40670FaF5eBB142E4"), false); assert.equal(isPubkey("hello"), false);
});
test("PDA derivation matches known on-chain addresses", () => {
  // Associated token account of Binance's BONK wallet (seen in getTokenLargestAccounts)
  const ata = findPda([b58decode("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"), b58decode(P.token), b58decode(BONK)], "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  assert.equal(ata, "5hpfC9VBxVcoW9opCnM2PqR6YWRLBzrBpabJTZnwwNiw");
  assert.equal(isOnCurve(b58decode(ata)), false); assert.equal(isOnCurve(b58decode("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")), true);
});
test("Metaplex parser", () => {
  const ua = b58decode(BONK), s = x => { const b = Buffer.from(x); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const buf = Buffer.concat([Buffer.from([4]), ua, ua, s("Bonk\0\0"), s("Bonk"), s("https://x"), Buffer.from([0, 0]), Buffer.from([0]), Buffer.from([1]), Buffer.from([1])]);
  assert.deepEqual(parseMetaplex(buf), { updateAuthority: BONK, name: "Bonk", symbol: "Bonk", uri: "https://x", isMutable: true });
});
test("invalid address -> 400 error, no RPC", async () => {
  await assert.rejects(solanaToken("0OOl"), e => e.status === 400);
});

test("live: BONK (classic SPL, Metaplex metadata, not pump.fun)", { timeout: 60000 }, async () => {
  const r = await solanaToken(BONK); show("BONK", r);
  assert.equal(r.kind, "mint"); assert.equal(r.tokenProgram, "spl-token"); assert.equal(r.token.symbol, "Bonk"); assert.equal(r.token.decimals, 5);
  assert.equal(r.mintAuthority.active, false); assert.equal(r.freezeAuthority.active, false);
  assert.equal(r.metadata.source, "metaplex"); assert.equal(typeof r.metadata.isMutable, "boolean");
  assert.equal(r.pumpfun.isPumpFun, false); assert.ok(r.couldNotDetermine.some(x => /LP burn/.test(x)));
  if (r.holders.available) { assert.ok(r.holders.top10Pct > 0 && r.holders.top10Pct <= 100); assert.ok(r.holders.top.length > 0); }
  assert.match(r.disclaimer, /not a guarantee/i);
});
test("live: USDC flags active mint + freeze authority", { timeout: 60000 }, async () => {
  const r = await solanaToken(USDC); show("USDC", r);
  assert.equal(r.mintAuthority.active, true); assert.equal(r.freezeAuthority.active, true); assert.equal(r.riskLevel, "high");
  assert.ok(r.findings.some(f => /Freeze authority/.test(f.note)));
});
test("live: pump.fun coins (graduated pre-PumpSwap + PumpSwap)", { timeout: 90000 }, async () => {
  const f = await solanaToken(FARTCOIN); show("Fartcoin", f);
  assert.equal(f.pumpfun.isPumpFun, true); assert.equal(f.pumpfun.status, "graduated"); assert.equal(f.mintAuthority.active, false);
  const q = await solanaToken(QUACK); show("QUACK", q);
  assert.equal(q.pumpfun.isPumpFun, true); assert.equal(q.pumpfun.status, "graduated"); assert.equal(q.tokenProgram, "token-2022");
  assert.equal(q.pumpfun.pool?.dex, "PumpSwap"); assert.equal(typeof q.pumpfun.pool.lpBurnedPct, "number");
  if (q.holders.available) assert.ok(q.holders.top.some(h => h.label === "PumpSwap pool"), "pool excluded from holders");
});
test("live: a fresh pump.fun coin still on the bonding curve (found from recent pump.fun txs)", { timeout: 120000 }, async (t) => {
  const rpc = async (m, p) => { for (const u of ["https://public.rpc.solanavibestation.com", "https://api.mainnet-beta.solana.com"]) { try { const j = await (await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json(); if (j.result !== undefined) return j.result; } catch {} } return null; };
  const sigs = (await rpc("getSignaturesForAddress", [P.pump, { limit: 12 }])) || [];
  let found = null;
  for (const s of sigs) { const tx = await rpc("getTransaction", [s.signature, { maxSupportedTransactionVersion: 1 }]);
    for (const b of tx?.meta?.postTokenBalances || []) if (b.mint.endsWith("pump")) { const r = await solanaToken(b.mint).catch(() => null); if (r?.pumpfun?.status === "on-curve") { found = r; break; } }
    if (found) break; await new Promise(r => setTimeout(r, 300)); }
  if (!found) return t.skip("no on-curve pump.fun coin found in the last few txs (RPC limits)");
  show("fresh pump coin " + found.address, found);
  assert.equal(found.pumpfun.isPumpFun, true); assert.ok(found.pumpfun.progressPct == null || (found.pumpfun.progressPct >= 0 && found.pumpfun.progressPct <= 100));
  if (found.holders.available) assert.ok(found.holders.top.some(h => h.label === "pump.fun bonding curve"));
});
test("live: wallet and token account are recognized, not treated as mints", { timeout: 60000 }, async () => {
  const w = await solanaToken("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"); assert.equal(w.kind, "wallet");
  const ta = await solanaToken("5hpfC9VBxVcoW9opCnM2PqR6YWRLBzrBpabJTZnwwNiw"); assert.equal(ta.kind, "token-account"); assert.equal(ta.mintOfThisAccount, BONK);
});
test("route: /v1/solana/token returns 402 unpaid, 400 on bad input (local app)", { timeout: 30000 }, async () => {
  process.env.NO_LISTEN = "1"; const app = (await import("../server.js")).default;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${base}/v1/solana/token?address=${BONK}`)).status, 402);
    assert.equal((await fetch(`${base}/v1/solana/token?address=0xabc`)).status, 400);
    assert.equal((await fetch(`${base}/v1/solana/token?address=${"1".repeat(43)}`)).status, 400);
    const h = await (await fetch(`${base}/health`)).json(); assert.ok(h.ok); assert.ok(h.endpoints.some(e => e.url.includes("/v1/solana/token")));
  } finally { srv.close(); }
});
