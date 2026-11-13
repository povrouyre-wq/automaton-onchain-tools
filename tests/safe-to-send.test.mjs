// $0.005 safe-to-send: lookalike and dust heuristics, verdict scoring, 402 + Bazaar metadata on all 8 chains, free 400 on bad input.
import test from "node:test"; import assert from "node:assert/strict";
import net from "node:net";
const sockets = new Set(); const hang = net.createServer(x => { sockets.add(x); x.on("error", () => {}); }); await new Promise(r => hang.listen(0, "127.0.0.1", r)); hang.unref();
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: `http://127.0.0.1:${hang.address().port}`, X402_NETWORK: "eip155:8453" });
const { default: app } = await import("../server.js");
const { lookalikeMatch, dustSpam, collectCounterparties, buildSafeToSend, safeToSend } = await import("../safe-to-send.js");
const srv = app.listen(0); await new Promise(r => srv.once("listening", r)); srv.unref();
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); for (const x of sockets) x.destroy(); hang.close(); });

const KNOWN = "0xabcdef0123456789abcdef0123456789abcd1234";
const POISON = "0xabcdef99999999999999999999999999991234";
const WEAK = "0xabc9999999999999999999999999999999991234";
const TO = "0x2222222222222222222222222222222222222222";
const FROM = "0x3333333333333333333333333333333333333333";

test("lookalike: 4+ prefix and 4+ suffix, not the same address, not a short prefix", () => {
  const m = lookalikeMatch(POISON, KNOWN);
  assert.equal(m.prefix, 6); assert.equal(m.suffix, 4);
  assert.equal(lookalikeMatch(WEAK, KNOWN), null);
  assert.equal(lookalikeMatch(KNOWN, KNOWN.toUpperCase()), null);
  assert.equal(lookalikeMatch("0x1234", "0x1235"), null);
  assert.equal(lookalikeMatch("AbcdefghijWXYZklmn", "AbcdefXXXXWXYZdiff", { caseInsensitive: false }), null);
  const sol = lookalikeMatch("Abcdefghij0000WXYZ", "AbcdefXXXX9999WXYZ", { caseInsensitive: false });
  assert.equal(sol.prefix, 6); assert.equal(sol.suffix, 4);
  assert.equal(lookalikeMatch("Abcdefghij0000WXYZ", "abcdefXXXX9999wxyz", { caseInsensitive: false }), null);
});

test("dust spam needs zero-value or dust incoming plus a spam pattern, not one normal transfer", () => {
  const z = (from, value = "0") => ({ from, to: TO, value, kind: "native" });
  assert.equal(dustSpam(TO, { native: [z("0xaaa"), z("0xbbb"), z("0xccc")], tokens: [] }).dustOnly, true);
  assert.equal(dustSpam(TO, { native: [z("0xaaa", "5")], tokens: [] }).dustOnly, false);
  assert.equal(dustSpam(TO, { native: [z(POISON, "0")], tokens: [] }, { seeds: [KNOWN] }).dustOnly, true);
  assert.equal(dustSpam(TO, { native: [{ from: TO, to: FROM, value: "0", kind: "native" }, z("0xaaa"), z("0xbbb"), z("0xccc")], tokens: [] }).dustOnly, false);
  const tiny = { from: "0xabc", to: TO, value: "1", kind: "token", token: "0x1", tokenDecimal: 6 };
  assert.equal(dustSpam(TO, { native: [], tokens: [tiny, { ...tiny, from: "0xdef" }, { ...tiny, from: "0x123" }] }).manyZero, false);
});

test("verdict: lookalike is danger, dust and fresh and missing selectors are caution, clean is safe", () => {
  const account = { kind: "eoa", isContract: false, nonce: 5, balance: "1", balanceRaw: "1000000000000000000", nativeSymbol: "ETH", selectors: [] };
  const hist = (native, extra = {}) => ({ status: "ok", native, tokens: [], coverage: "test window", ...extra });
  const clean = buildSafeToSend({ chain: "base", chainName: "Base", chainId: 8453, to: TO, from: FROM, token: null, account, toHistory: hist([{ from: FROM, to: TO, value: "10" }]), fromHistory: hist([{ from: FROM, to: KNOWN, value: "10" }], { counterparties: [KNOWN] }), flags: { status: "ok", source: "goplus", flags: [] }, tokenHandle: { status: "not_a_contract" } });
  assert.equal(clean.verdict, "safe"); assert.equal(clean.heuristics, true); assert.ok(clean.reasons.every(r => r.heuristic === true));
  const poison = buildSafeToSend({ chain: "base", chainName: "Base", to: POISON, from: FROM, account, toHistory: hist([]), fromHistory: hist([], { counterparties: [KNOWN] }), flags: { status: "ok", source: "goplus", flags: [] }, tokenHandle: { status: "not_a_contract" } });
  assert.equal(poison.verdict, "danger"); assert.equal(poison.checks.addressPoisoning.lookalikes[0].prefixChars, 6);
  const fresh = buildSafeToSend({ chain: "base", chainName: "Base", to: TO, from: null, account: { ...account, nonce: 0, balance: "0", balanceRaw: "0" }, toHistory: hist([]), fromHistory: null, flags: { status: "ok", source: "goplus", flags: [] }, tokenHandle: { status: "not_a_contract" } });
  assert.equal(fresh.verdict, "caution"); assert.ok(fresh.reasons.some(r => r.code === "fresh_address" && r.severity === "caution"));
  const stuck = buildSafeToSend({ chain: "ethereum", chainName: "Ethereum", to: TO, token: "0x4444444444444444444444444444444444444444", account: { ...account, kind: "contract", isContract: true, selectors: [] }, toHistory: hist([{ from: FROM, to: TO, value: "10" }]), fromHistory: null, flags: { status: "ok", source: "goplus", flags: [] }, tokenHandle: { status: "no_code_path" } });
  assert.equal(stuck.verdict, "caution");
  const itself = buildSafeToSend({ ...stuck, tokenHandle: { status: "token_itself" } });
  assert.equal(itself.verdict, "danger");
  const flagged = buildSafeToSend({ ...clean, flags: { status: "ok", source: "goplus", flags: [{ key: "stealing_attack", label: "stealing attack / drainer", tier: "danger" }] } });
  assert.equal(flagged.verdict, "danger");
  const soft = buildSafeToSend({ ...clean, flags: { status: "ok", source: "goplus", flags: [{ key: "mixer", label: "mixer", tier: "caution" }] } });
  assert.equal(soft.verdict, "caution");
  const down = buildSafeToSend({ ...clean, flags: { status: "unavailable", source: "goplus", flags: [], note: "timeout" }, fromHistory: { status: "unavailable", coverage: "explorer down", native: [], tokens: [] } });
  assert.equal(down.verdict, "safe"); assert.ok(down.couldNotDetermine.length >= 2); assert.match(down.summary, /Not checked/);
});

test("counterparties drop the subject and stay case-insensitive on EVM", () => {
  const cps = collectCounterparties(FROM, [{ from: FROM, to: KNOWN.toUpperCase() }], [{ from: "0x5555555555555555555555555555555555555555", to: FROM }]);
  assert.deepEqual(cps.sort(), [KNOWN, "0x5555555555555555555555555555555555555555"].sort());
});

const CHAINS8 = ["base", "ethereum", "bsc", "arbitrum", "optimism", "polygon", "avalanche", "solana"];
const evm = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", sol = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
for (const c of CHAINS8) test(`402 for /v1/${c}/safe-to-send: $0.005 USDC on Base, Bazaar lists to/from/token; bad input is a free 400`, { timeout: 20000 }, async () => {
  const bare = await fetch(`${BASE}/v1/${c}/safe-to-send`); assert.equal(bare.status, 402);
  const addr = c === "solana" ? sol : evm;
  const paid = await fetch(`${BASE}/v1/${c}/safe-to-send?to=${addr}&from=${addr}`);
  assert.equal(paid.status, 402, "valid query must still be unpaid 402");
  const req = JSON.parse(Buffer.from(paid.headers.get("payment-required"), "base64").toString()); const a = req.accepts[0];
  assert.equal(a.scheme, "exact"); assert.equal(a.amount, "5000"); assert.equal(a.network, "eip155:8453");
  assert.equal(a.payTo.toLowerCase(), "0x679af3a893edd0aef4ac4c7776ba581b238c0717");
  assert.match(req.resource.url, new RegExp(`/v1/${c}/safe-to-send$`));
  assert.match(req.resource.description, /^Use when: is it safe to send to this /); assert.ok(req.resource.description.length <= 500, String(req.resource.description.length));
  const schema = req.extensions.bazaar.schema.properties.input.properties.queryParams;
  assert.deepEqual(schema.required, ["to"]);
  for (const name of ["to", "from", "token"]) assert.equal(schema.properties[name].type, "string");
  assert.ok(req.extensions.bazaar.info.input.queryParams.to);
  assert.ok(req.extensions.bazaar.info.input.queryParams.from);
  assert.ok(req.extensions.bazaar.info.input.queryParams.token);
  assert.equal((await fetch(`${BASE}/v1/${c}/safe-to-send?to=nope`)).status, 400);
  assert.equal((await fetch(`${BASE}/v1/${c}/safe-to-send?to=${addr}&from=nope`)).status, 400);
  assert.equal((await fetch(`${BASE}/v1/${c}/safe-to-send?to=${addr}&token=nope`)).status, 400);
  assert.equal((await fetch(`${BASE}/v1/${c}/safe-to-send?to=nope`)).headers.get("payment-required"), null);
  if (c !== "solana") assert.equal((await fetch(`${BASE}/v1/${c}/safe-to-send?to=${sol}`)).status, 400);
  else assert.equal((await fetch(`${BASE}/v1/solana/safe-to-send?to=${evm}`)).status, 400);
});

test("openapi 1.16.0 lists the route, and /check offers it", async () => {
  const o = await (await fetch(BASE + "/openapi.json")).json();
  assert.equal(o.info.version, "1.16.0");
  const op = o.paths["/v1/base/safe-to-send"].get;
  assert.equal(op.operationId, "base_safe_to_send");
  assert.match(op.description, /^Use when: /);
  assert.equal(op["x-payment-info"].price.amount, "0.005");
  const params = op.parameters;
  assert.equal(params.find(p => p.name === "to").required, true);
  assert.equal(params.find(p => p.name === "from").required, false);
  assert.equal(params.find(p => p.name === "token").required, false);
  assert.ok(o.paths["/v1/solana/safe-to-send"]);
  const w = await (await fetch(BASE + "/.well-known/x402")).json();
  assert.equal(CHAINS8.filter(c => w.resources.some(u => u.endsWith(`/v1/${c}/safe-to-send`))).length, 8);
  const html = await (await fetch(BASE + "/check")).text();
  assert.match(html, /value="safetosend"/); assert.match(html, /Safe to send/);
  const js = await (await fetch(BASE + "/check/app.js")).text();
  assert.match(js, /safe-to-send\?to=/);
});

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, headers: { get: () => "application/json" }, json: async () => body };
}
test("wired check: mocked explorer and GoPlus, fresh empty is caution and a drainer flag is danger", async () => {
  const rpc = { getCode: async () => "0x", getBalance: async () => 0n, getTransactionCount: async () => 0, getStorageAt: async () => "0x" + "0".repeat(64), getBlockNumber: async () => 10n, getLogs: async () => [] };
  const fetchImpl = async (url) => {
    if (String(url).includes("gopluslabs")) return jsonResponse({ code: 1, result: { stealing_attack: "0", phishing_activities: "0", honeypot_related_address: "0", blackmail_activities: "0", cybercrime: "0", number_of_malicious_contracts_created: "0" } });
    return jsonResponse({ status: "1", message: "No transactions found", result: [] });
  };
  const fresh = await safeToSend("optimism", TO, { fetchImpl, evmRpc: rpc });
  assert.equal(fresh.type, "safe-to-send"); assert.equal(fresh.verdict, "caution"); assert.equal(fresh.checks.freshAddress.fresh, true); assert.equal(fresh.checks.contract.isContract, false);
  const rpcFunded = { ...rpc, getCode: async () => "0x63a9059cbb00", getBalance: async () => 10n ** 18n, getTransactionCount: async () => 3 };
  const fetchFlag = async (url) => String(url).includes("gopluslabs") ? jsonResponse({ code: 1, result: { stealing_attack: "1", phishing_activities: "0", number_of_malicious_contracts_created: "0" } }) : jsonResponse({ status: "1", message: "OK", result: [{ from: FROM, to: TO, value: "1000" }] });
  const danger = await safeToSend("base", TO, { from: FROM, token: "0x4444444444444444444444444444444444444444", fetchImpl: fetchFlag, evmRpc: rpcFunded });
  assert.equal(danger.verdict, "danger"); assert.equal(danger.checks.scamFlags.flagged, true); assert.equal(danger.checks.contract.tokenHandling, "has_code_path");
  const rpcBare = { ...rpcFunded, getCode: async () => "0x6001600055" };
  const stuck = await safeToSend("base", TO, { token: "0x4444444444444444444444444444444444444444", fetchImpl, evmRpc: rpcBare });
  assert.equal(stuck.checks.contract.isContract, true); assert.equal(stuck.checks.contract.tokenHandling, "no_code_path"); assert.equal(stuck.verdict, "caution");
});

test("solana wiring uses the injected rpc and does not call a paid flag API", async () => {
  const calls = [];
  const solRpc = async (method, params) => { calls.push(method + " " + (params?.[0] || ""));
    if (method === "getAccountInfo") return { value: null };
    if (method === "getSignaturesForAddress") return [];
    return null; };
  const r = await safeToSend("solana", sol, { solRpc, fetchImpl: async () => { throw new Error("should not fetch"); } });
  assert.equal(r.chain, "solana"); assert.equal(r.checks.contract.isContract, false); assert.equal(r.checks.scamFlags.status, "unsupported");
  assert.equal(r.verdict, "caution"); assert.ok(r.couldNotDetermine.some(x => /Solana/.test(x)));
  assert.ok(calls.some(c => c.startsWith("getAccountInfo"))); assert.ok(!calls.some(c => /goplus|http/.test(c)));
});

test("live: Ethereum USDC is a contract and the response stays inside safe/caution/danger", { timeout: 40000 }, async () => {
  const r = await safeToSend("ethereum", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(r.type, "safe-to-send"); assert.equal(r.checks.contract.isContract, true); assert.equal(r.heuristics, true);
  assert.ok(["safe", "caution", "danger"].includes(r.verdict)); assert.ok(r.reasons.length); assert.ok(r.reasons.every(x => x.heuristic === true));
  assert.notEqual(r.checks.scamFlags.status, "unsupported");
});
