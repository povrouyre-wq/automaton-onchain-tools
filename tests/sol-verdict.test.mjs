// Solana quick verdict ($0.02) + share cards for every verdict. Offline unit tests, route checks, and one live Solana read.
import test from "node:test"; import assert from "node:assert/strict";
import net from "node:net";
const sockets = new Set(); const hang = net.createServer(x => { sockets.add(x); x.on("error", () => {}); }); await new Promise(r => hang.listen(0, "127.0.0.1", r)); hang.unref();
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: `http://127.0.0.1:${hang.address().port}`, X402_NETWORK: "eip155:8453", SHARE_SECRET: "test-share-key" });
const { default: app } = await import("../server.js");
const { scoreSolanaVerdict, solanaVerdict } = await import("../sol-verdict.js");
const { oneLineTake, makeShareId, readShareId, withShare, cardPng } = await import("../share.js");
const srv = app.listen(0); await new Promise(r => srv.once("listening", r)); srv.unref();
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); for (const x of sockets) x.destroy(); hang.close(); });

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const clean = { official: false, mintAuthorityActive: false, freezeAuthorityActive: false, permanentDelegate: false, transferHook: false, transferHookChangeable: false,
  transferFeePct: 0, transferFeeChangeable: false, nonTransferable: false, defaultFrozen: false, paused: false, pausable: false, metadataMutable: false,
  top10HolderPct: 8, largestWalletPct: 3, pumpfunStatus: "graduated", curveProgressPct: null, lpBurnedOrLockedPct: 100, liquidityUsd: 250000, poolCount: 2, liquidityError: false, copycatName: false };
const v = patch => scoreSolanaVerdict({ ...clean, ...patch }).verdict;

test("solana verdict thresholds", () => {
  assert.equal(v({}), "SAFE"); assert.equal(scoreSolanaVerdict(clean).riskLevel, "low");
  assert.equal(v({ mintAuthorityActive: true }), "AVOID");
  assert.equal(v({ freezeAuthorityActive: true }), "AVOID");
  assert.equal(v({ permanentDelegate: true }), "AVOID"); assert.equal(scoreSolanaVerdict({ ...clean, permanentDelegate: true }).riskLevel, "critical");
  assert.equal(v({ nonTransferable: true }), "AVOID"); assert.equal(v({ defaultFrozen: true }), "AVOID"); assert.equal(v({ paused: true }), "AVOID");
  assert.equal(v({ transferHook: true, transferHookChangeable: true }), "AVOID");
  assert.equal(v({ transferHook: true }), "CAUTION"); assert.equal(v({ transferHookChangeable: true }), "CAUTION");
  assert.equal(v({ transferFeePct: 5 }), "AVOID"); assert.equal(v({ transferFeePct: 4.99 }), "CAUTION"); assert.equal(v({ transferFeePct: 1.5 }), "CAUTION"); assert.equal(v({ transferFeePct: 1 }), "SAFE");
  assert.equal(v({ transferFeeChangeable: true }), "CAUTION"); assert.equal(v({ pausable: true }), "CAUTION");
  assert.equal(v({ metadataMutable: true }), "CAUTION"); assert.equal(v({ metadataMutable: null }), "SAFE");
  assert.equal(v({ top10HolderPct: 50 }), "AVOID"); assert.equal(v({ top10HolderPct: 49.99 }), "CAUTION"); assert.equal(v({ top10HolderPct: 20 }), "CAUTION"); assert.equal(v({ top10HolderPct: 19.99 }), "SAFE");
  assert.equal(v({ top10HolderPct: null, largestWalletPct: null }), "SAFE"); assert.equal(v({ largestWalletPct: 10 }), "CAUTION");
  assert.equal(v({ lpBurnedOrLockedPct: null }), "CAUTION"); assert.equal(v({ lpBurnedOrLockedPct: 49.9 }), "CAUTION"); assert.equal(v({ lpBurnedOrLockedPct: 50 }), "SAFE");
  assert.equal(v({ liquidityUsd: 9999 }), "CAUTION"); assert.equal(v({ liquidityUsd: null, poolCount: 0 }), "CAUTION"); assert.equal(v({ liquidityUsd: null, liquidityError: true }), "CAUTION");
  assert.equal(v({ pumpfunStatus: "on-curve", curveProgressPct: 30, lpBurnedOrLockedPct: null, liquidityUsd: null, poolCount: 0 }), "SAFE");
  assert.equal(v({ pumpfunStatus: "on-curve", curveProgressPct: 1, lpBurnedOrLockedPct: null }), "CAUTION");
  assert.equal(v({ copycatName: true, copycatNote: "name copies a major token (USDC) but isn't the real mint" }), "AVOID");
  // Official issuer mints keep their powers: CAUTION, not AVOID, and pool/LP rules don't apply.
  assert.equal(v({ official: true, mintAuthorityActive: true, freezeAuthorityActive: true, lpBurnedOrLockedPct: null, pumpfunStatus: null }), "CAUTION");
  assert.equal(v({ official: true, pumpfunStatus: null, lpBurnedOrLockedPct: null }), "SAFE");
});

test("one-line takes are deterministic and follow the lead flag", () => {
  const base = { chain: "base", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", token: { symbol: "BRETT" } };
  assert.match(oneLineTake({ ...base, verdict: "AVOID", flags: { sellable: false } }), /^\$BRETT: the buy button works, the sell button doesn't/);
  assert.match(oneLineTake({ ...base, verdict: "AVOID", flags: { sellable: true, buyTaxPct: 6, sellTaxPct: 6 } }), /12% round-trip tax/);
  assert.match(oneLineTake({ ...base, verdict: "AVOID", flags: { sellable: true, copycatName: true } }), /Copycat\.$/);
  assert.match(oneLineTake({ ...base, verdict: "CAUTION", flags: { sellable: true, lpBurnedOrLockedPct: null } }), /can prove the liquidity is locked/);
  assert.match(oneLineTake({ ...base, verdict: "SAFE", flags: { sellable: true } }), /Still not an audit\.$/);
  const sol = { chain: "solana", address: BONK, token: { symbol: "Bonk" } };
  assert.match(oneLineTake({ ...sol, verdict: "AVOID", flags: { mintAuthorityActive: true } }), /mint is still open/);
  assert.match(oneLineTake({ ...sol, verdict: "AVOID", flags: { freezeAuthorityActive: true } }), /freeze your tokens/);
  assert.match(oneLineTake({ ...sol, verdict: "CAUTION", flags: { metadataMutable: true, liquidityUsd: 700000 } }), /name and logo can still be swapped/);
  assert.match(oneLineTake({ ...sol, verdict: "CAUTION", flags: { officialIssuerMint: true } }), /issuer holds the keys/);
  assert.match(oneLineTake({ ...sol, verdict: "SAFE", flags: { pumpfun: "on-curve" } }), /bonding curve/);
  const x = { ...sol, verdict: "CAUTION", flags: { top10HolderPct: 31.2 } }; assert.equal(oneLineTake(x), oneLineTake(x));
});

test("share ids are signed: round trip, tamper and wrong key fail", () => {
  const vv = withShare({ chain: "solana", address: BONK, token: { symbol: "Bonk", name: "Bonk" }, verdict: "CAUTION", riskLevel: "medium", flags: { metadataMutable: true },
    findings: [{ severity: "medium", note: "Metadata is mutable." }, { severity: "info", note: "x" }] }, "https://example.test");
  assert.ok(vv.take && vv.share?.url.startsWith("https://example.test/v/") && vv.share.image.endsWith(".png"));
  const id = vv.share.url.split("/v/")[1], d = readShareId(id);
  assert.equal(d.V, "CAUTION"); assert.equal(d.a, BONK); assert.equal(d.t, vv.take); assert.equal(d.f[0][1], "Metadata is mutable.");
  assert.equal(readShareId(id, "other-key"), null);
  const [body, sig] = id.split("."); assert.equal(readShareId(`${body}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`), null);
  assert.equal(readShareId("garbage"), null);
  assert.equal(makeShareId(vv, null), null);
});

test("share page and PNG are served; tampered ids are 404", { timeout: 30000 }, async () => {
  const vv = withShare({ chain: "base", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", token: { symbol: "BRETT", name: "Brett" }, verdict: "SAFE", riskLevel: "low", flags: { sellable: true }, findings: [] }, BASE);
  const page = await fetch(vv.share.url); assert.equal(page.status, 200); const html = await page.text();
  assert.match(html, /twitter:card" content="summary_large_image"/); assert.match(html, /og:image" content="[^"]+\.png"/); assert.match(html, /SAFE/);
  const png = await fetch(vv.share.image); assert.equal(png.status, 200); assert.equal(png.headers.get("content-type"), "image/png");
  const b = Buffer.from(await png.arrayBuffer()); assert.equal(b.subarray(1, 4).toString(), "PNG"); assert.equal(b.readUInt32BE(16), 1200); assert.equal(b.readUInt32BE(20), 630);
  assert.equal((await fetch(vv.share.url + "x")).status, 404); assert.equal((await fetch(BASE + "/v/nope.png")).status, 404);
});

test("solanaVerdict packages the mint check (injected data) and refuses non-mints with 422", async () => {
  const chk = { kind: "mint", tokenProgram: "spl-token", token: { name: "Bonk", symbol: "Bonk", decimals: 5, supply: "1" }, mintAuthority: { active: false }, freezeAuthority: { active: false },
    metadata: { isMutable: true }, extensions: { present: [] }, pumpfun: { isPumpFun: false }, holders: { available: true, basis: "largest 20", top10ExcludingPoolsPct: 12, largestWalletPct: 4 }, copycat: null, couldNotDetermine: [] };
  const r = await solanaVerdict(BONK, { solanaToken: async () => chk, dexLiquidity: async () => ({ source: "dexscreener", poolCount: 3, totalUsd: 500000, pools: [] }) });
  assert.equal(r.type, "token-verdict"); assert.equal(r.chain, "solana"); assert.equal(r.verdict, "CAUTION");
  assert.match(r.summary, /^Bonk on Solana: CAUTION because metadata is mutable/); assert.equal(r.flags.liquidityUsd, 500000);
  const usdc = await solanaVerdict(USDC, { solanaToken: async () => ({ ...chk, token: { symbol: "USDC" }, mintAuthority: { active: true }, freezeAuthority: { active: true }, metadata: { isMutable: true } }), dexLiquidity: async () => ({ poolCount: 30, totalUsd: 9e7, pools: [] }) });
  assert.equal(usdc.verdict, "CAUTION"); assert.equal(usdc.flags.officialIssuerMint, true);
  await assert.rejects(solanaVerdict(BONK, { solanaToken: async () => ({ kind: "wallet", summary: "This is a wallet, not a token mint." }), dexLiquidity: async () => ({}) }), e => e.status === 422);
  await assert.rejects(solanaVerdict("nope"), e => e.status === 400);
});

test("402 for /v1/solana/verdict: $0.02 with Bazaar discovery; bad input is a free 400; listed in openapi + landing", { timeout: 20000 }, async () => {
  const r = await fetch(`${BASE}/v1/solana/verdict`); assert.equal(r.status, 402);
  const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString()); const a = req.accepts[0];
  assert.equal(a.amount, "20000"); assert.equal(a.network, "eip155:8453");
  assert.ok(req.extensions?.bazaar?.info?.input); assert.ok(req.resource.description.length <= 500, String(req.resource.description.length));
  assert.equal((await fetch(`${BASE}/v1/solana/verdict?token=0x123`)).status, 400);
  assert.equal((await fetch(`${BASE}/v1/solana/verdict?token=${"1".repeat(43)}`)).status, 400);
  const o = await (await fetch(BASE + "/openapi.json")).json();
  assert.equal(o.paths["/v1/solana/verdict"].get.operationId, "solana_token_verdict");
  const w = await (await fetch(BASE + "/.well-known/x402")).json(); assert.ok(w.resources.some(u => u.endsWith("/v1/solana/verdict")));
  const land = await (await fetch(BASE + "/")).text(); assert.match(land, /Solana/);
});

test("live: Bonk verdict from public Solana RPC + DexScreener", { timeout: 60000 }, async t => {
  let r; try { r = await solanaVerdict(BONK); } catch (e) { return t.skip("public RPC unavailable: " + e.message); }
  console.log(`  ${r.summary} | take: ${withShare(r, "https://x").take}`);
  assert.equal(r.token.symbol, "Bonk"); assert.equal(r.flags.mintAuthorityActive, false); assert.equal(r.flags.freezeAuthorityActive, false);
  assert.ok(["SAFE", "CAUTION", "AVOID"].includes(r.verdict));
  const png = await cardPng(readShareId(r.share.url.split("/v/")[1])); assert.ok(png.length > 10000);
});
