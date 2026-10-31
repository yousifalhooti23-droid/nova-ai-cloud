import { create } from 'zustand';
import type { HealthResponse, ModelsResponse, SandboxStatusResponse, SettingsResponse } from '@nova/shared';
import { api, describeApiError, type ProbeResponse } from '@/lib/api';
import type { Locale } from '@/i18n';

export type View = 'chat' | 'code';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
  hint?: string;
}

const LS_KEY = 'nova.ui.prefs.v1';

interface Prefs {
  locale: Locale;
  view: View;
  sidebarCollapsed: boolean;
  editorFontSize: number;
  editorWrap: boolean;
  diffMode: 'unified' | 'side';
}

function loadPrefs(): Prefs {
  const fallback: Prefs = {
    locale: 'ar',
    view: 'chat',
    sidebarCollapsed: false,
    editorFontSize: 13,
    editorWrap: false,
    diffMode: 'unified',
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return fallback;
  }
}

function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota — preferences are not critical */
  }
}

interface AppState extends Prefs {
  ready: boolean;
  health: HealthResponse | null;
  models: ModelsResponse | null;
  sandbox: SandboxStatusResponse | null;
  settings: SettingsResponse | null;
  probe: ProbeResponse | null;
  toasts: Toast[];
  settingsOpen: boolean;
  settingsTab: 'general' | 'providers' | 'agent' | 'storage';
  offline: boolean;
  loadSandbox: () => Promise<void>;
  loadSettings: () => Promise<void>;
  lastError: { message: string; hint?: string } | null;

  init: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  probeWorkersAi: () => Promise<void>;
  patchPrefs: (patch: Partial<Prefs>) => void;
  setLocale: (locale: Locale) => Promise<void>;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  openSettings: (open?: boolean, tab?: 'general' | 'providers' | 'agent' | 'storage') => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

let toastSeq = 0;

export const useAppStore = create<AppState>((set, get) => ({
  ...loadPrefs(),
  ready: false,
  health: null,
  models: null,
  sandbox: null,
  settings: null,
  probe: null,
  toasts: [],
  settingsOpen: false,
  settingsTab: 'general',
  offline: false,
  lastError: null,

  async init() {
    if (get().ready) return;
    await Promise.all([get().refreshHealth(), get().refreshModels(), get().loadSandbox(), get().loadSettings()]);
    set({ ready: true });
  },

  async refreshHealth() {
    try {
      const health = await api.health();
      set({ health, offline: false, lastError: null });
    } catch (err) {
      const { message } = describeApiError(err);
      set({ offline: true, lastError: { message, hint: message === 'network' ? 'network' : undefined } });
    }
  },

  async refreshModels() {
    try {
      set({ models: await api.models() });
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async refreshCatalog() {
    try {
      const results = await api.refreshModels();
      const added = results.reduce((n, r) => n + r.added, 0);
      const updated = results.reduce((n, r) => n + r.updated, 0);
      const failed = results.filter((r) => r.error);
      get().toast({
        kind: failed.length && !added && !updated ? 'error' : 'success',
        message: `+${added} / ~${updated}`,
        hint: failed.map((f) => `${f.provider}: ${f.error}`).join(' · ') || undefined,
      });
      await get().refreshModels();
      await get().refreshHealth();
    } catch (err) {
      get().toast({ kind: 'error', message: describeApiError(err).message });
    }
  },

  async probeWorkersAi() {
    try {
      const probe = await api.probeWorkersAi();
      set({ probe });
      await get().refreshHealth();
      await get().refreshModels();
    } catch (err) {
      set({ probe: { mode: 'error', error: describeApiError(err).message } });
    }
  },

  patchPrefs(patch) {
    const next = { ...pickPrefs(get()), ...patch };
    savePrefs(next);
    set(patch);
  },

  async setLocale(locale) {
    get().patchPrefs({ locale });
    try {
      const settings = await api.updateSettings({ locale });
      set({ settings });
    } catch {
      /* local preference still applies; server sync is best-effort */
    }
  },

  setView(view) {
    get().patchPrefs({ view });
  },

  toggleSidebar() {
    get().patchPrefs({ sidebarCollapsed: !get().sidebarCollapsed });
  },

  openSettings(open = true, tab) {
    set((s) => ({ settingsOpen: open, settingsTab: tab ?? s.settingsTab }));
  },

  toast(t) {
    const id = `toast-${++toastSeq}`;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) });
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 8000 : 4000);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((x) => x.id !== id) });
  },

  async loadSandbox() {
    try {
      set({ sandbox: await api.sandboxStatus() });
    } catch {
      set({ sandbox: null });
    }
  },
  async loadSettings() {
    try {
      const settings = await api.getSettings();
      set({ settings });
      // Server-side locale wins (single-owner cloud) but only on first boot.
      if (!get().ready && settings.locale && settings.locale !== get().locale) {
        get().patchPrefs({ locale: settings.locale as Locale });
      }
    } catch {
      set({ settings: null });
    }
  },
}));

function pickPrefs(s: AppState): Prefs {
  return {
    locale: s.locale,
    view: s.view,
    sidebarCollapsed: s.sidebarCollapsed,
    editorFontSize: s.editorFontSize,
    editorWrap: s.editorWrap,
    diffMode: s.diffMode,
  };
}

/** Convenience selector: models the router can actually call right now. */
export function selectCallable(state: Pick<AppState, 'models' | 'health'>) {
  const readyProviders = new Set(
    (state.health?.providers ?? []).filter((p) => p.status === 'ready').map((p) => p.id),
  );
  return (state.models?.models ?? []).filter(
    (m) => readyProviders.has(m.provider) && m.access === 'open',
  );
}
