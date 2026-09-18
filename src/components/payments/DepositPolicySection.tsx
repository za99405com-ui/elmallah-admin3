import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Clock,
  HelpCircle,
  Save,
  ShieldCheck,
} from 'lucide-react';

export interface DepositPolicySettings {
  defaultPaymentPolicy: 'cod_allowed' | 'deposit_required';
  depositEnabled?: boolean;
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
  const [depositEnabled, setDepositEnabled] = useState(
    Boolean(settings.depositEnabled ?? settings.depositRequired)
  );
  const [depositRequired, setDepositRequired] = useState(Boolean(settings.depositRequired));
  const [depositType, setDepositType] = useState<'fixed' | 'percentage'>(
    settings.depositType || 'fixed'
  );
  const [depositValue, setDepositValue] = useState(settings.depositValue ?? 100);
  const [minimumDeposit, setMinimumDeposit] = useState(
    settings.minimumDeposit ?? settings.minDeposit ?? 50
  );
  const [sessionTimeoutSeconds, setSessionTimeoutSeconds] = useState(
    settings.sessionTimeoutSeconds || 120
  );
  const [amountTolerance, setAmountTolerance] = useState(settings.amountTolerance ?? 10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDepositEnabled(Boolean(settings.depositEnabled ?? settings.depositRequired));
    setDepositRequired(Boolean(settings.depositRequired));
    setDepositType(settings.depositType || 'fixed');
    setDepositValue(settings.depositValue ?? 100);
    setMinimumDeposit(settings.minimumDeposit ?? settings.minDeposit ?? 50);
    setSessionTimeoutSeconds(settings.sessionTimeoutSeconds || 120);
    setAmountTolerance(settings.amountTolerance ?? 10);
  }, [settings]);

  const preview = useMemo(() => {
    const total = 500;
    if (!depositEnabled) return { total, amount: 0, remaining: total };
    let amount =
      depositType === 'percentage'
        ? Math.round((total * Number(depositValue || 0)) / 100)
        : Number(depositValue || 0);
    amount = Math.max(Number(minimumDeposit || 0), amount);
    amount = Math.min(total, Math.max(0, amount));
    return { total, amount, remaining: total - amount };
  }, [depositEnabled, depositType, depositValue, minimumDeposit]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await adminRequest('/api/admin/payments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          defaultPaymentPolicy: depositRequired ? 'deposit_required' : 'cod_allowed',
          depositEnabled: depositEnabled || depositRequired,
          depositRequired,
          depositType,
          depositValue: Number(depositValue),
          minimumDeposit: Number(minimumDeposit),
          sessionTimeoutSeconds: Number(sessionTimeoutSeconds),
          amountTolerance: Number(amountTolerance),
        }),
      });
      setSuccess('تم حفظ إعدادات الدفع والعربون');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الدفع');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            إعدادات العربون وجلسة الدفع
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            افصل بسهولة بين إتاحة العربون كخيار للعميل وبين إلزامه به.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white mb-3">
              ما الذي سيظهر للعميل؟
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  depositEnabled
                    ? 'border-cyan-500 bg-cyan-50/50 dark:bg-cyan-950/40'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={depositEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setDepositEnabled(checked);
                      if (!checked) setDepositRequired(false);
                    }}
                    className="mt-0.5 w-4 h-4 rounded text-cyan-600"
                  />
                  <div>
                    <div className="font-black text-xs text-slate-900 dark:text-white">
                      إظهار خيار دفع عربون
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      يظهر «دفع عربون» بجانب فودافون كاش وإنستاباي والدفع عند الاستلام إذا كانت الطرق مفعلة.
                    </div>
                  </div>
                </div>
              </label>

              <label
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  depositRequired
                    ? 'border-amber-500 bg-amber-50/60 dark:bg-amber-950/30'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={depositRequired}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setDepositRequired(checked);
                      if (checked) setDepositEnabled(true);
                    }}
                    className="mt-0.5 w-4 h-4 rounded text-amber-600"
                  />
                  <div>
                    <div className="font-black text-xs text-slate-900 dark:text-white">
                      العربون إجباري
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      عند تفعيله لا يظهر الدفع عند الاستلام إذا كان سيؤدي لتجاوز العربون المطلوب.
                    </div>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {depositEnabled && (
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-black text-slate-900 dark:text-white mb-3">
                قيمة العربون
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">طريقة الحساب</label>
                  <select
                    value={depositType}
                    onChange={(e) => setDepositType(e.target.value as 'fixed' | 'percentage')}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  >
                    <option value="fixed">مبلغ ثابت</option>
                    <option value="percentage">نسبة مئوية</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {depositType === 'percentage' ? 'النسبة (%)' : 'المبلغ (ج.م)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={depositValue}
                    onChange={(e) => setDepositValue(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">الحد الأدنى (ج.م)</label>
                  <input
                    type="number"
                    min="0"
                    value={minimumDeposit}
                    onChange={(e) => setMinimumDeposit(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-black text-slate-900 dark:text-white">جلسة الدفع والمطابقة</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">مهلة الدفع بالثواني</label>
                <input
                  type="number"
                  min="30"
                  max="600"
                  value={sessionTimeoutSeconds}
                  onChange={(e) => setSessionTimeoutSeconds(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">هامش فرق المبلغ (ج.م)</label>
                <input
                  type="number"
                  min="0"
                  value={amountTolerance}
                  onChange={(e) => setAmountTolerance(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold disabled:opacity-50 shadow-sm"
            >
              <Save className="w-4 h-4" />
              {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gradient-to-br from-cyan-900/10 via-slate-900/5 to-slate-900/10 dark:from-cyan-950/40 dark:to-slate-950/60 border border-cyan-500/20 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-cyan-800 dark:text-cyan-300 font-black text-xs">
              <Calculator className="w-4 h-4" />
              معاينة سريعة
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              مثال لطلب بقيمة <strong>{preview.total} ج.م</strong>
            </p>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">العربون:</span>
                <strong className="text-cyan-700 dark:text-cyan-300">{preview.amount} ج.م</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">المتبقي:</span>
                <strong>{preview.remaining} ج.م</strong>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">الحالة:</span>
                <strong>{!depositEnabled ? 'العربون مخفي' : depositRequired ? 'إجباري' : 'اختياري'}</strong>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-xs mb-2">
              <HelpCircle className="w-4 h-4 text-slate-400" />
              النتيجة في موقع العميل
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              فودافون كاش وإنستاباي يظهران كسداد كامل. خيار العربون يظهر فقط عند تفعيله، والدفع عند الاستلام يتحكم به قسم «طرق الدفع الظاهرة للعميل».
            </p>
          </div>
        </div>
      </form>
    </div>
  );
};
