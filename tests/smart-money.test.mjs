// $0.02 BNB smart-money feed: early-buyer ranking, bundle-check exclusions, 402 + Bazaar, free 400s.
import test from "node:test"; import assert from "node:assert/strict";
import net from "node:net";
const sockets = new Set(); const hang = net.createServer(x => { sockets.add(x); x.on("error", () => {}); }); await new Promise(r => hang.listen(0, "127.0.0.1", r)); hang.unref();
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: `http://127.0.0.1:${hang.address().port}`, X402_NETWORK: "eip155:8453" });
const { default: app } = await import("../server.js");
const { indexEarlyWallets, isCoordinatedSniper, applyFundingTags } = await import("../bundles.js");
const { judgeRun, rankSmartMoney, parseFactoryLogs, pickLaunches, isSprayBot, multipleFromOhlcv, bscSmartMoney, bscSmartMoneyWallet } = await import("../smart-money.js");
const srv = app.listen(0); await new Promise(r => srv.once("listening", r)); srv.unref();
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); for (const x of sockets) x.destroy(); hang.close(); });

const pad = a => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const pair = "0x2222222222222222222222222222222222222222";
const token = "0x1111111111111111111111111111111111111111";
const wbnb = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

test("bundle classifier: solo early buy stays, bundled recipients and dev hand-outs are snipers", () => {
  const venues = new Set([pair]), devs = new Set(["0xdev"]), tok = token;
  const ev = [
    { block: 100, tx: "0x1", from: pair, to: "0xsolo", value: 10n },
    { block: 100, tx: "0x2", from: pair, to: "0xa", value: 5n },
    { block: 100, tx: "0x2", from: pair, to: "0xb", value: 4n },
    { block: 100, tx: "0x3", from: "0xdev", to: "0xc", value: 7n },
    { block: 104, tx: "0x4", from: pair, to: "0xlate", value: 3n },
    { block: 120, tx: "0x5", from: pair, to: "0xtoo", value: 9n },
  ];
  const { all, bundledTx } = indexEarlyWallets(ev, { venues, devs, token: tok, launchBlock: 100, window: 10 });
  const how = a => all.find(w => w.address === a)?.how;
  assert.equal(bundledTx.length, 1);
  assert.equal(isCoordinatedSniper(how("0xsolo")), false);
  assert.equal(isCoordinatedSniper(how("0xa")), true);
  assert.equal(isCoordinatedSniper(how("0xc")), true);
  assert.equal(isCoordinatedSniper(how("0xlate")), false);
  assert.equal(how("0xtoo"), undefined);
  assert.equal(isCoordinatedSniper(["bought in launch block"]), false);
  assert.equal(isCoordinatedSniper(["bought in launch block"], { isDev: true }), true);
  const wallets = [{ address: "0xsolo", how: new Set(), signers: new Set() }, { address: "0xlate", how: new Set(), signers: new Set() }];
  applyFundingTags(wallets, new Map([["0xsolo", new Set(["0xfunder"])], ["0xlate", new Set(["0xfunder"])]]), devs);
  assert.equal(isCoordinatedSniper(wallets[0].how), true);
  assert.ok([...wallets[0].how].some(h => /same funder/.test(h)));
});

test("a launch ran only when multiple, liquidity and recent trades are all present", () => {
  assert.equal(judgeRun({ multiple: 2, liquidityUsd: 1000, txnsH1: 1 }), true);
  assert.equal(judgeRun({ multiple: 1.99, liquidityUsd: 5000, txnsH1: 4 }), false);
  assert.equal(judgeRun({ multiple: 5, liquidityUsd: 999, txnsH1: 3 }), false);
  assert.equal(judgeRun({ multiple: 5, liquidityUsd: 5000, txnsH1: 0 }), false);
  assert.equal(judgeRun({ multiple: null, liquidityUsd: 5000, txnsH1: 3 }), null);
  assert.equal(judgeRun({ multiple: 4, liquidityUsd: null, txnsH1: 3 }), null);
  assert.equal(judgeRun({ multiple: 4, liquidityUsd: 5000, txnsH1: null }), null);
  const candles = [[200, 1, 1, 1, 3, 1], [100, 1.5, 2, 1, 1, 1]];
  assert.equal(multipleFromOhlcv(candles).multiple, 3 / 1.5);
  assert.equal(multipleFromOhlcv([]).multiple, null);
});

test("ranking counts hits only when the launch ran, and drops bundled wallets", () => {
  const buyer = (wallet, extra = {}) => ({ wallet, early: true, excluded: false, excludeReason: null, entryTime: "2026-11-13T12:00:00.000Z", ...extra });
  const reads = [
    { token: "0xaaa", symbol: "A", ran: true, multiple: 3.5, buyers: [buyer("0xgood"), buyer("0xbad", { excluded: true, excludeReason: "coordinated" })] },
    { token: "0xbbb", symbol: "B", ran: false, multiple: 0.4, buyers: [buyer("0xgood", { entryTime: "2026-11-13T15:00:00.000Z" })] },
    { token: "0xccc", symbol: "C", ran: null, multiple: null, buyers: [buyer("0xgood", { entryTime: "2026-11-13T16:00:00.000Z" })] },
  ];
  const ranked = rankSmartMoney(reads, { minHits: 1, limit: 10 });
  assert.equal(ranked.wallets.length, 1);
  const w = ranked.wallets[0];
  assert.equal(w.wallet, "0xgood");
  assert.equal(w.earlyHits, 1);
  assert.equal(w.earlyEntries, 2);
  assert.equal(w.hitRate, 0.5);
  assert.equal(w.lastSeen, "2026-11-13T16:00:00.000Z");
  assert.equal(w.sampleTokens.find(s => s.token === "0xccc").multiple, null);
  assert.equal(w.sampleTokens.find(s => s.token === "0xaaa").multiple, 3.5);
  assert.equal(rankSmartMoney(reads, { minHits: 2, limit: 10 }).wallets.length, 0);
  assert.ok(ranked.excluded.coordinated >= 1);
});

test("spray bots are left off the ranking; factory logs keep quote pairs and the earlier four.meme create", () => {
  assert.equal(isSprayBot(4, 6), true);
  assert.equal(isSprayBot(3, 6), false);
  const reads = Array.from({ length: 6 }, (_, i) => ({ token: "0x" + String(i + 1).padStart(40, "0"), symbol: "T", ran: i < 2, multiple: i < 2 ? 4 : 0.2,
    buyers: [{ wallet: "0xbot", early: true, excluded: false, entryTime: "2026-11-13T10:00:00.000Z" }, ...(i < 2 ? [{ wallet: "0xhuman", early: true, excluded: false, entryTime: "2026-11-13T11:00:00.000Z" }] : [])] }));
  const ranked = rankSmartMoney(reads, { minHits: 1, limit: 10 });
  assert.deepEqual(ranked.wallets.map(w => w.wallet), ["0xhuman"]);
  assert.equal(ranked.excluded.spray, 1);
  const data = "0x" + "11".padStart(64, "0") + pair.slice(2).padStart(64, "0") + "0".repeat(128);
  const v2 = [{ blockNumber: "0x64", transactionHash: "0x" + "ab".repeat(32), topics: [pad(pair), pad(token), pad(wbnb)], data: pad(pair) + "0".repeat(64) }];
  const four = [
    { blockNumber: "0x10", transactionHash: "0x" + "cd".repeat(32), topics: ["0x396d"], data: pad("0x3333333333333333333333333333333333333333") + token.slice(2).padStart(64, "0") },
    { blockNumber: "0x50", transactionHash: "0x" + "ef".repeat(32), topics: ["0x396d"], data },
  ];
  const parsed = parseFactoryLogs({ v2, four });
  const row = parsed.find(x => x.token === token);
  assert.equal(row.venue, "four.meme");
  assert.equal(row.block, 16);
  assert.equal(row.creator, "0x3333333333333333333333333333333333333333");
  const picked = pickLaunches([{ token: "0x1", block: 1000 }, { token: "0x2", block: 100 }, { token: "0x3", block: 500 }], { head: 2000, blockTime: 1, max: 2, minAgeSec: 100 });
  assert.deepEqual(picked.map(p => p.token), ["0x1", "0x3"]);
});

function pay(res) { return JSON.parse(Buffer.from(res.headers.get("payment-required"), "base64").toString()); }
test("402 for /v1/bsc/smart-money: $0.02 USDC on Base, Bazaar Use when, bad limit is a free 400", { timeout: 20000 }, async () => {
  const r = await fetch(BASE + "/v1/bsc/smart-money"); assert.equal(r.status, 402);
  const req = pay(r); const a = req.accepts[0];
  assert.equal(a.amount, "20000"); assert.equal(a.network, "eip155:8453");
  assert.match(req.resource.description, /^Use when: /); assert.ok(req.resource.description.length <= 500, String(req.resource.description.length));
  assert.equal(req.extensions.bazaar.info.input.queryParams.limit, "10");
  assert.equal(req.extensions.bazaar.info.input.queryParams.minHits, "2");
  const bad = await fetch(BASE + "/v1/bsc/smart-money?limit=21"); assert.equal(bad.status, 400); assert.equal(bad.headers.get("payment-required"), null);
  assert.equal((await fetch(BASE + "/v1/bsc/smart-money?minHits=0")).status, 400);
  assert.equal((await fetch(BASE + "/v1/bsc/smart-money?minHits=11")).status, 400);
  const o = await (await fetch(BASE + "/openapi.json")).json();
  assert.equal(o.info.version, "1.16.0");
  const op = o.paths["/v1/bsc/smart-money"].get;
  assert.equal(op.operationId, "bsc_smart_money");
  assert.match(op.description, /^Use when: /); assert.ok(op.description.length <= 500);
  assert.equal(op["x-payment-info"].price.amount, "0.02");
  const disc = await (await fetch(BASE + "/.well-known/x402")).json();
  assert.ok(disc.resources.some(u => u.endsWith("/v1/bsc/smart-money")));
});

test("402 for /v1/bsc/smart-money/{wallet}: path param, $0.02, bad address is a free 400", { timeout: 20000 }, async () => {
  const asked = "0x1111111111111111111111111111111111111111";
  const r = await fetch(BASE + "/v1/bsc/smart-money/" + asked); assert.equal(r.status, 402);
  const req = pay(r);
  assert.equal(req.accepts[0].amount, "20000"); assert.equal(req.accepts[0].network, "eip155:8453");
  assert.match(req.resource.url, /\/v1\/bsc\/smart-money\/:wallet$/);
  assert.match(req.resource.description, /^Use when: what did this BNB wallet buy recently/); assert.ok(req.resource.description.length <= 500, String(req.resource.description.length));
  assert.equal(req.extensions.bazaar.info.input.pathParams.wallet.toLowerCase(), asked);
  const bad = await fetch(BASE + "/v1/bsc/smart-money/nope"); assert.equal(bad.status, 400); assert.equal(bad.headers.get("payment-required"), null);
  const o = await (await fetch(BASE + "/openapi.json")).json();
  const op = o.paths["/v1/bsc/smart-money/{wallet}"].get;
  assert.equal(op.operationId, "bsc_smart_money_wallet");
  assert.equal(op.parameters.find(p => p.name === "wallet").in, "path");
  assert.match(op.description, /^Use when: /);
  const llms = await (await fetch(BASE + "/llms.txt")).text();
  assert.match(llms, /\/v1\/bsc\/smart-money\?limit=<limit>&minHits=<minHits>/);
  assert.match(llms, /\/v1\/bsc\/smart-money\/<wallet>/);
});

test("live feed returns lookback_hours and does not invent a multiple", { timeout: 70000 }, async () => {
  try {
    const r = await bscSmartMoney({ limit: 5, minHits: 1 });
    assert.equal(r.type, "bsc-smart-money"); assert.equal(r.chain, "bsc");
    assert.equal(typeof r.lookback_hours, "number"); assert.ok(r.lookback_hours > 0 && r.lookback_hours <= 48);
    assert.match(r.lookback_note, /about 48 hours/);
    assert.ok(Array.isArray(r.wallets)); assert.ok(Array.isArray(r.errors));
    for (const w of r.wallets) {
      assert.match(w.wallet, /^0x[0-9a-f]{40}$/);
      assert.ok(w.earlyHits >= 1); assert.ok(w.earlyEntries >= w.earlyHits);
      assert.ok(w.hitRate > 0 && w.hitRate <= 1);
      for (const s of w.sampleTokens) if (s.multiple != null) assert.ok(s.multiple >= 2 || s.ran === false);
    }
    const again = await bscSmartMoney({ limit: 5, minHits: 1 });
    assert.equal(again.cached, true); assert.equal(again.lookback_hours, r.lookback_hours);
  } catch (e) { assert.ok([502, 504].includes(e.status), e.message); }
});

test("live wallet route returns receipts or an honest empty window", { timeout: 70000 }, async () => {
  try {
    const r = await bscSmartMoneyWallet("0x0000000000000000000000000000000000000004");
    assert.equal(r.type, "bsc-smart-money-wallet");
    assert.equal(typeof r.lookback_hours, "number"); assert.ok(r.lookback_hours >= 0 && r.lookback_hours <= 48);
    assert.ok(Array.isArray(r.buys));
    for (const b of r.buys) {
      assert.ok(["ran", "did_not_run", "unknown"].includes(b.status));
      if (b.status === "unknown") assert.equal(b.multiple == null || b.stillTrading == null || b.liquidityUsd == null, true);
      if (b.status === "ran") assert.ok(b.multiple >= 2);
    }
  } catch (e) { assert.ok([502, 504].includes(e.status), e.message); }
});
