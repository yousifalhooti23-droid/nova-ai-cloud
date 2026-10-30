import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars,
  keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentLess, indentMore, indentWithTab,
} from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import {
  bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { cn } from '@/lib/cn';

/** Map the shared `detectLanguage` output onto a CodeMirror language support. */
function languageExtension(language: string, path: string): Extension | null {
  const tsx = /\.tsx$/i.test(path);
  const jsx = /\.jsx$/i.test(path);
  switch (language) {
    case 'typescript':
      return javascript({ typescript: true, jsx: tsx });
    case 'javascript':
      return javascript({ jsx });
    case 'json':
      return json();
    case 'python':
      return python();
    case 'html':
    case 'xml':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'markdown':
      return markdown();
    default:
      return null;
  }
}

const novaTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' },
    '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--color-accent)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-dim)',
      borderRight: '1px solid var(--color-line)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(27,32,41,0.45)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(27,32,41,0.7)', color: 'var(--color-muted)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(122,162,247,0.22) !important',
    },
    '.cm-foldGutter .cm-gutterElement': { color: 'var(--color-dim)', cursor: 'pointer' },
    '.cm-searchMatch': { backgroundColor: 'rgba(224,179,65,0.28)' },
    '.cm-searchMatch-selected': { backgroundColor: 'rgba(217,119,87,0.4)' },
    '.cm-panels': { backgroundColor: 'var(--color-elevated)', color: 'var(--color-text)' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-text)',
      border: '1px solid var(--color-line-strong)',
      borderRadius: '6px',
      fontSize: '12px',
    },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: true },
);

export interface EditorPaneProps {
  value: string;
  language: string;
  path: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  fontSize?: number;
  wrap?: boolean;
  className?: string;
}

/**
 * CodeMirror 6 wrapper. Built from the individual packages (no `codemirror`
 * meta-package) so the bundle stays small and every extension is explicit.
 */
export function EditorPane({ value, language, path, onChange, onSave, readOnly, fontSize = 13, wrap = false, className }: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langConf = useRef(new Compartment());
  const optsConf = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // Create the editor once.
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        foldGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        novaTheme,
        search({ top: true }),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => (onSaveRef.current?.(), true) },
          { key: 'Tab', run: (v) => (v.state.selection.ranges.length > 1 || v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) ? indentMore(v) : false) },
          { key: 'Shift-Tab', run: indentLess },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        langConf.current.of(languageExtension(language, path) ?? []),
        optsConf.current.of(optionExtensions(readOnly, fontSize, wrap)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is intentionally created once; content/options sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync externally-changed content (e.g. after approving an agent change).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    // Do not clobber what the user is typing.
    if (view.hasFocus && current !== value && document.activeElement && view.dom.contains(document.activeElement)) {
      return;
    }
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        langConf.current.reconfigure(languageExtension(language, path) ?? []),
        optsConf.current.reconfigure(optionExtensions(readOnly, fontSize, wrap)),
      ],
    });
  }, [language, path, readOnly, fontSize, wrap]);

  return <div ref={hostRef} className={cn('h-full min-h-0 w-full overflow-hidden text-start', className)} dir="ltr" />;
}

function optionExtensions(readOnly: boolean | undefined, fontSize: number, wrap: boolean): Extension[] {
  const exts: Extension[] = [
    EditorView.theme({ '.cm-scroller': { fontSize: `${fontSize}px`, lineHeight: '1.65' } }),
    EditorState.readOnly.of(Boolean(readOnly)),
    EditorView.editable.of(!readOnly),
    indentUnit.of('  '),
    EditorState.tabSize.of(2),
  ];
  if (wrap) exts.push(EditorView.lineWrapping);
  return exts;
}
