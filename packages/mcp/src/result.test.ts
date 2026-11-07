import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { MAX_RESULT_CHARS } from './limits';
import { errorResult, okResult } from './result';

describe('results', () => {
  it('ok results carry the JSON text and the structured object', () => {
    const r = okResult({ a: 1 });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({ a: 1 });
  });

  it('a result over the limit becomes a too_large error', () => {
    const r = okResult({ big: 'x'.repeat(MAX_RESULT_CHARS) });
    expect(r.isError).toBe(true);
    expect((r.structuredContent as { error: { code: string } }).error.code).toBe('too_large');
  });

  it('a ToolError lists its problems; anything else is an internal error', () => {
    const known = errorResult(new ToolError('bad', ['one', 'two'], 'conflict'));
    expect((known.content[0] as { text: string }).text).toBe('bad\n- one\n- two');
    expect(known.structuredContent).toEqual({ error: { code: 'conflict', message: 'bad', problems: ['one', 'two'] } });
    const other = errorResult(new TypeError('boom'));
    expect((other.structuredContent as { error: { code: string; message: string } }).error).toMatchObject({ code: 'internal', message: 'internal error: boom' });
  });
});
