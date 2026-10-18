import { describe, expect, it } from 'vitest';
import { createStudioHost } from './studio-host';
import { groupLibrary, libraryItems, matchesQuery, type LibraryItem } from './library';

const item = (over: Partial<LibraryItem> = {}): LibraryItem => ({
  kind: 'holodeck.iso.part',
  id: 'tank',
  label: 'Tank',
  category: 'Vessels',
  packageId: 'holodeck.iso',
  packageName: 'Holodeck 2.5D engine',
  ...over,
});

describe('library', () => {
  it('lists the installed palette parts with their package, hiding hideInPalette parts', async () => {
    const host = await createStudioHost();
    const items = libraryItems(host);
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['tank', 'valve', 'pipe', 'label', 'area']));
    expect(ids).not.toContain('shaft');
    expect(new Set(items.map((i) => i.packageId))).toEqual(new Set(['holodeck.iso', 'holodeck.cloud']));
    expect(items.find((i) => i.id === 'tank')?.packageName).toBe('Holodeck 2.5D engine');
  });

  describe('matchesQuery', () => {
    it('matches everything for an empty or blank query', () => {
      expect(matchesQuery(item(), '')).toBe(true);
      expect(matchesQuery(item(), '   ')).toBe(true);
    });
    it('is case-insensitive over label, id, category, hint and package', () => {
      expect(matchesQuery(item(), 'TANK')).toBe(true);
      expect(matchesQuery(item(), 'vessel')).toBe(true);
      expect(matchesQuery(item({ hint: 'stainless' }), 'stain')).toBe(true);
      expect(matchesQuery(item(), '2.5d')).toBe(true);
      expect(matchesQuery(item({ id: 'brewery:fermenter', label: 'FV' }), 'ferm')).toBe(true);
    });
    it('needs every term', () => {
      expect(matchesQuery(item(), 'tank vessels')).toBe(true);
      expect(matchesQuery(item(), 'tank pipe')).toBe(false);
    });
  });

  it('groups by package then category in first-seen order, dropping empty groups', () => {
    const items = [
      item({ id: 'tank' }),
      item({ id: 'valve', label: 'Valve', category: 'Piping' }),
      item({ id: 'mixer', label: 'Mixer' }),
      item({ id: 'srv', label: 'Server', category: 'Compute', packageId: 'acme', packageName: 'Acme' }),
    ];
    const groups = groupLibrary(items);
    expect(groups.map((g) => g.packageId)).toEqual(['holodeck.iso', 'acme']);
    expect(groups[0]?.categories.map((c) => [c.category, c.items.map((i) => i.id)])).toEqual([
      ['Vessels', ['tank', 'mixer']],
      ['Piping', ['valve']],
    ]);
    expect(groupLibrary(items, 'server').map((g) => g.packageId)).toEqual(['acme']);
    expect(groupLibrary(items, 'nothing matches')).toEqual([]);
  });
});
