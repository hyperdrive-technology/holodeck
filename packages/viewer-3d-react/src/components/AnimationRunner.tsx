import type { AnimationHook, SceneGraph, SceneNode } from '@holodeck/sdk';
import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useRef } from 'react';
import type { Group } from 'three';
import { applyPropertyPath, evaluateAnimation } from '../utils/animation';
import { applyBeltStripe } from './belt-stripe';

export interface AnimationRunnerProps {
  scene: SceneGraph;
  nodes: SceneNode[];
  animationHooks?: AnimationHook[];
  objectRefs: MutableRefObject<Map<string, Group>>;
}

export function AnimationRunner({
  scene,
  nodes,
  animationHooks,
  objectRefs,
}: AnimationRunnerProps) {
  const frameCount = useRef(0);
  const started = useRef(false);

  useFrame((state, delta) => {
    const elapsedTime = state.clock.elapsedTime;
    frameCount.current += 1;

    const context = {
      scene,
      deltaTime: delta,
      elapsedTime,
      frameCount: frameCount.current,
    };

    if (!started.current) {
      started.current = true;
      for (const hook of animationHooks ?? []) {
        hook.onStart?.(context);
      }
    }

    for (const node of nodes) {
      const object = objectRefs.current.get(node.id);
      if (!object) {
        continue;
      }

      applyBeltStripe(object, elapsedTime);

      if (!node.animations?.length) {
        for (const hook of animationHooks ?? []) {
          hook.onNodeUpdate?.(node.id, node, context);
        }
        continue;
      }

      for (const animation of node.animations) {
        const samples = evaluateAnimation(animation, elapsedTime);
        for (const sample of samples) {
          applyPropertyPath(object, sample.property, sample.value);
        }
      }

      for (const hook of animationHooks ?? []) {
        hook.onNodeUpdate?.(node.id, node, context);
      }
    }

    for (const hook of animationHooks ?? []) {
      hook.onFrame?.(context);
    }
  });

  return null;
}
