/**
 * @holodeck/mcp: an MCP server for Holodeck scenes. Run it with the
 * `holodeck-mcp` bin (stdio); embed it with `createHolodeckMcpServer`.
 */

export { createHolodeckMcpServer, HOLODECK_MCP_NAME, HOLODECK_MCP_VERSION } from './server';
export type { HolodeckMcp, HolodeckMcpOptions, ServerContext } from './server';
export { createMcpHost, MCP_HOST_NAME } from './host';
export { DEFAULT_TIER, TIERS, isTier, tierAllows, tierFromEnv } from './tiers';
export type { Tier } from './tiers';
export { ToolError } from './errors';
export { DOCUMENT_SUFFIX, Workspace, etagOf } from './workspace';
export * from './limits';
export { SceneRenderer, findChromium, serveStatic, isUniform, RENDER_ARGS } from './render';
export type { RendererOptions } from './render';
