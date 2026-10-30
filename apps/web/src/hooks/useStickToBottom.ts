import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps a scroll container pinned to the bottom while new content streams in,
 * but stops fighting the user as soon as they scroll up (and exposes a flag so
 * the UI can offer a "jump to latest" button).
 */
export function useStickToBottom<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stick = useRef(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = distance < 80;
    setAtBottom(stick.current);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stick.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  return { ref, atBottom, onScroll, scrollToBottom };
}
