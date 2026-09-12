import React, { useState, useEffect, useRef } from 'react';
import { getSupabaseClient, signOutFromSupabase } from '../../lib/supabase';
import {
  Lock,
  Eye,
  EyeOff,
  Fish,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';

interface ResetPasswordProps {
  onNavigateToLogin?: () => void;
}

export const ResetPasswordScreen: React.FC<ResetPasswordProps> = ({ onNavigateToLogin }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasValidSession, setHasValidSession] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Recovery context flag: strictly requires PASSWORD_RECOVERY event or URL recovery evidence
  const recoveryContextRef = useRef<boolean>(false);

  // Check Supabase recovery session on mount
  useEffect(() => {
    let isMounted = true;

    const checkUrlRecoveryEvidence = (): boolean => {
      if (typeof window === 'undefined') return false;
      try {
        const search = window.location.search || '';
        const hash = window.location.hash ? window.location.hash.substring(1) : '';

        const searchParams = new URLSearchParams(search);
        const hashParams = new URLSearchParams(hash);

        const typeInHash = hashParams.get('type');
        const typeInSearch = searchParams.get('type');
        const isRecoveryType = typeInHash === 'recovery' || typeInSearch === 'recovery';

        const hasCodeInSearch = Boolean(searchParams.get('code'));
        const hasCodeInHash = Boolean(hashParams.get('code'));

        return isRecoveryType || hasCodeInSearch || hasCodeInHash;
      } catch {
        return false;
      }
    };

    const getUrlError = (): string | null => {
      if (typeof window === 'undefined') return null;
      try {
        const search = window.location.search || '';
        const hash = window.location.hash ? window.location.hash.substring(1) : '';
        const searchParams = new URLSearchParams(search);
        const hashParams = new URLSearchParams(hash);

        const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');
        const errorCode = hashParams.get('error_code') || searchParams.get('error_code');

        if (errorDesc || errorCode) {
          return errorDesc
            ? decodeURIComponent(errorDesc.replace(/\+/g, ' '))
            : 'رابط استعادة كلمة المرور غير صالح أو منتهي الصلاحية. يرجى طلب رابط جديد.';
        }
      } catch {
        // Ignore parsing errors
      }
      return null;
    };

    const checkRecoverySession = async () => {
      try {
        // 1. Check for error parameters in URL / hash
        const urlError = getUrlError();
        if (urlError) {
          if (isMounted) {
            setErrorMsg(urlError);
            setHasValidSession(false);
            setIsCheckingSession(false);
          }
          return;
        }

        // 2. Determine if the initial URL contains recovery evidence
        const hasUrlEvidence = checkUrlRecoveryEvidence();
        if (hasUrlEvidence) {
          recoveryContextRef.current = true;
        }

        const client = getSupabaseClient();

        // 3. Handle code exchange if PKCE recovery code parameter exists
        if (typeof window !== 'undefined') {
          const searchParams = new URLSearchParams(window.location.search);
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          const code = searchParams.get('code') || hashParams.get('code');
          if (code) {
            try {
              await client.auth.exchangeCodeForSession(code);
            } catch {
              // Handled by detectSessionInUrl or getSession below
            }
          }
        }

        // 4. Check if a valid Supabase session exists
        let { data, error } = await client.auth.getSession();
        let session = data?.session;

        if (error || !session) {
          // Give detectSessionInUrl a small moment to exchange tokens if parsing hash
          await new Promise((resolve) => setTimeout(resolve, 600));
          const secondCheck = await client.auth.getSession();
          session = secondCheck.data?.session;
        }

        if (!isMounted) return;

        // 5. Strictly require recovery context AND an active session.
        // A normal authenticated session without recovery evidence is NOT treated as recovery.
        if (recoveryContextRef.current && session) {
          setHasValidSession(true);
          setErrorMsg(null);
          setIsCheckingSession(false);
        } else {
          setHasValidSession(false);
          setErrorMsg(
            'رابط استعادة كلمة المرور غير صالح أو منتهي الصلاحية. يرجى طلب رابط استعادة جديد من شاشة تسجيل الدخول.'
          );
          setIsCheckingSession(false);
        }
      } catch {
        if (isMounted) {
          setHasValidSession(false);
          setErrorMsg('تعذر التحقق من جلسة استعادة كلمة المرور. يرجى طلب رابط جديد.');
          setIsCheckingSession(false);
        }
      }
    };

    checkRecoverySession();

    // Listen to auth state changes (specifically PASSWORD_RECOVERY event)
    const client = getSupabaseClient();
    const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryContextRef.current = true;
        if (session && isMounted) {
          setHasValidSession(true);
          setErrorMsg(null);
          setIsCheckingSession(false);
        }
      } else if (session && recoveryContextRef.current && isMounted) {
        setHasValidSession(true);
        setErrorMsg(null);
        setIsCheckingSession(false);
      }
    });

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const handleGoToLogin = () => {
    // Clear hash and query params
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/');
    }
    if (onNavigateToLogin) {
      onNavigateToLogin();
    } else {
      window.location.href = '/';
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Validation using EXACT values without trimming
    if (newPassword.length < 8) {
      setErrorMsg('كلمة المرور يجب أن لا تقل عن 8 أحرف لضمان حماية حساب الإدارة.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('كلمتا المرور غير متطابقتين. يرجى إعادة التأكد من كتابتها.');
      return;
    }

    if (!hasValidSession || !recoveryContextRef.current) {
      setErrorMsg('انتهت صلاحية جلسة استعادة كلمة المرور أو الرابط غير صالح.');
      return;
    }

    setIsLoading(true);

    try {
      const client = getSupabaseClient();
      // Pass the exact newPassword value without trimming
      const { error } = await client.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        throw new Error(error.message || 'تعذر تحديث كلمة المرور');
      }

      // Successful password update
      setSuccessMsg('تم تعيين كلمة المرور الجديدة بنجاح! جاري تحويلك لشاشة تسجيل الدخول...');

      // Sign out from recovery session cleanly
      try {
        await signOutFromSupabase();
      } catch {
        // Ignore signout errors
      }

      // Auto redirect after 2.5 seconds
      setTimeout(() => {
        handleGoToLogin();
      }, 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحديث كلمة المرور في Supabase');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen w-full bg-[#0b0f19] text-slate-100 flex items-center justify-center p-4 selection:bg-cyan-500 selection:text-slate-950 font-sans"
    >
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 right-1/3 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Main Card */}
        <div className="bg-[#111827]/90 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-xl shadow-2xl">
          {/* Brand Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 mb-4 shadow-[0_0_20px_rgba(6,182,212,0.25)]">
              <Fish className="w-9 h-9" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              تعيين كلمة مرور جديدة
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              الملاح لبيع الأسماك - استعادة حساب الإدارة
            </p>
          </div>

          {/* Loading initial session state */}
          {isCheckingSession && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-slate-400">جاري التحقق من صلاحية رابط الاستعادة...</p>
            </div>
          )}

          {/* Expired or invalid recovery session */}
          {!isCheckingSession && !hasValidSession && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <p className="font-bold mb-1">الرابط غير صالح أو منتهي</p>
                  <p>{errorMsg || 'انتهت صلاحية جلسة استعادة كلمة المرور أو تم استخدام الرابط مسبقاً.'}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoToLogin}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
                <span>العودة إلى شاشة تسجيل الدخول</span>
              </button>
            </div>
          )}

          {/* Success state */}
          {successMsg && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <p className="font-bold mb-1">تم التحديث بنجاح</p>
                  <p>{successMsg}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoToLogin}
                className="w-full py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>الانتقال لتسجيل الدخول الآن</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Form for entering new password */}
          {!isCheckingSession && hasValidSession && !successMsg && (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              {/* Error Alert */}
              {errorMsg && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/10 text-cyan-300 text-xs flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>يرجى اختيار كلمة مرور قوية لا تقل عن 8 خانات.</span>
              </div>

              {/* New Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  كلمة المرور الجديدة
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    dir="ltr"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-900/90 border border-slate-800 text-white text-sm rounded-xl pl-11 pr-11 py-3 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all text-left font-mono"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  تأكيد كلمة المرور
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    dir="ltr"
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-900/90 border border-slate-800 text-white text-sm rounded-xl pl-11 pr-11 py-3 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all text-left font-mono"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                <span>{isLoading ? 'جاري حفظ كلمة المرور...' : 'حفظ كلمة المرور الجديدة'}</span>
              </button>

              {/* Back to login button */}
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={handleGoToLogin}
                  className="text-xs text-slate-400 hover:text-cyan-400 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>العودة لشاشة تسجيل الدخول</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
