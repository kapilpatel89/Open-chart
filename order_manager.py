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

    def update_tp_sl(
        self,
        order_or_pos_id: str,
        take_profit: Optional[float] = None,
        stop_loss: Optional[float] = None,
        clear_tp: bool = False,
        clear_sl: bool = False,
        price: Optional[float] = None
    ) -> bool:
        """Update or clear Take-Profit, Stop-Loss, or Limit Price for an open order or existing position."""
        updated = False
        if order_or_pos_id in self.orders:
            ord_obj = self.orders[order_or_pos_id]
            if price is not None and float(price) > 0:
                ord_obj["price"] = float(price)
            if clear_tp:
                ord_obj["take_profit"] = None
            elif take_profit is not None:
                ord_obj["take_profit"] = float(take_profit)
            if clear_sl:
                ord_obj["stop_loss"] = None
            elif stop_loss is not None:
                ord_obj["stop_loss"] = float(stop_loss)
            updated = True

        if order_or_pos_id in self.positions:
            pos_obj = self.positions[order_or_pos_id]
            if clear_tp:
                pos_obj["take_profit"] = None
            elif take_profit is not None:
                pos_obj["take_profit"] = float(take_profit)
            if clear_sl:
                pos_obj["stop_loss"] = None
            elif stop_loss is not None:
                pos_obj["stop_loss"] = float(stop_loss)
            updated = True

        # Also update/cancel linked bracket exit orders
        for o in self.orders.values():
            if o.get("parent_pos_id") == order_or_pos_id and o.get("status") == "open":
                if o.get("source") == "bracket_take_profit":
                    if clear_tp:
                        o["status"] = "cancelled"
                        updated = True
                    elif take_profit is not None:
                        o["price"] = float(take_profit)
                        updated = True
                if o.get("source") == "bracket_stop_loss":
                    if clear_sl:
                        o["status"] = "cancelled"
                        updated = True
                    elif stop_loss is not None:
                        o["price"] = float(stop_loss)
                        updated = True

        return updated

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

                if order.get("parent_pos_id"):
                    # This is an exit order for an existing position!
                    pos_id = order["parent_pos_id"]
                    if pos_id in self.positions:
                        reason = "take_profit" if "take_profit" in order.get("source", "") else "stop_loss"
                        closed_rec = self._close_position(pos_id, fill_price, reason)
                        events.append({
                            "event": "position_closed",
                            "reason": reason,
                            "record": closed_rec
                        })
                else:
                    # Normal entry order: Open or add to position
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

        # Immediately place linked OCO Sell exit orders for Take-Profit and Stop-Loss
        exit_side = "sell" if order["side"] == "buy" else "buy"
        if order.get("take_profit"):
            tp_order_id = f"ord_tp_{uuid.uuid4().hex[:6]}"
            self.orders[tp_order_id] = {
                "id": tp_order_id,
                "parent_pos_id": pos_id,
                "symbol": order["symbol"],
                "side": exit_side,
                "type": "limit",
                "quantity": order["quantity"],
                "price": float(order["take_profit"]),
                "take_profit": None,
                "stop_loss": None,
                "status": "open",
                "filled_price": None,
                "created_at": time.time(),
                "source": "bracket_take_profit"
            }
        if order.get("stop_loss"):
            sl_order_id = f"ord_sl_{uuid.uuid4().hex[:6]}"
            self.orders[sl_order_id] = {
                "id": sl_order_id,
                "parent_pos_id": pos_id,
                "symbol": order["symbol"],
                "side": exit_side,
                "type": "stop",
                "quantity": order["quantity"],
                "price": float(order["stop_loss"]),
                "take_profit": None,
                "stop_loss": None,
                "status": "open",
                "filled_price": None,
                "created_at": time.time(),
                "source": "bracket_stop_loss"
            }

        return pos

    def _close_position(self, pos_id: str, exit_price: float, reason: str = "manual") -> Dict[str, Any]:
        pos = self.positions.pop(pos_id, None)
        if not pos:
            return {}

        # Cancel any remaining linked TP/SL exit orders for this closed position
        for o in self.orders.values():
            if o.get("parent_pos_id") == pos_id and o.get("status") == "open":
                o["status"] = "filled" if (o.get("source") == f"bracket_{reason}") else "cancelled"

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
