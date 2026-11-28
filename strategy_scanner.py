"""
Multi-Strategy Coin & Options Trade Scanner for Open Chart.
Scans Crypto (CoinDCX / Binance) and Indian Markets (NSE / BSE) across
5 technical strategies to recommend high-conviction CALL (Long/CE) & PUT (Short/PE) setups.
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, List, Optional

from pine_engine import PineEngine
from indian_market import indian_market, INDIAN_INDICES, INDIAN_EQUITIES
from greeks import calculate_greeks


def _calc_vwap(candles: List[Dict[str, Any]]) -> List[float]:
    vwap = []
    cum_pv = 0.0
    cum_v = 0.0
    for c in candles:
        tp = (float(c["high"]) + float(c["low"]) + float(c["close"])) / 3.0
        vol = max(1.0, float(c.get("volume", 1.0) or 1.0))
        cum_pv += tp * vol
        cum_v += vol
        vwap.append(cum_pv / cum_v if cum_v > 0 else tp)
    return vwap


def evaluate_candles_strategies(symbol: str, display_name: str, candles: List[Dict[str, Any]], mode: str = "crypto") -> Optional[Dict[str, Any]]:
    """Evaluate 5 institutional strategies on OHLCV candles and return scored CALL/PUT recommendation."""
    if not candles or len(candles) < 35:
        return None

    closes = [float(c["close"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]
    vols = [float(c.get("volume", 0) or 0) for c in candles]

    last_c = closes[-1]
    prev_c = closes[-2]
    if last_c <= 0:
        return None

    ema9 = PineEngine.calculate_ema(closes, 9)
    ema21 = PineEngine.calculate_ema(closes, 21)
    ema50 = PineEngine.calculate_ema(closes, 50)
    rsi = PineEngine.calculate_rsi(closes, 14)
    atr = PineEngine.calculate_atr(highs, lows, closes, 14)
    st_vals, st_dir = PineEngine.calculate_supertrend(highs, lows, closes, 10, 3.0)
    bb_mid, bb_up, bb_lo = PineEngine.calculate_bollinger_bands(closes, 20, 2.0)
    macd_line, macd_sig, macd_hist = PineEngine.calculate_macd(closes, 12, 26, 9)
    vwap = _calc_vwap(candles[-40:])

    bull_score = 0
    bear_score = 0
    strategies_hit = []

    # 1. EMA Ribbon Momentum (9 / 21 / 50)
    e9, e21, e50 = ema9[-1], ema21[-1], ema50[-1]
    pe9, pe21 = ema9[-2], ema21[-2]
    if e9 is not None and e21 is not None:
        if pe9 is not None and pe21 is not None and pe9 <= pe21 and e9 > e21:
            bull_score += 28
            strategies_hit.append("EMA 9/21 Golden Cross")
        elif pe9 is not None and pe21 is not None and pe9 >= pe21 and e9 < e21:
            bear_score += 28
            strategies_hit.append("EMA 9/21 Death Cross")
        elif e9 > e21 and (e50 is None or e21 > e50):
            bull_score += 18
            strategies_hit.append("EMA Ribbon Bullish")
        elif e9 < e21 and (e50 is None or e21 < e50):
            bear_score += 18
            strategies_hit.append("EMA Ribbon Bearish")

    # 2. Supertrend (10, 3) Trend Flip / Continuation
    if len(st_dir) >= 2:
        if st_dir[-2] == -1 and st_dir[-1] == 1:
            bull_score += 28
            strategies_hit.append("Supertrend Bull Flip")
        elif st_dir[-2] == 1 and st_dir[-1] == -1:
            bear_score += 28
            strategies_hit.append("Supertrend Bear Flip")
        elif st_dir[-1] == 1:
            bull_score += 14
            strategies_hit.append("Supertrend Support")
        else:
            bear_score += 14
            strategies_hit.append("Supertrend Resistance")

    # 3. RSI (14) + Bollinger Bands (20, 2) Mean Reversion / Breakout
    cur_rsi = rsi[-1] if rsi[-1] is not None else 50.0
    if bb_lo[-1] is not None and bb_up[-1] is not None:
        if last_c <= bb_lo[-1] * 1.003 and cur_rsi < 38:
            bull_score += 24
            strategies_hit.append("BB Oversold Bounce")
        elif last_c >= bb_up[-1] * 0.997 and cur_rsi > 62:
            bear_score += 24
            strategies_hit.append("BB Overbought Rejection")
        elif last_c > bb_mid[-1] and 50 <= cur_rsi <= 70:
            bull_score += 12
        elif last_c < bb_mid[-1] and 30 <= cur_rsi <= 50:
            bear_score += 12

    # 4. MACD (12, 26, 9) + VWAP Institutional Confluence
    cur_vwap = vwap[-1]
    if macd_hist[-1] is not None and macd_hist[-2] is not None:
        if macd_hist[-2] <= 0 < macd_hist[-1] and last_c >= cur_vwap * 0.998:
            bull_score += 24
            strategies_hit.append("MACD + VWAP Bull Cross")
        elif macd_hist[-2] >= 0 > macd_hist[-1] and last_c <= cur_vwap * 1.002:
            bear_score += 24
            strategies_hit.append("MACD + VWAP Bear Cross")
        elif macd_hist[-1] > 0 and last_c > cur_vwap:
            bull_score += 12
        elif macd_hist[-1] < 0 and last_c < cur_vwap:
            bear_score += 12

    # 5. Liquidity Sweep (BSL / SSL Stop Hunt Reversal)
    lookback = candles[-22:-1]
    if lookback:
        prev_hi = max(float(c["high"]) for c in lookback)
        prev_lo = min(float(c["low"]) for c in lookback)
        if lows[-1] < prev_lo and last_c > prev_lo:
            bull_score += 26
            strategies_hit.append("SSL Liquidity Sweep")
        elif highs[-1] > prev_hi and last_c < prev_hi:
            bear_score += 26
            strategies_hit.append("BSL Liquidity Sweep")

    # Volume confirmation boost
    avg_vol = sum(vols[-21:-1]) / max(1, len(vols[-21:-1]))
    vol_ratio = (vols[-1] / avg_vol) if avg_vol > 0 else 1.0
    if vol_ratio >= 1.35:
        if bull_score >= bear_score:
            bull_score += 8
        else:
            bear_score += 8

    is_call = bull_score >= bear_score
    raw_conf = bull_score if is_call else bear_score
    confidence = min(98, max(35, int(round(raw_conf))))
    signal_type = "CALL" if is_call else "PUT"

    cur_atr = atr[-1] if (atr[-1] is not None and atr[-1] > 0) else (last_c * 0.012)
    sl_dist = max(cur_atr * 1.5, last_c * 0.004)
    tp_dist = sl_dist * 2.1

    entry_price = round(last_c, 6 if last_c < 1 else 2)
    target_price = round(last_c + tp_dist if is_call else max(0.00001, last_c - tp_dist), 6 if last_c < 1 else 2)
    stop_loss = round(max(0.00001, last_c - sl_dist) if is_call else last_c + sl_dist, 6 if last_c < 1 else 2)

    chg_pct = round(((last_c - prev_c) / prev_c) * 100.0, 2) if prev_c else 0.0

    # For Indian Markets, recommend exact Option Contract Strike & LTP
    option_rec = None
    if mode == "ind":
        clean_sym = symbol.upper()
        cfg = INDIAN_INDICES.get(clean_sym)
        if not cfg:
            eq = next((e for e in INDIAN_EQUITIES if e["symbol"] == clean_sym), None)
            step = eq["strike_step"] if eq else 10
        else:
            step = cfg["strike_step"]
        atm_strike = round(last_c / step) * step
        opt_side = "CE" if is_call else "PE"
        g = calculate_greeks(spot=last_c, strike=atm_strike, days_to_expiry=4, iv=0.15, option_type=opt_side)
        opt_ltp = round(max(1.0, g["price"]), 2)
        option_rec = {
            "contract": f"{clean_sym} {int(atm_strike) if atm_strike == int(atm_strike) else atm_strike} {opt_side}",
            "strike": atm_strike,
            "type": opt_side,
            "ltp": opt_ltp,
            "tp": round(opt_ltp + max(10.0, opt_ltp * 0.25), 2),
            "sl": round(max(0.5, opt_ltp - max(8.0, opt_ltp * 0.15)), 2)
        }

    return {
        "symbol": symbol,
        "display_name": display_name,
        "signal": signal_type,
        "action": "BUY / CALL" if is_call else "SELL / PUT",
        "confidence": confidence,
        "score_diff": abs(bull_score - bear_score),
        "strategies": strategies_hit[:3] if strategies_hit else [f"Trend Bias ({signal_type})"],
        "price": entry_price,
        "change_pct": chg_pct,
        "rsi": round(cur_rsi, 1),
        "target": target_price,
        "stop_loss": stop_loss,
        "rr": "2.1 : 1",
        "option_rec": option_rec
    }


def scan_markets(feed, mode: str = "crypto", interval: str = "15m", limit: int = 30) -> Dict[str, Any]:
    """Scan active Crypto or Indian symbols in parallel and return ranked CALL/PUT trade ideas."""
    results = []
    targets = []

    if mode == "ind":
        indian_market.refresh_live_quotes()
        for sym, cfg in INDIAN_INDICES.items():
            if sym != "INDIA VIX":
                targets.append((sym, cfg["display_name"]))
        for eq in INDIAN_EQUITIES[:18]:
            targets.append((eq["symbol"], eq["name"]))

        def _scan_ind(item):
            sym, nm = item
            candles = indian_market.get_candles(sym, interval=interval, limit=120)
            return evaluate_candles_strategies(sym, nm, candles, mode="ind")

        with ThreadPoolExecutor(max_workers=10) as ex:
            for r in ex.map(_scan_ind, targets):
                if r:
                    results.append(r)
    else:
        markets = feed.get_market_list()[:limit]
        for m in markets:
            targets.append((m["symbol"], m["name"]))

        def _scan_crypto(item):
            sym, nm = item
            candles = feed.fetch_candles(sym, interval=interval, limit=120)
            return evaluate_candles_strategies(sym, nm, candles, mode="crypto")

        with ThreadPoolExecutor(max_workers=10) as ex:
            for r in ex.map(_scan_crypto, targets):
                if r:
                    results.append(r)

    results.sort(key=lambda x: (x["confidence"], x["score_diff"]), reverse=True)
    calls = sum(1 for r in results if r["signal"] == "CALL")
    puts = sum(1 for r in results if r["signal"] == "PUT")
    return {
        "mode": mode,
        "interval": interval,
        "scanned": len(results),
        "calls": calls,
        "puts": puts,
        "recommendations": results
    }
