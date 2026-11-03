import { useState } from 'react';
import { BookOpen, Copy, Check, Sparkles, Code2, ShieldAlert, Palette, FileSpreadsheet, GraduationCap, ArrowRight, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useChatStore } from '@/store/chat';
import { useAppStore } from '@/store/app';
import { Badge, Button, Modal, TextInput } from '@/components/ui';

interface PromptTemplate {
  id: string;
  category: 'coding' | 'design' | 'security' | 'data' | 'writing' | 'education';
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  promptAr: string;
  promptEn: string;
  icon: typeof Sparkles;
}

const TEMPLATES: PromptTemplate[] = [
  {
    id: 'architect',
    category: 'coding',
    titleAr: 'مهندس المعماريات البرمجية',
    titleEn: 'Software Architect',
    descAr: 'تصميم بنية تحتية ومخططات برمجية للمشاريع الكبيرة وحلول Clean Architecture',
    descEn: 'Design clean system architectures, database schemas, and microservice topologies',
    promptAr: 'قم بدور مهندس معماري برمجيات أول (Senior Software Architect). سأطرح عليك فكرة مشروعي، وأريدك أن تحدد لي أفضل بنية تحتية، وهيكلة قاعدة البيانات، ومخطط تدفق البيانات (Data Flow) مع معايير الأمان والتوسع (Scalability).',
    promptEn: 'Act as a Senior Software Architect. I will describe a project, and I need you to outline the optimal directory architecture, database schema, data flow, and scalability best practices.',
    icon: Code2,
  },
  {
    id: 'ui-ux',
    category: 'design',
    titleAr: 'مصمم الواجهات وتجربة المستخدم',
    titleEn: 'UI/UX Design Director',
    descAr: 'صياغة إرشادات التصميم، لوحات الألوان، وهندسة تجربة الاستخدام وفق معايير عالمية',
    descEn: 'Generate cohesive design systems, color palettes, and UX component specs',
    promptAr: 'قم بدور خبير تصميم واجهات وتجربة مستخدم (Principal UI/UX Designer). ساعدني في بناء نظام تصميم (Design System) عصري لمنتج رقمي: اقترح لوحة ألوان متناغمة، أحجام الخطوط والمسافات، ومكونات تفاعلية مستوحاة من أفضل التطبيقات العالمية.',
    promptEn: 'Act as a Principal UI/UX Designer. Help me design a modern, cohesive design system with accessible color palettes, typography scales, and intuitive component interactions.',
    icon: Palette,
  },
  {
    id: 'security-auditor',
    category: 'security',
    titleAr: 'مدقق الأمان والثغرات',
    titleEn: 'Security & Vulnerability Auditor',
    descAr: 'فحص الأكواد واكتشاف ثغرات OWASP Top 10 وتأمين الجلسات والبيانات الحساسة',
    descEn: 'Audit code against OWASP Top 10 vulnerabilities, auth flaws, and injection vectors',
    promptAr: 'قم بدور خبير أمن سيبراني (Cybersecurity Auditor). سأشاركك كوداً برمجياً، وأريدك أن تفحصه فحصاً دقيقاً لاكتشاف أي ثغرات أمنية (مثل SQLi, XSS, SSRF, Broken Auth) واقتراح التصحيح الآمن فوراً.',
    promptEn: 'Act as a Senior Application Security Engineer. Audit the following codebase for vulnerabilities, auth flaws, and race conditions, providing safe remediations for each.',
    icon: ShieldAlert,
  },
  {
    id: 'data-analyst',
    category: 'data',
    titleAr: 'محلل البيانات والإحصاء',
    titleEn: 'Data Science & Statistical Analyst',
    descAr: 'تحليل الجداول والأرقام، استنتاج الأنماط، وبناء معادلات رياضية ورسوم بيانية دقيقة',
    descEn: 'Analyze datasets, discover statistical correlations, and model predictive formulas',
    promptAr: 'قم بدور عالم ومحلل بيانات (Senior Data Scientist). ساعدني في تحليل البيانات المرفقة، واستخراج أهم الرؤى (Insights)، ومؤشرات الأداء الأساسية (KPIs) مع معادلات إحصائية واضحة.',
    promptEn: 'Act as a Senior Data Scientist. Analyze data, compute statistical summaries, detect anomalies, and formulate clear insights and predictive conclusions.',
    icon: FileSpreadsheet,
  },
  {
    id: 'academic-tutor',
    category: 'education',
    titleAr: 'المعلم الأكاديمي والبحثي',
    titleEn: 'Academic Research Tutor',
    descAr: 'شرح المفاهيم المعقدة خطوة بخطوة، تلخيص الأوراق العلمية، وتوجيه أطروحات التخرج',
    descEn: 'Explain complex concepts step-by-step, summarize research papers, and review theses',
    promptAr: 'قم بدور أستاذ جامعي وباحث أكاديمي. أريدك أن تشرح لي هذا المفهوم بأسلوب مبسط وتدريجي من الأساسيات حتى المستوى المتقدم، مع ذكر أمثلة واقعية ومراجع علمية موثوقة.',
    promptEn: 'Act as a distinguished university professor. Explain this concept progressively from foundational principles to advanced nuances with rigorous real-world examples.',
    icon: GraduationCap,
  },
];

export function LibraryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const isAr = locale === 'ar';
  const setComposer = useChatStore((s) => s.setComposer);
  const send = useChatStore((s) => s.send);
  const toast = useAppStore((s) => s.toast);

  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!open) return null;

  const filtered = TEMPLATES.filter((t) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      t.titleAr.toLowerCase().includes(q) ||
      t.titleEn.toLowerCase().includes(q) ||
      t.descAr.toLowerCase().includes(q) ||
      t.descEn.toLowerCase().includes(q)
    );
  });

  const handleUsePrompt = (t: PromptTemplate) => {
    const promptText = isAr ? t.promptAr : t.promptEn;
    onClose();
    void send(promptText);
    toast({
      kind: 'success',
      message: isAr ? `تم تفعيل موجه: ${t.titleAr}` : `Applied prompt: ${t.titleEn}`,
    });
  };

  const handleCopyPrompt = (t: PromptTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    const promptText = isAr ? t.promptAr : t.promptEn;
    void navigator.clipboard.writeText(promptText);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({
      kind: 'info',
      message: isAr ? 'تم نسخ نص الموجه للحافظة' : 'Prompt copied to clipboard',
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isAr ? '📚 مكتبة الموجهات والقوالب الذكية' : '📚 Prompt & Template Library'}
      subtitle={
        isAr
          ? 'نماذج موجهات هندسية جاهزة لأفضل النتائج في الأكواد والتصميم والتحليل'
          : 'Curated high-performance prompt templates for architecture, coding, and analysis'
      }
      width={780}
      footer={<Button variant="ghost" onClick={onClose}>{isAr ? 'إغلاق' : 'Close'}</Button>}
    >
      <div className="flex flex-col gap-3">
        {/* Search */}
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isAr ? 'ابحث في مكتبة الموجهات...' : 'Search prompt templates...'}
          className="!py-2 !text-[13px]"
          autoFocus
        />

        {/* List of Templates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[480px] overflow-y-auto scroll-thin pe-1">
          {filtered.map((item) => {
            const Icon = item.icon;
            const isCopied = copiedId === item.id;
            return (
              <div
                key={item.id}
                onClick={() => handleUsePrompt(item)}
                className="nova-card p-3.5 flex flex-col justify-between cursor-pointer group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="grid h-8 w-8 place-items-center rounded-xl bg-accent/10 text-accent group-hover:bg-accent group-hover:text-white transition-colors">
                        <Icon size={16} />
                      </div>
                      <div>
                        <h4 className="text-[13px] font-bold text-text group-hover:text-accent transition-colors">
                          {isAr ? item.titleAr : item.titleEn}
                        </h4>
                        <span className="text-[10px] font-mono uppercase text-dim">
                          {item.category}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleCopyPrompt(item, e)}
                      title={isAr ? 'نسخ الموجه' : 'Copy prompt'}
                      className="text-dim hover:text-accent p-1 rounded-lg hover:bg-elevated transition-colors"
                    >
                      {isCopied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                    </button>
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-muted line-clamp-2">
                    {isAr ? item.descAr : item.descEn}
                  </p>
                </div>

                <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between text-[11px] text-accent font-medium">
                  <span>{isAr ? 'بدء محادثة بهذا القالب' : 'Start with this template'}</span>
                  <ArrowRight size={13} className="rtl:rotate-180 transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
