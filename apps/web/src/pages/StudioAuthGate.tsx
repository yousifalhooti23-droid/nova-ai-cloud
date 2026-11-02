import { useState } from 'react';
import { Crown, KeyRound, Lock, ShieldCheck, ArrowLeft } from 'lucide-react';
import { api, describeApiError, setStoredAdminToken } from '@/lib/api';
import { Button, Field, TextInput } from '@/components/ui';
import { useAppStore } from '@/store/app';

interface Props {
  onSuccess: () => void;
  onCancel: () => void;
}

export function StudioAuthGate({ onSuccess, onCancel }: Props) {
  const isAr = useAppStore((s) => s.locale === 'ar');
  const authUser = useAppStore((s) => s.authUser);
  const toast = useAppStore((s) => s.toast);

  const [email, setEmail] = useState(authUser?.email || 'yousifalhooti23@gmail.com');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await api.adminStudioAuth({ email: email.trim(), password });
      if (res.token) {
        setStoredAdminToken(res.token);
        toast({
          kind: 'success',
          message: isAr ? 'تم تأكيد هوية المالك بنجاح — مرحباً بك في NOVA Studio!' : 'Admin authenticated successfully. Welcome to NOVA Studio!',
        });
        onSuccess();
      }
    } catch (err) {
      const parsed = describeApiError(err);
      setError(parsed.message || (isAr ? 'فشل التحقق من كلمة المرور' : 'Authentication failed'));
      toast({
        kind: 'error',
        message: parsed.message || (isAr ? 'البريد أو كلمة المرور غير صحيحة' : 'Invalid credentials'),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg p-4">
      {/* Holographic Glowing Background Card */}
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-500/30 bg-surface/90 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        <div className="absolute -top-24 -end-24 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -bottom-24 -start-24 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />

        <div className="relative">
          <div className="mb-6 flex items-center justify-between">
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1.5 text-[12px] font-medium text-dim transition-colors hover:text-text"
            >
              <ArrowLeft size={14} className={isAr ? 'rotate-180' : ''} />
              <span>{isAr ? 'العودة للدردشة' : 'Back to Chat'}</span>
            </button>
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
              <Crown size={12} className="text-amber-400" />
              <span>{isAr ? 'منطقة المالك المحمية' : 'Owner Area'}</span>
            </div>
          </div>

          <div className="text-center mb-6">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-amber-400/30 bg-amber-500/15 text-amber-300 shadow-inner">
              <Lock size={26} />
            </div>
            <h1 className="text-lg font-bold text-text">
              {isAr ? 'NOVA Studio — مركز القيادة والمراقبة' : 'NOVA Studio — Mission Control'}
            </h1>
            <p className="mt-1 text-[12px] text-dim leading-relaxed">
              {isAr
                ? 'لوحة إدارة الخوادم، المزوّدين، ومراقبة الـ Telemetry الحية الخاصة بمالك المنصة.'
                : 'Server telemetry, provider failover control, and system administration for the platform owner.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label={isAr ? 'بريد المالك' : 'Owner Email'}>
              <TextInput
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="yousifalhooti23@gmail.com"
                className="font-mono text-[12.5px]"
              />
            </Field>

            <Field
              label={isAr ? 'كلمة مرور المسؤول (ADMIN_SECRET_PASSWORD)' : 'Admin Secret Password'}
              hint={isAr ? 'كلمة المرور المشفرة المحفوظة في أسرار الخادم' : 'Encrypted secret stored in Cloudflare Worker'}
            >
              <TextInput
                type="password"
                dir="ltr"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••••••"
                className="font-mono text-[12.5px]"
              />
            </Field>

            {error ? (
              <div className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-[11.5px] text-danger">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={loading}
              icon={<ShieldCheck size={16} />}
              className="w-full !py-2.5 !text-[13px] !font-semibold bg-amber-500 hover:bg-amber-600 text-black border-amber-400"
            >
              {isAr ? 'دخول مركز القيادة (Verify & Enter)' : 'Enter Mission Control'}
            </Button>
          </form>

          <div className="mt-5 border-t border-line/60 pt-4 text-center">
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-dim">
              <KeyRound size={12} className="text-amber-400" />
              <span>
                {isAr
                  ? 'محمي بتشفير HMAC SHA-256 مع حد أقصى 5 محاولات لمنع الاختراق'
                  : 'HMAC SHA-256 secured with rate-limited brute-force protection'}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
