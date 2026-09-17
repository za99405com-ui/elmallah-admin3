import React, { useState } from 'react';
import { ShieldCheck, Save, CheckCircle2, AlertTriangle, Calculator, Clock, HelpCircle } from 'lucide-react';

export interface DepositPolicySettings {
  defaultPaymentPolicy: 'cod_allowed' | 'deposit_required';
  depositRequired?: boolean;
  depositType?: 'fixed' | 'percentage';
  depositValue?: number;
  minDeposit?: number;
  minimumDeposit?: number;
  sessionTimeoutSeconds: number;
  amountTolerance: number;
}

interface DepositPolicySectionProps {
  settings: DepositPolicySettings;
  onRefresh: () => Promise<void>;
  adminRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
}

export const DepositPolicySection: React.FC<DepositPolicySectionProps> = ({
  settings,
  onRefresh,
  adminRequest,
}) => {
  const [defaultPolicy, setDefaultPolicy] = useState(settings.defaultPaymentPolicy || 'cod_allowed');
  const [depositRequired, setDepositRequired] = useState(Boolean(settings.depositRequired));
  const [depositType, setDepositType] = useState<'fixed' | 'percentage'>(settings.depositType || 'fixed');
  const [depositValue, setDepositValue] = useState(settings.depositValue ?? 50);
  const [minDeposit, setMinDeposit] = useState(settings.minimumDeposit ?? settings.minDeposit ?? 20);
  const [sessionTimeoutSeconds, setSessionTimeoutSeconds] = useState(settings.sessionTimeoutSeconds || 120);
  const [amountTolerance, setAmountTolerance] = useState(settings.amountTolerance || 10);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await adminRequest('/api/admin/payments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          defaultPaymentPolicy: defaultPolicy,
          depositRequired,
          depositType,
          depositValue: Number(depositValue),
          minDeposit: Number(minDeposit),
          minimumDeposit: Number(minDeposit),
          sessionTimeoutSeconds: Number(sessionTimeoutSeconds),
          amountTolerance: Number(amountTolerance),
        }),
      });

      setSuccess('تم حفظ إعدادات وسياسة العربون بنجاح');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات العربون');
    } finally {
      setSaving(false);
    }
  };

  // Live preview calculation example
  const sampleOrderTotal = 500;
  let previewDeposit =
    depositType === 'percentage'
      ? Math.round((sampleOrderTotal * Number(depositValue)) / 100)
      : Number(depositValue);
  if (minDeposit && previewDeposit < Number(minDeposit)) {
    previewDeposit = Number(minDeposit);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            سياسة الدفع والعربون (Deposit Policy & Session Rules)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            تحديد القواعد العامة لاشتراط دفع عربون قبل شحن الطلبات، وقيمة العربون، ومهل جلسات الدفع الآلي.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 cols: Main controls */}
        <div className="lg:col-span-2 space-y-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-black text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-3">
            قواعد العربون (Deposit Rules)
          </h3>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                السياسة العامة للدفع (Default Policy)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <label
                  className={`p-3 rounded-xl border cursor-pointer flex items-center gap-3 transition-all ${
                    defaultPolicy === 'cod_allowed'
                      ? 'border-cyan-500 bg-cyan-50/50 dark:bg-cyan-950/40 text-cyan-950 dark:text-cyan-200'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="policy"
                    checked={defaultPolicy === 'cod_allowed'}
                    onChange={() => setDefaultPolicy('cod_allowed')}
                    className="text-cyan-600 focus:ring-cyan-500"
                  />
                  <div>
                    <div className="font-bold text-xs">السماح بالدفع عند الاستلام كاملاً</div>
                    <div className="text-[10px] text-slate-500">لا يشترط دفع عربون إلا للطلبات المحددة</div>
                  </div>
                </label>

                <label
                  className={`p-3 rounded-xl border cursor-pointer flex items-center gap-3 transition-all ${
                    defaultPolicy === 'deposit_required'
                      ? 'border-cyan-500 bg-cyan-50/50 dark:bg-cyan-950/40 text-cyan-950 dark:text-cyan-200'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="policy"
                    checked={defaultPolicy === 'deposit_required'}
                    onChange={() => setDefaultPolicy('deposit_required')}
                    className="text-cyan-600 focus:ring-cyan-500"
                  />
                  <div>
                    <div className="font-bold text-xs">إلزام دفع عربون لجميع الطلبات</div>
                    <div className="text-[10px] text-slate-500">لا يتم تأكيد الطلب للشحن بدون عربون</div>
                  </div>
                </label>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={depositRequired}
                  onChange={(e) => setDepositRequired(e.target.checked)}
                  className="w-4 h-4 rounded text-cyan-600 focus:ring-cyan-500"
                />
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  تفعيل نظام العربون الآلي (Enable Deposit Engine)
                </span>
              </label>
            </div>

            {depositRequired && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    طريقة حساب العربون
                  </label>
                  <select
                    value={depositType}
                    onChange={(e) => setDepositType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="fixed">مبلغ ثابت (ج.م)</option>
                    <option value="percentage">نسبة مئوية (%)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    قيمة العربون {depositType === 'percentage' ? '(%)' : '(ج.م)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={depositValue}
                    onChange={(e) => setDepositValue(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold text-xs focus:ring-2 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    الحد الأدنى للعربون (ج.م)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={minDeposit}
                    onChange={(e) => setMinDeposit(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold text-xs focus:ring-2 focus:ring-cyan-500"
                  />
                </div>
              </div>
            )}

            <h3 className="text-sm font-black text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pt-4 pb-3">
              إعدادات جلسات الدفع والمطابقة الآلية
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  مهلة جلسة الدفع (بالثواني)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="30"
                    max="600"
                    value={sessionTimeoutSeconds}
                    onChange={(e) => setSessionTimeoutSeconds(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
                  />
                  <span className="absolute left-3 top-2 text-[11px] text-slate-400 font-bold">ثانية</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  المدة التي يحجز فيها جهاز الدفع ورقم المحفظة حصرياً للعميل (الموصى بها: 120 إلى 180 ثانية).
                </span>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  هامش التفاوت المالي المسموح (Amount Tolerance)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={amountTolerance}
                    onChange={(e) => setAmountTolerance(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
                  />
                  <span className="absolute left-3 top-2 text-[11px] text-slate-400 font-bold">ج.م</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  إذا حوّل العميل مبلغاً يقل ضمن هذا الهامش (مثلاً رسوم تحويل)، يتم قبوله تلقائياً دون تعليق.
                </span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 shadow-sm"
            >
              <Save className="w-4 h-4" />
              {saving ? 'جاري الحفظ...' : 'حفظ سياسة الدفع والعربون'}
            </button>
          </div>
        </div>

        {/* Right 1 col: Live Preview & Explainer */}
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-cyan-900/10 via-slate-900/5 to-slate-900/10 dark:from-cyan-950/40 dark:to-slate-950/60 border border-cyan-500/20 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-cyan-800 dark:text-cyan-300 font-black text-xs">
              <Calculator className="w-4 h-4" />
              <span>معاينة حية لاحتساب العربون</span>
            </div>

            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              مثال: لطلب قيمته <span className="font-bold text-slate-900 dark:text-white">{sampleOrderTotal} ج.م</span>:
            </p>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">طريقة الحساب:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {depositType === 'percentage' ? `${depositValue}% من الإجمالي` : `${depositValue} ج.م ثابت`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">الحد الأدنى:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{minDeposit} ج.م</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="font-black text-slate-900 dark:text-white">العربون المطلوب:</span>
                <span className="font-black text-cyan-600 dark:text-cyan-400 text-sm">{previewDeposit} ج.م</span>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 leading-normal">
              سيطلب من العميل إيداع {previewDeposit} ج.م عند اختيار إحدى وسائل الدفع المعتمدة، وسيكون المتبقي عند الاستلام هو{' '}
              {sampleOrderTotal - previewDeposit} ج.م.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-xs">
              <HelpCircle className="w-4 h-4 text-slate-400" />
              <span>كيف تعمل مهلة الجلسة والمطابقة؟</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              تضمن ميزة الجلسات الحصرية عدم تحويل عميلين على نفس الرقم في نفس اللحظة لنفس القيمة، مما يضمن مطابقة آلية فورية 100% بدون الحاجة لطلب إيصالات أو صور تحويل من العملاء.
            </p>
          </div>
        </div>
      </form>
    </div>
  );
};
