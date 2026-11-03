import { useEffect, useMemo, useState } from 'react';
import {
  Code2, Crown, FolderKanban, Globe, LogOut, MessageSquare, PanelLeft, PanelLeftClose, Pencil, Plus,
  Settings, Trash2, Sparkles, Bot, ShieldCheck, X, BookOpen, Paperclip, Search, MoreHorizontal, Wrench, ChevronRight,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import { useCodeStore } from '@/store/code';
import { NovaLogo } from '@/components/ui/NovaLogo';
import { LibraryModal } from '@/components/library/LibraryModal';
import { FilesModal } from '@/components/files/FilesModal';
import { SkillsModal } from '@/components/skills/SkillsModal';
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
  const setLocale = useAppStore((s) => s.setLocale);
  const authUser = useAppStore((s) => s.authUser);
  const logout = useAppStore((s) => s.logout);
  const newConversation = useChatStore((s) => s.newConversation);
  const isAr = locale === 'ar';

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const isMobile = useMediaQuery('(max-width: 859px)');
  const isCollapsedDesktop = !isMobile && collapsed;

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
          'flex h-full flex-col border-e border-[#142852] bg-[#071A3D] text-[#E8EEF9] transition-all duration-200 select-none',
          isMobile
            ? 'animate-in fixed inset-y-0 start-0 z-50 w-[min(300px,86vw)] shadow-2xl pb-safe'
            : isCollapsedDesktop
              ? 'w-[64px] shrink-0'
              : 'w-[272px] shrink-0',
        )}
      >
        {/* Brand Header */}
        <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#142852] px-3.5">
          {isCollapsedDesktop ? (
            <div className="mx-auto">
              <NovaLogo size="sm" variant="icon" />
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <NovaLogo size="sm" variant="full" theme="dark" />
            </div>
          )}

          <div className="flex items-center gap-1">
            {isMobile ? (
              <IconButton
                label={t('common.close')}
                onClick={() => setMobileOpen(false)}
                className="text-[#95A6C4] hover:bg-[#102652] hover:text-white"
              >
                <X size={17} />
              </IconButton>
            ) : (
              <IconButton
                label={collapsed ? t('nav.expand') : t('nav.collapse')}
                onClick={toggle}
                className={cn('text-[#95A6C4] hover:bg-[#102652] hover:text-white', collapsed && 'mx-auto')}
              >
                {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
              </IconButton>
            )}
          </div>
        </div>

        {/* Primary Action Button: New Chat */}
        <div className="p-3">
          <button
            type="button"
            onClick={() => {
              void newConversation();
              setView('chat');
              setMobileOpen(false);
            }}
            className={cn(
              'flex items-center justify-center gap-2 rounded-xl bg-[#1769FF] font-semibold text-white shadow-[0_4px_16px_rgba(23,105,255,0.35)] transition-all hover:bg-[#1255D4] hover:shadow-[0_6px_20px_rgba(23,105,255,0.45)] active:scale-[0.98]',
              isCollapsedDesktop ? 'h-10 w-10 p-0 mx-auto' : 'w-full py-2.5 px-3.5 text-[13px]',
            )}
            title={t('nav.newChat')}
          >
            <Plus size={17} className="shrink-0" />
            {!isCollapsedDesktop && <span>{isAr ? 'محادثة جديدة +' : 'New Conversation +'}</span>}
          </button>
        </div>

        {/* Main Navigation Items */}
        <nav className="flex flex-col gap-1 px-2.5 py-1">
          {/* Home / Chat */}
          <NavButton
            active={view === 'chat'}
            collapsed={isCollapsedDesktop}
            icon={<MessageSquare size={16} />}
            label={isAr ? 'الصفحة الرئيسية' : 'Home'}
            ariaLabel={isAr ? 'الصفحة الرئيسية - المحادثة' : 'Home - Chat'}
            onClick={() => {
              setView('chat');
              setMobileOpen(false);
            }}
          />

          {/* Library */}
          <NavButton
            active={false}
            collapsed={isCollapsedDesktop}
            icon={<BookOpen size={16} />}
            label={isAr ? 'المكتبة' : 'Library'}
            ariaLabel={isAr ? 'المكتبة والقوالب' : 'Library & Prompts'}
            onClick={() => {
              setLibraryOpen(true);
              setMobileOpen(false);
            }}
          />

          {/* Projects / Coding */}
          <NavButton
            active={view === 'code'}
            collapsed={isCollapsedDesktop}
            icon={<FolderKanban size={16} />}
            label={isAr ? 'المشاريع' : 'Projects'}
            ariaLabel={isAr ? 'المشاريع - البرمجة' : 'Projects - Coding'}
            onClick={() => {
              setView('code');
              setMobileOpen(false);
            }}
          />

          {/* Files with active indicator dot */}
          <NavButton
            active={false}
            collapsed={isCollapsedDesktop}
            icon={<Paperclip size={16} />}
            label={isAr ? 'الملفات' : 'Files'}
            ariaLabel={isAr ? 'الملفات والمرفقات' : 'Files & Storage'}
            badgeDot
            onClick={() => {
              setFilesOpen(true);
              setMobileOpen(false);
            }}
          />

          {/* AI Tools & Skills Store */}
          <NavButton
            active={false}
            collapsed={isCollapsedDesktop}
            icon={<Sparkles size={16} />}
            label={isAr ? 'الأدوات والمهارات' : 'AI Tools'}
            ariaLabel={isAr ? 'متجر الأدوات والمهارات' : 'AI Tools & Skills Store'}
            onClick={() => {
              setToolsOpen(true);
              setMobileOpen(false);
            }}
          />

          {/* Owner Studio Button */}
          {authUser?.role === 'owner' && (
            <NavButton
              active={view === 'studio'}
              collapsed={isCollapsedDesktop}
              icon={<Crown size={16} className="text-amber-400" />}
              label={isAr ? 'مركز القيادة (Studio)' : 'NOVA Studio'}
              ariaLabel={isAr ? 'مركز القيادة والمراقبة' : 'NOVA Command Studio'}
              onClick={() => {
                setView('studio');
                setMobileOpen(false);
              }}
              className="text-amber-300 hover:bg-amber-500/15"
            />
          )}
        </nav>

        {/* Separator */}
        <div className="mx-3.5 my-2 h-px bg-[#142852]" />

        {/* Contextual Section: Recent Conversations / Projects */}
        <div className="scroll-thin min-h-0 flex-1 px-1">
          {view === 'chat' ? (
            <ConversationList collapsed={isCollapsedDesktop} onSelect={() => setMobileOpen(false)} />
          ) : (
            <ProjectList collapsed={isCollapsedDesktop} onSelect={() => setMobileOpen(false)} />
          )}
        </div>

        {/* User Footer Profile & Plan Card */}
        <div className="border-t border-[#142852] p-2.5">
          {!isCollapsedDesktop ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0B1F46] p-2 border border-[#142852]">
              <button
                type="button"
                onClick={() => {
                  openSettings(true, 'account');
                  setMobileOpen(false);
                }}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-start hover:opacity-90 transition-opacity"
              >
                {/* Avatar with initial */}
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#1769FF] font-bold text-white text-[13px] shadow-sm">
                  {authUser?.displayName?.slice(0, 1)?.toUpperCase() || 'Y'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-bold text-white leading-tight">
                    {authUser?.displayName || 'Yousif Alhooti'}
                  </p>
                  <p className="truncate text-[10px] text-[#95A6C4] font-medium leading-tight mt-0.5">
                    {authUser?.role === 'owner' ? (
                      <span className="text-amber-300 font-semibold">👑 الخطة: غير محدود</span>
                    ) : (
                      <span>الخطة: Free</span>
                    )}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-0.5 shrink-0">
                <IconButton
                  label={t('settings.language')}
                  onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
                  className="text-[#95A6C4] hover:bg-[#102652] hover:text-white"
                >
                  <Globe size={15} />
                </IconButton>

                <IconButton
                  label={t('nav.settings')}
                  onClick={() => {
                    openSettings(true);
                    setMobileOpen(false);
                  }}
                  className="text-[#95A6C4] hover:bg-[#102652] hover:text-white"
                >
                  <Settings size={15} />
                </IconButton>

                {authUser && (
                  <IconButton
                    label={isAr ? 'تسجيل الخروج' : 'Sign Out'}
                    onClick={() => void logout()}
                    className="text-[#95A6C4] hover:bg-danger/20 hover:text-danger"
                  >
                    <LogOut size={14} />
                  </IconButton>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  openSettings(true, 'account');
                  setMobileOpen(false);
                }}
                className="grid h-8 w-8 place-items-center rounded-xl bg-[#1769FF] font-bold text-white text-[12px]"
                title={authUser?.displayName || 'Account'}
              >
                {authUser?.displayName?.slice(0, 1)?.toUpperCase() || 'Y'}
              </button>
              <IconButton
                label={t('settings.language')}
                onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
                className="text-[#95A6C4] hover:bg-[#102652] hover:text-white"
              >
                <Globe size={15} />
              </IconButton>
              <IconButton
                label={t('nav.settings')}
                onClick={() => {
                  openSettings(true);
                  setMobileOpen(false);
                }}
                className="text-[#95A6C4] hover:bg-[#102652] hover:text-white"
              >
                <Settings size={15} />
              </IconButton>
            </div>
          )}
        </div>
      </aside>

      {/* Library Modal */}
      <LibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />

      {/* Files Modal */}
      <FilesModal open={filesOpen} onClose={() => setFilesOpen(false)} />

      {/* AI Tools & Skills Modal */}
      <SkillsModal
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        activeSkillIds={[]}
        onToggleActiveSkill={() => {}}
      />
    </>
  );
}

/* ------------------------------------------------------------- NavButton */

function NavButton({
  active,
  collapsed,
  icon,
  label,
  ariaLabel,
  badgeDot,
  onClick,
  className,
}: {
  active: boolean;
  collapsed: boolean;
  icon: React.ReactNode;
  label: string;
  ariaLabel?: string;
  badgeDot?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={ariaLabel || label}
      aria-label={ariaLabel || label}
      className={cn(
        'group flex items-center gap-3 rounded-xl transition-all duration-150 text-start',
        collapsed ? 'h-9 w-9 justify-center mx-auto p-0' : 'w-full px-3 py-2 text-[12.5px] font-medium',
        active
          ? 'bg-[#1769FF] font-semibold text-white shadow-sm'
          : 'text-[#95A6C4] hover:bg-[#0B1F46] hover:text-white',
        className,
      )}
    >
      <span className={cn('shrink-0 transition-transform duration-150', active ? 'text-white' : 'text-[#8297BA] group-hover:text-white')}>
        {icon}
      </span>
      {!collapsed && (
        <span className="truncate flex-1">{label}</span>
      )}
      {!collapsed && badgeDot && (
        <span className="h-2 w-2 rounded-full bg-[#1769FF] shadow-[0_0_8px_#1769FF]" />
      )}
    </button>
  );
}

/* --------------------------------------------------------- conversations */

function ConversationList({ collapsed, onSelect }: { collapsed: boolean; onSelect?: () => void }) {
  const { t, locale } = useI18n();
  const isAr = locale === 'ar';
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const openConversation = useChatStore((s) => s.openConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase().trim();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  if (collapsed) {
    return null;
  }

  const target = conversations.find((c) => c.id === deleting);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2 text-[#95A6C4]">
        <span className="text-[11px] font-semibold tracking-wider">
          {isAr ? 'المحادثات الأخيرة' : 'Recent Chats'}
        </span>
        <button
          type="button"
          onClick={() => setShowSearch((v) => !v)}
          className="p-1 rounded-md hover:bg-[#102652] hover:text-white transition-colors"
          title={isAr ? 'بحث في المحادثات' : 'Search chats'}
        >
          <Search size={13} />
        </button>
      </div>

      {showSearch && (
        <div className="px-2 pb-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? 'ابحث في المحادثات...' : 'Filter conversations...'}
            className="w-full rounded-lg bg-[#0B1F46] border border-[#142852] px-2.5 py-1 text-[11px] text-white outline-none placeholder:text-[#6B7E9F] focus:border-[#1769FF]"
            autoFocus
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="px-3 py-3 text-[11px] leading-relaxed text-[#6B7E9F]">
          {search ? (isAr ? 'لا توجد نتائج' : 'No matches found') : t('nav.noConversations')}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 px-2 pb-2">
          {filtered.slice(0, 30).map((c) => {
            const active = c.id === activeId;
            return (
              <li key={c.id}>
                <div
                  className={cn(
                    'group flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-start transition-all',
                    active
                      ? 'bg-[#0B1F46] border border-[#1769FF]/40 text-white font-medium'
                      : 'hover:bg-[#0B1F46]/70 text-[#95A6C4] hover:text-white',
                  )}
                >
                  <MessageSquare size={13} className={cn('shrink-0', active ? 'text-[#1769FF]' : 'text-[#6B7E9F]')} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-[11.5px] text-start"
                    onClick={() => {
                      void openConversation(c.id);
                      onSelect?.();
                    }}
                    title={c.title}
                  >
                    {c.title}
                  </button>

                  <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => {
                        setRenaming(c.id);
                        setRenameValue(c.title);
                      }}
                      className="p-1 rounded text-[#95A6C4] hover:text-white"
                      title={t('common.rename')}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(c.id)}
                      className="p-1 rounded text-[#95A6C4] hover:text-danger"
                      title={t('common.delete')}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Rename Modal */}
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
              disabled={!renameValue.trim()}
              onClick={() => {
                if (renaming && renameValue.trim()) {
                  void renameConversation(renaming, renameValue.trim());
                  setRenaming(null);
                }
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

      {/* Delete Confirmation */}
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
  const { t, locale } = useI18n();
  const isAr = locale === 'ar';
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
          className="w-full text-[#95A6C4] hover:bg-[#102652] hover:text-white"
        >
          <Plus size={16} />
        </IconButton>
      </div>
    );
  }

  const target = projects.find((p) => p.id === deleting);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3 text-[#95A6C4]">
        <span className="text-[11px] font-semibold tracking-wider">
          {isAr ? 'مشاريع الأكواد' : 'Code Projects'}
        </span>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            onSelect?.();
          }}
          className="p-1 rounded-md hover:bg-[#102652] hover:text-white transition-colors"
          title={t('code.newProject')}
        >
          <Plus size={14} />
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="px-3 py-3 text-[11px] leading-relaxed text-[#6B7E9F]">{t('nav.noProjects')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 px-2 pb-2">
          {projects.map((p) => {
            const active = p.id === activeProjectId;
            return (
              <li key={p.id}>
                <div
                  className={cn(
                    'group flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-colors',
                    active ? 'bg-[#0B1F46] border border-[#1769FF]/40 text-white' : 'hover:bg-[#0B1F46]/70 text-[#95A6C4] hover:text-white',
                  )}
                >
                  <FolderKanban size={13} className={cn('shrink-0', active ? 'text-[#1769FF]' : 'text-[#6B7E9F]')} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-start"
                    onClick={() => {
                      void selectProject(p.id);
                      onSelect?.();
                    }}
                  >
                    <span className={cn('block truncate text-[11.5px]', active ? 'text-white font-medium' : 'text-[#95A6C4]')}>
                      {p.name}
                    </span>
                    <span className="block truncate text-[10px] text-[#6B7E9F]">
                      {p.stats ? `${p.stats.files} ${t('code.files').toLowerCase()}` : p.language || '—'}
                      {p.stats?.pendingChanges ? ` · ${p.stats.pendingChanges} ${t('changes.pending')}` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(p.id)}
                    className="p-1 text-[#6B7E9F] hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t('common.delete')}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* New Project Modal */}
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
