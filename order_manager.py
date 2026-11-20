"""
Order Execution and Position Manager
Handles Market, Limit, Stop-Limit, and Visual Draggable TP/SL orders.
Tracks positions, calculates real-time unrealized/realized PnL and risk-reward ratios.
"""

import time
import uuid
from typing import Dict, List, Optional, Any

class OrderManager:
    def __init__(self, initial_balance: float = 10000.0):
        self.balance: float = initial_balance
        self.equity: float = initial_balance
        self.orders: Dict[str, Dict[str, Any]] = {}
        self.positions: Dict[str, Dict[str, Any]] = {}
        self.trade_history: List[Dict[str, Any]] = []

    def place_order(
        self,
        symbol: str,
        side: str,              # "buy" or "sell"
        order_type: str,        # "market", "limit"
        quantity: float,
        price: Optional[float] = None,
        take_profit: Optional[float] = None,
        stop_loss: Optional[float] = None,
        source: str = "manual"  # "manual" or "pine_script"
    ) -> Dict[str, Any]:
        order_id = f"ord_{uuid.uuid4().hex[:8]}"
        created_at = time.time()

        order = {
            "id": order_id,
            "symbol": symbol.upper(),
            "side": side.lower(),
            "type": order_type.lower(),
            "quantity": float(quantity),
            "price": float(price) if price else None,
            "take_profit": float(take_profit) if take_profit else None,
            "stop_loss": float(stop_loss) if stop_loss else None,
            "status": "open",
            "filled_price": None,
            "created_at": created_at,
            "source": source
        }

        self.orders[order_id] = order
        return order

    def update_tp_sl(self, order_or_pos_id: str, take_profit: Optional[float], stop_loss: Optional[float]) -> bool:
        """Update Take-Profit and Stop-Loss for an open order or existing position."""
        if order_or_pos_id in self.orders:
            if take_profit is not None:
                self.orders[order_or_pos_id]["take_profit"] = float(take_profit)
            if stop_loss is not None:
                self.orders[order_or_pos_id]["stop_loss"] = float(stop_loss)
            return True

        if order_or_pos_id in self.positions:
            if take_profit is not None:
                self.positions[order_or_pos_id]["take_profit"] = float(take_profit)
            if stop_loss is not None:
                self.positions[order_or_pos_id]["stop_loss"] = float(stop_loss)
            return True
        return False

    def cancel_order(self, order_id: str) -> bool:
        if order_id in self.orders and self.orders[order_id]["status"] == "open":
            self.orders[order_id]["status"] = "cancelled"
            return True
        return False

    def on_tick(self, symbol: str, current_price: float) -> List[Dict[str, Any]]:
        """
        Evaluate all open limit orders, positions TP/SL against incoming real-time price tick.
        Returns events (e.g. order filled, position closed).
        """
        symbol = symbol.upper()
        events = []

        # 1. Check open limit & market orders
        for order_id, order in list(self.orders.items()):
            if order["symbol"] != symbol or order["status"] != "open":
                continue

            should_fill = False
            fill_price = current_price

            if order["type"] == "market":
                should_fill = True
                fill_price = current_price
            elif order["type"] == "limit":
                if order["side"] == "buy" and current_price <= order["price"]:
                    should_fill = True
                    fill_price = order["price"]
                elif order["side"] == "sell" and current_price >= order["price"]:
                    should_fill = True
                    fill_price = order["price"]

            if should_fill:
                order["status"] = "filled"
                order["filled_price"] = fill_price
                order["filled_at"] = time.time()

                # Open or add to position
                pos = self._execute_position(order, fill_price)
                events.append({
                    "event": "order_filled",
                    "order": order,
                    "position": pos
                })

        # 2. Check open positions for Take Profit / Stop Loss
        for pos_id, pos in list(self.positions.items()):
            if pos["symbol"] != symbol:
                continue

            entry = pos["entry_price"]
            side = pos["side"]
            tp = pos.get("take_profit")
            sl = pos.get("stop_loss")

            # Update current PnL
            if side == "buy":
                pos["unrealized_pnl"] = (current_price - entry) * pos["quantity"]
                pos["unrealized_pnl_pct"] = ((current_price - entry) / entry) * 100.0
            else:
                pos["unrealized_pnl"] = (entry - current_price) * pos["quantity"]
                pos["unrealized_pnl_pct"] = ((entry - current_price) / entry) * 100.0

            close_reason = None
            if side == "buy":
                if tp and current_price >= tp:
                    close_reason = "take_profit"
                elif sl and current_price <= sl:
                    close_reason = "stop_loss"
            elif side == "sell":
                if tp and current_price <= tp:
                    close_reason = "take_profit"
                elif sl and current_price >= sl:
                    close_reason = "stop_loss"

            if close_reason:
                closed_record = self._close_position(pos_id, current_price, close_reason)
                events.append({
                    "event": "position_closed",
                    "reason": close_reason,
                    "record": closed_record
                })

        return events

    def _execute_position(self, order: Dict[str, Any], fill_price: float) -> Dict[str, Any]:
        pos_id = f"pos_{order['symbol']}_{uuid.uuid4().hex[:6]}"
        pos = {
            "id": pos_id,
            "order_id": order["id"],
            "symbol": order["symbol"],
            "side": order["side"],
            "quantity": order["quantity"],
            "entry_price": fill_price,
            "current_price": fill_price,
            "take_profit": order.get("take_profit"),
            "stop_loss": order.get("stop_loss"),
            "unrealized_pnl": 0.0,
            "unrealized_pnl_pct": 0.0,
            "opened_at": time.time(),
            "source": order.get("source", "manual")
        }
        self.positions[pos_id] = pos
        return pos

    def _close_position(self, pos_id: str, exit_price: float, reason: str = "manual") -> Dict[str, Any]:
        pos = self.positions.pop(pos_id, None)
        if not pos:
            return {}

        entry = pos["entry_price"]
        qty = pos["quantity"]
        if pos["side"] == "buy":
            realized_pnl = (exit_price - entry) * qty
        else:
            realized_pnl = (entry - exit_price) * qty

        pnl_pct = (realized_pnl / (entry * qty)) * 100.0 if (entry * qty) > 0 else 0.0
        self.balance += realized_pnl

        record = {
            "id": pos["id"],
            "symbol": pos["symbol"],
            "side": pos["side"],
            "quantity": qty,
            "entry_price": entry,
            "exit_price": exit_price,
            "realized_pnl": round(realized_pnl, 4),
            "pnl_pct": round(pnl_pct, 2),
            "reason": reason,
            "closed_at": time.time(),
            "source": pos.get("source", "manual")
        }
        self.trade_history.insert(0, record)
        return record

    def close_position_manual(self, pos_id: str, current_price: float) -> Dict[str, Any]:
        return self._close_position(pos_id, current_price, "manual_close")

    def get_summary(self) -> Dict[str, Any]:
        unrealized = sum(p.get("unrealized_pnl", 0.0) for p in self.positions.values())
        return {
            "balance": round(self.balance, 2),
            "equity": round(self.balance + unrealized, 2),
            "unrealized_pnl": round(unrealized, 2),
            "open_positions": list(self.positions.values()),
            "open_orders": [o for o in self.orders.values() if o["status"] == "open"],
            "trade_history": self.trade_history[:50]
        }
