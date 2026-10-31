import { useEffect, useRef, useState } from 'react';
import type { AuthPublicConfigResponse } from '@nova/shared';
import { ArrowRight, Eye, EyeOff, Globe, KeyRound, Lock, Mail, RefreshCw, ShieldCheck, Sparkles, User } from 'lucide-react';
import { useI18n } from '@/i18n';
import { api, describeApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store/app';
import { Button, Field, TextInput } from '@/components/ui';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (cfg: { client_id: string; callback: (resp: { credential?: string }) => void }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

interface OtpStepState {
  email: string;
  delivery: 'email' | 'pending_owner';
  message: string;
}

export function AuthGate() {
  const { locale } = useI18n();
  const isAr = locale === 'ar';
  const setLocale = useAppStore((s) => s.setLocale);
  const login = useAppStore((s) => s.login);
  const register = useAppStore((s) => s.register);
  const verifyOtp = useAppStore((s) => s.verifyOtp);
  const loginWithGoogle = useAppStore((s) => s.loginWithGoogle);
  const toast = useAppStore((s) => s.toast);

  const [authConfig, setAuthConfig] = useState<AuthPublicConfigResponse | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const [otpStep, setOtpStep] = useState<OtpStepState | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .authConfig()
      .then((cfg) => {
        if (!cancelled) setAuthConfig(cfg);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  // Official Google Identity Services button when Owner configures Google Client ID
  useEffect(() => {
    const clientId = authConfig?.googleClientId?.trim();
    if (!clientId || otpStep || !googleBtnRef.current) return;

    const mountGoogle = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp) => {
          if (!resp.credential) return;
          setError(null);
          setBusy(true);
          try {
            await loginWithGoogle(resp.credential);
            toast({
              kind: 'success',
              message: isAr ? 'تم تسجيل الدخول بحساب Google الموثّق!' : 'Signed in with verified Google account!',
            });
          } catch (err) {
            setError(describeApiError(err).message);
          } finally {
            setBusy(false);
          }
        },
      });
      googleBtnRef.current.innerHTML = '';
      const btnWidth = Math.min(360, Math.max(220, (googleBtnRef.current.clientWidth || 320) - 8));
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        width: btnWidth,
        text: mode === 'register' ? 'signup_with' : 'signin_with',
        locale: isAr ? 'ar' : 'en',
      });
    };

    if (window.google?.accounts?.id) {
      mountGoogle();
      return;
    }

    const existing = document.getElementById('nova-gsi-script') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', mountGoogle);
      return () => existing.removeEventListener('load', mountGoogle);
    }

    const script = document.createElement('script');
    script.id = 'nova-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = mountGoogle;
    document.head.appendChild(script);
  }, [authConfig?.googleClientId, isAr, loginWithGoogle, mode, otpStep, toast]);

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
        const res = await register(displayName.trim(), email.trim(), password);
        if (res.otpRequired) {
          setOtpStep({
            email: res.pendingEmail ?? email.trim().toLowerCase(),
            delivery: res.delivery ?? 'email',
            message:
              res.message ??
              (isAr
                ? 'تم إرسال رمز تحقق مكوّن من 6 أرقام إلى بريدك الإلكتروني.'
                : 'A 6-digit verification code was sent to your email.'),
          });
          setOtpCode('');
          setResendCooldown(60);
          return;
        }
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

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpStep) return;
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(otpStep.email, otpCode.trim());
      toast({
        kind: 'success',
        message: isAr
          ? 'تم التحقق من بريدك الحقيقي وتفعيل حسابك بنجاح!'
          : 'Email verified and account activated!',
      });
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpStep || resendCooldown > 0) return;
    setError(null);
    setResending(true);
    try {
      const res = await api.authResendOtp({ email: otpStep.email });
      setOtpStep({
        email: otpStep.email,
        delivery: res.delivery,
        message: res.message,
      });
      setResendCooldown(60);
      toast({
        kind: 'info',
        message: isAr ? 'تم إرسال رمز تحقق جديد إلى بريدك.' : 'A new verification code was sent.',
      });
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="scroll-thin relative flex h-full w-full flex-col items-center overflow-y-auto bg-bg px-3.5 py-6 sm:px-4 sm:py-8 pb-safe">
      {/* Top-right language switch */}
      <div className="mb-3 flex w-full max-w-[430px] justify-end sm:mb-0 sm:w-auto sm:absolute sm:end-4 sm:top-4">
        <button
          type="button"
          onClick={() => void setLocale(isAr ? 'en' : 'ar')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-text"
        >
          <Globe size={13} />
          {isAr ? 'English' : 'العربية'}
        </button>
      </div>

      <div className="my-auto w-full max-w-[430px] rounded-2xl border border-line bg-surface p-4 sm:p-6 shadow-2xl">
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

        {otpStep ? (
          /* ---------------- STEP 2: 6-DIGIT EMAIL OTP VERIFICATION ---------------- */
          <div className="flex flex-col gap-3.5">
            <div
              className={cn(
                'rounded-xl border px-3.5 py-3 text-[12px] leading-relaxed',
                otpStep.delivery === 'email'
                  ? 'border-accent/35 bg-accent/10 text-text'
                  : 'border-amber-400/35 bg-amber-500/10 text-amber-200',
              )}
            >
              <p className="font-semibold">
                {otpStep.delivery === 'email'
                  ? isAr
                    ? '📧 تحقق من بريدك الإلكتروني'
                    : '📧 Check Your Email Inbox'
                  : isAr
                    ? '🛡️ تحقق أمني مطلوب لتفعيل الحساب'
                    : '🛡️ Security Verification Required'}
              </p>
              <p className="mt-1 text-[11.5px] opacity-90">{otpStep.message}</p>
              <p className="mt-1 font-mono text-[11px] text-accent" dir="ltr">
                {otpStep.email}
              </p>
            </div>

            {error ? (
              <div className="rounded-xl border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-danger">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3.5">
              <Field
                label={isAr ? 'رمز التحقق (OTP — 6 أرقام)' : 'Verification Code (6-Digit OTP)'}
                hint={
                  isAr
                    ? 'صالح لمدة 10 دقائق · تحقق أيضاً من قسم الرسائل غير المرغوبة (Spam)'
                    : 'Valid for 10 minutes · Also check Spam/Promotions folder'
                }
                htmlFor="auth-otp"
              >
                <div className="relative">
                  <KeyRound size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-accent" />
                  <TextInput
                    id="auth-otp"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    dir="ltr"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="ps-9 text-center font-mono !text-[18px] tracking-[0.45em]"
                    autoComplete="one-time-code"
                  />
                </div>
              </Field>

              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={busy || otpCode.length !== 6}
                className="w-full justify-center py-2.5 text-[13px] font-semibold"
              >
                {isAr ? 'تأكيد رمز التحقق وتفعيل الحساب' : 'Verify OTP & Activate Account'}
              </Button>
            </form>

            <div className="flex items-center justify-between gap-2 pt-1 text-[11.5px]">
              <button
                type="button"
                disabled={resending || resendCooldown > 0}
                onClick={() => void handleResendOtp()}
                className="inline-flex items-center gap-1.5 text-accent transition-opacity hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={12} className={resending ? 'animate-spin' : ''} />
                {resendCooldown > 0
                  ? isAr
                    ? `إعادة إرسال الرمز (${resendCooldown} ث)`
                    : `Resend code (${resendCooldown}s)`
                  : isAr
                    ? 'إعادة إرسال رمز التحقق'
                    : 'Resend OTP code'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setOtpStep(null);
                  setOtpCode('');
                  setError(null);
                }}
                className="inline-flex items-center gap-1 text-muted hover:text-text"
              >
                <ArrowRight size={12} className={isAr ? '' : 'rotate-180'} />
                {isAr ? 'تعديل البريد' : 'Change email'}
              </button>
            </div>
          </div>
        ) : (
          /* ---------------- STEP 1: SIGN IN OR CREATE ACCOUNT ---------------- */
          <>
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
                <Field label={isAr ? 'الاسم الحقيقي أو اللقب' : 'Display Name'} htmlFor="auth-name">
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

              <Field
                label={isAr ? 'البريد الإلكتروني الحقيقي' : 'Real Email Address'}
                hint={
                  mode === 'register'
                    ? isAr
                      ? 'يُشترط بريد حقيقي فعّال (مثل Gmail أو Outlook) — يتم حظر البريد المؤقت والوهمي وإرسال رمز OTP'
                      : 'Active real email required — disposable/fake domains are blocked & verified via 6-digit OTP'
                    : undefined
                }
                htmlFor="auth-email"
              >
                <div className="relative">
                  <Mail size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-dim" />
                  <TextInput
                    id="auth-email"
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@gmail.com"
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
                    ? 'إرسال رمز التحقق (OTP) وإنشاء الحساب'
                    : 'Send OTP & Create Account'}
              </Button>
            </form>

            {authConfig?.googleClientId ? (
              <div className="mt-4 flex flex-col items-center gap-2.5 border-t border-line pt-4">
                <span className="text-[11px] text-dim">
                  {isAr ? 'أو المتابعة بحساب Google موثّق' : 'Or continue with verified Google account'}
                </span>
                <div ref={googleBtnRef} className="flex min-h-[40px] w-full justify-center" />
              </div>
            ) : null}
          </>
        )}

        {/* Privacy & Anti-Fake Security Assurance */}
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-line bg-bg/70 p-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          <div className="text-[11px] leading-relaxed text-dim">
            <p className="font-medium text-muted">
              {isAr
                ? 'حماية ضد الحسابات الوهمية + خصوصية معزولة 100%'
                : 'Anti-Fake OTP Shield + 100% Isolated Privacy'}
            </p>
            <p className="mt-0.5">
              {isAr
                ? 'يمنع النظام البريد الوهمي والمؤقت ويتحقق عبر OTP، وتبقى محادثاتك وصورك ومشاريعك معزولة بحسابك فقط.'
                : 'Fake and disposable emails are blocked via live MX & OTP verification, and all data stays private to your account.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
