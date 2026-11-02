import { useEffect, useMemo, useState } from 'react';
import {
  Code2, Crown, FolderKanban, Globe, LogOut, MessageSquare, PanelLeft, PanelLeftClose, Pencil, Plus,
  Settings, Trash2, Sparkles, Bot, ShieldCheck, X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import { useCodeStore } from '@/store/code';
import { Badge, Button, ConfirmDialog, IconButton, Modal, TextInput, Field, Dot } from '@/components/ui';

export function Sidebar() {
  const { t, locale } = useI18n();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const mobileOpen = useAppStore((s) => s.mobileSidebarOpen);
  const setMobileOpen = useAppStore((s) => s.setMobileSidebarOpen);
  const openSettings = useAppStore((s) => s.openSettings);
  const health = useAppStore((s) => s.health);
  const offline = useAppStore((s) => s.offline);
  const setLocale = useAppStore((s) => s.setLocale);
  const authUser = useAppStore((s) => s.authUser);
  const logout = useAppStore((s) => s.logout);
  const isAr = locale === 'ar';

  const isMobile = useMediaQuery('(max-width: 859px)');
  const isCollapsedDesktop = !isMobile && collapsed;

  const readyProviders = useMemo(
    () => (health?.providers ?? []).filter((p) => p.status === 'ready'),
    [health],
  );

  // On mobile phones (< 860px), do not mount the sidebar at all unless opened as a drawer.
  // This guarantees zero flex width consumption and zero RTL/LTR CSS translate bugs.
  if (isMobile && !mobileOpen) {
    return null;
  }

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobile ? (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-[2px] animate-in"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          'flex h-full flex-col border-e border-line bg-surface transition-all duration-200',
          isMobile
            ? 'animate-in fixed inset-y-0 start-0 z-50 w-[min(290px,84vw)] shadow-2xl pb-safe'
            : isCollapsedDesktop
              ? 'w-[58px] shrink-0'
              : 'w-[262px] shrink-0',
        )}
      >
        {/* Brand */}
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <Sparkles size={15} />
          </div>
          {!isCollapsedDesktop && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-tight">NOVA</p>
              <p className="truncate text-[10.5px] leading-tight text-dim">AI Cloud</p>
            </div>
          )}
          <div className="ms-auto flex items-center">
            {isMobile ? (
              <IconButton
                label={t('common.close')}
                onClick={() => setMobileOpen(false)}
              >
                <X size={17} />
              </IconButton>
            ) : (
              <IconButton
                label={collapsed ? t('nav.expand') : t('nav.collapse')}
                onClick={toggle}
                className={cn(collapsed && 'mx-auto')}
              >
                {collapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
              </IconButton>
            )}
          </div>
        </div>

        {/* Primary nav */}
        <nav className="flex flex-col gap-1 p-2">
          <NavItem
            active={view === 'chat'}
            collapsed={isCollapsedDesktop}
            icon={<MessageSquare size={16} />}
            label={t('nav.chat')}
            onClick={() => {
              setView('chat');
              setMobileOpen(false);
            }}
          />
          <NavItem
            active={view === 'code'}
            collapsed={isCollapsedDesktop}
            icon={<Code2 size={16} />}
            label={t('nav.code')}
            onClick={() => {
              setView('code');
              setMobileOpen(false);
            }}
          />
        </nav>

        <div className="mx-3 h-px bg-line" />

        {/* Contextual list */}
        <div className="scroll-thin min-h-0 flex-1">
          {view === 'chat' ? (
            <ConversationList collapsed={isCollapsedDesktop} onSelect={() => setMobileOpen(false)} />
          ) : (
            <ProjectList collapsed={isCollapsedDesktop} onSelect={() => setMobileOpen(false)} />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-line p-2">
          {authUser && !isCollapsedDesktop ? (
            <div className="mb-2 rounded-xl border border-line bg-bg/60 p-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    openSettings(true, 'account');
                    setMobileOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-start"
                  title={isAr ? 'حسابي والأمان' : 'Account & Security'}
                >
                  <div
                    className={cn(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold',
                      authUser.role === 'owner'
                        ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/35'
                        : 'bg-accent/15 text-accent',
                    )}
                  >
                    {authUser.role === 'owner' ? <Crown size={14} /> : authUser.displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-text">{authUser.displayName}</p>
                    <p className="truncate text-[10px] text-dim">{authUser.email}</p>
                  </div>
                </button>
                <IconButton
                  label={isAr ? 'تسجيل الخروج' : 'Sign Out'}
                  onClick={() => void logout()}
                  className="shrink-0 text-dim hover:text-danger"
                >
                  <LogOut size={13} />
                </IconButton>
              </div>

              {authUser.role === 'owner' ? (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-[10.5px] font-medium text-amber-300">
                  <span>{isAr ? '👑 حساب المالك' : '👑 Owner Account'}</span>
                  <span>{isAr ? 'غير محدود (∞)' : 'Unlimited (∞)'}</span>
                </div>
              ) : (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between text-[10.5px]">
                    <span className="text-muted">{isAr ? 'الاستهلاك اليومي' : 'Daily Quota'}</span>
                    <span
                      className={cn(
                        'font-mono font-semibold',
                        authUser.quota.locked ? 'text-danger' : 'text-text',
                      )}
                    >
                      {authUser.quota.used} / {authUser.quota.limit}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-300',
                        authUser.quota.locked
                          ? 'bg-danger'
                          : authUser.quota.used / Math.max(1, authUser.quota.limit) >= 0.8
                            ? 'bg-amber-400'
                            : 'bg-emerald-400',
                      )}
                      style={{
                        width: `${Math.min(100, Math.round((authUser.quota.used / Math.max(1, authUser.quota.limit)) * 100))}%`,
                      }}
                    />
                  </div>
                  {authUser.quota.locked ? (
                    <p className="mt-1.5 text-[10px] leading-snug text-danger">
                      {isAr
                        ? `⛔ خلاص ما فيه رصيد — يتجدد بعد أسبوع (${authUser.quota.lockedUntil?.slice(0, 10) ?? ''})`
                        : `⛔ Limit reached — renews in 1 week (${authUser.quota.lockedUntil?.slice(0, 10) ?? ''})`}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {!isCollapsedDesktop && authUser?.role === 'owner' && (
            <button
              type="button"
              onClick={() => {
                setView('studio');
                setMobileOpen(false);
              }}
              className="card-hover mb-1.5 flex w-full items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-start text-amber-300 transition-colors hover:bg-amber-500/20"
              title="NOVA Studio — مركز القيادة والمراقبة"
            >
              <Crown size={14} className="shrink-0 text-amber-400" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                {isAr ? '👑 مركز القيادة (Studio)' : '👑 NOVA Studio'}
              </span>
            </button>
          )}
          <div className={cn('flex items-center gap-1', isCollapsedDesktop && 'flex-col')}>
            {authUser?.role === 'owner' && isCollapsedDesktop ? (
              <IconButton
                label={isAr ? 'مركز القيادة (Studio)' : 'NOVA Studio'}
                onClick={() => {
                  setView('studio');
                  setMobileOpen(false);
                }}
                className="w-full text-amber-400 hover:text-amber-300"
              >
                <Crown size={15} />
              </IconButton>
            ) : null}
            <IconButton
              label={t('nav.settings')}
              onClick={() => {
                openSettings(true);
                setMobileOpen(false);
              }}
              className={cn(isCollapsedDesktop && 'w-full')}
            >
              <Settings size={15} />
            </IconButton>
            {authUser ? (
              <IconButton
                label={isAr ? 'حسابي والأمان' : 'Account & Security'}
                onClick={() => {
                  openSettings(true, 'account');
                  setMobileOpen(false);
                }}
                className={cn(isCollapsedDesktop && 'w-full')}
              >
                <ShieldCheck size={15} />
              </IconButton>
            ) : null}
            <IconButton
              label={t('settings.language')}
              onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
              className={cn(isCollapsedDesktop && 'w-full')}
            >
              <Globe size={15} />
            </IconButton>
            {authUser && isCollapsedDesktop ? (
              <IconButton
                label={isAr ? 'تسجيل الخروج' : 'Sign Out'}
                onClick={() => void logout()}
                className="w-full text-dim hover:text-danger"
              >
                <LogOut size={15} />
              </IconButton>
            ) : null}
            {!isCollapsedDesktop && (
              <span className="ms-auto rounded-md border border-line-strong bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-dim">
                {locale.toUpperCase()}
              </span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function NavItem({ active, collapsed, icon, label, onClick }: { active: boolean; collapsed: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
        active ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-elevated hover:text-text',
        collapsed && 'justify-center px-0',
      )}
    >
      <span className={cn(active && 'text-accent')}>{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {active && !collapsed && <span className="ms-auto h-1.5 w-1.5 rounded-full bg-accent" />}
    </button>
  );
}

/* --------------------------------------------------------- conversations */

function ConversationList({ collapsed, onSelect }: { collapsed: boolean; onSelect?: () => void }) {
  const { t, locale } = useI18n();
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const openConversation = useChatStore((s) => s.openConversation);
  const newConversation = useChatStore((s) => s.newConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loading = useChatStore((s) => s.loadingList);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  if (collapsed) {
    return (
      <div className="p-2">
        <IconButton
          label={t('nav.newChat')}
          onClick={() => {
            void newConversation();
            onSelect?.();
          }}
          className="w-full"
        >
          <Plus size={16} />
        </IconButton>
      </div>
    );
  }

  const target = conversations.find((c) => c.id === deleting);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-dim">{t('nav.conversations')}</span>
        <IconButton
          label={t('nav.newChat')}
          onClick={() => {
            void newConversation();
            onSelect?.();
          }}
        >
          <Plus size={14} />
        </IconButton>
      </div>

      {loading && conversations.length === 0 ? (
        <div className="space-y-1.5 px-2 py-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-8 rounded-lg" />
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <p className="px-3 py-3 text-[11.5px] leading-relaxed text-dim">{t('nav.noConversations')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 px-2 pb-2">
          {conversations.map((c) => (
            <li key={c.id}>
              <div
                className={cn(
                  'group flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors',
                  c.id === activeId ? 'bg-elevated' : 'hover:bg-elevated/60',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-start"
                  onClick={() => {
                    void openConversation(c.id);
                    onSelect?.();
                  }}
                >
                  <span className={cn('block truncate text-[12.5px]', c.id === activeId ? 'text-text' : 'text-muted')}>
                    {c.title || t('nav.newChat')}
                  </span>
                  <span className="block truncate text-[10.5px] text-dim">
                    {relativeTime(c.updatedAt, locale)}
                    {c.messageCount ? ` · ${c.messageCount}` : ''}
                  </span>
                </button>
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-0.5 transition-opacity focus-within:opacity-100',
                    c.id === activeId ? 'opacity-100 md:opacity-0 md:group-hover:opacity-100' : 'opacity-65 md:opacity-0 md:group-hover:opacity-100',
                  )}
                >
                  <IconButton
                    label={t('common.rename')}
                    className="!px-1 !py-1"
                    onClick={() => {
                      setRenaming(c.id);
                      setRenameValue(c.title);
                    }}
                  >
                    <Pencil size={12} />
                  </IconButton>
                  <IconButton label={t('common.delete')} className="!px-1 !py-1" onClick={() => setDeleting(c.id)}>
                    <Trash2 size={12} />
                  </IconButton>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={t('chat.renameTitle')}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (renaming && renameValue.trim()) await renameConversation(renaming, renameValue.trim());
                setRenaming(null);
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Field label={t('chat.renameTitle')} htmlFor="conv-title">
          <TextInput
            id="conv-title"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renaming && renameValue.trim()) {
                void renameConversation(renaming, renameValue.trim());
                setRenaming(null);
              }
            }}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={t('chat.deleteTitle')}
        body={target ? `${t('chat.deleteBody')}\n\n“${target.title}”` : t('chat.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteConversation(deleting);
          setDeleting(null);
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- projects */

function ProjectList({ collapsed, onSelect }: { collapsed: boolean; onSelect?: () => void }) {
  const { t } = useI18n();
  const projects = useCodeStore((s) => s.projects);
  const activeProjectId = useCodeStore((s) => s.activeProjectId);
  const loadProjects = useCodeStore((s) => s.loadProjects);
  const selectProject = useCodeStore((s) => s.selectProject);
  const createProject = useCodeStore((s) => s.createProject);
  const deleteProject = useCodeStore((s) => s.deleteProject);
  const toast = useAppStore((s) => s.toast);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  if (collapsed) {
    return (
      <div className="p-2">
        <IconButton
          label={t('code.newProject')}
          onClick={() => {
            setCreating(true);
            onSelect?.();
          }}
          className="w-full"
        >
          <Plus size={16} />
        </IconButton>
      </div>
    );
  }

  const target = projects.find((p) => p.id === deleting);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-dim">{t('nav.projects')}</span>
        <IconButton
          label={t('code.newProject')}
          onClick={() => {
            setCreating(true);
            onSelect?.();
          }}
        >
          <Plus size={14} />
        </IconButton>
      </div>

      {projects.length === 0 ? (
        <p className="px-3 py-3 text-[11.5px] leading-relaxed text-dim">{t('nav.noProjects')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 px-2 pb-2">
          {projects.map((p) => (
            <li key={p.id}>
              <div
                className={cn(
                  'group flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors',
                  p.id === activeProjectId ? 'bg-elevated' : 'hover:bg-elevated/60',
                )}
              >
                <FolderKanban size={14} className={cn('shrink-0', p.id === activeProjectId ? 'text-accent' : 'text-dim')} />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-start"
                  onClick={() => {
                    void selectProject(p.id);
                    onSelect?.();
                  }}
                >
                  <span className={cn('block truncate text-[12.5px]', p.id === activeProjectId ? 'text-text' : 'text-muted')}>
                    {p.name}
                  </span>
                  <span className="block truncate text-[10.5px] text-dim">
                    {p.stats ? `${p.stats.files} ${t('code.files').toLowerCase()}` : p.language || '—'}
                    {p.stats?.pendingChanges ? ` · ${p.stats.pendingChanges} ${t('changes.pending')}` : ''}
                  </span>
                </button>
                <span
                  className={cn(
                    'flex shrink-0 items-center transition-opacity focus-within:opacity-100',
                    p.id === activeProjectId ? 'opacity-100 md:opacity-0 md:group-hover:opacity-100' : 'opacity-65 md:opacity-0 md:group-hover:opacity-100',
                  )}
                >
                  <IconButton label={t('common.delete')} className="!px-1 !py-1" onClick={() => setDeleting(p.id)}>
                    <Trash2 size={12} />
                  </IconButton>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('code.newProject')}
        width={460}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!name.trim()}
              onClick={async () => {
                setBusy(true);
                const project = await createProject(name, description);
                setBusy(false);
                if (project) {
                  setCreating(false);
                  setName('');
                  setDescription('');
                  toast({ kind: 'success', message: project.name });
                }
              }}
            >
              {busy ? t('code.creating') : t('code.create')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('code.projectName')} htmlFor="project-name">
            <TextInput
              id="project-name"
              value={name}
              autoFocus
              placeholder={t('code.projectNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={`${t('settings.about')} — ${t('common.optional')}`} htmlFor="project-desc">
            <TextInput id="project-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface p-2.5">
            <Bot size={14} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-[11.5px] leading-relaxed text-dim">{t('code.noProjectHint')}</p>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={t('code.deleteProject')}
        body={target ? `${t('code.deleteProjectBody')}\n\n“${target.name}”` : t('code.deleteProjectBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteProject(deleting);
          setDeleting(null);
        }}
      />
    </div>
  );
}

/** Small helper used by the code page header to show pending approvals. */
export function PendingBadge({ count }: { count: number }) {
  const { t } = useI18n();
  if (count <= 0) return null;
  return <Badge tone="warning">{count} {t('changes.pending')}</Badge>;
}
