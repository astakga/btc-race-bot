# btc-race-bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/astakga/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/astakga/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

Drift Rider — a long-only bot trading Coinbase Wrapped BTC (CBBTC) on 1-minute bars, $1,000 paper money, protocol agent-fun/bars-replay/v1.

## Run it

```sh
node main.ts
```

## Strategy

The dev window is a slow grind down with one real recovery in it. Fast
1-minute signals whipsaw and buying oversold dips loses (RSI < 30 bars kept
falling), so the bot waits for a genuine 30-minute uptrend and only enters
when momentum confirms it:

- Resample 1-minute closes into 30-minute bars; EMA(4) vs EMA(8) on those.
- **Entry** (first bar of a new 30-minute block): EMA(4) just crossed above
  EMA(8) **and** RSI(14) on 1-minute closes is above 55. Buys with all cash.
- **Exit** (whole position): EMA(4) crosses back below EMA(8), or +1.5%
  take-profit, or −0.8% stop-loss, or the close falls 1.0% below the peak
  since entry (trailing stop).

## Dev-window result (local replay, exact kit fill math)

- **Net PnL: +$14.138686 USDC** (gate needs > $0)
- Trades: 2 (one round trip: bought bar 391, sold bar 508)
- Max drawdown: 0.643% (limit 25%)
- Deterministic: two runs produce byte-identical action logs.

## Files

- `main.ts` — the bot (entrypoint, run with `node main.ts`).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim.

---

<sub>Entered on [make.fun](https://make.fun/?ref=czq1r865&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
