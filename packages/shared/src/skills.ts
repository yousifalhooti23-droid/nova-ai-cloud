export interface NovaSkill {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  icon: string;
  category: 'developer' | 'research' | 'creative' | 'analysis' | 'specialized';
  systemPrompt?: string;
  tools?: string[];
  isCustom?: boolean;
  githubUrl?: string;
  enabled: boolean;
  version?: string;
  author?: string;
}

export const BUILTIN_SKILLS: NovaSkill[] = [
  {
    id: 'github-explorer',
    name: 'GitHub Explorer & Code Inspector',
    nameAr: 'مستكشف ومحلل كود GitHub',
    description: 'Explore public GitHub repositories, read READMEs, analyze code structure and file trees in real time.',
    descriptionAr: 'استكشاف مستودعات GitHub العامة، قراءة ملفات README وتحليل شجرة الكود والملفات لحظياً.',
    icon: 'GitBranch',
    category: 'developer',
    tools: ['github_search', 'github_repo_inspect', 'web_fetch'],
    enabled: true,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `You have access to GitHub Explorer skills. When asked about open-source projects or GitHub repos, inspect real repository structures, read actual code snippets, and provide authoritative architectural breakdowns.`,
  },
  {
    id: 'live-web-search',
    name: 'Live Web Grounding & Deep Scraper',
    nameAr: 'البحث الحي والتوثيق العميق من الويب',
    description: 'Real-time web search and deep markdown extraction using DuckDuckGo and Jina Reader with zero API keys.',
    descriptionAr: 'بحث حي في الويب واستخراج عميق للنصوص بصيغة Markdown عبر DuckDuckGo وJina Reader بدون أي مفاتيح مدفوعة.',
    icon: 'Globe',
    category: 'research',
    tools: ['web_search', 'web_fetch'],
    enabled: true,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `Always ground real-time facts, current dates, and breaking tech news using live web search results. Cite sources cleanly as clickable markdown links.`,
  },
  {
    id: 'code-canvas',
    name: 'Interactive Code Canvas & Sandbox (Artifacts)',
    nameAr: 'كانفاس وتشغيل الكود الحي (Artifacts)',
    description: 'Render interactive HTML, CSS, JavaScript, React components, and Tailwind UI directly in a split-screen live preview.',
    descriptionAr: 'عرض وتشغيل كود HTML وCSS وJavaScript ومكونات React وTailwind مباشرة في لوحة معاينة تفاعلية حية.',
    icon: 'Layout',
    category: 'developer',
    enabled: true,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `When the user asks to build, design, or test a website, widget, UI component, or mini-game, write complete, self-contained, production-grade HTML5/Tailwind/JS code enclosed in \`\`\`html ... \`\`\` fences so it renders automatically in the live preview canvas.`,
  },
  {
    id: 'architecture-diagrams',
    name: 'Diagrams & Architecture Visualizer',
    nameAr: 'مصمم المخططات وهندسة النظم (Mermaid)',
    description: 'Automatically render interactive Mermaid.js flowcharts, mindmaps, system architectures, and sequence diagrams in chat.',
    descriptionAr: 'رسم مخططات Mermaid.js التفاعلية: خرائط ذهنية، معمارية نظم، تسلسل، ورسوم بيانية مباشرة في المحادثة.',
    icon: 'Network',
    category: 'developer',
    enabled: true,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `When explaining system architectures, workflows, database schemas, or algorithms, illustrate them using clean Mermaid.js diagram blocks (\`\`\`mermaid ... \`\`\`). Always quote node labels containing spaces or special characters.`,
  },
  {
    id: 'math-data-analyst',
    name: 'Math, Physics & Data Analyst',
    nameAr: 'محلل الرياضيات والفيزياء والبيانات',
    description: 'Execute JavaScript/Math calculations client-side or worker-side for 100% accurate equations, unit conversions, and stats.',
    descriptionAr: 'تنفيذ العمليات الحسابية والفيزيائية وتحويلات الوحدات بدقة 100% مع تحليل إحصائي موثوق.',
    icon: 'Calculator',
    category: 'analysis',
    tools: ['math_calculate'],
    enabled: true,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `When solving mathematical or physical formulas, calculations, or unit conversions, compute values with strict mathematical rigor. Clearly write formulas step-by-step using LaTeX or structured math formatting.`,
  },
  {
    id: 'youtube-summarizer',
    name: 'YouTube & Media Summarizer',
    nameAr: 'ملخص يوتيوب والوسائط الذكي',
    description: 'Fetch video metadata, outlines, and key insights from any public YouTube video URL with zero paid keys.',
    descriptionAr: 'استخراج ملخصات ذكية، محاور رئيسية، ونقاط جوهرية من أي رابط يوتيوب بدون أي مفاتيح مدفوعة.',
    icon: 'Video',
    category: 'research',
    tools: ['youtube_summarize', 'web_fetch'],
    enabled: true,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `When provided with a YouTube URL, extract the video topic, core arguments, timeline timestamps, and actionable takeaways in a clean, structured executive summary.`,
  },
  {
    id: 'coding-architect',
    name: 'Senior Software Architect & Code Auditor',
    nameAr: 'مهندس البرمجيات ومراجع الكود المتقدم',
    description: 'Designs scalable distributed systems, enforces clean code patterns, refactors bottlenecks, and audits logic.',
    descriptionAr: 'تصميم معمارية النظم الموزعة، تدقيق الكود، تحسين الأداء وإعادة الهيكلة بمستوى خبير أول.',
    icon: 'Terminal',
    category: 'specialized',
    enabled: false,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `You are an elite Senior Software Architect. When reviewing or writing code:
1. Apply first-principles thinking and modern design patterns (SOLID, modularity, DRY).
2. Anticipate edge cases, concurrency hazards, and network latency.
3. Write clean, idiomatic, fully type-safe TypeScript/Rust/Go/Python without placeholders or shortcuts.`,
  },
  {
    id: 'cybersecurity-auditor',
    name: 'Zero-Trust Cybersecurity Auditor',
    nameAr: 'مدقق الأمان السيبراني Zero-Trust',
    description: 'Analyzes code for vulnerabilities, OWASP Top 10 risks, SQLi, SSRF, XSS, token leakage, and hardens APIs.',
    descriptionAr: 'فحص الثغرات الأمنية، مخاطر OWASP، منع تسريب المفاتيح، تأمين مسارات API ومنع XSS وSSRF.',
    icon: 'ShieldCheck',
    category: 'specialized',
    enabled: false,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `You are a Zero-Trust Application Security Auditor. Scrutinize code for:
- Server-Side Request Forgery (SSRF) and local network access
- Cross-Site Scripting (XSS) and safe markdown DOM purification
- API key exposure, authorization bypass, and rate-limiting enforcement.
Provide concrete, hardened remediation diffs.`,
  },
  {
    id: 'ui-ux-designer',
    name: 'Modern UI/UX & Tailwind Specialist',
    nameAr: 'مصمم واجهات المستخدم وتجربة الاستخدام الحديثة',
    description: 'Crafts visually stunning, highly accessible interfaces using Tailwind CSS, glassmorphism, micro-interactions, and dark mode.',
    descriptionAr: 'ابتكار واجهات مستخدم وتجارب تفاعلية استثنائية بتنسيقات Tailwind CSS وDark Mode.',
    icon: 'Palette',
    category: 'creative',
    enabled: false,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `You are a world-class UI/UX Designer. Create sleek, responsive, accessible dark-themed interfaces with modern aesthetics: subtle borders, rich micro-interactions, cohesive typography, and smooth transitions.`,
  },
  {
    id: 'game-dev-expert',
    name: 'Game Dev & Interactive 3D Specialist',
    nameAr: 'خبير تطوير الألعاب والـ 3D التفاعلي',
    description: 'Builds interactive 2D Canvas games, Three.js 3D scenes, physics simulations, and WebGL demos in a single file.',
    descriptionAr: 'برمجة ألعاب 2D تفاعلية ومشاهد Three.js ثلاثية الأبعاد ومحاكاة فيزيائية قابلة للعب فوراً.',
    icon: 'Gamepad2',
    category: 'specialized',
    enabled: false,
    author: 'Nova Hub',
    version: '1.0.0',
    systemPrompt: `You are an expert Game Developer. When asked for games or 3D demos, build complete, immediately playable HTML5 Canvas or Three.js games in a single file with responsive controls, score tracking, audio synthesis (Web Audio API), and restart loops.`,
  },
];
