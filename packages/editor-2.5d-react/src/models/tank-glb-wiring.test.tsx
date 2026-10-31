/**
 * What `Tank` actually hands mixer.glb (fourth review of #228): AgitatedVessel
 * is replaced by a stub that prints its props, so these fail if Tank stops
 * forwarding a param (shell shading, the theme's liquid opacity, level...).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../assets/process/AgitatedVessel', () => ({
  AGITATED_VESSEL_NODE: 'agitated-vessel',
  AgitatedVessel: (props: Record<string, unknown>) => <group name="agitated-vessel" data-props={JSON.stringify(props)} />,
}));

import { Mixer } from '../../assets/process/Mixer';
import { HolodeckStyleProvider } from '../../assets/process/style-context';
import { HOLODECK_STYLE, LIQUID_FINISH, type HolodeckStyle } from '../../assets/process/style';
import type { TankParams } from '../../assets/process/tank-params';

let quiet: { mockRestore: () => void };
beforeAll(() => {
  quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => quiet.mockRestore());

function glbProps(params: Partial<TankParams>, style: HolodeckStyle = HOLODECK_STYLE, fill = 0.4): Record<string, unknown> {
  const html = renderToStaticMarkup(
    <HolodeckStyleProvider style={style}>
      <Mixer position={[0, 0, 0]} fill={fill} params={params} />
    </HolodeckStyleProvider>,
  );
  const m = /data-props="([^"]*)"/.exec(html);
  if (!m) throw new Error(`mixer.glb not mounted: ${html.slice(0, 200)}`);
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

describe('Tank -> AgitatedVessel props', () => {
  it('caller shell shading reaches the GLB', () => {
    expect(glbProps({ shadeMin: 0.8, shadeMax: 0.9, hubWhite: 0.7 }).shade).toEqual({ shadeMin: 0.8, shadeMax: 0.9, hubWhite: 0.7 });
    expect(glbProps({}).shade).toBeUndefined();
  });

  it('the theme liquid opacity reaches the GLB (holodeck#239); an explicit one wins', () => {
    const faint: HolodeckStyle = { ...HOLODECK_STYLE, finishes: { ...HOLODECK_STYLE.finishes, liquid: { ...LIQUID_FINISH, opacity: 0.2 } } };
    expect(glbProps({}, faint).opacity).toBe(0.2);
    expect(glbProps({ liquidOpacity: 0.5 }, faint).opacity).toBe(0.5);
  });

  it('level, liquid visibility, agitator and edge colour', () => {
    expect(glbProps({}, HOLODECK_STYLE, 0.4).fill).toBe(0.4);
    expect(glbProps({ showLiquid: false }).fill).toBe(0);
    expect(glbProps({ agitator: false }).agitator).toBe(false);
    expect(glbProps({ edgeColor: '#112233' }).edgeColor).toBe('#112233');
    expect(glbProps({ fillColor: '#ff0000' }).color).toBe('#ff0000');
  });
});
