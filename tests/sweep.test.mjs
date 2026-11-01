// All-chain approval sweep: scoring, revoke tx encoding, 402 + Bazaar metadata, and a live sweep of a wallet with known approvals.
import test from "node:test"; import assert from "node:assert/strict";
import net from "node:net";
import { decodeFunctionData, erc20Abi, parseAbi } from "viem";
const sockets = new Set(); const hang = net.createServer(x => { sockets.add(x); x.on("error", () => {}); }); await new Promise(r => hang.listen(0, "127.0.0.1", r)); hang.unref();
Object.assign(process.env, { NO_LISTEN: "1", FACILITATOR_URL: `http://127.0.0.1:${hang.address().port}`, X402_NETWORK: "eip155:8453" });
const { default: app } = await import("../server.js");
const { scoreApproval, revokeTx, approvalSweep, knownLabel } = await import("../sweep.js");
const srv = app.listen(0); await new Promise(r => srv.once("listening", r)); srv.unref();
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => { srv.close(); for (const x of sockets) x.destroy(); hang.close(); });

const sp = o => ({ address: "0x" + "1".repeat(40), label: null, known: false, type: "contract", verified: true, flagged: false, ...o });
test("risk scoring: EOA + unlimited is high, known router limited is low, unknown unverified unlimited is high", () => {
  assert.equal(scoreApproval({ kind: "erc20", unlimited: true, balanceRaw: 1n, spender: sp({ type: "eoa", verified: null }) }).severity, "high");
  assert.equal(scoreApproval({ kind: "erc20", unlimited: false, balanceRaw: 0n, spender: sp({ known: true, label: "Permit2" }) }).severity, "low");
  assert.equal(scoreApproval({ kind: "erc20", unlimited: true, balanceRaw: 0n, spender: sp({ known: true }) }).severity, "medium");
  assert.equal(scoreApproval({ kind: "erc20", unlimited: true, balanceRaw: 0n, spender: sp({ verified: false }) }).severity, "high");
  assert.equal(scoreApproval({ kind: "nft-approval-for-all", unlimited: true, balanceRaw: 0n, spender: sp({ known: true }) }).severity, "medium");
  assert.equal(scoreApproval({ kind: "erc20", unlimited: false, balanceRaw: 0n, spender: sp({ known: true, flagged: true }) }).severity, "high");
});
test("revoke txs decode to approve(spender, 0) and setApprovalForAll(op, false)", () => {
  const s = "0x2207eea3ae68cdbbb7bdc2e624d9ad2ca886cea6", t = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const a = revokeTx(8453, "erc20", t, s); assert.equal(a.to, t); assert.equal(a.value, "0"); assert.equal(a.chainId, 8453);
  assert.equal(decodeFunctionData({ abi: erc20Abi, data: a.data }).args[0].toLowerCase(), s); assert.equal(decodeFunctionData({ abi: erc20Abi, data: a.data }).args[1], 0n);
  const n = revokeTx(1, "nft", t, s); const d = decodeFunctionData({ abi: parseAbi(["function setApprovalForAll(address,bool)"]), data: n.data });
  assert.equal(d.functionName, "setApprovalForAll"); assert.equal(d.args[0].toLowerCase(), s); assert.equal(d.args[1], false); assert.ok(n.data.startsWith("0xa22cb465"));
});
test("same-address spenders are only labeled where checked: 0xE592... is Uniswap on Ethereum, not on Base", () => {
  assert.equal(knownLabel("ethereum", "0xE592427A0AEce92De3Edee1F18E0157C05861564"), "Uniswap V3 SwapRouter");
  assert.equal(knownLabel("base", "0xE592427A0AEce92De3Edee1F18E0157C05861564"), null);
});
test("402 for /v1/approvals/sweep: $0.02 USDC on Base with Bazaar discovery; bad input is a free 400", { timeout: 20000 }, async () => {
  const r = await fetch(BASE + "/v1/approvals/sweep"); assert.equal(r.status, 402);
  const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString()); const a = req.accepts[0];
  assert.equal(a.amount, "20000"); assert.equal(a.network, "eip155:8453"); assert.equal(a.payTo.toLowerCase(), "0x679af3a893edd0aef4ac4c7776ba581b238c0717");
  assert.ok(req.extensions?.bazaar?.info?.input, "bazaar discovery input declared"); assert.ok(req.resource.description.length <= 500);
  assert.equal((await fetch(BASE + "/v1/approvals/sweep?address=0x123")).status, 400);
});
test("live sweep finds known approvals (vitalik.eth) across chains, with revoke txs and per-chain status", { timeout: 60000 }, async () => {
  const r = await approvalSweep("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  assert.equal(r.chains.length, 7); for (const c of r.chains) assert.ok(["ok", "partial", "error"].includes(c.status));
  assert.ok(r.counts.live > 10, "has live approvals"); assert.ok(r.approvals.length <= 200);
  const risky = r.approvals.filter(a => a.severity !== "low"); assert.ok(risky.length > 0); for (const a of risky) assert.ok(a.revokeTx?.data && a.revokeTx.value === "0" && a.revokeTx.chainId === a.chainId);
  for (let i = 1; i < r.approvals.length; i++) assert.ok(r.approvals[i - 1].riskScore >= r.approvals[i].riskScore, "sorted by risk");
});
test("one chain failing gives partial results, not an error", { timeout: 60000 }, async () => {
  const { CHAINS } = await import("../lib.js"); const orig = CHAINS.polygon.rpc.multicall;
  CHAINS.polygon.rpc.multicall = async () => { throw new Error("rpc down"); };
  try { const r = await approvalSweep("0x679af3a893eDd0AeF4ac4c7776Ba581b238C0717", { chains: ["polygon", "base"] });
    assert.equal(r.chains.find(c => c.chain === "polygon").status, "error"); assert.notEqual(r.chains.find(c => c.chain === "base").status, "error");
    assert.match(r.summary, /Couldn't read: polygon/); } finally { CHAINS.polygon.rpc.multicall = orig; }
});
