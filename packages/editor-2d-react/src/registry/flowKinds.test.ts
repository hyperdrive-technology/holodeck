import { ContributionRegistry, runContributionKindConformance } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { createFlowRegistry, flowEdgeTypeKind, flowNodeTypeKind, flowPaletteKind, registerFlowKinds } from './flowKinds';

const Comp = () => null;
const check = (ok: boolean, msg: string) => expect(ok, msg).toBe(true);

describe('flow kind conformance', () => {
  it('nodeType', () =>
    runContributionKindConformance(() => new ContributionRegistry(), flowNodeTypeKind, [
      { id: 'a', component: Comp },
      { id: 'b', component: Comp },
    ], check));
  it('edgeType', () =>
    runContributionKindConformance(() => new ContributionRegistry(), flowEdgeTypeKind, [
      { id: 'a', component: Comp },
      { id: 'b', component: Comp },
    ], check));
  it('palette', () =>
    runContributionKindConformance(() => new ContributionRegistry(), flowPaletteKind, [
      { id: 'a', nodeType: 't', label: 'A' },
      { id: 'b', nodeType: 't', label: 'B', category: 'X' },
    ], check));
});

describe('validators', () => {
  it('rejects bad items and leaves registry untouched', () => {
    const r = createFlowRegistry();
    expect(() => r.install({ id: 'e', version: '1', contributions: { 'holodeck.flow.nodeType': [{ id: 'x', component: 3 } as any] } })).toThrow();
    expect(() => r.install({ id: 'e2', version: '1', contributions: { 'holodeck.flow.palette': [{ id: 'x', label: 'no nodeType' } as any] } })).toThrow();
    expect(() => r.install({ id: 'e3', version: '1', contributions: { 'holodeck.flow.palette': [{ id: 'x', nodeType: 't', label: 'L', category: 1 } as any] } })).toThrow();
    expect(r.installedExtensions()).toHaveLength(0);
  });
  it('accepts memo-style object components', () => {
    const r = createFlowRegistry();
    r.install({ id: 'e', version: '1', contributions: { 'holodeck.flow.nodeType': [{ id: 'm', component: { $$typeof: 1 } as any }] } });
    expect(r.list('holodeck.flow.nodeType')).toHaveLength(1);
  });
  it('registerFlowKinds twice throws; returned fn unregisters', () => {
    const r = new ContributionRegistry();
    const off = registerFlowKinds(r);
    expect(() => registerFlowKinds(r)).toThrow();
    off();
    expect(r.hasKind('holodeck.flow.palette')).toBe(false);
  });
});
