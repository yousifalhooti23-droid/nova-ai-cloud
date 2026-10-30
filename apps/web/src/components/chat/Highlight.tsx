import { Fragment, type ReactNode } from 'react';

/**
 * Dependency-free syntax highlighter.
 *
 * Produces React nodes (never `dangerouslySetInnerHTML`), so untrusted model
 * output can be rendered safely. Coverage is intentionally modest — enough to
 * make code readable in chat and in the diff/preview panes.
 */

type Token = { text: string; cls?: string };

const KEYWORDS: Record<string, string[]> = {
  js: 'const let var function return if else for while class extends new await async import export from default try catch finally throw typeof instanceof of in this super null undefined true false yield static get set delete void switch case break continue do'.split(' '),
  ts: 'const let var function return if else for while class extends new await async import export from default try catch finally throw typeof instanceof of in this super null undefined true false yield static get set delete void switch case break continue do interface type enum implements readonly as keyof satisfies public private protected declare namespace abstract is never unknown any string number boolean'.split(' '),
  py: 'def return if elif else for while class import from as try except finally raise with lambda yield global nonlocal pass break continue and or not in is None True False async await self assert del'.split(' '),
  sh: 'if then else elif fi for while do done case esac function return export local echo cd set shift exit source sudo npm npx node git curl'.split(' '),
  json: ['true', 'false', 'null'],
  css: 'important media supports keyframes import'.split(' '),
};

const LANG_ALIAS: Record<string, string> = {
  javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  typescript: 'ts', tsx: 'ts',
  python: 'py', python3: 'py',
  bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  html: 'markup', xml: 'markup', vue: 'markup', svelte: 'markup',
  jsonc: 'json', json5: 'json',
  scss: 'css', less: 'css',
  yml: 'yaml',
};

function normalizeLang(lang: string | undefined): string {
  if (!lang) return '';
  const l = lang.toLowerCase().trim();
  return LANG_ALIAS[l] ?? l;
}

/** Tokenize one line for keyword/string/comment/number families. */
function tokenizeLine(line: string, lang: string): Token[] {
  const kw = new Set(KEYWORDS[lang] ?? []);
  const out: Token[] = [];
  let i = 0;
  let buffer = '';

  const flush = () => {
    if (!buffer) return;
    // Split plain text on word boundaries so keywords can be matched.
    const parts = buffer.split(/(\b\w+\b)/g);
    for (const part of parts) {
      if (!part) continue;
      if (kw.has(part)) out.push({ text: part, cls: 'text-[#c792ea]' });
      else if (/^\d+(\.\d+)?$/.test(part)) out.push({ text: part, cls: 'text-[#f78c6c]' });
      else out.push({ text: part });
    }
    buffer = '';
  };

  while (i < line.length) {
    const rest = line.slice(i);

    // comments
    if ((lang === 'py' || lang === 'sh' || lang === 'yaml') && rest.startsWith('#')) {
      flush();
      out.push({ text: rest, cls: 'text-dim italic' });
      return out;
    }
    if ((lang === 'js' || lang === 'ts' || lang === 'css' || lang === 'json') && rest.startsWith('//')) {
      flush();
      out.push({ text: rest, cls: 'text-dim italic' });
      return out;
    }

    // strings
    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      let end = i + 1;
      while (end < line.length && line[end] !== quote) {
        if (line[end] === '\\') end += 1;
        end += 1;
      }
      flush();
      out.push({ text: line.slice(i, Math.min(end + 1, line.length)), cls: 'text-[#c3e88d]' });
      i = end + 1;
      continue;
    }

    buffer += line[i];
    i += 1;
  }
  flush();
  return out;
}

export function highlight(code: string, lang?: string): ReactNode[] {
  const normalized = normalizeLang(lang);
  const lines = code.replace(/\n$/, '').split('\n');
  return lines.map((line, idx) => (
    <Fragment key={idx}>
      {idx > 0 ? '\n' : null}
      {tokenizeLine(line, normalized).map((tok, j) =>
        tok.cls ? (
          <span key={j} className={tok.cls}>{tok.text}</span>
        ) : (
          <Fragment key={j}>{tok.text}</Fragment>
        ),
      )}
    </Fragment>
  ));
}

export { normalizeLang };
