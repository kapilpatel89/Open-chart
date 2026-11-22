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
        this.currentCandleStyle = 'normal';
        this.currentLayout = '1';
        this.panes = new Map();
        this.activePaneId = 0;
        this.ws = null;
        this.binanceWs = null;
        this.chart = null;
        this.pineIDE = null;
        this.portfolio = null;
        this.markets = [];
        this.activeContextPrice = 0;
        this.candleCache = new Map();
        this.lastBinanceTickTime = 0;
        this.watchdogInterval = null;

        // Order Form State
        this.orderType = 'market';
        this.orderSide = 'buy';

        this.init();
    }

    async init() {
        window.app = this;
        window.currentPair = this.currentPair;
        window.currentInterval = this.currentInterval;

        // 1. Initialize Main Candlestick Chart (Pane 0)
        this.chart = new OpenChart3D('chart-canvas', { candleStyle: this.currentCandleStyle, timeframe: this.currentInterval });
        
        this.chart.onOrderUpdate = (itemId, newTp, newSl) => {
            this.updateOrderTpSl(itemId, newTp, newSl);
        };

        this.attachChartContextMenu(this.chart, 0);

        // Register Pane 0
        this.panes.set(0, {
            id: 0,
            pair: this.currentPair,
            interval: this.currentInterval,
            chart: this.chart
        });

        // Click on pane 0 activates it; ensure right-click context menu always works
        const pane0El = document.getElementById('pane-0');
        if (pane0El) {
            pane0El.addEventListener('click', () => this.setActivePane(0));
            pane0El.addEventListener('contextmenu', (e) => {
                if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'canvas') return;
                e.preventDefault();
                e.stopPropagation();
                const curP = this.chart?.candles?.[this.chart.candles.length - 1]?.close || 100;
                this.showContextMenu(e.clientX, e.clientY, curP, this.chart, 0);
            });
        }

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
        this.startWatchdog();

        // 6. Run default Pine Script
        setTimeout(() => {
            this.pineIDE.executeScript(this.currentPair, this.currentInterval);
        }, 600);
    }

    bindEvents() {
        // Fast TradingView-Style Symbol Search & Selector
        this.setupSymbolSearchModal();
        const coinSelect = document.getElementById('coin-select');
        if (coinSelect) {
            coinSelect.addEventListener('change', (e) => {
                this.currentPair = e.target.value;
                window.currentPair = this.currentPair;
                this.updateSymbolTriggerDisplay();
                this.onMarketChange();
            });
        }

        // Timeframe Buttons with Instant Cache & Immediate Switch
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTimeframe(btn.dataset.tf);
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
        if (indBtn && indDropdown) {
            indBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                indDropdown.classList.toggle('show');
                candleDropdown?.classList.remove('show');
                layoutDropdown?.classList.remove('show');
            });
        }

        // Candle Style Dropdown Menu Toggle
        const candleBtn = document.getElementById('btn-candle-style-menu');
        const candleDropdown = document.getElementById('candle-style-dropdown');
        if (candleBtn && candleDropdown) {
            candleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                candleDropdown.classList.toggle('show');
                indDropdown?.classList.remove('show');
                layoutDropdown?.classList.remove('show');
            });

            document.querySelectorAll('#candle-style-dropdown .dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    const style = item.dataset.style;
                    this.setCandleStyle(style);
                    candleDropdown.classList.remove('show');
                });
            });
        }

        // Multi-Chart Layout Dropdown Menu Toggle
        const layoutBtn = document.getElementById('btn-layout-menu');
        const layoutDropdown = document.getElementById('layout-dropdown');
        if (layoutBtn && layoutDropdown) {
            layoutBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                layoutDropdown.classList.toggle('show');
                indDropdown?.classList.remove('show');
                candleDropdown?.classList.remove('show');
            });

            document.querySelectorAll('#layout-dropdown .dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    const layout = item.dataset.layout;
                    this.setLayout(layout);
                    layoutDropdown.classList.remove('show');
                });
            });
        }

        window.addEventListener('click', () => {
            if (indDropdown) indDropdown.classList.remove('show');
            if (candleDropdown) candleDropdown.classList.remove('show');
            if (layoutDropdown) layoutDropdown.classList.remove('show');
            this.hideContextMenu();
        });

        // Quick Indicator Checkboxes
        ['ind-ema9', 'ind-ema21', 'ind-ema50', 'ind-ema200', 'ind-bb', 'ind-supertrend', 'ind-rsi'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this.applyQuickIndicators());
        });

        // Chart Controls (Optional)
        document.getElementById('btn-reset-view')?.addEventListener('click', () => this.chart.resetView());
        document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
            this.chart.candleWidth = Math.min(60, this.chart.candleWidth * 1.25);
            this.chart.candleGap = Math.round(this.chart.candleWidth * 0.4);
            this.chart.render();
        });
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
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
                const dock = document.getElementById('bottom-dock');
                dock.classList.remove('hidden');
                dock.classList.remove('collapsed');
                setTimeout(() => this.chart.resize(), 320);
            });
        });

        // Dock Collapse Toggle
        document.getElementById('btn-dock-collapse').addEventListener('click', () => {
            const dock = document.getElementById('bottom-dock');
            dock.classList.toggle('collapsed');
            setTimeout(() => this.chart.resize(), 320);
        });

        // Dock Close / Hide Button
        const dockCloseBtn = document.getElementById('btn-dock-close');
        if (dockCloseBtn) {
            dockCloseBtn.addEventListener('click', () => {
                const dock = document.getElementById('bottom-dock');
                dock.classList.add('hidden');
                setTimeout(() => this.chart.resize(), 100);
            });
        }

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

        // Context Menu Action Handlers (All Charts Support)
        document.getElementById('ctx-limit-buy')?.addEventListener('click', () => {
            this.setupLimitOrder('buy', this.activeContextPrice);
            this.hideContextMenu();
        });
        document.getElementById('ctx-limit-sell')?.addEventListener('click', () => {
            this.setupLimitOrder('sell', this.activeContextPrice);
            this.hideContextMenu();
        });
        document.getElementById('ctx-set-tp')?.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.remove('hidden');
            document.querySelector('[data-tab="tab-trade"]')?.click();
            const tpEl = document.getElementById('order-tp');
            if (tpEl) tpEl.value = this.formatPrice(this.activeContextPrice);
            const chkTp = document.getElementById('check-tp');
            if (chkTp) chkTp.checked = true;
            this.recalculateTpSlPreviews();
            this.hideContextMenu();
        });
        document.getElementById('ctx-set-sl')?.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.remove('hidden');
            document.querySelector('[data-tab="tab-trade"]')?.click();
            const slEl = document.getElementById('order-sl');
            if (slEl) slEl.value = this.formatPrice(this.activeContextPrice);
            const chkSl = document.getElementById('check-sl');
            if (chkSl) chkSl.checked = true;
            this.recalculateTpSlPreviews();
            this.hideContextMenu();
        });
        document.getElementById('ctx-reset-chart')?.addEventListener('click', () => {
            const targetChart = this.activeContextChart || this.chart;
            targetChart.resetView();
            this.hideContextMenu();
        });
        document.getElementById('ctx-center-live')?.addEventListener('click', () => {
            const targetChart = this.activeContextChart || this.chart;
            if (targetChart && targetChart.centerOnLiveCandle) {
                targetChart.centerOnLiveCandle();
            }
            this.hideContextMenu();
        });
        document.getElementById('ctx-open-pine')?.addEventListener('click', () => {
            const dock = document.getElementById('bottom-dock');
            if (dock) {
                dock.classList.remove('hidden');
                dock.classList.remove('collapsed');
                document.querySelector('[data-dock="dock-pine"]')?.click();
            }
            this.hideContextMenu();
        });
        document.getElementById('ctx-clear-drawings')?.addEventListener('click', () => {
            const targetChart = this.activeContextChart || this.chart;
            targetChart.clearDrawings();
            this.hideContextMenu();
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

        // Fullscreen Toggle Feature
        const toggleFullscreen = () => {
            const fsBtn = document.getElementById('btn-fullscreen');
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => console.warn(err));
                if (fsBtn) fsBtn.innerHTML = '<span>🗗 Exit Fullscreen</span>';
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
                if (fsBtn) fsBtn.innerHTML = '<span>⛶ Fullscreen</span>';
            }
        };

        const fsBtn = document.getElementById('btn-fullscreen');
        if (fsBtn) {
            fsBtn.addEventListener('click', toggleFullscreen);
        }

        document.addEventListener('fullscreenchange', () => {
            const btn = document.getElementById('btn-fullscreen');
            if (btn) {
                btn.innerHTML = document.fullscreenElement ? '<span>🗗 Exit Fullscreen</span>' : '<span>⛶ Fullscreen</span>';
            }
            setTimeout(() => this.chart.resize(), 150);
        });

        // Header Quick Toggles
        document.getElementById('btn-toggle-pine').addEventListener('click', () => {
            const dock = document.getElementById('bottom-dock');
            if (dock.classList.contains('hidden')) {
                dock.classList.remove('hidden');
                dock.classList.remove('collapsed');
                document.querySelector('[data-dock="dock-pine"]').click();
                const codeEditor = document.getElementById('pine-code-editor');
                if (codeEditor) codeEditor.focus();
            } else {
                dock.classList.add('hidden');
            }
            setTimeout(() => this.chart.resize(), 150);
        });

        // Hideable / Collapsible Trade Panel
        document.getElementById('btn-toggle-order').addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('hidden');
                setTimeout(() => this.chart.resize(), 150);
            }
        });

        const closeSidebarBtn = document.getElementById('btn-close-sidebar');
        if (closeSidebarBtn) {
            closeSidebarBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                if (sidebar) {
                    sidebar.classList.add('hidden');
                    setTimeout(() => this.chart.resize(), 150);
                }
            });
        }
    }

    formatPrice(val) {
        if (val === null || val === undefined || !isFinite(val)) return '0.00';
        const abs = Math.abs(val);
        if (abs >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (abs >= 1) return val.toFixed(2);
        if (abs >= 0.01) return val.toFixed(4);
        if (abs >= 0.0001) return val.toFixed(6);
        return val.toFixed(8);
    }

    getCurrentPrice() {
        const clean = this.cleanSymbol(this.currentPair);
        const chartClean = this.chart && this.chart.symbol ? this.cleanSymbol(this.chart.symbol) : '';
        if (chartClean === clean && this.chart && this.chart.candles && this.chart.candles.length) {
            return this.chart.candles[this.chart.candles.length - 1].close;
        }
        return this.getKnownBasePrice(this.currentPair);
    }

    async onMarketChange() {
        if (!this.currentPair) return;

        // 1. Normalize pair to B-{BASE}_USDT format
        if (!this.currentPair.startsWith('B-') && this.currentPair.includes('USDT')) {
            const base = this.getCleanSymbol();
            this.currentPair = `B-${base}_USDT`;
        }
        window.currentPair = this.currentPair;
        const cleanSym = this.getCleanSymbol();

        // Synchronize active pane and pane 0 pair and symbol
        const targetPaneId = (this.activePaneId !== undefined && this.panes && this.panes.has(this.activePaneId))
            ? this.activePaneId : 0;
        if (this.panes && this.panes.has(targetPaneId)) {
            const p = this.panes.get(targetPaneId);
            p.pair = this.currentPair;
            if (p.chart) p.chart.symbol = cleanSym;
        }
        if (this.panes && this.panes.has(0)) {
            const p0 = this.panes.get(0);
            p0.pair = this.currentPair;
            if (p0.chart) p0.chart.symbol = cleanSym;
        }
        if (this.chart) {
            this.chart.symbol = cleanSym;
        }

        // Sync pane dropdown selector if present
        const activePaneEl = document.getElementById(`pane-${targetPaneId}`);
        if (activePaneEl) {
            const sel = activePaneEl.querySelector('.pane-coin-select');
            if (sel) sel.value = this.currentPair;
        }

        this.updateSymbolTriggerDisplay();

        const normInterval = this.currentInterval || '1h';
        const cacheKey = `${this.currentPair}_${normInterval}`;

        // 2. Instant Cache Switch (0ms butter-smooth chart swap)
        let hasCache = false;
        if (this.candleCache && this.candleCache.has(cacheKey)) {
            const cachedCandles = this.candleCache.get(cacheKey);
            if (cachedCandles && cachedCandles.length) {
                this.chart.setCandles(cachedCandles, true, normInterval, cleanSym);
                this.updateTickerHeader();
                this.recalculateTpSlPreviews();
                this.applyQuickIndicators();
                hasCache = true;
            }
        }
        if (!hasCache) {
            // Immediate zero-latency fallback candles accurately calibrated to this coin's price level
            const fallback = this.generateFallbackCandles(this.currentPair);
            this.chart.setCandles(fallback, true, normInterval, cleanSym);
            this.updateTickerHeader();
        }

        // 3. Immediately switch WebSocket subscriptions
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ action: 'subscribe', pair: this.currentPair }));
        }
        this.connectDirectBinanceWs();

        // 4. Fetch fresh candles with timeout safeguard (never freeze!)
        try {
            await this.loadCandles(true);
        } catch (e) {
            console.warn("Candle load error:", e);
        }

        // 5. Concurrently update orderbook and recompute all active Pine indicators non-blocking
        this.fetchOrderBook();
        this.recalculateTpSlPreviews();
        if (this.pineIDE) {
            if (typeof this.pineIDE.executeAllActiveIndicators === 'function') {
                this.pineIDE.executeAllActiveIndicators(this.currentPair, this.currentInterval);
            } else {
                this.pineIDE.executeScript(this.currentPair, this.currentInterval);
            }
        }
    }

    getCleanSymbol() {
        return (this.currentPair || 'BTC_USDT').replace('B-', '').replace('_USDT', '').replace('USDT', '').toUpperCase();
    }

    async loadMarkets() {
        // Built-in list of top major crypto assets for 0ms instantaneous display
        const defaultMarkets = [
            { symbol: "BTC_USDT", name: "BTC / USDT", last_price: "62000.00", change_24h: 1.25, volume: 145000 },
            { symbol: "ETH_USDT", name: "ETH / USDT", last_price: "2450.00", change_24h: -0.85, volume: 98000 },
            { symbol: "SOL_USDT", name: "SOL / USDT", last_price: "155.00", change_24h: 3.40, volume: 76000 },
            { symbol: "JCT_USDT", name: "JCT / USDT", last_price: "0.001582", change_24h: 3.20, volume: 112000000 },
            { symbol: "XRP_USDT", name: "XRP / USDT", last_price: "0.58", change_24h: 0.40, volume: 54000 },
            { symbol: "DOGE_USDT", name: "DOGE / USDT", last_price: "0.14", change_24h: 5.10, volume: 42000 },
            { symbol: "ADA_USDT", name: "ADA / USDT", last_price: "0.36", change_24h: 1.10, volume: 38000 },
            { symbol: "AVAX_USDT", name: "AVAX / USDT", last_price: "28.50", change_24h: 2.30, volume: 35000 },
            { symbol: "LINK_USDT", name: "LINK / USDT", last_price: "11.20", change_24h: -0.40, volume: 31000 },
            { symbol: "DOT_USDT", name: "DOT / USDT", last_price: "4.25", change_24h: 0.80, volume: 29000 },
            { symbol: "NEAR_USDT", name: "NEAR / USDT", last_price: "4.85", change_24h: 4.10, volume: 27000 },
            { symbol: "BNB_USDT", name: "BNB / USDT", last_price: "575.00", change_24h: 0.90, volume: 25000 },
            { symbol: "SUI_USDT", name: "SUI / USDT", last_price: "1.95", change_24h: 6.80, volume: 24000 },
            { symbol: "PEPE_USDT", name: "PEPE / USDT", last_price: "0.0000095", change_24h: 8.20, volume: 23000 },
            { symbol: "SHIB_USDT", name: "SHIB / USDT", last_price: "0.0000185", change_24h: 2.10, volume: 22000 },
            { symbol: "LTC_USDT", name: "LTC / USDT", last_price: "68.20", change_24h: -0.50, volume: 21000 },
            { symbol: "BCH_USDT", name: "BCH / USDT", last_price: "345.00", change_24h: 1.40, volume: 20000 },
            { symbol: "UNI_USDT", name: "UNI / USDT", last_price: "7.40", change_24h: -1.20, volume: 19000 },
            { symbol: "ATOM_USDT", name: "ATOM / USDT", last_price: "4.60", change_24h: 0.30, volume: 18000 },
            { symbol: "ICP_USDT", name: "ICP / USDT", last_price: "8.10", change_24h: 1.80, volume: 17500 },
            { symbol: "FIL_USDT", name: "FIL / USDT", last_price: "3.75", change_24h: -0.20, volume: 17000 },
            { symbol: "ARB_USDT", name: "ARB / USDT", last_price: "0.55", change_24h: 1.50, volume: 16500 },
            { symbol: "OP_USDT", name: "OP / USDT", last_price: "1.65", change_24h: 2.00, volume: 16000 },
            { symbol: "APT_USDT", name: "APT / USDT", last_price: "9.20", change_24h: 4.50, volume: 15500 },
            { symbol: "FTM_USDT", name: "FTM / USDT", last_price: "0.72", change_24h: 3.20, volume: 15000 },
            { symbol: "TIA_USDT", name: "TIA / USDT", last_price: "5.40", change_24h: -1.10, volume: 14500 },
            { symbol: "RENDER_USDT", name: "RENDER / USDT", last_price: "5.80", change_24h: 3.80, volume: 14000 },
            { symbol: "INJ_USDT", name: "INJ / USDT", last_price: "21.50", change_24h: 2.60, volume: 13500 },
            { symbol: "STX_USDT", name: "STX / USDT", last_price: "1.75", change_24h: 0.90, volume: 13000 },
            { symbol: "FET_USDT", name: "FET / USDT", last_price: "1.35", change_24h: 4.80, volume: 12500 },
            { symbol: "TAO_USDT", name: "TAO / USDT", last_price: "540.00", change_24h: 5.20, volume: 12000 },
            { symbol: "WIF_USDT", name: "WIF / USDT", last_price: "2.45", change_24h: 7.10, volume: 11500 },
            { symbol: "BONK_USDT", name: "BONK / USDT", last_price: "0.000022", change_24h: 3.90, volume: 11000 },
            { symbol: "FLOKI_USDT", name: "FLOKI / USDT", last_price: "0.00015", change_24h: 4.20, volume: 10500 },
            { symbol: "AAVE_USDT", name: "AAVE / USDT", last_price: "158.00", change_24h: 3.10, volume: 10000 },
            { symbol: "CRV_USDT", name: "CRV / USDT", last_price: "0.28", change_24h: 0.50, volume: 9500 },
            { symbol: "MKR_USDT", name: "MKR / USDT", last_price: "1280.00", change_24h: -0.60, volume: 9000 },
            { symbol: "LDO_USDT", name: "LDO / USDT", last_price: "1.15", change_24h: 1.70, volume: 8500 },
            { symbol: "GALA_USDT", name: "GALA / USDT", last_price: "0.022", change_24h: 2.40, volume: 8000 },
            { symbol: "SAND_USDT", name: "SAND / USDT", last_price: "0.26", change_24h: 0.80, volume: 7500 },
            { symbol: "MANA_USDT", name: "MANA / USDT", last_price: "0.29", change_24h: 1.10, volume: 7000 },
            { symbol: "CHZ_USDT", name: "CHZ / USDT", last_price: "0.065", change_24h: 0.40, volume: 6500 },
            { symbol: "AXS_USDT", name: "AXS / USDT", last_price: "4.85", change_24h: 1.30, volume: 6000 },
            { symbol: "THETA_USDT", name: "THETA / USDT", last_price: "1.30", change_24h: 0.90, volume: 5500 },
            { symbol: "ALGO_USDT", name: "ALGO / USDT", last_price: "0.12", change_24h: 0.70, volume: 5000 },
            { symbol: "VET_USDT", name: "VET / USDT", last_price: "0.023", change_24h: 1.00, volume: 4800 },
            { symbol: "XLM_USDT", name: "XLM / USDT", last_price: "0.095", change_24h: 0.60, volume: 4600 },
            { symbol: "KAS_USDT", name: "KAS / USDT", last_price: "0.13", change_24h: 2.80, volume: 4400 },
            { symbol: "BLUR_USDT", name: "BLUR / USDT", last_price: "0.24", change_24h: 1.50, volume: 4200 },
            { symbol: "SEI_USDT", name: "SEI / USDT", last_price: "0.42", change_24h: 3.60, volume: 4000 },
            { symbol: "JUP_USDT", name: "JUP / USDT", last_price: "0.95", change_24h: 4.10, volume: 3800 },
            { symbol: "PYTH_USDT", name: "PYTH / USDT", last_price: "0.34", change_24h: 2.20, volume: 3600 },
            { symbol: "WLD_USDT", name: "WLD / USDT", last_price: "2.10", change_24h: 5.40, volume: 3400 },
            { symbol: "STRK_USDT", name: "STRK / USDT", last_price: "0.41", change_24h: 1.20, volume: 3200 },
            { symbol: "DYDX_USDT", name: "DYDX / USDT", last_price: "1.05", change_24h: 0.80, volume: 3000 },
            { symbol: "RUNE_USDT", name: "RUNE / USDT", last_price: "5.10", change_24h: 2.50, volume: 2900 },
            { symbol: "ENS_USDT", name: "ENS / USDT", last_price: "17.20", change_24h: 3.30, volume: 2800 },
            { symbol: "NOT_USDT", name: "NOT / USDT", last_price: "0.0078", change_24h: 6.20, volume: 2700 },
            { symbol: "TON_USDT", name: "TON / USDT", last_price: "5.20", change_24h: 1.80, volume: 2600 }
        ];

        // 1. Check local storage cache for instant coin load
        try {
            const cached = localStorage.getItem('openchart_markets_cache');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 10) {
                    this.markets = parsed;
                    this.populateCoinDropdown(parsed);
                }
            }
        } catch(e) {}

        if (!this.markets || !this.markets.length) {
            this.markets = defaultMarkets;
            this.populateCoinDropdown(defaultMarkets);
        }

        // 2. Fetch fresh 24hr tickers from Binance CORS API or local server non-blocking
        try {
            const bResp = await fetch('https://api.binance.com/api/v3/ticker/24hr');
            if (bResp.ok) {
                const rawList = await bResp.json();
                if (Array.isArray(rawList) && rawList.length) {
                    const usdtTickers = rawList
                        .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('UP') && !t.symbol.includes('DOWN'))
                        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

                    const liveMarkets = usdtTickers.map(t => {
                        const base = t.symbol.replace('USDT', '');
                        const p = parseFloat(t.lastPrice);
                        return {
                            symbol: `${base}_USDT`,
                            name: `${base} / USDT`,
                            last_price: p >= 1 ? p.toFixed(2) : (p >= 0.01 ? p.toFixed(4) : p.toFixed(6)),
                            change_24h: parseFloat(t.priceChangePercent),
                            volume: parseFloat(t.quoteVolume)
                        };
                    });

                    // Ensure JCT / USDT is always present for search & selection
                    if (!liveMarkets.some(m => m.symbol === 'JCT_USDT')) {
                        try {
                            const mResp = await fetch('https://api.mexc.com/api/v3/ticker/24hr?symbol=JCTUSDT');
                            if (mResp.ok) {
                                const jct = await mResp.json();
                                if (jct && jct.symbol === 'JCTUSDT') {
                                    const p = parseFloat(jct.lastPrice);
                                    liveMarkets.push({
                                        symbol: 'JCT_USDT',
                                        name: 'JCT / USDT',
                                        last_price: p >= 1 ? p.toFixed(2) : (p >= 0.01 ? p.toFixed(4) : p.toFixed(6)),
                                        change_24h: parseFloat(jct.priceChangePercent),
                                        volume: parseFloat(jct.quoteVolume)
                                    });
                                }
                            }
                        } catch (mErr) {
                            liveMarkets.push({
                                symbol: 'JCT_USDT',
                                name: 'JCT / USDT',
                                last_price: '0.001582',
                                change_24h: 3.20,
                                volume: 112000000
                            });
                        }
                    }

                    if (liveMarkets.length > 20) {
                        this.markets = liveMarkets;
                        this.populateCoinDropdown(liveMarkets);
                        try {
                            localStorage.setItem('openchart_markets_cache', JSON.stringify(liveMarkets));
                        } catch(e) {}
                        return;
                    }
                }
            }
        } catch(e) {
            // Offline or rate-limited; fallback list is already smoothly rendered!
        }
    }

    setupSymbolSearchModal() {
        const trigger = document.getElementById('symbol-search-trigger');
        const modal = document.getElementById('symbol-search-modal');
        const backdrop = document.getElementById('symbol-modal-backdrop');
        const closeBtn = document.getElementById('symbol-modal-close');
        const input = document.getElementById('symbol-modal-input');
        const clearBtn = document.getElementById('symbol-input-clear');
        const listWrap = document.getElementById('symbol-list-wrap');
        const catBtns = document.querySelectorAll('.sym-cat-btn');

        if (!trigger || !modal) return;

        let activeCategory = 'all';

        const openModal = () => {
            modal.classList.remove('hidden');
            if (input) {
                input.value = '';
                setTimeout(() => input.focus(), 40);
            }
            renderSymbols();
        };

        const closeModal = () => {
            modal.classList.add('hidden');
        };

        trigger.addEventListener('click', openModal);
        if (backdrop) backdrop.addEventListener('click', closeModal);
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (input) {
                    input.value = '';
                    input.focus();
                    renderSymbols();
                }
            });
        }

        catBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                catBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeCategory = btn.dataset.cat || 'all';
                renderSymbols();
            });
        });

        if (input) {
            input.addEventListener('input', () => {
                renderSymbols();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeModal();
                else if (e.key === 'Enter') {
                    const firstRow = listWrap.querySelector('.sym-row');
                    if (firstRow) firstRow.click();
                }
            });
        }

        // Global hotkey: press '/' to open symbol search
        window.addEventListener('keydown', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
            if (e.key === '/') {
                e.preventDefault();
                openModal();
            }
        });

        const renderSymbols = () => {
            if (!listWrap) return;
            const q = (input ? input.value : '').trim().toUpperCase();
            let items = this.markets || [];

            // Category filtering
            if (activeCategory === 'top') {
                items = items.slice(0, 20);
            } else if (activeCategory === 'layer1') {
                const l1 = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'AVAX', 'NEAR', 'DOT', 'SUI', 'APT', 'TON', 'FTM'];
                items = items.filter(m => l1.includes(this.cleanSymbol(m.symbol)));
            } else if (activeCategory === 'defi') {
                const defi = ['UNI', 'AAVE', 'LINK', 'MKR', 'CRV', 'LDO', 'INJ', 'RUNE', 'DYDX', 'JUP', 'PYTH'];
                items = items.filter(m => defi.includes(this.cleanSymbol(m.symbol)));
            } else if (activeCategory === 'meme') {
                const meme = ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'NOT'];
                items = items.filter(m => meme.includes(this.cleanSymbol(m.symbol)));
            }

            // Search query filter
            if (q) {
                items = items.filter(m => {
                    const sym = (m.symbol || '').toUpperCase();
                    const nm = (m.name || '').toUpperCase();
                    const clean = this.cleanSymbol(m.symbol).toUpperCase();
                    return sym.includes(q) || nm.includes(q) || clean.includes(q);
                });
            }

            const cleanCur = this.cleanSymbol(this.currentPair);
            const cleanQ = q.replace(/[^A-Z0-9]/g, '');

            let customRowHtml = '';
            if (cleanQ && cleanQ.length >= 2 && !items.some(m => this.cleanSymbol(m.symbol) === cleanQ)) {
                customRowHtml = `
                    <div class="sym-row" data-symbol="${cleanQ}_USDT" style="background: rgba(0, 240, 255, 0.08); border-left: 3px solid #00f0ff;">
                        <div class="sym-left">
                            <span class="sym-badge" style="background: #00f0ff; color: #000; font-weight: bold;">⚡ OPEN</span>
                            <div class="sym-name-group">
                                <span class="sym-symbol" style="color: #00f0ff;">${cleanQ} / USDT</span>
                                <span class="sym-sub">Instant load symbol (Binance / MEXC)</span>
                            </div>
                        </div>
                        <div class="sym-right">
                            <span class="sym-chg pos">Direct Load →</span>
                        </div>
                    </div>
                `;
            }

            if (!items.length) {
                if (cleanQ && cleanQ.length >= 2) {
                    listWrap.innerHTML = customRowHtml;
                } else {
                    listWrap.innerHTML = `
                        <div style="padding: 30px; text-align: center; color: var(--text-secondary); font-size: 13px;">
                            No assets found matching "<b>${q}</b>".
                        </div>
                    `;
                    return;
                }
            } else {
                const listRowsHtml = items.slice(0, 150).map(m => {
                    const clean = this.cleanSymbol(m.symbol);
                    const isSelected = clean === cleanCur;
                    const chg = parseFloat(m.change_24h || 0);
                    const isPos = chg >= 0;
                    return `
                        <div class="sym-row ${isSelected ? 'selected' : ''}" data-symbol="${m.symbol}">
                            <div class="sym-left">
                                <span class="sym-badge">${clean}</span>
                                <div class="sym-name-group">
                                    <span class="sym-symbol">${clean} / USDT</span>
                                    <span class="sym-sub">${m.name || clean}</span>
                                </div>
                            </div>
                            <div class="sym-right">
                                <span class="sym-price">$${parseFloat(m.last_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
                                <span class="sym-chg ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}${chg.toFixed(2)}%</span>
                            </div>
                        </div>
                    `;
                }).join('');
                listWrap.innerHTML = customRowHtml + listRowsHtml;
            }

            // Click delegation for instant response (0ms)
            listWrap.querySelectorAll('.sym-row').forEach(row => {
                row.addEventListener('click', () => {
                    const sym = row.dataset.symbol;
                    if (sym) {
                        const clean = this.cleanSymbol(sym);
                        if (!this.markets.some(m => this.cleanSymbol(m.symbol) === clean)) {
                            this.markets.unshift({
                                symbol: sym,
                                name: `${clean} / USDT`,
                                last_price: "0.00",
                                change_24h: 0.0,
                                volume: 0
                            });
                        }
                        this.currentPair = sym;
                        window.currentPair = this.currentPair;
                        closeModal();
                        this.updateSymbolTriggerDisplay();
                        this.onMarketChange();
                    }
                });
            });
        };

        this.renderSymbolModalList = renderSymbols;
        this.updateSymbolTriggerDisplay();
    }

    updateSymbolTriggerDisplay() {
        const textEl = document.getElementById('symbol-display-text');
        const priceEl = document.getElementById('symbol-display-price');
        const clean = this.cleanSymbol(this.currentPair);
        if (textEl) {
            textEl.textContent = `${clean} / USDT`;
        }
        if (priceEl) {
            const curP = this.getCurrentPrice();
            priceEl.textContent = `($${this.formatPrice(curP)})`;
        }
    }

    populateCoinDropdown(marketList) {
        const coinSelect = document.getElementById('coin-select');
        if (coinSelect) {
            const currentClean = (this.currentPair || 'BTC_USDT').replace('B-', '').replace('_', '').toUpperCase();
            coinSelect.innerHTML = marketList.slice(0, 150).map(m => {
                const symClean = (m.symbol || '').replace('B-', '').replace('_', '').toUpperCase();
                const isSelected = symClean === currentClean;
                return `
                    <option value="${m.symbol}" ${isSelected ? 'selected' : ''}>
                        ${m.name} ($${m.last_price})
                    </option>
                `;
            }).join('');
        }
        if (typeof this.renderSymbolModalList === 'function') {
            this.renderSymbolModalList();
        }
        this.updateSymbolTriggerDisplay();
    }

    async switchTimeframe(interval) {
        if (!interval) return;
        const normInterval = interval.toLowerCase();
        this.currentInterval = normInterval;
        window.currentInterval = normInterval;

        const targetPaneId = (this.activePaneId !== undefined && this.panes && this.panes.has(this.activePaneId))
            ? this.activePaneId : 0;
        if (this.panes && this.panes.has(targetPaneId)) {
            const p = this.panes.get(targetPaneId);
            p.interval = normInterval;
            if (p.chart) p.chart.timeframe = normInterval;
        }

        // 1. Immediately update active timeframe UI button
        document.querySelectorAll('.tf-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tf.toLowerCase() === normInterval);
        });

        const cacheKey = `${this.currentPair}_${normInterval}`;

        // 2. Instant Cache Switch (0ms Immediate Chart Load)
        if (this.candleCache && this.candleCache.has(cacheKey)) {
            const cachedCandles = this.candleCache.get(cacheKey);
            this.chart.setCandles(cachedCandles, true, normInterval, this.cleanSymbol(this.currentPair));
            this.updateTickerHeader();
            this.recalculateTpSlPreviews();
            this.applyQuickIndicators();
            if (this.pineIDE) {
                if (typeof this.pineIDE.executeAllActiveIndicators === 'function') {
                    this.pineIDE.executeAllActiveIndicators(this.currentPair, this.currentInterval);
                } else {
                    this.pineIDE.executeScript(this.currentPair, this.currentInterval);
                }
            }
        }

        // 3. Fetch fresh update from Binance / CoinDCX API
        await this.loadCandles(true);

        // 4. Re-run all active Pine Script indicators with fresh data for this timeframe
        if (this.pineIDE) {
            if (typeof this.pineIDE.executeAllActiveIndicators === 'function') {
                this.pineIDE.executeAllActiveIndicators(this.currentPair, this.currentInterval);
            } else {
                this.pineIDE.executeScript(this.currentPair, this.currentInterval);
            }
        }
        this.renderPaneTrendBar(0);
    }

    calculateMultiTimeframeTrends(candles, baseTf = '1h') {
        const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
        const result = {};
        timeframes.forEach(tf => result[tf] = 'neutral');

        if (!candles || candles.length < 5) return result;

        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const n = closes.length;

        // Detect trend using EMA crossover & momentum slope
        const detectTrend = (cList, hList, lList) => {
            const len = cList.length;
            if (len < 5) return 'neutral';

            let emaFast = cList[0], emaSlow = cList[0];
            const kFast = 2 / (7 + 1);
            const kSlow = 2 / (18 + 1);
            for (let i = 1; i < len; i++) {
                emaFast = (cList[i] - emaFast) * kFast + emaFast;
                emaSlow = (cList[i] - emaSlow) * kSlow + emaSlow;
            }

            const lastClose = cList[len - 1];
            const recent = cList.slice(-5);
            const slope = (recent[recent.length - 1] - recent[0]) / (recent[0] || 1);

            // Strong Uptrend
            if (emaFast > emaSlow && lastClose >= emaFast && slope >= 0) return 'up';
            // Strong Downtrend
            if (emaFast < emaSlow && lastClose <= emaFast && slope <= 0) return 'down';

            // Mild Uptrend
            if (emaFast > emaSlow) return 'up';
            // Mild Downtrend
            if (emaFast < emaSlow) return 'down';

            return 'neutral';
        };

        const baseTrend = detectTrend(closes, highs, lows);
        result[baseTf] = baseTrend;

        const tfSeconds = {
            '1m': 60,
            '5m': 300,
            '15m': 900,
            '1h': 3600,
            '4h': 14400,
            '1d': 86400
        };

        const baseSec = tfSeconds[baseTf] || 3600;

        for (const tf of timeframes) {
            if (tf === baseTf) continue;
            const sec = tfSeconds[tf];

            if (sec < baseSec) {
                // Lower TF: use smaller subset of recent candles
                const count = Math.max(5, Math.min(25, Math.round(n * (sec / baseSec))));
                result[tf] = detectTrend(closes.slice(-count), highs.slice(-count), lows.slice(-count));
            } else {
                // Higher TF: aggregate bars
                const factor = Math.max(2, Math.round(sec / baseSec));
                const aggCloses = [];
                const aggHighs = [];
                const aggLows = [];
                for (let i = 0; i < n; i += factor) {
                    const cChunk = closes.slice(i, i + factor);
                    const hChunk = highs.slice(i, i + factor);
                    const lChunk = lows.slice(i, i + factor);
                    if (cChunk.length) {
                        aggCloses.push(cChunk[cChunk.length - 1]);
                        aggHighs.push(Math.max(...hChunk));
                        aggLows.push(Math.min(...lChunk));
                    }
                }
                result[tf] = aggCloses.length >= 5 ? detectTrend(aggCloses, aggHighs, aggLows) : baseTrend;
            }
        }

        return result;
    }

    renderPaneTrendBar(paneId = 0) {
        let container = document.getElementById(`pane-tf-trend-${paneId}`);
        if (!container) {
            const paneEl = document.getElementById(`pane-${paneId}`);
            if (paneEl) {
                container = document.createElement('div');
                container.className = 'pane-tf-trend-bar';
                container.id = `pane-tf-trend-${paneId}`;
                paneEl.appendChild(container);
            }
        }
        if (!container) return;

        const pane = this.panes?.get(paneId);
        const currentTf = (pane ? pane.interval : this.currentInterval) || '1h';
        const chart = pane ? pane.chart : this.chart;
        const candles = chart?.candles || [];

        const timeframes = [
            { tf: '1m', label: '1m' },
            { tf: '5m', label: '5m' },
            { tf: '15m', label: '15m' },
            { tf: '1h', label: '1H' },
            { tf: '4h', label: '4H' },
            { tf: '1d', label: '1D' }
        ];

        const trends = this.calculateMultiTimeframeTrends(candles, currentTf);

        container.innerHTML = timeframes.map(item => {
            const tr = trends[item.tf] || 'neutral';
            const isAct = item.tf.toLowerCase() === currentTf.toLowerCase();
            let icon = '▬';
            let titleText = `${item.label}: Sideways / Neutral`;
            if (tr === 'up') {
                icon = '▲';
                titleText = `${item.label}: Uptrend (Bullish)`;
            } else if (tr === 'down') {
                icon = '▼';
                titleText = `${item.label}: Downtrend (Bearish)`;
            }

            return `
                <button class="tf-trend-btn trend-${tr} ${isAct ? 'active' : ''}" 
                        data-tf="${item.tf}" 
                        data-pane="${paneId}" 
                        title="${titleText} • Click to switch timeframe">
                    <span class="tf-name">${item.label}</span>
                    <span class="tf-arrow">${icon}</span>
                </button>
            `;
        }).join('');

        container.querySelectorAll('.tf-trend-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tf = btn.dataset.tf;
                if (!tf) return;
                if (paneId === 0 || !this.panes || this.panes.size <= 1) {
                    this.switchTimeframe(tf);
                } else {
                    this.switchPaneTimeframe(paneId, tf);
                }
            });
        });
    }

    switchPaneTimeframe(paneId, tf) {
        const p = this.panes?.get(paneId);
        if (p) {
            p.interval = tf;
            p.chart.timeframe = tf;
            const tfSelect = document.getElementById(`pane-tf-${paneId}`);
            if (tfSelect) tfSelect.value = tf;
            this.loadPaneCandles(paneId);
            if (paneId === this.activePaneId) {
                this.currentInterval = tf;
                window.currentInterval = tf;
                document.querySelectorAll('.tf-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.tf.toLowerCase() === tf.toLowerCase());
                });
            }
        }
    }

    getKnownBasePrice(pair) {
        const clean = this.cleanSymbol(pair || this.currentPair);
        // 1. Look in markets list
        if (this.markets && this.markets.length) {
            const m = this.markets.find(x => this.cleanSymbol(x.symbol) === clean || (x.name && x.name.toUpperCase().includes(clean)));
            if (m && parseFloat(m.last_price) > 0) {
                return parseFloat(m.last_price);
            }
        }
        // 2. Fallback table for major assets
        const defaults = {
            'BTC': 62000.0,
            'ETH': 2450.0,
            'SOL': 155.0,
            'BNB': 575.0,
            'XRP': 0.58,
            'DOGE': 0.14,
            'ADA': 0.36,
            'AVAX': 28.5,
            'LINK': 11.2,
            'DOT': 4.25,
            'NEAR': 4.85,
            'JCT': 0.001582,
            'SUI': 1.95,
            'PEPE': 0.0000095,
            'SHIB': 0.0000185,
            'LTC': 68.2,
            'BCH': 345.0,
            'UNI': 7.4,
            'ATOM': 4.6,
            'ICP': 8.1,
            'FIL': 3.75,
            'ARB': 0.55,
            'OP': 1.65,
            'APT': 9.2,
            'FTM': 0.72,
            'TIA': 5.4,
            'RENDER': 5.8,
            'INJ': 21.5,
            'STX': 1.75,
            'FET': 1.35,
            'TAO': 540.0,
            'WIF': 2.45,
            'BONK': 0.000022,
            'FLOKI': 0.00015,
            'AAVE': 158.0,
            'CRV': 0.28,
            'MKR': 1280.0,
            'LDO': 1.15,
            'GALA': 0.022,
            'TON': 5.2
        };
        if (defaults[clean]) return defaults[clean];
        return 100.0;
    }

    generateFallbackCandles(targetPair = null, targetPrice = null) {
        const pair = targetPair || this.currentPair;
        const count = 100;
        const now = Date.now();
        const stepMs = 3600 * 1000;
        const baseP = (targetPrice && targetPrice > 0) ? targetPrice : this.getKnownBasePrice(pair);

        const candles = [];
        let cur = baseP * 0.96;
        for (let i = count; i >= 0; i--) {
            const t = now - (i * stepMs);
            const delta = (Math.random() - 0.48) * (cur * 0.008);
            const open = cur;
            const close = cur + delta;
            const high = Math.max(open, close) + Math.random() * (cur * 0.004);
            const low = Math.min(open, close) - Math.random() * (cur * 0.004);
            const vol = Math.random() * 50 + 10;
            candles.push({ time: t, open, high, low, close, volume: vol });
            cur = close;
        }
        if (candles.length) {
            candles[candles.length - 1].close = baseP;
            candles[candles.length - 1].high = Math.max(candles[candles.length - 1].high, baseP);
            candles[candles.length - 1].low = Math.min(candles[candles.length - 1].low, baseP);
        }
        return candles;
    }

    async loadCandles(forceReset = true) {
        try {
            const cacheKey = `${this.currentPair}_${this.currentInterval}`;
            let candles = null;

            // 1. Try local backend first with fast AbortController timeout (3.0s)
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                const url = `/api/candles?pair=${encodeURIComponent(this.currentPair)}&interval=${this.currentInterval}&limit=160`;
                const resp = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (resp.ok) {
                    const data = await resp.json();
                    if (Array.isArray(data) && data.length) {
                        candles = data;
                    }
                }
            } catch (err) {}

            // 2. Standalone / GitHub Pages Fallback: Direct Binance Open CORS API
            if (!candles || !candles.length) {
                const cleanSym = this.getCleanSymbol() + 'USDT';
                const bUrl = `https://api.binance.com/api/v3/klines?symbol=${cleanSym}&interval=${this.currentInterval}&limit=160`;
                try {
                    const bController = new AbortController();
                    const bTimeout = setTimeout(() => bController.abort(), 3000);
                    const bResp = await fetch(bUrl, { signal: bController.signal });
                    clearTimeout(bTimeout);
                    if (bResp.ok) {
                        const raw = await bResp.json();
                        if (Array.isArray(raw) && raw.length) {
                            candles = raw.map(k => ({
                                time: k[0],
                                open: parseFloat(k[1]),
                                high: parseFloat(k[2]),
                                low: parseFloat(k[3]),
                                close: parseFloat(k[4]),
                                volume: parseFloat(k[5])
                            }));
                        }
                    }
                } catch (bErr) {
                    console.warn("Direct Binance fallback failed:", bErr);
                }
            }

            // 2b. Secondary Fallback: Direct MEXC Open CORS API (for altcoins like JCT not listed on Binance spot)
            if (!candles || !candles.length) {
                const cleanSym = this.getCleanSymbol() + 'USDT';
                const mexcInterval = this.currentInterval === '1h' ? '60m' : (this.currentInterval === '4h' ? '4h' : (this.currentInterval === '1d' ? '1d' : this.currentInterval));
                const mUrl = `https://api.mexc.com/api/v3/klines?symbol=${cleanSym}&interval=${mexcInterval}&limit=160`;
                try {
                    const mController = new AbortController();
                    const mTimeout = setTimeout(() => mController.abort(), 3000);
                    const mResp = await fetch(mUrl, { signal: mController.signal });
                    clearTimeout(mTimeout);
                    if (mResp.ok) {
                        const raw = await mResp.json();
                        if (Array.isArray(raw) && raw.length) {
                            candles = raw.map(k => ({
                                time: k[0],
                                open: parseFloat(k[1]),
                                high: parseFloat(k[2]),
                                low: parseFloat(k[3]),
                                close: parseFloat(k[4]),
                                volume: parseFloat(k[5])
                            }));
                        }
                    }
                } catch (mErr) {
                    console.warn("Direct MEXC fallback failed:", mErr);
                }
            }

            // 3. Fallback: Generate synthetic smooth candles if completely offline/blocked
            if (!candles || !candles.length) {
                candles = this.generateFallbackCandles(this.currentPair);
            }

            if (candles && candles.length) {
                if (!this.candleCache) this.candleCache = new Map();
                this.candleCache.set(cacheKey, candles);

                this.chart.setCandles(candles, forceReset, this.currentInterval, this.cleanSymbol(this.currentPair));
                this.updateTickerHeader();
                this.recalculateTpSlPreviews();
                this.applyQuickIndicators();
                this.renderPaneTrendBar(0);
            }
        } catch (e) {
            console.error("Error loading candles:", e);
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

    formatPrice(price) {
        if (!isFinite(price) || price <= 0) return '0.00';
        if (price >= 100) return price.toFixed(2);
        if (price >= 1) return price.toFixed(2);
        if (price >= 0.01) return price.toFixed(4);
        return price.toFixed(6);
    }

    attachChartContextMenu(chartInstance, paneId) {
        if (!chartInstance) return;
        chartInstance.onContextMenuRequest = (clientX, clientY, price, chartRef) => {
            this.showContextMenu(clientX, clientY, price, chartRef || chartInstance, paneId);
        };
    }

    showContextMenu(clientX, clientY, price, chartInstance = null, paneId = null) {
        if (paneId !== null) {
            this.setActivePane(paneId);
        }
        const pObj = (paneId !== null && this.panes.has(paneId)) ? this.panes.get(paneId) : null;
        const pair = pObj ? pObj.pair : (this.currentPair || 'B-BTC_USDT');
        const cleanSym = this.cleanSymbol(pair);

        this.activeContextPrice = price;
        this.activeContextChart = chartInstance || this.chart;
        this.activeContextPaneId = paneId !== null ? paneId : this.activePaneId;
        this.activeContextPair = pair;

        const menu = document.getElementById('chart-context-menu');
        if (!menu) return;

        const titleEl = document.getElementById('ctx-header-title');
        if (titleEl) titleEl.textContent = `${cleanSym} / USDT`;

        const priceStr = this.formatPrice(price);
        document.querySelectorAll('.ctx-price').forEach(el => el.textContent = priceStr);

        // Screen boundary clamping so menu is never off-screen
        const menuW = 230;
        const menuH = 280;
        const posX = Math.max(10, Math.min(clientX, window.innerWidth - menuW - 10));
        const posY = Math.max(10, Math.min(clientY, window.innerHeight - menuH - 10));

        menu.style.top = `${posY}px`;
        menu.style.left = `${posX}px`;
        menu.classList.add('show');
    }

    hideContextMenu() {
        const menu = document.getElementById('chart-context-menu');
        if (menu) menu.classList.remove('show');
    }

    setupLimitOrder(side, price) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.remove('hidden');
            setTimeout(() => { if (this.activeContextChart) this.activeContextChart.resize(); }, 120);
        }

        if (this.activeContextPair && this.activeContextPair !== this.currentPair) {
            this.currentPair = this.activeContextPair;
            window.currentPair = this.currentPair;
            const coinSelect = document.getElementById('coin-select');
            if (coinSelect) coinSelect.value = this.currentPair;
            this.updateTickerHeader();
        }

        document.querySelector('[data-tab="tab-trade"]')?.click();
        document.getElementById('btn-order-type-limit')?.click();
        if (side === 'buy') {
            document.getElementById('btn-side-buy')?.click();
        } else {
            document.getElementById('btn-side-sell')?.click();
        }

        const priceEl = document.getElementById('order-price');
        if (priceEl) {
            priceEl.value = this.formatPrice(price);
        }
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

        const clean = this.cleanSymbol(this.currentPair);
        const chartClean = this.chart && this.chart.symbol ? this.cleanSymbol(this.chart.symbol) : '';

        const priceEl = document.getElementById('ticker-price');
        if (priceEl) {
            priceEl.textContent = `$${this.formatPrice(curPrice)}`;
        }

        if (this.chart && this.chart.candles.length > 1 && (!chartClean || chartClean === clean)) {
            const first = this.chart.candles[0];
            const chg = ((curPrice - first.open) / first.open) * 100;
            const isPos = chg >= 0;
            const chgEl = document.getElementById('ticker-change');
            if (chgEl) {
                chgEl.textContent = `${isPos ? '+' : ''}${chg.toFixed(2)}%`;
                chgEl.className = `ticker-change ${isPos ? '' : 'bearish'}`;
            }

            let high = -Infinity, low = Infinity, vol = 0;
            this.chart.candles.forEach(c => {
                if (c.high > high) high = c.high;
                if (c.low < low) low = c.low;
                vol += c.volume;
            });
            const highEl = document.getElementById('ticker-high');
            const lowEl = document.getElementById('ticker-low');
            const volEl = document.getElementById('ticker-vol');
            if (highEl) highEl.textContent = `$${this.formatPrice(high)}`;
            if (lowEl) lowEl.textContent = `$${this.formatPrice(low)}`;
            if (volEl) volEl.textContent = `${vol.toFixed(1)}`;
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


    setCandleStyle(style) {
        if (!style) return;
        this.currentCandleStyle = style;
        
        // Update all pane charts
        this.panes.forEach(p => {
            if (p.chart && p.chart.setCandleStyle) {
                p.chart.setCandleStyle(style);
            }
        });

        // Update UI pill label
        const labelEl = document.getElementById('selected-candle-style');
        if (labelEl) {
            if (style === 'hollow') labelEl.innerHTML = '⚪ Hollow ▾';
            else if (style === '3d') labelEl.innerHTML = '◈ 3D ▾';
            else labelEl.innerHTML = '🕯 Normal ▾';
        }

        document.querySelectorAll('#candle-style-dropdown .dropdown-item').forEach(el => {
            el.classList.toggle('active', el.dataset.style === style);
        });
    }

    setLayout(layout) {
        if (!layout) return;
        this.currentLayout = layout;

        const grid = document.getElementById('multi-chart-grid');
        if (!grid) return;

        grid.className = `multi-chart-grid layout-${layout}`;

        // Determine which pane IDs should be active
        let targetPaneIds = [0];
        if (layout === '2h' || layout === '2v') {
            targetPaneIds = [0, 1];
        } else if (layout === '4') {
            targetPaneIds = [0, 1, 2, 3];
        }

        // Update dropdown label & active class
        const labelMap = { '1': '◫ Layout (1) ▾', '2h': '❚❚ 2 Split (H) ▾', '2v': '〓 2 Stack (V) ▾', '4': '▦ 4 Quad ▾' };
        const lblEl = document.getElementById('selected-layout-label');
        if (lblEl) lblEl.textContent = labelMap[layout] || '◫ Layout ▾';

        document.querySelectorAll('#layout-dropdown .dropdown-item').forEach(item => {
            item.classList.toggle('active', item.dataset.layout === layout);
        });

        // Default coins for multi-panes
        const defaultPairs = {
            0: this.currentPair || 'B-BTC_USDT',
            1: 'B-ETH_USDT',
            2: 'B-SOL_USDT',
            3: 'B-XRP_USDT'
        };

        // Create or show target panes
        targetPaneIds.forEach(id => {
            let paneEl = document.getElementById(`pane-${id}`);
            if (!paneEl) {
                paneEl = document.createElement('div');
                paneEl.className = 'chart-pane';
                paneEl.id = `pane-${id}`;
                paneEl.dataset.paneId = id;

                const defaultPair = defaultPairs[id] || 'B-BTC_USDT';
                const defaultTf = id === 0 ? this.currentInterval : (id === 1 ? '15m' : (id === 2 ? '5m' : '4h'));

                // Header Overlay with Coin & Timeframe Selectors
                paneEl.innerHTML = `
                    <div class="pane-header-overlay">
                        <span class="pane-active-dot"></span>
                        <select class="pane-coin-badge" id="pane-coin-${id}"></select>
                        <select class="pane-tf-select" id="pane-tf-${id}">
                            <option value="1m" ${defaultTf === '1m' ? 'selected' : ''}>1m</option>
                            <option value="5m" ${defaultTf === '5m' ? 'selected' : ''}>5m</option>
                            <option value="15m" ${defaultTf === '15m' ? 'selected' : ''}>15m</option>
                            <option value="1h" ${defaultTf === '1h' ? 'selected' : ''}>1H</option>
                            <option value="4h" ${defaultTf === '4h' ? 'selected' : ''}>4H</option>
                            <option value="1d" ${defaultTf === '1d' ? 'selected' : ''}>1D</option>
                        </select>
                        <button class="pane-action-btn" title="Auto Scale">⟲</button>
                    </div>
                    <div class="pane-tf-trend-bar" id="pane-tf-trend-${id}"></div>
                    <canvas id="chart-canvas-${id}"></canvas>
                `;

                grid.appendChild(paneEl);

                // Populate Coin Selector
                const selectEl = paneEl.querySelector('.pane-coin-badge');
                if (selectEl && this.markets.length) {
                    selectEl.innerHTML = this.markets.slice(0, 100).map(m => `
                        <option value="${m.symbol}" ${m.symbol === defaultPair ? 'selected' : ''}>${m.name}</option>
                    `).join('');
                }

                // Initialize OpenChart3D instance for this pane
                const canvasEl = document.getElementById(`chart-canvas-${id}`);
                const paneChart = new OpenChart3D(canvasEl, {
                    candleStyle: this.currentCandleStyle,
                    timeframe: defaultTf
                });

                this.attachChartContextMenu(paneChart, id);

                this.panes.set(id, {
                    id: id,
                    pair: defaultPair,
                    interval: defaultTf,
                    chart: paneChart
                });

                // Bind events for this pane
                paneEl.addEventListener('click', () => this.setActivePane(id));
                paneEl.addEventListener('contextmenu', (e) => {
                    if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'canvas') return;
                    e.preventDefault();
                    e.stopPropagation();
                    const p = this.panes.get(id);
                    const curP = p?.chart?.candles?.[p.chart.candles.length - 1]?.close || 100;
                    this.showContextMenu(e.clientX, e.clientY, curP, p?.chart, id);
                });
                selectEl.addEventListener('change', (e) => {
                    const p = this.panes.get(id);
                    if (p) {
                        p.pair = e.target.value;
                        this.loadPaneCandles(id);
                        this.connectDirectBinanceWs();
                        if (id === this.activePaneId) {
                            this.currentPair = p.pair;
                            window.currentPair = p.pair;
                            this.updateTickerHeader();
                        }
                    }
                });

                const tfSelect = paneEl.querySelector('.pane-tf-select');
                tfSelect.addEventListener('change', (e) => {
                    const p = this.panes.get(id);
                    if (p) {
                        p.interval = e.target.value;
                        p.chart.timeframe = p.interval;
                        this.loadPaneCandles(id);
                        if (id === this.activePaneId) {
                            this.currentInterval = p.interval;
                            window.currentInterval = p.interval;
                            document.querySelectorAll('.tf-btn').forEach(b => {
                                b.classList.toggle('active', b.dataset.tf.toLowerCase() === p.interval.toLowerCase());
                            });
                        }
                    }
                });

                paneEl.querySelector('.pane-action-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    paneChart.resetView();
                });

                // Load initial candles for this pane
                this.loadPaneCandles(id);
            } else {
                paneEl.style.display = 'flex';
            }
        });

        // Hide panes that are not part of current layout
        [0, 1, 2, 3].forEach(id => {
            if (!targetPaneIds.includes(id)) {
                const pEl = document.getElementById(`pane-${id}`);
                if (pEl) pEl.style.display = 'none';
            }
        });

        // Ensure active pane is in target
        if (!targetPaneIds.includes(this.activePaneId)) {
            this.setActivePane(0);
        } else {
            this.setActivePane(this.activePaneId);
        }

        // Trigger resize on all visible panes
        setTimeout(() => {
            targetPaneIds.forEach(id => {
                const p = this.panes.get(id);
                if (p && p.chart) p.chart.resize();
            });
        }, 150);

        // Update multi-stream WebSocket connection for all active coins
        this.connectDirectBinanceWs();
    }

    setActivePane(paneId) {
        this.activePaneId = paneId;
        const pane = this.panes.get(paneId);
        if (!pane) return;

        // Visual outline highlight
        document.querySelectorAll('.chart-pane').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.paneId) === paneId);
        });

        // Sync main app state to this pane
        this.chart = pane.chart;
        this.currentPair = pane.pair;
        this.currentInterval = pane.interval;
        window.currentPair = this.currentPair;
        window.currentInterval = this.currentInterval;

        // Sync Pine Script IDE to active chart instance
        if (this.pineIDE) {
            this.pineIDE.chart = this.chart;
        }

        // Update Topbar UI
        const coinSelect = document.getElementById('coin-select');
        if (coinSelect) {
            const cleanCur = this.cleanSymbol(this.currentPair);
            Array.from(coinSelect.options).forEach(opt => {
                opt.selected = this.cleanSymbol(opt.value) === cleanCur;
            });
        }

        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tf.toLowerCase() === this.currentInterval.toLowerCase());
        });

        this.updateTickerHeader();
        this.recalculateTpSlPreviews();
    }

    cleanSymbol(pairStr) {
        return (pairStr || 'BTC_USDT').replace('B-', '').replace('_USDT', '').replace('USDT', '').replace('_', '').toUpperCase();
    }

    async loadPaneCandles(paneId) {
        const pane = this.panes.get(paneId);
        if (!pane || !pane.chart) return;

        const cacheKey = `${pane.pair}_${pane.interval}`;
        if (this.candleCache && this.candleCache.has(cacheKey)) {
            const cached = this.candleCache.get(cacheKey);
            if (cached && cached.length) {
                pane.chart.setCandles(cached, true, pane.interval, this.cleanSymbol(pane.pair));
                return;
            }
        }

        pane.chart.showLoading(this.cleanSymbol(pane.pair));

        let candles = null;
        // 1. Try local backend
        try {
            const ctrl = new AbortController();
            const tm = setTimeout(() => ctrl.abort(), 2500);
            const resp = await fetch(`/api/candles?pair=${encodeURIComponent(pane.pair)}&interval=${pane.interval}&limit=160`, { signal: ctrl.signal });
            clearTimeout(tm);
            if (resp.ok) {
                const data = await resp.json();
                if (Array.isArray(data) && data.length) candles = data;
            }
        } catch(e) {}

        // 2. Try Binance open API
        if (!candles || !candles.length) {
            const sym = this.cleanSymbol(pane.pair) + 'USDT';
            try {
                const bCtrl = new AbortController();
                const bTm = setTimeout(() => bCtrl.abort(), 2500);
                const bResp = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${pane.interval}&limit=160`, { signal: bCtrl.signal });
                clearTimeout(bTm);
                if (bResp.ok) {
                    const raw = await bResp.json();
                    if (Array.isArray(raw) && raw.length) {
                        candles = raw.map(k => ({
                            time: k[0],
                            open: parseFloat(k[1]),
                            high: parseFloat(k[2]),
                            low: parseFloat(k[3]),
                            close: parseFloat(k[4]),
                            volume: parseFloat(k[5])
                        }));
                    }
                }
            } catch(e) {}
        }

        // 3. Fallback smooth candles
        if (!candles || !candles.length) {
            candles = this.generateFallbackCandlesFor(pane.pair);
        }

        if (candles && candles.length) {
            if (!this.candleCache) this.candleCache = new Map();
            this.candleCache.set(cacheKey, candles);
            pane.chart.setCandles(candles, true, pane.interval, this.cleanSymbol(pane.pair));
            if (paneId === this.activePaneId) {
                this.updateTickerHeader();
            }
            this.renderPaneTrendBar(paneId);
        }
    }

    generateFallbackCandlesFor(pair) {
        return this.generateFallbackCandles(pair);
    }

    broadcastTickToPanes(symStr, tick) {
        const cleanIncoming = this.cleanSymbol(symStr);
        tick.symbol = cleanIncoming;
        this.panes.forEach(pane => {
            if (this.cleanSymbol(pane.pair) === cleanIncoming) {
                if (pane.chart && pane.chart.updateCurrentCandle) {
                    pane.chart.updateCurrentCandle(tick, pane.interval);
                }
            }
        });
        if (this.cleanSymbol(this.currentPair) === cleanIncoming) {
            this.updateTickerHeader();
        }
        if (!this.lastTrendUpdate || Date.now() - this.lastTrendUpdate > 4000) {
            this.lastTrendUpdate = Date.now();
            this.renderPaneTrendBar(0);
            this.panes.forEach((_, id) => this.renderPaneTrendBar(id));
        }
    }

    startWatchdog() {
        if (this.watchdogInterval) clearInterval(this.watchdogInterval);
        this.watchdogInterval = setInterval(() => {
            const now = Date.now();
            if (!this.lastBinanceTickTime || now - this.lastBinanceTickTime > 25000) {
                console.log("[Watchdog] Stream silent for 25s. Reconnecting & refreshing live bar...");
                this.syncLatestCandles();
                this.connectDirectBinanceWs();
            }
        }, 15000);
    }

    async syncLatestCandles() {
        this.panes.forEach(pane => {
            const sym = this.cleanSymbol(pane.pair) + 'USDT';
            fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${pane.interval}&limit=2`)
                .then(r => r.json())
                .then(raw => {
                    if (Array.isArray(raw) && raw.length && pane.chart) {
                        const lastK = raw[raw.length - 1];
                        pane.chart.updateCurrentCandle({
                            symbol: pane.pair,
                            price: parseFloat(lastK[4]),
                            quantity: parseFloat(lastK[5]),
                            time: lastK[0]
                        }, pane.interval);
                    }
                })
                .catch(() => {});
        });
    }

    connectWebSocket() {
        const isGithubPages = window.location.hostname.includes('github.io');
        if (isGithubPages) {
            this.connectDirectBinanceWs();
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log("[WebSocket] Connected to Open Chart live feed");
                this.ws.send(JSON.stringify({ action: 'subscribe', pair: this.currentPair }));
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'tick') {
                        this.broadcastTickToPanes(data.symbol, data);

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

            this.ws.onerror = () => {
                this.connectDirectBinanceWs();
            };

            this.ws.onclose = () => {
                setTimeout(() => this.connectWebSocket(), 3000);
            };
        } catch (e) {
            this.connectDirectBinanceWs();
        }
    }

    connectDirectBinanceWs() {
        try {
            if (this.binanceWs) {
                try {
                    this.binanceWs.onclose = null;
                    this.binanceWs.onerror = null;
                    this.binanceWs.close();
                } catch(e) {}
                this.binanceWs = null;
            }

            // Gather all symbols needed across active visible panes
            const activeStreams = new Set();
            this.panes.forEach(pane => {
                const sym = this.cleanSymbol(pane.pair).toLowerCase();
                if (sym) activeStreams.add(`${sym}usdt@trade`);
            });

            if (!activeStreams.size) {
                activeStreams.add(`${this.getCleanSymbol().toLowerCase()}usdt@trade`);
            }

            const streamArr = Array.from(activeStreams);
            const streamUrl = streamArr.length === 1
                ? `wss://stream.binance.com:9443/ws/${streamArr[0]}`
                : `wss://stream.binance.com:9443/stream?streams=${streamArr.join('/')}`;

            this.binanceWs = new WebSocket(streamUrl);

            this.binanceWs.onopen = () => {
                console.log(`[Binance Stream] Connected to ${streamArr.length} symbol stream(s)`);
                this.lastBinanceTickTime = Date.now();
            };

            this.binanceWs.onmessage = (e) => {
                try {
                    const parsed = JSON.parse(e.data);
                    const tick = parsed.data || parsed;
                    if (tick && tick.p) {
                        this.lastBinanceTickTime = Date.now();
                        const s = tick.s || '';
                        const p = parseFloat(tick.p);
                        const q = parseFloat(tick.q || 0);
                        const t = tick.T || Date.now();

                        this.broadcastTickToPanes(s, { price: p, quantity: q, time: t, symbol: s });
                    }
                } catch(err) {}
            };

            this.binanceWs.onerror = (err) => {
                console.warn("[Binance WS] Connection error:", err);
                try { this.binanceWs.close(); } catch(e) {}
            };

            this.binanceWs.onclose = () => {
                console.log("[Binance WS] Disconnected. Reconnecting in 2.5s...");
                if (!this.binanceReconnectTimeout) {
                    this.binanceReconnectTimeout = setTimeout(() => {
                        this.binanceReconnectTimeout = null;
                        this.connectDirectBinanceWs();
                    }, 2500);
                }
            };
        } catch (err) {
            setTimeout(() => this.connectDirectBinanceWs(), 3000);
        }
    }
}

window.OpenChartApp = OpenChartApp;
window.NexusApp = OpenChartApp;

window.addEventListener('DOMContentLoaded', () => {
    new OpenChartApp();
});
