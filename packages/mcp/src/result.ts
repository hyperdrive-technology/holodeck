/** MCP tool results: JSON text for the model plus the same object as `structuredContent`. */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { messageOf, ToolError } from './errors';
import { MAX_RESULT_CHARS } from './limits';

export function okResult(payload: Record<string, unknown>): CallToolResult {
  const text = JSON.stringify(payload, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    return errorResult(
      new ToolError(`the result is ${text.length} characters, over the ${MAX_RESULT_CHARS} limit`, ['narrow the request: objectIds, view "summary", limit / offset'], 'too_large'),
    );
  }
  return { content: [{ type: 'text', text }], structuredContent: payload };
}

export function errorResult(error: unknown): CallToolResult {
  const known = error instanceof ToolError;
  const code = known ? error.code : 'internal';
  const message = known ? error.message : `internal error: ${messageOf(error)}`;
  const problems = known ? [...error.problems] : [];
  const text = problems.length ? `${message}\n${problems.map((p) => `- ${p}`).join('\n')}` : message;
  return { isError: true, content: [{ type: 'text', text }], structuredContent: { error: { code, message, problems } } };
}
