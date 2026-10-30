/**
 * Which body `Tank` actually mounts (holodeck#234, second review of #228).
 * Server-rendered markup of the R3F element tree: no WebGL needed. The GLB
 * path is AgitatedVessel's `agitated-vessel` group (its model suspends, so it
 * renders empty here); the procedural agitator is `TankAgitator`'s
 * `anim.agitator` group on the vessel's own body.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Tank } from '../../assets/process/Tank';
import { Mixer } from '../../assets/process/Mixer';
import { AGITATED_VESSEL_NODE } from '../../assets/process/AgitatedVessel';
import { AGITATOR_ANIM_NODE } from '../../assets/process/TankAgitator';
import { TANK_PRESETS } from '../../assets/process/tank-presets';
import type { TankParams } from '../../assets/process/tank-params';

// R3F intrinsics (<mesh>, <cylinderGeometry>) are unknown DOM tags to react-dom: silence its casing warnings.
let quiet: { mockRestore: () => void };
beforeAll(() => {
  quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => quiet.mockRestore());

const markup = (params: Partial<TankParams>) => renderToStaticMarkup(<Tank position={[0, 0, 0]} params={params} />);
const isGlb = (html: string) => html.includes(`name="${AGITATED_VESSEL_NODE}"`);
const hasProceduralAgitator = (html: string) => html.includes(`name="${AGITATOR_ANIM_NODE}"`);
const mashTun = TANK_PRESETS['mash-tun'].params;

describe('Tank body: mixer.glb vs the vessel own body', () => {
  it('the mash tun preset mounts mixer.glb (no procedural agitator)', () => {
    const html = markup(mashTun);
    expect(isGlb(html)).toBe(true);
    expect(hasProceduralAgitator(html)).toBe(false);
  });

  it('the Mixer part mounts mixer.glb', () => {
    expect(isGlb(renderToStaticMarkup(<Mixer position={[0, 0, 0]} />))).toBe(true);
  });

  it('a fermenter with agitator on keeps its own body plus the procedural agitator', () => {
    const html = markup({ ...TANK_PRESETS.fermenter.params, agitator: true });
    expect(isGlb(html)).toBe(false);
    expect(hasProceduralAgitator(html)).toBe(true);
  });

  it('agitator off: neither', () => {
    const html = markup(TANK_PRESETS.fermenter.params);
    expect(isGlb(html)).toBe(false);
    expect(hasProceduralAgitator(html)).toBe(false);
  });

  // Second review of #228: core passes top / bottom / support / window over the preset; on main they
  // applied to the mash tun. mixer.glb cannot show them, so such a mash tun keeps the procedural body.
  it.each<[string, Partial<TankParams>]>([
    ['flat lid', { top: 'flat' }],
    ['dish bottom', { bottom: 'dish' }],
    ['legs', { support: 'legs' }],
    ['narrower window', { windowDeg: 70 }],
    ['turned window', { windowYawDeg: 30 }],
  ])('a mash tun with a %s override draws the procedural agitated body', (_name, override) => {
    const html = markup({ ...mashTun, ...override });
    expect(isGlb(html)).toBe(false);
    expect(hasProceduralAgitator(html)).toBe(true);
  });
});
