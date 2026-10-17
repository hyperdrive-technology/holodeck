import type { HolodeckHost } from '@holodeck/sdk';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { openStudioDb } from '../documents/db';
import { createIsoDocument } from '../documents/new-document';
import { DocumentStore } from '../documents/store';
import { createStudioHost } from '../host/studio-host';
import { StudioProvider } from '../studio-context';
import { NO_CHANNEL, withPart } from '../test-support';
import type { IsoPartDefinition } from '@holodeck/editor-2.5d-react';
import { Inspector, type InspectorProps } from './Inspector';
import { visibleParams } from './inspector.logic';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});

function setup(over: Partial<InspectorProps> = {}) {
  const doc = createIsoDocument('Plant', 'p');
  doc.body = withPart(doc.body, host.registry, 'tank').scene;
  const props: InspectorProps = {
    doc,
    selectedId: null,
    onRename: vi.fn(),
    onEdit: vi.fn(),
    onDeleteObject: vi.fn(),
    onDeleteDocument: vi.fn(),
    ...over,
  };
  render(
    <StudioProvider services={{ host, store: new DocumentStore(openStudioDb('inspector-test')), channel: NO_CHANNEL }}>
      <Inspector {...props} />
    </StudioProvider>,
  );
  return props;
}

describe('<Inspector />', () => {
  it('shows the document with nothing selected and renames on Enter', () => {
    const props = setup();
    expect(screen.getByTestId('inspector-object-count')).toHaveTextContent('1');
    const name = screen.getByLabelText('Document name');
    fireEvent.change(name, { target: { value: '  Brewhouse ' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(props.onRename).toHaveBeenCalledWith('Brewhouse');
  });

  // Finding 4: documents stored before timestamps were validated must still render.
  it('renders an unparsable stored timestamp as text instead of crashing', () => {
    const doc = { ...createIsoDocument('Legacy', 'l'), metadata: { created: 'c', updated: 'not a date' } };
    setup({ doc: doc as InspectorProps['doc'] });
    expect(screen.getByText('c')).toBeInTheDocument();
    expect(screen.getByText('not a date')).toBeInTheDocument();
  });

  it('refuses an empty name and reverts on Escape', () => {
    const props = setup();
    const name = screen.getByLabelText('Document name');
    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(props.onRename).not.toHaveBeenCalled();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(name).toHaveValue('Plant');
  });

  it('asks before deleting the document', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /Delete document/ }));
    expect(props.onDeleteDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onDeleteDocument).toHaveBeenCalledOnce();
  });

  it('edits the selected object: position, rotation, params, delete', () => {
    const props = setup({ selectedId: 'tank-1' });
    expect(screen.getByTestId('inspector-selected-id')).toHaveTextContent('tank-1');
    const x = screen.getByLabelText('X');
    fireEvent.change(x, { target: { value: '4.567' } });
    fireEvent.blur(x);
    expect(props.onEdit).toHaveBeenLastCalledWith('tank-1', { kind: 'move', patch: { x: 4.57 } });
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    expect(props.onEdit).toHaveBeenLastCalledWith('tank-1', { kind: 'rotate', direction: 1 });
    fireEvent.click(screen.getByRole('button', { name: /Delete object/ }));
    expect(props.onDeleteObject).toHaveBeenCalledWith('tank-1');
  });

  it('renders a control for every visible param of the part', () => {
    setup({ selectedId: 'tank-1' });
    expect(screen.getByRole('heading', { name: 'Parameters' })).toBeInTheDocument();
    const def = host.registry.get<IsoPartDefinition>('holodeck.iso.part', 'tank')!;
    const visible = visibleParams(def.params);
    expect(visible.length).toBeGreaterThan(0);
    for (const [name, spec] of visible) expect(screen.getByLabelText(spec.label || name)).toBeInTheDocument();
  });
});
