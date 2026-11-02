import { useEffect, useState } from 'react';
import {
  Puzzle,
  GitBranch,
  Globe,
  Layout,
  Network,
  Calculator,
  Video,
  Terminal,
  ShieldCheck,
  Palette,
  Gamepad2,
  Check,
  X,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { api, describeApiError } from '@/lib/api';
import { useAppStore } from '@/store/app';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import type { NovaSkill } from '@nova/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  activeSkillIds: string[];
  onToggleActiveSkill: (id: string) => void;
}

const ICON_MAP: Record<string, React.ElementType> = {
  GitBranch,
  Globe,
  Layout,
  Network,
  Calculator,
  Video,
  Terminal,
  ShieldCheck,
  Palette,
  Gamepad2,
  Puzzle,
};

export function SkillsModal({ open, onClose, activeSkillIds, onToggleActiveSkill }: Props) {
  const { locale } = useI18n();
  const isAr = locale === 'ar';
  const toast = useAppStore((s) => s.toast);

  const [skills, setSkills] = useState<NovaSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [githubUrl, setGithubUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'developer' | 'research' | 'analysis' | 'specialized'>('all');

  const fetchSkills = async () => {
    try {
      const res = await api.listSkills();
      setSkills(res.skills);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setLoading(true);
      void fetchSkills();
    }
  }, [open]);

  if (!open) return null;

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubUrl.trim()) return;

    setImporting(true);
    try {
      const res = await api.importGitHubSkill(githubUrl.trim());
      toast({ kind: 'success', message: res.message || (isAr ? 'تم استيراد المهارة بنجاح!' : 'Skill imported successfully!') });
      setGithubUrl('');
      await fetchSkills();
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setImporting(false);
    }
  };

  const filteredSkills = skills.filter((s) => {
    const matchesCategory = categoryFilter === 'all' || s.category === categoryFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.nameAr.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.descriptionAr.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div
        className="relative flex flex-col w-full max-w-4xl max-h-[90vh] rounded-2xl border border-line bg-[#0d1117] shadow-2xl overflow-hidden"
        dir={isAr ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4 bg-surface">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/25">
              <Puzzle size={20} />
            </div>
            <div>
              <h2 className="text-[15px] sm:text-[16px] font-semibold text-text flex items-center gap-2">
                <span>{isAr ? 'متجر المهارات والإضافات الذكية (Skills & MCP Hub)' : 'Skills & MCP Hub'}</span>
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10.5px] font-medium text-accent">
                  $0 Free & Unlimited
                </span>
              </h2>
              <p className="text-[11.5px] text-muted">
                {isAr
                  ? 'اختر مهارات الذكاء الاصطناعي الموجهة لكل استفسار دون استهلاك نافذة السياق، أو ثبت أي مهارة من GitHub مباشرة.'
                  : 'Modular zero-cost tools and personas. Injected dynamically only when needed to prevent context overflow.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-dim transition-colors hover:bg-panel hover:text-text"
          >
            <X size={18} />
          </button>
        </div>

        {/* GitHub Import Bar */}
        <div className="border-b border-line bg-panel/60 p-4">
          <form onSubmit={handleImport} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <input
                type="url"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder={
                  isAr
                    ? 'الصق أي رابط لمستودع GitHub أو ملف SKILL.md لاستيراد المهارة فوراً (مثال: https://github.com/owner/repo)'
                    : 'Paste any GitHub repository URL or raw SKILL.md file to import...'
                }
                className="w-full rounded-xl border border-line bg-[#090d13] px-3.5 py-2 text-[12.5px] text-text placeholder:text-dim focus:border-accent focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={importing || !githubUrl.trim()}
              className="btn btn-primary inline-flex shrink-0 items-center justify-center gap-1.5 !px-4 !py-2 text-[12.5px] disabled:opacity-50"
            >
              {importing ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={14} />}
              <span>{isAr ? 'تثبيت من GitHub' : 'Install from GitHub'}</span>
            </button>
          </form>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-line px-5 py-2.5 bg-surface/50 text-[12px]">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto">
            {(
              [
                { id: 'all', label: isAr ? 'الكل' : 'All' },
                { id: 'developer', label: isAr ? 'مطورين وأكواد' : 'Developer' },
                { id: 'research', label: isAr ? 'بحث وتوثيق' : 'Research' },
                { id: 'analysis', label: isAr ? 'تحليل وبيانات' : 'Analysis' },
                { id: 'specialized', label: isAr ? 'خبراء متخصصون' : 'Specialized' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={cn(
                  'rounded-lg px-2.5 py-1 transition-colors whitespace-nowrap text-[11.5px]',
                  categoryFilter === cat.id
                    ? 'bg-accent/20 font-medium text-accent border border-accent/30'
                    : 'text-muted hover:bg-panel hover:text-text',
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute inset-y-0 start-2.5 my-auto text-dim" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'بحث في المهارات...' : 'Search skills...'}
              className="w-full rounded-lg border border-line bg-[#090d13] ps-8 pe-3 py-1 text-[11.5px] text-text placeholder:text-dim focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Skills Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-dim text-[13px]">
              <RefreshCw size={18} className="animate-spin me-2 text-accent" />
              <span>{isAr ? 'جارِ تحميل المهارات والإضافات...' : 'Loading skills catalog...'}</span>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-dim text-[13px] text-center">
              <Puzzle size={28} className="mb-2 text-dim/60" />
              <p>{isAr ? 'لا توجد مهارات مطابقة لبحثك.' : 'No skills found matching your filter.'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredSkills.map((s) => {
                const IconComponent = ICON_MAP[s.icon] || Puzzle;
                const isActive = activeSkillIds.includes(s.id);

                return (
                  <div
                    key={s.id}
                    className={cn(
                      'group relative flex flex-col justify-between rounded-xl border p-4 transition-all',
                      isActive
                        ? 'border-accent/50 bg-[#121924] shadow-[0_0_15px_rgba(56,189,248,0.06)]'
                        : 'border-line bg-surface/80 hover:border-line-strong hover:bg-surface',
                    )}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                              isActive
                                ? 'border-accent/40 bg-accent/20 text-accent'
                                : 'border-line bg-panel text-muted group-hover:text-text',
                            )}
                          >
                            <IconComponent size={18} />
                          </div>
                          <div>
                            <h3 className="text-[13px] font-semibold text-text leading-tight">
                              {isAr ? s.nameAr || s.name : s.name}
                            </h3>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px] text-dim">
                              <span>{s.author || 'Community'}</span>
                              <span>•</span>
                              <span>v{s.version || '1.0'}</span>
                              {s.isCustom ? (
                                <span className="rounded bg-sky-500/20 px-1 text-[9.5px] font-medium text-sky-400">
                                  GitHub
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* Toggle active button */}
                        <button
                          type="button"
                          onClick={() => onToggleActiveSkill(s.id)}
                          className={cn(
                            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                            isActive ? 'bg-accent' : 'bg-line-strong',
                          )}
                        >
                          <span
                            className={cn(
                              'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                              isActive ? (isAr ? '-translate-x-4' : 'translate-x-4') : 'translate-x-0',
                            )}
                          />
                        </button>
                      </div>

                      <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted line-clamp-2">
                        {isAr ? s.descriptionAr || s.description : s.description}
                      </p>
                    </div>

                    <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2.5">
                      <div className="flex flex-wrap gap-1">
                        {s.tools?.map((tool) => (
                          <span
                            key={tool}
                            className="rounded bg-panel border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-dim"
                          >
                            ⚒ {tool}
                          </span>
                        ))}
                      </div>

                      {s.githubUrl ? (
                        <a
                          href={s.githubUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-[10.5px] text-accent hover:underline"
                        >
                          <ExternalLink size={10} />
                          <span>GitHub</span>
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-surface px-5 py-3 text-[11.5px] text-dim">
          <div className="flex items-center gap-1.5">
            <Sparkles size={13} className="text-accent" />
            <span>
              {isAr
                ? `المهارات النشطة: ${activeSkillIds.length === 0 ? 'تلقائي (توجيه ذاتي حسب السؤال)' : `${activeSkillIds.length} مهارة محددة`}`
                : `Active Skills: ${activeSkillIds.length === 0 ? 'Auto-Detect (per question)' : `${activeSkillIds.length} selected`}`}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn btn-outline !px-3.5 !py-1 text-[12px]"
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
