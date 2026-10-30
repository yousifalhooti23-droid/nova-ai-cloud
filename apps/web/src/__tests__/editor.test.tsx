/**
 * Real CodeMirror mount (not mocked) to prove the editor component is wired:
 * it renders the document, reports edits through onChange, honours readOnly,
 * and picks up externally-changed content (what happens after approving a
 * proposed change).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { EditorPane } from '@/components/code/EditorPane';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EditorPane (CodeMirror)', () => {
  it('renders the document and reports edits', async () => {
    const onChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState('const a = 1;\n');
      return (
        <div style={{ height: 300 }}>
          <EditorPane
            path="src/a.ts"
            language="typescript"
            value={value}
            onChange={(v) => {
              setValue(v);
              onChange(v);
            }}
          />
        </div>
      );
    }

    render(<Harness />);

    const editor = await waitFor(() => {
      const el = document.querySelector('.cm-content') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(editor.textContent).toContain('const a = 1;');

    await userEvent.click(editor);
    await userEvent.keyboard('x');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('x');
  });

  it('reflects externally updated content (post-approval refresh)', async () => {
    function Harness() {
      const [value, setValue] = useState('before\n');
      return (
        <div style={{ height: 300 }}>
          <button type="button" data-testid="swap" onClick={() => setValue('after\n')}>swap</button>
          <EditorPane path="src/b.ts" language="typescript" value={value} />
        </div>
      );
    }

    render(<Harness />);
    const content = await waitFor(() => document.querySelector('.cm-content') as HTMLElement);
    expect(content.textContent).toContain('before');

    await userEvent.click(screen.getByTestId('swap'));
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toContain('after'));
  });

  it('is not editable in readOnly mode', async () => {
    render(
      <div style={{ height: 300 }}>
        <EditorPane path="src/c.ts" language="typescript" value={'locked\n'} readOnly />
      </div>,
    );
    const content = await waitFor(() => document.querySelector('.cm-content') as HTMLElement);
    expect(content.getAttribute('contenteditable')).toBe('false');
  });
});
