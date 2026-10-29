/// <reference types="vite/client" />
/**
 * Vessel family workbench: the base `Tank` presets (HLT, mash tun, kettle,
 * whirlpool, fermenter, brite) side by side at the brewhouse's spacing and
 * copper liquid, so the family reads as one object with different params.
 * vessels-render.test.ts snapshots it to artifacts/render/brewhouse-vessels.png.
 *
 * URL params: level=<0..1> (default 0.5), agitate=1 (spin the agitators),
 * only=<preset id> (one vessel, centred: the close-up review shots),
 * zoom=<n> (orthographic zoom, default 62), target=<x,y,z> (look-at point,
 * default the middle of the row at y 1.3).
 */
import { createRoot } from 'react-dom/client';
import { useRef } from 'react';
import type { Group } from 'three';
import { Tank } from '../../assets/process/Tank';
import { TANK_PRESETS, type TankPresetId } from '../../assets/process/tank-presets';
import { tankLayout, mergeTankParams } from '../../assets/process/tank-params';
import { IsoCanvas } from './IsoCanvas';
import { useIsoAnimators } from '../anim/use-iso-animators';
import { IsoRegistryProvider } from '../registry/react';
import { getDefaultIsoRegistry } from '../registry/default';

const COPPER = '#c8792a';
const query = new URLSearchParams(location.search);
const level = Number(query.get('level') ?? 0.5);
const agitate = query.get('agitate') === '1';
const only = query.get('only');
const zoom = Number(query.get('zoom') ?? 62);
const targetParam = query.get('target')?.split(',').map(Number);

const ORDER: TankPresetId[] = ['hlt', 'mash-tun', 'kettle', 'whirlpool', 'fermenter', 'brite-tank'];
const SPACING = 3.4;

const SPIN_DEF = { animNodes: { agitatorRpm: { node: 'anim.agitator', animator: 'spin' } } };

/** Screen-horizontal in the iso view (camera on +X+Z): world (+X, -Z). */
const along = (i: number): [number, number] => [(i * SPACING) / Math.SQRT2, (-i * SPACING) / Math.SQRT2];

function Vessel({ id, index }: { id: TankPresetId; index: number }) {
  const [x, z] = along(index);
  const preset = TANK_PRESETS[id];
  const p = mergeTankParams(preset.params);
  const layout = tankLayout(preset.height, preset.radius, p);
  const root = useRef<Group>(null);
  useIsoAnimators(root.current, SPIN_DEF, { agitatorRpm: agitate ? 30 : 0 });
  return (
    <group ref={root} name={`vessel:${id}`}>
      <Tank
        position={[x, -layout.floorY, z]}
        radius={preset.radius}
        height={preset.height}
        fill={level}
        fillColor={COPPER}
        params={preset.params}
      />
    </group>
  );
}

function Workbench() {
  const shown = only && (ORDER as string[]).includes(only) ? [only as TankPresetId] : ORDER;
  const [mx, mz] = along((shown.length - 1) / 2);
  return (
    <main data-testid="vessels-root" data-vessels={shown.join(',')} style={{ width: '100%', height: '100%' }}>
      <IsoRegistryProvider registry={getDefaultIsoRegistry()}>
        <IsoCanvas
          zoom={zoom}
          target={
            targetParam?.length === 3 && targetParam.every(Number.isFinite)
              ? (targetParam as [number, number, number])
              : [mx, 1.3, mz]
          } showControls={false} showGrid>
          {shown.map((id, i) => (
            <Vessel key={id} id={id} index={i} />
          ))}
        </IsoCanvas>
      </IsoRegistryProvider>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(<Workbench />);
