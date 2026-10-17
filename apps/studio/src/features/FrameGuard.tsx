/**
 * Anti-clickjacking for the studio itself (holodeck#152). Only `/embed/*` is
 * meant to be framed; the editing routes refuse to render inside a frame, so
 * a page cannot overlay the studio and trick clicks (delete, import...).
 *
 * This is the in-app backstop. The real control is the HTTP header
 * `Content-Security-Policy: frame-ancestors 'none'` (+ `X-Frame-Options: DENY`)
 * on every path except `/embed/*`: vite.config.ts sets it for `vite dev` /
 * `vite preview`, and a production deployment must set it too (README,
 * "Deploying"). CSP `frame-ancestors` cannot be set from a `<meta>` tag.
 */
import type { ReactNode } from 'react';

/** True when this window is inside a frame. A cross-origin `top` still compares by identity without throwing. */
export function isFramed(win: { readonly top: unknown; readonly self: unknown } = window): boolean {
  try {
    return win.top !== win.self;
  } catch {
    return true;
  }
}

export function FrameGuard({ children, framed = isFramed() }: { children: ReactNode; framed?: boolean }) {
  if (!framed) return children;
  return (
    <div role="alert" data-testid="frame-refused" style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>Holodeck Studio cannot be shown inside another page.</h1>
      <p>
        Open it directly, or embed a document with its <code>/embed/&lt;id&gt;</code> link.
      </p>
    </div>
  );
}
