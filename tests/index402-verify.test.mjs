// 402 Index domain-verification file: public hash only, no payment.
import test from "node:test";
import assert from "node:assert/strict";
process.env.NO_LISTEN = "1";
const app = (await import("../server.js")).default;
const HASH = "43904ba343db81d3cf3670f6d653c8f1a95564d18004af35f815e8adb54c02c6";
const withServer = async fn => {
  const s = app.listen(0);
  await new Promise(r => s.once("listening", r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { s.close(); }
};

test("GET /.well-known/402index-verify.txt is 200 text/plain with the exact hash and no extra whitespace", async () => {
  await withServer(async base => {
    const r = await fetch(base + "/.well-known/402index-verify.txt");
    assert.equal(r.status, 200);
    const ct = r.headers.get("content-type") || "";
    assert.ok(ct.startsWith("text/plain"), ct);
    const body = await r.text();
    assert.equal(body, HASH);
  });
});

test("health stays ok and a paid route still returns 402 after adding the verify file", async () => {
  await withServer(async base => {
    const h = await (await fetch(base + "/health")).json();
    assert.ok(h.ok);
    const r = await fetch(base + "/v1/base/address");
    assert.equal(r.status, 402);
  });
});
