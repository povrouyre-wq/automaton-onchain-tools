// $0.02 BNB smart-money feed: early-buyer ranking, bundle-check exclusions, 402 + Bazaar, free 400s.
import test from "node:test"; import assert from "node:assert/strict";
import net from "node:net";
const sockets = new Set(); const hang = net.createServer(x => { sockets.add(x); x.on("error", () => {}); }); await new Promise(r => hang.listen(0, "127.0.0.1", r)); hang.unref();
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: `http://127.0.0.1:${hang.address().port}`, X402_NETWORK: "eip155:8453" });
const { default: app } = await import("../server.js");
const { indexEarlyWallets, isCoordinatedSniper, applyFundingTags } = await import("../bundles.js");
const { judgeRun, rankSmartMoney, parseFactoryLogs, pickLaunches, isSprayBot, multipleFromOhlcv, bscSmartMoney, bscSmartMoneyWallet, gtFetchWithBackoff, runSmartMoneyCron, feedFromState, setSmartMoneyStore, memoryStore } = await import("../smart-money.js");
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

test("GeckoTerminal 429 backs off and then accepts the next response", async () => {
  let calls = 0; const slept = [];
  const fetchImpl = async () => { calls++; return calls < 3 ? { status: 429, ok: false } : { status: 200, ok: true, json: async () => ({ ok: true }) }; };
  const body = await gtFetchWithBackoff("/x", { fetchImpl, sleep: async ms => slept.push(ms), state: { next: 0 }, gapMs: 0 });
  assert.deepEqual(body, { ok: true });
  assert.deepEqual(slept, [1000, 2000]);
});

test("cron ticks accumulate scored launches and the paid routes only read that snapshot", async () => {
  const FOUR = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";
  const GOOD = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const CREATOR = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const TOKENS = { "0x1111111111111111111111111111111111111111": 999000, "0x2222222222222222222222222222222222222222": 997000 };
  const pad = a => "0x" + a.slice(2).padStart(64, "0");
  const head = 1000000;
  const rpc = async (method, params) => {
    if (method === "eth_blockNumber") return "0x" + head.toString(16);
    if (method === "eth_getBlockByNumber") { const n = Number(BigInt(params[0])); return { timestamp: "0x" + (1700000000 - (head - n)).toString(16) }; }
    if (method === "eth_getCode") return "0x";
    if (method === "eth_call") return "0x12";
    if (method === "eth_getLogs") {
      const f = params[0], from = Number(BigInt(f.fromBlock)), to = Number(BigInt(f.toBlock));
      if (f.address === FOUR) return Object.entries(TOKENS).filter(([, block]) => block >= from && block <= to).map(([token, block]) => ({ blockNumber: "0x" + block.toString(16), transactionHash: "0x" + "ab".repeat(32), topics: ["0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20"], data: pad(CREATOR) + token.slice(2).padStart(64, "0") }));
      const block = TOKENS[f.address];
      if (block != null && block >= from && block <= to) return [{ address: f.address, blockNumber: "0x" + block.toString(16), logIndex: "0x1", transactionHash: "0x" + "cd".repeat(32), topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", pad(FOUR), pad(GOOD)], data: "0x" + (10n ** 21n).toString(16).padStart(64, "0") }];
      return [];
    }
    throw new Error("unexpected rpc " + method);
  };
  const gt = async path => path.includes("/ohlcv/")
    ? { data: { attributes: { ohlcv_list: [[200, 1, 1, 1, 3, 1], [100, 1, 1, 1, 1, 1]] } }, meta: { base: { symbol: "TOK" } } }
    : { data: [{ attributes: { address: "0xpool", name: "TOK / WBNB", reserve_in_usd: "5000", pool_created_at: "2026-11-01T00:00:00Z", transactions: { h1: { buys: 3, sells: 1 } } }, relationships: { dex: { data: { id: "four-meme" } } } }] };
  const store = memoryStore();
  setSmartMoneyStore(store);
  const opts = { store, rpc, gt, perTick: 1, sliceBlocks: 2000, budgetMs: 5000 };
  const first = await runSmartMoneyCron(opts);
  const second = await runSmartMoneyCron(opts);
  assert.equal(first.launchesScored, 1);
  assert.equal(second.launchesScored, 2);
  assert.ok(second.passes >= first.passes);
  const feed = await bscSmartMoney({ limit: 5, minHits: 1 });
  assert.equal(feed.cached, true); assert.equal(feed.precomputed, true);
  assert.equal(typeof feed.lookback_hours, "number"); assert.equal(feed.partial, true);
  assert.equal(feed.count, 1); assert.equal(feed.wallets[0].wallet, GOOD); assert.equal(feed.wallets[0].earlyHits, 2); assert.equal(feed.wallets[0].hitRate, 1);
  assert.equal(feed.wallets[0].sampleTokens[0].multiple, 3);
  const detail = await bscSmartMoneyWallet(GOOD);
  assert.equal(detail.count, 2); assert.ok(detail.buys.every(b => b.early === true && b.status === "ran" && b.size === "1000"));
  assert.equal(detail.lookback_hours, feed.lookback_hours);
  assert.throws(() => feedFromState(null), e => e.status === 502);
  setSmartMoneyStore(null);
});

test("cron route rejects a bad secret before any chain call", async () => {
  process.env.CRON_SECRET = "test-secret";
  try {
    const r = await fetch(BASE + "/cron/smart-money", { headers: { authorization: "Bearer nope" } });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("payment-required"), null);
  } finally { delete process.env.CRON_SECRET; }
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
