import { describe, expect, it } from 'vitest';
import { DEFAULT_PANEL_STATE, dismissNotice, MAX_NOTICES, noticeStore, notify, panelStore, parsePanelState, PANEL_STATE_KEY, togglePanel } from './ui-state';

describe('ui state', () => {
  it.each([
    [null, DEFAULT_PANEL_STATE],
    ['not json', DEFAULT_PANEL_STATE],
    ['[1]', DEFAULT_PANEL_STATE],
    ['{"sidebarOpen":false}', { sidebarOpen: false, inspectorOpen: true }],
    ['{"sidebarOpen":"no","inspectorOpen":false}', { sidebarOpen: true, inspectorOpen: false }],
  ])('parsePanelState(%j)', (raw, expected) => {
    expect(parsePanelState(raw)).toEqual(expected);
  });

  it('toggles panels and persists them', () => {
    const before = panelStore.state.inspectorOpen;
    togglePanel('inspectorOpen');
    expect(panelStore.state.inspectorOpen).toBe(!before);
    expect(parsePanelState(localStorage.getItem(PANEL_STATE_KEY)).inspectorOpen).toBe(!before);
    togglePanel('inspectorOpen');
  });

  it('keeps at most MAX_NOTICES notices and dismisses by id', () => {
    const ids = Array.from({ length: MAX_NOTICES + 2 }, (_, i) => notify({ tone: 'info', title: `n${i}` }));
    expect(noticeStore.state.map((n) => n.title)).toEqual(Array.from({ length: MAX_NOTICES }, (_, i) => `n${i + 2}`));
    dismissNotice(ids.at(-1)!);
    expect(noticeStore.state).toHaveLength(MAX_NOTICES - 1);
  });
});
