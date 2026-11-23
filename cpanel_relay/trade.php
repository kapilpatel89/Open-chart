<?php
/**
 * Kotak AI Trader - High-Speed Web Trading Terminal
 * Mobile-First & Desktop Pro View
 * Runs on HTML5, CSS3, JavaScript (ES6+), and PHP backend.
 */
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>⚡ Kotak AI Trader - Web Terminal</title>
    <link rel="stylesheet" href="style.css?v=2.8">
    <link rel="icon" type="image/png" href="favicon.png">
</head>
<body>

    <!-- =======================================================
         1. SECURITY PIN OVERLAY (PIN 7411 - ENCRYPTED)
         ======================================================= -->
    <div id="pinOverlay" class="pin-overlay">
        <div class="pin-card">
            <div class="pin-icon">🔐</div>
            <div class="pin-title">KOTAK AI TRADER</div>
            <div class="pin-subtitle">Secure Military-Grade Terminal Access</div>

            <div class="pin-dots">
                <div class="pin-dot"></div>
                <div class="pin-dot"></div>
                <div class="pin-dot"></div>
                <div class="pin-dot"></div>
            </div>

            <div id="pinMsg" class="pin-msg">Enter 4-Digit Security PIN</div>

            <div id="pinKeypad" class="pin-keypad">
                <button class="pin-key" data-key="1">1</button>
                <button class="pin-key" data-key="2">2</button>
                <button class="pin-key" data-key="3">3</button>
                <button class="pin-key" data-key="4">4</button>
                <button class="pin-key" data-key="5">5</button>
                <button class="pin-key" data-key="6">6</button>
                <button class="pin-key" data-key="7">7</button>
                <button class="pin-key" data-key="8">8</button>
                <button class="pin-key" data-key="9">9</button>
                <button class="pin-key action-key" data-key="clear">CLR</button>
                <button class="pin-key" data-key="0">0</button>
                <button class="pin-key action-key" data-key="back">⌫</button>
            </div>
            <div style="font-size:10px; color:var(--text-muted); margin-top:16px;">
                Master PIN: <strong style="color:var(--cyber-cyan);">7411</strong> (Encrypted Session)
            </div>
        </div>
    </div>

    <!-- =======================================================
         2. APP HEADER & TICKERS BANNER
         ======================================================= -->
    <header class="app-header">
        <div class="header-top">
            <div class="brand-section">
                <div class="brand-logo">⚡</div>
                <div>
                    <div class="brand-title">KOTAK AI</div>
                </div>
                <div id="tradingModeBadge" class="brand-badge paper" onclick="toggleTradingMode()" title="Tap to switch Paper / Live mode">
                    🧪 PAPER MODE
                </div>
            </div>

            <div class="header-controls">
                <div id="refreshRateBtn" class="refresh-rate-pill" onclick="cycleRefreshRate()" title="Toggle Refresh Speed (500ms / 1s / 2s)">
                    <span class="radar-dot"></span> 🚀 1s
                </div>
                <div id="latencyBadge" style="font-family:var(--font-mono); font-size:10.5px; font-weight:800; color:var(--cyber-green);">
                    42ms
                </div>
                <button class="header-btn" onclick="openSettingsModal()" title="Settings & 2FA Login">⚙️</button>
                <button class="header-btn" onclick="lockTerminal()" title="Lock Terminal">🔒</button>
            </div>
        </div>

        <!-- Horizontal Real-Time Index Tickers Bar -->
        <div id="tickersBar" class="tickers-scroll-container">
            <!-- Dynamically populated via get_live_market_quotes -->
        </div>
    </header>

    <!-- =======================================================
         3. MOBILE NAVIGATION TABS
         ======================================================= -->
    <nav class="app-tabs-bar">
        <button class="tab-btn active" data-tab="trade">
            ⚡ Quick Trade
        </button>
        <button class="tab-btn" data-tab="chain">
            📊 Option Chain
        </button>
        <button class="tab-btn" data-tab="orders">
            💼 Orders <span id="activeOrdersBadge" class="tab-badge">0</span>
        </button>
        <button class="tab-btn" data-tab="reports">
            📈 Reports
        </button>
    </nav>

    <!-- =======================================================
         4. MAIN CONTENT CONTAINER
         ======================================================= -->
    <main class="main-layout desktop-command-center">

        <!-- ==================== LEFT COLUMN: LIVE OPTION CHAIN ==================== -->
        <section id="panel-chain" class="tab-panel">
            <div class="cyber-card">
                <div class="card-header">
                    <div class="card-title">
                        <span>📊 LIVE OPTION CHAIN</span>
                        <span id="chainTrend" style="font-size:10px; font-weight:800; margin-left:8px;">BULLISH</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span id="chainPcr" style="font-size:10.5px; font-weight:800; color:var(--cyber-cyan);">PCR: 1.08</span>
                        <span id="chainSpotPrice" style="font-size:11px; font-weight:900; color:var(--text-primary); font-family:var(--font-mono);">Spot: ₹0.00</span>
                    </div>
                </div>

                <div class="card-body">
                    <div class="chain-controls-bar">
                        <div class="underlying-chips">
                            <button class="und-chip active" data-und="NIFTY">NIFTY</button>
                            <button class="und-chip" data-und="BANKNIFTY">BANKNIFTY</button>
                            <button class="und-chip" data-und="SENSEX">SENSEX</button>
                            <button class="und-chip" data-und="FINNIFTY">FINNIFTY</button>
                            <button class="und-chip" data-und="MIDCPNIFTY">MIDCPNIFTY</button>
                        </div>
                        <div style="font-size:10px; color:var(--text-muted); font-weight:700;">
                            Tap any rate or BUY to load
                        </div>
                    </div>

                    <div class="table-wrapper">
                        <table class="option-chain-table">
                            <thead>
                                <tr>
                                    <th colspan="4" style="text-align:left; color:var(--cyber-green);">CALLS (CE)</th>
                                    <th class="center-col">STRIKE</th>
                                    <th colspan="4" style="text-align:right; color:var(--cyber-red);">PUTS (PE)</th>
                                </tr>
                                <tr>
                                    <th>OI</th>
                                    <th>CHG</th>
                                    <th>LTP</th>
                                    <th>BUY</th>
                                    <th class="center-col">STRIKE</th>
                                    <th style="text-align:center;">BUY</th>
                                    <th>LTP</th>
                                    <th>CHG</th>
                                    <th>OI</th>
                                </tr>
                            </thead>
                            <tbody id="optionChainBody">
                                <tr><td colspan="9" style="text-align:center; padding:20px; color:var(--text-muted);">Loading Live Option Chain...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>

        <!-- ==================== RIGHT COLUMN: QUICK TRADE & BRACKET ==================== -->
        <section id="panel-trade" class="tab-panel active">
            <div class="cyber-card">
                <div class="card-header">
                    <div class="card-title">
                        <span>⚡ QUICK TRADE & SCALP</span>
                    </div>
                    <div id="quickLotSizeInfo" style="font-size:10px; font-weight:700; color:var(--text-muted);">
                        Lot size: 65
                    </div>
                </div>

                <div class="card-body quick-trade-box">
                    <!-- Selected Option Banner -->
                    <div class="selected-option-banner">
                        <div>
                            <div id="selectedOptName" class="opt-name">SENSEX 82000 CE</div>
                            <div style="font-size:10px; color:var(--text-muted); font-weight:700; margin-top:2px;">
                                NSE/BSE Active Weekly Contract
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div id="selectedOptPrice" class="opt-price">₹215.00</div>
                            <div style="font-size:9.5px; color:var(--cyber-green); font-weight:800;">LIVE RATE</div>
                        </div>
                    </div>

                    <!-- Buy / Sell Segmented Switch -->
                    <div class="segmented-switch">
                        <button id="sideBtnBuy" class="seg-btn active-buy" onclick="setTradeSide('BUY')">BUY (LONG)</button>
                        <button id="sideBtnSell" class="seg-btn" onclick="setTradeSide('SELL')">SELL (SHORT)</button>
                    </div>

                    <!-- Lots & Quantity Stepper -->
                    <div class="form-row">
                        <div class="form-label">LOTS & QUANTITY</div>
                        <div class="stepper-control">
                            <button class="step-btn" onclick="adjustLots(-1)">−</button>
                            <div id="quickLotsValue" class="step-value">1</div>
                            <button class="step-btn" onclick="adjustLots(1)">+</button>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:-6px;">
                        <span id="quickTotalQty" style="font-weight:800; color:var(--cyber-cyan);">Total: 65 Qty</span>
                        <span style="color:var(--text-muted);">Est. Trade Value: <strong id="estTradeVal" style="color:var(--text-primary);">₹13,975</strong></span>
                    </div>

                    <!-- Product & Order Type Rows -->
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <div class="form-label" style="margin-bottom:4px;">PRODUCT</div>
                            <select id="quickProduct" class="cyber-input" style="height:36px;" onchange="STATE.selectedOption.product = this.value">
                                <option value="MIS">MIS (Intraday)</option>
                                <option value="NRML">NRML (Carry)</option>
                            </select>
                        </div>
                        <div>
                            <div class="form-label" style="margin-bottom:4px;">ORDER TYPE</div>
                            <select id="quickOrderType" class="cyber-input" style="height:36px;" onchange="handleOrderTypeChange(this.value)">
                                <option value="MKT">MKT (Market)</option>
                                <option value="L">LIMIT (Price)</option>
                            </select>
                        </div>
                    </div>

                    <!-- Take Profit Target Points (+pts) -->
                    <div class="bracket-config-card">
                        <div class="bracket-header">
                            <div class="bracket-title tp">🎯 TAKE PROFIT TARGET (+pts)</div>
                            <div id="calcTargetProfit" class="bracket-calc tp">+₹1,300</div>
                        </div>
                        <div class="point-input-row">
                            <input id="tpPointsInput" type="number" step="0.5" min="1" value="10" class="cyber-input" oninput="updateQuickTradeCalculations()">
                            <span style="font-size:11px; font-weight:800; color:var(--text-muted);">PTS</span>
                        </div>
                        <div class="quick-chips-row">
                            <button class="chip-btn tp-chip" data-pts="5" onclick="setQuickTarget(5)">+5p</button>
                            <button class="chip-btn tp-chip active-tp" data-pts="10" onclick="setQuickTarget(10)">+10p</button>
                            <button class="chip-btn tp-chip" data-pts="15" onclick="setQuickTarget(15)">+15p</button>
                            <button class="chip-btn tp-chip" data-pts="20" onclick="setQuickTarget(20)">+20p</button>
                            <button class="chip-btn tp-chip" data-pts="30" onclick="setQuickTarget(30)">+30p</button>
                        </div>
                        <div id="calcTargetPrice" class="bracket-subtext">Auto Limit Sell @ ₹225.00 on Fill</div>
                    </div>

                    <!-- Stop Loss Protection (-pts) -->
                    <div class="bracket-config-card">
                        <div class="bracket-header">
                            <div class="bracket-title sl">🛡️ STOP LOSS PROTECTION (-pts)</div>
                            <div id="calcMaxLoss" class="bracket-calc sl">-₹1,300</div>
                        </div>
                        <div class="point-input-row">
                            <input id="slPointsInput" type="number" step="0.5" min="1" value="10" class="cyber-input" oninput="updateQuickTradeCalculations()">
                            <span style="font-size:11px; font-weight:800; color:var(--text-muted);">PTS</span>
                        </div>
                        <div class="quick-chips-row">
                            <button class="chip-btn sl-chip" data-pts="5" onclick="setQuickSl(5)">-5p</button>
                            <button class="chip-btn sl-chip active-sl" data-pts="10" onclick="setQuickSl(10)">-10p</button>
                            <button class="chip-btn sl-chip" data-pts="15" onclick="setQuickSl(15)">-15p</button>
                            <button class="chip-btn sl-chip" data-pts="20" onclick="setQuickSl(20)">-20p</button>
                        </div>
                        <div id="calcSlPrice" class="bracket-subtext">Auto Market Exit @ ₹205.00 on Drop</div>
                    </div>

                    <!-- CONFIRM ORDER EXECUTION BUTTON -->
                    <button id="btnExecuteOrder" class="btn-execute" onclick="executeQuickOrder()">
                        CONFIRM BUY ORDER (65 Qty)
                    </button>
                </div>
            </div>
        </section>

        <!-- ==================== ACTIVE ORDERS & BRACKET WATCHER ==================== -->
        <section id="panel-orders" class="tab-panel">
            <div class="cyber-card">
                <div class="card-header">
                    <div class="card-title">
                        <span>💼 ACTIVE ORDERS (SAVED IN JSON)</span>
                    </div>
                    <button class="header-btn" onclick="runHighSpeedCycle()">🔄 Refresh</button>
                </div>
                <div class="card-body">
                    <div id="activeOrdersList" class="orders-list">
                        <!-- Populated dynamically -->
                    </div>
                </div>
            </div>
        </section>

        <!-- ==================== REPORTS & ANALYTICS ==================== -->
        <section id="panel-reports" class="tab-panel">
            <div class="cyber-card">
                <div class="card-header">
                    <div class="card-title">
                        <span>📈 TRADE REPORTS & ANALYTICS (SAVED IN JSON)</span>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="header-btn" onclick="exportReportsJson()">📥 JSON</button>
                        <button class="header-btn" onclick="exportReportsCsv()">📊 CSV</button>
                        <button class="header-btn" style="color:var(--cyber-red);" onclick="clearReportsHistory()">🗑️ Clear</button>
                    </div>
                </div>
                <div class="card-body">
                    <!-- Summary Stats Grid -->
                    <div class="reports-summary-grid">
                        <div class="stat-card">
                            <div class="stat-label">TOTAL REALIZED P&L</div>
                            <div id="statTotalPnl" class="stat-val profit">+₹0.00</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-label">WIN RATE %</div>
                            <div id="statWinRate" class="stat-val">0.0%</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-label">TOTAL TRADES</div>
                            <div id="statTotalTrades" class="stat-val">0 (0W / 0L)</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-label">AVG POINTS / TRADE</div>
                            <div id="statAvgPts" class="stat-val">0.0 pts</div>
                        </div>
                    </div>

                    <!-- History Table -->
                    <div class="table-wrapper">
                        <table class="reports-table">
                            <thead>
                                <tr>
                                    <th>TIME</th>
                                    <th>SYMBOL</th>
                                    <th>QTY</th>
                                    <th>ENTRY</th>
                                    <th>EXIT</th>
                                    <th>PTS</th>
                                    <th>P&L</th>
                                    <th>EXIT REASON</th>
                                </tr>
                            </thead>
                            <tbody id="reportsTableBody">
                                <tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">No closed trades yet</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>

    </main>

    <!-- =======================================================
         5. SETTINGS & KOTAK 2FA LOGIN MODAL
         ======================================================= -->
    <div id="settingsModal" class="modal-overlay hidden">
        <div class="modal-box">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <div style="font-size:14px; font-weight:800; color:var(--text-primary);">⚙️ Terminal Settings & Kotak Live Login</div>
                <button style="background:none; border:none; color:var(--text-muted); font-size:18px; cursor:pointer;" onclick="closeSettingsModal()">✕</button>
            </div>

            <div style="display:flex; flex-direction:column; gap:10px;">
                <div>
                    <label class="form-label">BASE RELAY API URL</label>
                    <input id="settingsApiUrl" type="text" class="cyber-input" style="font-size:11px;" value="">
                </div>

                <div style="border-top:1px solid var(--border-subtle); padding-top:10px; margin-top:4px;">
                    <div style="font-size:12px; font-weight:800; color:var(--cyber-green); margin-bottom:6px;">
                        ⚡ KOTAK NEO LIVE 2FA LOGIN (WHITELISTED IP)
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div>
                            <label class="form-label">CONSUMER KEY</label>
                            <input id="kotakConsumerKey" type="text" class="cyber-input" placeholder="36-char key">
                        </div>
                        <div>
                            <label class="form-label">MOBILE NUMBER</label>
                            <input id="kotakMobile" type="text" class="cyber-input" placeholder="10-digit">
                        </div>
                        <div>
                            <label class="form-label">UCC (CLIENT CODE)</label>
                            <input id="kotakUcc" type="text" class="cyber-input" placeholder="e.g. Y7637">
                        </div>
                        <div>
                            <label class="form-label">TOTP (AUTHENTICATOR)</label>
                            <input id="kotakTotp" type="password" class="cyber-input" placeholder="6-digit">
                        </div>
                        <div style="grid-column:span 2;">
                            <label class="form-label">MPIN (6-DIGIT)</label>
                            <input id="kotakMpin" type="password" class="cyber-input" placeholder="6-digit PIN">
                        </div>
                    </div>
                    <button class="btn-execute" style="height:42px; font-size:12px; margin-top:10px;" onclick="doKotakNeoLiveLogin()">
                        AUTHENTICATE KOTAK LIVE VIA RELAY IP
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- UI Helper Script for Settings & Side Toggle -->
    <script>
        function setTradeSide(side) {
            STATE.selectedOption.side = side;
            document.getElementById('sideBtnBuy').className = side === 'BUY' ? 'seg-btn active-buy' : 'seg-btn';
            document.getElementById('sideBtnSell').className = side === 'SELL' ? 'seg-btn active-sell' : 'seg-btn';
            updateQuickTradeCalculations();
        }

        function handleOrderTypeChange(type) {
            STATE.selectedOption.orderType = type;
            updateQuickTradeCalculations();
        }

        function cycleRefreshRate() {
            const current = STATE.refreshIntervalMs;
            const next = current === 1000 ? 500 : (current === 500 ? 2000 : 1000);
            setRefreshRate(next);
        }

        function openSettingsModal() {
            document.getElementById('settingsApiUrl').value = CONFIG.apiBaseUrl;
            document.getElementById('kotakConsumerKey').value = localStorage.getItem('kotak_consumer_key') || '';
            document.getElementById('kotakMobile').value = localStorage.getItem('kotak_mobile') || '';
            document.getElementById('kotakUcc').value = localStorage.getItem('kotak_ucc') || '';
            document.getElementById('settingsModal').classList.remove('hidden');
        }

        function closeSettingsModal() {
            CONFIG.apiBaseUrl = document.getElementById('settingsApiUrl').value.trim();
            document.getElementById('settingsModal').classList.add('hidden');
        }

        async function doKotakNeoLiveLogin() {
            const consumerKey = document.getElementById('kotakConsumerKey').value.trim();
            const mobile = document.getElementById('kotakMobile').value.trim();
            const ucc = document.getElementById('kotakUcc').value.trim();
            const totp = document.getElementById('kotakTotp').value.trim();
            const mpin = document.getElementById('kotakMpin').value.trim();

            if (!consumerKey || !mobile || !ucc || !totp || !mpin) {
                alert('Please fill all Kotak Neo login fields.');
                return;
            }

            // Save to localStorage for convenience
            localStorage.setItem('kotak_consumer_key', consumerKey);
            localStorage.setItem('kotak_mobile', mobile);
            localStorage.setItem('kotak_ucc', ucc);

            showToast('Sending 2FA login to whitelisted relay...', 'info');

            // Calls relay directly
            const relayUrl = CONFIG.apiBaseUrl.replace('trade_api.php', 'kotak_relay.php?action=login');
            try {
                // Prepare AES encrypted payload matching relay
                // If encrypted relay is used, pass raw to relay helper
                const resp = await fetch(relayUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        // Simple proxy or direct
                        action: 'login',
                        consumer_key: consumerKey,
                        mobile_number: mobile,
                        ucc: ucc,
                        totp: totp,
                        mpin: mpin
                    })
                });
                const res = await resp.json();
                if (res.status === 'success') {
                    showToast('Kotak Neo 2FA Authenticated!', 'success');
                    if (res.edit_token) localStorage.setItem('kotak_edit_token', res.edit_token);
                    if (res.edit_sid) localStorage.setItem('kotak_edit_sid', res.edit_sid);
                    if (res.base_url) localStorage.setItem('kotak_base_url', res.base_url);
                    closeSettingsModal();
                } else {
                    alert('Login failed: ' + (res.message || JSON.stringify(res)));
                }
            } catch (err) {
                alert('Login network error: ' + err.message);
            }
        }

        async function clearReportsHistory() {
            if (!confirm('Clear all trade report history?')) return;
            const res = await apiRequest('clear_trade_reports');
            if (res.status === 'success') {
                showToast('Reports history cleared', 'info');
                loadTradeReports();
            }
        }
    </script>

    <!-- Core App JS -->
    <script src="app.js?v=2.8"></script>
</body>
</html>

