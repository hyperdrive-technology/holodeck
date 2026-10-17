import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { HOLODECK_STYLE } from '../../assets/process';
import { HolodeckStyleProvider, useHolodeckStyle } from '../../assets/process/style-context';
import { InspectorPanel, ParamControl, rotationDegrees } from '../editor/InspectorPanel';
import { paletteGroups } from '../editor/Palette';
import { BUILTIN_ISO_PARTS } from './builtin';
import { createIsoRegistryWithBuiltins } from './default';
import { IsoRegistryProvider, useIsoParts, useIsoRegistry, useIsoThemeStyle } from './react';
import { HOLODECK_STYLE_DARK, HOLODECK_THEME_DARK, HOLODECK_THEME_DEFAULT } from './themes';
import type { IsoInspectorPanel, IsoPartDefinition } from './types';

function StyleProbe() {
  const style = useHolodeckStyle();
  return <span data-body={style.colors.body} data-accent={style.colors.accent} />;
}

describe('theme context', () => {
  it('defaults to HOLODECK_STYLE with no provider', () => {
    expect(renderToStaticMarkup(<StyleProbe />)).toBe(
      `<span data-body="${HOLODECK_STYLE.colors.body}" data-accent="${HOLODECK_STYLE.colors.accent}"></span>`,
    );
  });

  it('switches to a provided style, and nested providers win', () => {
    const html = renderToStaticMarkup(
      <HolodeckStyleProvider style={HOLODECK_STYLE_DARK}>
        <StyleProbe />
      </HolodeckStyleProvider>,
    );
    expect(html).toContain(`data-body="${HOLODECK_STYLE_DARK.colors.body}"`);
    const nested = renderToStaticMarkup(
      <HolodeckStyleProvider style={HOLODECK_STYLE_DARK}>
        <HolodeckStyleProvider style={HOLODECK_STYLE}>
          <StyleProbe />
        </HolodeckStyleProvider>
      </HolodeckStyleProvider>,
    );
    expect(nested).toContain(`data-body="${HOLODECK_STYLE.colors.body}"`);
  });

  it('the dark theme differs from the default in body and accent, and keeps every default token key', () => {
    expect(HOLODECK_STYLE_DARK.colors.body).not.toBe(HOLODECK_STYLE.colors.body);
    expect(HOLODECK_STYLE_DARK.colors.accent).not.toBe(HOLODECK_STYLE.colors.accent);
    expect(HOLODECK_STYLE_DARK.finishes.white.color).toBe(HOLODECK_STYLE_DARK.colors.body);
    expect(Object.keys(HOLODECK_STYLE_DARK.colors).sort()).toEqual(Object.keys(HOLODECK_STYLE.colors).sort());
    expect(Object.keys(HOLODECK_STYLE_DARK.finishes).sort()).toEqual(Object.keys(HOLODECK_STYLE.finishes).sort());
    expect(HOLODECK_THEME_DEFAULT.style).toBe(HOLODECK_STYLE);
    // Body stays light: the canvas background is white.
    expect(Number.parseInt(HOLODECK_STYLE_DARK.colors.body.slice(1, 3), 16)).toBeGreaterThan(0xc0);
  });

  it('scene.theme resolves through the registry; unknown or absent ids give the default look', () => {
    const registry = createIsoRegistryWithBuiltins();
    const probe = (id: string | undefined) => {
      let out: unknown = 'unset';
      function P() {
        out = useIsoThemeStyle(id, registry);
        return null;
      }
      renderToString(<P />);
      return out;
    };
    expect(probe('holodeck.dark')).toBe(HOLODECK_THEME_DARK.style);
    expect(probe(undefined)).toBeUndefined();
    expect(probe('no.such.theme')).toBeUndefined();
  });
});

describe('registry context', () => {
  it('useIsoRegistry returns the provided registry, else a shared built-in one', () => {
    const mine = createIsoRegistryWithBuiltins();
    let provided: unknown;
    let fallback: unknown;
    function A() {
      provided = useIsoRegistry();
      return null;
    }
    function B() {
      fallback = useIsoRegistry();
      return null;
    }
    renderToString(
      <IsoRegistryProvider registry={mine}>
        <A />
      </IsoRegistryProvider>,
    );
    renderToString(<B />);
    expect(provided).toBe(mine);
    expect(fallback).not.toBe(mine);
    expect((fallback as typeof mine).list(HOLODECK_KINDS.isoPart).length).toBe(BUILTIN_ISO_PARTS.length);
  });

  it('useIsoParts sees parts installed before render', () => {
    const registry = createIsoRegistryWithBuiltins();
    const thing: IsoPartDefinition = {
      id: 'pack:thing',
      label: 'Thing',
      footprint: { w: 1, h: 1 },
      params: {},
      component: () => null,
    };
    registry.install({ id: 'p', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [thing] } });
    let ids: string[] = [];
    function P() {
      ids = useIsoParts(registry).map((p) => p.id);
      return null;
    }
    renderToString(<P />);
    expect(ids).toContain('pack:thing');
  });
});

describe('palette grouping', () => {
  it('groups registry parts by category in first-seen order and hides hideInPalette parts', () => {
    const groups = paletteGroups(BUILTIN_ISO_PARTS, '');
    expect(groups.map((g) => g.category)).toEqual(['Vessels', 'Piping', 'Annotation']);
    const all = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(all).not.toContain('shaft');
    expect(all).toEqual(['tank', 'mixer', 'valve', 'pipe', 'elbow', 'end-cap', 'label', 'area', 'connector', 'icon', 'image']);
  });

  it('filters by label and drops empty groups; uncategorised parts go under Other', () => {
    expect(paletteGroups(BUILTIN_ISO_PARTS, ' VAL ').map((g) => g.items.map((i) => i.id))).toEqual([['valve']]);
    expect(paletteGroups(BUILTIN_ISO_PARTS, 'zzz')).toEqual([]);
    const loose: IsoPartDefinition = { ...BUILTIN_ISO_PARTS[0]!, id: 'loose', label: 'Loose', category: undefined };
    expect(paletteGroups([loose], '')[0]?.category).toBe('Other');
  });
});

describe('inspector', () => {
  const registry = createIsoRegistryWithBuiltins();
  const noop = () => undefined;
  const props = { registry, onParam: noop, onPatch: noop, onRotate: noop, onDelete: noop };
  const tankDef = BUILTIN_ISO_PARTS.find((p) => p.id === 'tank')!;

  it('asks for a selection when there is none', () => {
    const html = renderToStaticMarkup(<InspectorPanel {...props} def={undefined} selected={undefined} />);
    expect(html).toContain('Select a part');
  });

  it('shows label, position, rotation and a control per param, with static values over defaults', () => {
    const html = renderToStaticMarkup(
      <InspectorPanel
        {...props}
        def={tankDef}
        selected={{ id: 'tank-1', object: 'tank', x: 3, y: -2, rotation: Math.PI / 2, params: { level: 0.8 } }}
      />,
    );
    expect(html).toContain('Tank');
    expect(html).toContain('3, -2');
    expect(html).toContain('90°');
    expect(html).toContain('Level');
    expect(html).toContain('value="0.8"');
    expect(html).toContain('type="range"');
    expect(html).toContain('type="checkbox"'); // alarm
    expect(html).toContain('Temperature');
  });

  it('renders the host slot (node or function) and every inspector contribution', () => {
    const reg = createIsoRegistryWithBuiltins();
    const bindings: IsoInspectorPanel = {
      id: 'bindings',
      label: 'Tag binding',
      component: ({ placement }) => <i>bound:{placement.id}</i>,
    };
    reg.install({ id: 'host', version: '1', contributions: { [HOLODECK_KINDS.isoInspector]: [bindings] } });
    const selected = { id: 'tank-1', object: 'tank', x: 0, y: 0 };
    const html = renderToStaticMarkup(
      <InspectorPanel {...props} registry={reg} def={tankDef} selected={selected} slot={(p) => <b>slot:{p.id}</b>} />,
    );
    expect(html).toContain('slot:');
    expect(html).toContain('tank-1');
    expect(html).toContain('Tag binding');
    expect(html).toContain('bound:');
    const fixed = renderToStaticMarkup(
      <InspectorPanel {...props} def={tankDef} selected={selected} slot={<u>fixed</u>} />,
    );
    expect(fixed).toContain('<u>fixed</u>');
  });

  it('survives a placement whose part is not installed', () => {
    const html = renderToStaticMarkup(
      <InspectorPanel {...props} def={undefined} selected={{ id: 'x', object: 'gone', x: 0, y: 0 }} />,
    );
    expect(html).toContain('not installed');
    expect(html).toContain('gone');
  });

  it('renders the right control for each param type', () => {
    const base = { label: 'L', default: undefined };
    const render = (spec: Parameters<typeof ParamControl>[0]['spec'], value: unknown) =>
      renderToStaticMarkup(<ParamControl name="p" spec={spec} value={value} onChange={noop} />);
    expect(render({ ...base, type: 'number', min: 0, max: 10, step: 2, unit: 'rpm' }, 4)).toMatch(/type="range"[^>]*max="10"|max="10"[^>]*type="range"/);
    expect(render({ ...base, type: 'number' }, 4)).not.toContain('type="range"'); // no bounds -> no slider
    expect(render({ ...base, type: 'boolean' }, true)).toContain('checked');
    expect(render({ ...base, type: 'enum', options: ['a', 'b'] }, 'b')).toContain('<option value="b" selected');
    expect(render({ ...base, type: 'string' }, 'hello')).toContain('value="hello"');
  });

  it('formats rotation as whole degrees in [0, 360)', () => {
    expect(rotationDegrees(undefined)).toBe(0);
    expect(rotationDegrees(Math.PI)).toBe(180);
    expect(rotationDegrees(-Math.PI / 2)).toBe(270);
    expect(rotationDegrees(Math.PI * 2)).toBe(0);
  });
});
