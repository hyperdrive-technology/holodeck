#!/usr/bin/env node
/**
 * `holodeck-mcp`: the Holodeck MCP server over stdio.
 *
 *   HOLODECK_MCP_ROOT   workspace folder for documents (default: the current directory)
 *   HOLODECK_MCP_TIER   read | author | exec (default: author)
 *   HOLODECK_MCP_ALLOW_BLENDER=1   with tier exec: let the Blender part tools run Blender
 *   BLENDER, HOLODECK_MCP_REPO     Blender binary; holodeck repo for blender/parts and assets/models
 *
 * stdout carries the protocol, so diagnostics go to stderr only.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHolodeckMcpServer, HOLODECK_MCP_VERSION } from './server';
import { tierFromEnv } from './tiers';

async function main(): Promise<void> {
  const root = process.env.HOLODECK_MCP_ROOT?.trim() || process.cwd();
  const tier = tierFromEnv(process.env);
  const { server, context, close } = await createHolodeckMcpServer({ root, tier });
  // Never leave a render browser behind: close everything on stdin EOF or a signal.
  const shutdown = () => void close().finally(() => process.exit(0));
  process.stdin.on('end', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`holodeck-mcp ${HOLODECK_MCP_VERSION}: root ${context.workspace.root}, tier ${tier}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`holodeck-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
