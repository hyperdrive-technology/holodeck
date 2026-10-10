import type { ContributionRegistry } from '@holodeck/sdk';
import sceneJson from '../../tests/scene.json';
import { parseSceneFile, type IsoSceneFile } from './scene';

/** Parse + validate a scene against `registry` (default: built-in parts). */
export function loadProcessScene(raw: unknown = sceneJson, registry?: ContributionRegistry): IsoSceneFile {
  return parseSceneFile(raw, registry);
}

export const PROCESS_SCENE = loadProcessScene();
