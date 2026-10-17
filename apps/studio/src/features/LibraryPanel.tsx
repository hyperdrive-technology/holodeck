import { useSelector } from '@tanstack/react-store';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { formatForDisplay } from '@tanstack/react-hotkeys';
import { groupLibrary, libraryItems } from '../host/library';
import { useStudio } from '../studio-context';
import { activeDocumentStore } from './active-document';

export const LIBRARY_SEARCH_ID = 'library-search';

/** Re-read the library whenever the registry changes (late package installs). */
function useRegistryVersion() {
  const { host } = useStudio();
  const [version, setVersion] = useState(0);
  useEffect(() => host.registry.subscribe(() => setVersion((v) => v + 1)), [host]);
  return version;
}

export function LibraryPanel() {
  const { host } = useStudio();
  const [query, setQuery] = useState('');
  const active = useSelector(activeDocumentStore);
  const version = useRegistryVersion();
  // `version` invalidates the memo when packages change.
  const items = useMemo(() => libraryItems(host), [host, version]);
  const groups = useMemo(() => groupLibrary(items, query), [items, query]);
  return (
    <section aria-labelledby="library-heading" className="flex min-h-0 flex-1 flex-col">
      <header className="px-3 pb-2 pt-3">
        <h2 id="library-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Library
        </h2>
        <div className="relative mt-2">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={LIBRARY_SEARCH_ID}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                e.currentTarget.blur();
              }
            }}
            placeholder="Search components"
            aria-label="Search the library"
            className="pl-7 pr-12"
          />
          <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">{formatForDisplay('Mod+K')}</Kbd>
        </div>
        {!active ? <p className="mt-2 text-xs text-muted-foreground">Open a document to place components.</p> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3" data-testid="library">
        {groups.length === 0 ? <p className="px-2 text-xs text-muted-foreground">Nothing matches “{query}”.</p> : null}
        {groups.map((group) => (
          <section key={group.packageId} aria-label={group.packageName} className="mb-2">
            <h3 className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground" title={group.packageId}>
              {group.packageName}
            </h3>
            {group.categories.map(({ category, items: list }) => (
              <div key={category} role="group" aria-label={category}>
                <h4 className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground/80">{category}</h4>
                <ul>
                  {list.map((item) => (
                    <li key={`${item.kind}:${item.id}`} className="group/item relative">
                      {/* Click arms the canvas place tool (then click the floor); "+" adds it next to the scene. */}
                      <button
                        type="button"
                        disabled={!active}
                        aria-pressed={active?.placing === item.id}
                        onClick={() => active?.armItem(item.kind, item.id)}
                        data-library-item={item.id}
                        title={item.hint ? `${item.hint} (click, then click the canvas)` : `Place ${item.label}: click, then click the canvas`}
                        className="flex w-full flex-col items-start rounded-md px-2 py-1.5 pr-9 text-left text-sm hover:bg-sidebar-accent aria-pressed:bg-sidebar-accent aria-pressed:ring-1 aria-pressed:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span>{item.label}</span>
                        {item.hint ? <span className="line-clamp-1 text-xs text-muted-foreground">{item.hint}</span> : null}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!active}
                        aria-label={`Add ${item.label} to the document`}
                        title={`Add ${item.label} next to the scene`}
                        data-library-add={item.id}
                        onClick={() => active?.addItem(item.kind, item.id)}
                        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 focus-visible:opacity-100"
                      >
                        <PlusIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
