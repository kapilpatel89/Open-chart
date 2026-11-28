/**
 * Open Chart 3D Candlestick Charting Engine
 * Hardware-accelerated Canvas with volumetric 3D cylindrical lighting,
 * glossy/matte finish, smooth panning/zooming, crosshairs, indicator overlays,
 * sub-panes (RSI/MACD), complete suite of TradingView-style marking tools,
 * interactive axis scaling (time axis drag & price axis drag, touch gestures),
 * clearly visible bottom timeline, and draggable Take-Profit (TP) / Stop-Loss (SL) lines.
 */

class OpenChart3D {
    constructor(canvasId, options = {}) {
        this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.options = Object.assign({
            candleWidth: 14,
            candleGap: 6,
            minCandleWidth: 2,
            maxCandleWidth: 90,
            backgroundColor: '#07090e',
            gridColor: 'rgba(255, 255, 255, 0.04)',
            textColor: '#8a99ad',
            accentColor: '#00f0ff',
            candleStyle: 'normal',
            timeframe: '1h'
        }, options);

        this.candleStyle = this.options.candleStyle || 'normal';
        this.timeframe = this.options.timeframe || '1h';
        this.symbol = (this.options && this.options.symbol) ? String(this.options.symbol).replace('B-', '').replace('_USDT', '').replace('USDT', '').replace('_', '').toUpperCase() : 'BTC';
        this.currency = (this.options && this.options.currency) || '$';

        this.candles = [];
        this.timeIndexMap = new Map();
        this.indicators = [];
        this.quickIndicators = [];
        this.pineIndicators = [];
        this.signals = [];
        this.orders = [];
        this.positions = [];

        // Kinetic Panning Inertia
        this.velocityX = 0;
        this.velocityY = 0;
        this._lastPanX = 0;
        this._lastPanY = 0;
        this._lastPanTs = 0;

        // Drawing & Marking Tools State
        this.activeTool = 'cursor'; // cursor, trendline, ray, extended, horizontal, horizontal_ray, vertical, channel, fibonacci, fib_extension, rectangle, circle, brush, arrow, text, price_label, long_position, short_position, measure
        this.drawings = [];
        this.pendingDrawing = null;
        this.brushPoints = [];

        // View State
        this.offsetX = 0;          // Horizontal scroll offset (pixels)
        this.offsetY = 0;          // Vertical scroll offset (pixels for free 2D panning)
        this.candleWidth = this.options.candleWidth;
        this.candleGap = this.options.candleGap;
        this.priceRange = { min: 0, max: 1 };
        this.autoScale = true;
        this.userPriceZoom = 1.0;  // Price vertical scaling factor
        this.jumpButtonRect = null; // Rect for floating live jump button

        // Interaction State
        this.isDraggingChart = false;
        this.isDraggingTimeAxis = false;
        this.isDraggingPriceAxis = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.initialOffsetX = 0;
        this.initialOffsetY = 0;
        this.axisDragStartX = 0;
        this.axisDragStartY = 0;
        this.axisDragStartCandleWidth = this.candleWidth;
        this.axisDragStartZoom = 1.0;
        this.axisDragStartPriceMid = 0;
        this.mousePos = { x: -1, y: -1 };

        // Draggable Orders State & Interactive Callbacks
        this.draggedLine = null;
        this.onOrderUpdate = null;
        this.onOrderClose = null;
        this.onOrderCancel = null;
        this.onOrderCancelTpSl = null;
        this.onQuickAttachTpSl = null;
        this.onLimitPriceUpdate = null;
        this.onContextMenuRequest = null;
        this._interactiveHitBoxes = [];
        this._pricePlusHit = null;

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
            this._resizeObserver = new ResizeObserver(() => this.resize());
            this._resizeObserver.observe(this.canvas.parentElement);
        }

        // Mouse Events
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', () => this.onMouseUp());
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));

        // Touch Events (Mobiles & Tablets with Pinch Zoom & Pan)
        this.canvas.style.touchAction = 'none';
        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });

        this.startRenderLoop();
    }

    resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        // Layout zones
        this.priceAxisWidth = this.width < 520 ? 72 : 85;
        this.timeAxisHeight = 32; // Dedicated bottom timeline height

        this.hasSubpane = this.indicators.some(ind => ind.pane === 'rsi' || ind.pane === 'macd' || ind.pane === 'sub');
        this.subpaneHeight = this.hasSubpane ? Math.min(100, Math.max(76, Math.round(this.height * 0.2))) : 0;
        this.volumeHeight = Math.min(72, this.height * 0.13);

        this.chartHeight = this.height - this.timeAxisHeight - this.subpaneHeight;
        this.mainChartHeight = this.chartHeight - this.volumeHeight;

        this.render();
    }

    showLoading(symbol = '') {
        this.isLoading = true;
        this.loadingSymbol = symbol;
        this.render();
    }

    getCurrency() {
        return window.currencySymbol || this.currency || '$';
    }

    formatPrice(val, includeCurrency = false) {
        if (val === null || val === undefined || !isFinite(val)) return (includeCurrency ? this.getCurrency() : '') + '0.00';
        const abs = Math.abs(val);
        const prefix = includeCurrency ? this.getCurrency() : '';
        if (abs >= 1000) return prefix + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (abs >= 1) return prefix + val.toFixed(2);
        if (abs >= 0.01) return prefix + val.toFixed(4);
        if (abs >= 0.0001) return prefix + val.toFixed(6);
        return prefix + val.toFixed(8);
    }

    _rebuildTimeIndex() {
        this.timeIndexMap = new Map();
        for (let i = 0; i < this.candles.length; i++) {
            this.timeIndexMap.set(this.candles[i].time, i);
        }
    }

    _resolveCandleIdx(ptTime) {
        if (!this.candles.length) return -1;
        const exact = this.timeIndexMap ? this.timeIndexMap.get(ptTime) : undefined;
        if (exact !== undefined) return exact;
        // Binary search fallback if slight timestamp delta exists
        let lo = 0, hi = this.candles.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const ct = this.candles[mid].time;
            if (ct === ptTime) return mid;
            if (ct < ptTime) lo = mid + 1;
            else hi = mid - 1;
        }
        return -1;
    }

    setCandles(candles, forceReset = true, timeframe = null, symbol = null) {
        this.isLoading = false;
        this.loadingSymbol = '';
        if (timeframe) this.timeframe = timeframe;
        if (symbol) {
            this.symbol = String(symbol).replace('B-', '').replace('_USDT', '').replace('USDT', '').replace('_', '').toUpperCase();
        }
        this.candles = candles || [];
        this._rebuildTimeIndex();
        if (forceReset || this.autoScale || this.offsetX === 0) {
            this.resetView();
        } else {
            this.updatePriceRange();
            this.render();
        }
    }

    updateCurrentCandle(tick, interval = null) {
        if (!this.candles.length) return;
        const price = parseFloat(tick.price);
        if (!isFinite(price) || price <= 0) return;

        // Cross-asset guard: Never accept ticks meant for another coin
        if (tick.symbol && this.symbol) {
            const cleanTick = String(tick.symbol).replace('B-', '').replace('_USDT', '').replace('USDT', '').replace('_', '').toUpperCase();
            const cleanChart = String(this.symbol).replace('B-', '').replace('_USDT', '').replace('USDT', '').replace('_', '').toUpperCase();
            if (cleanTick !== cleanChart) return;
        }

        const tf = interval || this.timeframe || '1h';
        const tfMs = this.timeframeToMs(tf);
        const last = this.candles[this.candles.length - 1];
        const tickTime = tick.time ? parseInt(tick.time) : Date.now();

        // Anomaly / cross-asset rogue tick protection:
        // If price differs by > 35% from last candle close, reject this tick to prevent corrupting the chart
        const priceDiffRatio = Math.abs(price - last.close) / Math.max(0.000001, last.close);
        if (priceDiffRatio > 0.35 && this.candles.length > 5) {
            return;
        }

        // Check if tick crossed into the next timeframe candle bar
        if (tickTime >= last.time + tfMs) {
            const newBarTime = last.time + tfMs * Math.max(1, Math.floor((tickTime - last.time) / tfMs));
            const newCandle = {
                time: newBarTime,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: parseFloat(tick.quantity || 0)
            };
            this.candles.push(newCandle);
            if (this.candles.length > 500) {
                this.candles.shift();
            }
            this._rebuildTimeIndex();

            // Auto advance viewport if user was pinned near the right edge
            const step = this.candleWidth + this.candleGap;
            const totalW = this.candles.length * step;
            const viewW = this.width - this.priceAxisWidth;
            if (this.offsetX >= totalW - viewW - step * 4) {
                this.offsetX = Math.max(0, totalW - viewW + 120);
            }
        } else {
            last.close = price;
            last.high = Math.max(last.high, price);
            last.low = Math.min(last.low, price);
            last.volume += parseFloat(tick.quantity || 0);
        }

        this.updatePriceRange();
        this.render();
    }

    setCandleStyle(style) {
        this.candleStyle = style || 'normal';
        this.render();
    }

    timeframeToMs(interval) {
        const tf = (interval || this.timeframe || '1h').toLowerCase();
        if (tf.endsWith('m')) return (parseInt(tf) || 1) * 60 * 1000;
        if (tf.endsWith('h')) return (parseInt(tf) || 1) * 3600 * 1000;
        if (tf.endsWith('d')) return (parseInt(tf) || 1) * 86400 * 1000;
        if (tf.endsWith('w')) return (parseInt(tf) || 1) * 7 * 86400 * 1000;
        return 3600 * 1000;
    }

    _syncMergedIndicators() {
        this.indicators = [...(this.quickIndicators || []), ...(this.pineIndicators || [])];
        this.hasSubpane = this.indicators.some(ind => ind.pane === 'rsi' || ind.pane === 'macd' || ind.pane === 'sub');
        this.subpaneHeight = this.hasSubpane ? Math.min(100, Math.max(76, Math.round(this.height * 0.2))) : 0;
        this.chartHeight = this.height - this.timeAxisHeight - this.subpaneHeight;
        this.mainChartHeight = this.chartHeight - this.volumeHeight;
        this.render();
    }

    setQuickIndicators(indicators) {
        this.quickIndicators = indicators || [];
        this._syncMergedIndicators();
    }

    setPineIndicators(indicators) {
        this.pineIndicators = indicators || [];
        this._syncMergedIndicators();
    }

    setIndicators(indicators) {
        this.pineIndicators = indicators || [];
        this._syncMergedIndicators();
    }

    setSignals(signals) {
        this.signals = signals || [];
        this.render();
    }

    setOrders(orders, positions) {
        const cleanSym = this.symbol ? String(this.symbol).replace('B-', '').replace('_USDT', '').replace('USDT', '').replace('_', '').toUpperCase() : '';
        const filterItem = (it) => {
            if (!it) return false;
            if (!cleanSym) return true;
            if (it.symbol) {
                const s = String(it.symbol).replace('B-', '').replace('_USDT', '').replace('USDT', '').replace('_', '').toUpperCase();
                return s === cleanSym;
            }
            return true;
        };
        this.orders = (orders || []).filter(filterItem);
        this.positions = (positions || []).filter(filterItem);
        this.render();
    }

    resetView() {
        if (!this.candles.length) return;
        const totalW = this.candles.length * (this.candleWidth + this.candleGap);
        const viewW = this.width - this.priceAxisWidth;
        this.offsetX = Math.max(0, totalW - viewW + 120);
        this.offsetY = 0;
        this.userPriceZoom = 1.0;
        this.autoScale = true;
        this.render();
    }

    clearDrawings() {
        this.drawings = [];
        this.pendingDrawing = null;
        this.brushPoints = [];
        this.render();
    }

    // --- Math & Coordinate Helpers ---

    get visibleRange() {
        const step = this.candleWidth + this.candleGap;
        const startIdx = Math.max(0, Math.floor(this.offsetX / step) - 2);
        const count = Math.ceil((this.width - this.priceAxisWidth) / step) + 4;
        const endIdx = Math.min(this.candles.length - 1, startIdx + count);
        return { startIdx, endIdx };
    }

    updatePriceRange() {
        if (!this.candles || !this.candles.length) return;
        let { startIdx, endIdx } = this.visibleRange;
        if (startIdx > endIdx || startIdx < 0 || endIdx < 0) {
            startIdx = Math.max(0, this.candles.length - 30);
            endIdx = this.candles.length - 1;
        }

        let min = Infinity;
        let max = -Infinity;

        for (let i = startIdx; i <= endIdx; i++) {
            const c = this.candles[i];
            if (!c) continue;
            if (isFinite(c.low) && c.low < min) min = c.low;
            if (isFinite(c.high) && c.high > max) max = c.high;
        }

        // Active Orders & Positions TP/SL (bounded to prevent foreign coin distortion)
        const lastC = (this.candles && this.candles.length) ? this.candles[this.candles.length - 1] : null;
        const lastClose = (lastC && isFinite(lastC.close) && lastC.close > 0) ? lastC.close : null;
        [...this.positions, ...this.orders].forEach(item => {
            const p = item.entry_price || item.price;
            if (lastClose && (p > lastClose * 3.5 || p < lastClose * 0.25)) return;
            if (p && isFinite(p)) {
                if (p < min) min = p;
                if (p > max) max = p;
            }
            if (item.take_profit && isFinite(item.take_profit)) {
                if (!lastClose || (item.take_profit <= lastClose * 3.5 && item.take_profit >= lastClose * 0.25)) {
                    if (item.take_profit < min) min = item.take_profit;
                    if (item.take_profit > max) max = item.take_profit;
                }
            }
            if (item.stop_loss && isFinite(item.stop_loss)) {
                if (!lastClose || (item.stop_loss <= lastClose * 3.5 && item.stop_loss >= lastClose * 0.25)) {
                    if (item.stop_loss < min) min = item.stop_loss;
                    if (item.stop_loss > max) max = item.stop_loss;
                }
            }
        });

        if (min === Infinity || max === -Infinity || !isFinite(min) || !isFinite(max)) {
            const lastC = this.candles[this.candles.length - 1];
            const p = (lastC && isFinite(lastC.close) && lastC.close > 0) ? lastC.close : 100;
            min = p * 0.98;
            max = p * 1.02;
        }

        // Guarantee at least 1.5% vertical breathing room even on zero volatility/flat bars
        const padding = Math.max((max - min) * 0.1, (min * 0.015) || 1.0);
        let baseMin = min - padding;
        let baseMax = max + padding;

        // Apply dynamic user vertical price scaling (drag price axis up/down)
        if (this.userPriceZoom !== 1.0) {
            this.userPriceZoom = Math.max(0.05, Math.min(20.0, this.userPriceZoom));
            const mid = (baseMin + baseMax) / 2.0;
            const halfSpan = Math.max(0.01, ((baseMax - baseMin) / 2.0) * this.userPriceZoom);
            baseMin = mid - halfSpan;
            baseMax = mid + halfSpan;
        }

        this.priceRange = { min: baseMin, max: baseMax };
    }

    priceToY(price) {
        if (!isFinite(price)) price = 0;
        const min = isFinite(this.priceRange.min) ? this.priceRange.min : 0;
        const max = isFinite(this.priceRange.max) ? this.priceRange.max : 100;
        const range = max - min || 1;
        const ratio = (price - min) / range;
        const chartH = Math.max(80, this.mainChartHeight || (this.height - 100));
        return chartH - (ratio * chartH) + 15 + this.offsetY;
    }

    yToPrice(y) {
        const { min, max } = this.priceRange;
        const range = max - min || 1;
        const chartH = Math.max(80, this.mainChartHeight || (this.height - 100));
        const ratio = (chartH + 15 + this.offsetY - y) / chartH;
        return min + (ratio * range);
    }

    candleToX(index) {
        const step = this.candleWidth + this.candleGap;
        return (index * step) - this.offsetX;
    }

    xToCandleIndex(x) {
        const step = this.candleWidth + this.candleGap;
        return Math.floor((x + this.offsetX) / step);
    }

    // --- Rendering Pipeline ---

    render() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        // 1. Satin Matte Background
        this.drawBackground(ctx);

        if (this.isLoading && (!this.candles || !this.candles.length)) {
            this.drawLoadingState(ctx);
            return;
        }

        if (!this.candles.length) {
            this.drawEmptyState(ctx);
            return;
        }

        this.updatePriceRange();

        // 2. Grid Lines
        try {
            this.drawGrid(ctx);
        } catch (e) {
            console.error("Grid render error:", e);
        }

        // 3. 3D Volume Bars
        try {
            this.drawVolumeProfile(ctx);
        } catch (e) {
            console.error("Volume render error:", e);
        }

        // 4. Indicator Overlays (EMA, Bollinger, Supertrend)
        try {
            this.drawMainIndicators(ctx);
        } catch (e) {
            console.error("Indicators render error:", e);
        }

        // 5. Candlesticks (Normal TradingView Crisp, Hollow, or 3D)
        try {
            if (this.candleStyle === 'hollow') {
                this.drawHollowCandles(ctx);
            } else if (this.candleStyle === '3d') {
                this.draw3DCandles(ctx);
            } else {
                this.drawNormalCandles(ctx);
            }
        } catch (e) {
            console.error("Candles render error:", e);
        }

        // 6. Strategy Signals & Markers
        try {
            this.drawSignals(ctx);
        } catch (e) {
            console.error("Signals render error:", e);
        }

        // 7. Interactive Draggable Orders (Entry, TP, SL)
        try {
            this.drawInteractiveOrders(ctx);
        } catch (e) {
            console.error("Interactive orders render error:", e);
        }

        // 8. User Drawings (All Marking Tools)
        try {
            this.drawUserDrawings(ctx);
        } catch (e) {
            console.error("User drawings render error:", e);
        }

        // 9. Subpane Indicators (RSI, MACD)
        if (this.hasSubpane) {
            try {
                this.drawSubpane(ctx);
            } catch (e) {
                console.error("Subpane render error:", e);
            }
        }

        // 10. Crosshair & Magnetic Data HUD
        try {
            this.drawCrosshair(ctx);
        } catch (e) {
            console.error("Crosshair render error:", e);
        }

        // 11. Ongoing Live Price Line touching candlestick
        try {
            this.drawLivePriceLine(ctx);
        } catch (e) {
            console.error("Live price line render error:", e);
        }

        // 12. Axes: Dedicated Bottom Timeline & Right Price Axis
        try {
            this.drawAxes(ctx);
        } catch (e) {
            console.error("Axes render error:", e);
        }

        // 13. Jump to Live Candle Floating Button (Bottom Right)
        try {
            this.drawJumpToLiveButton(ctx);
        } catch (e) {
            console.error("Jump to live button render error:", e);
        }
    }

    isLiveCandleVisible() {
        if (!this.candles || !this.candles.length) return true;
        const lastIdx = this.candles.length - 1;
        const lastX = this.candleToX(lastIdx);
        const viewW = this.width - this.priceAxisWidth;
        const xVisible = (lastX >= 25 && lastX <= viewW - 25);
        const yCentered = Math.abs(this.offsetY) < 50;
        return xVisible && yCentered;
    }

    drawJumpToLiveButton(ctx) {
        if (this.isLiveCandleVisible()) {
            this.jumpButtonRect = null;
            return;
        }

        const viewW = this.width - this.priceAxisWidth;
        const bottomY = this.height - this.timeAxisHeight;
        const btnX = viewW - 36;
        const btnY = bottomY - 36;
        const r = 18;
        this.jumpButtonRect = { x: btnX, y: btnY, r: r };

        ctx.save();
        // Outer glowing shadow
        ctx.shadowColor = 'rgba(0, 240, 255, 0.45)';
        ctx.shadowBlur = 12;

        // Button background
        ctx.fillStyle = '#0a101d';
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(btnX, btnY, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Right arrow icon (➜)
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#00f0ff';
        ctx.font = 'bold 16px Inter, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('➜', btnX + 1, btnY);

        ctx.restore();
    }

    centerOnLiveCandle() {
        if (!this.candles || !this.candles.length) return;
        const totalW = this.candles.length * (this.candleWidth + this.candleGap);
        const viewW = this.width - this.priceAxisWidth;
        this.offsetX = Math.max(0, totalW - (viewW * 0.70));
        this.offsetY = 0;
        this.userPriceZoom = 1.0;
        this.autoScale = true;
        this.render();
    }

    drawBackground(ctx) {
        const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
        bgGrad.addColorStop(0, '#090b10');
        bgGrad.addColorStop(1, '#05070a');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, this.width, this.height);
    }

    drawLoadingState(ctx) {
        ctx.save();
        ctx.fillStyle = '#00f0ff';
        ctx.font = '600 16px Inter, sans-serif';
        ctx.textAlign = 'center';
        const msg = this.loadingSymbol ? `⚡ Switching to ${this.loadingSymbol}...` : 'Loading Candlesticks...';
        ctx.fillText(msg, this.width / 2, this.height / 2 - 12);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText('Syncing CoinDCX WebSocket Stream & Order Depth', this.width / 2, this.height / 2 + 12);

        const barW = 180;
        const barH = 3;
        const barX = (this.width - barW) / 2;
        const barY = this.height / 2 + 28;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(barX, barY, barW, barH);

        const animX = barX + ((Date.now() / 4) % (barW - 40));
        const barGrad = ctx.createLinearGradient(animX, 0, animX + 40, 0);
        barGrad.addColorStop(0, 'rgba(0, 240, 255, 0.1)');
        barGrad.addColorStop(0.5, '#00f0ff');
        barGrad.addColorStop(1, 'rgba(0, 230, 118, 0.1)');
        ctx.fillStyle = barGrad;
        ctx.fillRect(animX, barY, 40, barH);
        ctx.restore();
    }

    drawEmptyState(ctx) {
        ctx.save();
        ctx.fillStyle = '#00f0ff';
        ctx.font = '600 15px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Connecting to CoinDCX Live Stream...', this.width / 2, this.height / 2 - 10);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText('Real-time 3D Candlesticks will appear here', this.width / 2, this.height / 2 + 12);
        ctx.restore();
    }

    drawGrid(ctx) {
        ctx.strokeStyle = this.options.gridColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        // Horizontal price grid
        const stepCount = 8;
        const pStep = (this.priceRange.max - this.priceRange.min) / stepCount;
        for (let i = 0; i <= stepCount; i++) {
            const p = this.priceRange.min + i * pStep;
            const y = this.priceToY(p);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.width - this.priceAxisWidth, y);
            ctx.stroke();
        }

        // Vertical time grid
        const { startIdx, endIdx } = this.visibleRange;
        const timeInterval = Math.max(1, Math.floor((endIdx - startIdx) / 7));
        for (let i = startIdx; i <= endIdx; i += timeInterval) {
            const x = this.candleToX(i) + this.candleWidth / 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.height - this.timeAxisHeight);
            ctx.stroke();
        }

        ctx.setLineDash([]);
    }

    drawVolumeProfile(ctx) {
        const { startIdx, endIdx } = this.visibleRange;
        let maxVol = 0;
        for (let i = startIdx; i <= endIdx; i++) {
            const c = this.candles[i];
            if (c && c.volume > maxVol) maxVol = c.volume;
        }
        if (maxVol === 0) return;

        const volBaseY = this.mainChartHeight + this.volumeHeight;

        for (let i = startIdx; i <= endIdx; i++) {
            const c = this.candles[i];
            if (!c) continue;
            const x = this.candleToX(i);
            const isBullish = c.close >= c.open;
            const vHeight = (c.volume / maxVol) * (this.volumeHeight - 8);
            const y = volBaseY - vHeight;

            const vGrad = ctx.createLinearGradient(x, 0, x + this.candleWidth, 0);
            if (isBullish) {
                vGrad.addColorStop(0, 'rgba(0, 230, 118, 0.15)');
                vGrad.addColorStop(0.5, 'rgba(0, 255, 140, 0.4)');
                vGrad.addColorStop(1, 'rgba(0, 180, 90, 0.2)');
            } else {
                vGrad.addColorStop(0, 'rgba(255, 23, 68, 0.15)');
                vGrad.addColorStop(0.5, 'rgba(255, 80, 100, 0.4)');
                vGrad.addColorStop(1, 'rgba(200, 15, 50, 0.2)');
            }

            ctx.fillStyle = vGrad;
            ctx.fillRect(x, y, this.candleWidth, vHeight);
        }
    }

    /**
     * Authentic TradingView-Style Crisp Normal Candlesticks (High Contrast & Sharp Wicks)
     */
    drawNormalCandles(ctx) {
        const { startIdx, endIdx } = this.visibleRange;
        const upColor = '#089981';   // TradingView Emerald
        const downColor = '#f23645'; // TradingView Ruby

        for (let i = startIdx; i <= endIdx; i++) {
            const c = this.candles[i];
            if (!c) continue;

            const isBullish = c.close >= c.open;
            const color = isBullish ? upColor : downColor;
            const x = Math.round(this.candleToX(i));
            const openY = Math.round(this.priceToY(c.open));
            const closeY = Math.round(this.priceToY(c.close));
            const highY = Math.round(this.priceToY(c.high));
            const lowY = Math.round(this.priceToY(c.low));

            const topY = Math.min(openY, closeY);
            const bottomY = Math.max(openY, closeY);
            const bodyH = Math.max(1, bottomY - topY);
            const centerX = Math.round(x + this.candleWidth / 2);

            // 1. Crisp Single-Pixel Wick
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(centerX + 0.5, highY);
            ctx.lineTo(centerX + 0.5, lowY);
            ctx.stroke();

            // 2. Crisp Solid Candle Body
            ctx.fillStyle = color;
            ctx.fillRect(x, topY, this.candleWidth, bodyH);

            // Subtle border outline for pin-sharp contrast
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, topY + 0.5, this.candleWidth - 1, bodyH - 1);
            ctx.restore();
        }
    }

    /**
     * Hollow Candlesticks: Bullish candles are hollow, Bearish candles are solid
     */
    drawHollowCandles(ctx) {
        const { startIdx, endIdx } = this.visibleRange;
        const upColor = '#089981';
        const downColor = '#f23645';

        for (let i = startIdx; i <= endIdx; i++) {
            const c = this.candles[i];
            if (!c) continue;

            const isBullish = c.close >= c.open;
            const color = isBullish ? upColor : downColor;
            const x = Math.round(this.candleToX(i));
            const openY = Math.round(this.priceToY(c.open));
            const closeY = Math.round(this.priceToY(c.close));
            const highY = Math.round(this.priceToY(c.high));
            const lowY = Math.round(this.priceToY(c.low));

            const topY = Math.min(openY, closeY);
            const bottomY = Math.max(openY, closeY);
            const bodyH = Math.max(1, bottomY - topY);
            const centerX = Math.round(x + this.candleWidth / 2);

            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(centerX + 0.5, highY);
            ctx.lineTo(centerX + 0.5, lowY);
            ctx.stroke();

            if (isBullish) {
                ctx.fillStyle = '#07090e';
                ctx.fillRect(x, topY, this.candleWidth, bodyH);
                ctx.strokeStyle = color;
                ctx.strokeRect(x + 0.5, topY + 0.5, this.candleWidth - 1, bodyH - 1);
            } else {
                ctx.fillStyle = color;
                ctx.fillRect(x, topY, this.candleWidth, bodyH);
            }
            ctx.restore();
        }
    }

    /**
     * Volumetric 3D Candlesticks with Glossy & Matte finish
     */
    draw3DCandles(ctx) {
        const { startIdx, endIdx } = this.visibleRange;

        for (let i = startIdx; i <= endIdx; i++) {
            const c = this.candles[i];
            if (!c) continue;

            const isBullish = c.close >= c.open;
            const x = this.candleToX(i);
            const openY = this.priceToY(c.open);
            const closeY = this.priceToY(c.close);
            const highY = this.priceToY(c.high);
            const lowY = this.priceToY(c.low);

            const topY = Math.min(openY, closeY);
            const bottomY = Math.max(openY, closeY);
            let bodyH = Math.max(2, bottomY - topY);
            const centerX = x + this.candleWidth / 2;

            // 1. Laser Wick with Neon Glow
            ctx.save();
            ctx.strokeStyle = isBullish ? '#00e676' : '#ff1744';
            ctx.lineWidth = 1.5;
            ctx.shadowColor = isBullish ? 'rgba(0, 230, 118, 0.6)' : 'rgba(255, 23, 68, 0.6)';
            ctx.shadowBlur = 6;

            ctx.beginPath();
            ctx.moveTo(centerX, highY);
            ctx.lineTo(centerX, topY);
            ctx.moveTo(centerX, bottomY);
            ctx.lineTo(centerX, lowY);
            ctx.stroke();
            ctx.restore();

            // 2. Ambient Drop Shadow (3D Elevation)
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 3;
            ctx.shadowOffsetY = 4;

            // 3. Volumetric 3D Cylindrical Gradient (Glossy + Matte Mix)
            const bodyGrad = ctx.createLinearGradient(x, 0, x + this.candleWidth, 0);
            if (isBullish) {
                bodyGrad.addColorStop(0.0, '#005934');           // Left matte shadow
                bodyGrad.addColorStop(0.18, '#00b359');          // Base satin lacquer
                bodyGrad.addColorStop(0.35, '#84ffb8');          // Gloss specular highlight streak
                bodyGrad.addColorStop(0.65, '#00e676');          // Vibrant emerald core
                bodyGrad.addColorStop(1.0, '#004221');           // Right 3D rim shadow
            } else {
                bodyGrad.addColorStop(0.0, '#660013');           // Left matte shadow
                bodyGrad.addColorStop(0.18, '#cc0029');          // Base satin lacquer
                bodyGrad.addColorStop(0.35, '#ff8a9e');          // Gloss specular highlight streak
                bodyGrad.addColorStop(0.65, '#ff1744');          // Vibrant ruby core
                bodyGrad.addColorStop(1.0, '#42000c');           // Right 3D rim shadow
            }

            ctx.fillStyle = bodyGrad;
            const radius = Math.min(3, this.candleWidth / 3);
            this.roundRect(ctx, x, topY, this.candleWidth, bodyH, radius);
            ctx.fill();
            ctx.restore();

            // 4. Chamfered Top & Bottom Bevel Caps
            ctx.save();
            ctx.strokeStyle = isBullish ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 210, 210, 0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 1, topY + 1);
            ctx.lineTo(x + this.candleWidth - 1, topY + 1);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.beginPath();
            ctx.moveTo(x + 1, topY + bodyH - 1);
            ctx.lineTo(x + this.candleWidth - 1, topY + bodyH - 1);
            ctx.stroke();
            ctx.restore();
        }
    }

    roundRect(ctx, x, y, width, height, radius = 0) {
        if (width <= 0 || height <= 0 || !isFinite(width) || !isFinite(height)) return;
        radius = Math.max(0, Math.min(radius, width / 2, height / 2));

        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, width, height, radius);
            return;
        }

        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + radius, y, radius);
        ctx.closePath();
    }

    drawMainIndicators(ctx) {
        if (!this.indicators.length) return;

        this.indicators.filter(ind => ind.pane === 'main' || !ind.pane).forEach(ind => {
            if (!ind.data || !ind.data.length) return;
            ctx.save();
            ctx.lineWidth = ind.linewidth || 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            if (ind.dashed) ctx.setLineDash([5, 4]);

            // Optional Bollinger Band cloud fill between upper and lower pair
            if (ind.fillPairData && ind.fillPairData.length) {
                const upperPts = [];
                const lowerPts = [];
                ind.data.forEach(pt => {
                    const idx = this._resolveCandleIdx(pt.time);
                    if (idx >= 0) upperPts.push({ x: this.candleToX(idx) + this.candleWidth / 2, y: this.priceToY(pt.value) });
                });
                ind.fillPairData.forEach(pt => {
                    const idx = this._resolveCandleIdx(pt.time);
                    if (idx >= 0) lowerPts.push({ x: this.candleToX(idx) + this.candleWidth / 2, y: this.priceToY(pt.value) });
                });
                if (upperPts.length > 1 && lowerPts.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(upperPts[0].x, upperPts[0].y);
                    for (let i = 1; i < upperPts.length; i++) ctx.lineTo(upperPts[i].x, upperPts[i].y);
                    for (let i = lowerPts.length - 1; i >= 0; i--) ctx.lineTo(lowerPts[i].x, lowerPts[i].y);
                    ctx.closePath();
                    ctx.fillStyle = ind.fillColor || 'rgba(168, 85, 247, 0.08)';
                    ctx.fill();
                }
            }

            // Per-point multi-color segment rendering (e.g., Supertrend green/red) or standard line
            const hasPerPointColor = ind.data.some(pt => pt.color);
            if (hasPerPointColor) {
                let prev = null;
                for (let i = 0; i < ind.data.length; i++) {
                    const pt = ind.data[i];
                    const candleIdx = this._resolveCandleIdx(pt.time);
                    if (candleIdx < 0) continue;
                    const x = this.candleToX(candleIdx) + this.candleWidth / 2;
                    const y = this.priceToY(pt.value);
                    const segColor = pt.color || ind.color || '#00e676';

                    if (prev && prev.color === segColor) {
                        ctx.beginPath();
                        ctx.strokeStyle = segColor;
                        ctx.moveTo(prev.x, prev.y);
                        if (ind.style === 'stepline') {
                            ctx.lineTo(x, prev.y);
                        }
                        ctx.lineTo(x, y);
                        ctx.stroke();
                    }
                    prev = { x, y, color: segColor };
                }
            } else {
                ctx.strokeStyle = ind.color || '#00f0ff';
                ctx.shadowColor = ind.color || '#00f0ff';
                ctx.shadowBlur = 3;
                ctx.beginPath();
                let started = false;
                let prevIdx = -1;
                let prevY = null;

                for (let i = 0; i < ind.data.length; i++) {
                    const pt = ind.data[i];
                    const candleIdx = this._resolveCandleIdx(pt.time);
                    if (candleIdx >= 0) {
                        const x = this.candleToX(candleIdx) + this.candleWidth / 2;
                        const y = this.priceToY(pt.value);
                        if (!started || (prevIdx >= 0 && candleIdx - prevIdx > 2)) {
                            ctx.moveTo(x, y);
                            started = true;
                        } else {
                            if (ind.style === 'stepline') {
                                ctx.lineTo(x, prevY !== null ? prevY : y);
                            }
                            ctx.lineTo(x, y);
                        }
                        prevIdx = candleIdx;
                        prevY = y;
                    }
                }
                ctx.stroke();
            }
            ctx.restore();
        });
    }

    drawSubpane(ctx) {
        const subpaneY = this.height - this.timeAxisHeight - this.subpaneHeight;
        const chartRight = this.width - this.priceAxisWidth;
        const padTop = 8;
        const padBot = 6;
        const usableH = Math.max(20, this.subpaneHeight - padTop - padBot);

        ctx.save();
        ctx.fillStyle = '#080a10';
        ctx.fillRect(0, subpaneY, chartRight, this.subpaneHeight);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.moveTo(0, subpaneY);
        ctx.lineTo(chartRight, subpaneY);
        ctx.stroke();

        // Clip inside subpane area
        ctx.beginPath();
        ctx.rect(0, subpaneY, chartRight, this.subpaneHeight);
        ctx.clip();

        const rsiInds = this.indicators.filter(ind => ind.pane === 'rsi');
        const macdInds = this.indicators.filter(ind => ind.pane === 'macd');
        const genericSubInds = this.indicators.filter(ind => ind.pane === 'sub');

        // 1. Render RSI (0-100) Oscillator
        if (rsiInds.length) {
            const y70 = subpaneY + padTop + (usableH * 0.3);
            const y30 = subpaneY + padTop + (usableH * 0.7);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, y70); ctx.lineTo(chartRight, y70);
            ctx.moveTo(0, y30); ctx.lineTo(chartRight, y30);
            ctx.stroke();
            ctx.setLineDash([]);

            rsiInds.forEach(ind => {
                if (!ind.data || !ind.data.length) return;
                ctx.strokeStyle = ind.color || '#e040fb';
                ctx.lineWidth = ind.linewidth || 1.6;
                ctx.beginPath();
                let started = false;
                ind.data.forEach(pt => {
                    const candleIdx = this._resolveCandleIdx(pt.time);
                    if (candleIdx >= 0) {
                        const x = this.candleToX(candleIdx) + this.candleWidth / 2;
                        const valRatio = Math.max(0, Math.min(1, (100 - pt.value) / 100));
                        const y = subpaneY + padTop + (valRatio * usableH);
                        if (!started) { ctx.moveTo(x, y); started = true; }
                        else ctx.lineTo(x, y);
                    }
                });
                ctx.stroke();
            });
        }

        // 2. Render MACD (12, 26, 9) + Histogram + Generic Auto-Scaled Subpane Indicators
        const autoInds = [...macdInds, ...genericSubInds];
        if (autoInds.length) {
            let minV = Infinity, maxV = -Infinity;
            autoInds.forEach(ind => {
                (ind.data || []).forEach(pt => {
                    if (isFinite(pt.value)) {
                        if (pt.value < minV) minV = pt.value;
                        if (pt.value > maxV) maxV = pt.value;
                    }
                });
            });
            if (minV === Infinity || maxV === -Infinity) { minV = -1; maxV = 1; }
            if (macdInds.length) { minV = Math.min(minV, 0); maxV = Math.max(maxV, 0); }
            const span = Math.max(1e-8, maxV - minV);
            const valToSubY = (v) => subpaneY + padTop + usableH - (((v - minV) / span) * usableH);

            if (macdInds.length) {
                const zeroY = valToSubY(0);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
                ctx.setLineDash([2, 3]);
                ctx.beginPath();
                ctx.moveTo(0, zeroY);
                ctx.lineTo(chartRight, zeroY);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            autoInds.forEach(ind => {
                if (!ind.data || !ind.data.length) return;
                if (ind.style === 'histogram') {
                    const zeroY = valToSubY(0);
                    const barW = Math.max(2, this.candleWidth * 0.65);
                    ind.data.forEach(pt => {
                        const candleIdx = this._resolveCandleIdx(pt.time);
                        if (candleIdx >= 0) {
                            const x = this.candleToX(candleIdx) + (this.candleWidth - barW) / 2;
                            const y = valToSubY(pt.value);
                            ctx.fillStyle = pt.value >= 0 ? 'rgba(0, 230, 118, 0.55)' : 'rgba(255, 23, 68, 0.55)';
                            ctx.fillRect(x, Math.min(y, zeroY), barW, Math.max(1, Math.abs(y - zeroY)));
                        }
                    });
                } else {
                    ctx.strokeStyle = ind.color || '#00f0ff';
                    ctx.lineWidth = ind.linewidth || 1.5;
                    ctx.beginPath();
                    let started = false;
                    ind.data.forEach(pt => {
                        const candleIdx = this._resolveCandleIdx(pt.time);
                        if (candleIdx >= 0) {
                            const x = this.candleToX(candleIdx) + this.candleWidth / 2;
                            const y = valToSubY(pt.value);
                            if (!started) { ctx.moveTo(x, y); started = true; }
                            else ctx.lineTo(x, y);
                        }
                    });
                    ctx.stroke();
                }
            });
        }
        ctx.restore();

        // Draw Subpane Axis Labels outside clip
        ctx.save();
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(chartRight, subpaneY, this.priceAxisWidth, this.subpaneHeight);
        ctx.strokeStyle = '#1e293b';
        ctx.beginPath();
        ctx.moveTo(chartRight, subpaneY);
        ctx.lineTo(chartRight, subpaneY + this.subpaneHeight);
        ctx.stroke();

        ctx.fillStyle = this.options.textColor;
        ctx.font = 'bold 10px Inter, monospace';
        if (rsiInds.length) {
            const lastRsi = rsiInds[0].data?.[rsiInds[0].data.length - 1]?.value;
            ctx.fillText('70', chartRight + 6, subpaneY + padTop + usableH * 0.3 + 3);
            ctx.fillText('30', chartRight + 6, subpaneY + padTop + usableH * 0.7 + 3);
            if (isFinite(lastRsi)) {
                ctx.fillStyle = '#e040fb';
                ctx.fillText(`RSI ${lastRsi.toFixed(1)}`, chartRight + 6, subpaneY + 14);
            }
        } else if (macdInds.length) {
            const macdMain = macdInds.find(x => x.title === 'MACD') || macdInds[0];
            const lastM = macdMain?.data?.[macdMain.data.length - 1]?.value;
            ctx.fillStyle = '#00f0ff';
            ctx.fillText(isFinite(lastM) ? `MACD ${lastM.toFixed(1)}` : 'MACD', chartRight + 6, subpaneY + 14);
        }
        ctx.restore();
    }

    drawSignals(ctx) {
        if (!this.signals.length) return;

        this.signals.forEach(sig => {
            let candleIdx = this._resolveCandleIdx(sig.time);
            if (candleIdx < 0) {
                candleIdx = this.candles.findIndex(c => Math.abs(c.time - sig.time) < 3600000);
            }
            if (candleIdx < 0) return;

            const x = this.candleToX(candleIdx) + this.candleWidth / 2;
            const c = this.candles[candleIdx];
            const isBuy = sig.type === 'BUY' || sig.shape === 'triangleup';
            const sigColor = sig.color || (isBuy ? '#00e676' : '#ff1744');
            const y = isBuy ? this.priceToY(c.low) + 20 : this.priceToY(c.high) - 20;

            ctx.save();
            ctx.shadowColor = sigColor;
            ctx.shadowBlur = 10;
            ctx.fillStyle = sigColor;

            ctx.beginPath();
            if (isBuy) {
                ctx.moveTo(x, y - 8);
                ctx.lineTo(x - 6, y + 2);
                ctx.lineTo(x + 6, y + 2);
            } else {
                ctx.moveTo(x, y + 8);
                ctx.lineTo(x - 6, y - 2);
                ctx.lineTo(x + 6, y - 2);
            }
            ctx.closePath();
            ctx.fill();

            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            const textY = isBuy ? y + 14 : y - 10;
            ctx.fillText(sig.label || (isBuy ? 'BUY' : 'SELL'), x, textY);
            ctx.restore();
        });
    }

    drawInteractiveOrders(ctx) {
        this._interactiveHitBoxes = [];
        const allItems = [...this.positions, ...this.orders];
        const chartRight = this.width - this.priceAxisWidth;
        const curSym = this.getCurrency();
        const liveClose = (this.candles && this.candles.length) ? this.candles[this.candles.length - 1].close : 0;

        // Avoid cluttering chart with internal bracket child orders if parent position draws TP/SL
        const posIds = new Set(this.positions.map(p => p.id));

        allItems.forEach(item => {
            if (item.parent_pos_id && posIds.has(item.parent_pos_id)) {
                return;
            }
            const entryP = item.entry_price || item.price;
            if (!entryP || !isFinite(entryP)) return;

            const isPosition = !!item.entry_price;
            const side = (item.side || 'buy').toUpperCase();
            const qty = parseFloat(item.quantity || 0);
            const entryY = this.priceToY(entryP);

            item._tpHit = null;
            item._slHit = null;
            item._limitHit = null;

            // Clip interactive lines cleanly above timeline / subpane
            if (entryY >= 4 && entryY <= this.chartHeight - 4) {
                ctx.save();
                ctx.strokeStyle = isPosition ? (side === 'BUY' ? '#00e676' : '#ff3366') : '#00f0ff';
                ctx.lineWidth = isPosition ? 1.8 : 1.5;
                ctx.setLineDash(isPosition ? [6, 3] : [4, 4]);
                ctx.beginPath();
                ctx.moveTo(0, entryY);
                ctx.lineTo(chartRight, entryY);
                ctx.stroke();
                ctx.setLineDash([]);

                if (isPosition) {
                    const markP = liveClose > 0 ? liveClose : (item.current_price || entryP);
                    const diff = side === 'BUY' ? (markP - entryP) : (entryP - markP);
                    const livePnl = diff * qty;
                    const livePct = (diff / entryP) * 100;
                    const isProfit = livePnl >= 0;
                    const pnlSign = isProfit ? '+' : '-';
                    const pnlStr = `${pnlSign}${curSym}${this.formatPrice(Math.abs(livePnl))} (${isProfit ? '+' : ''}${livePct.toFixed(2)}%)`;

                    const label = `${side} ${qty} @ ${this.formatPrice(entryP, true)} │ P&L: ${pnlStr}`;
                    const mainBorder = isProfit ? '#00e676' : '#ff3366';
                    const mainBg = isProfit ? 'rgba(0, 38, 22, 0.92)' : 'rgba(46, 8, 16, 0.92)';

                    ctx.font = 'bold 11px Inter, monospace';
                    const textW = ctx.measureText(label).width;
                    const closeW = 24;
                    const addTpW = !item.take_profit ? 34 : 0;
                    const addSlW = !item.stop_loss ? 34 : 0;
                    const pillW = textW + 16;
                    const totalW = pillW + closeW + addTpW + addSlW + (addTpW ? 4 : 0) + (addSlW ? 4 : 0) + 4;
                    const pillX = Math.max(8, chartRight - totalW - 10);
                    const pillY = entryY - 11;
                    const pillH = 22;

                    // Main Running PnL Entry Badge
                    ctx.fillStyle = mainBg;
                    ctx.strokeStyle = mainBorder;
                    ctx.lineWidth = 1.5;
                    this.roundRect(ctx, pillX, pillY, pillW, pillH, 4);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, pillX + 8, entryY);

                    let cursorX = pillX + pillW + 4;

                    // Quick [+TP] pill if no TP yet
                    if (addTpW > 0) {
                        ctx.fillStyle = 'rgba(0, 230, 118, 0.2)';
                        ctx.strokeStyle = '#00e676';
                        ctx.lineWidth = 1;
                        this.roundRect(ctx, cursorX, pillY, addTpW, pillH, 4);
                        ctx.fill();
                        ctx.stroke();
                        ctx.fillStyle = '#00ff88';
                        ctx.font = 'bold 10px Inter, monospace';
                        ctx.textAlign = 'center';
                        ctx.fillText('+TP', cursorX + addTpW / 2, entryY);
                        this._interactiveHitBoxes.push({
                            action: 'add_tp',
                            item,
                            x: cursorX, y: pillY, w: addTpW, h: pillH
                        });
                        cursorX += addTpW + 4;
                    }

                    // Quick [+SL] pill if no SL yet
                    if (addSlW > 0) {
                        ctx.fillStyle = 'rgba(255, 23, 68, 0.2)';
                        ctx.strokeStyle = '#ff1744';
                        ctx.lineWidth = 1;
                        this.roundRect(ctx, cursorX, pillY, addSlW, pillH, 4);
                        ctx.fill();
                        ctx.stroke();
                        ctx.fillStyle = '#ff6b81';
                        ctx.font = 'bold 10px Inter, monospace';
                        ctx.textAlign = 'center';
                        ctx.fillText('+SL', cursorX + addSlW / 2, entryY);
                        this._interactiveHitBoxes.push({
                            action: 'add_sl',
                            item,
                            x: cursorX, y: pillY, w: addSlW, h: pillH
                        });
                        cursorX += addSlW + 4;
                    }

                    // 1-Click Close Running Position [✕] pill
                    ctx.fillStyle = 'rgba(255, 23, 68, 0.85)';
                    ctx.strokeStyle = '#ff4d6d';
                    ctx.lineWidth = 1;
                    this.roundRect(ctx, cursorX, pillY, closeW, pillH, 4);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 11px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('✕', cursorX + closeW / 2, entryY);
                    this._interactiveHitBoxes.push({
                        action: 'close_pos',
                        item,
                        x: cursorX, y: pillY, w: closeW, h: pillH
                    });
                } else {
                    // Pending Limit Order with [DRAG] & [✕ Cancel Order]
                    const label = `LIMIT ${side} ${qty} @ ${this.formatPrice(entryP, true)} [DRAG]`;
                    ctx.font = 'bold 11px Inter, monospace';
                    const pillW = ctx.measureText(label).width + 16;
                    const closeW = 24;
                    const pillX = Math.max(8, chartRight - pillW - closeW - 14);
                    const pillY = entryY - 11;
                    const pillH = 22;

                    ctx.fillStyle = 'rgba(0, 26, 38, 0.92)';
                    ctx.strokeStyle = '#00f0ff';
                    ctx.lineWidth = 1.5;
                    this.roundRect(ctx, pillX, pillY, pillW, pillH, 4);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, pillX + 8, entryY);

                    const closeX = pillX + pillW + 4;
                    ctx.fillStyle = 'rgba(255, 23, 68, 0.85)';
                    ctx.strokeStyle = '#ff4d6d';
                    ctx.lineWidth = 1;
                    this.roundRect(ctx, closeX, pillY, closeW, pillH, 4);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.fillText('✕', closeX + closeW / 2, entryY);

                    this._interactiveHitBoxes.push({
                        action: 'cancel_order',
                        item,
                        x: closeX, y: pillY, w: closeW, h: pillH
                    });
                    item._limitHit = { y: entryY, price: entryP, xMax: closeX };
                }
                ctx.restore();
            }

            if (item.take_profit) {
                const tpP = item.take_profit;
                const tpY = this.priceToY(tpP);
                if (tpY >= 4 && tpY <= this.chartHeight - 4) {
                    const diff = side === 'BUY' ? (tpP - entryP) : (entryP - tpP);
                    const pnl = diff * qty;
                    const pnlPct = (diff / entryP) * 100;

                    ctx.save();
                    ctx.strokeStyle = '#00e676';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([4, 2]);
                    ctx.shadowColor = 'rgba(0, 230, 118, 0.5)';
                    ctx.shadowBlur = 6;
                    ctx.beginPath();
                    ctx.moveTo(0, tpY);
                    ctx.lineTo(chartRight, tpY);
                    ctx.stroke();
                    ctx.shadowBlur = 0;

                    const label = `TP: ${this.formatPrice(tpP, true)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%) ${pnl >= 0 ? '+' : '-'}${curSym}${this.formatPrice(Math.abs(pnl))} [DRAG]`;
                    ctx.font = 'bold 11px Inter, monospace';
                    const pillW = ctx.measureText(label).width + 16;
                    const closeW = 24;
                    const pillX = Math.max(8, chartRight - pillW - closeW - 14);
                    const pillY = tpY - 10;
                    const pillH = 20;

                    this.drawOrderBadge(ctx, pillX, tpY, label, '#00e676', '#002914', true);

                    const closeX = pillX + pillW + 4;
                    ctx.fillStyle = 'rgba(0, 41, 20, 0.95)';
                    ctx.strokeStyle = '#00e676';
                    ctx.lineWidth = 1.2;
                    this.roundRect(ctx, closeX, pillY, closeW, pillH, 4);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('✕', closeX + closeW / 2, tpY);
                    ctx.restore();

                    this._interactiveHitBoxes.push({
                        action: 'cancel_tp',
                        item,
                        x: closeX, y: pillY, w: closeW, h: pillH
                    });
                    item._tpHit = { y: tpY, price: tpP, xMax: closeX };
                }
            }

            if (item.stop_loss) {
                const slP = item.stop_loss;
                const slY = this.priceToY(slP);
                if (slY >= 4 && slY <= this.chartHeight - 4) {
                    const diff = side === 'BUY' ? (entryP - slP) : (slP - entryP);
                    const loss = diff * qty;
                    const lossPct = (diff / entryP) * 100;

                    ctx.save();
                    ctx.strokeStyle = '#ff1744';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([4, 2]);
                    ctx.shadowColor = 'rgba(255, 23, 68, 0.5)';
                    ctx.shadowBlur = 6;
                    ctx.beginPath();
                    ctx.moveTo(0, slY);
                    ctx.lineTo(chartRight, slY);
                    ctx.stroke();
                    ctx.shadowBlur = 0;

                    const label = `SL: ${this.formatPrice(slP, true)} (-${lossPct.toFixed(1)}%) -${curSym}${this.formatPrice(Math.abs(loss))} [DRAG]`;
                    ctx.font = 'bold 11px Inter, monospace';
                    const pillW = ctx.measureText(label).width + 16;
                    const closeW = 24;
                    const pillX = Math.max(8, chartRight - pillW - closeW - 14);
                    const pillY = slY - 10;
                    const pillH = 20;

                    this.drawOrderBadge(ctx, pillX, slY, label, '#ff1744', '#2b0008', true);

                    const closeX = pillX + pillW + 4;
                    ctx.fillStyle = 'rgba(43, 0, 8, 0.95)';
                    ctx.strokeStyle = '#ff1744';
                    ctx.lineWidth = 1.2;
                    this.roundRect(ctx, closeX, pillY, closeW, pillH, 4);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('✕', closeX + closeW / 2, slY);
                    ctx.restore();

                    this._interactiveHitBoxes.push({
                        action: 'cancel_sl',
                        item,
                        x: closeX, y: pillY, w: closeW, h: pillH
                    });
                    item._slHit = { y: slY, price: slP, xMax: closeX };
                }
            }
        });
    }

    drawOrderBadge(ctx, x, y, text, borderColor, bgColor, isDraggable = false) {
        ctx.font = 'bold 11px Inter, monospace';
        const metrics = ctx.measureText(text);
        const w = metrics.width + 16;
        const h = 20;
        const badgeY = y - h / 2;

        ctx.fillStyle = bgColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, x, badgeY, w, h, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 8, y);
    }

    // --- All Marking Tools Rendering ---
    drawUserDrawings(ctx) {
        const chartRight = this.width - this.priceAxisWidth;

        // 1. Render all saved drawings
        this.drawings.forEach(d => {
            ctx.save();

            if (d.type === 'horizontal') {
                const y = this.priceToY(d.price);
                ctx.strokeStyle = '#ffb300';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(chartRight, y);
                ctx.stroke();
                this.drawDrawingTag(ctx, chartRight - 75, y, `$${d.price.toFixed(2)}`, '#ffb300');
            }
            else if (d.type === 'horizontal_ray') {
                const y = this.priceToY(d.price);
                const x = d.startX - this.offsetX;
                ctx.strokeStyle = '#ffaa00';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(chartRight, y);
                ctx.stroke();
                this.drawDrawingTag(ctx, chartRight - 75, y, `$${d.price.toFixed(2)}`, '#ffaa00');
            }
            else if (d.type === 'vertical') {
                const x = d.startX - this.offsetX;
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.height - this.timeAxisHeight);
                ctx.stroke();
            }
            else if (d.type === 'trendline') {
                const y1 = this.priceToY(d.p1);
                const y2 = this.priceToY(d.p2);
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(d.x1 - this.offsetX, y1);
                ctx.lineTo(d.x2 - this.offsetX, y2);
                ctx.stroke();
            }
            else if (d.type === 'ray') {
                const y1 = this.priceToY(d.p1);
                const y2 = this.priceToY(d.p2);
                const x1 = d.x1 - this.offsetX;
                const x2 = d.x2 - this.offsetX;
                const slope = (y2 - y1) / (x2 - x1 || 1);
                const extendX = chartRight;
                const extendY = y1 + (slope * (extendX - x1));

                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(extendX, extendY);
                ctx.stroke();
            }
            else if (d.type === 'extended') {
                const y1 = this.priceToY(d.p1);
                const y2 = this.priceToY(d.p2);
                const x1 = d.x1 - this.offsetX;
                const x2 = d.x2 - this.offsetX;
                const slope = (y2 - y1) / (x2 - x1 || 1);

                ctx.strokeStyle = '#a855f7';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(0, y1 + slope * (0 - x1));
                ctx.lineTo(chartRight, y1 + slope * (chartRight - x1));
                ctx.stroke();
            }
            else if (d.type === 'channel') {
                const y1 = this.priceToY(d.p1);
                const y2 = this.priceToY(d.p2);
                const x1 = d.x1 - this.offsetX;
                const x2 = d.x2 - this.offsetX;
                const offset = d.offset || 40;

                ctx.strokeStyle = '#00e676';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.moveTo(x1, y1 + offset);
                ctx.lineTo(x2, y2 + offset);
                ctx.stroke();

                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x1, y1 + offset / 2);
                ctx.lineTo(x2, y2 + offset / 2);
                ctx.stroke();
            }
            else if (d.type === 'rectangle') {
                const y1 = this.priceToY(d.p1);
                const y2 = this.priceToY(d.p2);
                const x1 = d.x1 - this.offsetX;
                const x2 = d.x2 - this.offsetX;
                const w = x2 - x1;
                const h = y2 - y1;

                ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 1.5;
                ctx.fillRect(x1, y1, w, h);
                ctx.strokeRect(x1, y1, w, h);
            }
            else if (d.type === 'circle') {
                const y = this.priceToY(d.price);
                const x = d.startX - this.offsetX;
                const radius = d.radius || 35;
                ctx.fillStyle = 'rgba(255, 179, 0, 0.15)';
                ctx.strokeStyle = '#ffb300';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            else if (d.type === 'arrow') {
                const y1 = this.priceToY(d.p1);
                const y2 = this.priceToY(d.p2);
                const x1 = d.x1 - this.offsetX;
                const x2 = d.x2 - this.offsetX;

                ctx.strokeStyle = '#ff1744';
                ctx.fillStyle = '#ff1744';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();

                // Arrowhead
                const angle = Math.atan2(y2 - y1, x2 - x1);
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - 12 * Math.cos(angle - Math.PI / 6), y2 - 12 * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(x2 - 12 * Math.cos(angle + Math.PI / 6), y2 - 12 * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fill();
            }
            else if (d.type === 'brush') {
                if (d.points && d.points.length > 1) {
                    ctx.strokeStyle = '#00e676';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(d.points[0].x - this.offsetX, d.points[0].y);
                    for (let i = 1; i < d.points.length; i++) {
                        ctx.lineTo(d.points[i].x - this.offsetX, d.points[i].y);
                    }
                    ctx.stroke();
                }
            }
            else if (d.type === 'text') {
                const y = this.priceToY(d.price);
                const x = d.startX - this.offsetX;
                ctx.font = 'bold 12px Inter, sans-serif';
                ctx.fillStyle = 'rgba(15, 19, 30, 0.85)';
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 1;
                const txtW = ctx.measureText(d.text).width + 16;
                this.roundRect(ctx, x, y - 12, txtW, 24, 4);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#ffffff';
                ctx.fillText(d.text, x + 8, y + 4);
            }
            else if (d.type === 'price_label') {
                const y = this.priceToY(d.price);
                const x = d.startX - this.offsetX;
                this.drawDrawingTag(ctx, x, y, `$${d.price.toFixed(2)}`, '#00f0ff');
            }
            else if (d.type === 'fibonacci') {
                const diff = d.high - d.low;
                const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
                const colors = ['#00e676', '#00f0ff', '#ffb300', '#a855f7', '#ff8a9e', '#ff1744', '#ffffff'];

                levels.forEach((lvl, idx) => {
                    const price = d.high - (diff * lvl);
                    const y = this.priceToY(price);
                    ctx.strokeStyle = colors[idx];
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(chartRight, y);
                    ctx.stroke();
                    ctx.fillStyle = colors[idx];
                    ctx.font = '10px Inter, monospace';
                    ctx.fillText(`${lvl} ($${price.toFixed(2)})`, 10, y - 3);
                });
            }
            else if (d.type === 'long_position') {
                const entryY = this.priceToY(d.entry);
                const tpY = this.priceToY(d.tp);
                const slY = this.priceToY(d.sl);
                const x1 = d.startX - this.offsetX;
                const x2 = x1 + 180;

                // Profit Green Box
                ctx.fillStyle = 'rgba(0, 230, 118, 0.18)';
                ctx.fillRect(x1, tpY, x2 - x1, entryY - tpY);
                // Loss Red Box
                ctx.fillStyle = 'rgba(255, 23, 68, 0.18)';
                ctx.fillRect(x1, entryY, x2 - x1, slY - entryY);

                ctx.strokeStyle = '#00e676';
                ctx.strokeRect(x1, tpY, x2 - x1, entryY - tpY);
                ctx.strokeStyle = '#ff1744';
                ctx.strokeRect(x1, entryY, x2 - x1, slY - entryY);

                const reward = d.tp - d.entry;
                const risk = d.entry - d.sl;
                const rr = risk > 0 ? (reward / risk).toFixed(2) : '2.00';
                this.drawDrawingTag(ctx, x1 + 10, entryY, `LONG R:R ${rr} | TP: $${d.tp.toFixed(0)} | SL: $${d.sl.toFixed(0)}`, '#00f0ff');
            }
            else if (d.type === 'short_position') {
                const entryY = this.priceToY(d.entry);
                const tpY = this.priceToY(d.tp);
                const slY = this.priceToY(d.sl);
                const x1 = d.startX - this.offsetX;
                const x2 = x1 + 180;

                // Stop Red Box (above)
                ctx.fillStyle = 'rgba(255, 23, 68, 0.18)';
                ctx.fillRect(x1, slY, x2 - x1, entryY - slY);
                // Profit Green Box (below)
                ctx.fillStyle = 'rgba(0, 230, 118, 0.18)';
                ctx.fillRect(x1, entryY, x2 - x1, tpY - entryY);

                ctx.strokeStyle = '#ff1744';
                ctx.strokeRect(x1, slY, x2 - x1, entryY - slY);
                ctx.strokeStyle = '#00e676';
                ctx.strokeRect(x1, entryY, x2 - x1, tpY - entryY);

                const reward = d.entry - d.tp;
                const risk = d.sl - d.entry;
                const rr = risk > 0 ? (reward / risk).toFixed(2) : '2.00';
                this.drawDrawingTag(ctx, x1 + 10, entryY, `SHORT R:R ${rr} | TP: $${d.tp.toFixed(0)} | SL: $${d.sl.toFixed(0)}`, '#ff1744');
            }
            else if (d.type === 'measure') {
                const y1 = this.priceToY(d.p1);
                const y2 = this.priceToY(d.p2);
                const x1 = d.x1 - this.offsetX;
                const x2 = d.x2 - this.offsetX;

                ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 1;
                ctx.fillRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1));
                ctx.strokeRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1));

                const diff = d.p2 - d.p1;
                const pct = (diff / d.p1) * 100;
                this.drawDrawingTag(ctx, x1 + 8, Math.min(y1, y2) + 14, `${diff >= 0 ? '+' : ''}$${diff.toFixed(2)} (${pct.toFixed(2)}%)`, '#00f0ff');
            }

            ctx.restore();
        });

        // 2. Render pending drawing in progress
        if (this.pendingDrawing) {
            ctx.save();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);

            if (['trendline', 'ray', 'extended'].includes(this.pendingDrawing.type)) {
                ctx.beginPath();
                ctx.moveTo(this.pendingDrawing.startX - this.offsetX, this.pendingDrawing.startY);
                ctx.lineTo(this.mousePos.x, this.mousePos.y);
                ctx.stroke();
            } else if (this.pendingDrawing.type === 'rectangle') {
                const x1 = this.pendingDrawing.startX - this.offsetX;
                const y1 = this.pendingDrawing.startY;
                ctx.strokeRect(x1, y1, this.mousePos.x - x1, this.mousePos.y - y1);
            }
            ctx.restore();
        }
    }

    drawDrawingTag(ctx, x, y, text, color) {
        ctx.font = 'bold 10px Inter, monospace';
        const txtW = ctx.measureText(text).width + 12;
        ctx.fillStyle = 'rgba(10, 13, 20, 0.9)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        this.roundRect(ctx, x, y - 9, txtW, 18, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 6, y);
    }

    drawCrosshair(ctx) {
        const { x, y } = this.mousePos;
        const chartRight = this.width - this.priceAxisWidth;
        const chartBottom = this.height - this.timeAxisHeight;

        if (x < 0 || x > chartRight || y < 0 || y > chartBottom) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, chartBottom);
        ctx.moveTo(0, y);
        ctx.lineTo(chartRight, y);
        ctx.stroke();
        ctx.restore();

        // Price Badge on Right Axis
        const price = this.yToPrice(y);
        ctx.save();
        ctx.fillStyle = '#1e2430';
        ctx.strokeStyle = this.options.accentColor;
        ctx.lineWidth = 1;
        this.roundRect(ctx, chartRight + 2, y - 10, this.priceAxisWidth - 4, 20, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Inter, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.formatPrice(price), chartRight + (this.priceAxisWidth / 2), y);
        ctx.restore();

        // Time Badge on Bottom Axis & HUD
        const candleIdx = this.xToCandleIndex(x);
        const candle = this.candles[candleIdx];
        if (candle) {
            const dateStr = new Date(candle.time).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            ctx.save();
            ctx.fillStyle = '#1e2430';
            ctx.strokeStyle = this.options.accentColor;
            ctx.lineWidth = 1;
            const badgeW = 90;
            this.roundRect(ctx, x - badgeW / 2, chartBottom + 4, badgeW, 22, 3);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Inter, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(dateStr, x, chartBottom + 15);
            ctx.restore();

            this.drawHUD(ctx, candle);
        }
    }

    drawHUD(ctx, candle) {
        ctx.save();
        ctx.font = '12px Inter, monospace';
        const isBullish = candle.close >= candle.open;
        const color = isBullish ? '#00e676' : '#ff1744';

        const text = `O: ${this.formatPrice(candle.open)}  H: ${this.formatPrice(candle.high)}  L: ${this.formatPrice(candle.low)}  C: ${this.formatPrice(candle.close)}  V: ${candle.volume.toFixed(1)}`;

        ctx.fillStyle = 'rgba(7, 9, 14, 0.75)';
        this.roundRect(ctx, 10, 10, ctx.measureText(text).width + 16, 24, 4);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 18, 22);
        ctx.restore();
    }

    /**
     * Ongoing Live Price Line touching the latest candlestick
     * Draws a laser dashed line connecting the forming candle's close price to the price axis,
     * complete with a pulsating neon beacon dot right where it touches the candlestick.
     */
    drawLivePriceLine(ctx) {
        if (!this.candles || !this.candles.length) return;
        const lastIdx = this.candles.length - 1;
        const lastCandle = this.candles[lastIdx];
        if (!lastCandle) return;

        const liveY = this.priceToY(lastCandle.close);
        const lastCandleX = this.candleToX(lastIdx);
        const chartRight = this.width - this.priceAxisWidth;
        const isBullish = lastCandle.close >= lastCandle.open;
        const lineColor = isBullish ? '#00e676' : '#ff1744';

        // Start where the line touches the right side of the candlestick
        const touchX = Math.max(0, lastCandleX + this.candleWidth);

        // 1. Live Horizontal Price Line from candle touch point to price axis
        ctx.save();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.shadowColor = lineColor;
        ctx.shadowBlur = 8;

        ctx.beginPath();
        ctx.moveTo(touchX, liveY);
        ctx.lineTo(chartRight, liveY);
        ctx.stroke();
        ctx.restore();

        // 2. Pulsing Neon Dot right where it touches the candlestick
        if (touchX >= 0 && touchX <= chartRight) {
            const time = Date.now() * 0.006;
            const pulse = 1 + 0.35 * Math.sin(time);

            ctx.save();
            // Outer glowing beacon halo
            ctx.fillStyle = isBullish ? 'rgba(0, 230, 118, 0.28)' : 'rgba(255, 23, 68, 0.28)';
            ctx.beginPath();
            ctx.arc(touchX, liveY, 7 * pulse, 0, Math.PI * 2);
            ctx.fill();

            // Inner solid white core touching the candle
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = lineColor;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(touchX, liveY, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    /**
     * DEDICATED VISIBLE BOTTOM TIMELINE & RIGHT PRICE AXIS
     */
    drawAxes(ctx) {
        const chartRight = this.width - this.priceAxisWidth;
        const timelineY = this.height - this.timeAxisHeight;

        // --- 1. BOTTOM TIMELINE BAR ---
        ctx.save();
        // Background rail for timeline with dark metallic sheen
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(0, timelineY, this.width, this.timeAxisHeight);

        // Top border dividing chart and timeline
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, timelineY);
        ctx.lineTo(this.width, timelineY);
        ctx.stroke();

        // Timeline Step Ticks & Date/Hour Labels
        const { startIdx, endIdx } = this.visibleRange;
        const visibleCount = endIdx - startIdx;
        const step = Math.max(1, Math.floor(visibleCount / 8));

        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (let i = startIdx; i <= endIdx; i += step) {
            const candle = this.candles[i];
            if (!candle) continue;

            const x = this.candleToX(i) + this.candleWidth / 2;
            if (x < 10 || x > chartRight - 10) continue;

            // Tick mark line
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, timelineY);
            ctx.lineTo(x, timelineY + 6);
            ctx.stroke();

            // Date / Time formatting
            const d = new Date(candle.time);
            const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const label = `${dateStr} ${timeStr}`;

            ctx.fillText(label, x, timelineY + 8);
        }
        ctx.restore();

        // --- 2. RIGHT PRICE AXIS RAIL ---
        ctx.save();
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(chartRight, 0, this.priceAxisWidth, timelineY);

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(chartRight, 0);
        ctx.lineTo(chartRight, timelineY);
        ctx.stroke();

        // Clip right price axis strictly inside main chart area (above subpane & bottom timeline)
        const priceRailBottom = Math.max(40, this.chartHeight || timelineY);
        ctx.beginPath();
        ctx.rect(chartRight, 0, this.priceAxisWidth, priceRailBottom);
        ctx.clip();

        // Price Axis Ticks (Clean crisp neutral text, zero stray glow shadow)
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = this.options.textColor || '#8a99ad';
        ctx.font = '10px Inter, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const stepCount = 8;
        const pStep = (this.priceRange.max - this.priceRange.min) / stepCount;
        for (let i = 0; i <= stepCount; i++) {
            const p = this.priceRange.min + i * pStep;
            const y = this.priceToY(p);
            if (y >= 10 && y <= priceRailBottom - 10) {
                ctx.fillText(this.formatPrice(p), chartRight + 6, y);
            }
        }

        // Current Market Price Pill (Drawn cleanly above grid ticks)
        if (this.candles.length) {
            const lastCandle = this.candles[this.candles.length - 1];
            const liveY = Math.max(12, Math.min(priceRailBottom - 12, this.priceToY(lastCandle.close)));
            const isBullish = lastCandle.close >= lastCandle.open;
            const badgeColor = isBullish ? '#00e676' : '#ff1744';

            ctx.fillStyle = badgeColor;
            ctx.shadowColor = badgeColor;
            ctx.shadowBlur = 8;
            this.roundRect(ctx, chartRight + 2, liveY - 10, this.priceAxisWidth - 4, 20, 4);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';

            ctx.fillStyle = '#000000';
            ctx.font = 'bold 11px Inter, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.formatPrice(lastCandle.close), chartRight + (this.priceAxisWidth / 2), liveY);
        }

        // Interactive Floating '+' Order Trigger on Price Scale when hovering
        this._pricePlusHit = null;
        if (this.mousePos && this.mousePos.x >= 0 && this.mousePos.y >= 12 && this.mousePos.y <= priceRailBottom - 12) {
            const plusX = chartRight - 14;
            const plusY = this.mousePos.y;
            this._pricePlusHit = { x: plusX, y: plusY, r: 10, price: this.yToPrice(plusY) };

            ctx.restore(); // exit price axis clip to draw '+' just left of price rail
            ctx.save();
            ctx.fillStyle = '#1e293b';
            ctx.strokeStyle = '#00f0ff';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(plusX, plusY, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#00f0ff';
            ctx.font = 'bold 13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', plusX, plusY + 0.5);
        }
        ctx.restore();
    }

    startRenderLoop() {
        const loop = () => {
            if (!this.isDraggingChart && (Math.abs(this.velocityX) > 0.25 || Math.abs(this.velocityY) > 0.25)) {
                this.offsetX = Math.max(0, this.offsetX + this.velocityX);
                this.offsetY += this.velocityY;
                this.velocityX *= 0.88;
                this.velocityY *= 0.88;
                this.autoScale = false;
            }
            this.render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    // --- Interactive Mouse & Touch Handlers ---

    _handleInteractiveHitClick(x, y, clientX, clientY) {
        // Check Jump to Live Candle Button
        if (this.jumpButtonRect && !this.isLiveCandleVisible()) {
            const dist = Math.hypot(x - this.jumpButtonRect.x, y - this.jumpButtonRect.y);
            if (dist <= this.jumpButtonRect.r + 5) {
                this.centerOnLiveCandle();
                return true;
            }
        }

        // Check '+' Price Scale Button -> open order menu at cursor price
        if (this._pricePlusHit && Math.hypot(x - this._pricePlusHit.x, y - this._pricePlusHit.y) <= this._pricePlusHit.r + 5) {
            if (this.onContextMenuRequest) {
                this.onContextMenuRequest(clientX, clientY, this._pricePlusHit.price, this);
            }
            return true;
        }

        // Check On-Chart Close / Cancel TP / Cancel SL / Cancel Limit / +TP / +SL buttons
        if (this._interactiveHitBoxes && this._interactiveHitBoxes.length) {
            for (const box of this._interactiveHitBoxes) {
                if (x >= box.x - 4 && x <= box.x + box.w + 4 && y >= box.y - 4 && y <= box.y + box.h + 4) {
                    if (box.action === 'close_pos' && this.onOrderClose) {
                        this.onOrderClose(box.item.id, box.item.symbol);
                    } else if (box.action === 'cancel_order' && this.onOrderCancel) {
                        this.onOrderCancel(box.item.id);
                    } else if (box.action === 'cancel_tp' && this.onOrderCancelTpSl) {
                        this.onOrderCancelTpSl(box.item.id, 'tp');
                    } else if (box.action === 'cancel_sl' && this.onOrderCancelTpSl) {
                        this.onOrderCancelTpSl(box.item.id, 'sl');
                    } else if (box.action === 'add_tp' && this.onQuickAttachTpSl) {
                        this.onQuickAttachTpSl(box.item, 'tp');
                    } else if (box.action === 'add_sl' && this.onQuickAttachTpSl) {
                        this.onQuickAttachTpSl(box.item, 'sl');
                    }
                    return true;
                }
            }
        }
        return false;
    }

    _tryStartOrderLineDrag(x, y) {
        const allItems = [...this.positions, ...this.orders];
        for (let item of allItems) {
            if (item._tpHit && Math.abs(y - item._tpHit.y) < 13 && (!item._tpHit.xMax || x < item._tpHit.xMax)) {
                this.draggedLine = { type: 'tp', item: item };
                this.canvas.style.cursor = 'ns-resize';
                return true;
            }
            if (item._slHit && Math.abs(y - item._slHit.y) < 13 && (!item._slHit.xMax || x < item._slHit.xMax)) {
                this.draggedLine = { type: 'sl', item: item };
                this.canvas.style.cursor = 'ns-resize';
                return true;
            }
            if (item._limitHit && Math.abs(y - item._limitHit.y) < 13 && (!item._limitHit.xMax || x < item._limitHit.xMax)) {
                this.draggedLine = { type: 'limit', item: item };
                this.canvas.style.cursor = 'ns-resize';
                return true;
            }
        }
        return false;
    }

    onMouseDown(e) {
        if (e.button !== 0) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // 0. Interactive chart pills (Jump, +, Close, Cancel Order/TP/SL, +TP/+SL)
        if (this._handleInteractiveHitClick(x, y, e.clientX, e.clientY)) return;

        // 1. Check if user clicked on BOTTOM TIMELINE AXIS -> Drag to scale candle width / time
        if (y >= this.height - this.timeAxisHeight) {
            this.isDraggingTimeAxis = true;
            this.axisDragStartX = x;
            this.axisDragStartCandleWidth = this.candleWidth;
            this.canvas.style.cursor = 'ew-resize';
            return;
        }

        // 2. Check if user clicked on RIGHT PRICE AXIS -> Drag to stretch/compress price height
        if (x >= this.width - this.priceAxisWidth) {
            this.isDraggingPriceAxis = true;
            this.axisDragStartY = y;
            this.axisDragStartZoom = this.userPriceZoom;
            this.canvas.style.cursor = 'ns-resize';
            return;
        }

        // 3. Check Draggable Order TP / SL / Limit handles
        if (this._tryStartOrderLineDrag(x, y)) return;

        // 4. Handle Marking Tools (Trendlines, Horizontal, Fibonacci, Long/Short Position)
        if (this.activeTool !== 'cursor') {
            this.handleMarkingToolMouseDown(x, y);
            return;
        }

        // 5. Default Chart Panning (Free 2D Movement)
        this.isDraggingChart = true;
        this.velocityX = 0;
        this.velocityY = 0;
        this.dragStartX = x;
        this.dragStartY = y;
        this._lastPanX = x;
        this._lastPanY = y;
        this._lastPanTs = performance.now();
        this.initialOffsetX = this.offsetX;
        this.initialOffsetY = this.offsetY;
        this.canvas.style.cursor = 'grabbing';
    }

    handleMarkingToolMouseDown(x, y) {
        const p = this.yToPrice(y);
        const chartX = x + this.offsetX;

        if (this.activeTool === 'horizontal') {
            this.drawings.push({ type: 'horizontal', price: p });
        } else if (this.activeTool === 'horizontal_ray') {
            this.drawings.push({ type: 'horizontal_ray', price: p, startX: chartX });
        } else if (this.activeTool === 'vertical') {
            this.drawings.push({ type: 'vertical', startX: chartX });
        } else if (this.activeTool === 'circle') {
            this.drawings.push({ type: 'circle', price: p, startX: chartX, radius: 35 });
        } else if (this.activeTool === 'price_label') {
            this.drawings.push({ type: 'price_label', price: p, startX: chartX });
        } else if (this.activeTool === 'text') {
            const txt = prompt("Enter text note for chart:", "Order Block Zone");
            if (txt) {
                this.drawings.push({ type: 'text', price: p, startX: chartX, text: txt });
            }
        } else if (this.activeTool === 'long_position') {
            this.drawings.push({
                type: 'long_position',
                entry: p,
                tp: p * 1.03,
                sl: p * 0.985,
                startX: chartX
            });
        } else if (this.activeTool === 'short_position') {
            this.drawings.push({
                type: 'short_position',
                entry: p,
                tp: p * 0.97,
                sl: p * 1.015,
                startX: chartX
            });
        } else if (this.activeTool === 'brush') {
            this.brushPoints = [{ x: chartX, y: y }];
            this.pendingDrawing = { type: 'brush' };
        } else if (['trendline', 'ray', 'extended', 'channel', 'fibonacci', 'rectangle', 'arrow', 'measure'].includes(this.activeTool)) {
            if (!this.pendingDrawing) {
                this.pendingDrawing = {
                    type: this.activeTool,
                    startX: chartX,
                    startY: y,
                    p1: p
                };
            } else {
                this.drawings.push({
                    type: this.activeTool,
                    x1: this.pendingDrawing.startX,
                    p1: this.pendingDrawing.p1,
                    x2: chartX,
                    p2: p,
                    high: Math.max(this.pendingDrawing.p1, p),
                    low: Math.min(this.pendingDrawing.p1, p)
                });
                this.pendingDrawing = null;
            }
        }
        this.render();
    }

    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mousePos.x = e.clientX - rect.left;
        this.mousePos.y = e.clientY - rect.top;

        // 1. Dragging Time Axis horizontally -> scale candle width / zoom time
        if (this.isDraggingTimeAxis) {
            const deltaX = this.mousePos.x - this.axisDragStartX;
            const factor = Math.exp(deltaX * 0.005);
            this.candleWidth = Math.max(this.options.minCandleWidth, Math.min(this.options.maxCandleWidth, this.axisDragStartCandleWidth * factor));
            this.candleGap = Math.max(1, Math.round(this.candleWidth * 0.4));
            this.render();
            return;
        }

        // 2. Dragging Price Axis vertically -> stretch / compress candle heights
        if (this.isDraggingPriceAxis) {
            const deltaY = this.mousePos.y - this.axisDragStartY;
            const factor = Math.exp(deltaY * 0.006);
            this.userPriceZoom = Math.max(0.15, Math.min(6.0, this.axisDragStartZoom * factor));
            this.autoScale = false;
            this.render();
            return;
        }

        // 3. Dragging TP, SL, or Limit handle
        if (this.draggedLine) {
            const newPrice = Math.max(0.000001, this.yToPrice(this.mousePos.y));
            if (this.draggedLine.type === 'tp') {
                this.draggedLine.item.take_profit = newPrice;
            } else if (this.draggedLine.type === 'sl') {
                this.draggedLine.item.stop_loss = newPrice;
            } else if (this.draggedLine.type === 'limit') {
                this.draggedLine.item.price = newPrice;
            }
            this.render();
            return;
        }

        // 4. Brush Freehand Drawing
        if (this.activeTool === 'brush' && this.pendingDrawing) {
            this.brushPoints.push({ x: this.mousePos.x + this.offsetX, y: this.mousePos.y });
            this.render();
            return;
        }

        // 5. Chart Panning (Free 2D Movement with Velocity Tracking)
        if (this.isDraggingChart) {
            const nowTs = performance.now();
            const dt = Math.max(1, nowTs - (this._lastPanTs || nowTs));
            if (dt < 80) {
                this.velocityX = Math.max(-45, Math.min(45, (this._lastPanX - this.mousePos.x) * (16 / dt) * 0.55));
                this.velocityY = Math.max(-45, Math.min(45, (this.mousePos.y - this._lastPanY) * (16 / dt) * 0.55));
            }
            this._lastPanX = this.mousePos.x;
            this._lastPanY = this.mousePos.y;
            this._lastPanTs = nowTs;

            const deltaX = this.dragStartX - this.mousePos.x;
            const deltaY = this.mousePos.y - this.dragStartY;
            this.offsetX = Math.max(0, this.initialOffsetX + deltaX);
            this.offsetY = this.initialOffsetY + deltaY;
            this.autoScale = false;
            return;
        }

        // Hover over Jump to Live Candle Button
        if (this.jumpButtonRect && !this.isLiveCandleVisible()) {
            const dist = Math.hypot(this.mousePos.x - this.jumpButtonRect.x, this.mousePos.y - this.jumpButtonRect.y);
            if (dist <= this.jumpButtonRect.r + 4) {
                this.canvas.style.cursor = 'pointer';
                return;
            }
        }

        // Cursor Styling
        if (this.mousePos.y >= this.height - this.timeAxisHeight) {
            this.canvas.style.cursor = 'ew-resize';
            return;
        }
        if (this.mousePos.x >= this.width - this.priceAxisWidth) {
            this.canvas.style.cursor = 'ns-resize';
            return;
        }

        // Hover over On-Chart Action Pills or '+' Price Trigger
        if (this._pricePlusHit && Math.hypot(this.mousePos.x - this._pricePlusHit.x, this.mousePos.y - this._pricePlusHit.y) <= this._pricePlusHit.r + 5) {
            this.canvas.style.cursor = 'pointer';
            return;
        }
        if (this._interactiveHitBoxes && this._interactiveHitBoxes.some(b =>
            this.mousePos.x >= b.x - 4 && this.mousePos.x <= b.x + b.w + 4 &&
            this.mousePos.y >= b.y - 4 && this.mousePos.y <= b.y + b.h + 4
        )) {
            this.canvas.style.cursor = 'pointer';
            return;
        }

        // Order Handle Hover
        const allItems = [...this.positions, ...this.orders];
        let hoveringHandle = false;
        for (let item of allItems) {
            if ((item._tpHit && Math.abs(this.mousePos.y - item._tpHit.y) < 13) ||
                (item._slHit && Math.abs(this.mousePos.y - item._slHit.y) < 13) ||
                (item._limitHit && Math.abs(this.mousePos.y - item._limitHit.y) < 13)) {
                hoveringHandle = true;
                break;
            }
        }
        this.canvas.style.cursor = hoveringHandle ? 'ns-resize' : 'crosshair';
    }

    onMouseUp() {
        if (this.isDraggingTimeAxis) {
            this.isDraggingTimeAxis = false;
        }
        if (this.isDraggingPriceAxis) {
            this.isDraggingPriceAxis = false;
        }
        if (this.isDraggingChart) {
            this.isDraggingChart = false;
        }
        if (this.draggedLine) {
            const item = this.draggedLine.item;
            if (this.draggedLine.type === 'limit') {
                if (this.onLimitPriceUpdate) {
                    this.onLimitPriceUpdate(item.id, item.price);
                }
            } else if (this.onOrderUpdate) {
                this.onOrderUpdate(item.id, item.take_profit, item.stop_loss);
            }
            this.draggedLine = null;
        }
        if (this.activeTool === 'brush' && this.pendingDrawing) {
            this.drawings.push({ type: 'brush', points: [...this.brushPoints] });
            this.pendingDrawing = null;
            this.brushPoints = [];
            this.render();
        }
        this.canvas.style.cursor = 'crosshair';
    }

    onDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Double-click on bottom timeline -> reset candle width
        if (y >= this.height - this.timeAxisHeight) {
            this.candleWidth = 14;
            this.candleGap = 6;
            this.render();
            return;
        }

        // Double-click on price axis -> reset vertical price zoom & offset
        if (x >= this.width - this.priceAxisWidth) {
            this.userPriceZoom = 1.0;
            this.offsetY = 0;
            this.autoScale = true;
            this.render();
            return;
        }

        this.resetView();
    }

    onWheel(e) {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
        const newWidth = Math.min(this.options.maxCandleWidth, Math.max(this.options.minCandleWidth, this.candleWidth * zoomFactor));

        if (newWidth !== this.candleWidth) {
            const mouseX = this.mousePos ? this.mousePos.x : (this.width / 2);
            const oldStep = this.candleWidth + this.candleGap;
            const candleUnderMouse = (mouseX + this.offsetX) / oldStep;
            this.candleWidth = newWidth;
            this.candleGap = Math.max(1, Math.round(newWidth * 0.4));
            const newStep = this.candleWidth + this.candleGap;
            const maxOffset = Math.max(0, this.candles.length * newStep);
            this.offsetX = Math.max(0, Math.min(maxOffset + 200, (candleUnderMouse * newStep) - mouseX));
            this.render();
        }
    }

    onContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const price = this.yToPrice(y);

        if (this.onContextMenuRequest) {
            this.onContextMenuRequest(e.clientX, e.clientY, price, this);
        }
    }

    // Enhanced Touch Support (Pan, Pinch Zoom, Long Press Context Menu)
    onTouchStart(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();

        // 1. Double touch -> Pinch to zoom
        if (e.touches.length === 2) {
            this.clearTouchLongPress();
            this.isDraggingChart = false;
            this.isDraggingTimeAxis = false;
            this.isDraggingPriceAxis = false;
            this.initialPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            this.initialPinchCandleWidth = this.candleWidth;
            return;
        }

        // 2. Single touch -> Pan (left/right & up/down), Axis scale, or Long Press for Context Menu
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            this.touchStartX = touch.clientX;
            this.touchStartY = touch.clientY;
            this.clearTouchLongPress();

            // Check Interactive On-Chart Pills (Close, Cancel Order/TP/SL, +TP/+SL, Jump) on single tap
            if (this._handleInteractiveHitClick(x, y, touch.clientX, touch.clientY)) return;

            // Check TP / SL / Limit Line drag on touch
            if (this._tryStartOrderLineDrag(x, y)) return;

            // Long-press detection (520ms hold without moving -> open context menu on mobile)
            this.touchLongPressTimer = setTimeout(() => {
                const ev = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                this.canvas.dispatchEvent(ev);
            }, 520);

            if (y >= this.height - this.timeAxisHeight) {
                this.isDraggingTimeAxis = true;
                this.axisDragStartX = x;
                this.axisDragStartCandleWidth = this.candleWidth;
            } else if (x >= this.width - this.priceAxisWidth) {
                this.isDraggingPriceAxis = true;
                this.axisDragStartY = y;
                this.axisDragStartZoom = this.userPriceZoom;
            } else {
                this.isDraggingChart = true;
                this.velocityX = 0;
                this.velocityY = 0;
                this.dragStartX = x;
                this.dragStartY = y;
                this.initialOffsetX = this.offsetX;
                this.initialOffsetY = this.offsetY;
            }
        }
    }

    clearTouchLongPress() {
        if (this.touchLongPressTimer) {
            clearTimeout(this.touchLongPressTimer);
            this.touchLongPressTimer = null;
        }
    }

    onTouchMove(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();

        // Handle pinch-to-zoom
        if (e.touches.length === 2 && this.initialPinchDist) {
            this.clearTouchLongPress();
            const curDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const ratio = curDist / (this.initialPinchDist || 1);
            this.candleWidth = Math.max(this.options.minCandleWidth, Math.min(this.options.maxCandleWidth, this.initialPinchCandleWidth * ratio));
            this.candleGap = Math.max(1, Math.round(this.candleWidth * 0.4));
            this.render();
            return;
        }

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            // Cancel long press if finger moved more than 8px
            if (this.touchStartX && Math.hypot(touch.clientX - this.touchStartX, touch.clientY - this.touchStartY) > 8) {
                this.clearTouchLongPress();
            }

            if (this.draggedLine) {
                this.clearTouchLongPress();
                const newPrice = Math.max(0.000001, this.yToPrice(y));
                if (this.draggedLine.type === 'tp') {
                    this.draggedLine.item.take_profit = newPrice;
                } else if (this.draggedLine.type === 'sl') {
                    this.draggedLine.item.stop_loss = newPrice;
                } else if (this.draggedLine.type === 'limit') {
                    this.draggedLine.item.price = newPrice;
                }
                this.render();
                return;
            }

            if (this.isDraggingTimeAxis) {
                const deltaX = x - this.axisDragStartX;
                const factor = Math.exp(deltaX * 0.005);
                this.candleWidth = Math.max(this.options.minCandleWidth, Math.min(this.options.maxCandleWidth, this.axisDragStartCandleWidth * factor));
                this.candleGap = Math.max(1, Math.round(this.candleWidth * 0.4));
                this.render();
            } else if (this.isDraggingPriceAxis) {
                const deltaY = y - this.axisDragStartY;
                const factor = Math.exp(deltaY * 0.006);
                this.userPriceZoom = Math.max(0.15, Math.min(6.0, this.axisDragStartZoom * factor));
                this.autoScale = false;
                this.render();
            } else if (this.isDraggingChart) {
                // Free 2D Pan on touch: Left/Right + Up/Down!
                const deltaX = this.dragStartX - x;
                const deltaY = y - this.dragStartY;
                this.offsetX = Math.max(0, this.initialOffsetX + deltaX);
                this.offsetY = this.initialOffsetY + deltaY;
                this.autoScale = false;
                this.render();
            }
        }
    }

    onTouchEnd(e) {
        this.clearTouchLongPress();
        this.initialPinchDist = null;
        this.isDraggingChart = false;
        this.isDraggingTimeAxis = false;
        this.isDraggingPriceAxis = false;
        this.onMouseUp();
    }
}

window.OpenChart3D = OpenChart3D;
window.NexusChart3D = OpenChart3D;
