"""
REA (Reverse Engineer Anything) Agent Client
============================================
A Python interface to interact with the REA agent via MCP (Model Context Protocol)
or direct CLI execution.

Usage:
------
1. Asynchronous context manager (Recommended):
    ```python
    import asyncio
    from rea_agent import ReaAgent

    async def main():
        async with ReaAgent() as agent:
            # List available REA tools (250+ reverse engineering capabilities)
            tools = await agent.list_tools()
            print(f"Loaded {len(tools)} tools from REA")

            # Call a specific REA tool
            result = await agent.call_tool("inspect_native_load_image", {
                "path": "C:/Windows/notepad.exe"
            })
            print(result)

    asyncio.run(main())
    ```

2. Synchronous wrapper:
    ```python
    from rea_agent import ReaAgentSync

    with ReaAgentSync() as agent:
        tools = agent.list_tools()
        print(f"Loaded {len(tools)} tools")
    ```
"""

import asyncio
import json
import os
import shutil
import subprocess
from typing import Any, Dict, List, Optional
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class ReaAgent:
    """Asynchronous client for REA MCP Agent."""

    def __init__(self, command: str = "rea", args: Optional[List[str]] = None, env: Optional[Dict[str, str]] = None):
        self.command = command
        self.args = args or ["mcp"]
        self.env = env or os.environ.copy()
        self._session: Optional[ClientSession] = None
        self._client_cm = None
        self._session_cm = None

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.disconnect()

    async def connect(self):
        """Connects to the REA MCP server process via stdio."""
        server_params = StdioServerParameters(
            command=self.command,
            args=self.args,
            env=self.env
        )
        self._client_cm = stdio_client(server_params)
        read, write = await self._client_cm.__aenter__()

        self._session_cm = ClientSession(read, write)
        self._session = await self._session_cm.__aenter__()
        await self._session.initialize()

    async def disconnect(self):
        """Disconnects and terminates the MCP session."""
        if self._session_cm:
            try:
                await self._session_cm.__aexit__(None, None, None)
            except Exception:
                pass
            self._session_cm = None
            self._session = None

        if self._client_cm:
            try:
                await self._client_cm.__aexit__(None, None, None)
            except Exception:
                pass
            self._client_cm = None

    @property
    def session(self) -> ClientSession:
        if self._session is None:
            raise RuntimeError("ReaAgent is not connected. Use 'async with ReaAgent():' or call 'await agent.connect()'.")
        return self._session

    async def list_tools(self) -> List[Any]:
        """List all reverse-engineering tools advertised by the REA server."""
        response = await self.session.list_tools()
        return response.tools

    async def get_tool_names(self) -> List[str]:
        """Return a list of all available tool names."""
        tools = await self.list_tools()
        return [tool.name for tool in tools]

    async def call_tool(self, tool_name: str, arguments: Optional[Dict[str, Any]] = None) -> Any:
        """Execute a specific REA tool by name with arguments."""
        args = arguments or {}
        result = await self.session.call_tool(tool_name, args)
        return result

    # --- Convenience Reverse-Engineering Methods ---

    async def inspect_native_load_image(self, target_path: str) -> Any:
        """Inspect headers, architecture, and basic properties of a native PE/ELF/Mach-O binary."""
        return await self.call_tool("inspect_native_load_image", {"target": target_path})

    async def analyze_javascript_application(self, target_path: str) -> Any:
        """Perform static analysis on an extracted JavaScript or Electron application."""
        return await self.call_tool("analyze_javascript_application", {"target": target_path})

    async def run_cli_command(self, subcommand: str, extra_args: Optional[List[str]] = None) -> Dict[str, Any]:
        """Fallback to execute a REA command directly via CLI returning parsed JSON."""
        cmd = [self.command, subcommand] + (extra_args or []) + ["--format", "json"]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        out_str = stdout.decode("utf-8", errors="replace").strip()
        err_str = stderr.decode("utf-8", errors="replace").strip()
        
        try:
            parsed = json.loads(out_str) if out_str else {}
        except json.JSONDecodeError:
            parsed = {"raw": out_str}

        return {
            "exit_code": proc.returncode,
            "data": parsed,
            "error": err_str
        }


class ReaAgentSync:
    """Synchronous wrapper for ReaAgent for scripts that do not use async/await."""

    def __init__(self, command: str = "rea", args: Optional[List[str]] = None):
        self._agent = ReaAgent(command=command, args=args)
        self._loop = asyncio.new_event_loop()

    def __enter__(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._agent.connect())
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            self._loop.run_until_complete(self._agent.disconnect())
        finally:
            self._loop.close()

    def list_tools(self) -> List[Any]:
        return self._loop.run_until_complete(self._agent.list_tools())

    def get_tool_names(self) -> List[str]:
        return self._loop.run_until_complete(self._agent.get_tool_names())

    def call_tool(self, tool_name: str, arguments: Optional[Dict[str, Any]] = None) -> Any:
        return self._loop.run_until_complete(self._agent.call_tool(tool_name, arguments))
