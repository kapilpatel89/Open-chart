"""
Demonstration script showing how to use ReaAgent in Python code.
"""

import asyncio
from rea_agent import ReaAgent, ReaAgentSync

async def test_async():
    print("=== Testing ReaAgent (Async) ===")
    async with ReaAgent() as agent:
        tools = await agent.list_tools()
        print(f"[+] Connected to REA MCP Server. Available tools: {len(tools)}")
        print("[+] First 10 tools:")
        for idx, tool in enumerate(tools[:10], 1):
            desc = (tool.description or "No description").split(".")[0]
            print(f"  {idx:2d}. {tool.name:<32} - {desc}")

def test_sync():
    print("\n=== Testing ReaAgentSync (Synchronous) ===")
    with ReaAgentSync() as agent:
        tool_names = agent.get_tool_names()
        print(f"[+] Synchronous wrapper connected successfully. Tool count: {len(tool_names)}")

if __name__ == "__main__":
    asyncio.run(test_async())
    test_sync()
    print("\n[+] All tests passed successfully!")
