// Drift Rider: a slow-trend-following long-only bot for cbBTC on 1-minute bars.
//
// Idea, in one paragraph: the dev window is a slow grind down with one real
// recovery in it, and the money is in riding that recovery and sitting in cash
// through the grind. Fast 1-minute signals whipsaw (every 1-minute EMA/RSI
// variant I tried lost money on the dev window), and buying oversold dips loses
// too (bars with RSI under 30 kept falling: their forward 60-minute return
// averaged -0.12%). The two big 60-minute up-moves both started from RSI 35-70
// with momentum already positive, so this bot waits for a genuine 30-minute
// uptrend and only enters when momentum confirms it.
//
//   - Resample the 1-minute closes into 30-minute bars (the close of each
//     block of 30 bars). On those, EMA(4) vs EMA(8), each seeded as the mean
//     of its first span of closes, then moving 2 / (span + 1) of the way to
//     each new close, in float64 like the kit's ema-cross baseline.
//   - Entry, on the first 1-minute bar of a new 30-minute block, when the
//     30-minute EMA(4) has just crossed above EMA(8) AND RSI(14) on the
//     1-minute closes is above 55 (clear momentum, not just barely positive).
//     Buys with all cash. One position at most, long only.
//   - Exit, the whole position: the 30-minute EMA(4) crosses back below
//     EMA(8), or the position is worth +1.5% over its cost (take profit), or
//     -0.8% under it (stop loss), or the close falls 1.0% below the highest
//     close seen since entry (trailing stop).
//
// A full-size round trip costs about 26 bps in fees, slippage and impact, so
// the bot trades rarely (one round trip on the dev window) and only on a
// setup whose move is several times that. No randomness, no clock, no network,
// no files: the same bars give the same orders, run after run.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Minutes per resampled bar. */
const BLOCK = 30;
/** EMA spans on the resampled (30-minute) closes. */
const FAST_SPAN = 4;
const SLOW_SPAN = 8;
/** RSI period on the 1-minute closes. */
const RSI_PERIOD = 14;
/** Entry needs RSI above this: momentum clearly positive. */
const RSI_MIN = 55;
/** Take profit: position worth 10150/10000 of its cost. */
const TP_NUM = 10150n;
const TP_DEN = 10000n;
/** Stop loss: position worth 9920/10000 of its cost. */
const SL_NUM = 9920n;
const SL_DEN = 10000n;
/** Trailing stop: close at or under 9900/10000 of the peak close since entry. */
const TRAIL_NUM = 9900n;
const TRAIL_DEN = 10000n;
const MAX_SLIPPAGE_BPS = 100;

/** One EMA: the closes it has seen until it starts, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

function step(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

/** Wilder's RSI(14) over the 1-minute closes, seeded like the standard. */
const rsi = { count: 0, gainSum: 0, lossSum: 0, avgGain: 0, avgLoss: 0, value: null as number | null, prev: null as number | null };
function stepRsi(close: number): void {
  if (rsi.prev === null) {
    rsi.prev = close;
    return;
  }
  const ch = close - rsi.prev;
  const g = ch > 0 ? ch : 0;
  const l = ch < 0 ? -ch : 0;
  rsi.prev = close;
  rsi.count += 1;
  if (rsi.count <= RSI_PERIOD) {
    rsi.gainSum += g;
    rsi.lossSum += l;
    if (rsi.count === RSI_PERIOD) {
      rsi.avgGain = rsi.gainSum / RSI_PERIOD;
      rsi.avgLoss = rsi.lossSum / RSI_PERIOD;
      rsi.value = rsi.avgLoss === 0 ? 100 : 100 - 100 / (1 + rsi.avgGain / rsi.avgLoss);
    }
  } else {
    rsi.avgGain = (rsi.avgGain * (RSI_PERIOD - 1) + g) / RSI_PERIOD;
    rsi.avgLoss = (rsi.avgLoss * (RSI_PERIOD - 1) + l) / RSI_PERIOD;
    rsi.value = rsi.avgLoss === 0 ? 100 : 100 - 100 / (1 + rsi.avgGain / rsi.avgLoss);
  }
}

// Resampled 30-minute closes and the EMA value after each one.
const resampled: number[] = [];
const fastHist: (number | null)[] = [];
const slowHist: (number | null)[] = [];
const fast: Ema = { span: FAST_SPAN, warm: [], value: null };
const slow: Ema = { span: SLOW_SPAN, warm: [], value: null };
/** The 30-minute EMA gap as of the previous 1-minute bar (null until set). */
let prevGap: number | null = null;
/** Highest 1-minute close since the current entry (null when flat). */
let peak: bigint | null = null;

await runBars({
  onBatch(state: BarsState, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const seq = state.seq;
    const close = BigInt(bar.c);
    const closeNum = Number(bar.c);

    // Indicators read every batch, a warm-up's included.
    stepRsi(closeNum);
    if ((seq + 1) % BLOCK === 0) {
      // This bar closes a 30-minute block.
      resampled.push(closeNum);
      step(fast, closeNum);
      step(slow, closeNum);
      fastHist.push(fast.value);
      slowHist.push(slow.value);
    }
    // The gap from the last completed 30-minute bar before this block:
    // jj = floor(seq / BLOCK) - 1, so it only moves at block boundaries.
    let gap: number | null = null;
    const j = Math.floor(seq / BLOCK);
    if (j >= 1) {
      const jj = j - 1;
      const f = fastHist[jj];
      const s = slowHist[jj];
      if (f !== undefined && s !== undefined && f !== null && s !== null) gap = f - s;
    }
    const crossUp = gap !== null && prevGap !== null && gap > 0 && prevGap <= 0;
    const crossDn = gap !== null && prevGap !== null && gap < 0 && prevGap >= 0;
    if (gap !== null) prevGap = gap;

    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (peak === null || close > peak) peak = close;
      const value = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      if (
        crossDn ||
        value * TP_DEN >= cost * TP_NUM ||
        value * SL_DEN <= cost * SL_NUM ||
        close * TRAIL_DEN <= peak * TRAIL_NUM
      ) {
        peak = null;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // Flat: enter on a fresh 30-minute cross-up with momentum confirmed.
    if (seq % BLOCK === 0 && crossUp && rsi.value !== null && rsi.value > RSI_MIN) {
      peak = close;
      const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
      return [buy];
    }
    return [];
  },
});
