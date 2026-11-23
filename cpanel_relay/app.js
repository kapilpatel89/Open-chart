/**
 * Kotak AI Trader - High-Speed Web Trading Terminal
 * Implements: PIN Auth (7411), Live Option Chain, Quick Trade,
 * Real-time TP/SL Order Watcher, JSON Persistence & Reports.
 */

'use strict';

// ----------------- CONFIGURATION & STATE -----------------
const CONFIG = {
    // Dynamically determines Base API URL
    apiBaseUrl: window.location.origin + window.location.pathname.replace(/\/(trade\.php|index\.php)?$/, '') + '/trade_api.php',
    defaultUnderlying: 'NIFTY',
    defaultLotSizes: {
        'NIFTY': 65,
        'BANKNIFTY': 30,
        'SENSEX': 20,
        'FINNIFTY': 65,
        'MIDCPNIFTY': 120
    },
    defaultStrikeSteps: {
        'NIFTY': 50,
        'BANKNIFTY': 100,
        'SENSEX': 100,
        'FINNIFTY': 50,
        'MIDCPNIFTY': 25
    }
};

const STATE = {
    authToken: localStorage.getItem('kotak_auth_token') || '',
    isUnlocked: false,
    refreshIntervalMs: parseInt(localStorage.getItem('kotak_refresh_ms') || '1000', 10),
    tradingMode: localStorage.getItem('kotak_trading_mode') || 'PAPER', // 'LIVE' or 'PAPER'
    activeTab: 'trade',
    selectedUnderlying: 'NIFTY',
    selectedOption: {
        symbol: 'NIFTY26NOV24200CE',
        underlying: 'NIFTY',
        strike: 24200,
        optionType: 'CE',
        side: 'BUY',
        currentLtp: 145.50,
        lotSize: 65,
        lots: 1,
        quantity: 65,
        orderType: 'MKT',
        product: 'MIS',
        targetPoints: 10.0,
        slPoints: 10.0,
        limitPrice: 145.50
    },
    quotes: {},
    activeOrders: [],
    tradeReports: { summary: {}, trades: [] },
    previousQuotes: {},
    soundEnabled: true,
    isPolling: false,
    pollTimer: null
};

// ----------------- AUDIO SYNTHESIS (WEB AUDIO API) -----------------
class SoundManager {
    constructor() {
        this.ctx = null;
    }
    init() {
        if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    beep(freq = 440, type = 'sine', duration = 0.1, delay = 0) {
        if (!STATE.soundEnabled) return;
        try {
            this.init();
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime + delay);
            gain.gain.setValueAtTime(0.12, this.ctx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + delay + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(this.ctx.currentTime + delay);
            osc.stop(this.ctx.currentTime + delay + duration);
        } catch (_) {}
    }
    tradePlaced() {
        this.beep(523.25, 'triangle', 0.08, 0);     // C5
        this.beep(659.25, 'triangle', 0.12, 0.08); // E5
        this.beep(783.99, 'triangle', 0.18, 0.16); // G5
    }
    tpHit() {
        this.beep(587.33, 'sine', 0.1, 0);     // D5
        this.beep(739.99, 'sine', 0.1, 0.1);   // F#5
        this.beep(880.00, 'sine', 0.25, 0.2);  // A5
    }
    slHit() {
        this.beep(400, 'sawtooth', 0.15, 0);
        this.beep(280, 'sawtooth', 0.25, 0.12);
    }
    keyPress() {
        this.beep(800, 'sine', 0.03, 0);
    }
}
const audio = new SoundManager();

// ----------------- API CLIENT -----------------
async function apiRequest(action, data = null, method = 'GET') {
    const url = new URL(CONFIG.apiBaseUrl);
    url.searchParams.set('action', action);

    const headers = {
        'Accept': 'application/json'
    };
    if (STATE.authToken) {
        headers['Authorization'] = `Bearer ${STATE.authToken}`;
    }

    const opts = { method, headers };
    if (data && (method === 'POST' || method === 'PUT')) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(data);
    }

    const t0 = performance.now();
    try {
        const resp = await fetch(url.toString(), opts);
        const t1 = performance.now();
        const latency = Math.round(t1 - t0);
        updateLatencyBadge(latency);

        if (resp.status === 401) {
            // PIN Auth Required
            showPinModal();
            return { status: 'error', code: 'AUTH_REQUIRED', message: 'PIN verification required' };
        }

        const json = await resp.json();
        return json;
    } catch (err) {
        console.error(`API Error [${action}]:`, err);
        return { status: 'error', message: err.message };
    }
}

// ----------------- PIN AUTHENTICATION (PIN 7411) -----------------
let enteredPin = '';

function setupPinModal() {
    const overlay = document.getElementById('pinOverlay');
    const dots = document.querySelectorAll('.pin-dot');
    const msg = document.getElementById('pinMsg');
    const keypad = document.getElementById('pinKeypad');

    function updateDots() {
        dots.forEach((dot, idx) => {
            dot.classList.toggle('filled', idx < enteredPin.length);
            dot.classList.remove('error');
        });
    }

    async function handlePinSubmit() {
        if (enteredPin.length !== 4) return;
        msg.textContent = 'Verifying PIN...';
        msg.className = 'pin-msg';

        const res = await apiRequest('auth_pin', { pin: enteredPin }, 'POST');
        if (res.status === 'success' && res.token) {
            STATE.authToken = res.token;
            localStorage.setItem('kotak_auth_token', res.token);
            STATE.isUnlocked = true;
            msg.textContent = 'Unlocked!';
            msg.className = 'pin-msg success';
            audio.tradePlaced();
            setTimeout(() => {
                overlay.classList.add('hidden');
                startPollingLoop();
            }, 300);
        } else {
            audio.slHit();
            msg.textContent = res.message || 'Incorrect PIN. Try 7411.';
            msg.className = 'pin-msg error';
            dots.forEach(d => d.classList.add('error'));
            setTimeout(() => {
                enteredPin = '';
                updateDots();
                msg.textContent = 'Enter 4-Digit Security PIN';
                msg.className = 'pin-msg';
            }, 800);
        }
    }

    keypad.addEventListener('click', (e) => {
        const btn = e.target.closest('.pin-key');
        if (!btn) return;
        audio.keyPress();
        const key = btn.dataset.key;
        if (key === 'clear') {
            enteredPin = '';
        } else if (key === 'back') {
            enteredPin = enteredPin.slice(0, -1);
        } else if (key && enteredPin.length < 4) {
            enteredPin += key;
        }
        updateDots();
        if (enteredPin.length === 4) {
            handlePinSubmit();
        }
    });

    // Support Physical Keyboard
    window.addEventListener('keydown', (e) => {
        if (overlay.classList.contains('hidden')) return;
        if (e.key >= '0' && e.key <= '9' && enteredPin.length < 4) {
            audio.keyPress();
            enteredPin += e.key;
            updateDots();
            if (enteredPin.length === 4) handlePinSubmit();
        } else if (e.key === 'Backspace') {
            audio.keyPress();
            enteredPin = enteredPin.slice(0, -1);
            updateDots();
        } else if (e.key === 'Escape') {
            enteredPin = '';
            updateDots();
        }
    });
}

function showPinModal() {
    const overlay = document.getElementById('pinOverlay');
    enteredPin = '';
    document.querySelectorAll('.pin-dot').forEach(d => d.className = 'pin-dot');
    document.getElementById('pinMsg').textContent = 'Enter 4-Digit Security PIN (7411)';
    overlay.classList.remove('hidden');
    STATE.isUnlocked = false;
    stopPollingLoop();
}

function lockTerminal() {
    STATE.authToken = '';
    localStorage.removeItem('kotak_auth_token');
    showPinModal();
}

// ----------------- HIGH-SPEED POLLING ENGINE -----------------
function updateLatencyBadge(ms) {
    const el = document.getElementById('latencyBadge');
    if (el) {
        el.textContent = `${ms}ms`;
        el.style.color = ms < 100 ? 'var(--cyber-green)' : (ms < 250 ? 'var(--cyber-amber)' : 'var(--cyber-red)');
    }
}

async function runHighSpeedCycle() {
    if (!STATE.isUnlocked) return;

    try {
        // 1. Fetch Market Quotes
        const quotesRes = await apiRequest('quotes');
        if (quotesRes.status === 'success' && quotesRes.quotes) {
            updateTickersBar(quotesRes.quotes);
        }

        // 2. Sync Active Orders & Check for TP / SL Triggers
        const syncRes = await apiRequest('sync_bracket_orders');
        if (syncRes.status === 'success') {
            STATE.activeOrders = syncRes.active_orders || [];
            renderActiveOrders();

            // Check if any order triggered TP or SL
            if (syncRes.triggered_count > 0 && syncRes.triggered_trades) {
                syncRes.triggered_trades.forEach(trade => {
                    const isProfit = trade.status === 'PROFIT';
                    const icon = isProfit ? '🎯 TAKE PROFIT HIT' : '🛡️ STOP LOSS HIT';
                    showToast(`${icon}: ${trade.symbol} • P&L: ₹${trade.pnl} (${trade.points} pts)`, isProfit ? 'success' : 'alert');
                    if (isProfit) audio.tpHit(); else audio.slHit();
                });
                // Refresh reports
                loadTradeReports();
            }
        }

        // 3. Update Option Chain if viewing chain
        if (STATE.activeTab === 'chain' || window.innerWidth >= 1024) {
            const chainRes = await apiRequest('option_chain', null, 'GET');
            if (chainRes.status === 'success' && chainRes.chain) {
                renderOptionChain(chainRes.chain);
            }
        }
    } catch (err) {
        console.error('Polling error:', err);
    }
}

function startPollingLoop() {
    stopPollingLoop();
    STATE.isPolling = true;
    runHighSpeedCycle();
    STATE.pollTimer = setInterval(runHighSpeedCycle, STATE.refreshIntervalMs);
}

function stopPollingLoop() {
    if (STATE.pollTimer) {
        clearInterval(STATE.pollTimer);
        STATE.pollTimer = null;
    }
    STATE.isPolling = false;
}

function setRefreshRate(ms) {
    STATE.refreshIntervalMs = ms;
    localStorage.setItem('kotak_refresh_ms', ms.toString());
    const labels = { 500: '⚡ 500ms', 1000: '🚀 1s', 2000: '⏱️ 2s' };
    const btn = document.getElementById('refreshRateBtn');
    if (btn) btn.innerHTML = `<span class="radar-dot"></span> ${labels[ms] || ms + 'ms'}`;
    if (STATE.isPolling) {
        startPollingLoop();
    }
    showToast(`Refresh rate set to ${labels[ms] || ms + 'ms'}`);
}

// ----------------- TICKERS BAR RENDERER -----------------
function updateTickersBar(quotes) {
    const container = document.getElementById('tickersBar');
    if (!container) return;

    Object.entries(quotes).forEach(([sym, data]) => {
        let el = document.getElementById(`ticker-${sym}`);
        const prevLtp = STATE.previousQuotes[sym]?.ltp || data.ltp;
        const isUp = data.ltp > prevLtp;
        const isDown = data.ltp < prevLtp;

        if (!el) {
            el = document.createElement('div');
            el.id = `ticker-${sym}`;
            el.className = 'ticker-item';
            el.addEventListener('click', () => selectUnderlying(sym));
            container.appendChild(el);
        }

        const tickClass = isUp ? 'tick-up' : (isDown ? 'tick-down' : '');
        if (tickClass) {
            el.classList.remove('tick-up', 'tick-down');
            void el.offsetWidth; // Force reflow
            el.classList.add(tickClass);
        }

        const sign = data.change >= 0 ? '+' : '';
        const chgClass = data.change >= 0 ? 'up' : 'down';

        el.innerHTML = `
            <span class="ticker-name">${sym}</span>
            <span class="ticker-price">₹${data.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            <span class="ticker-chg ${chgClass}">${sign}${data.change.toFixed(2)} (${sign}${data.change_pct.toFixed(2)}%)</span>
        `;
    });

    STATE.previousQuotes = JSON.parse(JSON.stringify(quotes));
}

// ----------------- OPTION CHAIN RENDERER -----------------
let currentChainData = null;

function renderOptionChain(chain) {
    currentChainData = chain;
    const tbody = document.getElementById('optionChainBody');
    const spotEl = document.getElementById('chainSpotPrice');
    const pcrEl = document.getElementById('chainPcr');
    const trendEl = document.getElementById('chainTrend');

    if (spotEl) spotEl.textContent = `Spot: ₹${chain.spot.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    if (pcrEl) pcrEl.textContent = `PCR: ${chain.pcr}`;
    if (trendEl) {
        trendEl.textContent = chain.trend;
        trendEl.style.color = chain.trend.includes('BULLISH') ? 'var(--cyber-green)' : (chain.trend.includes('BEARISH') ? 'var(--cyber-red)' : 'var(--cyber-amber)');
    }

    if (!tbody || !chain.rows) return;

    let html = '';
    chain.rows.forEach(r => {
        const isAtm = r.is_atm;
        const call = r.call;
        const put = r.put;

        const rowClass = [
            isAtm ? 'atm-row' : '',
            call.moneyness === 'ITM' ? 'call-itm' : '',
            put.moneyness === 'ITM' ? 'put-itm' : ''
        ].filter(Boolean).join(' ');

        html += `
            <tr class="${rowClass}">
                <!-- CALLS (CE) -->
                <td class="call-cell" style="color:var(--text-muted);">${(call.oi / 100000).toFixed(1)}L</td>
                <td class="call-cell" style="color:${call.oi_chg >= 0 ? 'var(--cyber-green)' : 'var(--cyber-red)'};">${(call.oi_chg / 1000).toFixed(0)}k</td>
                <td class="call-cell" style="font-weight:900; color:var(--cyber-green); cursor:pointer;" 
                    onclick="loadQuickTrade('${chain.underlying}', ${r.strike}, 'CE', ${call.ltp}, '${call.symbol}', '${call.moneyness}')">
                    ₹${call.ltp.toFixed(2)}
                </td>
                <td class="call-cell">
                    <button class="mini-buy-btn" onclick="event.stopPropagation(); loadQuickTrade('${chain.underlying}', ${r.strike}, 'CE', ${call.ltp}, '${call.symbol}', '${call.moneyness}')">BUY</button>
                </td>

                <!-- STRIKE -->
                <td class="strike-cell" onclick="loadQuickTrade('${chain.underlying}', ${r.strike}, 'CE', ${call.ltp}, '${call.symbol}', '${call.moneyness}')">
                    ${r.strike}
                    ${isAtm ? '<span style="font-size:8px; display:block; color:var(--cyber-cyan); line-height:1;">ATM</span>' : ''}
                </td>

                <!-- PUTS (PE) -->
                <td class="put-cell">
                    <button class="mini-buy-btn put-btn" onclick="event.stopPropagation(); loadQuickTrade('${chain.underlying}', ${r.strike}, 'PE', ${put.ltp}, '${put.symbol}', '${put.moneyness}')">BUY</button>
                </td>
                <td class="put-cell" style="font-weight:900; color:var(--cyber-red); cursor:pointer;"
                    onclick="loadQuickTrade('${chain.underlying}', ${r.strike}, 'PE', ${put.ltp}, '${put.symbol}', '${put.moneyness}')">
                    ₹${put.ltp.toFixed(2)}
                </td>
                <td class="put-cell" style="color:${put.oi_chg >= 0 ? 'var(--cyber-green)' : 'var(--cyber-red)'};">${(put.oi_chg / 1000).toFixed(0)}k</td>
                <td class="put-cell" style="color:var(--text-muted);">${(put.oi / 100000).toFixed(1)}L</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// ----------------- QUICK TRADE CONTROLLER -----------------
function loadQuickTrade(underlying, strike, optionType, ltp, symbol, moneyness = 'ITM') {
    STATE.selectedOption.underlying = underlying;
    STATE.selectedOption.strike = strike;
    STATE.selectedOption.optionType = optionType;
    STATE.selectedOption.currentLtp = ltp;
    STATE.selectedOption.symbol = symbol || `${underlying}${strike}${optionType}`;
    STATE.selectedOption.lotSize = CONFIG.defaultLotSizes[underlying] || 65;
    STATE.selectedOption.quantity = STATE.selectedOption.lots * STATE.selectedOption.lotSize;

    // Switch to Trade tab on mobile
    if (window.innerWidth < 1024) {
        switchTab('trade');
    }

    renderQuickTradeView();
    audio.keyPress();
    showToast(`Loaded ${underlying} ${strike} ${optionType} @ ₹${ltp.toFixed(2)}`);
}

function updateQuickTradeCalculations() {
    const opt = STATE.selectedOption;
    const tpPts = parseFloat(document.getElementById('tpPointsInput')?.value || opt.targetPoints);
    const slPts = parseFloat(document.getElementById('slPointsInput')?.value || opt.slPoints);
    opt.targetPoints = tpPts;
    opt.slPoints = slPts;

    const entryPrice = (opt.orderType === 'MKT') ? opt.currentLtp : opt.limitPrice;
    const targetPrice = (opt.side === 'BUY') ? (entryPrice + tpPts) : (entryPrice - tpPts);
    const slPrice = Math.max(0.5, (opt.side === 'BUY') ? (entryPrice - slPts) : (entryPrice + slPts));

    const totalQty = opt.lots * opt.lotSize;
    opt.quantity = totalQty;

    const approxTargetProfit = totalQty * tpPts;
    const approxMaxLoss = totalQty * slPts;

    // Update UI elements
    const targetPriceEl = document.getElementById('calcTargetPrice');
    const targetProfitEl = document.getElementById('calcTargetProfit');
    const slPriceEl = document.getElementById('calcSlPrice');
    const slLossEl = document.getElementById('calcMaxLoss');
    const totalQtyEl = document.getElementById('quickTotalQty');
    const execBtn = document.getElementById('btnExecuteOrder');

    if (targetPriceEl) targetPriceEl.textContent = `Target Sell: ₹${targetPrice.toFixed(2)}`;
    if (targetProfitEl) targetProfitEl.textContent = `+₹${approxTargetProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    if (slPriceEl) slPriceEl.textContent = `Stop Loss: ₹${slPrice.toFixed(2)}`;
    if (slLossEl) slLossEl.textContent = `-₹${approxMaxLoss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    if (totalQtyEl) totalQtyEl.textContent = `Total: ${totalQty} Qty`;

    if (execBtn) {
        const sideWord = opt.side === 'BUY' ? 'BUY' : 'SELL';
        execBtn.textContent = `CONFIRM ${sideWord} ORDER (${totalQty} Qty)`;
        execBtn.className = opt.side === 'BUY' ? 'btn-execute' : 'btn-execute sell-mode';
    }
}

function renderQuickTradeView() {
    const opt = STATE.selectedOption;
    const nameEl = document.getElementById('selectedOptName');
    const priceEl = document.getElementById('selectedOptPrice');
    const lotsEl = document.getElementById('quickLotsValue');
    const lotSizeEl = document.getElementById('quickLotSizeInfo');

    if (nameEl) nameEl.textContent = `${opt.underlying} ${opt.strike} ${opt.optionType}`;
    if (priceEl) priceEl.textContent = `₹${opt.currentLtp.toFixed(2)}`;
    if (lotsEl) lotsEl.textContent = opt.lots;
    if (lotSizeEl) lotSizeEl.textContent = `Lot size: ${opt.lotSize}`;

    updateQuickTradeCalculations();
}

function adjustLots(delta) {
    const newLots = Math.max(1, Math.min(100, STATE.selectedOption.lots + delta));
    STATE.selectedOption.lots = newLots;
    renderQuickTradeView();
}

function setQuickTarget(pts) {
    const input = document.getElementById('tpPointsInput');
    if (input) input.value = pts;
    document.querySelectorAll('.chip-btn.tp-chip').forEach(b => {
        b.classList.toggle('active-tp', parseFloat(b.dataset.pts) === pts);
    });
    updateQuickTradeCalculations();
}

function setQuickSl(pts) {
    const input = document.getElementById('slPointsInput');
    if (input) input.value = pts;
    document.querySelectorAll('.chip-btn.sl-chip').forEach(b => {
        b.classList.toggle('active-sl', parseFloat(b.dataset.pts) === pts);
    });
    updateQuickTradeCalculations();
}

// ----------------- ORDER EXECUTION WITH BRACKET TP & SL -----------------
async function executeQuickOrder() {
    const opt = STATE.selectedOption;
    const btn = document.getElementById('btnExecuteOrder');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'PLACING ORDER...';
    }

    const payload = {
        underlying: opt.underlying,
        strike: opt.strike,
        option_type: opt.optionType,
        symbol: opt.symbol,
        side: opt.side,
        quantity: opt.quantity,
        lots: opt.lots,
        current_ltp: opt.currentLtp,
        order_type: opt.orderType,
        product: opt.product,
        target_points: opt.targetPoints,
        sl_points: opt.slPoints,
        mode: STATE.tradingMode,
        // Relay session credentials (from localStorage if logged into Kotak Neo)
        edit_token: localStorage.getItem('kotak_edit_token') || '',
        edit_sid: localStorage.getItem('kotak_edit_sid') || '',
        base_url: localStorage.getItem('kotak_base_url') || '',
        consumer_key: localStorage.getItem('kotak_consumer_key') || ''
    };

    const res = await apiRequest('place_quick_order', payload, 'POST');
    if (btn) {
        btn.disabled = false;
        renderQuickTradeView();
    }

    if (res.status === 'success') {
        audio.tradePlaced();
        showToast(`✅ ${res.message}`, 'success');

        // Immediately update active orders list
        if (res.order) {
            STATE.activeOrders.push(res.order);
            renderActiveOrders();
        }

        // Switch to Active Orders view on mobile
        if (window.innerWidth < 1024) {
            switchTab('orders');
        }
    } else {
        audio.slHit();
        showToast(`❌ Error: ${res.message}`, 'alert');
    }
}

// ----------------- ACTIVE ORDERS & SQUARE OFF -----------------
function renderActiveOrders() {
    const container = document.getElementById('activeOrdersList');
    const badge = document.getElementById('activeOrdersBadge');
    if (badge) badge.textContent = STATE.activeOrders.length;

    if (!container) return;

    if (STATE.activeOrders.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:30px 10px; color:var(--text-muted);">
                <div style="font-size:28px; margin-bottom:8px;">💼</div>
                <div style="font-size:13px; font-weight:700;">No Open Positions</div>
                <div style="font-size:11px; margin-top:4px;">Select any option from the chain to place a Quick Trade</div>
            </div>
        `;
        return;
    }

    let html = '';
    STATE.activeOrders.forEach(order => {
        const isProfit = (order.unrealized_pnl || 0) >= 0;
        const pnlClass = isProfit ? 'profit' : 'loss';
        const sign = isProfit ? '+' : '';

        // Progress toward TP or SL
        const entry = order.entry_price || 100;
        const ltp = order.current_ltp || entry;
        const tp = order.target_price || (entry + 10);
        const sl = order.sl_price || (entry - 10);

        let progressPct = 50;
        if (ltp >= entry && tp > entry) {
            progressPct = 50 + Math.min(50, ((ltp - entry) / (tp - entry)) * 50);
        } else if (ltp < entry && entry > sl) {
            progressPct = 50 - Math.min(50, ((entry - ltp) / (entry - sl)) * 50);
        }

        html += `
            <div class="order-card">
                <div class="order-card-header">
                    <div>
                        <div class="order-sym">${order.symbol}</div>
                        <div style="font-size:10px; color:var(--text-muted); font-weight:700;">
                            ${order.side} • ${order.quantity} Qty (${order.lots} Lot) • ${order.product}
                        </div>
                    </div>
                    <div class="order-pnl ${pnlClass}">
                        ${sign}₹${(order.unrealized_pnl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        <div style="font-size:10.5px; text-align:right;">(${sign}${(order.unrealized_points || 0).toFixed(1)} pts)</div>
                    </div>
                </div>

                <div class="order-meta-grid">
                    <div class="order-meta-item">
                        <span>ENTRY</span>
                        <strong>₹${entry.toFixed(2)}</strong>
                    </div>
                    <div class="order-meta-item">
                        <span>CURRENT LTP</span>
                        <strong style="color:var(--cyber-cyan);">₹${ltp.toFixed(2)}</strong>
                    </div>
                    <div class="order-meta-item">
                        <span style="color:var(--cyber-green);">TP TARGET (+${order.target_points}p)</span>
                        <strong style="color:var(--cyber-green);">₹${tp.toFixed(2)}</strong>
                    </div>
                </div>

                <div class="order-progress-track">
                    <div class="order-progress-fill" style="width:${progressPct}%; background:${isProfit ? 'var(--cyber-green)' : 'var(--cyber-red)'};"></div>
                </div>

                <div class="order-actions">
                    <div style="font-size:10px; color:var(--text-muted);">
                        SL: <span style="color:var(--cyber-amber); font-weight:700;">₹${sl.toFixed(2)} (-${order.sl_points}p)</span>
                    </div>
                    <button class="btn-squareoff" onclick="squareOffOrder('${order.order_id}')">
                        ⚡ SQUARE OFF NOW
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

async function squareOffOrder(orderId) {
    if (!confirm(`Are you sure you want to Square Off order #${orderId} immediately?`)) {
        return;
    }

    const res = await apiRequest('exit_order', { order_id: orderId, exit_reason: 'MANUAL_EXIT' }, 'POST');
    if (res.status === 'success') {
        audio.tradePlaced();
        showToast(res.message, 'success');
        STATE.activeOrders = res.active_orders || [];
        renderActiveOrders();
        loadTradeReports();
    } else {
        audio.slHit();
        showToast(res.message, 'alert');
    }
}

// ----------------- TRADE REPORTS & ANALYTICS -----------------
async function loadTradeReports() {
    const res = await apiRequest('get_trade_reports');
    if (res.status === 'success' && res.reports) {
        STATE.tradeReports = res.reports;
        renderTradeReports();
    }
}

function renderTradeReports() {
    const summary = STATE.tradeReports.summary || {};
    const trades = STATE.tradeReports.trades || [];

    const totalPnlEl = document.getElementById('statTotalPnl');
    const winRateEl = document.getElementById('statWinRate');
    const totalTradesEl = document.getElementById('statTotalTrades');
    const avgPtsEl = document.getElementById('statAvgPts');

    const pnl = summary.total_pnl || 0;
    const isProfit = pnl >= 0;
    const sign = isProfit ? '+' : '';

    if (totalPnlEl) {
        totalPnlEl.textContent = `${sign}₹${pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        totalPnlEl.className = `stat-val ${isProfit ? 'profit' : 'loss'}`;
    }
    if (winRateEl) winRateEl.textContent = `${summary.win_rate || 0}%`;
    if (totalTradesEl) totalTradesEl.textContent = `${summary.total_trades || 0} (${summary.winning_trades || 0}W / ${summary.losing_trades || 0}L)`;
    if (avgPtsEl) avgPtsEl.textContent = `${(summary.avg_points_per_trade || 0).toFixed(1)} pts`;

    // Render Table
    const tbody = document.getElementById('reportsTableBody');
    if (!tbody) return;

    if (trades.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">No closed trades yet</td></tr>`;
        return;
    }

    let html = '';
    trades.forEach(t => {
        const tradeProfit = (t.pnl || 0) >= 0;
        const signTrd = tradeProfit ? '+' : '';
        const reasonBadge = t.exit_reason === 'TP_HIT' 
            ? '<span class="reason-badge tp">🎯 TP HIT</span>'
            : (t.exit_reason === 'SL_HIT' ? '<span class="reason-badge sl">🛡️ SL HIT</span>' : '<span class="reason-badge manual">⚡ MANUAL</span>');

        html += `
            <tr>
                <td style="color:var(--text-muted); font-size:10px;">${t.exit_time ? t.exit_time.split(' ')[1] : '-'}</td>
                <td style="font-weight:800; color:var(--cyber-cyan);">${t.symbol}</td>
                <td>${t.quantity} Qty</td>
                <td>₹${t.entry_price.toFixed(2)}</td>
                <td>₹${t.exit_price.toFixed(2)}</td>
                <td style="color:${tradeProfit ? 'var(--cyber-green)' : 'var(--cyber-red)'}; font-weight:800;">
                    ${signTrd}${t.points.toFixed(1)}p
                </td>
                <td style="color:${tradeProfit ? 'var(--cyber-green)' : 'var(--cyber-red)'}; font-weight:900;">
                    ${signTrd}₹${t.pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td>${reasonBadge}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

function exportReportsJson() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(STATE.tradeReports, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `Kotak_Trade_Reports_${new Date().toISOString().slice(0,10)}.json`);
    dl.click();
}

function exportReportsCsv() {
    const trades = STATE.tradeReports.trades || [];
    if (trades.length === 0) {
        alert("No trades to export.");
        return;
    }
    const headers = ["Trade ID", "Order ID", "Symbol", "Side", "Qty", "Entry Price", "Exit Price", "Points", "P&L", "Reason", "Entry Time", "Exit Time"];
    const rows = trades.map(t => [
        t.trade_id, t.order_id, t.symbol, t.side, t.quantity, t.entry_price, t.exit_price, t.points, t.pnl, t.exit_reason, t.entry_time, t.exit_time
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const dl = document.createElement('a');
    dl.setAttribute("href", encodeURI(csvContent));
    dl.setAttribute("download", `Kotak_Trade_Reports_${new Date().toISOString().slice(0,10)}.csv`);
    dl.click();
}

// ----------------- TABS & UNDERLYING SWITCHER -----------------
function switchTab(tabId) {
    STATE.activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `panel-${tabId}`);
    });
    if (tabId === 'reports') {
        loadTradeReports();
    }
}

function selectUnderlying(und) {
    STATE.selectedUnderlying = und;
    document.querySelectorAll('.und-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.und === und);
    });
    if (STATE.isPolling) {
        runHighSpeedCycle();
    }
    showToast(`Viewing ${und} Option Chain`);
}

function toggleTradingMode() {
    STATE.tradingMode = (STATE.tradingMode === 'PAPER') ? 'LIVE' : 'PAPER';
    localStorage.setItem('kotak_trading_mode', STATE.tradingMode);
    const badge = document.getElementById('tradingModeBadge');
    if (badge) {
        badge.textContent = STATE.tradingMode === 'LIVE' ? '🟢 LIVE MODE' : '🧪 PAPER MODE';
        badge.className = `brand-badge ${STATE.tradingMode.toLowerCase()}`;
    }
    showToast(`Switched to ${STATE.tradingMode} trading mode!`);
}

// ----------------- TOAST NOTIFICATIONS -----------------
function showToast(text, type = 'info') {
    let toast = document.getElementById('appToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appToast';
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 999999;
            background: #161e31; border: 1px solid #334155; color: #fff;
            padding: 10px 16px; border-radius: 8px; font-size: 12px; font-weight: 700;
            box-shadow: 0 4px 20px rgba(0,0,0,0.6); transition: all 0.3s ease;
            max-width: 90vw; pointer-events: none;
        `;
        document.body.appendChild(toast);
    }

    const colors = {
        success: 'var(--cyber-green)',
        alert: 'var(--cyber-red)',
        info: 'var(--cyber-cyan)'
    };
    toast.style.borderColor = colors[type] || colors.info;
    toast.textContent = text;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
    }, 2800);
}

// ----------------- STARTUP INITIALIZATION -----------------
window.addEventListener('DOMContentLoaded', async () => {
    setupPinModal();

    // Check if previously unlocked with valid token
    if (STATE.authToken) {
        const verify = await apiRequest('verify_session');
        if (verify.status === 'success' && verify.valid) {
            STATE.isUnlocked = true;
            document.getElementById('pinOverlay').classList.add('hidden');
            startPollingLoop();
            loadTradeReports();
        } else {
            showPinModal();
        }
    } else {
        showPinModal();
    }

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Underlying chips
    document.querySelectorAll('.und-chip').forEach(chip => {
        chip.addEventListener('click', () => selectUnderlying(chip.dataset.und));
    });

    // Initial Quick Trade View
    renderQuickTradeView();
});

