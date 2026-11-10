import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { MAX_IMAGE_BYTES, MAX_RESULT_CHARS } from './limits';
import { errorResult, imageResult, imageTooLarge, okResult } from './result';

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

  it('an image up to MAX_IMAGE_BYTES is returned inline with its metadata (#271)', () => {
    const png = new Uint8Array(MAX_IMAGE_BYTES);
    expect(imageTooLarge(png)).toBe(false);
    const r = imageResult(png, { width: 1 });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect((r.content[0] as { data: string }).data.length).toBe(Math.ceil(MAX_IMAGE_BYTES / 3) * 4);
    expect(r.structuredContent).toEqual({ width: 1 });
  });

  it('an image over MAX_IMAGE_BYTES is a too_large error with the hints, not a huge result (#271)', () => {
    const png = new Uint8Array(MAX_IMAGE_BYTES + 1);
    expect(imageTooLarge(png)).toBe(true);
    const r = imageResult(png, { width: 1 }, ['pass `out`']);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toEqual({ error: { code: 'too_large', message: expect.stringContaining(String(MAX_IMAGE_BYTES)), problems: ['pass `out`'] } });
    expect(r.content.every((c) => c.type === 'text')).toBe(true);
  });

  it('image metadata over MAX_RESULT_CHARS is still refused', () => {
    const r = imageResult(new Uint8Array(10), { big: 'x'.repeat(MAX_RESULT_CHARS) });
    expect((r.structuredContent as { error: { code: string } }).error.code).toBe('too_large');
  });
});
