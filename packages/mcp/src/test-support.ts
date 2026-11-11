/** Test helpers: a temp workspace, one shared host, and an MCP client wired over InMemoryTransport. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { HolodeckHost } from '@holodeck/sdk';
import { createMcpHost } from './host';
import { createHolodeckMcpServer, type HolodeckMcp } from './server';
import type { Tier } from './tiers';
import type { SceneRenderer } from './render';
import { PlaygroundBridge } from './playground';

let sharedHost: Promise<HolodeckHost> | null = null;
/** Installing every package takes a moment; tests share one host (it is never mutated by tools). */
export function testHost(): Promise<HolodeckHost> {
  sharedHost ??= createMcpHost();
  return sharedHost;
}

export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'holodeck-mcp-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export const FIXED_NOW = new Date('2026-11-07T00:00:00.000Z');

export interface Harness extends HolodeckMcp {
  client: Client;
  dir: string;
  /** Call a tool; the parsed structured result (or `{ error }` for an error result). */
  call: (name: string, args?: Record<string, unknown>) => Promise<CallResult>;
  close: () => Promise<void>;
}

export interface CallResult {
  isError: boolean;
  text: string;
  data: Record<string, unknown> & { error?: { code: string; message: string; problems: string[] } };
}

export async function harness(opts: { tier?: Tier; dir?: string; renderer?: SceneRenderer; bridge?: PlaygroundBridge } = {}): Promise<Harness> {
  const temp = opts.dir ? null : await tempDir();
  const dir = opts.dir ?? temp!.dir;
  // Never the developer's real `.holodeck-mcp.json` (a running playground): a file that does not exist unless a test passes its own bridge.
  const bridge = opts.bridge ?? new PlaygroundBridge({ file: join(dir, '.no-bridge.json') });
  const mcp = await createHolodeckMcpServer({ root: dir, tier: opts.tier, host: await testHost(), now: () => FIXED_NOW, renderer: opts.renderer, bridge });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallResult> => {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    return { isError: result.isError === true, text, data: (result.structuredContent ?? {}) as CallResult['data'] };
  };
  return {
    ...mcp,
    client,
    dir,
    call,
    close: async () => {
      await client.close();
      await mcp.close();
      await temp?.cleanup();
    },
  };
}
