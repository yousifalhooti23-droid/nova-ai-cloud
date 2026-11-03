import { useState } from 'react';
import {
  Crown, Globe, Lock, LogOut, Moon, ShieldCheck, Sliders, Sun, Trash2, Volume2, VolumeX,
} from 'lucide-react';
import { LOCALES, useI18n, type Locale } from '@/i18n';
import { cn } from '@/lib/cn';
import { api, describeApiError } from '@/lib/api';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import {
  Badge, Button, Field, Modal, Switch, TextInput,
} from '@/components/ui';

export function SettingsModal() {
  const { t, locale } = useI18n();
  const isAr = locale === 'ar';
  const open = useAppStore((s) => s.settingsOpen);
  const tab = useAppStore((s) => s.settingsTab);
  const openSettings = useAppStore((s) => s.openSettings);
  const authUser = useAppStore((s) => s.authUser);
  const setView = useAppStore((s) => s.setView);

  if (!open) return null;

  const activeTab = tab === 'account' && authUser ? 'account' : 'general';

  return (
    <Modal
      open={open}
      onClose={() => openSettings(false)}
      title={isAr ? 'الإعدادات والتفضيلات' : 'Settings & Preferences'}
      subtitle={isAr ? 'تخصيص المظهر وتجربة الاستخدام' : 'Customize appearance and preferences'}
      width={680}
      footer={<Button variant="ghost" onClick={() => openSettings(false)}>{t('common.close')}</Button>}
    >
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <nav className="flex sm:flex-col shrink-0 gap-1 overflow-x-auto pb-2 sm:pb-0 sm:w-[170px] scroll-thin border-b sm:border-b-0 sm:border-e border-line -mx-1 px-1">
          <TabButton
            active={activeTab === 'general'}
            onClick={() => openSettings(true, 'general')}
            icon={<Sliders size={13} />}
            label={isAr ? 'عام والمظهر' : 'General & Appearance'}
          />
          {authUser ? (
            <TabButton
              active={activeTab === 'account'}
              onClick={() => openSettings(true, 'account')}
              icon={<ShieldCheck size={13} />}
              label={isAr ? 'حسابي والأمان' : 'Account & Security'}
            />
          ) : null}

          {authUser?.role === 'owner' ? (
            <div className="mt-3 pt-3 border-t border-line hidden sm:block">
              <button
                type="button"
                onClick={() => {
                  openSettings(false);
                  setView('studio');
                }}
                className="flex w-full items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-start text-[12px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
              >
                <Crown size={13} className="shrink-0 text-amber-400" />
                <span>{isAr ? 'مركز القيادة (Studio)' : 'NOVA Studio'}</span>
              </button>
            </div>
          ) : null}
        </nav>

        <div className="min-w-0 flex-1">
          {activeTab === 'general' ? <GeneralTab /> : null}
          {activeTab === 'account' && authUser ? <AccountSecurityTab /> : null}
        </div>
      </div>
    </Modal>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 sm:py-2 text-start text-[12px] sm:text-[12.5px] transition-colors whitespace-nowrap',
        active ? 'bg-accent/15 font-semibold text-accent' : 'text-muted hover:bg-elevated hover:text-text',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- general */

function GeneralTab() {
  const { t, locale } = useI18n();
  const isAr = locale === 'ar';
  const setLocale = useAppStore((s) => s.setLocale);
  const editorFontSize = useAppStore((s) => s.editorFontSize);
  const editorWrap = useAppStore((s) => s.editorWrap);
  const theme = useAppStore((s) => s.theme ?? 'dark');
  const soundEffects = useAppStore((s) => s.soundEffects ?? true);
  const patchPrefs = useAppStore((s) => s.patchPrefs);
  const toast = useAppStore((s) => s.toast);

  const toggleTheme = (newTheme: 'dark' | 'light') => {
    patchPrefs({ theme: newTheme });
    if (typeof document !== 'undefined') {
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.style.colorScheme = 'dark';
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.style.colorScheme = 'light';
      }
    }
  };

  const clearChatHistory = () => {
    const msg = isAr
      ? 'هل أنت متأكد من مسح جميع سجلات المحادثات المحلية المحفوظة على هذا المتصفح؟'
      : 'Are you sure you want to clear all chat history stored locally in this browser?';
    if (window.confirm(msg)) {
      useChatStore.getState().reset();
      toast({
        kind: 'success',
        message: isAr ? 'تم مسح سجل المحادثات بنجاح.' : 'Chat history cleared successfully.',
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Theme Selection */}
      <Field label={isAr ? 'سمة الواجهة (المظهر)' : 'Appearance Theme'}>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => toggleTheme('dark')}
            className={cn(
              'flex items-center justify-center gap-2 rounded-xl border p-2.5 text-[12.5px] font-medium transition-all',
              theme === 'dark'
                ? 'border-accent bg-accent/15 text-accent shadow-sm'
                : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text',
            )}
          >
            <Moon size={15} />
            <span>{isAr ? 'الوضع الداكن' : 'Dark Mode'}</span>
          </button>
          <button
            type="button"
            onClick={() => toggleTheme('light')}
            className={cn(
              'flex items-center justify-center gap-2 rounded-xl border p-2.5 text-[12.5px] font-medium transition-all',
              theme === 'light'
                ? 'border-accent bg-accent/15 text-accent shadow-sm'
                : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text',
            )}
          >
            <Sun size={15} />
            <span>{isAr ? 'الوضع الفاتح' : 'Light Mode'}</span>
          </button>
        </div>
      </Field>

      {/* Language Selection */}
      <Field label={t('settings.language')} hint={t('settings.languageHint')}>
        <div className="flex gap-2">
          {LOCALES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => void setLocale(l.id as Locale)}
              className={cn(
                'flex-1 rounded-xl border py-2 text-center text-[12.5px] font-medium transition-colors',
                locale === l.id
                  ? 'border-accent/60 bg-accent/15 text-accent font-semibold'
                  : 'border-line bg-surface text-muted hover:text-text',
              )}
            >
              <Globe size={13} className="inline-block me-1.5 opacity-70" />
              {l.label}
              <span className="ms-1.5 font-mono text-[10px] text-dim">{l.dir.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </Field>

      {/* Sound Effects Switch */}
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {soundEffects ? <Volume2 size={16} className="text-accent" /> : <VolumeX size={16} className="text-dim" />}
            <div>
              <p className="text-[12.5px] font-medium text-text">
                {isAr ? 'المؤثرات الصوتية (Sound Effects)' : 'Sound Effects'}
              </p>
              <p className="text-[11px] text-dim">
                {isAr ? 'تشغيل أصوات خفيفة عند إرسال واستلام الرسائل' : 'Subtle audio feedback on sending and receiving messages'}
              </p>
            </div>
          </div>
          <Switch
            checked={soundEffects}
            onChange={(v) => patchPrefs({ soundEffects: v })}
            label=""
          />
        </div>
      </div>

      {/* Editor Preferences */}
      <div className="rounded-xl border border-line bg-surface p-3.5 space-y-3">
        <p className="text-[12px] font-semibold text-text">
          {isAr ? 'تفضيلات محرر الأكواد' : 'Code Editor Preferences'}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('settings.fontSize')}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={11}
                max={18}
                value={editorFontSize}
                onChange={(e) => patchPrefs({ editorFontSize: Number(e.target.value) })}
                className="flex-1 accent-[var(--color-accent)]"
              />
              <span className="w-8 font-mono text-[11.5px] text-dim">{editorFontSize}px</span>
            </div>
          </Field>
          <div className="flex items-center pt-5">
            <Switch
              checked={editorWrap}
              onChange={(v) => patchPrefs({ editorWrap: v })}
              label={t('settings.lineWrap')}
            />
          </div>
        </div>
      </div>

      {/* Clear Local Chat History */}
      <div className="rounded-xl border border-danger/25 bg-danger/5 p-3.5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-medium text-danger">
            {isAr ? 'مسح سجل المحادثات المحلية' : 'Clear Local Chat History'}
          </p>
          <p className="text-[11px] text-dim">
            {isAr ? 'حذف كافة المحادثات المؤقتة المخزنة في هذا المتصفح' : 'Remove all local conversation cache in this browser'}
          </p>
        </div>
        <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={clearChatHistory}>
          {isAr ? 'مسح السجل' : 'Clear'}
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- account & security */

function AccountSecurityTab() {
  const { locale } = useI18n();
  const isAr = locale === 'ar';
  const authUser = useAppStore((s) => s.authUser);
  const logout = useAppStore((s) => s.logout);
  const toast = useAppStore((s) => s.toast);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  if (!authUser) return null;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPw(true);
    try {
      await api.authChangePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      toast({
        kind: 'success',
        message: isAr ? 'تم تحديث كلمة المرور وإلغاء الجلسات الأخرى بنجاح.' : 'Password updated and other sessions revoked.',
      });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pe-1">
      {/* Profile & Quota Card */}
      <div className="rounded-xl border border-line bg-surface p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'grid h-9 w-9 place-items-center rounded-xl text-[13px] font-bold',
                authUser.role === 'owner'
                  ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/35'
                  : 'bg-accent/15 text-accent',
              )}
            >
              {authUser.role === 'owner' ? <Crown size={17} /> : authUser.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="text-[13px] font-semibold text-text">{authUser.displayName}</p>
              <p className="font-mono text-[11px] text-dim">{authUser.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {authUser.role === 'owner' ? (
              <Badge tone="warning">{isAr ? '👑 المالك · غير محدود (∞)' : '👑 Owner · Unlimited (∞)'}</Badge>
            ) : authUser.quota.locked ? (
              <Badge tone="danger">{isAr ? '⛔ منتهي (يتجدد بعد أسبوع)' : '⛔ Weekly Lockout'}</Badge>
            ) : (
              <Badge tone="success">
                {isAr
                  ? `الحد اليومي: ${authUser.quota.used} / ${authUser.quota.limit}`
                  : `Daily Quota: ${authUser.quota.used} / ${authUser.quota.limit}`}
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => void logout()}>
              <LogOut size={12} />
              {isAr ? 'خروج' : 'Sign Out'}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-[11.5px] text-dim">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-400" />
          <span>
            {authUser.role === 'owner'
              ? isAr
                ? 'أنت مالك المنصة — لا يوجد عليك أي حد يومي مطلقاً، وجميع محادثاتك ومشاريعك ومفاتيحك محمية ومعزولة تماماً.'
                : 'You are the platform owner — zero daily limits, full administrative control, and complete data isolation.'
              : authUser.quota.locked
                ? isAr
                  ? `خلاص انتهى حدّك اليومي بالكامل! يتجدد رصيدك تلقائياً بعد أسبوع بتاريخ ${authUser.quota.lockedUntil?.slice(0, 10) ?? ''}.`
                  : `Your daily limit ran out! Your quota automatically renews in 1 week on ${authUser.quota.lockedUntil?.slice(0, 10) ?? ''}.`
                : isAr
                  ? `خصوصيتك معزولة 100% عن بقية المستخدمين. استهلاكك اليومي الحالي ${authUser.quota.used} من ${authUser.quota.limit}.`
                  : `Your data is 100% isolated. Current daily usage: ${authUser.quota.used} / ${authUser.quota.limit}.`}
          </span>
        </div>
      </div>

      {/* Password Change */}
      <form onSubmit={handlePasswordChange} className="rounded-xl border border-line bg-surface p-3.5">
        <p className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-text">
          <Lock size={13} className="text-accent" />
          {isAr ? 'تغيير كلمة المرور' : 'Change Password'}
        </p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field label={isAr ? 'كلمة المرور الحالية' : 'Current Password'} htmlFor="pw-cur">
            <TextInput
              id="pw-cur"
              type="password"
              dir="ltr"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <Field label={isAr ? 'كلمة المرور الجديدة (8+ أحرف)' : 'New Password (8+ chars)'} htmlFor="pw-new">
            <TextInput
              id="pw-new"
              type="password"
              dir="ltr"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
        </div>
        <div className="mt-2.5 flex justify-end">
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={savingPw}
            disabled={savingPw || !currentPassword || newPassword.length < 8}
          >
            {isAr ? 'تحديث كلمة المرور' : 'Update Password'}
          </Button>
        </div>
      </form>
    </div>
  );
}
