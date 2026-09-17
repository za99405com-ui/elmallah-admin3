import React, { useState } from 'react';
import { CreditCard, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle, ArrowUpDown, ShieldCheck } from 'lucide-react';
import { CustomerPaymentMethod, PaymentSource } from '../../types';

interface CustomerMethodsSectionProps {
  methods: CustomerPaymentMethod[];
  sources: PaymentSource[];
  onRefresh: () => Promise<void>;
  adminRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
}

export const CustomerMethodsSection: React.FC<CustomerMethodsSectionProps> = ({
  methods,
  sources,
  onRefresh,
  adminRequest,
}) => {
  const [isEditing, setIsEditing] = useState<CustomerPaymentMethod | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [channel, setChannel] = useState<'cod' | 'wallet' | 'bank' | 'pos' | 'card'>('wallet');
  const [instructionsAr, setInstructionsAr] = useState('');
  const [primarySourceId, setPrimarySourceId] = useState<string>('');
  const [secondarySourceIds, setSecondarySourceIds] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState(10);
  const [requiresDeposit, setRequiresDeposit] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const resetForm = () => {
    setCode('');
    setNameAr('');
    setNameEn('');
    setDescriptionAr('');
    setChannel('wallet');
    setInstructionsAr('');
    setPrimarySourceId('');
    setSecondarySourceIds([]);
    setSortOrder(10);
    setRequiresDeposit(false);
    setEnabled(true);
    setIsCreating(false);
    setIsEditing(null);
    setError(null);
  };

  const startEdit = (method: CustomerPaymentMethod) => {
    setIsEditing(method);
    setIsCreating(false);
    setCode(method.code);
    setNameAr(method.nameAr || method.displayName || '');
    setNameEn(method.nameEn || '');
    setDescriptionAr(method.descriptionAr || '');
    setChannel(method.channel);
    setInstructionsAr(method.instructionsAr || method.instructions || '');
    setPrimarySourceId(method.primarySourceId || (method.sourceIds && method.sourceIds[0]) || '');
    setSecondarySourceIds(method.secondarySourceIds || (method.sourceIds ? method.sourceIds.slice(1) : []));
    setSortOrder(method.sortOrder);
    setRequiresDeposit(Boolean(method.requiresDeposit));
    setEnabled(method.enabled);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        code,
        nameAr,
        nameEn: nameEn || null,
        descriptionAr: descriptionAr || null,
        channel,
        instructionsAr: instructionsAr || null,
        primarySourceId: primarySourceId || null,
        secondarySourceIds,
        sortOrder: Number(sortOrder),
        requiresDeposit,
        enabled,
      };

      if (isEditing) {
        await adminRequest(`/api/admin/payments/customer-methods/${isEditing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccess('تم تحديث طريقة دفع العملاء بنجاح');
      } else {
        await adminRequest('/api/admin/payments/customer-methods', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccess('تم إضافة طريقة دفع العملاء بنجاح');
      }

      resetForm();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ طريقة الدفع');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, codeVal: string) => {
    if (!confirm(`هل أنت متأكد من حذف طريقة الدفع (${codeVal})؟`)) return;
    try {
      setLoading(true);
      await adminRequest(`/api/admin/payments/customer-methods/${id}`, {
        method: 'DELETE',
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف طريقة الدفع');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (method: CustomerPaymentMethod) => {
    try {
      await adminRequest(`/api/admin/payments/customer-methods/${method.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !method.enabled }),
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تعديل حالة طريقة الدفع');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            طرق الدفع المعروضة للعميل (Customer Payment Methods)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            الخيارات التي يراها المشتري في صفحة الدفع (Checkout)، وربط كل خيار بمصادر الدفع وقواعد العربون.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setIsCreating(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إضافة طريقة دفع للعملاء
        </button>
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

      {/* Editor Modal / Form */}
      {(isCreating || isEditing) && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-cyan-500/30 rounded-2xl p-5 shadow-md space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              {isEditing ? `تعديل طريقة الدفع: ${isEditing.nameAr}` : 'إضافة طريقة دفع جديدة للعملاء'}
            </h3>
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              إلغاء
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">كود الطريقة (Code)*</label>
              <input
                type="text"
                required
                disabled={Boolean(isEditing)}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="cod, vodafone_cash, instapay_direct"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-xs focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاسم بالعربية*</label>
              <input
                type="text"
                required
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder="الدفع عند الاستلام، فودافون كاش، إنستاباي"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاسم بالإنجليزية</label>
              <input
                type="text"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Cash on Delivery, Vodafone Cash"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">نوع القناة (Channel)</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
              >
                <option value="cod">الدفع عند الاستلام (COD)</option>
                <option value="wallet">محفظة إلكترونية (Wallet)</option>
                <option value="bank">تحويل بنكي / إنستاباي (Bank Transfer)</option>
                <option value="card">بطاقة ائتمان / فيزا (Card)</option>
                <option value="pos">نقطة بيع (POS)</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">المصدر الأساسي للتوجيه</label>
              <select
                value={primarySourceId}
                onChange={(e) => setPrimarySourceId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
              >
                <option value="">بدون ربط بمصدر تلقائي</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">ترتيب الظهور (Sort Order)</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">تعليمات الدفع للعميل</label>
              <textarea
                rows={2}
                value={instructionsAr}
                onChange={(e) => setInstructionsAr(e.target.value)}
                placeholder="يرجى تحويل العربون إلى رقم المحفظة الظاهر أمامك..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div className="flex flex-col justify-center space-y-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requiresDeposit}
                  onChange={(e) => setRequiresDeposit(e.target.checked)}
                  className="w-4 h-4 rounded text-cyan-600 focus:ring-cyan-500"
                />
                <span className="font-bold text-slate-800 dark:text-slate-200">تتطلب دفع عربون مسبقاً</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-cyan-600 focus:ring-cyan-500"
                />
                <span className="font-bold text-slate-800 dark:text-slate-200">تفعيل هذه الطريقة للعملاء</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
            >
              {loading ? 'جاري الحفظ...' : isEditing ? 'تحديث الطريقة' : 'حفظ الطريقة'}
            </button>
          </div>
        </form>
      )}

      {/* Methods List */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {methods.map((method) => {
          const primarySource = sources.find((s) => s.id === method.primarySourceId);

          return (
            <div
              key={method.id}
              className={`border rounded-2xl p-4 transition-all duration-200 bg-white dark:bg-slate-900 ${
                method.enabled
                  ? 'border-slate-200 dark:border-slate-800 shadow-sm'
                  : 'border-slate-200/60 dark:border-slate-800/40 opacity-70 bg-slate-50/50 dark:bg-slate-950/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        method.enabled ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}
                    />
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {method.nameAr || method.displayName}
                    </h3>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                    code: {method.code} • ترتيب: {method.sortOrder}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(method)}
                    className="p-1.5 text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                    title="تعديل"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(method.id, method.code)}
                    className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                    title="حذف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span>القناة:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {method.channel === 'cod'
                      ? 'دفع عند الاستلام'
                      : method.channel === 'wallet'
                      ? 'محفظة كاش'
                      : method.channel === 'bank'
                      ? 'تحويل بنكي / إنستاباي'
                      : method.channel}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span>المصدر التقني المرتبط:</span>
                  <span className="font-semibold text-cyan-700 dark:text-cyan-300">
                    {primarySource ? primarySource.displayName : 'غير محدد'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span>العربون:</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      method.requiresDeposit
                        ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {method.requiresDeposit ? 'تتطلب عربون مسبقاً' : 'بدون عربون مسبق'}
                  </span>
                </div>

                {(method.instructionsAr || method.instructions) && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 bg-slate-50 dark:bg-slate-950 p-2 rounded-lg line-clamp-2">
                    {method.instructionsAr || method.instructions}
                  </p>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">الحالة: {method.enabled ? 'مفعل' : 'معطل'}</span>
                <button
                  onClick={() => handleToggle(method)}
                  className={`text-xs font-bold px-3 py-1 rounded-lg transition-colors ${
                    method.enabled
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                      : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100'
                  }`}
                >
                  {method.enabled ? 'تعطيل' : 'تفعيل'}
                </button>
              </div>
            </div>
          );
        })}

        {methods.length === 0 && (
          <div className="col-span-full text-center py-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
            <p className="text-xs text-slate-500 dark:text-slate-400">لا توجد طرق دفع معرفة للعملاء حالياً.</p>
          </div>
        )}
      </div>
    </div>
  );
};
