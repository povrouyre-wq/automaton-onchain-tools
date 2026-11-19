// Single URL check: a stalled RDAP body must not hold the call, and a bad blocklist document must not throw.
import test from "node:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const { urlSafety } = await import("../lib.js");

const hang = () => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "application/rdap+json" } });

test("malformed blocklists degrade, and a stalled RDAP body does not hang the check", { timeout: 20000 }, async () => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("eth-phishing-detect")) return Response.json({ blacklist: "nope" });
    if (u.includes("Phishing.Database")) return new Response("# c\nphish.test\n");
    if (u.includes("data.iana.org")) return Response.json({ services: [[["com"], ["https://rdap.test/"]], [["hang"], ["https://rdap-hang.test/"]], [["miss"], ["https://rdap-miss.test/"]]] });
    if (u.startsWith("https://rdap-hang.test/")) return hang();
    if (u.startsWith("https://rdap-miss.test/")) return new Response(new ReadableStream({ start() {} }), { status: 404 });
    if (u.startsWith("https://rdap.test/")) return Response.json({ events: [{ eventAction: "registration", eventDate: "2010-01-01T00:00:00Z" }] });
    if (u.startsWith("https://")) return new Response(null, { status: 204 });
    throw new Error("unexpected fetch " + u);
  };
  try {
    const ok = await urlSafety("https://example.com/login");
    assert.equal(ok.host, "example.com");
    assert.equal(ok.verdict, "no known issues");
    assert.equal(ok.score, 0);
    assert.equal(ok.blocklists.sourceStatus.metamask, "unavailable");
    assert.equal(ok.blocklists.sourceStatus.phishingDatabase, "ok");
    assert.equal(ok.blocklists.phishingDatabase, false);
    assert.equal(ok.domainAge.status, "ok");
    assert.equal(ok.https.httpsReachable, true);
    const again = await urlSafety("https://example.com/other");
    assert.equal(again.blocklists.sourceStatus.metamask, "unavailable");
    assert.equal(again.verdict, "no known issues");

    const listed = await urlSafety("https://phish.test/login");
    assert.equal(listed.blocklists.phishingDatabase, true);
    assert.equal(listed.verdict, "malicious");

    let t = Date.now();
    const missed = await urlSafety("https://example.miss");
    assert.ok(Date.now() - t < 3000, `404 body stall took ${Date.now() - t} ms`);
    assert.equal(missed.domainAge.status, "not found in RDAP (unregistered?)");
    assert.equal(missed.host, "example.miss");

    t = Date.now();
    const stalled = await urlSafety("https://example.hang");
    const ms = Date.now() - t;
    assert.ok(ms < 10000, `RDAP body stall took ${ms} ms`);
    assert.equal(stalled.domainAge.status, "unavailable");
    assert.equal(stalled.https.httpsReachable, true);
    assert.equal(stalled.verdict, "no known issues");
  } finally {
    globalThis.fetch = realFetch;
  }
});
