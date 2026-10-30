import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, Bot, FileCode2, FilePlus2, FileSearch, FolderKanban, GitBranch,
  ListChecks, PanelRight, Save, Search, Terminal as TerminalIcon, Trash2, Upload, X,
} from 'lucide-react';
import { detectLanguage, isBinaryPath } from '@nova/shared';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatBytes, shortSha } from '@/lib/format';
import { api, describeApiError } from '@/lib/api';
import { useAppStore } from '@/store/app';
import { useCodeStore } from '@/store/code';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { FileTree, type FileFlags } from '@/components/code/FileTree';
import { EditorPane } from '@/components/code/EditorPane';
import { DiffView } from '@/components/code/DiffView';
import { AgentPanel } from '@/components/code/AgentPanel';
import { ChangesPanel } from '@/components/code/ChangesPanel';
import { TasksPanel } from '@/components/code/TasksPanel';
import { TerminalPanel } from '@/components/code/TerminalPanel';
import { GitPanel } from '@/components/code/GitPanel';
import { SearchPanel } from '@/components/code/SearchPanel';
import {
  Badge, Button, ConfirmDialog, Dropdown, DropdownItem, DropdownLabel, EmptyState, Field,
  IconButton, Modal, Segmented, Spinner, TextInput,
} from '@/components/ui';

type RightTab = 'agent' | 'changes' | 'tasks' | 'terminal' | 'git';
type LeftTab = 'files' | 'search';
type DiffSource = 'local' | 'proposal' | 'head';

export function CodePage() {
  const { t } = useI18n();
  const projects = useCodeStore((s) => s.projects);
  const activeProjectId = useCodeStore((s) => s.activeProjectId);
  const selectProject = useCodeStore((s) => s.selectProject);
  const loadProjects = useCodeStore((s) => s.loadProjects);
  const files = useCodeStore((s) => s.files);
  const openFiles = useCodeStore((s) => s.openFiles);
  const activePath = useCodeStore((s) => s.activePath);
  const openFile = useCodeStore((s) => s.openFile);
  const closeFile = useCodeStore((s) => s.closeFile);
  const editFile = useCodeStore((s) => s.editFile);
  const saveFile = useCodeStore((s) => s.saveFile);
  const createFile = useCodeStore((s) => s.createFile);
  const deleteFile = useCodeStore((s) => s.deleteFile);
  const git = useCodeStore((s) => s.git);
  const changes = useCodeStore((s) => s.changes);
  const tasks = useCodeStore((s) => s.tasks);
  const loading = useCodeStore((s) => s.loading);
  const agent = useCodeStore((s) => s.agent);

  const toast = useAppStore((s) => s.toast);
  const editorFontSize = useAppStore((s) => s.editorFontSize);
  const editorWrap = useAppStore((s) => s.editorWrap);
  const patchPrefs = useAppStore((s) => s.patchPrefs);

  const wide = useMediaQuery('(min-width: 1280px)');
  const medium = useMediaQuery('(min-width: 900px)');

  const [leftTab, setLeftTab] = useState<LeftTab>('files');
  const [rightTab, setRightTab] = useState<RightTab>('agent');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffSource, setDiffSource] = useState<DiffSource>('local');
  const [headDiff, setHeadDiff] = useState<{ before: string; after: string } | null>(null);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // On narrow screens collapse the rails automatically (but let the user reopen).
  useEffect(() => {
    setLeftOpen(medium);
    setRightOpen(wide);
  }, [medium, wide]);

  const project = projects.find((p) => p.id === activeProjectId) ?? null;
  const active = activePath ? openFiles[activePath] : null;
  const pendingCount = changes.filter((c) => c.status === 'pending').length;
  const proposal = activePath ? changes.find((c) => c.path === activePath && c.status === 'pending') : null;

  const flags: FileFlags = useMemo(
    () => ({
      added: new Set(git?.workingTree.added ?? []),
      modified: new Set(git?.workingTree.modified ?? []),
      deleted: new Set(git?.workingTree.deleted ?? []),
      proposed: new Set(changes.filter((c) => c.status === 'pending').map((c) => c.path)),
      dirty: new Set(Object.values(openFiles).filter((f) => f.content !== f.savedContent).map((f) => f.path)),
    }),
    [git, changes, openFiles],
  );

  /* ------------------------------------------------------------- effects */

  useEffect(() => {
    setDiffOpen(false);
    setHeadDiff(null);
    setDiffSource(proposal ? 'proposal' : 'local');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  useEffect(() => {
    if (!diffOpen || diffSource !== 'head' || !activePath || !activeProjectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.diffPath(activeProjectId, activePath);
        if (!cancelled) setHeadDiff({ before: res.before, after: res.after });
      } catch (err) {
        if (!cancelled) toast({ kind: 'error', message: describeApiError(err).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [diffOpen, diffSource, activePath, activeProjectId, toast]);

  /* -------------------------------------------------------------- upload */

  const onUpload = async (list: FileList | null) => {
    if (!list?.length || !activeProjectId) return;
    for (const file of Array.from(list)) {
      if (isBinaryPath(file.name)) {
        toast({ kind: 'error', message: file.name, hint: t('chat.binarySkipped') });
        continue;
      }
      try {
        const text = await file.text();
        await createFile(file.name, text);
        toast({ kind: 'success', message: file.name });
      } catch (err) {
        toast({ kind: 'error', message: file.name, hint: describeApiError(err).message });
      }
    }
    if (uploadRef.current) uploadRef.current.value = '';
  };

  /* ---------------------------------------------------------------- view */

  if (!activeProjectId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md">
          <EmptyState
            icon={<FolderKanban size={26} />}
            title={t('code.selectProject')}
            hint={t('code.noProjectHint')}
          />
          {projects.length > 0 ? (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {projects.map((p) => (
                <Button key={p.id} size="sm" variant="outline" onClick={() => void selectProject(p.id)}>
                  {p.name}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const diffPairs: { id: DiffSource; label: string }[] = [];
  if (active && active.content !== active.savedContent) diffPairs.push({ id: 'local', label: t('code.unsaved') });
  if (proposal) diffPairs.push({ id: 'proposal', label: t('changes.pending') });
  diffPairs.push({ id: 'head', label: 'HEAD' });

  const diffBefore =
    diffSource === 'proposal' && proposal
      ? proposal.before ?? ''
      : diffSource === 'head'
        ? headDiff?.before ?? ''
        : active?.savedContent ?? '';
  const diffAfter =
    diffSource === 'proposal' && proposal
      ? proposal.after ?? ''
      : diffSource === 'head'
        ? headDiff?.after ?? ''
        : active?.content ?? '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------------------------------------- project bar */}
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface/70 px-3 backdrop-blur">
        <Dropdown
          width={260}
          trigger={({ toggle, open }) => (
            <button
              type="button"
              onClick={toggle}
              className={cn(
                'flex items-center gap-2 rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-[12.5px] transition-colors hover:border-[#46505e]',
                open && 'border-accent/50',
              )}
            >
              <FolderKanban size={14} className="text-accent" />
              <span className="max-w-[160px] truncate font-medium">{project?.name ?? '—'}</span>
              {loading ? <Spinner size={11} /> : null}
            </button>
          )}
        >
          <DropdownLabel>{t('nav.projects')}</DropdownLabel>
          {projects.map((p) => (
            <DropdownItem key={p.id} selected={p.id === activeProjectId} onClick={() => void selectProject(p.id)}>
              {p.name}
            </DropdownItem>
          ))}
        </Dropdown>

        <div className="hidden items-center gap-1.5 md:flex">
          <Badge tone="neutral">{files.length} {t('code.files').toLowerCase()}</Badge>
          {pendingCount > 0 ? <Badge tone="warning">{pendingCount} {t('changes.pending')}</Badge> : null}
          {tasks.filter((x) => x.status !== 'done' && x.status !== 'cancelled').length > 0 ? (
            <Badge tone="info">{tasks.filter((x) => x.status !== 'done' && x.status !== 'cancelled').length} {t('tasks.title')}</Badge>
          ) : null}
          {git?.head ? (
            <Badge tone="neutral" title={git.head.message}>
              <GitBranch size={9} /> {git.branch} · {shortSha(git.head.id, 4)}
            </Badge>
          ) : null}
        </div>

        <div className="ms-auto flex items-center gap-1">
          <IconButton label={t('code.files')} className={cn(!medium && 'flex')} onClick={() => setLeftOpen((v) => !v)} active={leftOpen}>
            <FileCode2 size={15} />
          </IconButton>
          <IconButton label={t('code.search')} onClick={() => { setLeftTab('search'); setLeftOpen(true); }}>
            <Search size={15} />
          </IconButton>
          <IconButton label={t('agent.title')} onClick={() => setRightOpen((v) => !v)} active={rightOpen}>
            <PanelRight size={15} />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------ left rail */}
        {leftOpen ? (
          <aside className="flex w-[248px] shrink-0 flex-col border-e border-line bg-surface/40">
            <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
              <Segmented
                value={leftTab}
                onChange={(v) => setLeftTab(v as LeftTab)}
                options={[
                  { id: 'files', label: <span className="flex items-center gap-1"><FolderKanban size={11} />{t('code.files')}</span> },
                  { id: 'search', label: <span className="flex items-center gap-1"><FileSearch size={11} />{t('code.search')}</span> },
                ]}
              />
              <span className="ms-auto flex items-center gap-0.5">
                <input ref={uploadRef} type="file" multiple className="hidden" onChange={(e) => void onUpload(e.target.files)} />
                <IconButton label={t('code.newFile')} onClick={() => { setNewFilePath(''); setNewFileOpen(true); }}>
                  <FilePlus2 size={13} />
                </IconButton>
                <IconButton label={t('code.uploadFiles')} onClick={() => uploadRef.current?.click()}>
                  <Upload size={13} />
                </IconButton>
              </span>
            </div>
            <div className="scroll-thin min-h-0 flex-1">
              {leftTab === 'files' ? (
                <FileTree
                  files={files}
                  activePath={activePath}
                  flags={flags}
                  emptyLabel={t('common.empty')}
                  onOpen={(p) => void openFile(p)}
                  onDelete={(p) => setDeletingPath(p)}
                />
              ) : (
                <SearchPanel />
              )}
            </div>
          </aside>
        ) : null}

        {/* --------------------------------------------------------- editor */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* tabs */}
          <div className="flex h-[38px] shrink-0 items-stretch gap-px overflow-x-auto border-b border-line bg-surface/40">
            {Object.values(openFiles).map((f) => (
              <div
                key={f.path}
                className={cn(
                  'group flex min-w-0 shrink-0 items-center gap-1.5 border-e border-line px-2.5 text-[12px] transition-colors',
                  f.path === activePath ? 'bg-panel text-text' : 'text-muted hover:bg-elevated/60',
                )}
              >
                <button type="button" className="flex min-w-0 items-center gap-1.5" onClick={() => useCodeStore.getState().setActivePath(f.path)}>
                  {f.content !== f.savedContent ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
                  ) : (
                    <FileCode2 size={11} className="shrink-0 text-dim" />
                  )}
                  <span className="max-w-[160px] truncate" dir="ltr" title={f.path}>
                    {f.path.split('/').pop()}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => closeFile(f.path)}
                  className="shrink-0 rounded p-0.5 text-dim opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  aria-label={t('common.close')}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {Object.keys(openFiles).length === 0 ? (
              <span className="flex items-center px-3 text-[11.5px] text-dim">{t('code.editor')}</span>
            ) : null}
          </div>

          {/* editor toolbar */}
          {active ? (
            <div className="flex h-[38px] shrink-0 items-center gap-1.5 border-b border-line px-2.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" dir="ltr">
                {active.path}
              </span>
              {diffPairs.length > 1 || active.content !== active.savedContent ? (
                <Button
                  size="sm"
                  variant={diffOpen ? 'primary' : 'ghost'}
                  icon={<ArrowLeftRight size={12} />}
                  onClick={() => setDiffOpen((v) => !v)}
                >
                  {t('diff.title')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                icon={<Save size={12} />}
                disabled={active.binary || active.content === active.savedContent || active.saving}
                loading={active.saving}
                onClick={async () => {
                  const ok = await saveFile(active.path);
                  toast({ kind: ok ? 'success' : 'error', message: ok ? t('code.fileSaved') : t('common.error') });
                }}
              >
                <span className="hidden sm:inline">{t('code.saveFile')}</span>
              </Button>
              <IconButton label={t('code.deleteFile')} onClick={() => setDeletingPath(active.path)}>
                <Trash2 size={13} />
              </IconButton>
            </div>
          ) : null}

          {/* body */}
          <div className="min-h-0 flex-1">
            {!active ? (
              <EmptyState icon={<FileCode2 size={24} />} title={t('code.selectProject')} hint={t('code.noProjectHint')} />
            ) : active.binary ? (
              <EmptyState title={t('code.binaryFile')} />
            ) : diffOpen ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface/40 px-2.5 py-1.5">
                  <Segmented
                    value={diffSource}
                    onChange={(v) => setDiffSource(v as DiffSource)}
                    options={diffPairs}
                  />
                  {proposal ? <Badge tone="accent">{t('changes.pending')}</Badge> : null}
                  <span className="ms-auto text-[10.5px] text-dim">{t('diff.title')}</span>
                </div>
                <div className="min-h-0 flex-1">
                  {diffSource === 'head' && !headDiff ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-dim">
                      <Spinner size={13} /> <span className="text-[12px]">{t('common.loading')}</span>
                    </div>
                  ) : (
                    <DiffView before={diffBefore} after={diffAfter} mode="unified" className="h-full" />
                  )}
                </div>
              </div>
            ) : (
              <EditorPane
                path={active.path}
                value={active.content}
                language={active.language || detectLanguage(active.path)}
                readOnly={active.binary}
                fontSize={editorFontSize}
                wrap={editorWrap}
                onChange={(v) => editFile(active.path, v)}
                onSave={() => void saveFile(active.path)}
              />
            )}
          </div>

          {/* status line */}
          <footer className="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-surface/60 px-3 text-[10.5px] text-dim">
            {active ? (
              <>
                <span className="font-mono">{active.language || detectLanguage(active.path)}</span>
                <span>{t('code.lines', { n: active.content.split('\n').length })}</span>
                <span>{formatBytes(new TextEncoder().encode(active.content).length)}</span>
                {active.sha ? <span className="font-mono">sha {shortSha(active.sha, 6)}</span> : null}
                <span className={cn(active.content === active.savedContent ? 'text-success' : 'text-warning')}>
                  {active.content === active.savedContent ? t('code.saved') : t('code.unsaved')}
                </span>
              </>
            ) : (
              <span>{t('code.files')}: {files.length}</span>
            )}
            <span className="ms-auto flex items-center gap-2">
              {agent.running ? (
                <span className="flex items-center gap-1 text-info">
                  <Spinner size={10} /> {t('agent.running')}
                </span>
              ) : null}
              <button type="button" className="hover:text-text" onClick={() => patchPrefs({ editorWrap: !editorWrap })}>
                wrap {editorWrap ? 'on' : 'off'}
              </button>
              <button type="button" className="hover:text-text" onClick={() => patchPrefs({ editorFontSize: editorFontSize >= 16 ? 12 : editorFontSize + 1 })}>
                Aa {editorFontSize}
              </button>
            </span>
          </footer>
        </main>

        {/* ----------------------------------------------------- right rail */}
        {rightOpen ? (
          <aside className="flex w-[min(400px,38vw)] shrink-0 flex-col border-s border-line bg-surface/40">
            <div className="flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-line">
              <RailTab active={rightTab === 'agent'} onClick={() => setRightTab('agent')} icon={<Bot size={13} />} label={t('code.agent')} />
              <RailTab
                active={rightTab === 'changes'}
                onClick={() => setRightTab('changes')}
                icon={<ArrowLeftRight size={13} />}
                label={t('code.changes')}
                count={pendingCount}
              />
              <RailTab
                active={rightTab === 'tasks'}
                onClick={() => setRightTab('tasks')}
                icon={<ListChecks size={13} />}
                label={t('code.tasks')}
                count={tasks.filter((x) => x.status !== 'done' && x.status !== 'cancelled').length}
              />
              <RailTab active={rightTab === 'terminal'} onClick={() => setRightTab('terminal')} icon={<TerminalIcon size={13} />} label={t('code.terminal')} />
              <RailTab active={rightTab === 'git'} onClick={() => setRightTab('git')} icon={<GitBranch size={13} />} label={t('code.git')} />
            </div>
            <div className="min-h-0 flex-1">
              {rightTab === 'agent' ? <AgentPanel /> : null}
              {rightTab === 'changes' ? <ChangesPanel /> : null}
              {rightTab === 'tasks' ? <TasksPanel /> : null}
              {rightTab === 'terminal' ? <TerminalPanel /> : null}
              {rightTab === 'git' ? <GitPanel /> : null}
            </div>
          </aside>
        ) : null}
      </div>

      {/* ---------------------------------------------------------- dialogs */}
      <Modal
        open={newFileOpen}
        onClose={() => setNewFileOpen(false)}
        title={t('code.newFile')}
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewFileOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!newFilePath.trim()}
              onClick={async () => {
                await createFile(newFilePath.trim().replace(/^\/+/, ''), '');
                setNewFileOpen(false);
              }}
            >
              {t('code.create')}
            </Button>
          </>
        }
      >
        <Field label={t('code.newFile')} hint="src/lib/util.ts" htmlFor="new-file-path">
          <TextInput
            id="new-file-path"
            autoFocus
            value={newFilePath}
            dir="ltr"
            className="font-mono"
            onChange={(e) => setNewFilePath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newFilePath.trim()) {
                void createFile(newFilePath.trim().replace(/^\/+/, ''), '');
                setNewFileOpen(false);
              }
            }}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={deletingPath !== null}
        title={t('code.deleteFile')}
        body={deletingPath ?? ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeletingPath(null)}
        onConfirm={async () => {
          if (deletingPath) {
            await deleteFile(deletingPath);
            toast({ kind: 'info', message: deletingPath });
          }
          setDeletingPath(null);
        }}
      />
    </div>
  );
}

function RailTab({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[11.5px] transition-colors',
        active ? 'border-accent text-text' : 'border-transparent text-dim hover:text-muted',
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
      {count ? (
        <span className={cn('rounded-full px-1.5 py-px text-[10px] font-semibold', active ? 'bg-accent/20 text-accent' : 'bg-elevated text-dim')}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

export { CodePage as default };
