/**
 * Last-Event-ID tracking per the WHATWG event-stream rules (holodeck#99).
 *
 * eventsource-parser only reports events that carry data, so an id-only
 * frame (`id: 42` + blank line) or an empty reset (`id` / `id:`) would never
 * reach us through it. This scanner reads the same decoded text and applies
 * the spec directly:
 *
 * - an `id` field whose value has no NUL sets the "last event ID buffer"
 *   (the buffer is NOT cleared between events, so it persists across events
 *   without an id);
 * - a blank line (event dispatch) copies the buffer to the last event ID,
 *   whether or not the frame had data;
 * - lines end in CRLF, LF or CR, possibly split across chunks.
 *
 * `lastEventId` is `''` after a reset: callers then omit the header.
 */
export class SseIdTracker {
  private partial = '';
  private skipLeadingLf = false;
  private buffer = '';
  private first = true;
  lastEventId = '';

  constructor(private readonly maxLineLength = 1 << 20) {}

  feed(chunk: string): void {
    let text = chunk;
    if (this.first && text.length) {
      this.first = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (this.skipLeadingLf && text.startsWith('\n')) text = text.slice(1);
    this.skipLeadingLf = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch !== '\n' && ch !== '\r') continue;
      this.line(this.partial + text.slice(start, i));
      this.partial = '';
      if (ch === '\r') {
        if (i + 1 < text.length) {
          if (text[i + 1] === '\n') i++;
        } else this.skipLeadingLf = true;
      }
      start = i + 1;
    }
    this.partial += text.slice(start);
    // A line longer than any accepted event is junk; drop it rather than buffer forever.
    if (this.partial.length > this.maxLineLength) this.partial = '';
  }

  /** Forget partial input (new connection); the last event ID survives reconnects. */
  resetStream(): void {
    this.partial = '';
    this.skipLeadingLf = false;
    this.first = true;
  }

  private line(line: string): void {
    if (line === '') {
      this.lastEventId = this.buffer;
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    if (field !== 'id') return;
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (!value.includes('\0')) this.buffer = value;
  }
}
