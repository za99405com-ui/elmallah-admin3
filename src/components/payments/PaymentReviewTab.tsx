import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  MonitorSmartphone,
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
  created_at: string;
}

interface PaymentSession {
  id: string;
  orderId: string;
  provider: string;
  expectedAmount: number;
  status: string;
  paymentDestination?: string;
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

function generateProvisioningSecret(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const reasonLabels: Record<ReviewReason, string> = {
  no_match: 'No match',
  ambiguous: 'Ambiguous',
  underpaid: 'Underpaid',
  late_payment: 'Late payment',
  expired_customer_contacted_support: 'Expired + Support',
};

const statusLabels: Record<string, string> = {
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
  const [saving, setSaving] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [reprovisioningId, setReprovisioningId] = useState<string | null>(null);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [provisioningSecret, setProvisioningSecret] = useState<string | null>(null);
  const [provisioningDeviceName, setProvisioningDeviceName] = useState<string | null>(null);

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
    void loadOverview();
    const timer = window.setInterval(() => void loadOverview(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  const saveSettings = async () => {
    try {
      setSaving(true);
      setError(null);
      await adminRequest<PaymentSettings>('/api/admin/payments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          defaultPaymentPolicy: policy,
          sessionTimeoutSeconds: timeoutSeconds,
          amountTolerance,
        }),
      });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الدفع');
    } finally {
      setSaving(false);
    }
  };

  const createDevice = async (event: React.FormEvent) => {
    event.preventDefault();
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
      setProvisioningDeviceName(deviceName);
      setShowDeviceForm(false);
      setDeviceId('');
      setDeviceName('');
      setPaymentDestination('');
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل جهاز الدفع');
    }
  };

  const reprovisionDevice = async (device: PaymentDevice) => {
    const confirmed = window.confirm(
      `سيتم إلغاء صلاحية المفتاح القديم لجهاز ${device.name} وإنشاء مفتاح جديد. هل تريد المتابعة؟`
    );
    if (!confirmed) return;

    try {
      setReprovisioningId(device.id);
      setError(null);
      const secret = generateProvisioningSecret();
      await adminRequest(`/api/admin/payments/devices/${device.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ provisioningSecret: secret }),
      });
      setProvisioningSecret(secret);
      setProvisioningDeviceName(device.name);
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إعادة تهيئة مفتاح الجهاز');
    } finally {
      setReprovisioningId(null);
    }
  };

  const resolveReview = async (
    reviewId: string,
    action: 'confirm_paid' | 'dismiss' | 'cancel_session'
  ) => {
    try {
      setResolvingId(reviewId);
      setError(null);
      await adminRequest(`/api/admin/payments/review/${reviewId}/resolve`, {
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

  if (loading) {
    return (
      <div className="min-h-[45vh] flex items-center justify-center gap-2 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" /> جاري تحميل منظومة الدفع...
      </div>
    );
  }

  const reviews = overview?.reviews || [];
  const devices = overview?.devices || [];
  const sessions = overview?.sessions || [];
  const underpaidCount = reviews.filter((item) => item.reason === 'underpaid').length;
  const lateCount = reviews.filter((item) => item.reason === 'late_payment').length;
  const supportCount = reviews.filter((item) => item.reason === 'expired_customer_contacted_support').length;

  return (
    <div dir="rtl" className="space-y-5 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-cyan-500" />
            <h1 className="text-xl sm:text-2xl font-black">مركز الدفع والمراجعة</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            التطبيق يرسل Payment Event فقط؛ قرار المطابقة والتأكيد يصدر من admin3.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowDeviceForm((value) => !value)}
            className="rounded-xl bg-cyan-500 text-slate-950 px-3 py-2 text-xs font-black flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> جهاز دفع
          </button>
          <button
            onClick={() => void loadOverview()}
            className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-bold flex items-center gap-1"
          >
            <RefreshCw className="w-4 h-4" /> تحديث
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm font-bold text-rose-600 dark:text-rose-300">
          {error}
        </div>
      )}

      {provisioningSecret && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4">
          <div className="flex items-center gap-2 font-black text-amber-700 dark:text-amber-300">
            <ShieldCheck className="w-5 h-5" /> مفتاح HMAC — يظهر مرة واحدة
          </div>
          {provisioningDeviceName && (
            <div className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">
              الجهاز: {provisioningDeviceName}
            </div>
          )}
          <code dir="ltr" className="block bg-slate-950 text-emerald-300 rounded-lg p-3 mt-2 text-xs break-all select-all">
            {provisioningSecret}
          </code>
          <div className="mt-2 text-[11px] font-bold text-amber-700 dark:text-amber-300">
            انسخ المفتاح الآن وضعه في تطبيق Payment Bridge. بمجرد إخفائه لن يعرضه النظام مرة أخرى.
          </div>
          <button
            onClick={() => {
              setProvisioningSecret(null);
              setProvisioningDeviceName(null);
            }}
            className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-300"
          >
            إخفاء المفتاح
          </button>
        </div>
      )}

      {showDeviceForm && (
        <form onSubmit={createDevice} className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4">
          <input required value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="Device ID من التطبيق" className="rounded-xl bg-transparent border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm" />
          <input required value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="اسم الجهاز" className="rounded-xl bg-transparent border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm" />
          <input required value={paymentDestination} onChange={(e) => setPaymentDestination(e.target.value)} placeholder="رقم المحفظة / وجهة التحويل" className="rounded-xl bg-transparent border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm" />
          <div className="flex items-center gap-5 text-xs font-bold">
            <label className="flex items-center gap-2"><input type="checkbox" checked={vfCashEnabled} onChange={(e) => setVfCashEnabled(e.target.checked)} /> VF-Cash</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={bankEnabled} onChange={(e) => setBankEnabled(e.target.checked)} /> Bank-AlAhly</label>
          </div>
          <button type="submit" className="md:col-span-2 rounded-xl bg-cyan-500 text-slate-950 py-2 text-sm font-black">تسجيل الجهاز</button>
        </form>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="مراجعات مفتوحة" value={reviews.length} />
        <Metric label="Underpaid" value={underpaidCount} />
        <Metric label="Late payment" value={lateCount} />
        <Metric label="Expired + Support" value={supportCount} />
      </div>

      <section className="rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-black">الإعدادات العامة للدفع</h2>
            <p className="text-[11px] text-slate-500">القيمة الافتراضية: 120 ثانية، وهامش المبلغ قابل للتعديل.</p>
          </div>
          <button onClick={() => void saveSettings()} disabled={saving} className="rounded-xl bg-cyan-500 text-slate-950 px-3 py-2 text-xs font-black flex items-center gap-1 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs font-bold">
            Global default
            <select value={policy} onChange={(e) => setPolicy(e.target.value as PaymentSettings['defaultPaymentPolicy'])} className="mt-1 w-full rounded-xl bg-transparent border border-slate-300 dark:border-slate-700 px-3 py-2">
              <option value="cod_allowed">COD مسموح</option>
              <option value="deposit_required">العربون إجباري</option>
            </select>
          </label>
          <label className="text-xs font-bold">
            Timeout بالثواني
            <input type="number" min={30} max={600} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} className="mt-1 w-full rounded-xl bg-transparent border border-slate-300 dark:border-slate-700 px-3 py-2" />
          </label>
          <label className="text-xs font-bold">
            Amount tolerance بالجنيه
            <input type="number" min={0} step="0.01" value={amountTolerance} onChange={(e) => setAmountTolerance(Number(e.target.value))} className="mt-1 w-full rounded-xl bg-transparent border border-slate-300 dark:border-slate-700 px-3 py-2" />
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2"><MonitorSmartphone className="w-5 h-5 text-cyan-500" /><h2 className="font-black">أجهزة الدفع</h2></div>
        {devices.length === 0 ? (
          <EmptyState text="لا توجد أجهزة دفع مسجلة بعد." />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {devices.map((device) => {
              const reprovisioning = reprovisioningId === device.id;
              return (
                <div key={device.id} className="rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-black">{device.name}</div>
                      <div dir="ltr" className="text-[11px] text-slate-500">{device.deviceId}</div>
                      <div className="text-sm font-bold text-cyan-600 dark:text-cyan-400 mt-1">{device.paymentDestination}</div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-[11px] font-black flex items-center gap-1 ${device.online ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-500'}`}>
                      {device.online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}{device.online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                    <Status ok={device.internetConnected} label="Internet" />
                    <Status ok={device.appRunning} label="App/Service" />
                    <Status ok={device.notificationListenerEnabled} label="Listener" />
                    <Status ok={!device.busy} label={device.busy ? 'Busy' : 'Available'} />
                  </div>
                  <div className="flex gap-2 mt-3 text-[10px] font-black">
                    <span className={device.vfCashEnabled ? 'text-emerald-600' : 'text-slate-400'}>VF-Cash {device.vfCashEnabled ? 'ON' : 'OFF'}</span>
                    <span className={device.bankAlAhlyEnabled ? 'text-emerald-600' : 'text-slate-400'}>Bank-AlAhly {device.bankAlAhlyEnabled ? 'ON' : 'OFF'}</span>
                  </div>
                  <button
                    type="button"
                    disabled={reprovisioning}
                    onClick={() => void reprovisionDevice(device)}
                    className="mt-4 w-full rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {reprovisioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    إعادة تهيئة المفتاح
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-black">قائمة المراجعة اليدوية</h2>
        {reviews.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center text-emerald-600 font-bold"><CheckCircle2 className="w-7 h-7 mx-auto mb-2" />لا توجد حالات معلقة.</div>
        ) : reviews.map((review) => {
          const busy = resolvingId === review.id;
          return (
            <div key={review.id} className="rounded-2xl bg-white dark:bg-[#111827] border border-amber-500/30 p-4">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /><span className="font-black">{reasonLabels[review.reason]}</span>{review.order_id && <span className="text-[10px] text-slate-500">Order {review.order_id}</span>}</div>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                    {review.expected_amount != null && <span>Expected {Number(review.expected_amount).toFixed(2)}</span>}
                    {review.received_amount != null && <span>Received {Number(review.received_amount).toFixed(2)}</span>}
                    {review.amount_difference != null && <span>Diff {Number(review.amount_difference).toFixed(2)}</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">{new Date(review.created_at).toLocaleString('ar-EG')}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {review.session_id && review.reason !== 'no_match' && <button disabled={busy} onClick={() => void resolveReview(review.id, 'confirm_paid')} className="rounded-lg bg-emerald-500 text-white px-3 py-1.5 text-xs font-black disabled:opacity-50">تأكيد الدفع</button>}
                  {review.session_id && <button disabled={busy} onClick={() => void resolveReview(review.id, 'cancel_session')} className="rounded-lg bg-rose-500/10 text-rose-600 px-3 py-1.5 text-xs font-black disabled:opacity-50">إلغاء الجلسة</button>}
                  <button disabled={busy} onClick={() => void resolveReview(review.id, 'dismiss')} className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-black disabled:opacity-50">Dismiss</button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="font-black mb-3">آخر الجلسات</h2>
        <div className="overflow-x-auto rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500"><tr><th className="p-3 text-right">Order</th><th className="p-3 text-right">Provider</th><th className="p-3 text-right">Expected</th><th className="p-3 text-right">Status</th><th className="p-3 text-right">Destination</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sessions.slice(0, 25).map((session) => <tr key={session.id}><td className="p-3 font-bold">{session.orderId}</td><td className="p-3">{session.provider}</td><td className="p-3">{session.expectedAmount.toFixed(2)} ج.م</td><td className="p-3">{statusLabels[session.status] || session.status}</td><td dir="ltr" className="p-3">{session.paymentDestination || '—'}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3">
    <div className="text-2xl font-black">{value}</div><div className="text-[11px] text-slate-500">{label}</div>
  </div>
);

const Status: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <div className="flex items-center gap-1.5">{ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-rose-500" />}<span>{label}</span></div>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500">{text}</div>
);
