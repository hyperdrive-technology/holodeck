/**
 * Browser resolution for the *-render tests and scripts/make-reference-canvas.mjs.
 * Pure: the environment, file checks and Playwright's path are injected.
 */
import { describe, expect, it } from 'vitest';
import { resolveChromium, type ResolveChromiumDeps } from './chromium';

const PW = '/cache/ms-playwright/chromium-1217/chrome';
const SYSTEM = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function deps(present: string[], playwrightPath: string | Error = PW): ResolveChromiumDeps {
  return {
    exists: (p) => present.includes(p),
    playwrightPath: () => {
      if (playwrightPath instanceof Error) throw playwrightPath;
      return playwrightPath;
    },
    systemChrome: [SYSTEM],
  };
}

describe('resolveChromium', () => {
  it('skips (not required) when HOLODECK_SKIP_RENDER_TESTS=1, even in CI', () => {
    const r = resolveChromium({ HOLODECK_SKIP_RENDER_TESTS: '1', CI: 'true', HOLODECK_CHROMIUM: PW }, deps([PW]));
    expect(r.path).toBeUndefined();
    expect(r).toMatchObject({ required: false });
    expect(r.reason).toContain('HOLODECK_SKIP_RENDER_TESTS');
  });

  it('uses an existing HOLODECK_CHROMIUM as a pinned browser', () => {
    expect(resolveChromium({ HOLODECK_CHROMIUM: SYSTEM, CI: 'true' }, deps([SYSTEM]))).toMatchObject({
      path: SYSTEM,
      source: 'env',
      pinned: true,
      required: true,
    });
  });

  it('reports a HOLODECK_CHROMIUM that does not exist instead of falling back (holodeck#78)', () => {
    const r = resolveChromium({ HOLODECK_CHROMIUM: '/nope/chrome', CI: 'true' }, deps([PW, SYSTEM]));
    expect(r.path).toBeUndefined();
    expect(r.required).toBe(true);
    expect(r.reason).toContain('/nope/chrome');
  });

  it('requires a browser in CI and never probes local installs there', () => {
    const r = resolveChromium({ CI: 'true' }, deps([PW, SYSTEM]));
    expect(r.path).toBeUndefined();
    expect(r).toMatchObject({ required: true });
    expect(r.reason).toContain('HOLODECK_CHROMIUM');
  });

  it('treats CI=false / CI=0 / empty CI as a local run (holodeck#79)', () => {
    for (const CI of ['false', '0', '', 'FALSE']) {
      expect(resolveChromium({ CI }, deps([PW]))).toMatchObject({ path: PW, source: 'playwright', required: false });
    }
  });

  it("prefers Playwright's pinned Chromium over system Chrome locally", () => {
    expect(resolveChromium({}, deps([PW, SYSTEM]))).toMatchObject({ path: PW, source: 'playwright', pinned: true });
  });

  it('falls back to system Chrome, marked unpinned (holodeck#68)', () => {
    const r = resolveChromium({}, deps([SYSTEM]));
    expect(r).toMatchObject({ path: SYSTEM, source: 'system', pinned: false, required: false });
    expect(r.reason).toContain('playwright install chromium');
  });

  it('survives a platform Playwright has no build for', () => {
    expect(resolveChromium({}, deps([SYSTEM], new Error('unsupported')))).toMatchObject({ path: SYSTEM, source: 'system' });
  });

  it('explains how to get a browser when none is found', () => {
    const r = resolveChromium({}, deps([]));
    expect(r.path).toBeUndefined();
    expect(r).toMatchObject({ required: false });
    expect(r.reason).toContain('playwright install chromium');
  });
});
