/**
 * Main Application Controller - Open Chart
 * Handles OpenChart3D, Drawing Tools, Real-Time Indicators,
 * CoinDCX Live WebSocket, Order Execution with TP/SL Dragging,
 * Context Menu, and Pine Script v5 IDE.
 */

class OpenChartApp {
    constructor() {
        this.currentPair = 'B-BTC_USDT';
        this.currentInterval = '1h';
        this.ws = null;
        this.chart = null;
        this.pineIDE = null;
        this.portfolio = null;
        this.markets = [];
        this.activeContextPrice = 0;

        // Order Form State
        this.orderType = 'market';
        this.orderSide = 'buy';

        this.init();
    }

    async init() {
        window.app = this;
        window.currentPair = this.currentPair;
        window.currentInterval = this.currentInterval;

        // 1. Initialize 3D Candlestick Chart
        this.chart = new OpenChart3D('chart-canvas');
        
        // Connect interactive order drag callback
        this.chart.onOrderUpdate = (itemId, newTp, newSl) => {
            this.updateOrderTpSl(itemId, newTp, newSl);
        };

        // Connect right-click context menu
        this.chart.onContextMenuRequest = (clientX, clientY, price) => {
            this.showContextMenu(clientX, clientY, price);
        };

        // 2. Initialize Pine Script IDE
        this.pineIDE = new PineScriptIDE('pine-code-editor', this.chart);

        // 3. Setup UI Event Listeners
        this.bindEvents();

        // 4. Load Markets & Historical Candles
        await this.loadMarkets();
        await this.loadCandles();
        await this.loadPortfolio();
        this.startOrderBookPolling();

        // 5. Connect Real-time WebSocket
        this.connectWebSocket();

        // 6. Run default Pine Script
        setTimeout(() => {
            this.pineIDE.executeScript(this.currentPair, this.currentInterval);
        }, 600);
    }

    bindEvents() {
        // Coin Search Filter Input
        const searchInput = document.getElementById('market-search-input');
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toUpperCase().trim();
            const filtered = this.markets.filter(m => m.symbol.toUpperCase().includes(query) || m.name.toUpperCase().includes(query));
            this.populateCoinDropdown(filtered);
        });

        // Coin Selector Dropdown
        const coinSelect = document.getElementById('coin-select');
        coinSelect.addEventListener('change', (e) => {
            this.currentPair = e.target.value;
            window.currentPair = this.currentPair;
            this.onMarketChange();
        });

        // Timeframe Buttons
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentInterval = btn.dataset.tf;
                window.currentInterval = this.currentInterval;
                this.loadCandles();
            });
        });

        // Drawing Toolbar
        this.selectTool = (toolName) => {
            document.querySelectorAll('.drawing-toolbar .tool-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.tool === toolName);
            });
            this.chart.activeTool = toolName;
            this.chart.pendingDrawing = null;
        };

        document.querySelectorAll('.drawing-toolbar .tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectTool(btn.dataset.tool);
            });
        });

        document.getElementById('btn-clear-drawings').addEventListener('click', () => {
            this.chart.clearDrawings();
        });

        // Global Keyboard Shortcuts for Trading Tools
        window.addEventListener('keydown', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

            const k = e.key.toLowerCase();
            if (e.key === 'Escape' || k === 'q') {
                this.selectTool('cursor');
            } else if (k === 't') {
                this.selectTool('trendline');
            } else if (k === 'h') {
                this.selectTool('horizontal');
            } else if (k === 'v') {
                this.selectTool('vertical');
            } else if (k === 'f') {
                this.selectTool('fibonacci');
            } else if (k === 'r') {
                this.selectTool('rectangle');
            } else if (k === 'b') {
                this.selectTool('brush');
            } else if (e.key === 'Delete') {
                this.chart.clearDrawings();
            }
        });

        // Indicators Dropdown Menu Toggle
        const indBtn = document.getElementById('btn-indicators-menu');
        const indDropdown = document.getElementById('indicators-dropdown');
        indBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            indDropdown.classList.toggle('show');
        });

        window.addEventListener('click', () => {
            indDropdown.classList.remove('show');
            this.hideContextMenu();
        });

        // Quick Indicator Checkboxes
        ['ind-ema9', 'ind-ema21', 'ind-ema50', 'ind-ema200', 'ind-bb', 'ind-supertrend', 'ind-rsi'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this.applyQuickIndicators());
        });

        // Chart Floating Controls
        document.getElementById('btn-reset-view').addEventListener('click', () => this.chart.resetView());
        document.getElementById('btn-zoom-in').addEventListener('click', () => {
            this.chart.candleWidth = Math.min(60, this.chart.candleWidth * 1.25);
            this.chart.candleGap = Math.round(this.chart.candleWidth * 0.4);
            this.chart.render();
        });
        document.getElementById('btn-zoom-out').addEventListener('click', () => {
            this.chart.candleWidth = Math.max(3, this.chart.candleWidth * 0.8);
            this.chart.candleGap = Math.round(this.chart.candleWidth * 0.4);
            this.chart.render();
        });

        // Sidebar Tabs
        document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        // Bottom Dock Tabs
        document.querySelectorAll('.dock-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dock-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.dock-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.dock).classList.add('active');
                document.getElementById('bottom-dock').classList.remove('collapsed');
            });
        });

        // Dock Collapse Toggle
        document.getElementById('btn-dock-collapse').addEventListener('click', () => {
            const dock = document.getElementById('bottom-dock');
            dock.classList.toggle('collapsed');
            setTimeout(() => this.chart.resize(), 320);
        });

        // Order Type Toggle (Market vs Limit)
        document.getElementById('btn-order-type-market').addEventListener('click', () => {
            this.orderType = 'market';
            document.getElementById('btn-order-type-market').classList.add('active');
            document.getElementById('btn-order-type-limit').classList.remove('active');
            document.getElementById('limit-price-group').style.display = 'none';
        });

        document.getElementById('btn-order-type-limit').addEventListener('click', () => {
            this.orderType = 'limit';
            document.getElementById('btn-order-type-limit').classList.add('active');
            document.getElementById('btn-order-type-market').classList.remove('active');
            document.getElementById('limit-price-group').style.display = 'flex';
        });

        // Side Toggle (Buy vs Sell)
        const btnBuy = document.getElementById('btn-side-buy');
        const btnSell = document.getElementById('btn-side-sell');
        const submitBtn = document.getElementById('btn-submit-order');

        btnBuy.addEventListener('click', () => {
            this.orderSide = 'buy';
            btnBuy.classList.add('active');
            btnSell.classList.remove('active');
            submitBtn.className = 'submit-order-btn buy';
            submitBtn.textContent = 'PLACE BUY ORDER ON CHART';
            this.recalculateTpSlPreviews();
        });

        btnSell.addEventListener('click', () => {
            this.orderSide = 'sell';
            btnSell.classList.add('active');
            btnBuy.classList.remove('active');
            submitBtn.className = 'submit-order-btn sell';
            submitBtn.textContent = 'PLACE SELL ORDER ON CHART';
            this.recalculateTpSlPreviews();
        });

        // Percentage Buttons
        document.querySelectorAll('.pct-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const pct = parseInt(btn.dataset.pct, 10);
                const curPrice = this.getCurrentPrice();
                const balance = this.portfolio ? this.portfolio.balance : 10000;
                const notional = (balance * (pct / 100.0));
                const qty = curPrice > 0 ? (notional / curPrice) : 0.1;
                document.getElementById('order-quantity').value = qty.toFixed(3);
                this.recalculateTpSlPreviews();
            });
        });

        ['order-quantity', 'order-tp', 'order-sl'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.recalculateTpSlPreviews());
        });

        submitBtn.addEventListener('click', () => this.handleOrderSubmit());

        // Context Menu Action Handlers
        document.getElementById('ctx-limit-buy').addEventListener('click', () => {
            this.setupLimitOrder('buy', this.activeContextPrice);
        });
        document.getElementById('ctx-limit-sell').addEventListener('click', () => {
            this.setupLimitOrder('sell', this.activeContextPrice);
        });
        document.getElementById('ctx-set-tp').addEventListener('click', () => {
            document.getElementById('order-tp').value = this.activeContextPrice.toFixed(2);
            document.getElementById('check-tp').checked = true;
            this.recalculateTpSlPreviews();
        });
        document.getElementById('ctx-set-sl').addEventListener('click', () => {
            document.getElementById('order-sl').value = this.activeContextPrice.toFixed(2);
            document.getElementById('check-sl').checked = true;
            this.recalculateTpSlPreviews();
        });
        document.getElementById('ctx-reset-chart').addEventListener('click', () => {
            this.chart.resetView();
        });

        // Pine Template Dropdown
        document.getElementById('pine-template-select').addEventListener('change', (e) => {
            this.pineIDE.loadTemplate(e.target.value);
        });

        document.getElementById('btn-run-pine').addEventListener('click', () => {
            this.pineIDE.executeScript(this.currentPair, this.currentInterval);
        });

        document.getElementById('check-auto-trade').addEventListener('change', (e) => {
            this.pineIDE.autoTradeEnabled = e.target.checked;
        });

        // REA Agent Execution Button
        document.getElementById('btn-run-rea').addEventListener('click', () => this.handleRunReaAgent());

        // Header Quick Toggles
        document.getElementById('btn-toggle-pine').addEventListener('click', () => {
            const dock = document.getElementById('bottom-dock');
            dock.classList.remove('collapsed');
            document.querySelector('[data-dock="dock-pine"]').click();
        });

        document.getElementById('btn-toggle-order').addEventListener('click', () => {
            document.querySelector('[data-tab="tab-trade"]').click();
        });

        document.getElementById('btn-toggle-rea').addEventListener('click', () => {
            document.querySelector('[data-tab="tab-rea"]').click();
        });
    }

    getCurrentPrice() {
        if (this.chart && this.chart.candles.length) {
            return this.chart.candles[this.chart.candles.length - 1].close;
        }
        return 0;
    }

    async onMarketChange() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ action: 'subscribe', pair: this.currentPair }));
        }

        await this.loadCandles();
        this.recalculateTpSlPreviews();
        this.fetchOrderBook();
        this.pineIDE.executeScript(this.currentPair, this.currentInterval);
    }

    async loadMarkets() {
        try {
            const resp = await fetch('/api/markets');
            const data = await resp.json();
            if (Array.isArray(data) && data.length) {
                this.markets = data;
                this.populateCoinDropdown(data);
            }
        } catch (e) {
            console.error("Error loading CoinDCX markets:", e);
        }
    }

    populateCoinDropdown(marketList) {
        const coinSelect = document.getElementById('coin-select');
        coinSelect.innerHTML = marketList.slice(0, 100).map(m => `
            <option value="${m.symbol}" ${m.symbol === this.currentPair ? 'selected' : ''}>
                ${m.name} ($${m.last_price})
            </option>
        `).join('');
    }

    async loadCandles() {
        try {
            const url = `/api/candles?pair=${encodeURIComponent(this.currentPair)}&interval=${this.currentInterval}&limit=160`;
            const resp = await fetch(url);
            const candles = await resp.json();
            if (Array.isArray(candles) && candles.length) {
                this.chart.setCandles(candles);
                this.updateTickerHeader();
                this.recalculateTpSlPreviews();
                this.applyQuickIndicators();
            }
        } catch (e) {
            console.error("Error fetching CoinDCX candles:", e);
        }
    }

    applyQuickIndicators() {
        if (!this.chart || !this.chart.candles.length) return;
        const candles = this.chart.candles;
        const closes = candles.map(c => c.close);
        const times = candles.map(c => c.time);
        const indicators = [];

        // EMA 9
        if (document.getElementById('ind-ema9')?.checked) {
            const ema9 = this.calcEma(closes, 9);
            indicators.push({
                title: 'EMA 9',
                color: '#00f0ff',
                linewidth: 2,
                pane: 'main',
                data: times.map((t, i) => ({ time: t, value: ema9[i] })).filter(d => d.value !== null)
            });
        }

        // EMA 21
        if (document.getElementById('ind-ema21')?.checked) {
            const ema21 = this.calcEma(closes, 21);
            indicators.push({
                title: 'EMA 21',
                color: '#ffaa00',
                linewidth: 2,
                pane: 'main',
                data: times.map((t, i) => ({ time: t, value: ema21[i] })).filter(d => d.value !== null)
            });
        }

        // EMA 50
        if (document.getElementById('ind-ema50')?.checked) {
            const ema50 = this.calcEma(closes, 50);
            indicators.push({
                title: 'EMA 50',
                color: '#a855f7',
                linewidth: 2,
                pane: 'main',
                data: times.map((t, i) => ({ time: t, value: ema50[i] })).filter(d => d.value !== null)
            });
        }

        // EMA 200
        if (document.getElementById('ind-ema200')?.checked) {
            const ema200 = this.calcEma(closes, 200);
            indicators.push({
                title: 'EMA 200',
                color: '#ffd700',
                linewidth: 2,
                pane: 'main',
                data: times.map((t, i) => ({ time: t, value: ema200[i] })).filter(d => d.value !== null)
            });
        }

        // RSI
        if (document.getElementById('ind-rsi')?.checked) {
            const rsi = this.calcRsi(closes, 14);
            indicators.push({
                title: 'RSI 14',
                color: '#e040fb',
                pane: 'rsi',
                data: times.map((t, i) => ({ time: t, value: rsi[i] })).filter(d => d.value !== null)
            });
        }

        this.chart.setIndicators(indicators);
    }

    calcEma(data, period) {
        const k = 2 / (period + 1);
        const res = [data[0]];
        for (let i = 1; i < data.length; i++) {
            res.push((data[i] * k) + (res[i - 1] * (1 - k)));
        }
        return res;
    }

    calcRsi(data, period) {
        const res = new Array(data.length).fill(null);
        if (data.length <= period) return res;
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = data[i] - data[i - 1];
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        res[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

        for (let i = period + 1; i < data.length; i++) {
            const diff = data[i] - data[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            res[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
        }
        return res;
    }

    async loadPortfolio() {
        try {
            const resp = await fetch('/api/portfolio');
            const data = await resp.json();
            this.portfolio = data;
            this.updatePortfolioUI();
        } catch (e) {
            console.error("Error loading portfolio:", e);
        }
    }

    updatePortfolioUI() {
        if (!this.portfolio) return;

        document.getElementById('account-equity').textContent = `$${this.portfolio.equity.toLocaleString()}`;
        this.chart.setOrders(this.portfolio.open_orders, this.portfolio.open_positions);

        document.getElementById('badge-positions').textContent = this.portfolio.open_positions.length;
        document.getElementById('badge-orders').textContent = this.portfolio.open_orders.length;

        const posTbody = document.getElementById('positions-tbody');
        if (this.portfolio.open_positions.length === 0) {
            posTbody.innerHTML = '<tr><td colspan="9" class="empty-table">No open positions. Place an order or run a Pine Script strategy.</td></tr>';
        } else {
            posTbody.innerHTML = this.portfolio.open_positions.map(p => {
                const isPos = p.unrealized_pnl >= 0;
                return `
                    <tr>
                        <td><b>${p.symbol}</b></td>
                        <td class="${p.side === 'buy' ? 'bullish' : 'bearish'}"><b>${p.side.toUpperCase()}</b></td>
                        <td>${p.quantity}</td>
                        <td>$${p.entry_price.toFixed(2)}</td>
                        <td>$${p.current_price.toFixed(2)}</td>
                        <td class="bullish">${p.take_profit ? '$' + p.take_profit.toFixed(2) : '--'}</td>
                        <td class="bearish">${p.stop_loss ? '$' + p.stop_loss.toFixed(2) : '--'}</td>
                        <td class="${isPos ? 'bullish' : 'bearish'}"><b>${isPos ? '+' : ''}$${p.unrealized_pnl.toFixed(2)} (${p.unrealized_pnl_pct.toFixed(2)}%)</b></td>
                        <td><button class="btn-sm-danger" onclick="window.app.closePosition('${p.id}', '${p.symbol}')">Market Close</button></td>
                    </tr>
                `;
            }).join('');
        }

        const ordTbody = document.getElementById('orders-tbody');
        if (this.portfolio.open_orders.length === 0) {
            ordTbody.innerHTML = '<tr><td colspan="10" class="empty-table">No pending open orders.</td></tr>';
        } else {
            ordTbody.innerHTML = this.portfolio.open_orders.map(o => `
                <tr>
                    <td>${o.id}</td>
                    <td><b>${o.symbol}</b></td>
                    <td>${o.type.toUpperCase()}</td>
                    <td class="${o.side === 'buy' ? 'bullish' : 'bearish'}"><b>${o.side.toUpperCase()}</b></td>
                    <td>${o.quantity}</td>
                    <td>${o.price ? '$' + o.price.toFixed(2) : 'MARKET'}</td>
                    <td class="bullish">${o.take_profit ? '$' + o.take_profit.toFixed(2) : '--'}</td>
                    <td class="bearish">${o.stop_loss ? '$' + o.stop_loss.toFixed(2) : '--'}</td>
                    <td><span class="badge-status">${o.status}</span></td>
                    <td><button class="btn-sm-danger" onclick="window.app.cancelOrder('${o.id}')">Cancel</button></td>
                </tr>
            `).join('');
        }

        const histTbody = document.getElementById('history-tbody');
        if (this.portfolio.trade_history.length === 0) {
            histTbody.innerHTML = '<tr><td colspan="9" class="empty-table">No closed trade history yet.</td></tr>';
        } else {
            histTbody.innerHTML = this.portfolio.trade_history.map(h => {
                const isPos = h.realized_pnl >= 0;
                return `
                    <tr>
                        <td><b>${h.symbol}</b></td>
                        <td class="${h.side === 'buy' ? 'bullish' : 'bearish'}">${h.side.toUpperCase()}</td>
                        <td>${h.quantity}</td>
                        <td>$${h.entry_price.toFixed(2)}</td>
                        <td>$${h.exit_price.toFixed(2)}</td>
                        <td class="${isPos ? 'bullish' : 'bearish'}"><b>${isPos ? '+' : ''}$${h.realized_pnl.toFixed(2)}</b></td>
                        <td class="${isPos ? 'bullish' : 'bearish'}">${h.pnl_pct.toFixed(2)}%</td>
                        <td>${h.reason}</td>
                        <td>${h.source}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    showContextMenu(clientX, clientY, price) {
        this.activeContextPrice = price;
        const menu = document.getElementById('chart-context-menu');
        document.querySelectorAll('.ctx-price').forEach(el => el.textContent = price.toFixed(2));
        menu.style.top = `${clientY}px`;
        menu.style.left = `${clientX}px`;
        menu.classList.add('show');
    }

    hideContextMenu() {
        const menu = document.getElementById('chart-context-menu');
        if (menu) menu.classList.remove('show');
    }

    setupLimitOrder(side, price) {
        document.querySelector('[data-tab="tab-trade"]').click();
        document.getElementById('btn-order-type-limit').click();
        if (side === 'buy') {
            document.getElementById('btn-side-buy').click();
        } else {
            document.getElementById('btn-side-sell').click();
        }
        document.getElementById('order-price').value = price.toFixed(2);
        this.recalculateTpSlPreviews();
    }

    recalculateTpSlPreviews() {
        const curPrice = this.getCurrentPrice();
        if (curPrice <= 0) return;

        const tpInput = document.getElementById('order-tp');
        const slInput = document.getElementById('order-sl');
        const isBuy = this.orderSide === 'buy';

        if (!tpInput.value) {
            const tpPrice = isBuy ? curPrice * 1.025 : curPrice * 0.975;
            tpInput.value = tpPrice.toFixed(2);
        }
        if (!slInput.value) {
            const slPrice = isBuy ? curPrice * 0.99 : curPrice * 1.01;
            slInput.value = slPrice.toFixed(2);
        }

        const qty = parseFloat(document.getElementById('order-quantity').value) || 0.1;
        const tpVal = parseFloat(tpInput.value);
        const slVal = parseFloat(slInput.value);

        const tpDiff = isBuy ? (tpVal - curPrice) : (curPrice - tpVal);
        const slDiff = isBuy ? (curPrice - slVal) : (slVal - curPrice);

        const profit = tpDiff * qty;
        const loss = slDiff * qty;

        const profitPct = (tpDiff / curPrice) * 100;
        const lossPct = (slDiff / curPrice) * 100;

        document.getElementById('tp-profit-preview').textContent = `+$${profit.toFixed(2)} (+${profitPct.toFixed(1)}%)`;
        document.getElementById('sl-loss-preview').textContent = `-$${loss.toFixed(2)} (-${lossPct.toFixed(1)}%)`;

        const rr = loss > 0 ? (profit / loss).toFixed(2) : '∞';
        document.getElementById('rr-ratio').textContent = `${rr} : 1`;
    }

    updateTickerHeader() {
        const curPrice = this.getCurrentPrice();
        if (curPrice <= 0) return;

        document.getElementById('ticker-price').textContent = `$${curPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

        if (this.chart.candles.length > 1) {
            const first = this.chart.candles[0];
            const chg = ((curPrice - first.open) / first.open) * 100;
            const isPos = chg >= 0;
            const chgEl = document.getElementById('ticker-change');
            chgEl.textContent = `${isPos ? '+' : ''}${chg.toFixed(2)}%`;
            chgEl.className = `ticker-change ${isPos ? '' : 'bearish'}`;

            let high = -Infinity, low = Infinity, vol = 0;
            this.chart.candles.forEach(c => {
                if (c.high > high) high = c.high;
                if (c.low < low) low = c.low;
                vol += c.volume;
            });
            document.getElementById('ticker-high').textContent = `$${high.toFixed(2)}`;
            document.getElementById('ticker-low').textContent = `$${low.toFixed(2)}`;
            document.getElementById('ticker-vol').textContent = `${vol.toFixed(1)}`;
        }
    }

    async handleOrderSubmit() {
        const curPrice = this.getCurrentPrice();
        const qty = parseFloat(document.getElementById('order-quantity').value);
        if (!qty || qty <= 0) {
            alert("Please enter a valid quantity.");
            return;
        }

        const price = this.orderType === 'limit' ? parseFloat(document.getElementById('order-price').value) : curPrice;
        const checkTp = document.getElementById('check-tp').checked;
        const checkSl = document.getElementById('check-sl').checked;

        const tp = checkTp ? parseFloat(document.getElementById('order-tp').value) : null;
        const sl = checkSl ? parseFloat(document.getElementById('order-sl').value) : null;

        await this.placeOrder({
            symbol: this.currentPair,
            side: this.orderSide,
            order_type: this.orderType,
            quantity: qty,
            price: price,
            take_profit: tp,
            stop_loss: sl,
            source: 'manual'
        });
    }

    async placeOrder(orderPayload) {
        try {
            const resp = await fetch('/api/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderPayload)
            });
            const data = await resp.json();
            if (data.status === 'success') {
                this.portfolio = data.portfolio;
                this.updatePortfolioUI();
            }
        } catch (e) {
            console.error("Order error:", e);
        }
    }

    async updateOrderTpSl(itemId, takeProfit, stopLoss) {
        try {
            const resp = await fetch(`/api/orders/${itemId}/tpsl`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    take_profit: takeProfit,
                    stop_loss: stopLoss
                })
            });
            const data = await resp.json();
            if (data.status === 'success') {
                this.portfolio = data.portfolio;
                this.updatePortfolioUI();
            }
        } catch (e) {
            console.error("Error updating TP/SL:", e);
        }
    }

    async cancelOrder(orderId) {
        try {
            const resp = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
            const data = await resp.json();
            this.portfolio = data.portfolio;
            this.updatePortfolioUI();
        } catch (e) {
            console.error("Cancel order error:", e);
        }
    }

    async closePosition(posId, symbol) {
        try {
            const resp = await fetch(`/api/positions/${posId}/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: symbol })
            });
            const data = await resp.json();
            this.portfolio = data.portfolio;
            this.updatePortfolioUI();
        } catch (e) {
            console.error("Close position error:", e);
        }
    }

    startOrderBookPolling() {
        this.fetchOrderBook();
        setInterval(() => this.fetchOrderBook(), 2500);
    }

    async fetchOrderBook() {
        try {
            const resp = await fetch(`/api/orderbook?pair=${encodeURIComponent(this.currentPair)}`);
            const ob = await resp.json();
            this.renderOrderBook(ob);
        } catch (e) {}
    }

    renderOrderBook(ob) {
        if (!ob || !ob.bids || !ob.asks) return;

        const asksContainer = document.getElementById('ob-asks');
        const bidsContainer = document.getElementById('ob-bids');
        const midPriceEl = document.getElementById('ob-mid-price');

        const topAsks = ob.asks.slice(0, 8).reverse();
        const topBids = ob.bids.slice(0, 8);

        const maxQty = Math.max(
            ...topAsks.map(a => a[1]),
            ...topBids.map(b => b[1]),
            1.0
        );

        asksContainer.innerHTML = topAsks.map(([p, q]) => `
            <div class="ob-row">
                <div class="bar" style="width: ${(q / maxQty) * 100}%"></div>
                <span>${p.toFixed(2)}</span>
                <span>${q.toFixed(3)}</span>
                <span>${(p * q).toFixed(0)}</span>
            </div>
        `).join('');

        bidsContainer.innerHTML = topBids.map(([p, q]) => `
            <div class="ob-row">
                <div class="bar" style="width: ${(q / maxQty) * 100}%"></div>
                <span>${p.toFixed(2)}</span>
                <span>${q.toFixed(3)}</span>
                <span>${(p * q).toFixed(0)}</span>
            </div>
        `).join('');

        const curPrice = this.getCurrentPrice();
        midPriceEl.textContent = `$${curPrice.toFixed(2)}`;
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log("[WebSocket] Connected to Open Chart live feed");
            this.ws.send(JSON.stringify({ action: 'subscribe', pair: this.currentPair }));
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'tick') {
                    if (data.symbol === this.currentPair || data.symbol.replace("B-", "") === this.currentPair.replace("B-", "")) {
                        this.chart.updateCurrentCandle(data);
                        this.updateTickerHeader();
                    }

                    if (data.events && data.events.length > 0) {
                        data.events.forEach(ev => {
                            if (ev.event === 'position_closed') {
                                console.log(`[Alert] Position closed via ${ev.reason}: Realized PnL: $${ev.record.realized_pnl}`);
                            }
                        });
                        this.loadPortfolio();
                    }
                }
            } catch (e) {
                console.error("WS Parse error:", e);
            }
        };

        this.ws.onclose = () => {
            console.log("[WebSocket] Disconnected. Reconnecting in 2s...");
            setTimeout(() => this.connectWebSocket(), 2000);
        };
    }

    async handleRunReaAgent() {
        const tool = document.getElementById('rea-tool-select').value;
        const target = document.getElementById('rea-target-input').value;
        const outputEl = document.getElementById('rea-output-text');

        outputEl.textContent = `[REA Agent] Calling MCP tool "${tool}" with target: "${target}"...\nPlease wait...`;

        try {
            const resp = await fetch('/api/rea/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool_name: tool,
                    args: { target: target }
                })
            });
            const data = await resp.json();
            outputEl.textContent = JSON.stringify(data, null, 2);
        } catch (e) {
            outputEl.textContent = `[REA Agent Error] ${e.message}`;
        }
    }
}

window.OpenChartApp = OpenChartApp;
window.NexusApp = OpenChartApp;

window.addEventListener('DOMContentLoaded', () => {
    new OpenChartApp();
});
