import { useState } from 'react';
import { FileSearch, Search } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { useCodeStore } from '@/store/code';
import { Badge, EmptyState, Segmented, Spinner, TextInput } from '@/components/ui';

export function SearchPanel() {
  const { t } = useI18n();
  const search = useCodeStore((s) => s.search);
  const runSearch = useCodeStore((s) => s.runSearch);
  const clearSearch = useCodeStore((s) => s.clearSearch);
  const openFile = useCodeStore((s) => s.openFile);
  const [mode, setMode] = useState<'all' | 'name' | 'content'>('all');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line p-2.5">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-dim" />
            <TextInput
              value={search.query}
              autoFocus
              onChange={(e) => {
                const q = e.target.value;
                if (!q.trim()) clearSearch();
                else void runSearch(q, mode);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void runSearch(search.query, mode)}
              placeholder={t('code.searchPlaceholder')}
              className="!py-1.5 !text-[12px] ps-7"
              dir="ltr"
            />
          </div>
          {search.running ? <Spinner size={13} /> : null}
        </div>
        <Segmented
          className="mt-2"
          value={mode}
          onChange={(v) => {
            setMode(v);
            if (search.query.trim()) void runSearch(search.query, v);
          }}
          options={[
            { id: 'all', label: t('common.all') },
            { id: 'name', label: t('code.files') },
            { id: 'content', label: t('code.editor') },
          ]}
        />
      </div>

      <div className="scroll-thin min-h-0 flex-1">
        {!search.result ? (
          <EmptyState icon={<FileSearch size={20} />} title={t('code.search')} hint={t('code.searchPlaceholder')} />
        ) : search.result.hits.length === 0 ? (
          <EmptyState title={t('code.noResults')} hint={`${search.result.scannedFiles} ${t('code.files').toLowerCase()}`} />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
              <Badge tone="info">
                {t('code.searchResults', { n: search.result.hits.length, files: search.result.scannedFiles })}
              </Badge>
              {search.result.truncated ? <Badge tone="warning">{t('code.tooManyResults')}</Badge> : null}
            </div>
            <ul className="flex flex-col">
              {search.result.hits.map((h, i) => (
                <li key={`${h.path}:${h.line}:${i}`}>
                  <button
                    type="button"
                    onClick={() => void openFile(h.path)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 border-b border-line/60 px-2.5 py-1.5 text-start transition-colors hover:bg-elevated/70',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text" dir="ltr">
                        {h.path}
                      </span>
                      {h.line > 0 ? <span className="shrink-0 font-mono text-[10px] text-dim">:{h.line}</span> : null}
                      {h.score >= 3 ? <Badge tone="accent">{t('code.files')}</Badge> : null}
                    </span>
                    {h.line > 0 ? (
                      <span className="truncate font-mono text-[11px] text-muted" dir="ltr">
                        {h.text}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
