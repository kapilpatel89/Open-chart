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

class PineScriptIDE {
    constructor(editorElementId, chartInstance) {
        this.editorEl = document.getElementById(editorElementId);
        this.chart = chartInstance;
        this.autoTradeEnabled = false;
        this.currentResults = null;

        this.init();
    }

    init() {
        if (!this.editorEl) return;
        // Default to EMA ribbon
        this.editorEl.value = PINE_TEMPLATES.ema_ribbon;
    }

    loadTemplate(templateKey) {
        if (PINE_TEMPLATES[templateKey]) {
            this.editorEl.value = PINE_TEMPLATES[templateKey];
            this.executeScript();
        }
    }

    async executeScript(pair, interval) {
        const code = this.editorEl.value;
        const currentPair = pair || window.currentPair || 'B-BTC_USDT';
        const currentInterval = interval || window.currentInterval || '1h';

        try {
            const resp = await fetch('/api/pine/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pair: currentPair,
                    interval: currentInterval,
                    code: code
                })
            });

            const data = await resp.json();
            if (data.error) {
                console.error("Pine compilation error:", data.error);
                return;
            }

            this.currentResults = data;

            // Apply plots to chart
            if (data.plots) {
                this.chart.setIndicators(data.plots);
            }
            if (data.signals) {
                this.chart.setSignals(data.signals);

                // Auto-Trade Strategy: If last signal is new, trigger an order!
                if (this.autoTradeEnabled && data.signals.length > 0) {
                    const lastSig = data.signals[data.signals.length - 1];
                    this.handleAutoTradeSignal(lastSig, currentPair);
                }
            }

            // Update Backtester Results Panel in UI
            this.updateBacktestUI(data.metrics, data.trades);

        } catch (err) {
            console.error("Error running Pine Script:", err);
        }
    }

    handleAutoTradeSignal(signal, pair) {
        const now = Date.now();
        // Only if signal occurred on the most recent candle
        if (now - signal.time < 3600000) {
            const side = signal.type === 'BUY' ? 'buy' : 'sell';
            console.log(`[Pine Auto-Trader] Executing ${side.toUpperCase()} for ${pair} based on ${signal.label}`);
            
            // Dispatch order via main application
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
}
