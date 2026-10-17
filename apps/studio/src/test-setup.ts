// IndexedDB for jsdom (the document store); jest-dom matchers for component tests.
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// Node 26 ships an experimental global `localStorage` that is `undefined`
// unless Node runs with --localstorage-file, and it shadows jsdom's when
// vitest copies the jsdom window onto globalThis. Point the global back at
// jsdom's Storage (vitest exposes the JSDOM instance as `globalThis.jsdom`).
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom && !globalThis.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
}
