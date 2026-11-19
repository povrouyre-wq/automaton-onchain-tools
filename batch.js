// Batch lookups for the paid approval, safe-to-send, and URL-safety routes. 1 to 20 inputs.
// Per-item failures stay on that item. Timeouts are partial so the batch still returns.
import { approvals, prepareUrlSafety, urlSafety } from "./lib.js";
import { safeToSend } from "./safe-to-send.js";
import { isPubkey, SOL_ADDR_RE } from "./solana.js";

// 20 addresses at BATCH_ITEM_MS, BATCH_CONCURRENCY at a time, must finish inside BATCH_BUDGET_MS.
// The route deadline sits above that budget and under the 60s Vercel function limit.
export const BATCH_CONCURRENCY = 5;
export const BATCH_ITEM_MS = 8000;
export const BATCH_BUDGET_MS = 36000;
export const BATCH_ROUTE_DEADLINE_MS = 45000;
export const BATCH_MAX = 20;

const EVM_ITEM = /^0x[0-9a-fA-F]{40}$/;
export const EVM_LIST = { itemRe: EVM_ITEM, dedupe: "lower", max: BATCH_MAX };
export const SOL_LIST = { itemRe: SOL_ADDR_RE, valid: isPubkey, dedupe: "exact", max: BATCH_MAX };
export const EVM_LIST_RE = /^0x[0-9a-fA-F]{40}(,\s*0x[0-9a-fA-F]{40}){0,19}$/;
export const EVM_LIST_PATTERN = "^0x[0-9a-fA-F]{40}(,\\s*0x[0-9a-fA-F]{40}){0,19}$";
export const SOL_LIST_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}(,\s*[1-9A-HJ-NP-Za-km-z]{32,44}){0,19}$/;
export const SOL_LIST_PATTERN = "^[1-9A-HJ-NP-Za-km-z]{32,44}(,\\s*[1-9A-HJ-NP-Za-km-z]{32,44}){0,19}$";

const bad = (error) => Object.assign(new Error(error), { status: 400 });

// Split, trim, reject malformed or >max, then drop duplicates. EVM compare is case-insensitive; Solana is not.
export function parseAddressList(raw, { itemRe, valid, dedupe = "lower", max = BATCH_MAX } = {}) {
  if (typeof raw !== "string") throw bad("query param addresses must be a comma-separated list of 1 to 20 addresses");
  const trimmed = raw.trim();
  if (!trimmed) throw bad("query param addresses must list 1 to 20 addresses");
  if (trimmed.length > 2000) throw bad("query param addresses is too long");
  const parts = trimmed.split(",").map(s => s.trim());
  if (parts.length > max) throw bad(`query param addresses accepts at most ${max} addresses`);
  if (parts.some(p => !p || !itemRe.test(p) || (valid && !valid(p)))) throw bad("query param addresses must be a comma-separated list of valid addresses for this chain");
  const seen = new Set();
  const addresses = [];
  for (const p of parts) {
    const key = dedupe === "lower" ? p.toLowerCase() : p;
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(p);
  }
  if (!addresses.length) throw bad("query param addresses must list 1 to 20 addresses");
  return addresses;
}

function withItemTimeout(work, ms) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(Object.assign(new Error(`timed out after ${ms} ms`), { status: 504 })), ms);
  });
  return Promise.race([Promise.resolve().then(work), timeout]).finally(() => clearTimeout(timer));
}

export async function runAddressBatch(addresses, lookup, opts = {}) {
  const concurrency = opts.concurrency ?? BATCH_CONCURRENCY;
  const itemMs = opts.itemMs ?? BATCH_ITEM_MS;
  const budgetMs = opts.budgetMs ?? BATCH_BUDGET_MS;
  const idKey = opts.idKey || "address";
  const noun = opts.noun || "address";
  const t0 = Date.now();
  const out = new Array(addresses.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= addresses.length) return;
      const address = addresses[i];
      const left = budgetMs - (Date.now() - t0);
      if (left < Math.min(400, itemMs)) {
        out[i] = { [idKey]: address, status: "partial", error: `batch time budget exhausted before this ${noun} was read` };
        continue;
      }
      const ms = Math.max(1, Math.min(itemMs, left - 15));
      try {
        const result = await withItemTimeout(() => lookup(address), ms);
        out[i] = { [idKey]: address, status: "ok", result };
      } catch (e) {
        const msg = String(e?.shortMessage || e?.message || e);
        const partial = e?.status === 504 || /timeout/i.test(msg);
        out[i] = { [idKey]: address, status: partial ? "partial" : "error", error: msg.slice(0, 200) };
      }
    }
  };
  if (!addresses.length) return out;
  const n = Math.min(Math.max(1, concurrency), addresses.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function body(type, chain, results, extra) {
  return { type, chain, ...extra, count: results.length, partial: results.some(r => r.status === "partial"), results };
}

export async function approvalsBatch(chain, raw, opts = {}) {
  const addresses = parseAddressList(raw, EVM_LIST);
  const lookup = opts.lookup || (address => approvals(chain, address));
  return body("approvals-batch", chain, await runAddressBatch(addresses, lookup, opts));
}

export async function safeToSendBatch(chain, raw, query = {}, opts = {}) {
  const sol = chain === "solana";
  const addresses = parseAddressList(raw, sol ? SOL_LIST : EVM_LIST);
  const from = query.from || null, token = query.token || null;
  const lookup = opts.lookup || (address => safeToSend(chain, address, { from, token }));
  return body("safe-to-send-batch", chain, await runAddressBatch(addresses, lookup, opts), { from, token });
}

// Same acceptance rules as GET /v1/url-safety?url= : 4 to 2048 chars, http(s) or a bare hostname.
// Comma-separated, like the address batches. A comma inside a URL cannot be represented.
export const URL_LIST_PATTERN = "^[^,\\s]{4,}(,\\s*[^,\\s]{4,}){0,19}$";
export const URL_LIST_RE = /^[^,\s]{4,}(,\s*[^,\s]{4,}){0,19}$/;
export const URL_LIST_MAX_LEN = 42000;
const URL_ITEM_MAX = 2048;
export const URL_BATCH_PREPARE_MS = 15000;
export const URL_BATCH_ITEM_MS = 8000;
export const URL_BATCH_BUDGET_MS = 36000;
export const URL_BATCH_DEADLINE_MS = 55000;

export function acceptHttpUrl(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length < 4 || v.length > URL_ITEM_MAX) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v);
    if (!["http:", "https:"].includes(u.protocol) || !u.hostname) return null;
    return { input: v, href: u.href };
  } catch { return null; }
}

export function parseUrlList(raw, { max = BATCH_MAX } = {}) {
  if (typeof raw !== "string") throw bad("query param urls must be a comma-separated list of 1 to 20 http(s) URLs or hostnames");
  const trimmed = raw.trim();
  if (!trimmed) throw bad("query param urls must list 1 to 20 URLs");
  if (trimmed.length > URL_LIST_MAX_LEN) throw bad("query param urls is too long");
  const parts = trimmed.split(",").map(s => s.trim());
  if (parts.length > max) throw bad(`query param urls accepts at most ${max} URLs`);
  const parsed = parts.map(acceptHttpUrl);
  if (parsed.some(p => !p)) throw bad("query param urls must be a comma-separated list of 1 to 20 http(s) URLs or hostnames");
  const seen = new Set();
  const urls = [];
  for (const p of parsed) {
    if (seen.has(p.href)) continue;
    seen.add(p.href);
    urls.push(p.input);
  }
  if (!urls.length) throw bad("query param urls must list 1 to 20 URLs");
  return urls;
}
export const URL_LIST = { parse: parseUrlList, max: BATCH_MAX };

export async function urlSafetyBatch(raw, opts = {}) {
  const urls = parseUrlList(raw);
  const prepare = opts.prepare === undefined ? prepareUrlSafety : opts.prepare;
  if (prepare) {
    try { await withItemTimeout(() => prepare(), opts.prepareMs ?? URL_BATCH_PREPARE_MS); }
    catch { /* per-URL lookups report their own upstream failures */ }
  }
  const lookup = opts.lookup || (async url => {
    const r = await urlSafety(url);
    if (!r) throw Object.assign(new Error("invalid http(s) URL"), { status: 400 });
    return r;
  });
  const results = await runAddressBatch(urls, lookup, {
    concurrency: opts.concurrency ?? BATCH_CONCURRENCY,
    itemMs: opts.itemMs ?? URL_BATCH_ITEM_MS,
    budgetMs: opts.budgetMs ?? URL_BATCH_BUDGET_MS,
    idKey: "url",
    noun: "URL",
  });
  return { type: "url-safety-batch", count: results.length, partial: results.some(r => r.status === "partial"), results };
}
