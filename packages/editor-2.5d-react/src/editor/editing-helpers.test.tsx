/**
 * Pure helpers behind the E3 editing UX: layers, connector anchoring,
 * marquee hit-testing, the shortcut table, the controlled camera, the
 * system-clipboard envelope, and the inspector / layers / help markup.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { initialIsoPose, toggleTopDown } from '../iso/pose';
import { getDefaultIsoRegistry } from '../registry/default';
import { IsoRegistryProvider } from '../registry/react';
import { objectBounds } from './arrange';
import { cameraFromView, clampCamera, isValidCamera, poseFromCamera, sameCamera } from './camera';
import { CLIPBOARD_FORMAT, copyObjects, parseClipboard, pasteObjects, serializeClipboard } from './clipboard';
import { anchorAt, anchorTargetAt, buildConnector, reanchor, sameLinkEnd } from './connect';
import { emptyScene } from './editor-state';
import { InspectorPanel, parseMetaValue } from './InspectorPanel';
import { LayersPanel } from './LayersPanel';
import { DEFAULT_LAYER_ID, expandGroups, isPlacementEditable, isPlacementHidden, layerIdOf, nextFreeId, sceneLayers, visibleObjects, withLayer } from './layers';
import { isClickSized, marqueeHits, rectFromPoints } from './marquee';
import { SHORTCUTS, comboMatches, formatCombo, matchShortcut } from './shortcuts';
import { ShortcutHelp } from './ShortcutHelp';

const registry = getDefaultIsoRegistry();
const tank = (id: string, x: number, y: number, extra: Partial<IsoPlacement> = {}): IsoPlacement => ({ id, object: 'tank', x, y, ...extra });
const sceneOf = (objects: IsoPlacement[], extra: Partial<IsoSceneFile> = {}): IsoSceneFile => ({ ...emptyScene('s'), objects, ...extra });

describe('layers', () => {
  const scene = sceneOf(
    [tank('a', 0, 0), tank('b', 4, 0, { layer: 'pipes' }), tank('c', 8, 0, { layer: 'ghost' }), tank('d', 12, 0, { layer: 'locked' })],
    { layers: [{ id: 'pipes', name: 'Pipes', hidden: true }, { id: 'locked', name: 'L', locked: true }] },
  );

  it('lists the implicit default layer first', () => {
    expect(sceneLayers(scene).map((l) => l.id)).toEqual([DEFAULT_LAYER_ID, 'pipes', 'locked']);
    expect(sceneLayers({ layers: [{ id: 'x', name: 'X' }, { id: 'default', name: 'Base' }] }).map((l) => l.name)).toEqual(['Base', 'X']);
  });

  it('undeclared layer ids fall back to the default layer', () => {
    expect(layerIdOf(scene, scene.objects[2]!)).toBe(DEFAULT_LAYER_ID);
    expect(layerIdOf(scene, scene.objects[1]!)).toBe('pipes');
  });

  it('hidden and locked flags', () => {
    expect(isPlacementHidden(scene, scene.objects[1]!)).toBe(true);
    expect(isPlacementEditable(scene, scene.objects[1]!)).toBe(false);
    expect(isPlacementEditable(scene, scene.objects[3]!)).toBe(false);
    expect(isPlacementHidden(scene, scene.objects[3]!)).toBe(false);
    expect(isPlacementEditable(scene, scene.objects[0]!)).toBe(true);
  });

  it('visibleObjects filters hidden layers and keeps the array identity when nothing is hidden', () => {
    expect(visibleObjects(scene).map((o) => o.id)).toEqual(['a', 'c', 'd']);
    const plain = sceneOf([tank('a', 0, 0)]);
    expect(visibleObjects(plain)).toBe(plain.objects);
  });

  it('withLayer drops the field for the default layer', () => {
    expect('layer' in withLayer(tank('a', 0, 0, { layer: 'x' }), DEFAULT_LAYER_ID)).toBe(false);
    expect(withLayer(tank('a', 0, 0), 'x').layer).toBe('x');
  });

  it('expandGroups adds editable group members in scene order', () => {
    const s = sceneOf([tank('a', 0, 0, { group: 'g' }), tank('b', 4, 0), tank('c', 8, 0, { group: 'g' }), tank('d', 9, 0, { group: 'g', layer: 'l' })], {
      layers: [{ id: 'l', name: 'L', locked: true }],
    });
    expect(expandGroups(s, ['c'])).toEqual(['a', 'c']);
    expect(expandGroups(s, ['b'])).toEqual(['b']);
  });

  it('nextFreeId', () => {
    expect(nextFreeId('group', ['group-1', 'group-3'])).toBe('group-2');
  });
});

describe('connector anchoring', () => {
  const scene = sceneOf([
    { id: 'area', object: 'area', x: 0, y: 0, width: 20, height: 10 },
    tank('t', 2, 0),
    { id: 'lbl', object: 'label', x: 6, y: 2 },
    { id: 'p', object: 'pipe', x: -5, y: 3, toX: 5, toY: 3 },
  ]);

  it('prefers solid parts over floor annotations, then the smallest footprint', () => {
    expect(anchorTargetAt(scene, registry, { x: 2, y: 0 })?.id).toBe('t');
    expect(anchorTargetAt(scene, registry, { x: 6, y: 2 })?.id).toBe('lbl');
    expect(anchorTargetAt(scene, registry, { x: -8, y: -4 })?.id).toBe('area');
    // Pipes are never anchors; outside everything -> null.
    expect(anchorTargetAt(scene, registry, { x: 30, y: 3 })).toBeNull();
    expect(anchorTargetAt(sceneOf([scene.objects[3]!]), registry, { x: 0, y: 3 })).toBeNull();
  });

  it('snaps to a port within one cell, else the centre, else a free point', () => {
    expect(anchorAt(scene, registry, { x: 3, y: 0 })).toEqual({ object: 't', port: 'east' });
    expect(anchorAt(sceneOf([tank('t', 0, 0, { rotation: Math.PI / 2 })]), registry, { x: 0, y: -1 })).toEqual({ object: 't', port: 'east' });
    expect(anchorAt(sceneOf([]), registry, { x: 4, y: 5 })).toEqual({ x: 4, y: 5 });
  });

  it('skips hidden and excluded placements', () => {
    const hidden = sceneOf([tank('t', 0, 0, { layer: 'h' })], { layers: [{ id: 'h', name: 'H', hidden: true }] });
    expect(anchorTargetAt(hidden, registry, { x: 0, y: 0 })).toBeNull();
    expect(anchorTargetAt(scene, registry, { x: 2, y: 0 }, new Set(['t']))?.id).toBe('area');
  });

  it('buildConnector puts object ends in link and free ends on x/y, toX/toY', () => {
    const base = { id: 'c', object: 'connector', x: 0, y: 0 };
    expect(buildConnector(base, scene, registry, { object: 't', port: 'east' }, { x: 9, y: 9 })).toEqual({
      id: 'c', object: 'connector', x: 3, y: 0, toX: 9, toY: 9, link: { from: { object: 't', port: 'east' } },
    });
    expect(buildConnector(base, scene, registry, { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual({ id: 'c', object: 'connector', x: 1, y: 1, toX: 2, toY: 2 });
    expect(buildConnector(base, scene, registry, { object: 'gone' }, { x: 2, y: 2 })).toBeNull();
  });

  it('reanchor swaps between object and free ends and keeps waypoints', () => {
    const c: IsoPlacement = { id: 'c', object: 'connector', x: 0, y: 0, toX: 4, toY: 0, link: { from: { object: 't' }, via: [{ x: 2, y: 2 }] } };
    expect(reanchor(c, 'from', { x: -1, y: -1 })).toMatchObject({ x: -1, y: -1, link: { via: [{ x: 2, y: 2 }] } });
    expect(reanchor(c, 'from', { x: -1, y: -1 }).link?.from).toBeUndefined();
    expect(reanchor({ ...c, link: { from: { object: 't' } } }, 'from', { x: 1, y: 1 }).link).toBeUndefined();
    expect(reanchor(c, 'to', { object: 't', port: 'west' }).link?.to).toEqual({ object: 't', port: 'west' });
  });

  it('sameLinkEnd', () => {
    expect(sameLinkEnd({ object: 'a' }, { object: 'a' })).toBe(true);
    expect(sameLinkEnd({ object: 'a', port: 'e' }, { object: 'a' })).toBe(false);
    expect(sameLinkEnd({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(true);
    expect(sameLinkEnd({ x: 1, y: 1 }, { object: 'a' })).toBe(false);
  });
});

describe('marquee', () => {
  const objects = [tank('a', 0, 0), tank('b', 10, 0), { id: 'p', object: 'pipe', x: 0, y: 5, toX: 4, toY: 5 }];
  // A trivial projection: 10 px per cell.
  const toScreen = (gx: number, gy: number) => ({ x: gx * 10, y: gy * 10 });

  it('hits placements whose box centre falls inside', () => {
    expect(marqueeHits(objects, registry, toScreen, rectFromPoints({ x: -20, y: -20 }, { x: 50, y: 60 }))).toEqual(['a', 'p']);
    expect(marqueeHits(objects, registry, toScreen, rectFromPoints({ x: 120, y: 80 }, { x: -20, y: -20 }))).toEqual(['a', 'b', 'p']);
  });

  it('a click-sized rectangle selects nothing; off-screen projections are skipped', () => {
    expect(isClickSized(rectFromPoints({ x: 0, y: 0 }, { x: 3, y: 2 }))).toBe(true);
    expect(marqueeHits(objects, registry, toScreen, rectFromPoints({ x: -1, y: -1 }, { x: 2, y: 2 }))).toEqual([]);
    expect(marqueeHits(objects, registry, () => null, rectFromPoints({ x: -100, y: -100 }, { x: 100, y: 100 }))).toEqual([]);
  });

  it('objectBounds covers rotated footprints and run ends', () => {
    expect(objectBounds(tank('a', 0, 0), registry)).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    expect(objectBounds({ id: 'p', object: 'pipe', x: 0, y: 5, toX: 4, toY: 5 }, registry)).toEqual({ minX: 0, minY: 5, maxX: 4, maxY: 5 });
  });
});

describe('shortcut table', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}, code = '') =>
    ({ key: k, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent;

  it('has unique ids and no binding claimed twice', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    const specs = SHORTCUTS.flatMap((s) => s.keys.map((k) => k.toLowerCase()));
    expect(new Set(specs).size).toBe(specs.length);
  });

  it('matches modifiers exactly (Cmd or Ctrl as Mod)', () => {
    expect(matchShortcut(key('z', { metaKey: true }))?.id).toBe('undo');
    expect(matchShortcut(key('z', { ctrlKey: true }))?.id).toBe('undo');
    expect(matchShortcut(key('Z', { metaKey: true, shiftKey: true }))?.id).toBe('redo');
    expect(matchShortcut(key('y', { ctrlKey: true }))?.id).toBe('redo');
    expect(matchShortcut(key('z'))).toBeNull();
    expect(matchShortcut(key('c', { metaKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(key('c'))?.id).toBe('connector-tool');
    expect(matchShortcut(key('c', { metaKey: true }))?.id).toBe('copy');
  });

  it('matches brackets by code (Shift+[ types { on US layouts) and ? regardless of Shift', () => {
    expect(matchShortcut(key('{', { metaKey: true, shiftKey: true }, 'BracketLeft'))?.id).toBe('send-to-back');
    expect(matchShortcut(key(']', { metaKey: true }, 'BracketRight'))?.id).toBe('bring-forward');
    expect(matchShortcut(key('[', {}, 'BracketLeft'))?.id).toBe('rotate-left');
    expect(matchShortcut(key('?', { shiftKey: true }, 'Slash'))?.id).toBe('help');
    expect(matchShortcut(key('ArrowLeft', { shiftKey: true }, 'ArrowLeft'))?.id).toBe('nudge-left-5');
    expect(comboMatches('Mod+G', key('g', { ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('formats for macOS and other platforms', () => {
    expect(formatCombo('Mod+Shift+BracketRight', true)).toEqual(['⌘', '⇧', ']']);
    expect(formatCombo('Mod+Shift+Z', false)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(formatCombo('ArrowUp', false)).toEqual(['↑']);
  });

  it('the help overlay lists every shortcut', () => {
    const html = renderToStaticMarkup(<ShortcutHelp onClose={() => {}} />);
    for (const s of SHORTCUTS) expect(html).toContain(`data-shortcut="${s.id}"`);
    expect(html).toContain('role="dialog"');
  });
});

describe('controlled camera', () => {
  const home = initialIsoPose(18);

  it('validates shape and finiteness', () => {
    expect(isValidCamera({ zoom: 20, target: [0, 0, 0] })).toBe(true);
    expect(isValidCamera({ zoom: 20, target: [0, 0] })).toBe(false);
    expect(isValidCamera({ zoom: Number.NaN, target: [0, 0, 0] })).toBe(false);
    expect(isValidCamera({ zoom: 20, target: [0, 0, 0], yaw: 'x' })).toBe(false);
    expect(isValidCamera(null)).toBe(false);
  });

  it('round-trips through the pose, top-down included', () => {
    const cam = cameraFromView(30, [1, 0, 2], home);
    expect(cam).toEqual({ zoom: 30, target: [1, 0, 2], yaw: home.yaw, topDown: false });
    expect(poseFromCamera(cam, home)).toEqual(home);
    const flat = toggleTopDown(home, home.radius);
    const camFlat = cameraFromView(30, [1, 0, 2], flat);
    expect(camFlat.topDown).toBe(true);
    expect(poseFromCamera(camFlat, home)).toEqual(flat);
  });

  it('clamps zoom and compares with a tolerance', () => {
    expect(clampCamera({ zoom: 9999, target: [0, 0, 0] }).zoom).toBe(80);
    expect(sameCamera({ zoom: 20, target: [0, 0, 0] }, { zoom: 20 + 1e-9, target: [0, 0, 0], yaw: 0, topDown: false })).toBe(true);
    expect(sameCamera({ zoom: 20, target: [0, 0, 0] }, { zoom: 21, target: [0, 0, 0] })).toBe(false);
    expect(sameCamera(null, null)).toBe(true);
  });
});

describe('system clipboard envelope', () => {
  it('round-trips copied parts and rejects anything else', () => {
    const scene = sceneOf([tank('a', 0, 0), tank('b', 4, 0)]);
    const text = serializeClipboard(copyObjects(scene, new Set(['b']), registry));
    expect(text).toContain(CLIPBOARD_FORMAT);
    expect(parseClipboard(text)?.map((o) => o.id)).toEqual(['b']);
    expect(parseClipboard('hello')).toBeNull();
    expect(parseClipboard(`{"format":"${CLIPBOARD_FORMAT}"`)).toBeNull();
    expect(parseClipboard(JSON.stringify({ format: CLIPBOARD_FORMAT, objects: [] }))).toBeNull();
    expect(parseClipboard(JSON.stringify({ format: CLIPBOARD_FORMAT, objects: [{ id: 1, object: 'tank' }] }))).toBeNull();
    expect(parseClipboard(JSON.stringify({ format: 'other', objects: [{ id: 'a', object: 'tank', x: 0, y: 0 }], note: CLIPBOARD_FORMAT }))).toBeNull();
  });

  it('pastes duplicate-id clip entries as distinct new placements', () => {
    const { objects, ids } = pasteObjects(sceneOf([]), [tank('x', 0, 0), tank('y', 0, 0)], registry);
    expect(ids).toEqual(['tank-1', 'tank-2']);
    expect(objects).toHaveLength(2);
  });
});

describe('inspector (holodeck#92) and layers panel markup', () => {
  it('parseMetaValue keeps the original type when the text fits it', () => {
    expect(parseMetaValue('42', 7)).toBe(42);
    expect(parseMetaValue('4x', 7)).toBe('4x');
    expect(parseMetaValue('', 7)).toBe('');
    expect(parseMetaValue('false', true)).toBe(false);
    expect(parseMetaValue('007', 'zip')).toBe('007');
  });

  const render = (node: React.ReactNode) => renderToStaticMarkup(<IsoRegistryProvider registry={registry}>{node}</IsoRegistryProvider>);
  const noop = () => {};

  it('single selection shows opacity, z-order, layer and the metadata table when onAction is wired', () => {
    const t = tank('t', 0, 0, { opacity: 0.4, z: 3, meta: { region: 'eu', nodes: 3 } });
    const html = render(
      <InspectorPanel registry={registry} def={undefined} selected={t} selection={[t]} layers={sceneLayers({})} onParam={noop} onPatch={noop} onRotate={noop} onDelete={noop} onAction={noop} />,
    );
    expect(html).toContain('aria-label="Opacity"');
    expect(html).toContain('value="0.4"');
    expect(html).toMatch(/data-testid="z-readout"[^>]*>3</);
    expect(html).toContain('aria-label="Layer"');
    expect(html).toContain('data-testid="meta-editor"');
    expect(html).toContain('value="region"');
    expect(html).toContain('2/32');
  });

  it('without onAction the inspector stays as before (no appearance / metadata sections)', () => {
    const html = render(<InspectorPanel registry={registry} def={undefined} selected={tank('t', 0, 0)} onParam={noop} onPatch={noop} onRotate={noop} onDelete={noop} />);
    expect(html).not.toContain('meta-editor');
    expect(html).not.toContain('aria-label="Opacity"');
  });

  it('two or more parts switch to the multi-selection view with shared params', () => {
    const sel = [tank('a', 0, 0), tank('b', 4, 0)];
    const html = render(
      <InspectorPanel registry={registry} def={undefined} selected={sel[1]} selection={sel} layers={sceneLayers({})} onParam={noop} onPatch={noop} onRotate={noop} onDelete={noop} onAction={noop} />,
    );
    expect(html).toContain('2 parts selected');
    expect(html).toContain('Align centres on x');
    expect(html).toContain('Tank params (all 2)');
    const mixed = render(
      <InspectorPanel registry={registry} def={undefined} selected={sel[1]} selection={[sel[0]!, { id: 'v', object: 'valve', x: 1, y: 1 }]} layers={sceneLayers({})} onParam={noop} onPatch={noop} onRotate={noop} onDelete={noop} onAction={noop} />,
    );
    expect(mixed).not.toContain('params (all');
  });

  it('layers panel lists the default layer first with toggles and counts', () => {
    const scene = sceneOf([tank('a', 0, 0), tank('b', 4, 0, { layer: 'l' })], { layers: [{ id: 'l', name: 'Pipes', hidden: true }] });
    const html = renderToStaticMarkup(<LayersPanel scene={scene} activeLayer="l" hasSelection={false} onAction={noop} />);
    expect(html.indexOf('data-layer="default"')).toBeLessThan(html.indexOf('data-layer="l"'));
    expect(html).toContain('aria-label="Show layer Pipes"');
    expect(html).toContain('aria-label="Lock layer Default"');
    expect(html).toContain('aria-label="Remove layer Pipes"');
    expect(html).not.toContain('aria-label="Remove layer Default"');
    expect(html).toMatch(/aria-current="true"[^>]*>|data-layer="l" aria-current="true"/);
  });
});
