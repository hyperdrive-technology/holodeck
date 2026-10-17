/**
 * Built-in icon set for the `icon` part: simple geometric marks authored for
 * Holodeck (no third-party icon font, so no licence to carry). SVG path data
 * in a 24 x 24 box, drawn with Canvas `Path2D`. `fill` icons use the even-odd
 * rule (holes are sub-paths); `stroke` icons are 2-unit outlines.
 *
 * Packs with brand icons should use `image` placements or data-only part
 * logos instead; a placement can also draw any font glyph via `params.glyph`.
 */

export interface IconShape {
  d: string;
  mode: 'fill' | 'stroke';
}

export const BUILTIN_ICONS = {
  server: { d: 'M3 3h18v5H3zM5 5h2v1H5zM3 10h18v5H3zM5 12h2v1H5zM3 17h18v5H3zM5 19h2v1H5z', mode: 'fill' },
  database: {
    d: 'M12 2C7 2 4 3.3 4 5v14c0 1.7 3 3 8 3s8-1.3 8-3V5c0-1.7-3-3-8-3zM4 9.5c0 1.7 3 3 8 3s8-1.3 8-3V11c0 1.7-3 3-8 3s-8-1.3-8-3zM4 14.5c0 1.7 3 3 8 3s8-1.3 8-3V16c0 1.7-3 3-8 3s-8-1.3-8-3z',
    mode: 'fill',
  },
  cloud: { d: 'M7 19a5 5 0 0 1-.6-9.96A7 7 0 0 1 19.5 9.5 4.75 4.75 0 0 1 18.5 19z', mode: 'fill' },
  user: { d: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM3 22c0-5 4-8 9-8s9 3 9 8z', mode: 'fill' },
  lock: { d: 'M6 10V7a6 6 0 0 1 12 0v3h1v12H5V10zM8.5 10h7V7a3.5 3.5 0 0 0-7 0z', mode: 'fill' },
  bolt: { d: 'M13 2L4 14h7l-1 8 9-12h-7z', mode: 'fill' },
  warning: { d: 'M12 2L1 22h22zM11 9h2v7h-2zM11 18h2v2h-2z', mode: 'fill' },
  check: { d: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z', mode: 'fill' },
  cross: {
    d: 'M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z',
    mode: 'fill',
  },
  globe: {
    d: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20M2 12h20M12 2c3 3 4 6.5 4 10s-1 7-4 10M12 2c-3 3-4 6.5-4 10s1 7 4 10',
    mode: 'stroke',
  },
  queue: { d: 'M3 5h3v14H3zM8 5h3v14H8zM13 5h3v14h-3zM18 5h3v14h-3z', mode: 'fill' },
  arrow: { d: 'M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4z', mode: 'fill' },
  star: { d: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z', mode: 'fill' },
  circle: { d: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z', mode: 'fill' },
  square: { d: 'M3 3h18v18H3z', mode: 'fill' },
} as const satisfies Record<string, IconShape>;

export type BuiltinIconName = keyof typeof BUILTIN_ICONS;
export const BUILTIN_ICON_NAMES = Object.keys(BUILTIN_ICONS) as BuiltinIconName[];

/** Longest `glyph` (a few characters: an emoji, a font-icon code point, "S3"). */
export const MAX_GLYPH_LENGTH = 8;

/** Canvas size the icon texture is drawn at (square). */
export const ICON_TEXTURE_PX = 256;

/**
 * Draw an icon (or a glyph, when `glyph` is non-empty) centred on a square
 * canvas context of `px` pixels. Separate from the React component so the
 * drawing is testable against a fake context.
 */
export function drawIcon(
  ctx: Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'scale' | 'translate' | 'fill' | 'stroke' | 'fillText'> & {
    fillStyle: unknown;
    strokeStyle: unknown;
    lineWidth: number;
    lineJoin: CanvasLineJoin;
    lineCap: CanvasLineCap;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
  },
  opts: { icon: string; glyph: string; color: string; px: number; font?: string },
  makePath: (d: string) => Path2D = (d) => new Path2D(d),
): 'glyph' | 'icon' | 'none' {
  const { px, color } = opts;
  if (opts.glyph) {
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.round(px * 0.72)}px ${opts.font ?? 'Helvetica Neue, Helvetica, Arial, sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.glyph.slice(0, MAX_GLYPH_LENGTH), px / 2, px / 2 + px * 0.03);
    return 'glyph';
  }
  const shape = (BUILTIN_ICONS as Record<string, IconShape>)[opts.icon];
  if (!shape) return 'none';
  ctx.save();
  // 24-unit box with a 1-unit margin each side.
  ctx.scale(px / 26, px / 26);
  ctx.translate(1, 1);
  const path = makePath(shape.d);
  if (shape.mode === 'fill') {
    ctx.fillStyle = color;
    ctx.fill(path, 'evenodd');
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(path);
  }
  ctx.restore();
  return 'icon';
}
