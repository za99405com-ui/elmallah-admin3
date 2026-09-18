import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Phone,
  ArrowRight,
  ShieldAlert,
  CreditCard,
  DollarSign,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

export interface ProblemOrder {
  id: string;
  orderId: string;
  orderNumber?: string;
  customerName?: string;
  customerPhone?: string;
  orderStatus: string;
  totalAmount: number;
  expectedDeposit: number;
  paidAmount: number;
  depositStatus: 'pending' | 'rejected' | 'under_review' | 'partial';
  problemReason: string;
  problemDetails?: string;
  reviewItemId?: string;
  sessionId?: string;
  createdAt: string;
}

interface ProblemOrdersSectionProps {
  problemOrders: ProblemOrder[];
  onRefresh: () => Promise<void>;
  adminRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
  onNavigateToOrder?: (orderId: string) => void;
}

export const ProblemOrdersSection: React.FC<ProblemOrdersSectionProps> = ({
  problemOrders,
  onRefresh,
  adminRequest,
  onNavigateToOrder,
}) => {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleResolve = async (
    problem: ProblemOrder,
    action: 'confirm_paid' | 'cancel_session' | 'dismiss'
  ) => {
    const actionNames: Record<string, string> = {
      confirm_paid: 'تأكيد دفع العربون واعتماد الطلب',
      cancel_session: 'إلغاء جلسة الدفع',
      dismiss: 'تجاهل الملاحظة',
    };

    if (!confirm(`هل أنت متأكد من تنفيذ إجراء "${actionNames[action]}" للطلب ${problem.orderNumber || problem.orderId}؟`)) {
      return;
    }

    setResolvingId(problem.id);
    setError(null);
    setSuccess(null);

    try {
      if (problem.reviewItemId) {
        await adminRequest(`/api/admin/payments/review/${problem.reviewItemId}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ action }),
        });
      } else if (problem.sessionId) {
        if (action === 'confirm_paid') {
          await adminRequest(`/api/admin/payments/sessions/${problem.sessionId}/confirm-manual`, {
            method: 'POST',
          });
        } else {
          await adminRequest(`/api/payments/sessions/${problem.sessionId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason: 'admin_cancelled_problem_order' }),
          });
        }
      } else {
        throw new Error('لا توجد جلسة دفع أو حالة مراجعة مرتبطة بهذا الطلب');
      }

      setSuccess(`تم تنفيذ الإجراء بنجاح للطلب ${problem.orderNumber || problem.orderId}`);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء');
    } finally {
      setResolvingId(null);
    }
  };

  const getReasonBadge = (reason: string) => {
    switch (reason) {
      case 'underpaid':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300">مبلغ مدفوع أقل من المطلوب</span>;
      case 'late_payment':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300">وصول تحويل بعد انتهاء المهلة</span>;
      case 'ambiguous':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300">تحويل غير مؤكد / متعدد الجلسات</span>;
      case 'pending_deposit':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300">بانتظار تأكيد العربون</span>;
      case 'rejected_deposit':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300">عربون مرفوض / فشل التحويل</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{reason}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            طلبات تحتاج مراجعة مالية (Problem Orders)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            الطلبات التي واجهت فروقاً مالية، أو مبالغ أقل من العربون المطلوب، أو تأخيراً في التحويل، وتحتاج تدخلاً يدوياً للإقرار أو الإلغاء.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-black bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
            {problemOrders.length} طلب بحاجة لمراجعة
          </span>
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

      {/* Orders List / Cards */}
      <div className="space-y-3">
        {problemOrders.map((item) => (
          <div
            key={item.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm hover:border-amber-300 dark:hover:border-amber-700/60 transition-colors"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Left Info: Order details */}
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-sm text-slate-900 dark:text-white">
                    طلب رقم: {item.orderNumber || item.orderId}
                  </span>
                  {getReasonBadge(item.problemReason)}
                  <span className="text-[11px] font-medium text-slate-400">
                    {new Date(item.createdAt).toLocaleDateString('ar-EG', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2">
                  <div>
                    <span className="text-slate-400 block text-[10px]">العميل:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {item.customerName || 'غير معروف'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px]">رقم الهاتف:</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {item.customerPhone || '—'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px]">إجمالي الطلب:</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {item.totalAmount} ج.م
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px]">العربون المتوقع / المستلم:</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {item.expectedDeposit} ج.م / <span className="text-cyan-600 dark:text-cyan-400">{item.paidAmount} ج.م</span>
                    </span>
                  </div>
                </div>

                {item.problemDetails && (
                  <p className="text-xs text-amber-800 dark:text-amber-300/90 bg-amber-50/70 dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-200/60 dark:border-amber-900/40 mt-2">
                    {item.problemDetails}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => handleResolve(item, 'confirm_paid')}
                  disabled={resolvingId === item.id}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 shadow-sm"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  اعتماد كمدفوع
                </button>

                <button
                  onClick={() => handleResolve(item, 'cancel_session')}
                  disabled={resolvingId === item.id}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  إلغاء الدفع
                </button>

                {item.reviewItemId && (
                  <button
                    onClick={() => handleResolve(item, 'dismiss')}
                    disabled={resolvingId === item.id}
                    className="px-3 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    تجاهل
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {problemOrders.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">لا توجد طلبات تحتاج مراجعة مالية حالياً</p>
            <p className="text-xs text-slate-400 mt-1">جميع الدفعات والعربين تسير بشكل آلي ودقيق.</p>
          </div>
        )}
      </div>
    </div>
  );
};
