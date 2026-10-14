/**
 * holodeck#55 GPT review (P1): two documents saved from one scene share the
 * body's `scene.id`. ProcessEditor keys its undo/redo reset on `scene.id`
 * (holodeck#20), so the envelope id must be the loaded scene's id, or undo
 * after switching documents restores the other document.
 */
import { describe, expect, it } from 'vitest';
import { createEditorState, editorReducer, committedScene, emptyScene } from '../editor/editor-state';
import { loadIsoDocument, toIsoDocument } from './document';
import type { IsoSceneFile } from '../iso/scene';

const shared = (): IsoSceneFile => ({ ...emptyScene('shared-scene'), name: 'Shared' });

describe('document identity', () => {
  it('toIsoDocument writes an overriding id into the body', () => {
    const scene = shared();
    const doc = toIsoDocument(scene, { id: 'doc-a' });
    expect(doc.id).toBe('doc-a');
    expect(doc.body.id).toBe('doc-a');
    expect(scene.id).toBe('shared-scene'); // caller's scene untouched
    expect(toIsoDocument(scene).body).toBe(scene); // no override: same object
  });

  it('loadIsoDocument takes the id from the envelope, not the body', () => {
    const envelope = (id: string) => ({ ...toIsoDocument(shared()), id });
    const a = loadIsoDocument(envelope('doc-a'));
    const b = loadIsoDocument(envelope('doc-b'));
    expect(envelope('doc-a').body.id).toBe('shared-scene'); // the hazard: bodies agree
    expect(a.scene.id).toBe('doc-a');
    expect(b.scene.id).toBe('doc-b');
    expect(a.document.body.id).toBe('doc-a');
  });

  it('the repro: edit A, load B (same body id, different envelope ids), undo does not restore A', () => {
    const envelope = (id: string) => ({ ...toIsoDocument(shared()), id });
    const a = loadIsoDocument(envelope('doc-a')).scene;
    const b = loadIsoDocument(envelope('doc-b')).scene;

    let s = createEditorState(a);
    s = editorReducer(s, { type: 'place-mode', object: 'tank' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    expect(s.past).toHaveLength(1);

    const loaded = editorReducer(s, { type: 'load', scene: b });
    expect(loaded.past).toEqual([]);
    expect(loaded.scene.id).toBe('doc-b');
    const undone = editorReducer(loaded, { type: 'undo' });
    expect(undone).toBe(loaded);
    expect(committedScene(loaded, undone)).toBeNull();
  });
});
