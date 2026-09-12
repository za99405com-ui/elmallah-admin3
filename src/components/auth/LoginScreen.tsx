import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getSupabaseClient } from '../../lib/supabase';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  Fish,
  ArrowLeft,
  ArrowRight,
  KeyRound,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Forgot password states
  const [isForgotPasswordView, setIsForgotPasswordView] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoverySuccess, setRecoverySuccess] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const cleanEmail = email.trim();
      const cleanPass = password.trim();
      const success = await login(cleanEmail, cleanPass);
      if (!success) {
        setErrorMsg('بيانات الدخول غير صحيحة. يرجى التأكد من البريد الإلكتروني وكلمة المرور.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تسجيل الدخول، يرجى المحاولة لاحقاً');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError(null);
    setRecoverySuccess(null);
    setRecoveryLoading(true);

    try {
      const cleanRecoveryEmail = recoveryEmail.trim().toLowerCase();
      if (!cleanRecoveryEmail) {
        setRecoveryError('يرجى كتابة البريد الإلكتروني الخاص بحساب الإدارة');
        setRecoveryLoading(false);
        return;
      }

      const client = getSupabaseClient();
      const dynamicRedirectTo = `${window.location.origin}/reset-password`;

      const { error } = await client.auth.resetPasswordForEmail(cleanRecoveryEmail, {
        redirectTo: dynamicRedirectTo,
      });

      if (error) {
        throw new Error(error.message || 'تعذر إرسال رابط استعادة كلمة المرور');
      }

      setRecoverySuccess(
        `تم إرسال رابط استعادة كلمة المرور بنجاح إلى: ${cleanRecoveryEmail}. يرجى فحص صندوق الوارد (أو مجلد الرسائل غير المرغوب فيها Spam).`
      );
    } catch (err) {
      setRecoveryError(
        err instanceof Error
          ? err.message
          : 'تعذر إرسال بريد استعادة كلمة المرور. يرجى التأكد من البريد والمحاولة لاحقاً.'
      );
    } finally {
      setRecoveryLoading(false);
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
              {isForgotPasswordView ? 'استعادة كلمة المرور' : 'لوحة الإدارة'}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              {isForgotPasswordView
                ? 'أدخل بريدك الإلكتروني المسجل لإرسال رابط إعادة التعيين'
                : 'الملاح لبيع الأسماك - تسجيل الدخول'}
            </p>
          </div>

          {/* FORGOT PASSWORD VIEW */}
          {isForgotPasswordView ? (
            <div>
              {/* Recovery Error Alert */}
              {recoveryError && (
                <div className="mb-4 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{recoveryError}</span>
                </div>
              )}

              {/* Recovery Success Alert */}
              {recoverySuccess && (
                <div className="mb-4 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{recoverySuccess}</span>
                </div>
              )}

              <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    البريد الإلكتروني لحساب الإدارة
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      dir="ltr"
                      value={recoveryEmail}
                      onChange={(e) => setRecoveryEmail(e.target.value)}
                      placeholder="admin@example.com"
                      className="w-full bg-slate-900/90 border border-slate-800 text-white text-sm rounded-xl pl-4 pr-11 py-3 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all text-left"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                {/* Submit Recovery Request */}
                <button
                  type="submit"
                  disabled={recoveryLoading}
                  className="w-full mt-2 py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  <span>{recoveryLoading ? 'جاري إرسال الرابط...' : 'إرسال رابط إعادة التعيين'}</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>

                {/* Back to Login Button */}
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotPasswordView(false);
                      setRecoveryError(null);
                      setRecoverySuccess(null);
                    }}
                    className="text-xs text-slate-400 hover:text-cyan-400 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span>العودة لشاشة تسجيل الدخول</span>
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* STANDARD LOGIN VIEW */
            <div>
              {/* Error Alert */}
              {errorMsg && (
                <div className="mb-6 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email Field */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    البريد الإلكتروني
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      dir="ltr"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@example.com"
                      className="w-full bg-slate-900/90 border border-slate-800 text-white text-sm rounded-xl pl-4 pr-11 py-3 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all text-left"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                {/* Password Field */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      كلمة المرور
                    </label>
                    {/* Forgot Password Action Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsForgotPasswordView(true);
                        setRecoveryEmail(email);
                        setRecoveryError(null);
                        setRecoverySuccess(null);
                      }}
                      className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline transition-colors inline-flex items-center gap-1 cursor-pointer font-medium"
                    >
                      <HelpCircle className="w-3 h-3" />
                      <span>هل نسيت كلمة المرور؟</span>
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
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

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full mt-2 py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  <span>{isLoading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
