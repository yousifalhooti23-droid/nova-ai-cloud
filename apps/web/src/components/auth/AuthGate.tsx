import { useState } from 'react';
import { Eye, EyeOff, Globe, Lock, Mail, ShieldCheck, Sparkles, User } from 'lucide-react';
import { useI18n } from '@/i18n';
import { describeApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store/app';
import { Button, Field, TextInput } from '@/components/ui';

export function AuthGate() {
  const { locale } = useI18n();
  const isAr = locale === 'ar';
  const setLocale = useAppStore((s) => s.setLocale);
  const login = useAppStore((s) => s.login);
  const register = useAppStore((s) => s.register);
  const toast = useAppStore((s) => s.toast);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
        toast({
          kind: 'success',
          message: isAr ? 'مرحباً بعودتك في NOVA AI Cloud!' : 'Welcome back to NOVA AI Cloud!',
        });
      } else {
        await register(displayName.trim(), email.trim(), password);
        toast({
          kind: 'success',
          message: isAr ? 'تم إنشاء حسابك الخاص بنجاح!' : 'Your private account is ready!',
        });
      }
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-full w-full flex-col items-center justify-center overflow-y-auto bg-bg px-4 py-8">
      {/* Top-right language switch */}
      <div className="absolute end-4 top-4">
        <button
          type="button"
          onClick={() => void setLocale(isAr ? 'en' : 'ar')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-text"
        >
          <Globe size={13} />
          {isAr ? 'English' : 'العربية'}
        </button>
      </div>

      <div className="w-full max-w-[420px] rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        {/* Brand Header */}
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent ring-1 ring-accent/30">
            <Sparkles size={22} />
          </div>
          <h1 className="text-[19px] font-bold tracking-tight text-text">NOVA AI Cloud</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
            {isAr
              ? 'مساحة ذكاء اصطناعي سحابية خاصة ومشفرة لكل مستخدم'
              : 'Private, encrypted cloud AI workspace for every user'}
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={cn(
              'rounded-lg py-2 text-[12.5px] font-medium transition-colors',
              mode === 'login' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text',
            )}
          >
            {isAr ? 'تسجيل الدخول' : 'Sign In'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={cn(
              'rounded-lg py-2 text-[12.5px] font-medium transition-colors',
              mode === 'register' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text',
            )}
          >
            {isAr ? 'إنشاء حساب جديد' : 'Create Account'}
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-danger">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {mode === 'register' ? (
            <Field label={isAr ? 'الاسم الكامل أو اللقب' : 'Display Name'} htmlFor="auth-name">
              <div className="relative">
                <User size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-dim" />
                <TextInput
                  id="auth-name"
                  required
                  minLength={2}
                  maxLength={60}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={isAr ? 'مثال: أحمد' : 'e.g. Alex'}
                  className="ps-9"
                  autoComplete="name"
                />
              </div>
            </Field>
          ) : null}

          <Field label={isAr ? 'البريد الإلكتروني' : 'Email Address'} htmlFor="auth-email">
            <div className="relative">
              <Mail size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-dim" />
              <TextInput
                id="auth-email"
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="ps-9"
                autoComplete="email"
              />
            </div>
          </Field>

          <Field
            label={isAr ? 'كلمة المرور' : 'Password'}
            hint={mode === 'register' ? (isAr ? '8 أحرف على الأقل لحماية حسابك' : 'Minimum 8 characters') : undefined}
            htmlFor="auth-password"
          >
            <div className="relative">
              <Lock size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-dim" />
              <TextInput
                id="auth-password"
                type={showPass ? 'text' : 'password'}
                required
                minLength={mode === 'register' ? 8 : 1}
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pe-9 ps-9"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPass((v) => !v)}
                className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-dim hover:text-text"
                aria-label={showPass ? 'Hide password' : 'Show password'}
              >
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={busy || !email.trim() || !password || (mode === 'register' && displayName.trim().length < 2)}
            className="mt-1 w-full justify-center py-2.5 text-[13px] font-semibold"
          >
            {mode === 'login'
              ? isAr
                ? 'دخول آمن إلى حسابي'
                : 'Sign In Securely'
              : isAr
                ? 'إنشاء حسابي الخاص'
                : 'Create Private Account'}
          </Button>
        </form>

        {/* Privacy & Security Assurance */}
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-line bg-bg/70 p-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          <div className="text-[11px] leading-relaxed text-dim">
            <p className="font-medium text-muted">
              {isAr ? 'خصوصية معزولة 100% وحماية مشددة' : '100% Isolated Privacy & Hardened Security'}
            </p>
            <p className="mt-0.5">
              {isAr
                ? 'محادثاتك وصورك ومشاريعك خاصة بحسابك فقط ولا يمكن لأي مستخدم آخر الاطلاع عليها.'
                : 'Your chats, generated media, and code projects are strictly isolated to your account.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
