# Open Chart ◈ 3D Candlestick Trading Terminal

> **An advanced, open-source, hardware-accelerated alternative to TradingView** featuring volumetric 3D candlesticks with glossy and matte finishes, a full **Pine Script v5** execution engine with backtesting, interactive draggable **Take-Profit (TP) / Stop-Loss (SL)** handles directly on the chart, live **CoinDCX WebSocket** data streaming across 600+ coins, and a complete suite of professional marking tools.

---

## 🌟 Key Features

### 1. Volumetric 3D Candlesticks (Glossy & Matte Finish)
* **Hardware-Accelerated Canvas Engine**: Renders smooth cylindrical 3D candlesticks with specular gloss highlights, chamfered bevel caps, and matte lacquer cores.
* **Laser Neon Wicks & Ambient Shadows**: High-definition wicks with radial neon luminescence and 3D elevation drop shadows.
* **Volumetric Volume Profile**: 3D extruded volume bars synchronized with market liquidity.

### 2. Full Pine Script v5 Engine & Strategy Tester
* **Line-by-Line Interpreter**: Evaluates variables, mathematical logic, expressions, series history indexing `[1]`, and control flow.
* **Built-in Indicators**:
  * `ta.ema()`, `ta.sma()`, `ta.rsi()`, `ta.bb()` (Bollinger Bands), `ta.supertrend()`, `ta.macd()`, `ta.atr()`, `ta.highest()`, `ta.lowest()`, `ta.crossover()`, `ta.crossunder()`.
* **Visual Plots & Signal Markers**: `plot(series, color, linewidth)`, `plotshape(condition, style, color)`.
* **Strategy Execution & Automated Backtester**:
  * `strategy.entry("Long", strategy.long)` and `strategy.close("Long")`.
  * Computes Net Profit, Win Rate %, Total Trades, and Trade History Log.
  * Auto-execute trades on chart directly from Pine Script signals.

### 3. Interactive Chart-Based Order Execution & Draggable TP/SL
* **Draggable Handles Directly on Chart**: Grab Take-Profit (green dashed line) and Stop-Loss (red dashed line) lines to adjust orders in real-time.
* **Dynamic Badges**: Floating badges update real-time dollar profit/loss targets and risk-to-reward (R:R) ratios as you drag.
* **Order Book Depth**: Real-time Level 2 orderbook (Bids/Asks) updated directly from CoinDCX.
* **Trade Context Menu**: Right-click anywhere on the chart to instantly set Buy/Sell limit orders, TP, or SL at that exact price level.

### 4. Real-Time CoinDCX WebSocket Stream (600+ Pairs)
* Live WebSocket connection to CoinDCX (`stream.coindcx.com`).
* Streams tick-by-tick real-time updates for forming candles and ticker prices.
* Live market search across 600+ pairs (`BTC_USDT`, `ETH_USDT`, `SOL_USDT`, etc.).

### 5. Complete Suite of 18+ Marking Tools
* **Line & Ray Tools**: Trend Line (`╱`, `T`), Ray (`↗`), Extended Line (`⟷`), Horizontal Line (`―`, `H`), Horizontal Ray (`⟶`), Vertical Line (`│`, `V`), Parallel Channel (`⫽`).
* **Geometric & Fibonacci**: Fibonacci Retracement (`≡`, 7 golden-ratio levels, `F`), Rectangle / Order Block (`▭`, `R`), Circle Marker (`◯`), Freehand Brush (`✎`, `B`), Arrow Marker (`➜`).
* **Position & Sizing**: Long Risk/Reward Box (`▲`), Short Risk/Reward Box (`▼`), Measure Ruler (`📏`), Text Annotations (`T`), Price Labels (`🏷`).
* **Interactive Timeline & Axis Scaling**:
  * **Bottom Timeline Drag / Swipe**: Drag left/right along the bottom timeline to zoom candle width (make candles big/small).
  * **Right Price Axis Drag / Swipe**: Drag up/down along the right price rail to stretch or compress price height.
  * **Touch Gestures**: Full mobile touch swipe support for chart panning and axis scaling.
  * **Double-Click Reset**: Double-click bottom timeline or right price axis to auto-fit.

### 6. REA Agent MCP Bridge (`morluto/rea`)
* Integrated Reverse Engineer Anything (REA) agent exposing 255 MCP tools for analyzing runtime behavior, API schemas, and market endpoints.

---

## 🚀 Quick Start (Local Run)

### Prerequisites
* Python 3.10+
* Node.js 22+ (optional, for REA MCP tools)

### 1. Clone the Repository
```bash
git clone https://github.com/kapilpatel89/Open-chart.git
cd Open-chart
```

### 2. Install Python Dependencies
```bash
pip install -r requirements.txt
```

### 3. Launch the Server
```bash
python server.py
```
Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your browser.

---

## 🌐 Online Deployment Guide

### Option 1: Deploy to Render.com (1-Click)
This repository includes a [`render.yaml`](render.yaml) file:
1. Fork or push this repository to your GitHub account (`kapilpatel89/Open-chart`).
2. Log into [Render.com](https://render.com) and click **New > Blueprint**.
3. Select your `Open-chart` repository.
4. Render will automatically detect `render.yaml` and deploy the service.

### Option 2: Deploy to Railway.app / Heroku
This repository includes a [`Procfile`](Procfile):
1. In [Railway.app](https://railway.app), click **New Project > Deploy from GitHub repo**.
2. Select `kapilpatel89/Open-chart`.
3. Railway automatically detects the `Procfile` and runs:
   ```bash
   uvicorn server:app --host 0.0.0.0 --port $PORT
   ```

### Option 3: Deploy with Docker
Build and run the Docker image anywhere (VPS, AWS, DigitalOcean, Google Cloud Run):
```bash
# Build Docker image
docker build -t open-chart .

# Run Docker container on port 8000
docker run -d -p 8000:8000 --name open-chart-app open-chart
```
Visit `http://localhost:8000`.

### Option 4: Deploy to Hugging Face Spaces
1. Create a new Space on [Hugging Face](https://huggingface.co/spaces).
2. Choose **Docker** as the SDK.
3. Push this repository to the Space remote. Hugging Face will build the `Dockerfile` and run Open Chart online.

---

## 📁 Project Architecture

```
Open-chart/
├── static/
│   ├── index.html       # Single-page terminal UI with responsive layout
│   ├── style.css        # Glossy obsidian dark theme & 3D styling
│   ├── chart3d.js       # Volumetric 3D Canvas charting engine & marking tools
│   ├── app.js           # WebSocket feeds, order management, UI controller
│   └── pine_editor.js   # Embedded Pine Script IDE & code templates
├── coindcx_feed.py      # CoinDCX multi-market REST & Socket.IO feed
├── order_manager.py     # Position tracking, market/limit orders, TP/SL engine
├── pine_engine.py       # Pine Script v5 lexer, interpreter, & backtester
├── rea_agent.py         # Async/Sync MCP client for morluto/rea
├── server.py            # FastAPI backend & WebSocket server
├── test_system.py       # Automated 6-step verification test suite
├── Dockerfile           # Production container configuration
├── render.yaml          # 1-Click cloud deployment configuration
├── Procfile             # Process file for Heroku/Railway
├── requirements.txt     # Python production dependencies
└── README.md            # Documentation
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Q` or `Esc` | Crosshair Cursor / Pan Mode |
| `T` | Trend Line Tool |
| `H` | Horizontal Support / Resistance Line |
| `V` | Vertical Line |
| `F` | Fibonacci Retracement |
| `R` | Rectangle / Order Block |
| `B` | Freehand Brush Tool |
| `Delete` | Clear All User Drawings |

---

## 📄 License
MIT License. Free for personal and commercial trading systems.
