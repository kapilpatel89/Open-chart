"""
Self-Test Verification Script for Open Chart
Tests CoinDCX market data, candles, orderbook, order placement,
draggable TP/SL updates, Pine Script execution, and REA Agent.
"""

import asyncio
import time
from coindcx_feed import CoinDCXFeed
from order_manager import OrderManager
from pine_engine import PineEngine
from rea_agent import ReaAgent

async def run_all_tests():
    print("==================================================")
    print("        Open Chart System Self-Test")
    print("==================================================")

    # 1. Test CoinDCX Feed & REST Market Data
    print("\n[1/6] Testing CoinDCX Feed & Candles API...")
    feed = CoinDCXFeed()
    markets = feed.get_market_list()
    print(f"  -> Fetched {len(markets)} USDT markets from CoinDCX.")
    assert len(markets) > 0, "No markets found!"

    candles = feed.fetch_candles("B-BTC_USDT", "1h", 100)
    print(f"  -> Fetched {len(candles)} candles for B-BTC_USDT.")
    assert len(candles) > 0, "Candles list is empty!"
    print(f"  -> Latest candle: Close=${candles[-1]['close']} Vol={candles[-1]['volume']}")

    # 2. Test CoinDCX Orderbook
    print("\n[2/6] Testing CoinDCX Order Book Depth...")
    ob = feed.fetch_orderbook("B-BTC_USDT", 10)
    print(f"  -> Orderbook Bids count: {len(ob.get('bids', []))}, Asks count: {len(ob.get('asks', []))}")
    assert len(ob.get('bids', [])) > 0 or len(ob.get('asks', [])) > 0, "Orderbook empty!"

    # 3. Test Pine Script Engine
    print("\n[3/6] Testing Pine Script Engine & Backtester...")
    sample_script = """
    //@version=5
    strategy("EMA Scalper", overlay=true)
    ema9 = ta.ema(close, 9)
    ema21 = ta.ema(close, 21)
    plot(ema9, "EMA 9")
    plot(ema21, "EMA 21")
    """
    pine_res = PineEngine.execute_script(sample_script, candles)
    print(f"  -> Pine Script Plots generated: {len(pine_res['plots'])}")
    print(f"  -> Pine Strategy Signals: {len(pine_res['signals'])}")
    print(f"  -> Backtest Net Profit: ${pine_res['metrics']['net_profit']} (Win Rate: {pine_res['metrics']['win_rate']}%)")
    assert len(pine_res['plots']) >= 2, "Pine plots calculation failed!"

    # 4. Test Order Execution & Visual Draggable TP/SL
    print("\n[4/6] Testing Order Placement & Draggable TP/SL...")
    om = OrderManager(initial_balance=10000.0)
    last_price = candles[-1]['close']

    # Place Market Order with TP and SL
    order = om.place_order(
        symbol="B-BTC_USDT",
        side="buy",
        order_type="market",
        quantity=0.5,
        price=last_price,
        take_profit=last_price * 1.03,
        stop_loss=last_price * 0.98
    )
    print(f"  -> Placed Market Order: {order['id']} for 0.5 BTC")

    # Simulate price tick executing order
    events = om.on_tick("B-BTC_USDT", last_price)
    print(f"  -> Tick execution: {len(events)} events triggered. Order filled.")
    assert len(om.positions) == 1, "Position was not opened!"
    pos_id = list(om.positions.keys())[0]

    # Test Dragging TP line on chart (Updating TP)
    new_tp = last_price * 1.05
    new_sl = last_price * 0.97
    updated = om.update_tp_sl(pos_id, new_tp, new_sl)
    assert updated, "TP/SL update failed!"
    print(f"  -> Dragged TP/SL on chart updated successfully: New TP=${round(new_tp, 2)}, New SL=${round(new_sl, 2)}")

    # 5. Test Take Profit Trigger Execution
    print("\n[5/6] Testing Take-Profit Hit Trigger...")
    events_tp = om.on_tick("B-BTC_USDT", new_tp + 10.0)
    print(f"  -> Price spiked to ${round(new_tp + 10, 2)}: {events_tp[0]['event']} - {events_tp[0]['reason']}")
    print(f"  -> Realized PnL: ${om.trade_history[0]['realized_pnl']} | New Account Balance: ${om.balance}")
    assert len(om.positions) == 0, "Position should be closed after TP hit!"
    assert om.trade_history[0]['reason'] == "take_profit", "Close reason should be take_profit"

    # 6. Test REA Agent Integration
    print("\n[6/6] Testing REA Agent MCP Bridge...")
    async with ReaAgent() as agent:
        tools = await agent.list_tools()
        print(f"  -> REA Agent Active! Discovered {len(tools)} reverse-engineering tools.")
        assert len(tools) > 100, "REA MCP server did not return tools"

    print("\n==================================================")
    print("   ALL 6 SYSTEM VERIFICATION TESTS PASSED (100%)! ")
    print("==================================================")

if __name__ == "__main__":
    asyncio.run(run_all_tests())
