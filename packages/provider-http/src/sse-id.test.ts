import { describe, expect, it } from 'vitest';
import { SseIdTracker } from './sse-id';

const track = (text: string, chunkSize = text.length) => {
  const t = new SseIdTracker();
  for (let i = 0; i < text.length; i += chunkSize) t.feed(text.slice(i, i + chunkSize));
  return t.lastEventId;
};

describe('SseIdTracker', () => {
  it.each([
    ['id: 1\ndata: x\n\n', '1'],
    ['id: 1\ndata: x\n\nid: 2\n\n', '2'],
    ['id: 1\n\nid\n\n', ''],
    ['id: 1\n\nid:\n\n', ''],
    ['id:1\n\n', '1'],
    ['id:  1\n\n', ' 1'],
    ['id: 1\n\ndata: x\n\n', '1'],
    ['id: 1\n\nid: a\u0000b\n\n', '1'],
    ['id: 1\n', ''], // not dispatched yet
    [': comment id: 5\n\n', ''],
    ['idx: 5\n\n', ''],
    ['﻿id: 3\n\n', '3'],
    ['id: 4\r\n\r\n', '4'],
    ['id: 5\r\r', '5'],
    ['id: 6\n\nid: 7\r\n', '6'],
  ])('%j → %j', (text, expected) => {
    expect(track(text)).toBe(expected);
  });

  it('gives the same result for every chunking', () => {
    const text = '﻿id: 1\r\ndata: a\r\n\r\nid: 22\r\rdata: b\n\nid\r\n\r\nid: 333\n\n';
    for (let size = 1; size <= text.length; size++) expect(track(text, size)).toBe('333');
  });

  it('keeps the id across stream resets and drops over-long lines', () => {
    const t = new SseIdTracker(10);
    t.feed('id: 1\n\n');
    t.resetStream();
    t.feed('data: partial');
    t.resetStream();
    expect(t.lastEventId).toBe('1');
    t.feed('id: ' + 'x'.repeat(50));
    t.feed('\n\n');
    expect(t.lastEventId).toBe('1');
  });
});
