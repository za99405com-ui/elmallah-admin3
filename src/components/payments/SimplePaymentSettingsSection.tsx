import React, { useEffect, useState } from 'react';
import {
  BadgeDollarSign,
  Clock3,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Save,
  Smartphone,
  Truck,
  WalletCards,
  Zap,
} from 'lucide-react';

export interface PaymentMessageSampleSettings {
  code: 'vf_cash' | 'instapay';
  label: string;
  appName: string | null;
  packageName: string | null;
  senderTitle: string | null;
  sampleMessage: string | null;
  configured: boolean;
}

export interface SimplePaymentState {
  vodafoneCash: boolean;
  instaPay: boolean;
  deposit: boolean;
  cashOnDelivery: boolean;
  depositType: 'fixed' | 'percentage';
  depositValue: number;
  minimumDeposit: number;
  sessionTimeoutSeconds: number;
  bridgeDevice: {
    deviceId: string;
    name: string;
    appVersion: string | null;
    lastHeartbeatAt: string | null;
  } | null;
  messageSamples: {
    vodafoneCash: PaymentMessageSampleSettings;
    instaPay: PaymentMessageSampleSettings;
  };
}

interface SimplePaymentSettingsSectionProps {
  adminRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
  onRefresh?: () => Promise<void> | void;
}

type ToggleKey = 'vodafoneCash' | 'instaPay' | 'deposit' | 'cashOnDelivery';
type SampleKey = 'vodafoneCash' | 'instaPay';

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

const timeoutOptions = [
  { seconds: 60, label: 'دقيقة واحدة' },
  { seconds: 120, label: 'دقيقتان' },
  { seconds: 180, label: '3 دقائق' },
  { seconds: 300, label: '5 دقائق' },
  { seconds: 600, label: '10 دقائق' },
];

export const SimplePaymentSettingsSection: React.FC<SimplePaymentSettingsSectionProps> = ({
  adminRequest,
  onRefresh,
}) => {
  const [state, setState] = useState<SimplePaymentState | null>(null);
  const [sampleDrafts, setSampleDrafts] = useState<Record<SampleKey, string>>({
    vodafoneCash: '',
    instaPay: '',
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const applyLoadedState = (data: SimplePaymentState) => {
    setState(data);
    setSampleDrafts({
      vodafoneCash: data.messageSamples?.vodafoneCash?.sampleMessage || '',
      instaPay: data.messageSamples?.instaPay?.sampleMessage || '',
    });
  };

  const load = async () => {
    try {
      setError(null);
      const data = (await adminRequest('/api/admin/payments/simple-settings')) as SimplePaymentState;
      applyLoadedState(data);
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
      const result = (await adminRequest('/api/admin/payments/simple-settings', {
        method: 'PUT',
        body: JSON.stringify({
          vodafoneCash: next.vodafoneCash,
          instaPay: next.instaPay,
          deposit: next.deposit,
          cashOnDelivery: next.cashOnDelivery,
          depositType: next.depositType,
          depositValue: next.depositValue,
          minimumDeposit: next.minimumDeposit,
          sessionTimeoutSeconds: next.sessionTimeoutSeconds,
          changed,
        }),
      })) as SimplePaymentState;
      applyLoadedState(result);
      setSaved('تم حفظ الإعدادات وربطها بالمتجر وتطبيق جسر المدفوعات.');
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

  const saveSample = async (key: SampleKey) => {
    if (!state || busyKey) return;
    const sample = state.messageSamples[key];
    const sampleMessage = sampleDrafts[key].trim();
    if (!sampleMessage) {
      setError('ضع رسالة ' + sample.label + ' كاملة أولاً');
      return;
    }

    try {
      setBusyKey('sample:' + key);
      setError(null);
      setSaved(null);
      const result = (await adminRequest('/api/admin/payments/message-samples/' + sample.code, {
        method: 'PUT',
        body: JSON.stringify({
          sampleMessage,
          appName: sample.appName,
          packageName: sample.packageName,
          senderTitle: sample.senderTitle,
        }),
      })) as SimplePaymentState;
      applyLoadedState(result);
      setSaved('تم حفظ عينة رسالة ' + sample.label + '.');
      await onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ عينة الرسالة');
    } finally {
      setBusyKey(null);
    }
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

  const isOldBridgeVersion =
    state.bridgeDevice?.appVersion &&
    /^1\.0(?:\.|$)/.test(state.bridgeDevice.appVersion);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
              إعدادات الدفع
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              فودافون كاش، إنستا باي، العربون، والدفع عند الاستلام — من مكان واحد.
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

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock3 className="w-5 h-5 text-cyan-600" />
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">وقت جلسة الدفع</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              المدة التي يظل فيها الطلب منتظرًا وصول التحويل قبل انتهاء الجلسة.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <label className="space-y-1.5 flex-1">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">مدة الانتظار</span>
            <select
              value={state.sessionTimeoutSeconds}
              onChange={(e) =>
                setState((prev) =>
                  prev ? { ...prev, sessionTimeoutSeconds: Number(e.target.value) } : prev
                )
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm font-bold"
            >
              {timeoutOptions.map((option) => (
                <option key={option.seconds} value={option.seconds}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => void saveState(state, 'sessionTimeout')}
            disabled={Boolean(busyKey)}
            className="rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white px-5 py-2.5 text-xs font-black disabled:opacity-50"
          >
            {busyKey === 'sessionTimeout' ? 'جارٍ الحفظ...' : 'حفظ وقت الجلسة'}
          </button>
        </div>
      </div>

      {state.deposit && (
        <div className="rounded-2xl border border-cyan-200 dark:border-cyan-900 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">إعداد العربون</h3>
            <p className="text-[11px] text-slate-500 mt-1">يظهر فقط عندما يكون وضع العربون مفعّلًا.</p>
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

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <div className="flex items-start gap-2 mb-4">
          <MessageSquareText className="w-5 h-5 text-cyan-600 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">عينات رسائل الدفع</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              ضع الرسالة الحقيقية بالكامل لكل طريقة. اختيار تطبيق الرسائل نفسه يتم من تطبيق الجسر على الهاتف.
            </p>
          </div>
        </div>

        {state.bridgeDevice && (
          <div
            className={[
              'mb-4 rounded-xl border px-3 py-2.5 text-xs',
              isOldBridgeVersion
                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
                : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300',
            ].join(' ')}
          >
            <div className="flex items-center gap-2 font-bold">
              <Smartphone className="w-4 h-4" />
              الجهاز: {state.bridgeDevice.name || state.bridgeDevice.deviceId}
              {state.bridgeDevice.appVersion ? ' — التطبيق v' + state.bridgeDevice.appVersion : ''}
            </div>
            {isOldBridgeVersion && (
              <div className="mt-1">
                النسخة المتصلة ما زالت 1.0؛ ثبّت النسخة 1.1 أو أحدث لكي يظهر إعداد الرسائل المبسّط داخل التطبيق.
              </div>
            )}
          </div>
        )}

        <div className="grid xl:grid-cols-2 gap-4">
          {(['vodafoneCash', 'instaPay'] as SampleKey[]).map((key) => {
            const sample = state.messageSamples[key];
            const saving = busyKey === 'sample:' + key;
            return (
              <div
                key={key}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/70 dark:bg-slate-950/30"
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">{sample.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {sample.appName || sample.packageName
                        ? 'تطبيق الرسائل: ' + (sample.appName || sample.packageName)
                        : 'تطبيق الرسائل لم يتم اختياره من الهاتف بعد'}
                    </div>
                  </div>
                  <span
                    className={[
                      'rounded-full px-2.5 py-1 text-[10px] font-black',
                      sample.configured
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
                    ].join(' ')}
                  >
                    {sample.configured ? 'جاهز' : 'يحتاج إعداد'}
                  </span>
                </div>

                <textarea
                  value={sampleDrafts[key]}
                  onChange={(e) =>
                    setSampleDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  placeholder={'الصق رسالة ' + sample.label + ' كاملة هنا كما تصل على الهاتف...'}
                  rows={7}
                  className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-xs leading-6"
                />

                <button
                  onClick={() => void saveSample(key)}
                  disabled={Boolean(busyKey)}
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-4 py-2.5 text-xs font-black disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  حفظ رسالة {sample.label}
                </button>
              </div>
            );
          })}
        </div>
      </div>

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
