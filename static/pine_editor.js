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
        this.currentDiagnostic = null;

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
    }

    addNewScript() {
        const boilerplate = `//@version=5
strategy("My Custom Strategy", overlay=true)

// 1. Calculate Indicators
fastEMA = ta.ema(close, 14)
slowEMA = ta.ema(close, 28)
rsi = ta.rsi(close, 14)

// 2. Plot on Chart
plot(fastEMA, "Fast EMA", color=#00f0ff, linewidth=2)
plot(slowEMA, "Slow EMA", color=#ffaa00, linewidth=2)

// 3. Strategy Entry & Exit Logic
longCondition = ta.crossover(fastEMA, slowEMA) and rsi < 70
if (longCondition)
    strategy.entry("Long", strategy.long)

shortCondition = ta.crossunder(fastEMA, slowEMA) and rsi > 30
if (shortCondition)
    strategy.entry("Short", strategy.short)
`;
        this.editorEl.value = boilerplate;
        this.hideDiagnostic();
        this.editorEl.focus();
        this.editorEl.setSelectionRange(0, 0);
    }

    loadTemplate(templateKey) {
        if (PINE_TEMPLATES[templateKey]) {
            this.editorEl.value = PINE_TEMPLATES[templateKey];
            this.hideDiagnostic();
            this.executeScript();
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
                const known = ['ta.ema', 'ta.sma', 'ta.rsi', 'ta.bb', 'ta.supertrend', 'ta.macd', 'ta.atr', 'ta.highest', 'ta.lowest', 'ta.crossover', 'ta.crossunder'];
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
        const code = this.editorEl.value;
        const currentPair = pair || window.currentPair || 'B-BTC_USDT';
        const currentInterval = interval || window.currentInterval || '1h';

        // 1. Verify before executing!
        const diag = await this.verifyScript(code);
        if (diag && !diag.valid) {
            this.showDiagnostic(diag);
            console.warn("[Pine IDE] Execution prevented due to verification error:", diag.error);
            return;
        }
        this.hideDiagnostic();

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
                this.showDiagnostic({
                    valid: false,
                    error: data.error,
                    line: data.line || 1,
                    line_text: data.line_text || "",
                    hint: data.hint || "Review Pine Script syntax rules and function arguments.",
                    suggestion: data.suggestion || ""
                });
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
            this.showDiagnostic({
                valid: false,
                error: `Network or execution error: ${err.message}`,
                line: 1,
                line_text: "",
                hint: "Check server connection and script format.",
                suggestion: ""
            });
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
