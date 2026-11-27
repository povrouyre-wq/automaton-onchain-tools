// $0.05 batch lookups: validate before payment, keep input order, isolate per-address failures.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

const sockets = new Set();
const hang = net.createServer(x => { sockets.add(x); x.on("error", () => {}); });
await new Promise(r => hang.listen(0, "127.0.0.1", r));
hang.unref();
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: `http://127.0.0.1:${hang.address().port}`, X402_NETWORK: "eip155:8453" });

const { default: app } = await import("../server.js");
const { parseAddressList, parseUrlList, runAddressBatch, approvalsBatch, safeToSendBatch, urlSafetyBatch, BATCH_BUDGET_MS, BATCH_CONCURRENCY, BATCH_ITEM_MS, BATCH_ROUTE_DEADLINE_MS, URL_BATCH_PREPARE_MS, URL_BATCH_ITEM_MS, URL_BATCH_BUDGET_MS, URL_BATCH_DEADLINE_MS } = await import("../batch.js");
const srv = app.listen(0);
await new Promise(r => srv.once("listening", r));
srv.unref();
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); for (const x of sockets) x.destroy(); hang.close(); });

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL2 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM = ["base", "ethereum", "bsc", "arbitrum", "optimism", "polygon", "avalanche"];
const SAFE = [...EVM, "solana"];
const pay = res => JSON.parse(Buffer.from(res.headers.get("payment-required"), "base64").toString());
const addr = n => "0x" + n.toString(16).padStart(40, "0");

test("parseAddressList dedupes EVM case-insensitively in first-seen order and rejects bad lists", () => {
  assert.deepEqual(parseAddressList(`${A}, ${B.toLowerCase()},${A.toLowerCase()}`, { itemRe: /^0x[0-9a-fA-F]{40}$/, dedupe: "lower" }), [A, B.toLowerCase()]);
  assert.deepEqual(parseAddressList(`${SOL},${SOL},${SOL2}`, { itemRe: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, dedupe: "exact" }), [SOL, SOL2]);
  for (const raw of ["", "   ", `${A},nope`, `${A},`, `,${A}`, A + ",".repeat(1) + " ", Array.from({ length: 21 }, (_, i) => addr(i + 1)).join(",")]) {
    assert.throws(() => parseAddressList(raw, { itemRe: /^0x[0-9a-fA-F]{40}$/, dedupe: "lower" }), e => e.status === 400);
  }
  assert.throws(() => parseAddressList(SOL, { itemRe: /^0x[0-9a-fA-F]{40}$/, dedupe: "lower" }), e => e.status === 400);
  assert.throws(() => parseAddressList(A, { itemRe: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, valid: () => false, dedupe: "exact" }), e => e.status === 400);
});

test("runAddressBatch keeps input order, isolates errors, and marks timeouts partial", async () => {
  const seen = [];
  const results = await runAddressBatch([A, B, C], async address => {
    await new Promise(r => setTimeout(r, address === A ? 40 : 5));
    seen.push(address);
    if (address === B) throw Object.assign(new Error("rpc down"), { status: 502 });
    return { owner: address };
  }, { concurrency: 2, itemMs: 200, budgetMs: 1000 });
  assert.deepEqual(results.map(r => r.address), [A, B, C]);
  assert.deepEqual(seen, [B, C, A]);
  assert.equal(results[0].status, "ok");
  assert.equal(results[0].result.owner, A);
  assert.equal(results[1].status, "error");
  assert.match(results[1].error, /rpc down/);
  assert.equal(results[1].result, undefined);
  assert.equal(results[2].status, "ok");

  let calls = 0;
  const timed = await runAddressBatch(["slow", "later"], async address => {
    calls++;
    if (address === "slow") await new Promise(() => {});
    return { owner: address };
  }, { concurrency: 1, itemMs: 40, budgetMs: 500 });
  assert.equal(timed[0].status, "partial");
  assert.match(timed[0].error, /timed out/);
  assert.equal(timed[1].status, "ok");
  assert.equal(calls, 2);

  let started = 0;
  const starved = await runAddressBatch(["slow", "skipped"], async () => {
    started++;
    await new Promise(() => {});
  }, { concurrency: 1, itemMs: 30, budgetMs: 50 });
  assert.equal(starved[0].status, "partial");
  assert.equal(starved[1].status, "partial");
  assert.match(starved[1].error, /budget/);
  assert.equal(started, 1);
});

test("batch concurrency stays bounded and the 20-address budget fits the function limit", async () => {
  let inflight = 0, max = 0;
  await runAddressBatch(["a", "b", "c", "d"], async () => {
    inflight++; max = Math.max(max, inflight);
    await new Promise(r => setTimeout(r, 25));
    inflight--;
    return { ok: true };
  }, { concurrency: 2, itemMs: 200, budgetMs: 2000 });
  assert.ok(max <= 2);
  assert.ok(BATCH_CONCURRENCY >= 2 && BATCH_CONCURRENCY <= 8);
  assert.ok(BATCH_ITEM_MS * Math.ceil(20 / BATCH_CONCURRENCY) <= BATCH_BUDGET_MS);
  assert.ok(BATCH_BUDGET_MS < BATCH_ROUTE_DEADLINE_MS && BATCH_ROUTE_DEADLINE_MS <= 55000);
});

test("approvals and safe-to-send batches reuse the lookup and keep per-item failures", async () => {
  const approvals = await approvalsBatch("base", `${A}, ${B}, ${A.toLowerCase()}`, {
    lookup: async address => {
      if (address === B) throw new Error("allowance read failed");
      return { chain: "base", owner: address, nonZeroApprovals: [] };
    },
  });
  assert.equal(approvals.type, "approvals-batch");
  assert.equal(approvals.chain, "base");
  assert.equal(approvals.count, 2);
  assert.equal(approvals.partial, false);
  assert.equal(approvals.results[0].address, A);
  assert.deepEqual(approvals.results[0].result, { chain: "base", owner: A, nonZeroApprovals: [] });
  assert.equal(approvals.results[1].status, "error");
  assert.match(approvals.results[1].error, /allowance read failed/);

  const safe = await safeToSendBatch("solana", `${SOL},${SOL2}`, { from: SOL }, {
    lookup: async address => ({ type: "safe-to-send", chain: "solana", to: address, verdict: "safe" }),
  });
  assert.equal(safe.type, "safe-to-send-batch");
  assert.equal(safe.from, SOL);
  assert.equal(safe.token, null);
  assert.deepEqual(safe.results.map(r => r.result.to), [SOL, SOL2]);

  const partial = await safeToSendBatch("base", A, {}, {
    lookup: async () => { throw Object.assign(new Error("upstream timeout after 8000 ms"), { status: 504 }); },
    itemMs: 200, budgetMs: 500,
  });
  assert.equal(partial.partial, true);
  assert.equal(partial.results[0].status, "partial");
  assert.equal(partial.results[0].address, A);
});

test("402 for batch routes is $0.05 on the same rail; bad input is a free 400", { timeout: 30000 }, async () => {
  const single = pay(await fetch(`${BASE}/v1/base/approvals?address=${A}`));
  assert.equal(single.accepts[0].amount, "5000");
  const singleSafe = pay(await fetch(`${BASE}/v1/base/safe-to-send?to=${A}`));
  assert.equal(singleSafe.accepts[0].amount, "5000");

  for (const c of EVM) {
    const bare = await fetch(`${BASE}/v1/${c}/approvals/batch`);
    assert.equal(bare.status, 402, c);
    const ok = await fetch(`${BASE}/v1/${c}/approvals/batch?addresses=${A},${B}`);
    assert.equal(ok.status, 402, c);
    const req = pay(ok); const a = req.accepts[0];
    assert.equal(a.scheme, "exact");
    assert.equal(a.amount, "50000");
    assert.equal(a.network, single.accepts[0].network);
    assert.equal(a.payTo, single.accepts[0].payTo);
    assert.equal(a.asset, single.accepts[0].asset);
    assert.deepEqual(a.extra, single.accepts[0].extra);
    assert.match(req.resource.url, new RegExp(`/v1/${c}/approvals/batch$`));
    assert.match(req.resource.description, /^Use when: which token approvals should I revoke across these /);
    assert.match(req.resource.description, /\$0\.05/);
    assert.match(req.resource.description, /20/);
    assert.ok(req.resource.description.length <= 500, `${c} approvals ${req.resource.description.length}`);
    const schema = req.extensions.bazaar.schema.properties.input.properties.queryParams;
    assert.deepEqual(schema.required, ["addresses"]);
    assert.equal(schema.properties.addresses.type, "string");
    assert.ok(req.extensions.bazaar.info.input.queryParams.addresses.includes(","));
    const bad = await fetch(`${BASE}/v1/${c}/approvals/batch?addresses=${A},nope`);
    assert.equal(bad.status, 400);
    assert.equal(bad.headers.get("payment-required"), null);
    const tooMany = await fetch(`${BASE}/v1/${c}/approvals/batch?addresses=${Array.from({ length: 21 }, (_, i) => addr(i + 1)).join(",")}`);
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.headers.get("payment-required"), null);
    assert.equal((await fetch(`${BASE}/v1/${c}/approvals/batch?addresses=`)).status, 400);
    assert.equal((await fetch(`${BASE}/v1/${c}/approvals/batch?addresses=${A},${A.toLowerCase()}`)).status, 402);
  }
  assert.equal((await fetch(`${BASE}/v1/solana/approvals/batch?addresses=${SOL}`)).status, 404);

  for (const c of SAFE) {
    const who = c === "solana" ? SOL : A;
    const other = c === "solana" ? SOL2 : B;
    const bare = await fetch(`${BASE}/v1/${c}/safe-to-send/batch`);
    assert.equal(bare.status, 402, c);
    const ok = await fetch(`${BASE}/v1/${c}/safe-to-send/batch?addresses=${who},${other}&from=${who}`);
    assert.equal(ok.status, 402, c);
    const req = pay(ok); const a = req.accepts[0];
    assert.equal(a.scheme, "exact");
    assert.equal(a.amount, "50000");
    assert.equal(a.payTo, singleSafe.accepts[0].payTo);
    assert.equal(a.asset, singleSafe.accepts[0].asset);
    assert.equal(a.network, singleSafe.accepts[0].network);
    assert.match(req.resource.url, new RegExp(`/v1/${c}/safe-to-send/batch$`));
    assert.match(req.resource.description, /^Use when: is it safe to send to these /);
    assert.match(req.resource.description, /\$0\.05/);
    assert.match(req.resource.description, /20/);
    assert.ok(req.resource.description.length <= 500, `${c} safe ${req.resource.description.length}`);
    const schema = req.extensions.bazaar.schema.properties.input.properties.queryParams;
    assert.deepEqual(schema.required, ["addresses"]);
    for (const name of ["addresses", "from", "token"]) assert.equal(schema.properties[name].type, "string");
    assert.equal((await fetch(`${BASE}/v1/${c}/safe-to-send/batch?addresses=${who}&from=nope`)).status, 400);
    assert.equal((await fetch(`${BASE}/v1/${c}/safe-to-send/batch?addresses=${who}&token=nope`)).status, 400);
    assert.equal((await fetch(`${BASE}/v1/${c}/safe-to-send/batch?addresses=nope`)).headers.get("payment-required"), null);
  }
  assert.equal((await fetch(`${BASE}/v1/base/safe-to-send/batch?addresses=${SOL}`)).status, 400);
  assert.equal((await fetch(`${BASE}/v1/solana/safe-to-send/batch?addresses=${A}`)).status, 400);

  const o = await (await fetch(BASE + "/openapi.json")).json();
  assert.equal(o.info.version, "1.20.0");
  assert.match(o.info.description, /\$0\.05/);
  const op = o.paths["/v1/base/approvals/batch"].get;
  assert.equal(op.operationId, "base_token_approvals_batch");
  assert.equal(op["x-payment-info"].price.amount, "0.05");
  assert.equal(op.parameters.find(p => p.name === "addresses").required, true);
  assert.match(op.description, /^Use when: /);
  const sop = o.paths["/v1/solana/safe-to-send/batch"].get;
  assert.equal(sop.operationId, "solana_safe_to_send_batch");
  assert.equal(sop["x-payment-info"].price.amount, "0.05");
  assert.equal(sop.parameters.find(p => p.name === "from").required, false);
  assert.equal(o.paths["/v1/base/approvals"].get["x-payment-info"].price.amount, "0.005");
  assert.equal(o.paths["/v1/base/safe-to-send"].get["x-payment-info"].price.amount, "0.005");
  assert.equal(EVM.filter(c => o.paths[`/v1/${c}/approvals/batch`]).length, 7);
  assert.equal(SAFE.filter(c => o.paths[`/v1/${c}/safe-to-send/batch`]).length, 8);
  const disc = await (await fetch(BASE + "/.well-known/x402")).json();
  assert.ok(disc.resources.some(u => u.endsWith("/v1/base/approvals/batch")));
  assert.ok(disc.resources.some(u => u.endsWith("/v1/solana/safe-to-send/batch")));
  const llms = await (await fetch(BASE + "/llms.txt")).text();
  assert.match(llms, /\/v1\/base\/approvals\/batch\?addresses=<addresses>/);
  assert.match(llms, /\/v1\/solana\/safe-to-send\/batch\?addresses=<addresses>&from=<from>&token=<token>/);
  const home = await (await fetch(BASE + "/", { headers: { accept: "text/html" } })).text();
  assert.match(home, /\/v1\/\{chain\}\/approvals\/batch/);
  assert.match(home, /\/v1\/\{chain\}\/safe-to-send\/batch/);
  assert.match(home, /\/v1\/url-safety\/batch\?urls=/);
});

test("parseUrlList dedupes canonical URLs and rejects empty, invalid, or oversized lists", () => {
  assert.deepEqual(parseUrlList(" https://Example.com , https://example.com/ "), ["https://Example.com"]);
  assert.deepEqual(parseUrlList("example.com,https://example.com/"), ["example.com"]);
  assert.equal(parseUrlList("https://a.example,https://b.example").length, 2);
  assert.equal(parseUrlList(Array.from({ length: 20 }, (_, i) => `https://h${i}.example`).join(",")).length, 20);
  for (const raw of ["", "   ", "ftp://example.com", "javascript:alert(1)", "http://", "https://ok.example,ftp://example.com", "https://ok.example,", ",https://ok.example", "ab", "a b c", "https://" + "a".repeat(2100) + ".example"]) {
    assert.throws(() => parseUrlList(raw), e => e.status === 400, JSON.stringify(raw));
  }
  assert.throws(() => parseUrlList(Array.from({ length: 21 }, (_, i) => `https://h${i}.example`).join(",")), e => e.status === 400 && /at most 20/.test(e.message));
  assert.throws(() => parseUrlList(1), e => e.status === 400);
});

test("url safety batch keeps order, isolates failures, and fits the function limit", async () => {
  const urls = ["https://a.example/x", "https://b.example", "https://a.example/x"];
  let prepared = 0;
  const batch = await urlSafetyBatch(urls.join(","), {
    prepare: async () => { prepared++; },
    lookup: async url => {
      if (url.includes("b.example")) throw new Error("rdap down");
      return { url, host: "a.example", verdict: "no known issues", score: 0 };
    },
  });
  assert.equal(prepared, 1);
  assert.equal(batch.type, "url-safety-batch");
  assert.equal(batch.count, 2);
  assert.equal(batch.partial, false);
  assert.deepEqual(batch.results.map(r => r.url), ["https://a.example/x", "https://b.example"]);
  assert.equal(batch.results[0].status, "ok");
  assert.equal(batch.results[0].result.verdict, "no known issues");
  assert.equal(batch.results[1].status, "error");
  assert.match(batch.results[1].error, /rdap down/);
  assert.equal(batch.results[1].result, undefined);

  const partial = await urlSafetyBatch("https://slow.example", {
    prepare: async () => {},
    lookup: async () => { throw Object.assign(new Error("upstream timeout after 8000 ms"), { status: 504 }); },
    itemMs: 200, budgetMs: 500,
  });
  assert.equal(partial.partial, true);
  assert.equal(partial.results[0].status, "partial");
  assert.equal(partial.results[0].url, "https://slow.example");
  assert.ok(URL_BATCH_ITEM_MS * Math.ceil(20 / BATCH_CONCURRENCY) <= URL_BATCH_BUDGET_MS);
  assert.ok(URL_BATCH_PREPARE_MS + URL_BATCH_BUDGET_MS < URL_BATCH_DEADLINE_MS && URL_BATCH_DEADLINE_MS <= 55000);
});

test("402 for URL safety batch is $0.05; the single route stays $0.005; bad lists are a free 400", async () => {
  const single = pay(await fetch(`${BASE}/v1/url-safety?url=https://example.com`));
  assert.equal(single.accepts[0].amount, "5000");
  const bare = await fetch(`${BASE}/v1/url-safety/batch`);
  assert.equal(bare.status, 402);
  const ok = await fetch(`${BASE}/v1/url-safety/batch?urls=${encodeURIComponent("https://example.com/login, https://example.org")}`);
  assert.equal(ok.status, 402);
  const req = pay(ok); const a = req.accepts[0];
  assert.equal(a.scheme, "exact");
  assert.equal(a.amount, "50000");
  assert.equal(a.network, single.accepts[0].network);
  assert.equal(a.payTo, single.accepts[0].payTo);
  assert.equal(a.asset, single.accepts[0].asset);
  assert.deepEqual(a.extra, single.accepts[0].extra);
  assert.match(req.resource.url, /\/v1\/url-safety\/batch$/);
  assert.match(req.resource.description, /^Use when: are these links phishing or scam sites\?/);
  assert.match(req.resource.description, /\$0\.05/);
  assert.match(req.resource.description, /20/);
  assert.ok(req.resource.description.length <= 500, String(req.resource.description.length));
  const schema = req.extensions.bazaar.schema.properties.input.properties.queryParams;
  assert.deepEqual(schema.required, ["urls"]);
  assert.equal(schema.properties.urls.type, "string");
  assert.ok(req.extensions.bazaar.info.input.queryParams.urls.includes(","));
  const tooMany = Array.from({ length: 21 }, (_, i) => `https://h${i}.example`).join(",");
  for (const [label, path] of [
    ["empty", "/v1/url-safety/batch?urls="],
    ["blank", "/v1/url-safety/batch?urls=%20%20"],
    ["invalid", "/v1/url-safety/batch?urls=ftp://example.com"],
    ["mixed", "/v1/url-safety/batch?urls=" + encodeURIComponent("https://ok.example,ftp://example.com")],
    ["too many", `/v1/url-safety/batch?urls=${encodeURIComponent(tooMany)}`],
  ]) {
    const bad = await fetch(BASE + path);
    assert.equal(bad.status, 400, label);
    assert.equal(bad.headers.get("payment-required"), null, label);
  }
  assert.equal((await fetch(`${BASE}/v1/url-safety/batch?urls=${encodeURIComponent("https://example.com,https://example.com/")}`)).status, 402);
  const o = await (await fetch(BASE + "/openapi.json")).json();
  assert.equal(o.info.version, "1.20.0");
  assert.match(o.info.description, /\/v1\/url-safety\/batch/);
  const op = o.paths["/v1/url-safety/batch"].get;
  assert.equal(op.operationId, "url_safety_check_batch");
  assert.equal(op["x-payment-info"].price.amount, "0.05");
  assert.equal(op.parameters.find(p => p.name === "urls").required, true);
  assert.match(op.description, /^Use when: /);
  assert.equal(o.paths["/v1/url-safety"].get["x-payment-info"].price.amount, "0.005");
  const disc = await (await fetch(BASE + "/.well-known/x402")).json();
  assert.ok(disc.resources.some(u => u.endsWith("/v1/url-safety/batch")));
  const card = await (await fetch(BASE + "/.well-known/agent-registration.json")).json();
  assert.ok(card.endpoints.some(e => e.path === "/v1/url-safety/batch" && e.price === "$0.05" && e.method === "GET"));
  assert.match(card.description, /\/v1\/url-safety\/batch/);
  const llms = await (await fetch(BASE + "/llms.txt")).text();
  assert.match(llms, /\/v1\/url-safety\/batch\?urls=<urls>/);
});
