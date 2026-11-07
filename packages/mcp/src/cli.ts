#!/usr/bin/env node
/**
 * `holodeck-mcp`: the Holodeck MCP server over stdio.
 *
 *   HOLODECK_MCP_ROOT   workspace folder for documents (default: the current directory)
 *   HOLODECK_MCP_TIER   read | author | exec (default: author)
 *
 * stdout carries the protocol, so diagnostics go to stderr only.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHolodeckMcpServer, HOLODECK_MCP_VERSION } from './server';
import { tierFromEnv } from './tiers';

async function main(): Promise<void> {
  const root = process.env.HOLODECK_MCP_ROOT?.trim() || process.cwd();
  const tier = tierFromEnv(process.env);
  const { server, context } = await createHolodeckMcpServer({ root, tier });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`holodeck-mcp ${HOLODECK_MCP_VERSION}: root ${context.workspace.root}, tier ${tier}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`holodeck-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
