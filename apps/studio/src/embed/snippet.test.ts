import { describe, expect, it } from 'vitest';
import { embedSnippet, embedUrl } from './snippet';

describe('embedUrl', () => {
  it('points at /embed/<id> on the studio origin', () => {
    expect(embedUrl('https://studio.example', 'doc-1')).toBe('https://studio.example/embed/doc-1');
  });

  it('encodes the id', () => {
    expect(embedUrl('https://studio.example', 'a/b c?')).toBe('https://studio.example/embed/a%2Fb%20c%3F');
  });

  it('adds a valid parentOrigin, skips invalid ones and the studio itself', () => {
    expect(embedUrl('https://studio.example', 'd', 'https://app.example')).toBe('https://studio.example/embed/d?parentOrigin=https%3A%2F%2Fapp.example');
    expect(embedUrl('https://studio.example', 'd', 'not an origin')).toBe('https://studio.example/embed/d');
    expect(embedUrl('https://studio.example', 'd', 'https://studio.example')).toBe('https://studio.example/embed/d');
  });
});

describe('embedSnippet', () => {
  it('escapes the title and URL into attributes', () => {
    const html = embedSnippet('https://s.example/embed/d?a=1&b=2', 'Plant "A" <B>');
    expect(html).toBe(
      '<iframe src="https://s.example/embed/d?a=1&amp;b=2" title="Plant &quot;A&quot; &lt;B&gt;" width="960" height="540" style="border:0" loading="lazy"></iframe>',
    );
  });

  it('falls back to a generic title', () => {
    expect(embedSnippet('https://s.example/embed/d', '')).toContain('title="Holodeck document"');
  });
});
