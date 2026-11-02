import { useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { I18nProvider, useI18n } from '@/i18n';
import { useAppStore } from '@/store/app';
import { AuthGate } from '@/components/auth/AuthGate';
import { Sidebar } from '@/components/layout/Sidebar';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { Button, Spinner, ToastStack } from '@/components/ui';
import { ChatPage } from '@/pages/ChatPage';
import { CodePage } from '@/pages/CodePage';
import { StudioDashboard } from '@/pages/StudioDashboard';

export default function App() {
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);

  return (
    <I18nProvider locale={locale} onLocaleChange={(next) => void setLocale(next)}>
      <Shell />
    </I18nProvider>
  );
}

function Shell() {
  const { t } = useI18n();
  const init = useAppStore((s) => s.init);
  const ready = useAppStore((s) => s.ready);
  const authChecked = useAppStore((s) => s.authChecked);
  const authUser = useAppStore((s) => s.authUser);
  const health = useAppStore((s) => s.health);
  const refreshHealth = useAppStore((s) => s.refreshHealth);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const openSettings = useAppStore((s) => s.openSettings);
  const offline = useAppStore((s) => s.offline);
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  // Boot: fetch health/auth/models/sandbox/settings, then keep health fresh so the
  // provider strip reflects reality (e.g. Workers AI becoming reachable).
  useEffect(() => {
    void init();
    const id = setInterval(() => void refreshHealth(), 30_000);
    const onOnline = () => void refreshHealth();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', onOnline);
    };
  }, [init, refreshHealth]);

  // Keyboard shortcuts (Cursor-style).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === '1') {
        e.preventDefault();
        setView('chat');
      } else if (e.key === '2') {
        e.preventDefault();
        setView('code');
      } else if (e.key === ',') {
        e.preventDefault();
        openSettings(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, setView, openSettings]);

  // Detect /studio route on initial load or popstate
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/studio')) {
      setView('studio');
    }
  }, [setView]);

  if (view === 'studio') {
    return (
      <div className="h-full w-full bg-bg">
        <StudioDashboard />
        <ToastStack toasts={toasts} onDismiss={dismissToast} labels={{ error: t('error.network'), success: t('common.success') }} />
      </div>
    );
  }

  if (health?.userAuthEnabled && !authChecked && !ready) {
    return (
      <div className="grid h-full w-full place-items-center bg-bg">
        <Spinner size={24} />
      </div>
    );
  }

  if (health?.userAuthEnabled && !authUser) {
    return (
      <>
        <AuthGate />
        <ToastStack toasts={toasts} onDismiss={dismissToast} labels={{ error: t('error.network'), success: t('common.success') }} />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-bg">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {offline ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-2">
            <WifiOff size={14} className="shrink-0 text-danger" />
            <p className="min-w-0 flex-1 text-[12px] text-danger">{t('error.network')}</p>
            <Button size="sm" variant="outline" onClick={() => void refreshHealth()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}

        <main className="min-h-0 flex-1 bg-bg">
          {view === 'chat' ? <ChatPage /> : <CodePage />}
        </main>
      </div>

      <SettingsModal />
      <ToastStack toasts={toasts} onDismiss={dismissToast} labels={{ error: t('error.network'), success: t('common.success') }} />
    </div>
  );
}
