/** The headless capture route: input validation and the run-mode canvas (ProcessEditor stubbed, as in EmbedRoute.test). */
import type { HolodeckHost } from '@holodeck/sdk';
import type { ProcessEditorProps } from '@holodeck/editor-2.5d-react';
import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIsoDocument } from '../documents/new-document';
import { createStudioHost } from '../host/studio-host';
import { StudioProvider, type StudioServices } from '../studio-context';
import { NO_CHANNEL, withPart } from '../test-support';
import { RenderRoute } from './RenderRoute';
import { readRenderInput, RENDER_INPUT_GLOBAL } from './render-input';

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

  it('draws a valid document in run mode with the canvas chrome only', () => {
    mount({ [RENDER_INPUT_GLOBAL]: plant() });
    expect(screen.getByTestId('render')).toHaveAttribute('data-render-input', 'ok');
    expect(editor.props).toMatchObject({ mode: 'run', chrome: 'canvas' });
    expect(editor.props?.scene.objects.length).toBe(1);
    expect(editor.props?.registry).toBe(host.registry);
  });
});
