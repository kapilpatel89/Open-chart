/**
 * REA (Reverse Engineer Anything) Agent Client for Node.js / JavaScript
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class ReaAgent {
  constructor(options = {}) {
    this.command = options.command || "rea";
    this.args = options.args || ["mcp"];
    this.client = null;
    this.transport = null;
  }

  async connect() {
    this.transport = new StdioClientTransport({
      command: this.command,
      args: this.args,
    });

    this.client = new Client(
      {
        name: "rea-agent-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await this.client.connect(this.transport);
  }

  async disconnect() {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
      this.client = null;
    }
  }

  async listTools() {
    if (!this.client) throw new Error("Agent not connected. Call connect() first.");
    const res = await this.client.listTools();
    return res.tools;
  }

  async callTool(name, args = {}) {
    if (!this.client) throw new Error("Agent not connected. Call connect() first.");
    return await this.client.callTool({
      name,
      arguments: args,
    });
  }
}
