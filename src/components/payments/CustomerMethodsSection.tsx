import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Edit2,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { CustomerPaymentMethod, PaymentSource } from '../../types';

interface CustomerMethodsSectionProps {
  methods: CustomerPaymentMethod[];
  sources: PaymentSource[];
  onRefresh: () => Promise<void>;
  adminRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
}

type MethodChannel =
  | 'cash_on_delivery'
  | 'wallet'
  | 'instapay'
  | 'bank_transfer'
  | 'card'
  | 'other';

export const CustomerMethodsSection: React.FC<CustomerMethodsSectionProps> = ({
  methods,
  sources,
  onRefresh,
  adminRequest,
}) => {
  const [editing, setEditing] = useState<CustomerPaymentMethod | null>(null);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [channel, setChannel] = useState<MethodChannel>('wallet');
  const [instructions, setInstructions] = useState('');
  const [primarySourceId, setPrimarySourceId] = useState('');
  const [secondarySourceIds, setSecondarySourceIds] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState(10);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onlineSources = useMemo(
    () => sources.filter((source) => source.enabled),
    [sources]
  );

  const resetForm = () => {
    setEditing(null);
    setCreating(false);
    setCode('');
    setDisplayName('');
    setChannel('wallet');
    setInstructions('');
    setPrimarySourceId('');
    setSecondarySourceIds([]);
    setSortOrder(10);
    setEnabled(true);
    setError(null);
  };

  const startEdit = (method: CustomerPaymentMethod) => {
    setCreating(false);
    setEditing(method);
    setCode(method.code);
    setDisplayName(method.displayName);
    setChannel(method.channel as MethodChannel);
    setInstructions(method.instructions || '');
    setPrimarySourceId(method.primarySourceId || method.sourceIds?.[0] || '');
    setSecondarySourceIds(
      method.secondarySourceIds ||
        method.sourceIds?.filter((id) => id !== (method.primarySourceId || method.sourceIds?.[0])) ||
        []
    );
    setSortOrder(method.sortOrder || 0);
    setEnabled(method.enabled);
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const sourceIds =
        channel === 'cash_on_delivery'
          ? []
          : [primarySourceId, ...secondarySourceIds]
              .map((value) => value.trim())
              .filter((value, index, all) => value && all.indexOf(value) === index);

      const payload = {
        code,
        displayName,
        channel,
        instructions: instructions.trim() || null,
        sourceIds,
        sortOrder: Number(sortOrder),
        enabled,
      };

      if (editing) {
        await adminRequest(`/api/admin/payments/customer-methods/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccess('تم تحديث طريقة الدفع بنجاح');
      } else {
        await adminRequest('/api/admin/payments/customer-methods', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccess('تم إضافة طريقة الدفع بنجاح');
      }

      resetForm();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ طريقة الدفع');
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
      setError(err instanceof Error ? err.message : 'تعذر تغيير حالة طريقة الدفع');
    }
  };

  const handleDelete = async (method: CustomerPaymentMethod) => {
    if (!confirm(`هل تريد حذف طريقة الدفع "${method.displayName}"؟`)) return;
    try {
      setLoading(true);
      await adminRequest(`/api/admin/payments/customer-methods/${method.id}`, {
        method: 'DELETE',
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف طريقة الدفع');
    } finally {
      setLoading(false);
    }
  };

  const channelLabel = (value: string) => {
    if (value === 'cash_on_delivery') return 'الدفع عند الاستلام';
    if (value === 'wallet') return 'محفظة إلكترونية';
    if (value === 'instapay') return 'إنستاباي';
    if (value === 'bank_transfer') return 'تحويل بنكي';
    if (value === 'card') return 'بطاقة';
    return 'أخرى';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            طرق الدفع الظاهرة للعميل
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            فعّل فقط الاختيارات التي تريد ظهورها في صفحة الدفع، واربط كل طريقة إلكترونية بمصادر الاستقبال المناسبة.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setCreating(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إضافة طريقة دفع
        </button>
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

      {(creating || editing) && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-900 border border-cyan-500/30 rounded-2xl p-5 shadow-md space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              {editing ? `تعديل: ${editing.displayName}` : 'إضافة طريقة دفع جديدة'}
            </h3>
            <button type="button" onClick={resetForm} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">الكود*</label>
              <input
                required
                disabled={Boolean(editing)}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="vodafone_cash, instapay, cash_on_delivery"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-xs disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاسم المعروض*</label>
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="فودافون كاش"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">نوع الطريقة</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as MethodChannel)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
              >
                <option value="cash_on_delivery">الدفع عند الاستلام</option>
                <option value="wallet">محفظة إلكترونية</option>
                <option value="instapay">إنستاباي</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="card">بطاقة</option>
                <option value="other">أخرى</option>
              </select>
            </div>

            {channel !== 'cash_on_delivery' && (
              <>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">المصدر الأساسي</label>
                  <select
                    value={primarySourceId}
                    onChange={(e) => {
                      setPrimarySourceId(e.target.value);
                      setSecondarySourceIds((current) => current.filter((id) => id !== e.target.value));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
                  >
                    <option value="">اختر المصدر</option>
                    {onlineSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-2">
                    مصادر احتياطية عند انشغال المصدر الأساسي
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {onlineSources
                      .filter((source) => source.id !== primarySourceId)
                      .map((source) => {
                        const checked = secondarySourceIds.includes(source.id);
                        return (
                          <label
                            key={source.id}
                            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
                              checked
                                ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200'
                                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSecondarySourceIds((current) =>
                                  e.target.checked
                                    ? [...current, source.id]
                                    : current.filter((id) => id !== source.id)
                                )
                              }
                            />
                            <span className="font-bold text-[11px]">{source.displayName}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              </>
            )}

            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">تعليمات قصيرة للعميل</label>
              <textarea
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="سيظهر رقم التحويل الخاص بالجهاز المتاح بعد اختيار الطريقة."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">ترتيب الظهور</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-cyan-600"
                />
                <span className="font-bold text-slate-800 dark:text-slate-200">إظهار هذه الطريقة للعميل</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={resetForm} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {loading ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {methods.map((method) => {
          const primarySource = sources.find((source) => source.id === method.primarySourceId);
          return (
            <div
              key={method.id}
              className={`border rounded-2xl p-4 bg-white dark:bg-slate-900 transition-all ${
                method.enabled
                  ? 'border-slate-200 dark:border-slate-800 shadow-sm'
                  : 'border-slate-200/60 dark:border-slate-800/40 opacity-65'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${method.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">{method.displayName}</h3>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {channelLabel(method.channel)} • ترتيب {method.sortOrder}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => startEdit(method)} className="p-1.5 text-slate-400 hover:text-cyan-600" title="تعديل">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => void handleDelete(method)} className="p-1.5 text-slate-400 hover:text-red-500" title="حذف">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                {method.channel !== 'cash_on_delivery' && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">المصدر الأساسي:</span>
                    <span className="font-bold text-cyan-700 dark:text-cyan-300">
                      {primarySource?.displayName || 'غير محدد'}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">الحالة:</span>
                  <button
                    onClick={() => void handleToggle(method)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-bold ${
                      method.enabled
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {method.enabled ? 'مفعلة للعميل' : 'متوقفة'}
                  </button>
                </div>
                {method.instructions && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 rounded-lg p-2 leading-relaxed">
                    {method.instructions}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
