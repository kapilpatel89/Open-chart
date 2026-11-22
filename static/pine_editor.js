/**
 * Pine Script IDE & Strategy Manager
 * Handles code editing, preset templates, compiling, execution,
 * and automated strategy-to-order execution.
 */

const PINE_TEMPLATES = {
    ema_ribbon: `//@version=5
strategy("EMA Ribbon Scalper", overlay=true)
// Indicators
ema9 = ta.ema(close, 9)
ema21 = ta.ema(close, 21)
plot(ema9, "EMA 9", color=#00f0ff, linewidth=2)
plot(ema21, "EMA 21", color=#ffaa00, linewidth=2)

// Strategy Entry Conditions
longCondition = ta.crossover(ema9, ema21)
if (longCondition)
    strategy.entry("Long", strategy.long)

shortCondition = ta.crossunder(ema9, ema21)
if (shortCondition)
    strategy.entry("Short", strategy.short)
`,

    supertrend: `//@version=5
strategy("Supertrend + Momentum", overlay=true)
// Volatility & Trend Filter
[st, dir] = ta.supertrend(10, 3.0)
rsi = ta.rsi(close, 14)

plot(st, "Supertrend (10,3)", color=#00e676, linewidth=2)

// Strategy Logic
longCondition = (dir == 1 and ta.crossover(dir, 0))
if (longCondition)
    strategy.entry("ST Long", strategy.long)

shortCondition = (dir == -1 and ta.crossunder(dir, 0))
if (shortCondition)
    strategy.entry("ST Short", strategy.short)
`,

    bollinger: `//@version=5
strategy("Bollinger Mean Reversion", overlay=true)
// Volatility Envelopes
[mid, upper, lower] = ta.bb(close, 20, 2.0)
plot(upper, "Upper Band", color=#a855f7)
plot(lower, "Lower Band", color=#a855f7)

// Mean Reversion Signals
if (ta.crossover(close, lower))
    strategy.entry("BB Long", strategy.long)

if (ta.crossunder(close, upper))
    strategy.entry("BB Short", strategy.short)
`,

    smc: `//@version=5
strategy("Institutional SMC Orderflow", overlay=true)
// Liquidity Sweep & Break of Structure
highestHigh = ta.highest(high, 20)
lowestLow = ta.lowest(low, 20)
plot(highestHigh, "Liquidity High", color=#00f0ff)
plot(lowestLow, "Liquidity Low", color=#ff1744)

if (close > highestHigh[1])
    strategy.entry("SMC Long", strategy.long)
if (close < lowestLow[1])
    strategy.entry("SMC Short", strategy.short)
`
};

const PINE_COLOR_MAP = {
    'color.red': '#f23645',
    'color.green': '#089981',
    'color.blue': '#2962ff',
    'color.yellow': '#fbc02d',
    'color.orange': '#ff9800',
    'color.purple': '#ab47bc',
    'color.fuchsia': '#e040fb',
    'color.white': '#ffffff',
    'color.black': '#000000',
    'color.gray': '#787b86',
    'color.aqua': '#00f0ff',
    'color.lime': '#00e676',
    'color.teal': '#00897b',
    'color.maroon': '#880e4f',
    'color.navy': '#1a237e',
    'red': '#f23645',
    'green': '#089981',
    'blue': '#2962ff',
    'yellow': '#fbc02d',
    'orange': '#ff9800',
    'purple': '#ab47bc',
    'fuchsia': '#e040fb',
    'aqua': '#00f0ff',
    'white': '#ffffff',
    'black': '#000000'
};

/**
 * Client-Side Pine Script v5 Compiler & Strategy Backtesting Engine
 * 100% Pure JavaScript: Executes offline, on GitHub Pages, and in-browser in 1ms.
 */
class ClientPineEngine {
    static calculateSMA(series, period) {
        const n = series.length;
        const res = new Array(n).fill(null);
        if (n < period || period <= 0) return res;
        let sum = 0;
        for (let i = 0; i < period; i++) sum += (series[i] || 0);
        res[period - 1] = sum / period;
        for (let i = period; i < n; i++) {
            sum += (series[i] || 0) - (series[i - period] || 0);
            res[i] = sum / period;
        }
        return res;
    }

    static calculateEMA(series, period) {
        const n = series.length;
        const res = new Array(n).fill(null);
        if (n < period || period <= 0) return res;
        const k = 2 / (period + 1);
        let sum = 0;
        for (let i = 0; i < period; i++) sum += (series[i] || 0);
        res[period - 1] = sum / period;
        for (let i = period; i < n; i++) {
            const prev = res[i - 1];
            res[i] = ((series[i] || 0) - prev) * k + prev;
        }
        return res;
    }

    static calculateRSI(series, period = 14) {
        const n = series.length;
        const res = new Array(n).fill(null);
        if (n <= period || period <= 0) return res;
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = series[i] - series[i - 1];
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        res[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

        for (let i = period + 1; i < n; i++) {
            const diff = series[i] - series[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            res[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
        }
        return res;
    }

    static calculateATR(highs, lows, closes, period = 14) {
        const n = closes.length;
        const tr = [highs[0] - lows[0]];
        for (let i = 1; i < n; i++) {
            const h = highs[i], l = lows[i], prevC = closes[i - 1];
            tr.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
        }
        return this.calculateSMA(tr, period);
    }

    static calculateBollinger(series, period = 20, mult = 2) {
        const sma = this.calculateSMA(series, period);
        const upper = new Array(series.length).fill(null);
        const lower = new Array(series.length).fill(null);
        for (let i = period - 1; i < series.length; i++) {
            const mean = sma[i];
            let sumSq = 0;
            for (let j = i - period + 1; j <= i; j++) {
                sumSq += (series[j] - mean) ** 2;
            }
            const std = Math.sqrt(sumSq / period);
            upper[i] = mean + (mult * std);
            lower[i] = mean - (mult * std);
        }
        return { basis: sma, upper, lower };
    }

    static calculateSupertrend(highs, lows, closes, period = 10, multiplier = 3) {
        const n = closes.length;
        const atr = this.calculateATR(highs, lows, closes, period);
        const supertrend = new Array(n).fill(null);
        const direction = new Array(n).fill(1);
        const upperBand = new Array(n).fill(0);
        const lowerBand = new Array(n).fill(0);

        for (let i = period; i < n; i++) {
            const hl2 = (highs[i] + lows[i]) / 2;
            const currAtr = atr[i] || 0;
            const up = hl2 + (multiplier * currAtr);
            const dn = hl2 - (multiplier * currAtr);

            if (i > period) {
                upperBand[i] = closes[i - 1] > upperBand[i - 1] ? up : Math.min(up, upperBand[i - 1]);
                lowerBand[i] = closes[i - 1] < lowerBand[i - 1] ? dn : Math.max(dn, lowerBand[i - 1]);
                if (direction[i - 1] === 1) {
                    direction[i] = closes[i] < lowerBand[i] ? -1 : 1;
                } else {
                    direction[i] = closes[i] > upperBand[i] ? 1 : -1;
                }
            } else {
                upperBand[i] = up;
                lowerBand[i] = dn;
                direction[i] = closes[i] > upperBand[i] ? 1 : -1;
            }
            supertrend[i] = direction[i] === 1 ? lowerBand[i] : upperBand[i];
        }
        return { supertrend, direction };
    }

    static executeScript(code, candles, customInputs = {}, customStyles = {}) {
        if (!candles || !candles.length) {
            return { error: "Candles dataset is empty", plots: [], signals: [], metrics: {}, inputs: {} };
        }
        const n = candles.length;
        const times = candles.map(c => c.time);
        const opens = candles.map(c => c.open);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        const volumes = candles.map(c => c.volume);

        let scriptTitle = "Pine Script Indicator";
        const metaMatch = code.match(/(?:indicator|strategy)\(\s*["']([^"']+)["']/);
        if (metaMatch) scriptTitle = metaMatch[1];

        const env = {
            open: opens, high: highs, low: lows, close: closes, volume: volumes,
            hl2: highs.map((h, i) => (h + lows[i]) / 2),
            hlc3: highs.map((h, i) => (h + lows[i] + closes[i]) / 3),
            ohlc4: opens.map((o, i) => (o + highs[i] + lows[i] + closes[i]) / 4)
        };

        const inputs = {};
        const plots = [];
        const signals = [];
        const strategyEntries = [];
        const lines = code.split('\n');

        let currentIfCond = null;

        const getShiftedSeries = (token) => {
            if (!token) return env.close;
            token = token.trim();
            const m = token.match(/^([a-zA-Z0-9_\.]+)(?:\[(\d+)\])?$/);
            if (m) {
                const baseName = m[1];
                const offset = m[2] ? parseInt(m[2]) : 0;
                const base = env[baseName] !== undefined ? env[baseName] : (baseName === 'high' ? highs : (baseName === 'low' ? lows : (baseName === 'close' ? closes : (baseName === 'open' ? opens : (baseName === 'volume' ? volumes : null)))));
                if (base && Array.isArray(base)) {
                    if (offset === 0) return base;
                    const shifted = new Array(n).fill(null);
                    for (let i = 0; i < n; i++) {
                        shifted[i] = i >= offset ? base[i - offset] : base[0];
                    }
                    return shifted;
                }
            }
            return env[token] !== undefined ? env[token] : null;
        };

        const resolvePeriod = (rawArg, fallback) => {
            if (!rawArg) return fallback;
            const trimmed = rawArg.trim();
            if (env[trimmed] !== undefined && typeof env[trimmed] === 'number') {
                return env[trimmed];
            }
            const p = parseInt(trimmed);
            return (!isNaN(p) && p > 0) ? p : fallback;
        };

        const evalSeriesExpr = (exprStr) => {
            if (!exprStr) return null;
            exprStr = exprStr.trim();

            // 1. Ternary condition: cond ? trueExpr : falseExpr
            if (exprStr.includes('?') && exprStr.includes(':')) {
                const qIdx = exprStr.indexOf('?');
                const cIdx = exprStr.indexOf(':', qIdx);
                const condPart = exprStr.substring(0, qIdx).trim();
                const truePart = exprStr.substring(qIdx + 1, cIdx).trim();
                const falsePart = exprStr.substring(cIdx + 1).trim();

                const condVal = env[condPart] !== undefined ? env[condPart] : true;
                if (typeof condVal === 'boolean') {
                    const chosen = condVal ? truePart : falsePart;
                    return chosen === 'na' ? new Array(n).fill(null) : evalSeriesExpr(chosen);
                } else if (Array.isArray(condVal)) {
                    const sTrue = truePart === 'na' ? null : evalSeriesExpr(truePart);
                    const sFalse = falsePart === 'na' ? null : evalSeriesExpr(falsePart);
                    const res = new Array(n).fill(null);
                    for (let i = 0; i < n; i++) {
                        res[i] = condVal[i] ? (sTrue ? sTrue[i] : null) : (sFalse ? sFalse[i] : null);
                    }
                    return res;
                }
            }

            // 2. Compound boolean logic (and / or)
            if (exprStr.includes(' and ') || exprStr.includes(' or ')) {
                const partsAnd = exprStr.split(' and ');
                const res = new Array(n).fill(true);
                for (let b = 0; b < n; b++) {
                    let barRes = true;
                    for (const sub of partsAnd) {
                        if (sub.includes(' or ')) {
                            const orParts = sub.split(' or ');
                            const orOk = orParts.some(p => {
                                const s = evalSeriesExpr(p);
                                return s && s[b];
                            });
                            if (!orOk) { barRes = false; break; }
                        } else {
                            const s = evalSeriesExpr(sub);
                            if (!s || !s[b]) { barRes = false; break; }
                        }
                    }
                    res[b] = barRes;
                }
                return res;
            }

            // 3. Comparisons (> , < , >= , <= , == , !=)
            for (const op of ['>=', '<=', '==', '!=', '>', '<']) {
                if (exprStr.includes(op) && !exprStr.startsWith('ta.')) {
                    const [lStr, rStr] = exprStr.split(op, 2);
                    const sL = evalSeriesExpr(lStr);
                    const sR = evalSeriesExpr(rStr);
                    const res = new Array(n).fill(false);
                    for (let b = 0; b < n; b++) {
                        const vl = sL ? sL[b] : null;
                        const vr = sR ? sR[b] : null;
                        if (vl !== null && vr !== null && isFinite(vl) && isFinite(vr)) {
                            if (op === '>') res[b] = vl > vr;
                            else if (op === '<') res[b] = vl < vr;
                            else if (op === '>=') res[b] = vl >= vr;
                            else if (op === '<=') res[b] = vl <= vr;
                            else if (op === '==') res[b] = vl === vr;
                            else if (op === '!=') res[b] = vl !== vr;
                        }
                    }
                    return res;
                }
            }

            // 4. Arithmetic + / - outside parentheses
            let parenDepth = 0;
            let splitIdx = -1;
            let splitOp = null;
            for (let c = exprStr.length - 1; c >= 0; c--) {
                const ch = exprStr[c];
                if (ch === ')') parenDepth++;
                else if (ch === '(') parenDepth--;
                else if (parenDepth === 0 && (ch === '+' || ch === '-') && c > 0 && c < exprStr.length - 1) {
                    splitIdx = c;
                    splitOp = ch;
                    break;
                }
            }
            if (splitIdx > -1) {
                const sL = evalSeriesExpr(exprStr.substring(0, splitIdx));
                const sR = evalSeriesExpr(exprStr.substring(splitIdx + 1));
                const res = new Array(n).fill(null);
                for (let i = 0; i < n; i++) {
                    const vl = sL ? sL[i] : null;
                    const vr = sR ? sR[i] : null;
                    if (vl !== null && vr !== null && isFinite(vl) && isFinite(vr)) {
                        res[i] = splitOp === '+' ? (vl + vr) : (vl - vr);
                    }
                }
                return res;
            }

            // 5. Arithmetic * / / outside parentheses
            parenDepth = 0;
            splitIdx = -1;
            splitOp = null;
            for (let c = exprStr.length - 1; c >= 0; c--) {
                const ch = exprStr[c];
                if (ch === ')') parenDepth++;
                else if (ch === '(') parenDepth--;
                else if (parenDepth === 0 && (ch === '*' || ch === '/') && c > 0 && c < exprStr.length - 1) {
                    splitIdx = c;
                    splitOp = ch;
                    break;
                }
            }
            if (splitIdx > -1) {
                const sL = evalSeriesExpr(exprStr.substring(0, splitIdx));
                const sR = evalSeriesExpr(exprStr.substring(splitIdx + 1));
                const res = new Array(n).fill(null);
                for (let i = 0; i < n; i++) {
                    const vl = sL ? sL[i] : null;
                    const vr = sR ? sR[i] : null;
                    if (vl !== null && vr !== null && isFinite(vl) && isFinite(vr)) {
                        res[i] = splitOp === '*' ? (vl * vr) : (vr !== 0 ? (vl / vr) : null);
                    }
                }
                return res;
            }

            // 6. Function calls
            if (exprStr.startsWith('ta.highest')) {
                const args = exprStr.match(/\((.*)\)/)?.[1]?.split(',') || [];
                const src = getShiftedSeries(args[0]) || highs;
                const period = resolvePeriod(args[1], 20);
                const res = new Array(n).fill(null);
                for (let i = period - 1; i < n; i++) {
                    let maxV = -Infinity;
                    for (let j = i - period + 1; j <= i; j++) if (src[j] > maxV) maxV = src[j];
                    res[i] = maxV;
                }
                return res;
            }

            if (exprStr.startsWith('ta.lowest')) {
                const args = exprStr.match(/\((.*)\)/)?.[1]?.split(',') || [];
                const src = getShiftedSeries(args[0]) || lows;
                const period = resolvePeriod(args[1], 20);
                const res = new Array(n).fill(null);
                for (let i = period - 1; i < n; i++) {
                    let minV = Infinity;
                    for (let j = i - period + 1; j <= i; j++) if (src[j] < minV) minV = src[j];
                    res[i] = minV;
                }
                return res;
            }

            if (exprStr.startsWith('ta.atr')) {
                const args = exprStr.match(/\((.*)\)/)?.[1]?.split(',') || [];
                const period = resolvePeriod(args[0], 14);
                return this.calculateATR(highs, lows, closes, period);
            }

            if (exprStr.startsWith('ta.ema')) {
                const args = exprStr.match(/\((.*)\)/)?.[1]?.split(',') || [];
                const src = getShiftedSeries(args[0]) || closes;
                const period = resolvePeriod(args[1], 9);
                return this.calculateEMA(src, period);
            }

            if (exprStr.startsWith('ta.sma')) {
                const args = exprStr.match(/\((.*)\)/)?.[1]?.split(',') || [];
                const src = getShiftedSeries(args[0]) || closes;
                const period = resolvePeriod(args[1], 20);
                return this.calculateSMA(src, period);
            }

            if (exprStr.startsWith('ta.rsi')) {
                const args = exprStr.match(/\((.*)\)/)?.[1]?.split(',') || [];
                const src = getShiftedSeries(args[0]) || closes;
                const period = resolvePeriod(args[1], 14);
                return this.calculateRSI(src, period);
            }

            // 7. Base variable or shifted variable
            const shifted = getShiftedSeries(exprStr);
            if (shifted) {
                if (Array.isArray(shifted)) return shifted;
                if (typeof shifted === 'number') return new Array(n).fill(shifted);
                if (typeof shifted === 'boolean') return new Array(n).fill(shifted);
            }

            // 8. Number literal
            const num = parseFloat(exprStr);
            if (!isNaN(num)) {
                return new Array(n).fill(num);
            }

            return null;
        };

        for (let idx = 0; idx < lines.length; idx++) {
            const rawLine = lines[idx];
            const line = rawLine.trim();
            if (!line || line.startsWith('//') || line.startsWith('#')) continue;

            if (line.startsWith('if ') || line.startsWith('if(')) {
                const m = line.match(/if\s*\(?([^)]+)\)?/);
                if (m) currentIfCond = m[1].trim();
                continue;
            }

            if (rawLine.startsWith('    ') || rawLine.startsWith('\t')) {
                if (currentIfCond) {
                    if (line.includes('strategy.entry')) {
                        const m = line.match(/strategy\.entry\(\s*["']([^"']+)["']\s*,\s*([^,)]+)/);
                        if (m) {
                            strategyEntries.push({
                                id: m[1].trim(),
                                direction: m[2].trim(),
                                condition: currentIfCond
                            });
                        }
                    }
                }
                continue;
            } else {
                currentIfCond = null;
            }

            // Multi-variable unpack e.g. [st, dir] = ta.supertrend(...)
            if (line.startsWith('[') && line.includes(']') && line.includes('=')) {
                const [leftPart, rightPart] = line.split('=', 2);
                const vars = leftPart.replace('[', '').replace(']', '').split(',').map(v => v.trim());
                const right = rightPart.trim();
                if (right.includes('ta.supertrend')) {
                    const res = this.calculateSupertrend(highs, lows, closes);
                    if (vars[0]) env[vars[0]] = res.supertrend;
                    if (vars[1]) env[vars[1]] = res.direction;
                } else if (right.includes('ta.bb')) {
                    const res = this.calculateBollinger(closes);
                    if (vars[0]) env[vars[0]] = res.basis;
                    if (vars[1]) env[vars[1]] = res.upper;
                    if (vars[2]) env[vars[2]] = res.lower;
                }
                continue;
            }

            // Ignore alertcondition
            if (line.startsWith('alertcondition(')) {
                continue;
            }

            // Variable assignment
            if (line.includes('=') && !line.startsWith('plot') && !line.startsWith('strategy') && !line.startsWith('alertcondition')) {
                const [varNameRaw, exprRaw] = line.split('=', 2);
                const varName = varNameRaw.trim();
                const expr = exprRaw.trim();

                // 1. input.* calls: input.int(10, title="Lookback Period") or input.float or input(...)
                if (expr.startsWith('input')) {
                    const m = expr.match(/input(?:\.[a-zA-Z]+)?\(\s*([^,)]+)(?:,\s*(?:title\s*=\s*)?["']([^"']+)["'])?/);
                    let defVal = m ? m[1].trim() : '10';
                    let inputTitle = (m && m[2]) ? m[2].trim() : varName;
                    let parsedVal = parseFloat(defVal);
                    let inputType = 'int';
                    if (isNaN(parsedVal)) {
                        if (defVal.toLowerCase() === 'true') { parsedVal = true; inputType = 'bool'; }
                        else if (defVal.toLowerCase() === 'false') { parsedVal = false; inputType = 'bool'; }
                        else { parsedVal = defVal.replace(/['"]/g, ''); inputType = 'string'; }
                    } else {
                        inputType = Number.isInteger(parsedVal) ? 'int' : 'float';
                    }

                    // User customization override from settings modal
                    if (customInputs && customInputs[varName] !== undefined) {
                        parsedVal = customInputs[varName];
                    }

                    inputs[varName] = { id: varName, title: inputTitle, value: parsedVal, type: inputType, defVal: defVal };
                    env[varName] = parsedVal;
                    continue;
                }

                // General series / arithmetic / boolean expression evaluation
                env[varName] = evalSeriesExpr(expr);
                continue;
            }

            // plot()
            if (line.startsWith('plot(') || line.startsWith('plot ')) {
                const argsMatch = line.match(/plot\((.*)\)/);
                if (argsMatch) {
                    const inner = argsMatch[1];
                    const firstComma = inner.indexOf(',');
                    const seriesExpr = (firstComma > -1 ? inner.substring(0, firstComma) : inner).trim();
                    const titleMatch = line.match(/title\s*=\s*["']([^"']+)["']/) || line.match(/["']([^"']+)["']/);
                    const title = titleMatch ? titleMatch[1] : seriesExpr;

                    const colorParamMatch = line.match(/color\s*=\s*([a-zA-Z0-9_\.#]+)/);
                    let rawColor = colorParamMatch ? colorParamMatch[1].trim() : '';
                    let color = PINE_COLOR_MAP[rawColor] || rawColor || (plots.length === 0 ? '#f23645' : '#089981');

                    const lwMatch = line.match(/linewidth\s*=\s*(\d+)/);
                    let linewidth = lwMatch ? parseInt(lwMatch[1]) : 2;

                    const isStepline = line.includes('plot.style_stepline') || line.includes('style=plot.style_stepline');

                    // Custom style overrides from Settings modal
                    let isVisible = true;
                    if (customStyles && customStyles[title]) {
                        if (customStyles[title].color) color = customStyles[title].color;
                        if (customStyles[title].linewidth) linewidth = customStyles[title].linewidth;
                        if (customStyles[title].visible !== undefined) isVisible = customStyles[title].visible;
                    }

                    const dataSeries = evalSeriesExpr(seriesExpr);
                    if (dataSeries && Array.isArray(dataSeries) && isVisible) {
                        plots.push({
                            id: title,
                            title: title,
                            rawTitle: title,
                            color: color,
                            linewidth: linewidth,
                            style: isStepline ? 'stepline' : 'line',
                            visible: isVisible,
                            pane: 'main',
                            data: times.map((t, i) => ({ time: t, value: dataSeries[i] })).filter(d => d.value !== null && isFinite(d.value))
                        });
                    }
                }
                continue;
            }

            // plotshape()
            if (line.startsWith('plotshape(')) {
                const argsMatch = line.match(/plotshape\((.*)\)/);
                if (argsMatch) {
                    const inner = argsMatch[1];
                    const parts = inner.split(',');
                    const condName = parts[0].trim();
                    const condData = env[condName] || evalSeriesExpr(condName);
                    const titleMatch = line.match(/title\s*=\s*["']([^"']+)["']/);
                    const textMatch = line.match(/text\s*=\s*["']([^"']+)["']/);
                    const colorMatch = line.match(/color\s*=\s*([a-zA-Z0-9_\.#]+)/);
                    const rawCol = colorMatch ? colorMatch[1].trim() : '';
                    const color = PINE_COLOR_MAP[rawCol] || rawCol || '#ffaa00';
                    const isBelow = line.includes('location.belowbar') || line.includes('shape.triangleup');

                    if (condData && Array.isArray(condData)) {
                        for (let i = 0; i < n; i++) {
                            if (condData[i]) {
                                signals.push({
                                    time: times[i],
                                    type: isBelow ? 'BUY' : 'SELL',
                                    price: isBelow ? lows[i] * 0.998 : highs[i] * 1.002,
                                    label: textMatch ? textMatch[1] : (titleMatch ? titleMatch[1] : 'SIGNAL'),
                                    color: color,
                                    shape: isBelow ? 'triangleup' : 'triangledown'
                                });
                            }
                        }
                    }
                }
                continue;
            }
        }

        // Backtesting execution & signals
        const trades = [];
        let position = null;
        let equity = 10000.0;
        const initEquity = equity;
        let winCount = 0;

        for (let bar = 1; bar < n; bar++) {
            for (const rule of strategyEntries) {
                const condExpr = env[rule.condition] || rule.condition;
                const isTriggered = this.evalBarCondition(condExpr, env, bar);

                if (isTriggered) {
                    const isLong = rule.direction.toLowerCase().includes('long') || rule.direction.toLowerCase().includes('buy');
                    const sigType = isLong ? 'BUY' : 'SELL';
                    const sigColor = isLong ? '#00e676' : '#ff1744';

                    signals.push({
                        time: times[bar],
                        type: sigType,
                        price: closes[bar],
                        label: `${sigType} / ${rule.id}`,
                        color: sigColor
                    });

                    if (isLong) {
                        if (position && position.side === 'short') {
                            const pnl = (position.entry_price - closes[bar]) * 0.1;
                            equity += pnl;
                            trades.push({ type: 'CLOSE_SHORT', pnl: Math.round(pnl * 100) / 100, exit_price: closes[bar], time: times[bar] });
                            if (pnl > 0) winCount++;
                            position = null;
                        }
                        if (!position) {
                            position = { side: 'long', entry_price: closes[bar], bar: bar };
                        }
                    } else {
                        if (position && position.side === 'long') {
                            const pnl = (closes[bar] - position.entry_price) * 0.1;
                            equity += pnl;
                            trades.push({ type: 'CLOSE_LONG', pnl: Math.round(pnl * 100) / 100, exit_price: closes[bar], time: times[bar] });
                            if (pnl > 0) winCount++;
                            position = null;
                        }
                        if (!position) {
                            position = { side: 'short', entry_price: closes[bar], bar: bar };
                        }
                    }
                }
            }
        }

        const totalTrades = trades.length;
        const winRate = totalTrades > 0 ? Math.round((winCount / totalTrades) * 1000) / 10 : 0.0;
        const netProfit = Math.round((equity - initEquity) * 100) / 100;
        const netProfitPct = Math.round(((equity - initEquity) / initEquity) * 10000) / 100;

        return {
            scriptTitle,
            plots,
            inputs,
            signals,
            trades: trades.slice(0, 40),
            metrics: {
                initial_capital: initEquity,
                net_profit: netProfit,
                net_profit_pct: netProfitPct,
                total_trades: totalTrades,
                win_rate: winRate,
                winning_trades: winCount,
                losing_trades: totalTrades - winCount
            }
        };
    }

    static evalBarCondition(cond, env, bar) {
        if (!cond) return false;
        if (typeof cond === 'boolean') return cond;
        if (typeof cond !== 'string') return false;

        if (cond.includes(' and ')) {
            return cond.split(' and ').every(part => this.evalBarCondition(part.trim(), env, bar));
        }
        if (cond.includes(' or ')) {
            return cond.split(' or ').some(part => this.evalBarCondition(part.trim(), env, bar));
        }

        if (cond.startsWith('ta.crossover')) {
            const args = cond.match(/\((.*)\)/)?.[1]?.split(',') || [];
            const s1 = env[args[0]?.trim()];
            const s2 = env[args[1]?.trim()];
            if (s1 && s2 && bar > 0) {
                return (s1[bar] > s2[bar]) && (s1[bar - 1] <= s2[bar - 1]);
            }
            return false;
        }

        if (cond.startsWith('ta.crossunder')) {
            const args = cond.match(/\((.*)\)/)?.[1]?.split(',') || [];
            const s1 = env[args[0]?.trim()];
            const s2 = env[args[1]?.trim()];
            if (s1 && s2 && bar > 0) {
                return (s1[bar] < s2[bar]) && (s1[bar - 1] >= s2[bar - 1]);
            }
            return false;
        }

        for (const op of ['>=', '<=', '==', '!=', '>', '<']) {
            if (cond.includes(op)) {
                const [left, right] = cond.split(op, 2);
                const lVal = this.getBarVal(left.trim(), env, bar);
                const rVal = this.getBarVal(right.trim(), env, bar);
                if (lVal === null || rVal === null) return false;
                if (op === '>') return lVal > rVal;
                if (op === '<') return lVal < rVal;
                if (op === '>=') return lVal >= rVal;
                if (op === '<=') return lVal <= rVal;
                if (op === '==') return lVal === rVal;
                if (op === '!=') return lVal !== rVal;
            }
        }

        if (env[cond]) {
            const v = env[cond];
            return Array.isArray(v) ? Boolean(v[bar]) : Boolean(v);
        }

        return false;
    }

    static getBarVal(token, env, bar) {
        token = token.trim();
        let offset = 0;
        const idxMatch = token.match(/([^\[]+)\[(\d+)\]/);
        if (idxMatch) {
            token = idxMatch[1].trim();
            offset = parseInt(idxMatch[2]);
        }
        const b = bar - offset;
        if (b < 0) return null;

        if (env[token]) {
            const s = env[token];
            return Array.isArray(s) ? s[b] : parseFloat(s);
        }
        const num = parseFloat(token);
        return isNaN(num) ? null : num;
    }
}

class PineScriptIDE {
    constructor(editorElementId, chartInstance) {
        this.editorEl = document.getElementById(editorElementId);
        this.chart = chartInstance;
        this.autoTradeEnabled = false;
        this.currentResults = null;
        this.currentDiagnostic = null;
        this.customInputs = {};
        this.customStyles = {};
        this.activeIndicators = [];
        this.savedScripts = [];
        this.currentScriptId = null;

        this.init();
    }

    init() {
        if (!this.editorEl) return;
        // Default to EMA ribbon
        this.editorEl.value = PINE_TEMPLATES.ema_ribbon;

        // Bind Error Banner Buttons
        const closeDiagBtn = document.getElementById('btn-close-diag');
        if (closeDiagBtn) {
            closeDiagBtn.addEventListener('click', () => this.hideDiagnostic());
        }

        const autoFixBtn = document.getElementById('btn-autofix-diag');
        if (autoFixBtn) {
            autoFixBtn.addEventListener('click', () => this.applyAutoFix());
        }

        const addScriptBtn = document.getElementById('btn-add-script');
        if (addScriptBtn) {
            addScriptBtn.addEventListener('click', () => this.addNewScript());
        }

        const verifyBtn = document.getElementById('btn-verify-pine');
        if (verifyBtn) {
            verifyBtn.addEventListener('click', () => this.verifyScriptUI());
        }

        // Save Script Buttons & Modals
        const saveAsBtn = document.getElementById('btn-save-script-as');
        if (saveAsBtn) {
            saveAsBtn.addEventListener('click', () => this.openSaveScriptModal());
        }

        const confirmSaveBtn = document.getElementById('btn-confirm-save-script');
        if (confirmSaveBtn) {
            confirmSaveBtn.addEventListener('click', () => {
                const nameInp = document.getElementById('save-script-name-input');
                const name = (nameInp ? nameInp.value : '').trim();
                this.saveCurrentScript(name || "Custom Indicator");
            });
        }

        const cancelSaveBtn = document.getElementById('btn-cancel-save-script');
        const closeSaveBtn = document.getElementById('btn-close-save-modal');
        const saveBackdrop = document.getElementById('save-modal-backdrop');
        [cancelSaveBtn, closeSaveBtn, saveBackdrop].forEach(el => {
            if (el) el.addEventListener('click', () => this.closeSaveScriptModal());
        });

        const deleteSavedBtn = document.getElementById('btn-delete-saved-script');
        if (deleteSavedBtn) {
            deleteSavedBtn.addEventListener('click', () => this.deleteCurrentSavedScript());
        }

        // Add to Chart vs Replace Chart Buttons
        const addPineBtn = document.getElementById('btn-add-pine');
        if (addPineBtn) {
            addPineBtn.addEventListener('click', () => this.addCurrentScriptToChart());
        }

        const runPineBtn = document.getElementById('btn-run-pine');
        if (runPineBtn) {
            runPineBtn.addEventListener('click', () => this.replaceChartIndicators());
        }

        // Template & Saved Script Select Dropdown
        const templateSelect = document.getElementById('pine-template-select');
        if (templateSelect) {
            templateSelect.addEventListener('change', (e) => {
                this.handleScriptSelection(e.target.value);
            });
        }

        // Auto-Trade Checkbox
        const autoTradeCheck = document.getElementById('check-auto-trade');
        if (autoTradeCheck) {
            autoTradeCheck.addEventListener('change', (e) => {
                this.autoTradeEnabled = e.target.checked;
            });
        }

        // Ctrl+S / Cmd+S in editor opens save modal
        this.editorEl.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                this.openSaveScriptModal();
            }
        });

        // Load saved scripts from localStorage
        this.loadSavedScripts();
    }

    loadSavedScripts() {
        try {
            const raw = localStorage.getItem('openchart_user_scripts');
            this.savedScripts = raw ? JSON.parse(raw) : [];
        } catch (e) {
            this.savedScripts = [];
        }
        this.renderSavedScriptsDropdown();
    }

    renderSavedScriptsDropdown() {
        const groupEl = document.getElementById('pine-saved-scripts-group');
        const deleteBtn = document.getElementById('btn-delete-saved-script');
        if (!groupEl) return;

        groupEl.innerHTML = '';
        if (this.savedScripts && this.savedScripts.length) {
            groupEl.innerHTML = this.savedScripts.map(s => `
                <option value="user_${s.id}">${s.name}</option>
            `).join('');
        }

        const templateSelect = document.getElementById('pine-template-select');
        const isUserScript = templateSelect && templateSelect.value && templateSelect.value.startsWith('user_');
        if (deleteBtn) {
            deleteBtn.style.display = isUserScript ? 'inline-block' : 'none';
        }
    }

    openSaveScriptModal() {
        const modal = document.getElementById('save-script-modal');
        const input = document.getElementById('save-script-name-input');
        if (!modal) return;

        // Auto-detect title from script code
        let suggestedName = "My Indicator";
        const code = this.editorEl ? this.editorEl.value : '';
        const m = code.match(/(?:indicator|strategy)\(\s*["']([^"']+)["']/);
        if (m && m[1]) {
            suggestedName = m[1];
        }

        if (this.currentScriptId) {
            const existing = this.savedScripts.find(s => s.id === this.currentScriptId);
            if (existing) suggestedName = existing.name;
        }

        if (input) {
            input.value = suggestedName;
            setTimeout(() => {
                input.focus();
                input.select();
            }, 50);
        }

        modal.classList.remove('hidden');
    }

    closeSaveScriptModal() {
        const modal = document.getElementById('save-script-modal');
        if (modal) modal.classList.add('hidden');
    }

    saveCurrentScript(name) {
        if (!name) name = "My Script";
        const code = this.editorEl.value;

        // Check if updating existing or creating new
        let scriptItem = null;
        if (this.currentScriptId) {
            scriptItem = this.savedScripts.find(s => s.id === this.currentScriptId);
        }

        if (scriptItem) {
            scriptItem.name = name;
            scriptItem.code = code;
            scriptItem.inputs = Object.assign({}, this.customInputs);
            scriptItem.styles = Object.assign({}, this.customStyles);
            scriptItem.updatedAt = Date.now();
        } else {
            const newId = 'scr_' + Date.now().toString(36);
            scriptItem = {
                id: newId,
                name: name,
                code: code,
                inputs: Object.assign({}, this.customInputs),
                styles: Object.assign({}, this.customStyles),
                createdAt: Date.now()
            };
            this.savedScripts.push(scriptItem);
            this.currentScriptId = newId;
        }

        try {
            localStorage.setItem('openchart_user_scripts', JSON.stringify(this.savedScripts));
        } catch (e) {
            console.error("Failed to save scripts to localStorage:", e);
        }

        this.closeSaveScriptModal();
        this.renderSavedScriptsDropdown();

        // Select the saved script in dropdown
        const templateSelect = document.getElementById('pine-template-select');
        if (templateSelect) {
            templateSelect.value = `user_${scriptItem.id}`;
        }
        const deleteBtn = document.getElementById('btn-delete-saved-script');
        if (deleteBtn) deleteBtn.style.display = 'inline-block';

        this.showSuccessToast(`💾 Script "${name}" saved to your library!`);
    }

    deleteCurrentSavedScript() {
        if (!this.currentScriptId) return;
        const target = this.savedScripts.find(s => s.id === this.currentScriptId);
        const name = target ? target.name : 'this script';
        if (!confirm(`Are you sure you want to delete "${name}" from your saved scripts?`)) {
            return;
        }

        this.savedScripts = this.savedScripts.filter(s => s.id !== this.currentScriptId);
        try {
            localStorage.setItem('openchart_user_scripts', JSON.stringify(this.savedScripts));
        } catch (e) {}

        this.currentScriptId = null;
        this.renderSavedScriptsDropdown();

        const templateSelect = document.getElementById('pine-template-select');
        if (templateSelect) {
            templateSelect.value = 'ema_ribbon';
            this.loadTemplate('ema_ribbon');
        }
        this.showSuccessToast(`🗑 Deleted "${name}" from saved scripts.`);
    }

    handleScriptSelection(key) {
        if (!key) return;
        if (key.startsWith('user_')) {
            const sId = key.replace('user_', '');
            const script = this.savedScripts.find(s => s.id === sId);
            if (script) {
                this.currentScriptId = sId;
                this.editorEl.value = script.code;
                this.customInputs = Object.assign({}, script.inputs || {});
                this.customStyles = Object.assign({}, script.styles || {});
                this.hideDiagnostic();
                const deleteBtn = document.getElementById('btn-delete-saved-script');
                if (deleteBtn) deleteBtn.style.display = 'inline-block';
                return;
            }
        }

        this.currentScriptId = null;
        const deleteBtn = document.getElementById('btn-delete-saved-script');
        if (deleteBtn) deleteBtn.style.display = 'none';
        this.loadTemplate(key);
    }

    addNewScript() {
        this.currentScriptId = null;
        const boilerplate = `//@version=5
indicator("Simple Support Resistance", overlay=true)

length = input.int(10, title="Lookback Period")

resistance = ta.highest(high, length)
support = ta.lowest(low, length)

plot(resistance, title="Resistance", color=color.red, linewidth=2)
plot(support, title="Support", color=color.green, linewidth=2)
`;
        this.editorEl.value = boilerplate;
        this.customInputs = {};
        this.customStyles = {};
        this.hideDiagnostic();
        this.editorEl.focus();
        this.editorEl.setSelectionRange(0, 0);

        const deleteBtn = document.getElementById('btn-delete-saved-script');
        if (deleteBtn) deleteBtn.style.display = 'none';
    }

    loadTemplate(templateKey) {
        if (PINE_TEMPLATES[templateKey]) {
            this.editorEl.value = PINE_TEMPLATES[templateKey];
            this.customInputs = {};
            this.customStyles = {};
            this.hideDiagnostic();
        }
    }

    async verifyScript(code) {
        // Fast client-side pre-checks
        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const line = raw.trim();
            if (!line || line.startsWith('//') || line.startsWith('#')) continue;

            // Unbalanced parentheses
            const openP = (line.match(/\(/g) || []).length;
            const closeP = (line.match(/\)/g) || []).length;
            if (openP > closeP) {
                const missing = openP - closeP;
                return {
                    valid: false,
                    error: `Missing ${missing} closing parenthesis ')' on line ${i + 1}`,
                    line: i + 1,
                    line_text: raw,
                    hint: `Add ${missing} closing parenthesis ')' to complete the function call or condition.`,
                    suggestion: raw + ')'.repeat(missing)
                };
            }

            // Unbalanced brackets
            const openB = (line.match(/\[/g) || []).length;
            const closeB = (line.match(/\]/g) || []).length;
            if (openB > closeB) {
                const missing = openB - closeB;
                return {
                    valid: false,
                    error: `Missing ${missing} closing bracket ']' on line ${i + 1}`,
                    line: i + 1,
                    line_text: raw,
                    hint: `Close brackets ']' for series indexing (e.g. close[1]) or multi-variable unpacking.`,
                    suggestion: raw + ']'.repeat(missing)
                };
            }

            // Unterminated quotes
            const doubleQuotes = (line.match(/"/g) || []).length;
            if (doubleQuotes % 2 !== 0) {
                return {
                    valid: false,
                    error: `Unterminated string quote on line ${i + 1}`,
                    line: i + 1,
                    line_text: raw,
                    hint: `Ensure all text strings are enclosed with matching quotation marks (e.g. "Long").`,
                    suggestion: raw + '"'
                };
            }

            // Unknown technical indicator call check
            const taCalls = line.match(/ta\.[a-zA-Z0-9_]+/g);
            if (taCalls) {
                const known = ['ta.ema', 'ta.sma', 'ta.rsi', 'ta.bb', 'ta.supertrend', 'ta.macd', 'ta.atr', 'ta.highest', 'ta.lowest', 'ta.crossover', 'ta.crossunder', 'ta.stoch', 'ta.cci', 'ta.mfi', 'ta.wma', 'ta.vwma', 'ta.tr', 'ta.change', 'ta.cum', 'ta.falling', 'ta.rising', 'ta.valuewhen', 'ta.barssince'];
                for (let call of taCalls) {
                    if (!known.includes(call)) {
                        return {
                            valid: false,
                            error: `Unknown indicator function '${call}' on line ${i + 1}`,
                            line: i + 1,
                            line_text: raw,
                            hint: `Pine Script v5 provides ta.ema, ta.sma, ta.rsi, ta.bb, ta.supertrend, ta.macd, ta.atr, ta.highest, ta.lowest, ta.crossover, ta.crossunder.`,
                            suggestion: raw.replace(call, 'ta.ema')
                        };
                    }
                }
            }
        }

        // Backend deep verification
        try {
            const resp = await fetch('/api/pine/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code })
            });
            const data = await resp.json();
            return data;
        } catch (e) {
            return { valid: true };
        }
    }

    async verifyScriptUI() {
        const code = this.editorEl.value;
        const diag = await this.verifyScript(code);
        if (!diag.valid) {
            this.showDiagnostic(diag);
        } else {
            this.hideDiagnostic();
            this.showSuccessToast("✓ Script Code Verified: No Syntax Errors Found!");
        }
    }

    showDiagnostic(diag) {
        this.currentDiagnostic = diag;
        const banner = document.getElementById('pine-error-banner');
        if (!banner) return;

        document.getElementById('diag-error-title').textContent = "Syntax / Verification Error";
        document.getElementById('diag-line-pill').textContent = `Line ${diag.line || 1}`;
        document.getElementById('diag-line-info').textContent = diag.line_text ? `Line ${diag.line}: ${diag.line_text}` : `Line ${diag.line}`;
        document.getElementById('diag-error-msg').textContent = diag.error || "Syntax error detected in script.";
        document.getElementById('diag-error-hint').innerHTML = `💡 <b>How to fix:</b> ${diag.hint || 'Check parameter types and syntax balance.'}`;

        const autofixBtn = document.getElementById('btn-autofix-diag');
        if (autofixBtn) {
            autofixBtn.style.display = diag.suggestion ? 'inline-block' : 'none';
        }

        banner.classList.remove('hidden');

        // Scroll and highlight in textarea
        this.highlightErrorLine(diag.line);
    }

    hideDiagnostic() {
        this.currentDiagnostic = null;
        const banner = document.getElementById('pine-error-banner');
        if (banner) banner.classList.add('hidden');
    }

    applyAutoFix() {
        if (!this.currentDiagnostic || !this.currentDiagnostic.suggestion) return;
        const lineNum = this.currentDiagnostic.line;
        const lines = this.editorEl.value.split('\n');
        if (lineNum >= 1 && lineNum <= lines.length) {
            lines[lineNum - 1] = this.currentDiagnostic.suggestion;
            this.editorEl.value = lines.join('\n');
            this.hideDiagnostic();
            this.showSuccessToast("⚡ Auto-Fix Applied successfully! Re-verifying...");
            setTimeout(() => this.verifyScriptUI(), 300);
        }
    }

    highlightErrorLine(lineNum) {
        if (!lineNum) return;
        const lines = this.editorEl.value.split('\n');
        let startChar = 0;
        for (let i = 0; i < lineNum - 1 && i < lines.length; i++) {
            startChar += lines[i].length + 1;
        }
        const endChar = startChar + (lines[lineNum - 1] ? lines[lineNum - 1].length : 0);
        this.editorEl.focus();
        this.editorEl.setSelectionRange(startChar, endChar);
    }

    showSuccessToast(msg) {
        const banner = document.getElementById('pine-error-banner');
        if (!banner) return;
        document.getElementById('diag-error-title').textContent = "Script Verified";
        document.getElementById('diag-error-title').style.color = "#00e676";
        document.getElementById('diag-line-pill').textContent = "Clean";
        document.getElementById('diag-line-pill').style.borderColor = "rgba(0, 230, 118, 0.4)";
        document.getElementById('diag-line-pill').style.color = "#00e676";
        document.getElementById('diag-line-info').textContent = "All Pine Script v5 logic validated successfully.";
        document.getElementById('diag-error-msg').textContent = msg;
        document.getElementById('diag-error-hint').innerHTML = `💡 <b>Ready:</b> Click "▶ Compile & Run on Chart" to execute strategy.`;
        document.getElementById('btn-autofix-diag').style.display = 'none';
        banner.classList.remove('hidden');
        setTimeout(() => this.hideDiagnostic(), 3500);
    }

    async executeScript(pair, interval) {
        return this.addCurrentScriptToChart();
    }

    async addCurrentScriptToChart() {
        const code = this.editorEl.value;
        const currentPair = window.currentPair || 'B-BTC_USDT';
        const currentInterval = window.currentInterval || '1h';

        // 1. Verify syntax before executing
        const diag = await this.verifyScript(code);
        if (diag && !diag.valid) {
            this.showDiagnostic(diag);
            console.warn("[Pine IDE] Execution prevented due to verification error:", diag.error);
            return;
        }
        this.hideDiagnostic();

        // 2. Obtain current candles from active chart or app instance
        let candles = (this.chart && this.chart.candles) ? this.chart.candles : null;
        if ((!candles || !candles.length) && window.app) {
            candles = window.app.chart ? window.app.chart.candles : null;
        }

        if (!candles || !candles.length) {
            this.showDiagnostic({
                valid: false,
                error: "Candlestick data is loading. Please wait a moment and click Run again.",
                line: 1,
                line_text: "",
                hint: "Ensure candles are loaded on the active chart pane.",
                suggestion: ""
            });
            return;
        }

        // 3. Extract script title or fallback
        const metaMatch = code.match(/(?:indicator|strategy)\(\s*["']([^"']+)["']/);
        let title = metaMatch ? metaMatch[1] : 'Pine Indicator';
        if (this.currentScriptId) {
            const saved = this.savedScripts.find(s => s.id === this.currentScriptId);
            if (saved && saved.name) title = saved.name;
        }

        // 4. Instant client-side compile & run
        let result = null;
        try {
            result = ClientPineEngine.executeScript(code, candles, this.customInputs, this.customStyles);
        } catch (cErr) {
            console.warn("[Pine IDE] Client compiler error:", cErr);
        }

        // 5. Fallback backend compile if needed
        if (!result || result.error) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2500);
                const resp = await fetch('/api/pine/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pair: currentPair,
                        interval: currentInterval,
                        code: code
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (resp.ok) {
                    const data = await resp.json();
                    if (!data.error) result = data;
                }
            } catch (backendErr) {}
        }

        if (!result || (!result.plots && !result.signals)) {
            this.showDiagnostic({
                valid: false,
                error: "No plot lines or strategy signals were produced by this script.",
                line: 1,
                line_text: "",
                hint: "Ensure your script calls plot(...) or strategy.entry(...).",
                suggestion: ""
            });
            return;
        }

        this.currentResults = result;

        // 6. Add or update in activeIndicators collection
        let indEntry = this.activeIndicators.find(ind => ind.name === title || ind.id === this.currentScriptId);
        if (indEntry) {
            indEntry.name = title;
            indEntry.code = code;
            indEntry.plots = result.plots || [];
            indEntry.signals = result.signals || [];
            indEntry.inputs = result.inputs || {};
            indEntry.customInputs = Object.assign({}, this.customInputs);
            indEntry.customStyles = Object.assign({}, this.customStyles);
            indEntry.metrics = result.metrics;
            indEntry.trades = result.trades;
            indEntry.visible = true;
        } else {
            const indId = this.currentScriptId || ('ind_' + Date.now().toString(36));
            indEntry = {
                id: indId,
                name: title,
                code: code,
                plots: result.plots || [],
                signals: result.signals || [],
                inputs: result.inputs || {},
                customInputs: Object.assign({}, this.customInputs),
                customStyles: Object.assign({}, this.customStyles),
                metrics: result.metrics,
                trades: result.trades,
                visible: true
            };
            this.activeIndicators.push(indEntry);
        }

        if (this.autoTradeEnabled && result.signals && result.signals.length > 0) {
            const lastSig = result.signals[result.signals.length - 1];
            this.handleAutoTradeSignal(lastSig, currentPair);
        }

        this.updateBacktestUI(result.metrics, result.trades);
        this.applyActiveIndicatorsToChart();
        this.showSuccessToast(`✓ "${title}" added to chart!`);
    }

    replaceChartIndicators() {
        this.activeIndicators = [];
        this.addCurrentScriptToChart();
    }

    removeActiveIndicator(id) {
        this.activeIndicators = this.activeIndicators.filter(ind => ind.id !== id);
        this.applyActiveIndicatorsToChart();
    }

    toggleActiveIndicator(id) {
        const ind = this.activeIndicators.find(i => i.id === id);
        if (ind) {
            ind.visible = !ind.visible;
            this.applyActiveIndicatorsToChart();
        }
    }

    applyActiveIndicatorsToChart() {
        let combinedPlots = [];
        let combinedSignals = [];

        this.activeIndicators.forEach(ind => {
            if (ind.visible !== false) {
                if (ind.plots && Array.isArray(ind.plots)) {
                    combinedPlots = combinedPlots.concat(ind.plots);
                }
                if (ind.signals && Array.isArray(ind.signals)) {
                    combinedSignals = combinedSignals.concat(ind.signals);
                }
            }
        });

        // Apply to main chart
        if (this.chart) {
            this.chart.setIndicators(combinedPlots);
            this.chart.setSignals(combinedSignals);
        }

        // Apply to all chart panes in multi-chart layouts
        if (window.app && window.app.panes) {
            window.app.panes.forEach(pane => {
                if (pane.chart) {
                    pane.chart.setIndicators(combinedPlots);
                    pane.chart.setSignals(combinedSignals);
                }
            });
        }

        this.renderIndicatorLegend();
    }

    executeAllActiveIndicators(pair, interval) {
        if (!this.activeIndicators || !this.activeIndicators.length) return;

        let candles = (this.chart && this.chart.candles) ? this.chart.candles : null;
        if ((!candles || !candles.length) && window.app && window.app.chart) {
            candles = window.app.chart.candles;
        }
        if (!candles || !candles.length) return;

        this.activeIndicators.forEach(ind => {
            try {
                const res = ClientPineEngine.executeScript(ind.code, candles, ind.customInputs, ind.customStyles);
                if (res && !res.error) {
                    ind.plots = res.plots || [];
                    ind.signals = res.signals || [];
                    ind.inputs = res.inputs || ind.inputs;
                }
            } catch (e) {
                console.warn(`[Pine IDE] Failed to re-execute indicator ${ind.name}:`, e);
            }
        });

        this.applyActiveIndicatorsToChart();
    }

    handleAutoTradeSignal(signal, pair) {
        const now = Date.now();
        if (now - signal.time < 3600000) {
            const side = signal.type === 'BUY' ? 'buy' : 'sell';
            console.log(`[Pine Auto-Trader] Executing ${side.toUpperCase()} for ${pair} based on ${signal.label}`);
            
            if (window.app && window.app.placeOrder) {
                window.app.placeOrder({
                    symbol: pair,
                    side: side,
                    type: 'market',
                    quantity: 0.05,
                    source: 'pine_script'
                });
            }
        }
    }

    updateBacktestUI(metrics, trades) {
        if (!metrics) return;

        const netProfitEl = document.getElementById('bt-net-profit');
        const winRateEl = document.getElementById('bt-win-rate');
        const totalTradesEl = document.getElementById('bt-total-trades');
        const tradesListEl = document.getElementById('bt-trades-list');

        if (netProfitEl) {
            const isPos = metrics.net_profit >= 0;
            netProfitEl.innerHTML = `<span class="${isPos ? 'bullish' : 'bearish'}">${isPos ? '+' : ''}$${metrics.net_profit} (${metrics.net_profit_pct}%)</span>`;
        }
        if (winRateEl) {
            winRateEl.textContent = `${metrics.win_rate}% (${metrics.winning_trades}W / ${metrics.losing_trades}L)`;
        }
        if (totalTradesEl) {
            totalTradesEl.textContent = `${metrics.total_trades} Trades`;
        }

        if (tradesListEl && trades) {
            tradesListEl.innerHTML = trades.map((t, idx) => `
                <div class="trade-row">
                    <span>#${idx + 1} ${t.type}</span>
                    <span>$${t.exit_price.toFixed(2)}</span>
                    <span class="${t.pnl >= 0 ? 'bullish' : 'bearish'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl}</span>
                </div>
            `).join('');
        }
    }

    renderIndicatorLegend() {
        let legendEl = document.getElementById('indicator-legend-overlay');
        if (!legendEl) {
            legendEl = document.createElement('div');
            legendEl.id = 'indicator-legend-overlay';
            legendEl.className = 'indicator-legend-overlay';
            const container = document.getElementById('chart-container');
            if (container) container.appendChild(legendEl);
        }

        if (!this.activeIndicators || !this.activeIndicators.length) {
            legendEl.innerHTML = '';
            return;
        }

        legendEl.innerHTML = this.activeIndicators.map(ind => {
            const firstPlot = ind.plots && ind.plots[0];
            const dotColor = firstPlot ? (firstPlot.color || '#00f0ff') : '#00f0ff';
            const isVis = ind.visible !== false;
            return `
                <div class="ind-badge-item" data-id="${ind.id}">
                    <span class="ind-badge-dot" style="background: ${dotColor}; box-shadow: 0 0 6px ${dotColor};"></span>
                    <span class="ind-badge-name">${ind.name}</span>
                    <button class="ind-badge-action-btn ind-btn-gear" title="Advanced Indicator Settings (Inputs & Colors)" data-id="${ind.id}">⚙</button>
                    <button class="ind-badge-action-btn ind-btn-toggle" title="Toggle Visibility" data-id="${ind.id}">${isVis ? '👁' : '🚫'}</button>
                    <button class="ind-badge-action-btn ind-btn-remove" title="Remove Indicator" data-id="${ind.id}">✕</button>
                </div>
            `;
        }).join('');

        // Attach listeners for each badge
        legendEl.querySelectorAll('.ind-btn-gear').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const ind = this.activeIndicators.find(i => i.id === id);
                if (ind) this.openSettingsModal(ind);
            });
        });

        legendEl.querySelectorAll('.ind-btn-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                this.toggleActiveIndicator(id);
            });
        });

        legendEl.querySelectorAll('.ind-btn-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                this.removeActiveIndicator(id);
            });
        });
    }

    openSettingsModal(ind) {
        if (!ind) return;
        let modalEl = document.getElementById('indicator-settings-modal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'indicator-settings-modal';
            modalEl.className = 'indicator-settings-modal';
            document.body.appendChild(modalEl);
        }

        const scriptTitle = ind.name || 'Indicator';
        const inputs = ind.inputs || {};
        const plots = ind.plots || [];

        // Build Inputs HTML
        let inputsHtml = '';
        const inputKeys = Object.keys(inputs);
        if (inputKeys.length === 0) {
            inputsHtml = '<div class="settings-empty">No configurable inputs declared in this script.</div>';
        } else {
            inputsHtml = inputKeys.map(k => {
                const inp = inputs[k];
                const curVal = ind.customInputs[k] !== undefined ? ind.customInputs[k] : inp.value;
                if (inp.type === 'bool') {
                    return `
                        <div class="settings-row">
                            <label>${inp.title || k}</label>
                            <input type="checkbox" id="modal-inp-${k}" ${curVal ? 'checked' : ''}>
                        </div>
                    `;
                }
                return `
                    <div class="settings-row">
                        <label>${inp.title || k}</label>
                        <input type="number" id="modal-inp-${k}" value="${curVal}" step="${inp.type === 'float' ? '0.1' : '1'}">
                    </div>
                `;
            }).join('');
        }

        // Build Style HTML (Plots, Colors, Linewidths)
        let styleHtml = '';
        if (plots.length === 0) {
            styleHtml = '<div class="settings-empty">No plot lines generated.</div>';
        } else {
            styleHtml = plots.map((p, idx) => {
                const pTitle = p.rawTitle || p.title || `Plot ${idx + 1}`;
                const curStyle = ind.customStyles[pTitle] || {};
                const curColor = curStyle.color || p.color || '#00f0ff';
                const curWidth = curStyle.linewidth || p.linewidth || 2;
                const isVis = curStyle.visible !== false;

                return `
                    <div class="settings-plot-box">
                        <div class="settings-plot-header">
                            <label class="settings-checkbox-label">
                                <input type="checkbox" id="modal-style-vis-${idx}" ${isVis ? 'checked' : ''}>
                                <b>${pTitle}</b>
                            </label>
                        </div>
                        <div class="settings-plot-controls">
                            <div class="settings-ctrl-group">
                                <span>Color:</span>
                                <input type="color" id="modal-style-col-${idx}" value="${curColor.startsWith('#') ? curColor : '#00f0ff'}">
                            </div>
                            <div class="settings-ctrl-group">
                                <span>Line Width:</span>
                                <select id="modal-style-lw-${idx}">
                                    <option value="1" ${curWidth == 1 ? 'selected' : ''}>1px Thin</option>
                                    <option value="2" ${curWidth == 2 ? 'selected' : ''}>2px Medium</option>
                                    <option value="3" ${curWidth == 3 ? 'selected' : ''}>3px Thick</option>
                                    <option value="4" ${curWidth == 4 ? 'selected' : ''}>4px Bold</option>
                                </select>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        modalEl.innerHTML = `
            <div class="settings-modal-backdrop"></div>
            <div class="settings-modal-card">
                <div class="settings-modal-header">
                    <div class="settings-header-left">
                        <span class="settings-icon">⚙</span>
                        <h3>${scriptTitle} Settings</h3>
                    </div>
                    <button class="settings-close-btn" id="btn-close-settings-modal">✕</button>
                </div>
                <div class="settings-modal-tabs">
                    <button class="settings-tab-btn active" data-stab="stab-inputs">Inputs</button>
                    <button class="settings-tab-btn" data-stab="stab-style">Style</button>
                </div>
                <div class="settings-modal-body">
                    <div id="stab-inputs" class="settings-tab-content active">
                        ${inputsHtml}
                    </div>
                    <div id="stab-style" class="settings-tab-content">
                        ${styleHtml}
                    </div>
                </div>
                <div class="settings-modal-footer">
                    <button class="btn-secondary" id="btn-reset-ind-settings">Reset Defaults</button>
                    <div class="footer-right">
                        <button class="btn-secondary" id="btn-cancel-ind-settings">Cancel</button>
                        <button class="btn-primary" id="btn-apply-ind-settings">Apply Changes</button>
                    </div>
                </div>
            </div>
        `;

        modalEl.classList.add('show');

        // Tab Switching
        modalEl.querySelectorAll('.settings-tab-btn').forEach(tb => {
            tb.addEventListener('click', () => {
                modalEl.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
                modalEl.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
                tb.classList.add('active');
                modalEl.querySelector(`#${tb.dataset.stab}`)?.classList.add('active');
            });
        });

        const closeModal = () => modalEl.classList.remove('show');
        modalEl.querySelector('#btn-close-settings-modal')?.addEventListener('click', closeModal);
        modalEl.querySelector('#btn-cancel-ind-settings')?.addEventListener('click', closeModal);
        modalEl.querySelector('.settings-modal-backdrop')?.addEventListener('click', closeModal);

        modalEl.querySelector('#btn-reset-ind-settings')?.addEventListener('click', () => {
            ind.customInputs = {};
            ind.customStyles = {};
            closeModal();
            this.executeAllActiveIndicators();
        });

        modalEl.querySelector('#btn-apply-ind-settings')?.addEventListener('click', () => {
            // Collect Inputs
            inputKeys.forEach(k => {
                const el = modalEl.querySelector(`#modal-inp-${k}`);
                if (el) {
                    if (el.type === 'checkbox') {
                        ind.customInputs[k] = el.checked;
                    } else {
                        const val = parseFloat(el.value);
                        ind.customInputs[k] = isNaN(val) ? el.value : val;
                    }
                }
            });

            // Collect Styles
            plots.forEach((p, idx) => {
                const pTitle = p.rawTitle || p.title || `Plot ${idx + 1}`;
                const colEl = modalEl.querySelector(`#modal-style-col-${idx}`);
                const lwEl = modalEl.querySelector(`#modal-style-lw-${idx}`);
                const visEl = modalEl.querySelector(`#modal-style-vis-${idx}`);

                ind.customStyles[pTitle] = {
                    color: colEl ? colEl.value : p.color,
                    linewidth: lwEl ? parseInt(lwEl.value) : p.linewidth,
                    visible: visEl ? visEl.checked : true
                };
            });

            closeModal();
            this.executeAllActiveIndicators();
        });
    }
}

if (typeof window !== 'undefined') {
    window.ClientPineEngine = ClientPineEngine;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ClientPineEngine, PineEditor };
}
