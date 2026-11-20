"""
CoinDCX Market Data & High-Speed WebSocket Feed Manager
Provides multi-market tickers, historical candles, order book, and real-time tick streaming.
"""

import asyncio
import json
import re
import time
import urllib.request
from typing import Dict, List, Any, Optional, Callable

import socketio

class CoinDCXFeed:
    PUBLIC_BASE_URL = "https://public.coindcx.com"
    API_BASE_URL = "https://api.coindcx.com"
    SOCKET_URL = "https://stream.coindcx.com"

    def __init__(self):
        self.tickers: Dict[str, Dict[str, Any]] = {}
        self.last_ticker_update: float = 0
        self.sio: Optional[socketio.AsyncClient] = None
        self.subscribers: List[Callable[[Dict[str, Any]], None]] = []
        self.active_pairs: set = {"B-BTC_USDT", "B-ETH_USDT", "B-SOL_USDT", "B-XRP_USDT", "B-DOGE_USDT"}
        self.live_prices: Dict[str, float] = {}
        self._candles_cache: Dict[str, Any] = {}
        self._running = False
        self._sio_connected = False

    def subscribe(self, callback: Callable[[Dict[str, Any]], None]):
        self.subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[Dict[str, Any]], None]):
        if callback in self.subscribers:
            self.subscribers.remove(callback)

    async def broadcast(self, message: Dict[str, Any]):
        for sub in self.subscribers:
            try:
                if asyncio.iscoroutinefunction(sub):
                    await sub(message)
                else:
                    sub(message)
            except Exception:
                pass

    def fetch_all_tickers(self) -> List[Dict[str, Any]]:
        """Fetch 24h tickers from CoinDCX REST API."""
        now = time.time()
        if now - self.last_ticker_update < 2.0 and self.tickers:
            return list(self.tickers.values())

        url = f"{self.API_BASE_URL}/exchange/ticker"
        req = urllib.request.Request(url, headers={"User-Agent": "CoinDCX-Pro-Terminal/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode())
                if isinstance(data, list):
                    for item in data:
                        m = item.get("market", "")
                        self.tickers[m] = item
                        lp = float(item.get("last_price", 0) or 0)
                        if lp > 0:
                            self.live_prices[m] = lp
                    self.last_ticker_update = now
                    return data
        except Exception as e:
            print(f"[CoinDCXFeed] Ticker fetch error: {e}")
        return list(self.tickers.values())

    def get_market_list(self) -> List[Dict[str, Any]]:
        """Return formatted list of USDT crypto pairs."""
        all_t = self.fetch_all_tickers()
        markets = []
        for t in all_t:
            m = t.get("market", "")
            if "USDT" in m:
                lp = float(t.get("last_price", 0) or 0)
                chg = float(t.get("change_24_hour", 0) or 0)
                vol = float(t.get("volume", 0) or 0)
                markets.append({
                    "symbol": m,
                    "name": m.replace("B-", "").replace("_", "/"),
                    "last_price": lp,
                    "change_24h": round(chg, 2),
                    "volume": round(vol, 2)
                })
        markets.sort(key=lambda x: x["volume"], reverse=True)
        return markets

    def fetch_candles(self, pair: str, interval: str = "1h", limit: int = 160) -> List[Dict[str, Any]]:
        """Fetch historical OHLCV candlesticks for given pair and timeframe."""
        clean_pair = pair.strip()
        norm_interval = interval.lower().strip()
        if not clean_pair.startswith("B-") and "_" in clean_pair:
            clean_pair = f"B-{clean_pair}"

        cache_key = f"{clean_pair}_{norm_interval}_{limit}"
        now = time.time()
        if hasattr(self, "_candles_cache") and cache_key in self._candles_cache:
            cached_time, cached_data = self._candles_cache[cache_key]
            if now - cached_time < 5.0 and len(cached_data) > 0:
                return cached_data

        candidates = [clean_pair]
        stripped = re.sub(r'1000000|100000|10000|1000|1M|1K', '', clean_pair)
        if stripped != clean_pair:
            candidates.append(stripped)

        # Also support spot pair fallback without B- if futures fails
        if clean_pair.startswith("B-"):
            candidates.append(clean_pair.replace("B-", ""))

        # Standard intervals: 1m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 1d
        for p in candidates:
            url = f"{self.PUBLIC_BASE_URL}/market_data/candles/?pair={p}&interval={norm_interval}&limit={limit}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CoinDCX-Pro/2.0"})
            try:
                with urllib.request.urlopen(req, timeout=6) as resp:
                    data = json.loads(resp.read().decode())
                    if isinstance(data, list) and len(data) > 0:
                        candles = []
                        for c in data:
                            t = int(c.get("time", 0))
                            if t < 10000000000:
                                t *= 1000
                            candles.append({
                                "time": t,
                                "open": float(c.get("open", 0)),
                                "high": float(c.get("high", 0)),
                                "low": float(c.get("low", 0)),
                                "close": float(c.get("close", 0)),
                                "volume": float(c.get("volume", 0))
                            })
                        candles.sort(key=lambda x: x["time"])
                        self._candles_cache[cache_key] = (now, candles)
                        return candles
            except Exception:
                continue

        return []

    def fetch_orderbook(self, pair: str, depth: int = 20) -> Dict[str, Any]:
        """Fetch Level-2 order book depth for pair."""
        clean_pair = pair
        if not clean_pair.startswith("B-") and "_" in clean_pair:
            clean_pair = f"B-{clean_pair}"

        url = f"{self.PUBLIC_BASE_URL}/market_data/orderbook?pair={clean_pair}"
        req = urllib.request.Request(url, headers={"User-Agent": "CoinDCX-Pro-Terminal/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
                bids_raw = data.get("bids", {})
                asks_raw = data.get("asks", {})
                
                bids = sorted([[float(p), float(q)] for p, q in bids_raw.items()], key=lambda x: x[0], reverse=True)[:depth]
                asks = sorted([[float(p), float(q)] for p, q in asks_raw.items()], key=lambda x: x[0])[:depth]
                return {"bids": bids, "asks": asks, "pair": clean_pair, "timestamp": time.time() * 1000}
        except Exception:
            pass
        return {"bids": [], "asks": [], "pair": clean_pair, "timestamp": time.time() * 1000}

    async def add_pair(self, pair: str):
        self.active_pairs.add(pair)
        if self.sio and self._sio_connected:
            channel_futures = f"{pair}@trades-futures"
            clean_p = pair.replace("B-", "")
            channel_spot = f"{clean_p}@trades"
            try:
                await self.sio.emit("join", {"channelName": channel_futures})
                await self.sio.emit("join", {"channelName": channel_spot})
            except Exception:
                pass

    async def start(self):
        """Start WebSocket streaming and fallback background polling."""
        self._running = True
        asyncio.create_task(self._socketio_worker())
        asyncio.create_task(self._polling_fallback_worker())

    async def stop(self):
        self._running = False
        if self.sio:
            try:
                await self.sio.disconnect()
            except Exception:
                pass

    async def _socketio_worker(self):
        while self._running:
            try:
                self.sio = socketio.AsyncClient(reconnection=True, reconnection_delay=2)

                @self.sio.event
                async def connect():
                    self._sio_connected = True
                    print("[CoinDCX Feed] WebSocket connected to stream.coindcx.com")
                    for pair in list(self.active_pairs):
                        channel_futures = f"{pair}@trades-futures"
                        clean_p = pair.replace("B-", "")
                        channel_spot = f"{clean_p}@trades"
                        await self.sio.emit("join", {"channelName": channel_futures})
                        await self.sio.emit("join", {"channelName": channel_spot})

                @self.sio.event
                async def disconnect():
                    self._sio_connected = False
                    print("[CoinDCX Feed] WebSocket disconnected")

                @self.sio.on("new-trade")
                async def on_new_trade(res):
                    try:
                        raw = res.get("data", "")
                        payload = json.loads(raw) if isinstance(raw, str) else raw
                        await self._handle_incoming_trade(payload)
                    except Exception:
                        pass

                @self.sio.on("*")
                async def catch_all(event, data):
                    if isinstance(data, dict):
                        raw = data.get("data", "")
                        if isinstance(raw, str) and raw:
                            try:
                                payload = json.loads(raw)
                                await self._handle_incoming_trade(payload)
                            except Exception:
                                pass
                        elif "p" in data and "q" in data:
                            await self._handle_incoming_trade(data)

                await self.sio.connect(self.SOCKET_URL, transports=["websocket"], wait_timeout=10)
                while self._running and self.sio.connected:
                    await asyncio.sleep(1)
            except Exception as e:
                await asyncio.sleep(3)

    async def _handle_incoming_trade(self, data: Dict[str, Any]):
        try:
            price = float(data.get("p", 0) or data.get("price", 0) or 0)
            qty = float(data.get("q", 0) or data.get("quantity", 0) or 0)
            sym = data.get("s", "") or data.get("symbol", "") or "B-BTC_USDT"
            t = int(data.get("T", 0) or time.time() * 1000)

            if price > 0:
                self.live_prices[sym] = price
                clean_sym = sym.replace("B-", "")
                self.live_prices[clean_sym] = price

                await self.broadcast({
                    "type": "tick",
                    "symbol": sym,
                    "price": price,
                    "quantity": qty,
                    "time": t
                })
        except Exception:
            pass

    async def _polling_fallback_worker(self):
        """Fallback polling ensuring continuous price accuracy for all active pairs."""
        while self._running:
            try:
                await asyncio.sleep(1.0)
                tickers = await asyncio.to_thread(self.fetch_all_tickers)
                for t in tickers:
                    m = t.get("market", "")
                    if m in self.active_pairs or m.replace("B-", "") in self.active_pairs or f"B-{m}" in self.active_pairs:
                        lp = float(t.get("last_price", 0) or 0)
                        if lp > 0:
                            self.live_prices[m] = lp
                            await self.broadcast({
                                "type": "tick",
                                "symbol": m,
                                "price": lp,
                                "quantity": float(t.get("volume", 0) or 1.0),
                                "time": int(time.time() * 1000)
                            })
            except Exception:
                await asyncio.sleep(2.0)
