/**
 * jsdom shims for the browser APIs the app touches.
 * Each one is a minimal, honest stub — none of them fake product behaviour.
 */
import { vi } from 'vitest';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  root = null;
  rootMargin = '';
  thresholds: number[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
if (!('IntersectionObserver' in globalThis)) {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IntersectionObserverStub;
}

// jsdom reports a 1024px viewport and a no-op matchMedia. The app uses
// min-width queries to decide whether the side rails are open, so the stub
// evaluates them against a real width (1600px = a typical desktop session).
Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true, writable: true });
Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true, writable: true });

function evaluateQuery(query: string): boolean {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  const width = window.innerWidth;
  if (min && width < Number(min[1])) return false;
  if (max && width > Number(max[1])) return false;
  return true;
}

window.matchMedia = ((query: string) => {
  const mql = {
    get matches() {
      return evaluateQuery(query);
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  };
  return mql as unknown as MediaQueryList;
}) as unknown as typeof window.matchMedia;

if (!window.scrollTo) window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
}

/**
 * CodeMirror measures text through Range rects. jsdom implements neither, and
 * the measurement runs inside a requestAnimationFrame callback — an unhandled
 * throw there fails the whole file. Zeroed rects are enough for the logic tests.
 */
if (typeof Range !== 'undefined') {
  const zeroRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  const emptyRectList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects = () => emptyRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect();
}

if (typeof globalThis.TextEncoder === 'undefined') {
  const util = await import('node:util');
  (globalThis as unknown as { TextEncoder: unknown }).TextEncoder = util.TextEncoder;
  (globalThis as unknown as { TextDecoder: unknown }).TextDecoder = util.TextDecoder;
}
