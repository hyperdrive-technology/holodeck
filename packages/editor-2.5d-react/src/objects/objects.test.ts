/**
 * Pure helpers behind the E2 object renderers: logo anchors, opacity /
 * z-order, icons, connector look / caption / flow, image fitting, meta rows.
 */
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { HOLODECK_ANNOTATION_STYLE, HOLODECK_STYLE, annotationStyle } from '../../assets/process/style';
import { HOLODECK_STYLE_DARK } from '../registry/themes';
import { applyAppearance, AppearanceState, needsAppearance, Z_RENDER_STEP } from './appearance';
import { captionPose, connectorLook, flowOffset, flowSpacing, gridPolylineToWorld, MAX_FLOW_DOTS } from './ConnectorLine';
import { BUILTIN_ICON_NAMES, BUILTIN_ICONS, drawIcon, MAX_GLYPH_LENGTH } from './icons';
import { fitAspect, LOGO_LIFT, logoAnchorForBlock, logoAnchorFromModel } from './logo';
import { fitBox, metaLines } from './Marks';

describe('logoAnchorFromModel', () => {
  it('uses the `logo` empty: position and X/Z scale, relative to the model root', () => {
    const root = new Group();
    root.position.set(100, 0, 100); // placement-independent: ignored
    const body = new Mesh(new BoxGeometry(2, 1, 2));
    body.position.y = 0.5;
    const logo = new Object3D();
    logo.userData.name = 'logo'; // GLTFLoader keeps the authored name here
    logo.name = 'logo';
    logo.position.set(0.2, 1, -0.1);
    logo.scale.set(0.8, 1, 0.5);
    root.add(body, logo);
    const a = logoAnchorFromModel(root)!;
    expect(a.source).toBe('node');
    expect(a.position[0]).toBeCloseTo(0.2);
    expect(a.position[1]).toBeCloseTo(1 + LOGO_LIFT);
    expect(a.position[2]).toBeCloseTo(-0.1);
    expect(a.size).toBeCloseTo(0.5);
  });

  it('without a logo node: the bounding-box top, sized from the short side', () => {
    const root = new Group();
    const body = new Mesh(new BoxGeometry(2, 1.5, 4));
    body.position.set(1, 0.75, 0);
    root.add(body);
    const a = logoAnchorFromModel(root)!;
    expect(a.source).toBe('top');
    expect(a.position).toEqual([1, 1.5 + LOGO_LIFT, 0]);
    expect(a.size).toBeCloseTo(1.2);
  });

  it('null for an empty model; block anchor sits on the block top', () => {
    expect(logoAnchorFromModel(new Group())).toBeNull();
    expect(logoAnchorForBlock(2, 1, 0.5)).toEqual({ position: [0, 0.5 + LOGO_LIFT, 0], size: 0.6, source: 'block' });
  });

  it('fitAspect letterboxes into the square', () => {
    expect(fitAspect(1, 2)).toEqual([1, 0.5]);
    expect(fitAspect(1, 0.5)).toEqual([0.5, 1]);
    expect(fitAspect(1, NaN)).toEqual([1, 1]);
    expect(fitAspect(1, 0)).toEqual([1, 1]);
  });
});

describe('applyAppearance', () => {
  const scene = () => {
    const shared = new MeshBasicMaterial({ color: '#ff0000' });
    const root = new Group();
    const a = new Mesh(new BoxGeometry(), shared);
    const b = new Mesh(new BoxGeometry(), shared);
    b.renderOrder = 6;
    root.add(a, b);
    return { root, a, b, shared };
  };

  it('fades with per-mesh clones and never mutates the shared material', () => {
    const { root, a, b, shared } = scene();
    const state = new AppearanceState();
    expect(applyAppearance(root, 0.5, 0, state)).toBe(2);
    expect(shared.opacity).toBe(1);
    expect(shared.transparent).toBe(false);
    const ma = a.material as MeshBasicMaterial;
    expect(ma).not.toBe(shared);
    expect(ma.opacity).toBe(0.5);
    expect(ma.transparent).toBe(true);
    expect(ma.depthWrite).toBe(false);
    expect(b.material).not.toBe(ma);
    // Idempotent: a second pass clones nothing.
    expect(applyAppearance(root, 0.5, 0, state)).toBe(0);
  });

  it('offsets renderOrder by z on top of the part\'s own order', () => {
    const { root, a, b } = scene();
    applyAppearance(root, 1, 3, new AppearanceState());
    expect(a.renderOrder).toBe(3 * Z_RENDER_STEP);
    expect(b.renderOrder).toBe(6 + 3 * Z_RENDER_STEP);
    // Opaque + z only: materials untouched.
    expect((a.material as MeshBasicMaterial).transparent).toBe(false);
  });

  it('restores the source material when opacity returns to 1, and disposes the clone', () => {
    const { root, a, shared } = scene();
    const state = new AppearanceState();
    applyAppearance(root, 0.4, 0, state);
    const clone = a.material as MeshBasicMaterial;
    const dispose = vi.spyOn(clone, 'dispose');
    applyAppearance(root, 1, 0, state);
    expect(a.material).toBe(shared);
    expect(dispose).toHaveBeenCalled();
  });

  it('re-clones when the part swaps a mesh\'s material, and mirrors map / colour changes', () => {
    const { root, a } = scene();
    const state = new AppearanceState();
    applyAppearance(root, 0.5, 0, state);
    const next = new MeshBasicMaterial({ color: '#00ff00' });
    a.material = next;
    expect(applyAppearance(root, 0.5, 0, state)).toBe(1);
    expect((a.material as MeshBasicMaterial).color.getHexString()).toBe('00ff00');
    next.color.set('#0000ff');
    applyAppearance(root, 0.5, 0, state);
    expect((a.material as MeshBasicMaterial).color.getHexString()).toBe('0000ff');
  });

  it('forgets meshes that left the subtree and disposes everything on dispose()', () => {
    const { root, a, b } = scene();
    const state = new AppearanceState();
    applyAppearance(root, 0.5, 0, state);
    root.remove(b);
    applyAppearance(root, 0.5, 0, state);
    expect(state.owned.size).toBe(1);
    const spy = vi.spyOn(a.material as MeshBasicMaterial, 'dispose');
    state.dispose();
    expect(spy).toHaveBeenCalled();
    expect(state.owned.size).toBe(0);
  });

  it('needsAppearance only for opacity < 1 or non-zero z', () => {
    expect(needsAppearance({})).toBe(false);
    expect(needsAppearance({ opacity: 1, z: 0 })).toBe(false);
    expect(needsAppearance({ opacity: 0.99 })).toBe(true);
    expect(needsAppearance({ z: -1 })).toBe(true);
  });
});

describe('icons', () => {
  const fakeCtx = () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: '' as unknown,
      strokeStyle: '' as unknown,
      lineWidth: 0,
      lineJoin: 'miter' as CanvasLineJoin,
      lineCap: 'butt' as CanvasLineCap,
      font: '',
      textAlign: 'start' as CanvasTextAlign,
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      scale: () => calls.push('scale'),
      translate: () => calls.push('translate'),
      fill: () => calls.push('fill'),
      stroke: () => calls.push('stroke'),
      fillText: (t: string) => calls.push(`text:${t}`),
    };
    return { ctx, calls };
  };

  it('every built-in icon is a well-formed path in the 24 box', () => {
    expect(BUILTIN_ICON_NAMES.length).toBeGreaterThanOrEqual(12);
    for (const name of BUILTIN_ICON_NAMES) {
      const { d } = BUILTIN_ICONS[name];
      expect(d, name).toMatch(/^M/);
      const nums = d.match(/-?\d*\.?\d+/g)!.map(Number);
      // Relative commands (c, s, a) carry negative deltas, so bound the magnitude only.
      expect(nums.every((n) => Number.isFinite(n) && Math.abs(n) <= 25), name).toBe(true);
    }
  });

  it('draws fill icons, stroke icons, glyphs, and nothing for unknown names', () => {
    const fill = fakeCtx();
    expect(drawIcon(fill.ctx, { icon: 'server', glyph: '', color: '#123', px: 256 }, () => ({}) as Path2D)).toBe('icon');
    expect(fill.calls).toContain('fill');
    expect(fill.ctx.fillStyle).toBe('#123');
    const stroke = fakeCtx();
    drawIcon(stroke.ctx, { icon: 'globe', glyph: '', color: '#123', px: 256 }, () => ({}) as Path2D);
    expect(stroke.calls).toContain('stroke');
    const glyph = fakeCtx();
    expect(drawIcon(glyph.ctx, { icon: 'server', glyph: 'S3-very-long-text', color: '#123', px: 256 })).toBe('glyph');
    expect(glyph.calls).toContain(`text:${'S3-very-long-text'.slice(0, MAX_GLYPH_LENGTH)}`);
    const none = fakeCtx();
    expect(drawIcon(none.ctx, { icon: 'nope', glyph: '', color: '#123', px: 256 })).toBe('none');
    expect(none.calls).toEqual([]);
  });
});

describe('connector look, caption and flow', () => {
  it('empty colour / width fall back to the theme annotation tokens', () => {
    const look = connectorLook({}, HOLODECK_STYLE);
    expect(look).toMatchObject({
      color: HOLODECK_ANNOTATION_STYLE.connector,
      width: HOLODECK_ANNOTATION_STYLE.connectorWidth,
      dash: 'solid',
      startTip: 'none',
      endTip: 'arrow',
      flow: false,
      flowSpeed: 1,
    });
    expect(connectorLook({ color: '' }, HOLODECK_STYLE_DARK).color).toBe(HOLODECK_STYLE_DARK.annotation!.connector);
  });

  it('explicit params win; junk values fall back instead of leaking through', () => {
    const look = connectorLook({ color: '#f00', width: 0.3, dash: 'dotted', startTip: 'dot', endTip: 'none', label: 'x', flow: true, flowSpeed: -3 }, HOLODECK_STYLE);
    expect(look).toMatchObject({ color: '#f00', width: 0.3, dash: 'dotted', startTip: 'dot', endTip: 'none', label: 'x', flow: true, flowSpeed: -3 });
    const junk = connectorLook({ width: Infinity, dash: 'wavy', endTip: 7, flowSpeed: NaN, label: 5 }, HOLODECK_STYLE);
    expect(junk).toMatchObject({ width: HOLODECK_ANNOTATION_STYLE.connectorWidth, dash: 'solid', endTip: 'arrow', flowSpeed: 1, label: '' });
  });

  it('themes without annotation tokens still get defaults', () => {
    const { annotation: _drop, ...legacy } = HOLODECK_STYLE;
    expect(annotationStyle(legacy)).toBe(HOLODECK_ANNOTATION_STYLE);
  });

  it('captions sit at the midpoint, beside the line, never upside down', () => {
    const right = captionPose([[0, 0], [4, 0]], 0.1, 0.28)!;
    expect(right.x).toBeCloseTo(2);
    expect(right.yaw).toBeCloseTo(0);
    expect(right.z).toBeLessThan(0);
    const left = captionPose([[4, 0], [0, 0]], 0.1, 0.28)!;
    expect(left.yaw).toBeCloseTo(0); // flipped to read left-to-right
    const down = captionPose([[0, 0], [0, 4]], 0.1, 0.28)!;
    expect(Math.abs(down.yaw)).toBeCloseTo(Math.PI / 2);
    expect(captionPose([[1, 1]], 0.1, 0.28)).toBeNull();
  });

  it('flow dots: spacing caps the count, offset wraps for both directions', () => {
    expect(flowSpacing(0.08, 10)).toBeCloseTo(0.64);
    expect(10_000 / flowSpacing(0.08, 10_000)).toBeLessThanOrEqual(MAX_FLOW_DOTS);
    expect(flowOffset(0, 1, 1)).toBe(0);
    expect(flowOffset(2.5, 1, 1)).toBeCloseTo(0.5);
    expect(flowOffset(2.25, -1, 1)).toBeCloseTo(0.75);
    for (const t of [0, 0.3, 7.9, 1000.1]) {
      const o = flowOffset(t, -2.7, 0.64);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(0.64);
    }
  });

  it('grid polylines map to world cell centres', () => {
    expect(gridPolylineToWorld([[0, 0], [2, -1]])).toEqual([[0.5, 0.5], [2.5, -0.5]]);
  });
});

describe('image fitting and meta rows', () => {
  it('fitBox keeps the aspect inside the box', () => {
    expect(fitBox(4, 2, 1)).toEqual([2, 2]);
    expect(fitBox(2, 4, 1)).toEqual([2, 2]);
    expect(fitBox(4, 2, 4)).toEqual([4, 1]);
    expect(fitBox(4, 2, NaN)).toEqual([4, 2]);
  });
  it('metaLines formats rows in insertion order', () => {
    expect(metaLines({ region: 'eu-west-1', nodes: 3, public: true, tls: false })).toEqual([
      'region: eu-west-1',
      'nodes: 3',
      'public: yes',
      'tls: no',
    ]);
  });
});
