import { create } from 'zustand';
import type { AuthSessionResponse, AuthUser, HealthResponse, ModelsResponse, SandboxStatusResponse, SettingsResponse } from '@nova/shared';
import { api, describeApiError, setStoredSessionToken, type ProbeResponse } from '@/lib/api';
import type { Locale } from '@/i18n';

declare const __NOVA_BUILD_VERSION__: string | undefined;

export type View = 'chat' | 'code';
export type SettingsTabId = 'general' | 'account' | 'providers' | 'agent' | 'storage';

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
  authChecked: boolean;
  authUser: AuthUser | null;
  health: HealthResponse | null;
  models: ModelsResponse | null;
  sandbox: SandboxStatusResponse | null;
  settings: SettingsResponse | null;
  probe: ProbeResponse | null;
  toasts: Toast[];
  settingsOpen: boolean;
  settingsTab: SettingsTabId;
  mobileSidebarOpen: boolean;
  offline: boolean;
  loadSandbox: () => Promise<void>;
  loadSettings: () => Promise<void>;
  lastError: { message: string; hint?: string } | null;

  init: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<AuthSessionResponse>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  probeWorkersAi: () => Promise<void>;
  patchPrefs: (patch: Partial<Prefs>) => void;
  setLocale: (locale: Locale) => Promise<void>;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  openSettings: (open?: boolean, tab?: SettingsTabId) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

let toastSeq = 0;

export const useAppStore = create<AppState>((set, get) => ({
  ...loadPrefs(),
  ready: false,
  authChecked: false,
  authUser: null,
  health: null,
  models: null,
  sandbox: null,
  settings: null,
  probe: null,
  toasts: [],
  settingsOpen: false,
  settingsTab: 'general',
  mobileSidebarOpen: false,
  offline: false,
  lastError: null,

  async init() {
    if (get().ready) return;
    await Promise.all([get().refreshHealth(), get().refreshAuth()]);
    const { health, authUser } = get();
    if (!health?.userAuthEnabled || authUser) {
      await Promise.all([get().refreshModels(), get().loadSandbox(), get().loadSettings()]);
    }
    set({ ready: true });
  },

  async refreshHealth() {
    try {
      const health = await api.health();
      // Auto-upgrade any stale open mobile/desktop browser tab once when a newer Worker is deployed.
      if (
        typeof window !== 'undefined' &&
        health.runtime === 'workers' &&
        health.version &&
        typeof __NOVA_BUILD_VERSION__ !== 'undefined' &&
        health.version !== __NOVA_BUILD_VERSION__
      ) {
        try {
          const reloadKey = 'nova.reloaded_version';
          if (sessionStorage.getItem(reloadKey) !== health.version) {
            sessionStorage.setItem(reloadKey, health.version);
            const u = new URL(window.location.href);
            u.searchParams.set('_v', health.version);
            window.location.replace(u.toString());
            return;
          }
        } catch {
          /* ignore storage restrictions */
        }
      } else if (typeof window !== 'undefined' && window.location.search.includes('_v=')) {
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete('_v');
          window.history.replaceState({}, '', u.pathname + u.search + u.hash);
        } catch {
          /* ignore */
        }
      }
      set({ health, offline: false, lastError: null });
    } catch (err) {
      const { message } = describeApiError(err);
      set({ offline: true, lastError: { message, hint: message === 'network' ? 'network' : undefined } });
    }
  },

  async refreshAuth() {
    try {
      const res = await api.authMe();
      set({ authUser: res.authenticated ? res.user : null, authChecked: true });
    } catch {
      set({ authUser: null, authChecked: true });
    }
  },

  async login(email, password) {
    const res = await api.authLogin({ email, password });
    if (res.token) setStoredSessionToken(res.token);
    set({ authUser: res.user, authChecked: true, lastError: null });
    await Promise.all([get().refreshModels(), get().loadSandbox(), get().loadSettings()]);
    const [{ useChatStore }, { useCodeStore }] = await Promise.all([import('./chat'), import('./code')]);
    useChatStore.getState().reset();
    useCodeStore.getState().resetSession();
    await Promise.all([
      useChatStore.getState().loadConversations(),
      useCodeStore.getState().loadProjects(),
    ]);
  },

  async register(displayName, email, password) {
    const res = await api.authRegister({ displayName, email, password });
    if (res.otpRequired || !res.authenticated) {
      return res;
    }
    if (res.token) setStoredSessionToken(res.token);
    set({ authUser: res.user, authChecked: true, lastError: null });
    await Promise.all([get().refreshModels(), get().loadSandbox(), get().loadSettings()]);
    const [{ useChatStore }, { useCodeStore }] = await Promise.all([import('./chat'), import('./code')]);
    useChatStore.getState().reset();
    useCodeStore.getState().resetSession();
    await Promise.all([
      useChatStore.getState().loadConversations(),
      useCodeStore.getState().loadProjects(),
    ]);
    return res;
  },

  async verifyOtp(email, code) {
    const res = await api.authVerifyOtp({ email, code });
    if (res.token) setStoredSessionToken(res.token);
    set({ authUser: res.user, authChecked: true, lastError: null });
    await Promise.all([get().refreshModels(), get().loadSandbox(), get().loadSettings()]);
    const [{ useChatStore }, { useCodeStore }] = await Promise.all([import('./chat'), import('./code')]);
    useChatStore.getState().reset();
    useCodeStore.getState().resetSession();
    await Promise.all([
      useChatStore.getState().loadConversations(),
      useCodeStore.getState().loadProjects(),
    ]);
  },

  async loginWithGoogle(credential) {
    const res = await api.authGoogle({ credential });
    if (res.token) setStoredSessionToken(res.token);
    set({ authUser: res.user, authChecked: true, lastError: null });
    await Promise.all([get().refreshModels(), get().loadSandbox(), get().loadSettings()]);
    const [{ useChatStore }, { useCodeStore }] = await Promise.all([import('./chat'), import('./code')]);
    useChatStore.getState().reset();
    useCodeStore.getState().resetSession();
    await Promise.all([
      useChatStore.getState().loadConversations(),
      useCodeStore.getState().loadProjects(),
    ]);
  },

  async logout() {
    try {
      await api.authLogout();
    } catch {
      /* ignore network issues on logout */
    }
    setStoredSessionToken('');
    const [{ useChatStore }, { useCodeStore }] = await Promise.all([import('./chat'), import('./code')]);
    useChatStore.getState().reset();
    useCodeStore.getState().resetSession();
    set({
      authUser: null,
      settingsOpen: false,
      settings: null,
    });
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
      const list = Array.isArray(results) ? results : [results];
      const added = list.reduce((n, r) => n + (r?.added ?? 0), 0);
      const updated = list.reduce((n, r) => n + (r?.updated ?? 0), 0);
      const failed = list.filter((r) => r?.error);
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
      if (!get().health?.userAuthEnabled || get().authUser) {
        const settings = await api.updateSettings({ locale });
        set({ settings });
      }
    } catch {
      /* local preference still applies; server sync is best-effort */
    }
  },

  setView(view) {
    get().patchPrefs({ view });
    set({ mobileSidebarOpen: false });
  },

  toggleSidebar() {
    if (typeof window !== 'undefined' && window.innerWidth < 860) {
      set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen }));
    } else {
      get().patchPrefs({ sidebarCollapsed: !get().sidebarCollapsed });
    }
  },

  setMobileSidebarOpen(open) {
    set({ mobileSidebarOpen: open });
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
