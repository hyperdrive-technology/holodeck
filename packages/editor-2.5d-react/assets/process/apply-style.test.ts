import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type Material,
} from 'three';
import type { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import type { Line2NodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  EDGE_LINES_NAME,
  applyHolodeckStyle,
  findAnimNodes,
  findPorts,
  finishForMaterialName,
  materialFinishForName,
  resetHolodeckStyleWarnings,
} from './apply-style';
import type { IsoUniforms } from './materials';
import { HOLODECK_STYLE } from './style';

function part(materialName: string, color = '#ffffff'): Mesh {
  const material = new MeshStandardMaterial({ color });
  material.name = materialName;
  return new Mesh(new BoxGeometry(), material);
}

function edgesOf(mesh: Mesh): LineSegments2 | undefined {
  return mesh.children.find((c) => c.name === EDGE_LINES_NAME) as LineSegments2 | undefined;
}

/**
 * Stand-in for a GLTFLoader result: GLTFLoader strips '.' from node names
 * (PropertyBinding.sanitizeNodeName) and keeps the authored name in
 * userData.name.
 */
function gltfNode(authored: string, object: Object3D = new Object3D()): Object3D {
  object.name = authored.replace(/[[\]./:]/g, '');
  object.userData.name = authored;
  return object;
}

const silenceWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
let warn: ReturnType<typeof silenceWarn>;

beforeEach(() => {
  resetHolodeckStyleWarnings();
  warn = silenceWarn();
});

afterEach(() => {
  warn.mockRestore();
});

describe('hd.liquid (translucent liquid contract shared with the Blender lane)', () => {
  it('parses hd.liquid and its Blender duplicate suffix', () => {
    expect(materialFinishForName('hd.liquid')).toBe('liquid');
    expect(materialFinishForName('hd.liquid.002')).toBe('liquid');
    expect(materialFinishForName('hd.vessel.001')).toBe('vessel');
    // The original shell-finish lookup keeps its type and result for hd.liquid (not a shell finish).
    expect(finishForMaterialName('hd.liquid')).toBeNull();
  });

  it('renders as the translucent liquid: style colour, finish opacity, depthWrite off, render order, edges', () => {
    const liquid = part('hd.liquid', '#ff0000');
    const shell = part('hd.vessel');
    const root = new Group().add(shell, liquid);
    const dispose = applyHolodeckStyle(root);
    const mat = liquid.material as MeshBasicNodeMaterial;
    expect(mat.userData.hdFinish).toBe('liquid');
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.opacity).toBeCloseTo(HOLODECK_STYLE.finishes.liquid!.opacity);
    // Colour comes from the style, not the GLB base colour (level colour is a runtime override).
    expect(`#${mat.color.getHexString()}`).toBe(HOLODECK_STYLE.colors.liquid);
    expect(liquid.renderOrder).toBe(HOLODECK_STYLE.finishes.liquid!.renderOrder);
    expect(liquid.renderOrder).toBeGreaterThan(shell.renderOrder);
    expect(edgesOf(liquid)).toBeDefined();
    dispose();
    expect(liquid.renderOrder).toBe(0);
  });

  it('overrides.liquid / liquidOpacity beat the style', () => {
    const liquid = part('hd.liquid');
    applyHolodeckStyle(new Group().add(liquid), HOLODECK_STYLE, { liquid: '#18bae6', liquidOpacity: 0.5 });
    const mat = liquid.material as MeshBasicNodeMaterial;
    expect(`#${mat.color.getHexString()}`).toBe('#18bae6');
    expect(mat.opacity).toBeCloseTo(0.5);
  });

  it('a theme without finishes.liquid still styles hd.liquid with the default token', () => {
    const { liquid: _omit, ...finishes } = HOLODECK_STYLE.finishes;
    const liquid = part('hd.liquid');
    applyHolodeckStyle(new Group().add(liquid), { ...HOLODECK_STYLE, finishes });
    expect((liquid.material as MeshBasicNodeMaterial).transparent).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('finishForMaterialName', () => {
  it('maps the hd.* contract and Blender duplicate suffixes', () => {
    expect(finishForMaterialName('hd.white')).toBe('white');
    expect(finishForMaterialName('hd.shaded')).toBe('shaded');
    expect(finishForMaterialName('hd.vessel')).toBe('vessel');
    expect(finishForMaterialName('hd.flask')).toBe('flask');
    expect(finishForMaterialName('hd.accent')).toBe('accent');
    expect(finishForMaterialName('hd.vessel.001')).toBe('vessel');
  });

  it('rejects anything else', () => {
    for (const name of ['', 'Material', 'hd.', 'hd.chrome', 'HD.white', 'hd.white.x', 'xhd.white', 'hd.whitey']) {
      expect(finishForMaterialName(name)).toBeNull();
    }
    expect(finishForMaterialName(undefined)).toBeNull();
    expect(finishForMaterialName(null)).toBeNull();
  });
});

describe('applyHolodeckStyle', () => {
  it('picks the finish from the material name', () => {
    const root = new Group();
    const meshes = {
      white: part('hd.white'),
      shaded: part('hd.shaded'),
      vessel: part('hd.vessel'),
      flask: part('hd.flask'),
      accent: part('hd.accent', '#123456'),
    };
    root.add(...Object.values(meshes));
    applyHolodeckStyle(root);

    for (const [finish, mesh] of Object.entries(meshes)) {
      expect((mesh.material as Material).userData.hdFinish).toBe(finish);
    }
    const vessel = (meshes.vessel.material as MeshBasicNodeMaterial).userData.iso as IsoUniforms;
    expect(vessel.uShadeMin.value).toBe(HOLODECK_STYLE.finishes.vessel.shadeMin);
    expect(vessel.uShadeMax.value).toBe(HOLODECK_STYLE.finishes.vessel.shadeMax);
    const flask = (meshes.flask.material as MeshBasicNodeMaterial).userData.iso as IsoUniforms;
    expect(flask.uShadeMin.value).toBe(HOLODECK_STYLE.finishes.flask.shadeMin);
    const shaded = (meshes.shaded.material as MeshBasicNodeMaterial).userData.iso as IsoUniforms;
    expect(shaded.uShadeMin.value).toBe(0.5);
    expect((meshes.white.material as MeshBasicNodeMaterial).userData.iso).toBeUndefined();
    expect((meshes.white.material as MeshBasicNodeMaterial).color.getHexString()).toBe('ffffff');
    expect((meshes.white.material as MeshBasicNodeMaterial).polygonOffset).toBe(false);
    expect((meshes.vessel.material as MeshBasicNodeMaterial).polygonOffset).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the source base colour for hd.accent, and the override beats it', () => {
    const fromSource = part('hd.accent', '#c0392b');
    const sourceColor = (fromSource.material as unknown as MeshStandardMaterial).color.clone();
    const a = new Group().add(fromSource);
    applyHolodeckStyle(a);
    expect((fromSource.material as MeshBasicNodeMaterial).color.equals(sourceColor)).toBe(true);
    expect((fromSource.material as MeshBasicNodeMaterial).color.getHexString()).toBe('c0392b');

    const overridden = part('hd.accent', '#c0392b');
    const b = new Group().add(overridden);
    applyHolodeckStyle(b, HOLODECK_STYLE, { accent: '#00ff00' });
    expect((overridden.material as MeshBasicNodeMaterial).color.getHexString()).toBe('00ff00');
  });

  it('body override recolours hd.white only (data-only part colours)', () => {
    const white = part('hd.white');
    const vessel = part('hd.vessel');
    const accent = part('hd.accent', '#c0392b');
    applyHolodeckStyle(new Group().add(white, vessel, accent), HOLODECK_STYLE, { body: '#ff9900' });
    expect((white.material as MeshBasicNodeMaterial).color.getHexString()).toBe('ff9900');
    expect((accent.material as MeshBasicNodeMaterial).color.getHexString()).toBe('c0392b');
    expect((vessel.material as MeshBasicNodeMaterial).userData.iso).toBeDefined();
  });

  it('falls back to the accent token when the source has no colour', () => {
    const material = new MeshStandardMaterial();
    // Some exporters hand back materials without a Color (e.g. a custom shader).
    (material as unknown as { color: undefined }).color = undefined;
    material.name = 'hd.accent';
    const mesh = new Mesh(new BoxGeometry(), material);
    applyHolodeckStyle(new Group().add(mesh));
    expect((mesh.material as unknown as MeshBasicNodeMaterial).color.getHexString()).toBe('c0392b');
  });

  it('styles unknown / unnamed materials white and warns once per name', () => {
    const root = new Group();
    const a = part('Material.001');
    const b = part('Material.001');
    const c = part('');
    root.add(a, b, c);
    applyHolodeckStyle(root);
    applyHolodeckStyle(new Group().add(part('Material.001')));

    for (const mesh of [a, b, c]) {
      expect((mesh.material as Material).userData.hdFinish).toBe('white');
    }
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('"Material.001"');
    expect(String(warn.mock.calls[1][0])).toContain('(unnamed)');
  });

  it('adds one outline per mesh at the default threshold, colour and width', () => {
    const mesh = part('hd.white');
    applyHolodeckStyle(new Group().add(mesh));
    const line = edgesOf(mesh);
    expect(line).toBeDefined();
    const material = line!.material as Line2NodeMaterial;
    expect(material.color.getHexString()).toBe('666666');
    expect(material.linewidth).toBe(HOLODECK_STYLE.edges.lineWidth);
    // A box at 15° keeps its 12 hard edges.
    expect(line!.geometry.instanceCount).toBe(12);
  });

  it('reads hd_edge_threshold and hd_edges from userData (glTF extras), inherited from parents', () => {
    const coarse = part('hd.white');
    coarse.userData.hd_edge_threshold = 91; // above every box crease → no segments
    const off = part('hd.white');
    off.userData.hd_edges = false;
    const offInt = part('hd.white');
    offInt.userData.hd_edges = 0;
    const group = new Group();
    group.userData.hd_edges = false; // multi-primitive node: extras on the Group
    const child = part('hd.white');
    group.add(child);
    const bad = part('hd.white');
    bad.userData.hd_edge_threshold = 'steep';
    const root = new Group().add(coarse, off, offInt, group, bad);
    applyHolodeckStyle(root);

    expect(edgesOf(coarse)!.geometry.instanceCount).toBe(0);
    expect(edgesOf(off)).toBeUndefined();
    expect(edgesOf(offInt)).toBeUndefined();
    expect(edgesOf(child)).toBeUndefined();
    expect(edgesOf(bad)!.geometry.instanceCount).toBe(12);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hd_edge_threshold'));
  });

  it('applies edge overrides', () => {
    const mesh = part('hd.white');
    mesh.userData.hd_edge_threshold = 91;
    const plain = part('hd.white');
    applyHolodeckStyle(new Group().add(mesh, plain), HOLODECK_STYLE, {
      edgeColor: '#ff0000',
      lineWidth: 3,
      threshold: 91,
    });
    // Per-mesh userData still wins over the call-wide threshold.
    expect(edgesOf(mesh)!.geometry.instanceCount).toBe(0);
    expect(edgesOf(plain)!.geometry.instanceCount).toBe(0);
    const material = edgesOf(plain)!.material as Line2NodeMaterial;
    expect(material.color.getHexString()).toBe('ff0000');
    expect(material.linewidth).toBe(3);
  });

  it('is idempotent', () => {
    const mesh = part('hd.vessel');
    const root = new Group().add(mesh);
    applyHolodeckStyle(root);
    const material = mesh.material;
    const childCount = mesh.children.length;
    const disposeSecond = applyHolodeckStyle(root);
    expect(mesh.material).toBe(material);
    expect(mesh.children.length).toBe(childCount);
    expect(mesh.children.filter((c) => c.name === EDGE_LINES_NAME)).toHaveLength(1);
    // The second pass owns nothing, so its dispose must not free the first pass's material.
    const spy = vi.fn();
    (material as Material).addEventListener('dispose', spy);
    disposeSecond();
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps an existing finish material instead of replacing it', () => {
    const mesh = part('hd.white');
    applyHolodeckStyle(new Group().add(mesh))();
    // dispose cleared the flag and outlines; the mesh still holds a finish material.
    const finish = mesh.material;
    const spy = vi.fn();
    (finish as Material).addEventListener('dispose', spy);
    applyHolodeckStyle(new Group().add(mesh));
    expect(mesh.material).toBe(finish);
    expect(spy).not.toHaveBeenCalled();
    expect(edgesOf(mesh)).toBeDefined();
  });

  it('shares one finish per source material and disposes replaced sources', () => {
    const source = new MeshStandardMaterial();
    source.name = 'hd.flask';
    source.side = DoubleSide;
    const disposed = vi.fn();
    source.addEventListener('dispose', disposed);
    const a = new Mesh(new BoxGeometry(), source);
    const b = new Mesh(new BoxGeometry(), source);
    applyHolodeckStyle(new Group().add(a, b));
    expect(a.material).toBe(b.material);
    expect((a.material as Material).side).toBe(DoubleSide);
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('handles material arrays', () => {
    const white = new MeshStandardMaterial();
    white.name = 'hd.white';
    const accent = new MeshStandardMaterial({ color: '#0000ff' });
    accent.name = 'hd.accent';
    const mesh = new Mesh(new BoxGeometry(), [white, accent]);
    applyHolodeckStyle(new Group().add(mesh));
    const [m0, m1] = mesh.material as unknown as MeshBasicNodeMaterial[];
    expect(m0.userData.hdFinish).toBe('white');
    expect(m1.userData.hdFinish).toBe('accent');
    expect(m1.color.getHexString()).toBe('0000ff');
  });

  it('leaves port.* subtrees untouched and styles meshes under anim.*', () => {
    const portMesh = part('Gizmo');
    const portMaterial = portMesh.material;
    const port = gltfNode('port.in');
    port.add(portMesh);
    const impeller = gltfNode('anim.impeller', part('hd.accent', '#ff00ff'));
    impeller.position.set(0, 2, 0);
    impeller.rotation.set(0.1, 0.2, 0.3);
    const root = new Group().add(port, impeller);
    applyHolodeckStyle(root);

    expect(portMesh.material).toBe(portMaterial);
    expect(portMesh.children).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    expect(((impeller as Mesh).material as Material).userData.hdFinish).toBe('accent');
    expect(impeller.name).toBe('animimpeller');
    expect(impeller.position.toArray()).toEqual([0, 2, 0]);
    expect([impeller.rotation.x, impeller.rotation.y, impeller.rotation.z]).toEqual([0.1, 0.2, 0.3]);
    expect(impeller.parent).toBe(root);
  });

  it('gives InstancedMesh the finish but no outline', () => {
    const material = new MeshStandardMaterial();
    material.name = 'hd.white';
    const instanced = new InstancedMesh(new BoxGeometry(), material, 4);
    applyHolodeckStyle(new Group().add(instanced));
    expect((instanced.material as Material).userData.hdFinish).toBe('white');
    expect(edgesOf(instanced as unknown as Mesh)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('InstancedMesh'));
  });

  it('returns a dispose that frees what it created and removes outlines', () => {
    const mesh = part('hd.vessel');
    const other = part('hd.white');
    const root = new Group().add(mesh, other);
    const dispose = applyHolodeckStyle(root);
    const finish = mesh.material as Material;
    const line = edgesOf(mesh)!;
    const finishDisposed = vi.fn();
    const geometryDisposed = vi.fn();
    const edgeMaterialDisposed = vi.fn();
    finish.addEventListener('dispose', finishDisposed);
    line.geometry.addEventListener('dispose', geometryDisposed);
    (line.material as Material).addEventListener('dispose', edgeMaterialDisposed);
    const sourceGeometryDisposed = vi.fn();
    mesh.geometry.addEventListener('dispose', sourceGeometryDisposed);

    dispose();
    dispose(); // second call is a no-op

    expect(finishDisposed).toHaveBeenCalledTimes(1);
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(edgeMaterialDisposed).toHaveBeenCalledTimes(1);
    // The mesh's own geometry belongs to the caller.
    expect(sourceGeometryDisposed).not.toHaveBeenCalled();
    expect(edgesOf(mesh)).toBeUndefined();
    expect(edgesOf(other)).toBeUndefined();
    expect(mesh.userData.hdStyled).toBeUndefined();
  });
});

describe('findPorts / findAnimNodes', () => {
  it('finds ports by authored name in root-local space', () => {
    const root = new Group();
    root.position.set(100, 0, 0); // placement must not leak into port positions
    const body = gltfNode('body', new Group());
    body.position.set(0, 1, 0);
    const inlet = gltfNode('port.in');
    inlet.position.set(-0.5, 0, 0);
    const outlet = gltfNode('port.out');
    outlet.position.set(0.5, 0.25, 0);
    body.add(inlet, outlet);
    root.add(body);
    const ports = findPorts(root);
    expect(Object.keys(ports).sort()).toEqual(['port.in', 'port.out']);
    expect(ports['port.in'].toArray()).toEqual([-0.5, 1, 0]);
    expect(ports['port.out'].toArray()).toEqual([0.5, 1.25, 0]);
  });

  it('falls back to object.name when there is no userData.name, and keeps the first duplicate', () => {
    const root = new Group();
    const a = new Object3D();
    a.name = 'port.in';
    a.position.set(1, 0, 0);
    const b = new Object3D();
    b.name = 'port.in';
    b.position.set(2, 0, 0);
    root.add(a, b);
    expect(findPorts(root)['port.in'].x).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate port'));
  });

  it('finds anim nodes', () => {
    const root = new Group();
    const impeller = gltfNode('anim.impeller');
    const lid = gltfNode('anim.lid');
    root.add(impeller, gltfNode('port.in'), part('hd.white'));
    impeller.add(lid);
    const nodes = findAnimNodes(root);
    expect(Object.keys(nodes).sort()).toEqual(['anim.impeller', 'anim.lid']);
    expect(nodes['anim.impeller']).toBe(impeller);
    expect(nodes['anim.lid']).toBe(lid);
  });

  it('returns empty records for a plain scene', () => {
    const root = new Group().add(part('hd.white'));
    expect(findPorts(root)).toEqual({});
    expect(findAnimNodes(root)).toEqual({});
  });
});
