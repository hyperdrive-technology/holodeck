/**
 * Utilities to map Starfleet scene data to Three.js values
 */

import type { Color, Geometry, Material, SceneNode } from '@starfleet/sdk';
import * as THREE from 'three';
import { NODE_COLORS } from '../constants';

export function colorToHex(color: Color): number {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return (r << 16) | (g << 8) | b;
}

export function resolveNodeColor(node: SceneNode): number {
  if (node.material?.color) {
    return colorToHex(node.material.color);
  }
  const preset =
    NODE_COLORS[node.type] ??
    NODE_COLORS.default ??
    { r: 0.6, g: 0.6, b: 0.6, a: 1 };
  return colorToHex(preset);
}

export function resolveNodePosition(node: SceneNode): [number, number, number] {
  const { x, y, z } = node.transform.position;
  return [x, y, z];
}

export function resolveNodeScale(node: SceneNode): [number, number, number] {
  const { x, y, z } = node.transform.scale;
  return [x || 1, y || 1, z || 1];
}

export function resolveNodeRotation(node: SceneNode): [number, number, number] {
  const { x, y, z } = node.transform.rotation;
  return [x, y, z];
}

export function buildNodeMaterial(node: SceneNode): THREE.MeshStandardMaterial {
  const color = resolveNodeColor(node);
  const metalness = node.material?.metalness ?? 0.2;
  const roughness = node.material?.roughness ?? 0.6;
  const opacity = node.material?.opacity ?? node.material?.color?.a ?? 1;

  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    transparent: opacity < 1,
    opacity,
  });
}

export function geometryArgs(
  geometry: Geometry | undefined
): { type: 'box' | 'sphere' | 'cylinder' | 'plane'; args: number[] } {
  const type = geometry?.type ?? 'box';
  const p = geometry?.parameters ?? {};

  switch (type) {
    case 'sphere':
      return {
        type: 'sphere',
        args: [p.radius ?? 0.5, 32, 32],
      };
    case 'cylinder':
      return {
        type: 'cylinder',
        args: [
          p.radiusTop ?? p.radius ?? 0.5,
          p.radiusBottom ?? p.radius ?? 0.5,
          p.height ?? 1,
          32,
        ],
      };
    case 'plane':
      return {
        type: 'plane',
        args: [p.width ?? 2, p.height ?? 2],
      };
    case 'box':
    default:
      return {
        type: 'box',
        args: [p.width ?? 1, p.height ?? 1, p.depth ?? 1],
      };
  }
}

export function buildNodePositions(
  nodes: SceneNode[]
): Map<string, [number, number, number]> {
  const map = new Map<string, [number, number, number]>();
  for (const node of nodes) {
    map.set(node.id, resolveNodePosition(node));
  }
  return map;
}

export function edgeColorToHex(edge: { color?: Color }): number {
  if (edge.color) {
    return colorToHex(edge.color);
  }
  return 0x888888;
}
