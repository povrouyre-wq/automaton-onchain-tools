// Run one or more smart-money cron ticks locally. No payment, no key.
//   node scripts/warm-smart-money.mjs
//   TICKS=8 SMART_MONEY_FILE=/tmp/smart-money.json node scripts/warm-smart-money.mjs
process.env.SMART_MONEY_FILE ||= "/tmp/smart-money-sample.json";
const ticks = Math.max(1, Math.min(30, +(process.env.TICKS || 6)));
const { runSmartMoneyCron, bscSmartMoney, bscSmartMoneyWallet } = await import("../smart-money.js");
for (let i = 1; i <= ticks; i++) {
  const t = Date.now();
  const summary = await runSmartMoneyCron();
  console.log(`tick ${i} ${Date.now() - t}ms`, JSON.stringify(summary));
  if (summary.wallets > 0 && process.env.STOP_WHEN_NONEMPTY === "1") break;
}
const feed = await bscSmartMoney({ limit: 3, minHits: 1 });
console.log("FEED", JSON.stringify({ count: feed.count, lookback_hours: feed.lookback_hours, partial: feed.partial, cached: feed.cached, coverage: feed.coverage, errors: feed.errors, wallets: feed.wallets }, null, 2));
if (feed.wallets[0]) {
  const one = await bscSmartMoneyWallet(feed.wallets[0].wallet);
  console.log("WALLET", JSON.stringify({ wallet: one.wallet, count: one.count, lookback_hours: one.lookback_hours, partial: one.partial, buys: one.buys.slice(0, 3) }, null, 2));
}
