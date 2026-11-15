/** The headless capture route: input validation and the run-mode canvas (ProcessEditor stubbed, as in EmbedRoute.test). */
import type { HolodeckHost } from '@holodeck/sdk';
import type { IsoPartDefinition, ProcessEditorProps } from '@holodeck/editor-2.5d-react';
import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIsoDocument } from '../documents/new-document';
import { createStudioHost } from '../host/studio-host';
import { StudioProvider, type StudioServices } from '../studio-context';
import { NO_CHANNEL, withPart } from '../test-support';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { modelScene, RENDER_MODEL_PART_ID, RenderRoute } from './RenderRoute';
import { readRenderInput, RENDER_INPUT_GLOBAL, RENDER_MODEL_FORMAT } from './render-input';

const editor = vi.hoisted(() => ({ props: null as ProcessEditorProps | null }));

vi.mock('@holodeck/editor-2.5d-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@holodeck/editor-2.5d-react')>();
  function StubEditor(props: ProcessEditorProps) {
    editor.props = props;
    return <div data-testid="process-editor" data-host-mode={props.mode} data-object-count={props.scene.objects.length} />;
  }
  return { ...actual, ProcessEditor: StubEditor };
});

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});
beforeEach(() => {
  editor.props = null;
});

const services = () => ({ host, channel: NO_CHANNEL }) as unknown as StudioServices;
const mount = (input: Record<string, unknown>) =>
  render(
    <StudioProvider services={services()}>
      <RenderRoute input={input} />
    </StudioProvider>,
  );

function plant() {
  const doc = createIsoDocument('Plant', 'plant-1');
  doc.body = withPart(doc.body, host.registry, 'tank').scene;
  return doc;
}

describe('readRenderInput', () => {
  it('missing, invalid (every problem) and ok', () => {
    expect(readRenderInput(host, {})).toEqual({ kind: 'missing' });
    expect(readRenderInput(host, { [RENDER_INPUT_GLOBAL]: null })).toEqual({ kind: 'missing' });
    const bad = readRenderInput(host, { [RENDER_INPUT_GLOBAL]: { format: 'holodeck.document.v1' } });
    expect(bad.kind).toBe('invalid');
    expect(readRenderInput(host, { [RENDER_INPUT_GLOBAL]: 'junk' })).toMatchObject({ kind: 'invalid', problems: ['document: must be a JSON object'] });
    expect(readRenderInput(host, { [RENDER_INPUT_GLOBAL]: plant() })).toMatchObject({ kind: 'ok' });
  });

  it('a model input (blender_preview) is checked field by field', () => {
    const model = { format: RENDER_MODEL_FORMAT, url: '/__holodeck_mcp__/model.glb', footprint: { w: 2, h: 1 }, height: 1.5 };
    expect(readRenderInput(host, { [RENDER_INPUT_GLOBAL]: model })).toEqual({
      kind: 'model',
      model: { url: '/__holodeck_mcp__/model.glb', footprint: { w: 2, h: 1 }, height: 1.5, label: 'Model' },
    });
    expect(readRenderInput(host, { [RENDER_INPUT_GLOBAL]: { ...model, label: 'Mixer' } })).toMatchObject({ kind: 'model', model: { label: 'Mixer' } });
    // Only same-origin paths: no scheme, no protocol-relative host, no "..".
    for (const url of ['https://example.com/x.glb', '//example.com/x.glb', 'data:model/gltf-binary;base64,AA', 'model.glb', '/a/../b.glb', '/a b.glb', 42]) {
      const read = readRenderInput(host, { [RENDER_INPUT_GLOBAL]: { ...model, url } });
      expect(read, String(url)).toMatchObject({ kind: 'invalid', problems: [expect.stringMatching(/^url:/)] });
    }
    const bad = readRenderInput(host, { [RENDER_INPUT_GLOBAL]: { format: RENDER_MODEL_FORMAT, url: '/m.glb', footprint: { w: 0, h: 1e9 }, height: Number.NaN, label: 'x'.repeat(201) } });
    expect(bad).toMatchObject({ kind: 'invalid' });
    expect(bad.kind === 'invalid' && bad.problems.map((p) => p.split(':')[0])).toEqual(['footprint', 'height', 'label']);
  });

  it('refuses a document with credentials in a connection, like an import', () => {
    const doc = { ...plant(), connections: [{ id: 'api', provider: 'holodeck.http', config: { url: 'https://u:p@example.com/x' } }] };
    expect(readRenderInput(host, { [RENDER_INPUT_GLOBAL]: doc }).kind).toBe('invalid');
  });
});

describe('RenderRoute', () => {
  it('without input says what to set and renders no canvas', () => {
    mount({});
    expect(screen.getByTestId('render')).toHaveAttribute('data-render-input', 'missing');
    expect(screen.queryByTestId('process-editor')).toBeNull();
  });

  it('lists the problems of an invalid document', () => {
    mount({ [RENDER_INPUT_GLOBAL]: { format: 'holodeck.document.v1', id: 'x' } });
    expect(screen.getByTestId('render')).toHaveAttribute('data-render-input', 'invalid');
    expect(screen.getByTestId('render-problems').children.length).toBeGreaterThan(0);
    expect(editor.props).toBeNull();
  });

  it('draws a model input as one data-only part on its own registry, not the host\'s', () => {
    mount({ [RENDER_INPUT_GLOBAL]: { format: RENDER_MODEL_FORMAT, url: '/__holodeck_mcp__/model.glb', footprint: { w: 3, h: 2 }, height: 1.2, label: 'Mixer' } });
    expect(screen.getByTestId('render')).toHaveAttribute('data-render-input', 'model');
    expect(editor.props).toMatchObject({ mode: 'run', chrome: 'canvas' });
    expect(editor.props?.registry).not.toBe(host.registry);
    expect(editor.props?.scene.objects).toEqual([{ id: 'model', object: RENDER_MODEL_PART_ID, x: 0, y: 0 }]);
    const part = editor.props?.registry?.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, RENDER_MODEL_PART_ID);
    expect(part).toMatchObject({ model: '/__holodeck_mcp__/model.glb', footprint: { w: 3, h: 2 }, defaults: { height: 1.2 } });
    expect(part?.component).toBeUndefined();
    // The host registry never learns about the preview part.
    expect(host.registry.get(HOLODECK_KINDS.isoPart, RENDER_MODEL_PART_ID)).toBeUndefined();
  });

  it('modelScene keeps the editor built-ins (themes, animators) next to the model part', () => {
    const { registry } = modelScene({ url: '/m.glb', footprint: { w: 1, h: 1 }, height: 1, label: 'M' });
    expect(registry.get(HOLODECK_KINDS.isoPart, 'tank')).toBeDefined();
    expect(registry.list(HOLODECK_KINDS.isoTheme).length).toBeGreaterThan(0);
  });

  it('draws a valid document in run mode with the canvas chrome only', () => {
    mount({ [RENDER_INPUT_GLOBAL]: plant() });
    expect(screen.getByTestId('render')).toHaveAttribute('data-render-input', 'ok');
    expect(editor.props).toMatchObject({ mode: 'run', chrome: 'canvas' });
    expect(editor.props?.scene.objects.length).toBe(1);
    expect(editor.props?.registry).toBe(host.registry);
  });
});
