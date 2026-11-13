// Shared snapshot for the smart-money cron and the paid routes.
// Order: an explicit test store, then Upstash/Vercel KV REST if configured, then Vercel Runtime Cache
// on Vercel, then a local JSON file. Tests (NODE_TEST_CONTEXT) stay on an in-memory store unless one is injected.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const KEY = "smart-money-v1";
let injected = null;
const memory = { value: null };

export function setSmartMoneyStore(store) { injected = store; }
export function memoryStore(initial = null) {
  let value = initial;
  return { async load() { return value; }, async save(v) { value = v; return v; } };
}

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function kvStore(cfg) {
  const headers = { Authorization: `Bearer ${cfg.token}` };
  return {
    async load() {
      const r = await fetch(`${cfg.url}/get/${KEY}`, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw Object.assign(new Error("smart-money cache read failed: " + r.status), { status: 502 });
      const j = await r.json();
      if (j.result == null) return null;
      return typeof j.result === "string" ? JSON.parse(j.result) : j.result;
    },
    async save(state) {
      // Upstash REST stores the JSON value of the body. A JSON string keeps the snapshot as text.
      const r = await fetch(`${cfg.url}/set/${KEY}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(JSON.stringify(state)), signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw Object.assign(new Error("smart-money cache write failed: " + r.status), { status: 502 });
      return state;
    },
  };
}

async function runtimeCacheStore() {
  if (!process.env.VERCEL) return null;
  try {
    const { getCache } = await import("@vercel/functions");
    const cache = getCache({ namespace: "automaton-smart-money" });
    return {
      async load() { return await cache.get(KEY) || null; },
      async save(state) { await cache.set(KEY, state, { ttl: 6 * 60 * 60 }); return state; },
    };
  } catch { return null; }
}

function fileStore() {
  const path = process.env.SMART_MONEY_FILE || ".cache/smart-money.json";
  return {
    async load() {
      try { return JSON.parse(await readFile(path, "utf8")); }
      catch (e) { if (e.code === "ENOENT") return null; throw e; }
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(state));
      return state;
    },
  };
}

export async function activeStore() {
  if (injected) return injected;
  if (process.env.NODE_TEST_CONTEXT && !process.env.SMART_MONEY_FILE) return { async load() { return memory.value; }, async save(v) { memory.value = v; return v; } };
  const kv = kvConfig();
  if (kv) return kvStore(kv);
  const runtime = await runtimeCacheStore();
  if (runtime) return runtime;
  if (!process.env.NODE_TEST_CONTEXT) return fileStore();
  return { async load() { return memory.value; }, async save(v) { memory.value = v; return v; } };
}
