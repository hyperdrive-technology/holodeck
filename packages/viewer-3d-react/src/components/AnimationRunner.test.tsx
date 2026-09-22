import { createElement, type MutableRefObject } from 'react';
import { createTransform, type SceneGraph, type SceneNode } from '@holodeck/sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Group } from 'three';
import { describe, expect, it, vi } from 'vitest';

let onFrame:
  | ((state: { clock: { elapsedTime: number } }, delta: number) => void)
  | undefined;

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: { clock: { elapsedTime: number } }, delta: number) => void) => {
    onFrame = cb;
  },
}));

import { AnimationRunner } from './AnimationRunner';

function beltObject(rate: number) {
  const stripe = { name: 'belt-stripe', position: { x: 0 } };
  const object = {
    userData: { uvOffsetRate: rate },
    traverse(cb: (child: { userData?: { uvOffsetRate?: unknown } }) => void) {
      cb(this);
    },
    getObjectByName(name: string) {
      return name === 'belt-stripe' ? stripe : null;
    },
    stripe,
  };
  return object;
}

function tick(object: ReturnType<typeof beltObject>, elapsedTime: number) {
  const node: SceneNode = {
    id: 'inbound',
    type: 'factory:conveyor',
    name: 'Inbound',
    transform: createTransform(),
  };
  const scene: SceneGraph = { nodes: [node], edges: [] };
  const objectRefs: MutableRefObject<Map<string, Group>> = {
    current: new Map([['inbound', object as unknown as Group]]),
  };
  onFrame = undefined;
  renderToStaticMarkup(
    createElement(AnimationRunner, {
      scene,
      nodes: [node],
      objectRefs,
    }),
  );
  expect(onFrame).toEqual(expect.any(Function));
  onFrame!({ clock: { elapsedTime } }, 0);
}

describe('AnimationRunner useFrame', () => {
  it('moves named belt-stripe to x=-0.5 after 0.5s at rate 1', () => {
    const object = beltObject(1);
    tick(object, 0.5);
    expect(object.stripe.position.x).toBe(-0.5);
  });

  it('treats rate 0 as stopped then follows a live rate', () => {
    const object = beltObject(0);
    tick(object, 0.5);
    expect(object.stripe.position.x).toBe(0);
    object.userData.uvOffsetRate = 1;
    onFrame!({ clock: { elapsedTime: 0.5 } }, 0);
    expect(object.stripe.position.x).toBe(-0.5);
  });
});
