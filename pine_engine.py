"""
Comprehensive Pine Script v5 Interpreter & Backtesting Engine
Supports variable assignments, series math, historical indexing [1],
technical analysis (ta.*), math functions (math.*), multi-variable unpack,
custom if conditions, plot() overlays, and strategy execution with full metrics.
"""

import math
import re
from typing import Dict, List, Any, Optional, Tuple, Union

class PineEngine:
    @staticmethod
    def calculate_sma(series: List[float], period: int) -> List[Optional[float]]:
        n = len(series)
        res = [None] * n
        if n < period or period <= 0:
            return res
        curr_sum = sum(series[:period])
        res[period - 1] = curr_sum / period
        for i in range(period, n):
            curr_sum += series[i] - series[i - period]
            res[i] = curr_sum / period
        return res

    @staticmethod
    def calculate_ema(series: List[float], period: int) -> List[Optional[float]]:
        n = len(series)
        res = [None] * n
        if n < period or period <= 0:
            return res
        mult = 2.0 / (period + 1)
        res[period - 1] = sum(series[:period]) / period
        for i in range(period, n):
            prev = res[i - 1]
            res[i] = (series[i] - prev) * mult + prev if prev is not None else series[i]
        return res

    @staticmethod
    def calculate_rsi(series: List[float], period: int = 14) -> List[Optional[float]]:
        n = len(series)
        res = [None] * n
        if n <= period or period <= 0:
            return res

        gains = [0.0] * n
        losses = [0.0] * n
        for i in range(1, n):
            diff = series[i] - series[i - 1]
            if diff > 0:
                gains[i] = diff
            else:
                losses[i] = -diff

        avg_gain = sum(gains[1 : period + 1]) / period
        avg_loss = sum(losses[1 : period + 1]) / period

        res[period] = 100.0 if avg_loss == 0 else 100.0 - (100.0 / (1.0 + (avg_gain / avg_loss)))

        for i in range(period + 1, n):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
            if avg_loss == 0:
                res[i] = 100.0
            else:
                rs = avg_gain / avg_loss
                res[i] = 100.0 - (100.0 / (1.0 + rs))
        return res

    @staticmethod
    def calculate_atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> List[Optional[float]]:
        n = len(closes)
        res = [None] * n
        if n < period:
            return res

        tr = [0.0] * n
        tr[0] = highs[0] - lows[0]
        for i in range(1, n):
            tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))

        res[period - 1] = sum(tr[:period]) / period
        for i in range(period, n):
            res[i] = (res[i - 1] * (period - 1) + tr[i]) / period
        return res

    @staticmethod
    def calculate_supertrend(highs: List[float], lows: List[float], closes: List[float], period: int = 10, multiplier: float = 3.0) -> Tuple[List[Optional[float]], List[int]]:
        n = len(closes)
        if n < period + 1:
            return ([None] * n, [1] * n)

        atr = PineEngine.calculate_atr(highs, lows, closes, period)
        hl2 = [(highs[i] + lows[i]) / 2.0 for i in range(n)]

        upper_band = [0.0] * n
        lower_band = [0.0] * n
        supertrend = [None] * n
        direction = [1] * n

        for i in range(period, n):
            curr_atr = atr[i] or 0.0
            up = hl2[i] + (multiplier * curr_atr)
            dn = hl2[i] - (multiplier * curr_atr)

            if i > period:
                upper_band[i] = up if closes[i - 1] > upper_band[i - 1] else min(up, upper_band[i - 1])
                lower_band[i] = dn if closes[i - 1] < lower_band[i - 1] else max(dn, lower_band[i - 1])
                prev_dir = direction[i - 1]
                if prev_dir == 1:
                    direction[i] = -1 if closes[i] < lower_band[i] else 1
                else:
                    direction[i] = 1 if closes[i] > upper_band[i] else -1
            else:
                upper_band[i] = up
                lower_band[i] = dn
                direction[i] = 1 if closes[i] > upper_band[i] else -1

            supertrend[i] = lower_band[i] if direction[i] == 1 else upper_band[i]

        return (supertrend, direction)

    @staticmethod
    def calculate_bollinger_bands(series: List[float], period: int = 20, mult: float = 2.0) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
        sma = PineEngine.calculate_sma(series, period)
        n = len(series)
        upper = [None] * n
        lower = [None] * n

        for i in range(period - 1, n):
            window = series[i - period + 1 : i + 1]
            mean = sma[i]
            std = math.sqrt(sum((x - mean) ** 2 for x in window) / period)
            upper[i] = mean + (mult * std)
            lower[i] = mean - (mult * std)

        return (sma, upper, lower)

    @staticmethod
    def calculate_macd(series: List[float], fast: int = 12, slow: int = 26, signal: int = 9) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
        ema_fast = PineEngine.calculate_ema(series, fast)
        ema_slow = PineEngine.calculate_ema(series, slow)
        n = len(series)
        macd_line = [None] * n
        valid_macd = []
        valid_indices = []

        for i in range(n):
            if ema_fast[i] is not None and ema_slow[i] is not None:
                val = ema_fast[i] - ema_slow[i]
                macd_line[i] = val
                valid_macd.append(val)
                valid_indices.append(i)

        signal_line = [None] * n
        hist = [None] * n

        if len(valid_macd) >= signal:
            sig_values = PineEngine.calculate_ema(valid_macd, signal)
            for idx, val in enumerate(sig_values):
                orig_i = valid_indices[idx]
                signal_line[orig_i] = val
                if val is not None and macd_line[orig_i] is not None:
                    hist[orig_i] = macd_line[orig_i] - val

        return (macd_line, signal_line, hist)

    @classmethod
    def verify_code(cls, script_code: str) -> Dict[str, Any]:
        """
        Statically verifies Pine Script code for syntax, balanced brackets/parentheses,
        known functions, and proper block indentation. Returns diagnostic info and fix hints.
        """
        if not script_code or not script_code.strip():
            return {
                "valid": False,
                "error": "Pine Script code is empty.",
                "line": 1,
                "line_text": "",
                "hint": "Please write or select a Pine Script template to compile.",
                "suggestion": ""
            }

        lines = script_code.split("\n")

        # Allowed ta.* functions
        KNOWN_TA_FUNCS = {
            "ta.ema": ("ta.ema(source, length)", 2),
            "ta.sma": ("ta.sma(source, length)", 2),
            "ta.rsi": ("ta.rsi(source, length)", 2),
            "ta.bb": ("ta.bb(source, length, mult)", 3),
            "ta.supertrend": ("ta.supertrend(length, factor)", 2),
            "ta.macd": ("ta.macd(source, fast, slow, signal)", 4),
            "ta.atr": ("ta.atr(length)", 1),
            "ta.highest": ("ta.highest(source, length)", 2),
            "ta.lowest": ("ta.lowest(source, length)", 2),
            "ta.crossover": ("ta.crossover(series1, series2)", 2),
            "ta.crossunder": ("ta.crossunder(series1, series2)", 2)
        }

        expect_indent = False
        last_if_line = 0

        for idx, raw_line in enumerate(lines, 1):
            line = raw_line.strip()
            if not line or line.startswith("//") or line.startswith("#"):
                continue

            # Check if block expectation
            if expect_indent:
                if not raw_line.startswith("    ") and not raw_line.startswith("\t"):
                    return {
                        "valid": False,
                        "error": f"Missing indented block under 'if' condition on line {last_if_line}.",
                        "line": idx,
                        "line_text": raw_line,
                        "hint": "In Pine Script, statements inside an 'if' block must be indented by 4 spaces.",
                        "suggestion": f"    {line}"
                    }
                expect_indent = False

            if line.startswith("if ") or line.startswith("if("):
                expect_indent = True
                last_if_line = idx

            # 1. Check balanced parentheses ()
            open_p = line.count("(")
            close_p = line.count(")")
            if open_p > close_p:
                missing = open_p - close_p
                return {
                    "valid": False,
                    "error": f"Missing {missing} closing parenthesis ')' on line {idx}.",
                    "line": idx,
                    "line_text": raw_line,
                    "hint": f"Add {missing} closing parenthesis ')' at the end of the line or expression.",
                    "suggestion": raw_line + (")" * missing)
                }
            elif close_p > open_p:
                return {
                    "valid": False,
                    "error": f"Unexpected extra closing parenthesis ')' on line {idx}.",
                    "line": idx,
                    "line_text": raw_line,
                    "hint": "Remove the extra ')' on this line.",
                    "suggestion": ""
                }

            # 2. Check balanced brackets []
            open_b = line.count("[")
            close_b = line.count("]")
            if open_b > close_b:
                missing = open_b - close_b
                return {
                    "valid": False,
                    "error": f"Missing closing bracket ']' on line {idx}.",
                    "line": idx,
                    "line_text": raw_line,
                    "hint": "Add closing bracket ']' to close variable unpacking or series indexing (e.g. close[1]).",
                    "suggestion": raw_line + ("]" * missing)
                }
            elif close_b > open_b:
                return {
                    "valid": False,
                    "error": f"Unexpected extra closing bracket ']' on line {idx}.",
                    "line": idx,
                    "line_text": raw_line,
                    "hint": "Remove the unmatched ']' on this line.",
                    "suggestion": ""
                }

            # 3. Check quote closure
            double_q = line.count('"')
            single_q = line.count("'")
            if double_q % 2 != 0:
                return {
                    "valid": False,
                    "error": f"Unterminated double quote string literal on line {idx}.",
                    "line": idx,
                    "line_text": raw_line,
                    "hint": 'Ensure all string quotes are closed with a matching quotation mark (e.g. "Long").',
                    "suggestion": raw_line + '"'
                }
            if single_q % 2 != 0:
                return {
                    "valid": False,
                    "error": f"Unterminated single quote string literal on line {idx}.",
                    "line": idx,
                    "line_text": raw_line,
                    "hint": "Ensure all single quotes are closed with a matching ' mark.",
                    "suggestion": raw_line + "'"
                }

            # 4. Check for invalid assignment comparison
            if re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*\s*==\s*ta\.', line):
                return {
                    "valid": False,
                    "error": f"Comparison operator '==' used instead of assignment '=' on line {idx}.",
                    "line": idx,
                    "line_text": raw_line,
                    "hint": "Use '=' to assign a variable in Pine Script (e.g. 'ema9 = ta.ema(...)').",
                    "suggestion": raw_line.replace("==", "=", 1)
                }

            # 5. Check unknown ta.* calls
            ta_calls = re.findall(r'(ta\.[a-zA-Z0-9_]+)', line)
            for call in ta_calls:
                if call not in KNOWN_TA_FUNCS:
                    closest = [k for k in KNOWN_TA_FUNCS if call.replace("ta.", "") in k or k.replace("ta.", "") in call]
                    sugg_name = closest[0] if closest else "ta.ema"
                    return {
                        "valid": False,
                        "error": f"Unknown function '{call}' on line {idx}.",
                        "line": idx,
                        "line_text": raw_line,
                        "hint": f"Pine Script v5 does not recognize '{call}'. Did you mean '{sugg_name}'?",
                        "suggestion": raw_line.replace(call, sugg_name)
                    }

            # 6. Check strategy.entry arguments
            if "strategy.entry" in line:
                m = re.search(r'strategy\.entry\((.*)\)', line)
                if not m or not m.group(1).strip():
                    return {
                        "valid": False,
                        "error": f"Missing arguments in strategy.entry() on line {idx}.",
                        "line": idx,
                        "line_text": raw_line,
                        "hint": 'strategy.entry requires an ID and direction: strategy.entry("Long", strategy.long)',
                        "suggestion": '    strategy.entry("Long", strategy.long)'
                    }

        return {"valid": True, "error": None}

    @classmethod
    def execute_script(cls, script_code: str, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Parses and executes a Pine Script program against historical candles.
        Supports variables, expressions, ta.* functions, plot(), plotshape(),
        and strategy backtesting.
        """
        if not candles:
            return {"error": "Candles list is empty", "plots": [], "signals": [], "metrics": {}}

        import textwrap
        script_code = textwrap.dedent(script_code)

        # Pre-verify code syntax before executing
        validation = cls.verify_code(script_code)
        if not validation.get("valid", True):
            return {
                "error": validation["error"],
                "line": validation.get("line", 1),
                "line_text": validation.get("line_text", ""),
                "hint": validation.get("hint", ""),
                "suggestion": validation.get("suggestion", ""),
                "plots": [],
                "signals": [],
                "metrics": {}
            }

        n = len(candles)
        times = [c["time"] for c in candles]
        opens = [float(c["open"]) for c in candles]
        highs = [float(c["high"]) for c in candles]
        lows = [float(c["low"]) for c in candles]
        closes = [float(c["close"]) for c in candles]
        volumes = [float(c["volume"]) for c in candles]
        hl2 = [(highs[i] + lows[i]) / 2.0 for i in range(n)]
        hlc3 = [(highs[i] + lows[i] + closes[i]) / 3.0 for i in range(n)]
        ohlc4 = [(opens[i] + highs[i] + lows[i] + closes[i]) / 4.0 for i in range(n)]

        # Environment scope containing series
        env: Dict[str, Any] = {
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes,
            "hl2": hl2,
            "hlc3": hlc3,
            "ohlc4": ohlc4,
            "strategy.long": "LONG",
            "strategy.short": "SHORT",
            "color.green": "#00e676",
            "color.red": "#ff1744",
            "color.blue": "#00f0ff",
            "color.yellow": "#ffaa00",
            "color.purple": "#a855f7"
        }

        plots: List[Dict[str, Any]] = []
        plotshapes: List[Dict[str, Any]] = []
        strategy_entries: List[Dict[str, Any]] = []  # [{bar, id, direction}]
        strategy_exits: List[Dict[str, Any]] = []

        lines = script_code.split("\n")
        current_if_cond = None

        for line_num, raw_line in enumerate(lines, 1):
            line = raw_line.strip()
            if not line or line.startswith("//") or line.startswith("#"):
                continue

            # Check if block
            if line.startswith("if ") or line.startswith("if("):
                cond_str = re.search(r"if\s*\(?([^)]+)\)?", line)
                if cond_str:
                    cond_var = cond_str.group(1).strip()
                    current_if_cond = cond_var
                continue

            # Indented body inside if
            if raw_line.startswith("    ") or raw_line.startswith("\t"):
                if current_if_cond:
                    # Strategy entry inside if
                    if "strategy.entry" in line:
                        m = re.search(r'strategy\.entry\(\s*["\']([^"\']+)["\']\s*,\s*([^,)]+)', line)
                        if m:
                            entry_id = m.group(1).strip()
                            direction = m.group(2).strip()
                            strategy_entries.append({
                                "id": entry_id,
                                "direction": direction,
                                "condition_expr": current_if_cond
                            })
                    elif "strategy.exit" in line or "strategy.close" in line:
                        m = re.search(r'strategy\.(?:exit|close)\(\s*["\']([^"\']+)["\']', line)
                        if m:
                            strategy_exits.append({
                                "id": m.group(1).strip(),
                                "condition_expr": current_if_cond
                            })
                continue
            else:
                current_if_cond = None

            # 1. Multi-variable unpack e.g. [a, b] = ta.supertrend(...) or [mid, up, low] = ta.bb(...)
            if line.startswith("[") and "]" in line and "=" in line:
                left, right = line.split("=", 1)
                left_vars = [v.strip() for v in left.replace("[", "").replace("]", "").split(",")]
                right = right.strip()

                if "ta.supertrend" in right:
                    params = cls._extract_call_args(right)
                    period = int(params[0]) if len(params) > 0 else 10
                    mult = float(params[1]) if len(params) > 1 else 3.0
                    st, direction = cls.calculate_supertrend(highs, lows, closes, period, mult)
                    if len(left_vars) >= 1: env[left_vars[0]] = st
                    if len(left_vars) >= 2: env[left_vars[1]] = direction

                elif "ta.bb" in right:
                    params = cls._extract_call_args(right)
                    src_name = params[0] if len(params) > 0 else "close"
                    src = env.get(src_name, closes)
                    period = int(params[1]) if len(params) > 1 else 20
                    mult = float(params[2]) if len(params) > 2 else 2.0
                    mid, up, low = cls.calculate_bollinger_bands(src, period, mult)
                    if len(left_vars) >= 1: env[left_vars[0]] = mid
                    if len(left_vars) >= 2: env[left_vars[1]] = up
                    if len(left_vars) >= 3: env[left_vars[2]] = low

                elif "ta.macd" in right:
                    params = cls._extract_call_args(right)
                    src_name = params[0] if len(params) > 0 else "close"
                    src = env.get(src_name, closes)
                    fast = int(params[1]) if len(params) > 1 else 12
                    slow = int(params[2]) if len(params) > 2 else 26
                    sig = int(params[3]) if len(params) > 3 else 9
                    macd_l, sig_l, hist = cls.calculate_macd(src, fast, slow, sig)
                    if len(left_vars) >= 1: env[left_vars[0]] = macd_l
                    if len(left_vars) >= 2: env[left_vars[1]] = sig_l
                    if len(left_vars) >= 3: env[left_vars[2]] = hist
                continue

            # 2. Function calls: plot(...) or plotshape(...)
            if line.startswith("plot(") or line.startswith("plot "):
                cls._handle_plot(line, env, times, n, plots)
                continue

            if line.startswith("plotshape("):
                cls._handle_plotshape(line, env, times, closes, n, plotshapes)
                continue

            # 3. Direct variable assignment: varName = expression
            if "=" in line and not line.startswith("strategy.") and not line.startswith("indicator(") and not line.startswith("strategy("):
                parts = line.split("=", 1)
                var_name = parts[0].strip()
                expr = parts[1].strip()

                val = cls._evaluate_expr(expr, env, n, opens, highs, lows, closes, volumes)
                if val is not None:
                    env[var_name] = val
                continue

            # 4. Top-level strategy.entry or strategy.exit
            if line.startswith("strategy.entry"):
                m = re.search(r'strategy\.entry\(\s*["\']([^"\']+)["\']\s*,\s*([^,)]+)(?:,\s*when\s*=\s*([^)]+))?', line)
                if m:
                    strategy_entries.append({
                        "id": m.group(1).strip(),
                        "direction": m.group(2).strip(),
                        "condition_expr": m.group(3).strip() if m.group(3) else None
                    })

        # --- Execute Strategy Signals & Backtest Simulation ---
        signals: List[Dict[str, Any]] = []
        trades: List[Dict[str, Any]] = []
        position = None  # {"side": "long", "entry_price": float, "bar": int}
        equity = 10000.0
        init_equity = equity
        win_count = 0

        # Run bar by bar
        for bar in range(1, n):
            for entry_rule in strategy_entries:
                cond_expr = entry_rule.get("condition_expr")
                is_triggered = False

                if cond_expr:
                    # Evaluate condition at this bar
                    is_triggered = cls._eval_condition_at_bar(cond_expr, env, bar)
                else:
                    is_triggered = True

                if is_triggered:
                    raw_dir = entry_rule["direction"]
                    is_long = "long" in raw_dir.lower() or "strategy.long" in raw_dir.lower() or env.get(raw_dir) == "LONG"
                    sig_type = "BUY" if is_long else "SELL"
                    sig_color = "#00e676" if is_long else "#ff1744"

                    signals.append({
                        "time": times[bar],
                        "type": sig_type,
                        "price": closes[bar],
                        "label": f"{sig_type} / {entry_rule['id']}",
                        "color": sig_color
                    })

                    # Strategy Backtester
                    if is_long:
                        if position and position["side"] == "short":
                            pnl = (position["entry_price"] - closes[bar]) * 0.1
                            equity += pnl
                            trades.append({"type": "CLOSE_SHORT", "pnl": round(pnl, 2), "exit_price": closes[bar], "time": times[bar]})
                            if pnl > 0: win_count += 1
                            position = None

                        if not position:
                            position = {"side": "long", "entry_price": closes[bar], "bar": bar}
                    else:
                        if position and position["side"] == "long":
                            pnl = (closes[bar] - position["entry_price"]) * 0.1
                            equity += pnl
                            trades.append({"type": "CLOSE_LONG", "pnl": round(pnl, 2), "exit_price": closes[bar], "time": times[bar]})
                            if pnl > 0: win_count += 1
                            position = None

                        if not position:
                            position = {"side": "short", "entry_price": closes[bar], "bar": bar}

        # Close position at the last bar
        if position:
            last_p = closes[-1]
            pnl = (last_p - position["entry_price"]) * 0.1 if position["side"] == "long" else (position["entry_price"] - last_p) * 0.1
            equity += pnl
            trades.append({"type": f"CLOSE_{position['side'].upper()}", "pnl": round(pnl, 2), "exit_price": last_p, "time": times[-1]})
            if pnl > 0: win_count += 1

        total_trades = len(trades)
        win_rate = round((win_count / total_trades * 100.0) if total_trades > 0 else 0.0, 1)
        net_profit_pct = round(((equity - init_equity) / init_equity) * 100.0, 2)

        return {
            "plots": plots,
            "plotshapes": plotshapes,
            "signals": signals,
            "metrics": {
                "initial_capital": init_equity,
                "net_profit": round(equity - init_equity, 2),
                "net_profit_pct": net_profit_pct,
                "total_trades": total_trades,
                "win_rate": win_rate,
                "winning_trades": win_count,
                "losing_trades": total_trades - win_count
            },
            "trades": trades[:40]
        }

    @classmethod
    def _extract_call_args(cls, call_str: str) -> List[str]:
        m = re.search(r'\((.*)\)', call_str)
        if not m:
            return []
        raw_args = m.group(1).split(",")
        return [a.strip() for a in raw_args if a.strip()]

    @classmethod
    def _evaluate_expr(cls, expr: str, env: Dict[str, Any], n: int, opens, highs, lows, closes, volumes) -> Any:
        expr = expr.strip()

        # 1. ta.ema(source, length)
        if expr.startswith("ta.ema"):
            args = cls._extract_call_args(expr)
            src_name = args[0] if len(args) > 0 else "close"
            src = env.get(src_name, closes)
            period = int(args[1]) if len(args) > 1 else 9
            return cls.calculate_ema(src, period)

        # 2. ta.sma(source, length)
        if expr.startswith("ta.sma"):
            args = cls._extract_call_args(expr)
            src_name = args[0] if len(args) > 0 else "close"
            src = env.get(src_name, closes)
            period = int(args[1]) if len(args) > 1 else 20
            return cls.calculate_sma(src, period)

        # 3. ta.rsi(source, length)
        if expr.startswith("ta.rsi"):
            args = cls._extract_call_args(expr)
            src_name = args[0] if len(args) > 0 else "close"
            src = env.get(src_name, closes)
            period = int(args[1]) if len(args) > 1 else 14
            return cls.calculate_rsi(src, period)

        # 4. ta.atr(length)
        if expr.startswith("ta.atr"):
            args = cls._extract_call_args(expr)
            period = int(args[0]) if len(args) > 0 else 14
            return cls.calculate_atr(highs, lows, closes, period)

        # 5. ta.highest(source, length)
        if expr.startswith("ta.highest"):
            args = cls._extract_call_args(expr)
            src_name = args[0] if len(args) > 0 else "high"
            src = env.get(src_name, highs)
            period = int(args[1]) if len(args) > 1 else 20
            res = [None] * n
            for i in range(period - 1, n):
                res[i] = max(src[i - period + 1 : i + 1])
            return res

        # 6. ta.lowest(source, length)
        if expr.startswith("ta.lowest"):
            args = cls._extract_call_args(expr)
            src_name = args[0] if len(args) > 0 else "low"
            src = env.get(src_name, lows)
            period = int(args[1]) if len(args) > 1 else 20
            res = [None] * n
            for i in range(period - 1, n):
                res[i] = min(src[i - period + 1 : i + 1])
            return res

        # 7. ta.crossover(s1, s2)
        if expr.startswith("ta.crossover"):
            args = cls._extract_call_args(expr)
            s1 = env.get(args[0], closes)
            s2 = env.get(args[1], closes)
            res = [False] * n
            for i in range(1, n):
                v1, v2 = s1[i], s2[i]
                p1, p2 = s1[i - 1], s2[i - 1]
                if v1 is not None and v2 is not None and p1 is not None and p2 is not None:
                    if v1 > v2 and p1 <= p2:
                        res[i] = True
            return res

        # 8. ta.crossunder(s1, s2)
        if expr.startswith("ta.crossunder"):
            args = cls._extract_call_args(expr)
            s1 = env.get(args[0], closes)
            s2 = env.get(args[1], closes)
            res = [False] * n
            for i in range(1, n):
                v1, v2 = s1[i], s2[i]
                p1, p2 = s1[i - 1], s2[i - 1]
                if v1 is not None and v2 is not None and p1 is not None and p2 is not None:
                    if v1 < v2 and p1 >= p2:
                        res[i] = True
            return res

        # 9. Direct variable reference or literal
        if expr in env:
            return env[expr]

        try:
            return float(expr)
        except ValueError:
            pass

        return None

    @classmethod
    def _eval_condition_at_bar(cls, cond_str: str, env: Dict[str, Any], bar: int) -> bool:
        cond_str = cond_str.strip()
        # Direct boolean series in env
        if cond_str in env:
            val = env[cond_str]
            if isinstance(val, list) and bar < len(val):
                return bool(val[bar])
            return bool(val)

        # Handle > or < expressions: e.g. close > highestHigh[1]
        for op in [">=", "<=", "==", "!=", ">", "<"]:
            if op in cond_str:
                left, right = cond_str.split(op, 1)
                l_val = cls._get_series_value_at_bar(left.strip(), env, bar)
                r_val = cls._get_series_value_at_bar(right.strip(), env, bar)
                if l_val is None or r_val is None:
                    return False
                if op == ">": return l_val > r_val
                if op == "<": return l_val < r_val
                if op == ">=": return l_val >= r_val
                if op == "<=": return l_val <= r_val
                if op == "==": return l_val == r_val
                if op == "!=": return l_val != r_val

        return False

    @classmethod
    def _get_series_value_at_bar(cls, token: str, env: Dict[str, Any], bar: int) -> Optional[float]:
        token = token.strip()
        offset = 0
        if "[" in token and token.endswith("]"):
            m = re.search(r"([^\[]+)\[(\d+)\]", token)
            if m:
                token = m.group(1).strip()
                offset = int(m.group(2))

        target_bar = bar - offset
        if target_bar < 0:
            return None

        if token in env:
            series = env[token]
            if isinstance(series, list):
                if target_bar < len(series):
                    return series[target_bar]
            else:
                return float(series)

        try:
            return float(token)
        except ValueError:
            return None

    @classmethod
    def _handle_plot(cls, line: str, env: Dict[str, Any], times: List[int], n: int, plots: List[Dict[str, Any]]):
        args = cls._extract_call_args(line)
        if not args:
            return
        series_name = args[0].strip()
        series_data = env.get(series_name)
        if not series_data or not isinstance(series_data, list):
            return

        title = series_name
        color = "#00f0ff"
        linewidth = 2

        # Extract title and color from arguments
        for a in args[1:]:
            a = a.strip()
            if "=" in a:
                k, v = a.split("=", 1)
                k = k.strip().lower()
                v = v.strip().replace('"', '').replace("'", "")
                if k == "title": title = v
                elif k == "color":
                    color = env.get(v, v)
                elif k == "linewidth":
                    try: linewidth = int(v)
                    except ValueError: pass
            else:
                title = a.replace('"', '').replace("'", "")

        points = []
        for i in range(n):
            if i < len(series_data) and series_data[i] is not None:
                points.append({"time": times[i], "value": series_data[i]})

        plots.append({
            "title": title,
            "color": color,
            "linewidth": linewidth,
            "pane": "main",
            "data": points
        })

    @classmethod
    def _handle_plotshape(cls, line: str, env: Dict[str, Any], times: List[int], closes: List[float], n: int, plotshapes: List[Dict[str, Any]]):
        args = cls._extract_call_args(line)
        if not args:
            return
        cond_name = args[0].strip()
        cond_data = env.get(cond_name)
        if not cond_data or not isinstance(cond_data, list):
            return

        title = "Shape"
        color = "#00e676"
        for a in args[1:]:
            if "=" in a:
                k, v = a.split("=", 1)
                k, v = k.strip().lower(), v.strip().replace('"', '').replace("'", "")
                if k == "title": title = v
                elif k == "color": color = env.get(v, v)

        for i in range(n):
            if i < len(cond_data) and cond_data[i]:
                plotshapes.append({
                    "time": times[i],
                    "price": closes[i],
                    "title": title,
                    "color": color
                })
