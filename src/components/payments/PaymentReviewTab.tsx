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
  ShieldAlert,
  Layers,
  Settings,
  Wifi,
  WifiOff,
  Clock,
} from 'lucide-react';
import { getStoredToken } from '../../lib/api';
import { ProblemOrdersSection, ProblemOrder } from './ProblemOrdersSection';
import { SimplePaymentSettingsSection } from './SimplePaymentSettingsSection';

type ReviewReason =
  | 'no_match'
  | 'ambiguous'
  | 'underpaid'
  | 'late_payment'
  | 'expired_customer_contacted_support';

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
  expectedPayerPhone?: string;
  createdAt?: string;
  expiresAt?: string;
}

interface OverviewResponse {
  reviews: PaymentReviewItem[];
  sessions: PaymentSession[];
  problemOrders?: ProblemOrder[];
}

interface PaymentReviewTabProps {
  initialTab?: 'setup' | 'problems' | 'reviews';
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

const reasonLabels: Record<ReviewReason, string> = {
  no_match: 'عدم تطابق (No match)',
  ambiguous: 'تحويل ملتبس / غير محدد (Ambiguous)',
  underpaid: 'مبلغ أقل من المطلوب (Underpaid)',
  late_payment: 'تحويل متأخر بعد انتهاء الجلسة (Late payment)',
  expired_customer_contacted_support: 'منتهية مع تواصل الدعم (Expired + Support)',
};

const statusLabels: Record<string, string> = {
  waiting: 'بانتظار الدفع',
  paid: 'تم الدفع بنجاح',
  expired: 'انتهت المهلة',
  expired_needs_review: 'منتهية وتحتاج مراجعة',
  needs_review: 'تحتاج مراجعة',
  cancelled: 'ملغاة',
};

const cairoDateTime = new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatCairoDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : cairoDateTime.format(date);
}

export const PaymentReviewTab: React.FC<PaymentReviewTabProps> = ({ initialTab = 'setup' }) => {
  const [activeSubTab, setActiveSubTab] = useState<'setup' | 'problems' | 'reviews'>(initialTab);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [problemOrders, setProblemOrders] = useState<ProblemOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadAllData = useCallback(async () => {
    try {
      setError(null);
      const overviewData = await adminRequest<OverviewResponse>('/api/admin/payments/overview');
      setOverview(overviewData);

      setProblemOrders(overviewData.problemOrders ?? []);
    } catch (err) {
      console.error('[PaymentReviewTab] Load failed:', err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات منظومة الدفع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void loadAllData();
    };

    const timer = window.setInterval(refreshIfVisible, 45_000);
    document.addEventListener('visibilitychange', refreshIfVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadAllData]);

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
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إغلاق حالة المراجعة');
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-7 h-7 animate-spin text-cyan-600" />
        <span className="text-xs font-bold">جاري تحميل مركز المدفوعات...</span>
      </div>
    );
  }

  const reviews = overview?.reviews || [];
  const sessions = overview?.sessions || [];

  const openReviewsCount = reviews.filter((r) => r.status === 'open').length;
  const problemCount = problemOrders.length;

  return (
    <div dir="rtl" className="space-y-6 pb-12">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-cyan-50 dark:bg-cyan-950/60 rounded-xl text-cyan-600 dark:text-cyan-400">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                مركز المدفوعات والمراجعة
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                إدارة طرق الدفع والأجهزة المتصلة والعربون ومراجعة التحويلات في مكان واحد.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadAllData()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث البيانات
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Primary Navigation Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto p-1.5 bg-slate-100 dark:bg-slate-950/80 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-bold">
        <button
          onClick={() => setActiveSubTab('setup')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap ${
            activeSubTab === 'setup'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-black'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Settings className="w-4 h-4 text-cyan-500" />
          <span>إعدادات الدفع</span>
        </button>

        <button
          onClick={() => setActiveSubTab('problems')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap ${
            activeSubTab === 'problems'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-black'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-amber-500" />
          <span>طلبات تحتاج مراجعة</span>
          {problemCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white animate-pulse">
              {problemCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('reviews')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap ${
            activeSubTab === 'reviews'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-black'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-cyan-500" />
          <span>مراجعات التحويلات والجلسات</span>
          {openReviewsCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-cyan-600 text-white">
              {openReviewsCount}
            </span>
          )}
        </button>

      </div>

      {/* Tab Contents */}
      {activeSubTab === 'setup' && (
        <SimplePaymentSettingsSection adminRequest={adminRequest} onRefresh={loadAllData} />
      )}

      {activeSubTab === 'problems' && (
        <ProblemOrdersSection
          problemOrders={problemOrders}
          onRefresh={loadAllData}
          adminRequest={adminRequest}
        />
      )}

      {activeSubTab === 'reviews' && (
        <div className="space-y-6">
          {/* Quick Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <div className="text-2xl font-black text-slate-900 dark:text-white">{reviews.length}</div>
              <div className="text-xs text-slate-500 font-bold mt-1">إجمالي حالات المراجعة</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <div className="text-2xl font-black text-amber-600">
                {reviews.filter((r) => r.reason === 'underpaid').length}
              </div>
              <div className="text-xs text-slate-500 font-bold mt-1">مبالغ ناقصة (Underpaid)</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <div className="text-2xl font-black text-purple-600">
                {reviews.filter((r) => r.reason === 'late_payment').length}
              </div>
              <div className="text-xs text-slate-500 font-bold mt-1">تحويلات متأخرة (Late)</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <div className="text-2xl font-black text-rose-600">
                {reviews.filter((r) => r.reason === 'no_match' || r.reason === 'ambiguous').length}
              </div>
              <div className="text-xs text-slate-500 font-bold mt-1">غير متطابقة / ملتبسة</div>
            </div>
          </div>

          {/* Reviews List */}
          <section className="space-y-3">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              حالات المراجعة المالية المفتوحة
            </h3>
            {reviews.length === 0 ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center text-emerald-600 font-bold">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                لا توجد حالات مراجعة معلقة حالياً.
              </div>
            ) : (
              reviews.map((review) => {
                const busy = resolvingId === review.id;
                return (
                  <div
                    key={review.id}
                    className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm"
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <span className="font-black text-xs text-slate-900 dark:text-white">
                            {reasonLabels[review.reason] || review.reason}
                          </span>
                          {review.order_id && (
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-300">
                              طلب رقم {review.order_id}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 mt-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                          {review.expected_amount != null && (
                            <span>المطلوب: {Number(review.expected_amount).toFixed(2)} ج.م</span>
                          )}
                          {review.received_amount != null && (
                            <span>المستلم: {Number(review.received_amount).toFixed(2)} ج.م</span>
                          )}
                          {review.amount_difference != null && (
                            <span className="text-amber-600">
                              الفرق: {Number(review.amount_difference).toFixed(2)} ج.م
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">
                          {formatCairoDateTime(review.created_at)}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 shrink-0">
                        {review.session_id && review.reason !== 'no_match' && (
                          <button
                            disabled={busy}
                            onClick={() => void resolveReview(review.id, 'confirm_paid')}
                            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
                          >
                            تأكيد الدفع
                          </button>
                        )}
                        {review.session_id && (
                          <button
                            disabled={busy}
                            onClick={() => void resolveReview(review.id, 'cancel_session')}
                            className="rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 px-3.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
                          >
                            إلغاء الجلسة
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => void resolveReview(review.id, 'dismiss')}
                          className="rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                        >
                          تجاهل
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* Live Sessions Monitor */}
          <section className="space-y-3">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              سجل جلسات الدفع الأخيرة (Live Sessions)
            </h3>
            <div className="overflow-x-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-100 dark:border-slate-800">
                  <tr>
                    <th className="p-3 text-right">الطلب</th>
                    <th className="p-3 text-right">المزود / المصدر</th>
                    <th className="p-3 text-right">المبلغ المطلوب</th>
                    <th className="p-3 text-right">رقم المُحوِّل</th>
                    <th className="p-3 text-right">بدأت</th>
                    <th className="p-3 text-right">تنتهي</th>
                    <th className="p-3 text-right">الحالة</th>
                    <th className="p-3 text-right">وجهة الاستقبال</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                  {sessions.slice(0, 25).map((session) => (
                    <tr key={session.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="p-3 font-bold text-slate-900 dark:text-white">
                        {session.orderId}
                      </td>
                      <td className="p-3">{session.provider}</td>
                      <td className="p-3 font-bold">{session.expectedAmount.toFixed(2)} ج.م</td>
                      <td dir="ltr" className="p-3 font-mono text-left">
                        {session.expectedPayerPhone || '—'}
                      </td>
                      <td className="p-3 whitespace-nowrap">{formatCairoDateTime(session.createdAt)}</td>
                      <td className="p-3 whitespace-nowrap">{formatCairoDateTime(session.expiresAt)}</td>
                      <td className="p-3">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            session.status === 'paid'
                              ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                              : session.status === 'waiting'
                              ? 'bg-cyan-50 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {statusLabels[session.status] || session.status}
                        </span>
                      </td>
                      <td dir="ltr" className="p-3 font-mono text-slate-500 text-left">
                        {session.paymentDestination || '—'}
                      </td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-slate-400">
                        لا توجد جلسات دفع مسجلة حالياً
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
