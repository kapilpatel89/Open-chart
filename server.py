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
    """Return historical OHLCV candlesticks."""
    candles = await asyncio.to_thread(feed.fetch_candles, pair, interval, limit)
    return candles

@app.get("/api/orderbook")
async def get_orderbook(pair: str = "B-BTC_USDT", depth: int = 20):
    """Return Level-2 bids & asks depth."""
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
    """Place a new order (Market or Limit) with optional visual TP/SL."""
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
    
    # Check if market order can execute immediately with latest price
    cur_p = feed.live_prices.get(symbol) or feed.live_prices.get(f"B-{symbol}") or price
    if cur_p and order_type == "market":
        order_manager.on_tick(symbol, cur_p)

    return {"status": "success", "order": order, "portfolio": order_manager.get_summary()}

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
