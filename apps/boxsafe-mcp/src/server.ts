import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBoxSafeMcpServer } from "./mcp.js";

try {
  const server = createBoxSafeMcpServer();
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write("BoxSafe MCP could not start. Check ATLAS_MODE and reviewed scoped read credentials. No fixture fallback occurs in live mode.\n");
  process.exitCode = 1;
}
