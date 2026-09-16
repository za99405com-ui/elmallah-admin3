import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CreditCard,
  Loader2,
  MonitorSmartphone,
  PhoneCall,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { getStoredToken } from '../../lib/api';

type ReviewReason =
  | 'no_match'
  | 'ambiguous'
  | 'underpaid'
  | 'late_payment'
  | 'expired_customer_contacted_support';

interface PaymentDevice {
  id: string;
  deviceId: string;
  name: string;
  paymentDestination: string;
  isEnabled: boolean;
  vfCashEnabled: boolean;
  bankAlAhlyEnabled: boolean;
  online: boolean;
  internetConnected: boolean;
  appRunning: boolean;
  notificationListenerEnabled: boolean;
  busy: boolean;
  busySessionId?: string;
  lastHeartbeatAt?: string;
  lastEventAt?: string;
  appVersion?: string;
}

interface PaymentReviewItem {
  id: string;
  reason: ReviewReason;
  status: string;
  session_id?: string | null;
  event_id?: string | null;
  order_id?: string | null;
  expected_amount?: number | null;
  received_amount?: number | null;
  amount_difference?: number | null;
  details?: Record<string, unknown>;
  created_at: string;
}

interface PaymentSession {
  id: string;
  orderId: string;
  provider: string;
  expectedAmount: number;
  status: string;
  paymentDestination?: string;
  expiresAt: string;
  matchedAmount?: number;
  amountDifference?: number;
  createdAt: string;
}

interface PaymentSettings {
  defaultPaymentPolicy: 'cod_allowed' | 'deposit_required';
  sessionTimeoutSeconds: number;
  amountTolerance: number;
}

interface OverviewResponse {
  devices: PaymentDevice[];
  reviews: PaymentReviewItem[];
  sessions: PaymentSession[];
  settings: PaymentSettings;
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ طلب المدفوعات');
  return data as T;
}

const reasonLabels: Record<ReviewReason, { title: string; description: string }> = {
  no_match: { title: 'No match', description: 'وصل تحويل ولم نجد جلسة مناسبة على الجهاز والوقت المحددين.' },
  ambiguous: { title: 'Ambiguous', description: 'يوجد أكثر من احتمال أو المبلغ أعلى من هامش المطابقة المسموح.' },
  underpaid: { title: 'Underpaid', description: 'المبلغ المستلم أقل من المبلغ المطلوب ويحتاج قراراً يدوياً.' },
  late_payment: { title: 'Late payment', description: 'وصل التحويل بعد انتهاء مهلة جلسة الدفع.' },
  expired_customer_contacted_support: {
    title: 'Expired + Support',
    description: 'انتهت المهلة والعميل ضغط تواصل مع خدمة العملاء.',
  },
};

const statusLabel: Record<string, string> = {
  waiting: 'بانتظار الدفع',
  paid: 'تم الدفع',
  expired: 'انتهت المهلة',
  expired_needs_review: 'منتهية وتحتاج مراجعة',
  needs_review: 'تحتاج مراجعة',
  cancelled: 'ملغاة',
};

export const PaymentReviewTab: React.FC = () => {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [provisioningSecret, setProvisioningSecret] = useState<string | null>(null);

  const [policy, setPolicy] = useState<PaymentSettings['defaultPaymentPolicy']>('cod_allowed');
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [amountTolerance, setAmountTolerance] = useState(10);

  const [deviceId, setDeviceId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [paymentDestination, setPaymentDestination] = useState('');
  const [vfCashEnabled, setVfCashEnabled] = useState(true);
  const [bankEnabled, setBankEnabled] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      setError(null);
      const data = await adminRequest<OverviewResponse>('/api/admin/payments/overview');
      setOverview(data);
      setPolicy(data.settings.defaultPaymentPolicy);
      setTimeoutSeconds(data.settings.sessionTimeoutSeconds);
      setAmountTolerance(data.settings.amountTolerance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل مركز الدفع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    const interval = window.setInterval(loadOverview, 15_000);
    return () => window.clearInterval(interval);
  }, [loadOverview]);

  const counts = useMemo(() => {
    const reviews = overview?.reviews || [];
    return {
      open: reviews.length,
      underpaid: reviews.filter((r) => r.reason === 'underpaid').length,
      late: reviews.filter((r) => r.reason === 'late_payment').length,
      support: reviews.filter((r) => r.reason === 'expired_customer_contacted_support').length,
    };
  }, [overview]);

  const saveSettings = async () => {
    try {
      setSavingSettings(true);
      setError(null);
      const settings = await adminRequest<PaymentSettings>('/api/admin/payments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          defaultPaymentPolicy: policy,
          sessionTimeoutSeconds: Number(timeoutSeconds),
          amountTolerance: Number(amountTolerance),
        }),
      });
      setOverview((prev) => (prev ? { ...prev, settings } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الدفع');
    } finally {
      setSavingSettings(false);
    }
  };

  const resolveReview = async (id: string, action: 'confirm_paid' | 'dismiss' | 'cancel_session') => {
    try {
      setResolvingId(id);
      setError(null);
      await adminRequest(`/api/admin/payments/review/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إغلاق حالة المراجعة');
    } finally {
      setResolvingId(null);
    }
  };

  const createDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      const result = await adminRequest<{ provisioningSecret: string }>('/api/admin/payments/devices', {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          name: deviceName,
          paymentDestination,
          vfCashEnabled,
          bankAlAhlyEnabled: bankEnabled,
        }),
      });
      setProvisioningSecret(result.provisioningSecret);
      setShowAddDevice(false);
      setDeviceId('');
      setDeviceName('');
      setPaymentDestination('');
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل جهاز الدفع');
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin ml-2" />
        جاري تحميل منظومة الدفع...
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-5 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-cyan-500" />
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">مركز الدفع والمراجعة</h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            admin3 هو مصدر الحقيقة: التطبيق يرسل الحدث فقط، والسيرفر يطابق ويؤكد أو يحوّل للمراجعة.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddDevice((v) => !v)}
            className="px-3 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-black flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> جهاز دفع
          </button>
          <button
            onClick={loadOverview}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> تحديث
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300 px-4 py-3 text-sm font-bold">
          {error}
        </div>
      )}

      {provisioningSecret && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 font-black text-amber-700 dark:text-amber-300">
            <ShieldCheck className="w-5 h-5" /> مفتاح تهيئة الجهاز — يظهر مرة واحدة
          </div>
          <code dir="ltr" className="block mt-2 p-3 rounded-lg bg-slate-950 text-emerald-300 text-xs break-all select-all">
            {provisioningSecret}
          </code>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
            أدخل هذا المفتاح في إعدادات تطبيق Payment Bridge على الهاتف المطابق ثم امسحه من أي مكان غير آمن.
          </p>
          <button onClick={() => setProvisioningSecret(null)} className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-300">
            فهمت، إخفاء المفتاح
          </button>
        </div>
      )}

      {showAddDevice && (
        <form onSubmit={createDevice} className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required placeholder="Device ID من التطبيق" className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" />
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} required placeholder="اسم الجهاز — مثال: هاتف فودافون 1" className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" />
          <input value={paymentDestination} onChange={(e) => setPaymentDestination(e.target.value)} required placeholder="رقم المحفظة / وجهة التحويل" className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" />
          <div className="flex items-center gap-4 text-xs font-bold">
            <label className="flex items-center gap-2"><input type="checkbox" checked={vfCashEnabled} onChange={(e) => setVfCashEnabled(e.target.checked)} /> VF-Cash</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={bankEnabled} onChange={(e) => setBankEnabled(e.target.checked)} /> Bank-AlAhly</label>
          </div>
          <button type="submit" className="sm:col-span-2 rounded-xl bg-cyan-500 text-slate-950 py-2 font-black text-sm">تسجيل الجهاز وإصدار مفتاح HMAC</button>
        </form>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['مراجعات مفتوحة', counts.open, AlertTriangle],
          ['Underpaid', counts.underpaid, XCircle],
          ['Late payment', counts.late, Clock3],
          ['تواصل بعد الانتهاء', counts.support, PhoneCall],
        ].map(([label, value, Icon]) => (
          <div key={String(label)} className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
            <Icon className="w-5 h-5 text-cyan-500" />
            <div className="text-2xl font-black mt-2 text-slate-900 dark:text-white">{String(value)}</div>
            <div className="text-[11px] text-slate-500">{String(label)}</div>
          </div>
        ))}
      </div>

      <section className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-black text-slate-900 dark:text-white">الإعدادات العامة للدفع</h2>
            <p className="text-[11px] text-slate-500">تُنسخ قيمة المهلة وهامش المبلغ داخل كل Session وقت إنشائها.</p>
          </div>
          <button onClick={saveSettings} disabled={savingSettings} className="px-3 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-black flex items-center gap-1.5 disabled:opacity-50">
            {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
            Global default للحسابات الجديدة
            <select value={policy} onChange={(e) => setPolicy(e.target.value as PaymentSettings['defaultPaymentPolicy'])} className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2">
              <option value="cod_allowed">COD مسموح</option>
              <option value="deposit_required">العربون إجباري</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
            Session timeout بالثواني
            <input type="number" min={30} max={600} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2" />
          </label>
          <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
            Amount tolerance بالجنيه
            <input type="number" min={0} step="0.01" value={amountTolerance} onChange={(e) => setAmountTolerance(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2" />
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="w-5 h-5 text-cyan-500" />
          <h2 className="font-black text-slate-900 dark:text-white">أجهزة الدفع</h2>
        </div>
        {overview?.devices.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {overview.devices.map((device) => (
              <div key={device.id} className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-slate-900 dark:text-white">{device.name}</div>
                    <div className="text-[11px] text-slate-500" dir="ltr">{device.deviceId}</div>
                    <div className="text-sm font-bold text-cyan-600 dark:text-cyan-400 mt-1">{device.paymentDestination}</div>
                  </div>
                  <div className={`px-2 py-1 rounded-full text-[11px] font-black flex items-center gap-1 ${device.online ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-500'}`}>
                    {device.online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                    {device.online ? 'Online' : 'Offline'}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <StatusLine ok={device.internetConnected} label="Internet" />
                  <StatusLine ok={device.appRunning} label="App / Service" />
                  <StatusLine ok={device.notificationListenerEnabled} label="Notification Listener" />
                  <StatusLine ok={!device.busy} label={device.busy ? 'Busy' : 'Available'} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${device.vfCashEnabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-400'}`}>VF-Cash {device.vfCashEnabled ? 'ON' : 'OFF'}</span>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${device.bankAlAhlyEnabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-400'}`}>Bank-AlAhly {device.bankAlAhlyEnabled ? 'ON' : 'OFF'}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500">لا توجد أجهزة دفع مسجلة بعد.</div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-black text-slate-900 dark:text-white">قائمة المراجعة اليدوية</h2>
          <span className="text-[11px] text-slate-500">No match · Ambiguous · Underpaid · Late · Expired + Support</span>
        </div>
        {overview?.reviews.length ? overview.reviews.map((review) => {
          const reason = reasonLabels[review.reason] || { title: review.reason, description: '' };
          const busy = resolvingId === review.id;
          return (
            <div key={review.id} className="bg-white dark:bg-[#111827] rounded-2xl border border-amber-500/30 p-4">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                    <span className="font-black text-slate-900 dark:text-white">{reason.title}</span>
                    {review.order_id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500">Order {review.order_id}</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{reason.description}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-slate-600 dark:text-slate-300">
                    {review.expected_amount != null && <span>Expected: {Number(review.expected_amount).toFixed(2)} ج.م</span>}
                    {review.received_amount != null && <span>Received: {Number(review.received_amount).toFixed(2)} ج.م</span>}
                    {review.amount_difference != null && <span>Diff: {Number(review.amount_difference).toFixed(2)} ج.م</span>}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">{new Date(review.created_at).toLocaleString('ar-EG')}</div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {review.session_id && review.reason !== 'no_match' && (
                    <button disabled={busy} onClick={() => resolveReview(review.id, 'confirm_paid')} className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-black flex items-center gap-1 disabled:opacity-50">
                      <CheckCircle2 className="w-4 h-4" /> تأكيد الدفع
                    </button>
                  )}
                  {review.session_id && (
                    <button disabled={busy} onClick={() => resolveReview(review.id, 'cancel_session')} className="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-600 text-xs font-black disabled:opacity-50">إلغاء الجلسة</button>
                  )}
                  <button disabled={busy} onClick={() => resolveReview(review.id, 'dismiss')} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-black disabled:opacity-50">Dismiss</button>
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center text-emerald-600 dark:text-emerald-400 font-bold">
            <CheckCircle2 className="w-7 h-7 mx-auto mb-2" /> لا توجد حالات دفع معلقة للمراجعة.
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-black text-slate-900 dark:text-white">آخر الجلسات</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
              <tr><th className="p-3 text-right">Order</th><th className="p-3 text-right">Provider</th><th className="p-3 text-right">Expected</th><th className="p-3 text-right">Status</th><th className="p-3 text-right">Destination</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(overview?.sessions || []).slice(0, 25).map((session) => (
                <tr key={session.id}>
                  <td className="p-3 font-bold">{session.orderId}</td>
                  <td className="p-3">{session.provider}</td>
                  <td className="p-3">{session.expectedAmount.toFixed(2)} ج.م</td>
                  <td className="p-3"><span className="px-2 py-1 rounded-lg bg-slate-500/10 font-bold">{statusLabel[session.status] || session.status}</span></td>
                  <td className="p-3" dir="ltr">{session.paymentDestination || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const StatusLine: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <div className="flex items-center gap-1.5">
    {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-rose-500" />}
    <span className={ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>{label}</span>
  </div>
);
