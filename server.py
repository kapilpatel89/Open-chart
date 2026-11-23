"""
Open Chart - Advanced TradingView Alternative Backend
Integrates CoinDCX WebSockets, Pine Script Engine, 3D Charting API,
Interactive Visual Orders & TP/SL, and REA Agent MCP Bridge.
"""

import asyncio
import json
import os
import time
from typing import Dict, Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from coindcx_feed import CoinDCXFeed
from order_manager import OrderManager
from pine_engine import PineEngine
from indian_market import indian_market
from kotak_client import kotak_client

app = FastAPI(title="Open Chart - 3D Trading Terminal", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Core Instances
feed = CoinDCXFeed()
order_manager = OrderManager(initial_balance=10000.0)
active_websockets: set = set()

# Ensure static directory exists
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.on_event("startup")
async def startup_event():
    # Start CoinDCX live feed
    await feed.start()
    feed.subscribe(on_feed_tick)
    print("[Server] CoinDCX Feed & Order Engine started successfully!")

@app.on_event("shutdown")
async def shutdown_event():
    await feed.stop()

async def on_feed_tick(msg: Dict[str, Any]):
    """Handle incoming price tick, evaluate open orders/TP/SL, and broadcast to clients."""
    if msg.get("type") == "tick":
        sym = msg["symbol"]
        price = msg["price"]

        # Check order manager triggers (Limit fills, TP/SL executions)
        events = order_manager.on_tick(sym, price)

        # Broadcast tick
        payload = json.dumps({
            "type": "tick",
            "symbol": sym,
            "price": price,
            "time": msg.get("time", int(time.time() * 1000)),
            "events": events
        })

        # Send to all connected frontend clients
        disconnected = set()
        for ws in list(active_websockets):
            try:
                await ws.send_text(payload)
            except Exception:
                disconnected.add(ws)
        active_websockets.difference_update(disconnected)

# --- Routes ---

@app.get("/")
async def root():
    root_index = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(root_index):
        return FileResponse(root_index)
    static_index = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(static_index):
        return FileResponse(static_index)
    return {"message": "Open Chart Trading Server is running."}

@app.get("/api/markets")
async def get_markets():
    """Return top CoinDCX USDT crypto pairs with 24h ticker metrics."""
    return feed.get_market_list()

@app.get("/api/candles")
async def get_candles(pair: str = "B-BTC_USDT", interval: str = "1h", limit: int = 150):
    """Return historical OHLCV candlesticks for Crypto or Indian Markets."""
    clean_sym = pair.replace("B-", "").replace("_USDT", "").replace("USDT", "").strip().upper()
    base_candidate = clean_sym.split()[0] if clean_sym else ""
    if (clean_sym in indian_market.live_prices 
        or base_candidate in indian_market.live_prices 
        or "NIFTY" in clean_sym 
        or "SENSEX" in clean_sym 
        or "BANKEX" in clean_sym 
        or clean_sym.endswith(" CE") 
        or clean_sym.endswith(" PE")):
        return indian_market.get_candles(clean_sym, interval, limit)
    candles = await asyncio.to_thread(feed.fetch_candles, pair, interval, limit)
    return candles

# --- Indian Market & Options Chain Endpoints ---

@app.get("/api/indian/indices")
async def get_indian_indices():
    """Return live quotes for all Indian benchmark indices & NSE/BSE market session status."""
    return {
        "indices": indian_market.get_indices_list(),
        "market_session": indian_market.is_market_open()
    }

@app.get("/api/indian/trending")
async def get_indian_trending(filter: str = "all", limit: int = 30):
    """Return Indian market trending stocks with Top Up, Top Down, and Low Price High Vol filters."""
    return indian_market.get_trending_stocks(filter_type=filter, limit=limit)

@app.get("/api/indian/optionchain/{symbol}")
async def get_indian_optionchain(symbol: str, expiry: Optional[str] = None, count: int = 21):
    """Return complete Black-Scholes Option Chain Matrix with Greeks, PCR, and Max Pain."""
    return indian_market.get_option_chain(underlying=symbol, expiry=expiry, count=count)

@app.get("/api/indian/candles")
async def get_indian_candles(symbol: str = "NIFTY", interval: str = "1h", limit: int = 150):
    """Return OHLCV candlesticks for an Indian index or equity."""
    return indian_market.get_candles(underlying=symbol, interval=interval, limit=limit)

# --- Kotak Neo Trade API & Whitelisted Relay Endpoints ---

@app.get("/api/kotak/status")
async def get_kotak_status():
    """Return Kotak Neo API connection and 2FA authentication state."""
    return kotak_client.get_status()

@app.get("/api/kotak/ping")
async def ping_kotak_relay():
    """Test connection to the whitelisted cPanel relay server and fetch its outbound static IP."""
    return kotak_client.ping_relay()

@app.post("/api/kotak/config")
async def set_kotak_relay_config(
    relay_url: str = Body(...),
    passphrase: Optional[str] = Body(None)
):
    """Dynamically configure the cPanel relay endpoint URL."""
    kotak_client.set_relay_config(relay_url, passphrase)
    return {"status": "success", "relay_url": kotak_client.relay_url}

@app.post("/api/kotak/login/step1")
async def kotak_login_step1(
    consumer_key: str = Body(...),
    mobile_number: str = Body(...),
    ucc: str = Body(...),
    mpin: Optional[str] = Body(None),
    environment: str = Body("prod"),
    relay_url: Optional[str] = Body(None)
):
    """Step 1: Initiate Kotak Neo API session and verify relay reachability."""
    return kotak_client.login_step1_initiate(consumer_key, mobile_number, ucc, mpin, environment, relay_url)

@app.post("/api/kotak/login/step2")
async def kotak_login_step2(
    totp: str = Body(...),
    mpin: Optional[str] = Body(None)
):
    """Step 2: Validate 2FA TOTP/OTP and MPIN via whitelisted cPanel static IP relay."""
    return kotak_client.login_step2_verify(totp, mpin)

@app.get("/api/kotak/limits")
async def get_kotak_limits():
    """Return real cash balance and margin limits from Kotak Neo."""
    return kotak_client.get_live_limits()

@app.get("/api/kotak/positions")
async def get_kotak_positions():
    """Return live broker positions from Kotak Neo."""
    return kotak_client.get_live_positions()

@app.get("/api/kotak/orders")
async def get_kotak_orders():
    """Return live broker orders from Kotak Neo."""
    return kotak_client.get_live_orders()

@app.post("/api/kotak/order/place")
async def place_kotak_live_order(
    symbol: str = Body(...),
    transaction_type: str = Body(...),
    quantity: int = Body(...),
    order_type: str = Body("MKT"),
    price: float = Body(0.0),
    trigger_price: float = Body(0.0),
    product: str = Body("MIS"),
    exchange_segment: str = Body("nse_fo"),
    tag: str = Body("open_chart_relay")
):
    """Directly place live order on NSE/BSE through whitelisted cPanel static IP relay."""
    return kotak_client.place_live_order(
        symbol=symbol,
        transaction_type=transaction_type,
        quantity=quantity,
        order_type=order_type,
        price=price,
        trigger_price=trigger_price,
        product=product,
        exchange_segment=exchange_segment,
        tag=tag
    )

@app.post("/api/kotak/order/cancel")
async def cancel_kotak_live_order(order_id: str = Body(..., embed=True)):
    """Cancel live order on Kotak Neo through whitelisted relay."""
    return kotak_client.cancel_live_order(order_id)

@app.get("/api/orderbook")
async def get_orderbook(pair: str = "B-BTC_USDT", depth: int = 20):
    """Return Level-2 bids & asks depth."""
    clean_sym = pair.replace("B-", "").replace("_USDT", "").replace("USDT", "").strip().upper()
    base_candidate = clean_sym.split()[0] if clean_sym else ""
    if (clean_sym in indian_market.live_prices 
        or base_candidate in indian_market.live_prices 
        or "NIFTY" in clean_sym 
        or "SENSEX" in clean_sym 
        or "BANKEX" in clean_sym 
        or clean_sym.endswith(" CE") 
        or clean_sym.endswith(" PE")):
        return indian_market.get_orderbook(clean_sym, depth)
    return await asyncio.to_thread(feed.fetch_orderbook, pair, depth)

@app.get("/api/portfolio")
async def get_portfolio():
    """Return paper trading balance, equity, positions, and open orders."""
    return order_manager.get_summary()

@app.post("/api/orders")
async def place_order(
    symbol: str = Body(...),
    side: str = Body(...),
    order_type: str = Body("market"),
    quantity: float = Body(...),
    price: Optional[float] = Body(None),
    take_profit: Optional[float] = Body(None),
    stop_loss: Optional[float] = Body(None),
    source: str = Body("manual")
):
    """Place a new order (Market or Limit) with optional visual TP/SL and live Kotak relay execution."""
    clean_sym = symbol.replace("B-", "").replace("_USDT", "").replace("USDT", "").strip().upper()
    is_indian = (clean_sym in indian_market.live_prices 
                 or "NIFTY" in clean_sym 
                 or "SENSEX" in clean_sym 
                 or "BANKEX" in clean_sym 
                 or clean_sym.endswith(" CE") 
                 or clean_sym.endswith(" PE"))

    kotak_res = None
    if is_indian and kotak_client.is_logged_in and kotak_client.relay_session:
        # Route live order through whitelisted cPanel relay
        kotak_res = kotak_client.place_live_order(
            symbol=clean_sym,
            transaction_type=side.upper(),
            quantity=int(quantity),
            order_type="MKT" if order_type.lower() == "market" else "L",
            price=price or 0.0
        )

    order = order_manager.place_order(
        symbol=symbol,
        side=side,
        order_type=order_type,
        quantity=quantity,
        price=price,
        take_profit=take_profit,
        stop_loss=stop_loss,
        source=source
    )
    if kotak_res:
        order["kotak_live"] = kotak_res
    
    # Check if market order can execute immediately with latest price
    cur_p = None
    if is_indian:
        cur_p = indian_market.live_prices.get(clean_sym) or price
        if not cur_p:
            parts = clean_sym.split()
            if len(parts) >= 3 and parts[-1] in ["CE", "PE"]:
                from greeks import calculate_greeks
                cfg = indian_market.INDIAN_INDICES.get(parts[0])
                spot_val = cfg["default_spot"] if cfg else 1000.0
                g = calculate_greeks(spot=spot_val, strike=float(parts[1]), dte=4, iv=0.15, option_type=parts[2])
                cur_p = g["price"]
    else:
        cur_p = feed.live_prices.get(symbol) or feed.live_prices.get(f"B-{symbol}") or price

    if cur_p and order_type.lower() == "market":
        order_manager.on_tick(symbol, cur_p)

    return {"status": "success", "order": order, "kotak_relay": kotak_res, "portfolio": order_manager.get_summary()}

@app.put("/api/orders/{order_id}/tpsl")
async def update_tp_sl(order_id: str, take_profit: Optional[float] = Body(None), stop_loss: Optional[float] = Body(None)):
    """Update Take-Profit and Stop-Loss by dragging lines on the chart."""
    success = order_manager.update_tp_sl(order_id, take_profit, stop_loss)
    if not success:
        raise HTTPException(status_code=404, detail="Order or position not found")
    return {"status": "success", "portfolio": order_manager.get_summary()}

@app.delete("/api/orders/{order_id}")
async def cancel_order(order_id: str):
    success = order_manager.cancel_order(order_id)
    return {"status": "success" if success else "failed", "portfolio": order_manager.get_summary()}

@app.post("/api/positions/{pos_id}/close")
async def close_position(pos_id: str, symbol: str = Body(...)):
    cur_p = feed.live_prices.get(symbol) or 0.0
    rec = order_manager.close_position_manual(pos_id, cur_p)
    return {"status": "success", "record": rec, "portfolio": order_manager.get_summary()}

@app.post("/api/pine/verify")
async def verify_pine_script(code: str = Body(..., embed=True)):
    """Statically verifies Pine Script syntax and returns diagnostic issues with suggested fixes."""
    return PineEngine.verify_code(code)

@app.post("/api/pine/execute")
async def execute_pine_script(
    pair: str = Body("B-BTC_USDT"),
    interval: str = Body("1h"),
    code: str = Body(...)
):
    """Compile & run Pine Script on pair's candles, returning plots, signals and backtest."""
    candles = await asyncio.to_thread(feed.fetch_candles, pair, interval, 200)
    result = PineEngine.execute_script(code, candles)
    return result

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.add(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle incoming client commands (e.g. subscribe to pair)
            try:
                cmd = json.loads(data)
                if cmd.get("action") == "subscribe" and "pair" in cmd:
                    await feed.add_pair(cmd["pair"])
            except Exception:
                pass
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
    except Exception:
        active_websockets.discard(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
