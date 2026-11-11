/** collectPageLog against a fake page: what it keeps, and that it stops growing. */
import { describe, expect, it } from 'vitest';
import { collectPageLog, PAGE_LOG_LIMIT } from './render-harness';

type Handler = (arg: never) => void;

function fakePage() {
  const handlers = new Map<string, Handler>();
  const page = { on: (event: string, handler: Handler) => void handlers.set(event, handler) };
  const emit = (event: string, arg: unknown) => handlers.get(event)?.(arg as never);
  return { page: page as never, emit };
}

const consoleMsg = (type: string, text: string) => ({ type: () => type, text: () => text });

describe('collectPageLog', () => {
  it('keeps console errors and warnings, page errors and failed requests; drops other console output', () => {
    const { page, emit } = fakePage();
    const logs = collectPageLog(page);
    emit('console', consoleMsg('log', 'chatty'));
    emit('console', consoleMsg('warning', 'w'));
    emit('console', consoleMsg('error', 'e'));
    emit('pageerror', new Error('boom'));
    emit('requestfailed', { url: () => 'http://x/a.glb', failure: () => ({ errorText: 'net::ERR' }) });
    expect(logs).toEqual(['warning: w', 'error: e', 'pageerror: boom', 'failed: http://x/a.glb net::ERR']);
  });

  it('keeps the first PAGE_LOG_LIMIT lines and then one note, however much the page logs', () => {
    const { page, emit } = fakePage();
    const logs = collectPageLog(page);
    for (let i = 0; i < PAGE_LOG_LIMIT * 3; i += 1) emit('console', consoleMsg('error', `frame ${i}`));
    expect(logs).toHaveLength(PAGE_LOG_LIMIT + 1);
    expect(logs[0]).toBe('error: frame 0');
    expect(logs[logs.length - 1]).toMatch(/rest were dropped/);
  });
});
