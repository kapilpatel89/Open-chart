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

        this.candles = [];
        this.indicators = [];
        this.signals = [];
        this.orders = [];
        this.positions = [];

        // Drawing & Marking Tools State
        this.activeTool = 'cursor'; // cursor, trendline, ray, extended, horizontal, horizontal_ray, vertical, channel, fibonacci, fib_extension, rectangle, circle, brush, arrow, text, price_label, long_position, short_position, measure
        this.drawings = [];
        this.pendingDrawing = null;
        this.brushPoints = [];

        // View State
        this.offsetX = 0;          // Horizontal scroll offset (pixels)
        this.candleWidth = this.options.candleWidth;
        this.candleGap = this.options.candleGap;
        this.priceRange = { min: 0, max: 1 };
        this.autoScale = true;
        this.userPriceZoom = 1.0;  // Price vertical scaling factor

        // Interaction State
        this.isDraggingChart = false;
        this.isDraggingTimeAxis = false;
        this.isDraggingPriceAxis = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.initialOffsetX = 0;
        this.axisDragStartX = 0;
        this.axisDragStartY = 0;
        this.axisDragStartCandleWidth = this.candleWidth;
        this.axisDragStartZoom = 1.0;
        this.axisDragStartPriceMid = 0;
        this.mousePos = { x: -1, y: -1 };

        // Draggable Orders State
        this.draggedLine = null;
        this.onOrderUpdate = null;
        this.onContextMenuRequest = null;

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Mouse Events
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', () => this.onMouseUp());
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));

        // Touch Events (Mobiles & Tablets)
        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', () => this.onMouseUp());

        this.startRenderLoop();
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = this.width * this.dpr;
        this.canvas.height = this.height * this.dpr;
        this.ctx.scale(this.dpr, this.dpr);

        // Layout zones
        this.priceAxisWidth = 85;
        this.timeAxisHeight = 34; // Dedicated bottom timeline height

        this.hasSubpane = this.indicators.some(ind => ind.pane === 'rsi' || ind.pane === 'macd');
        this.subpaneHeight = this.hasSubpane ? 90 : 0;
        this.volumeHeight = Math.min(75, this.height * 0.14);

        this.chartHeight = this.height - this.timeAxisHeight - this.subpaneHeight;
        this.mainChartHeight = this.chartHeight - this.volumeHeight;

        this.render();
    }

    showLoading(symbol = '') {
        this.isLoading = true;
        this.loadingSymbol = symbol;
        this.render();
    }

    setCandles(candles, forceReset = true, timeframe = null) {
        this.isLoading = false;
        this.loadingSymbol = '';
        if (timeframe) this.timeframe = timeframe;
        this.candles = candles || [];
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

        const tf = interval || this.timeframe || '1h';
        const tfMs = this.timeframeToMs(tf);
        const last = this.candles[this.candles.length - 1];
        const tickTime = tick.time ? parseInt(tick.time) : Date.now();

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

    setIndicators(indicators) {
        this.indicators = indicators || [];
        this.hasSubpane = this.indicators.some(ind => ind.pane === 'rsi' || ind.pane === 'macd');
        this.subpaneHeight = this.hasSubpane ? 90 : 0;
        this.chartHeight = this.height - this.timeAxisHeight - this.subpaneHeight;
        this.mainChartHeight = this.chartHeight - this.volumeHeight;
        this.render();
    }

    setSignals(signals) {
        this.signals = signals || [];
        this.render();
    }

    setOrders(orders, positions) {
        this.orders = orders || [];
        this.positions = positions || [];
        this.render();
    }

    resetView() {
        if (!this.candles.length) return;
        const totalW = this.candles.length * (this.candleWidth + this.candleGap);
        const viewW = this.width - this.priceAxisWidth;
        this.offsetX = Math.max(0, totalW - viewW + 120);
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
        const { startIdx, endIdx } = this.visibleRange;
        if (startIdx > endIdx || !this.candles.length) return;

        let min = Infinity;
        let max = -Infinity;

        for (let i = startIdx; i <= endIdx; i++) {
            const c = this.candles[i];
            if (!c) continue;
            if (c.low < min) min = c.low;
            if (c.high > max) max = c.high;
        }

        // Active Orders & Positions TP/SL
        [...this.positions, ...this.orders].forEach(item => {
            const p = item.entry_price || item.price;
            if (p) {
                if (p < min) min = p;
                if (p > max) max = p;
            }
            if (item.take_profit) {
                if (item.take_profit < min) min = item.take_profit;
                if (item.take_profit > max) max = item.take_profit;
            }
            if (item.stop_loss) {
                if (item.stop_loss < min) min = item.stop_loss;
                if (item.stop_loss > max) max = item.stop_loss;
            }
        });

        if (min === Infinity || max === -Infinity) {
            min = 100;
            max = 200;
        }

        const padding = (max - min) * 0.1 || 1.0;
        let baseMin = min - padding;
        let baseMax = max + padding;

        // Apply dynamic user vertical price scaling (drag price axis up/down)
        if (this.userPriceZoom !== 1.0) {
            const mid = (baseMin + baseMax) / 2.0;
            const halfSpan = ((baseMax - baseMin) / 2.0) * this.userPriceZoom;
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
        return Math.max(5, Math.min(this.height, chartH - (ratio * chartH) + 15));
    }

    yToPrice(y) {
        const { min, max } = this.priceRange;
        const range = max - min || 1;
        const ratio = (this.mainChartHeight + 15 - y) / this.mainChartHeight;
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
            ctx.strokeStyle = ind.color || '#00f0ff';
            ctx.lineWidth = ind.linewidth || 2;
            ctx.shadowColor = ind.color || '#00f0ff';
            ctx.shadowBlur = 4;

            ctx.beginPath();
            let started = false;

            ind.data.forEach(pt => {
                const candleIdx = this.candles.findIndex(c => c.time === pt.time);
                if (candleIdx >= 0) {
                    const x = this.candleToX(candleIdx) + this.candleWidth / 2;
                    const y = this.priceToY(pt.value);
                    if (!started) {
                        ctx.moveTo(x, y);
                        started = true;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            });

            ctx.stroke();
            ctx.restore();
        });
    }

    drawSubpane(ctx) {
        const subpaneY = this.height - this.timeAxisHeight - this.subpaneHeight;
        const chartRight = this.width - this.priceAxisWidth;

        ctx.save();
        ctx.fillStyle = '#080a10';
        ctx.fillRect(0, subpaneY, chartRight, this.subpaneHeight);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(0, subpaneY);
        ctx.lineTo(chartRight, subpaneY);
        ctx.stroke();

        const y70 = subpaneY + (this.subpaneHeight * 0.3);
        const y30 = subpaneY + (this.subpaneHeight * 0.7);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y70);
        ctx.lineTo(chartRight, y70);
        ctx.moveTo(0, y30);
        ctx.lineTo(chartRight, y30);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = this.options.textColor;
        ctx.font = '10px Inter, monospace';
        ctx.fillText('70', chartRight + 5, y70 + 3);
        ctx.fillText('30', chartRight + 5, y30 + 3);

        this.indicators.filter(ind => ind.pane === 'rsi').forEach(ind => {
            if (!ind.data || !ind.data.length) return;
            ctx.strokeStyle = ind.color || '#e040fb';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;

            ind.data.forEach(pt => {
                const candleIdx = this.candles.findIndex(c => c.time === pt.time);
                if (candleIdx >= 0) {
                    const x = this.candleToX(candleIdx) + this.candleWidth / 2;
                    const valRatio = (100 - pt.value) / 100;
                    const y = subpaneY + (valRatio * this.subpaneHeight);
                    if (!started) {
                        ctx.moveTo(x, y);
                        started = true;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            });
            ctx.stroke();
        });

        ctx.restore();
    }

    drawSignals(ctx) {
        if (!this.signals.length) return;

        this.signals.forEach(sig => {
            const candleIdx = this.candles.findIndex(c => Math.abs(c.time - sig.time) < 30000);
            if (candleIdx < 0) return;

            const x = this.candleToX(candleIdx) + this.candleWidth / 2;
            const c = this.candles[candleIdx];
            const isBuy = sig.type === 'BUY';
            const y = isBuy ? this.priceToY(c.low) + 20 : this.priceToY(c.high) - 20;

            ctx.save();
            ctx.shadowColor = isBuy ? '#00e676' : '#ff1744';
            ctx.shadowBlur = 10;
            ctx.fillStyle = isBuy ? '#00e676' : '#ff1744';

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
            ctx.fillText(sig.label, x, textY);
            ctx.restore();
        });
    }

    drawInteractiveOrders(ctx) {
        const allItems = [...this.positions, ...this.orders];
        const chartRight = this.width - this.priceAxisWidth;

        allItems.forEach(item => {
            const entryP = item.entry_price || item.price;
            if (!entryP) return;

            const isPosition = !!item.entry_price;
            const side = (item.side || 'buy').toUpperCase();
            const qty = item.quantity || 0;

            const entryY = this.priceToY(entryP);
            ctx.save();
            ctx.strokeStyle = '#00f0ff';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            ctx.moveTo(0, entryY);
            ctx.lineTo(chartRight, entryY);
            ctx.stroke();

            this.drawOrderBadge(ctx, chartRight - 165, entryY, `${isPosition ? 'POS' : 'LIMIT'} ${side} ${qty} @ ${entryP.toFixed(2)}`, '#00f0ff', '#001a24');
            ctx.restore();

            if (item.take_profit) {
                const tpP = item.take_profit;
                const tpY = this.priceToY(tpP);
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

                const label = `TP: $${tpP.toFixed(2)} (+${pnlPct.toFixed(1)}%) +$${pnl.toFixed(2)} [DRAG]`;
                this.drawOrderBadge(ctx, chartRight - 225, tpY, label, '#00e676', '#002914', true);
                ctx.restore();

                item._tpHit = { y: tpY, price: tpP };
            }

            if (item.stop_loss) {
                const slP = item.stop_loss;
                const slY = this.priceToY(slP);
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

                const label = `SL: $${slP.toFixed(2)} (-${lossPct.toFixed(1)}%) -$${loss.toFixed(2)} [DRAG]`;
                this.drawOrderBadge(ctx, chartRight - 225, slY, label, '#ff1744', '#2b0008', true);
                ctx.restore();

                item._slHit = { y: slY, price: slP };
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
        ctx.fillText(price.toFixed(2), chartRight + (this.priceAxisWidth / 2), y);
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

        const text = `O: ${candle.open.toFixed(2)}  H: ${candle.high.toFixed(2)}  L: ${candle.low.toFixed(2)}  C: ${candle.close.toFixed(2)}  V: ${candle.volume.toFixed(1)}`;

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

        // Current Market Price Pill
        if (this.candles.length) {
            const lastCandle = this.candles[this.candles.length - 1];
            const liveY = this.priceToY(lastCandle.close);
            const isBullish = lastCandle.close >= lastCandle.open;
            const badgeColor = isBullish ? '#00e676' : '#ff1744';

            ctx.fillStyle = badgeColor;
            ctx.shadowColor = badgeColor;
            ctx.shadowBlur = 8;
            this.roundRect(ctx, chartRight + 2, liveY - 10, this.priceAxisWidth - 4, 20, 4);
            ctx.fill();

            ctx.fillStyle = '#000000';
            ctx.font = 'bold 11px Inter, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(lastCandle.close.toFixed(2), chartRight + (this.priceAxisWidth / 2), liveY);
        }

        // Price Axis Ticks
        ctx.fillStyle = this.options.textColor;
        ctx.font = '10px Inter, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const stepCount = 8;
        const pStep = (this.priceRange.max - this.priceRange.min) / stepCount;
        for (let i = 0; i <= stepCount; i++) {
            const p = this.priceRange.min + i * pStep;
            const y = this.priceToY(p);
            ctx.fillText(p.toFixed(2), chartRight + 8, y);
        }
        ctx.restore();
    }

    startRenderLoop() {
        const loop = () => {
            this.render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    // --- Interactive Mouse & Touch Handlers ---

    onMouseDown(e) {
        if (e.button !== 0) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

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

        // 3. Check Draggable Order TP/SL handles
        const allItems = [...this.positions, ...this.orders];
        for (let item of allItems) {
            if (item._tpHit && Math.abs(y - item._tpHit.y) < 14) {
                this.draggedLine = { type: 'tp', item: item };
                this.canvas.style.cursor = 'ns-resize';
                return;
            }
            if (item._slHit && Math.abs(y - item._slHit.y) < 14) {
                this.draggedLine = { type: 'sl', item: item };
                this.canvas.style.cursor = 'ns-resize';
                return;
            }
        }

        // 4. Handle Marking Tools (Trendlines, Horizontal, Fibonacci, Long/Short Position)
        if (this.activeTool !== 'cursor') {
            this.handleMarkingToolMouseDown(x, y);
            return;
        }

        // 5. Default Chart Panning
        this.isDraggingChart = true;
        this.dragStartX = x;
        this.dragStartY = y;
        this.initialOffsetX = this.offsetX;
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

        // 3. Dragging TP or SL handle
        if (this.draggedLine) {
            const newPrice = this.yToPrice(this.mousePos.y);
            if (this.draggedLine.type === 'tp') {
                this.draggedLine.item.take_profit = newPrice;
            } else if (this.draggedLine.type === 'sl') {
                this.draggedLine.item.stop_loss = newPrice;
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

        // 5. Chart Panning
        if (this.isDraggingChart) {
            const deltaX = this.dragStartX - this.mousePos.x;
            this.offsetX = Math.max(0, this.initialOffsetX + deltaX);
            this.render();
            return;
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

        // Order Handle Hover
        const allItems = [...this.positions, ...this.orders];
        let hoveringHandle = false;
        for (let item of allItems) {
            if ((item._tpHit && Math.abs(this.mousePos.y - item._tpHit.y) < 14) ||
                (item._slHit && Math.abs(this.mousePos.y - item._slHit.y) < 14)) {
                hoveringHandle = true;
                break;
            }
        }
        this.canvas.style.cursor = hoveringHandle ? 'ns-resize' : (this.activeTool !== 'cursor' ? 'crosshair' : 'crosshair');
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
            if (this.onOrderUpdate) {
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

        // Double-click on price axis -> reset vertical price zoom
        if (x >= this.width - this.priceAxisWidth) {
            this.userPriceZoom = 1.0;
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
            const mouseX = this.mousePos.x;
            const candleUnderMouse = (mouseX + this.offsetX) / (this.candleWidth + this.candleGap);
            this.candleWidth = newWidth;
            this.candleGap = Math.max(1, Math.round(newWidth * 0.4));
            this.offsetX = Math.max(0, (candleUnderMouse * (this.candleWidth + this.candleGap)) - mouseX);
            this.render();
        }
    }

    onContextMenu(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const price = this.yToPrice(y);

        if (this.onContextMenuRequest) {
            this.onContextMenuRequest(e.clientX, e.clientY, price);
        }
    }

    // Touch Support
    onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

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
                this.dragStartX = x;
                this.dragStartY = y;
                this.initialOffsetX = this.offsetX;
            }
        }
    }

    onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

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
                const deltaX = this.dragStartX - x;
                this.offsetX = Math.max(0, this.initialOffsetX + deltaX);
                this.render();
            }
        }
    }
}

window.OpenChart3D = OpenChart3D;
window.NexusChart3D = OpenChart3D;
