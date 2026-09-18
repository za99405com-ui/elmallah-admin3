import React, { useEffect, useState } from 'react';
import {
  BadgeDollarSign,
  Loader2,
  RefreshCw,
  Truck,
  WalletCards,
  Zap,
} from 'lucide-react';

export interface SimplePaymentState {
  vodafoneCash: boolean;
  instaPay: boolean;
  deposit: boolean;
  cashOnDelivery: boolean;
  depositType: 'fixed' | 'percentage';
  depositValue: number;
  minimumDeposit: number;
  sessionTimeoutSeconds: number;
}

interface SimplePaymentSettingsSectionProps {
  adminRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
  onRefresh?: () => Promise<void> | void;
}

type ToggleKey = 'vodafoneCash' | 'instaPay' | 'deposit' | 'cashOnDelivery';

const toggleMeta: Array<{
  key: ToggleKey;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: 'vodafoneCash',
    title: 'فودافون كاش',
    description: 'إظهار فودافون كاش للعميل وتشغيل التقاط رسائله.',
    icon: WalletCards,
  },
  {
    key: 'instaPay',
    title: 'إنستا باي',
    description: 'إظهار إنستا باي للعميل وتشغيل التقاط رسائله.',
    icon: Zap,
  },
  {
    key: 'deposit',
    title: 'العربون',
    description: 'طلب عربون إلكتروني قبل تأكيد الطلب.',
    icon: BadgeDollarSign,
  },
  {
    key: 'cashOnDelivery',
    title: 'الدفع عند الاستلام',
    description: 'تأكيد الطلب بدون عربون والدفع عند الاستلام.',
    icon: Truck,
  },
];

export const SimplePaymentSettingsSection: React.FC<SimplePaymentSettingsSectionProps> = ({
  adminRequest,
  onRefresh,
}) => {
  const [state, setState] = useState<SimplePaymentState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const data = await adminRequest<SimplePaymentState>('/api/admin/payments/simple-settings');
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل إعدادات الدفع');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveState = async (next: SimplePaymentState, changed: string) => {
    try {
      setBusyKey(changed);
      setError(null);
      setSaved(null);
      const result = await adminRequest<SimplePaymentState>('/api/admin/payments/simple-settings', {
        method: 'PUT',
        body: JSON.stringify({ ...next, changed }),
      });
      setState(result);
      setSaved('تم حفظ إعدادات الدفع وربطها بالمتجر وتطبيق جسر المدفوعات.');
      await onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الدفع');
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const toggle = async (key: ToggleKey) => {
    if (!state || busyKey) return;
    const next: SimplePaymentState = { ...state, [key]: !state[key] };

    if (key === 'deposit') {
      next.deposit = !state.deposit;
      next.cashOnDelivery = !next.deposit;
    }
    if (key === 'cashOnDelivery') {
      next.cashOnDelivery = !state.cashOnDelivery;
      next.deposit = !next.cashOnDelivery;
    }

    await saveState(next, key);
  };

  if (!state) {
    return (
      <div className="min-h-[260px] flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          جاري تحميل إعدادات الدفع...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
              إعدادات الدفع
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              أربع اختيارات فقط. العربون والدفع عند الاستلام مرتبطان عكسيًا تلقائيًا.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={Boolean(busyKey)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </button>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {toggleMeta.map((item) => {
            const Icon = item.icon;
            const enabled = state[item.key];
            const busy = busyKey === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => void toggle(item.key)}
                disabled={Boolean(busyKey)}
                className={[
                  'relative text-right rounded-2xl border p-4 min-h-[150px] transition-all disabled:opacity-60',
                  enabled
                    ? 'border-cyan-500 bg-cyan-50/80 dark:bg-cyan-950/30 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={[
                      'w-10 h-10 rounded-xl flex items-center justify-center',
                      enabled
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-500',
                    ].join(' ')}
                  >
                    {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <span
                    className={[
                      'px-2.5 py-1 rounded-full text-[10px] font-black',
                      enabled
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
                    ].join(' ')}
                  >
                    {enabled ? 'مفعّل' : 'متوقف'}
                  </span>
                </div>
                <div className="mt-4 text-sm font-black text-slate-900 dark:text-white">{item.title}</div>
                <div className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                  {item.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {state.deposit && (
        <div className="rounded-2xl border border-cyan-200 dark:border-cyan-900 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">إعداد العربون</h3>
            <p className="text-[11px] text-slate-500 mt-1">
              يظهر فقط عندما يكون وضع العربون مفعّلًا.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">طريقة الحساب</span>
              <select
                value={state.depositType}
                onChange={(e) =>
                  setState((prev) =>
                    prev ? { ...prev, depositType: e.target.value as 'fixed' | 'percentage' } : prev
                  )
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm font-bold"
              >
                <option value="fixed">مبلغ ثابت</option>
                <option value="percentage">نسبة مئوية</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {state.depositType === 'fixed' ? 'قيمة العربون (جنيه)' : 'نسبة العربون (%)'}
              </span>
              <input
                type="number"
                min="0"
                max={state.depositType === 'percentage' ? 100 : undefined}
                value={state.depositValue}
                onChange={(e) =>
                  setState((prev) => (prev ? { ...prev, depositValue: Number(e.target.value) } : prev))
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm font-bold"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">الحد الأدنى (جنيه)</span>
              <input
                type="number"
                min="0"
                value={state.minimumDeposit}
                onChange={(e) =>
                  setState((prev) => (prev ? { ...prev, minimumDeposit: Number(e.target.value) } : prev))
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm font-bold"
              />
            </label>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={() => void saveState(state, 'depositDetails')}
              disabled={Boolean(busyKey)}
              className="rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white px-5 py-2.5 text-xs font-black disabled:opacity-50"
            >
              {busyKey === 'depositDetails' ? 'جارٍ الحفظ...' : 'حفظ قيمة العربون'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 px-4 py-3 text-xs font-bold text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {saved && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30 px-4 py-3 text-xs font-bold text-emerald-700 dark:text-emerald-300">
          {saved}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-4 text-xs leading-6 text-slate-600 dark:text-slate-400">
        <strong className="text-slate-900 dark:text-white">الربط التلقائي:</strong> تفعيل فودافون كاش أو إنستا باي
        يحدّث طريقة الدفع في المتجر ومصدر الرسائل في تطبيق الجسر معًا. تفعيل العربون يوقف الدفع عند
        الاستلام، وتفعيل الدفع عند الاستلام يوقف العربون.
      </div>
    </div>
  );
};
