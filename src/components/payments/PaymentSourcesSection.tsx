import React, { useState } from 'react';
import { Plus, Edit2, Trash2, CheckCircle, XCircle, Layers, ArrowUpRight, Shield, AlertCircle } from 'lucide-react';
import { PaymentSource } from '../../types';

interface PaymentSourcesSectionProps {
  sources: PaymentSource[];
  onRefresh: () => Promise<void>;
  adminRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
}

export const PaymentSourcesSection: React.FC<PaymentSourcesSectionProps> = ({
  sources,
  onRefresh,
  adminRequest,
}) => {
  const [isEditing, setIsEditing] = useState<PaymentSource | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [channel, setChannel] = useState<'wallet' | 'bank' | 'pos' | 'other'>('wallet');
  const [destination, setDestination] = useState('');
  const [parserType, setParserType] = useState<'regex' | 'json' | 'delimiter'>('regex');
  const [sourcePackage, setSourcePackage] = useState('');
  const [sourceSender, setSourceSender] = useState('');
  const [titleContains, setTitleContains] = useState('');
  const [bodyContains, setBodyContains] = useState('');
  const [amountRegex, setAmountRegex] = useState('');
  const [payerPhoneRegex, setPayerPhoneRegex] = useState('');
  const [accountIdentifierRegex, setAccountIdentifierRegex] = useState('');
  const [priority, setPriority] = useState(100);
  const [notes, setNotes] = useState('');
  const [enabled, setEnabled] = useState(true);

  const resetForm = () => {
    setCode('');
    setDisplayName('');
    setChannel('wallet');
    setDestination('');
    setParserType('regex');
    setSourcePackage('');
    setSourceSender('');
    setTitleContains('');
    setBodyContains('');
    setAmountRegex('');
    setPayerPhoneRegex('');
    setAccountIdentifierRegex('');
    setPriority(100);
    setNotes('');
    setEnabled(true);
    setIsCreating(false);
    setIsEditing(null);
    setError(null);
  };

  const startEdit = (source: PaymentSource) => {
    setIsEditing(source);
    setIsCreating(false);
    setCode(source.code);
    setDisplayName(source.displayName);
    setChannel(source.channel);
    setDestination(source.destination || '');
    setParserType(source.parserType);
    setSourcePackage(source.sourcePackage || '');
    setSourceSender(source.sourceSender || '');
    setTitleContains(source.titleContains || '');
    setBodyContains(source.bodyContains || '');
    setAmountRegex(source.amountRegex || '');
    setPayerPhoneRegex(source.payerPhoneRegex || '');
    setAccountIdentifierRegex(source.accountIdentifierRegex || '');
    setPriority(source.priority);
    setNotes(source.notes || '');
    setEnabled(source.enabled);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        code,
        displayName,
        channel,
        destination: destination || null,
        parserType,
        sourcePackage: sourcePackage || null,
        sourceSender: sourceSender || null,
        titleContains: titleContains || null,
        bodyContains: bodyContains || null,
        amountRegex: amountRegex || null,
        payerPhoneRegex: payerPhoneRegex || null,
        accountIdentifierRegex: accountIdentifierRegex || null,
        priority: Number(priority),
        notes: notes || null,
        enabled,
      };

      if (isEditing) {
        await adminRequest(`/api/admin/payments/sources/${isEditing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccess('تم تحديث مصدر الدفع بنجاح');
      } else {
        await adminRequest('/api/admin/payments/sources', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccess('تم إنشاء مصدر الدفع بنجاح');
      }

      resetForm();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ مصدر الدفع');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, codeVal: string) => {
    if (!confirm(`هل أنت متأكد من حذف أو تعطيل المصدر (${codeVal})؟`)) return;
    try {
      setLoading(true);
      await adminRequest(`/api/admin/payments/sources/${id}`, {
        method: 'DELETE',
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف مصدر الدفع');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (source: PaymentSource) => {
    try {
      await adminRequest(`/api/admin/payments/sources/${source.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تغيير حالة المصدر');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            مصادر الدفع وقواعد الاستقبال (Payment Sources)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            تعريف قنوات الدفع (محافظ، تحويلات بنكية، إنستاباي) وقواعد استخلاص المبالغ وأرقام المحافظ من الإشعارات تلقائياً.
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
          إضافة مصدر دفع جديد
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Form Modal / Inline Editor */}
      {(isCreating || isEditing) && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-cyan-500/30 rounded-2xl p-5 shadow-md space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              {isEditing ? `تعديل المصدر: ${isEditing.displayName}` : 'إنشاء مصدر دفع جديد'}
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
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">كود المصدر (code)*</label>
              <input
                type="text"
                required
                disabled={Boolean(isEditing)}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="vf_cash, instapay, bank_alahly"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-mono text-xs focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
              />
              <span className="text-[10px] text-slate-400">اسم برمجي فريد للمصدر</span>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">الاسم المعروض (Display Name)*</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="فودافون كاش، إنستاباي، بنك الأهلي"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">نوع القناة (Channel)</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-cyan-500"
              >
                <option value="wallet">محفظة إلكترونية (Wallet)</option>
                <option value="bank">حساب بنكي (Bank Transfer)</option>
                <option value="pos">نقطة بيع / بطاقة (POS / Card)</option>
                <option value="other">أخرى (Other)</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">الوجهة / رقم المحفظة الافتراضي</label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="010xxxxxxxx أو رقم IBAN"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-mono text-xs focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">الأولوية (Priority)</label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-cyan-500"
              />
              <span className="text-[10px] text-slate-400">الأعلى رقماً يُعرض أولاً للعميل</span>
            </div>

            <div className="flex items-center gap-3 pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-cyan-600 focus:ring-cyan-500 border-slate-300"
                />
                <span className="font-bold text-slate-800 dark:text-slate-200">تفعيل المصدر</span>
              </label>
            </div>
          </div>

          {/* Bridge Parser Rules Sub-Section */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <h4 className="text-xs font-black text-cyan-700 dark:text-cyan-300 mb-2 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              قواعد قراءة إشعارات أندرويد (Bridge Parser Rules)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">اسم حزمة التطبيق (Package)</label>
                <input
                  type="text"
                  value={sourcePackage}
                  onChange={(e) => setSourcePackage(e.target.value)}
                  placeholder="com.vf.cash, eg.gov.instapay"
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-mono text-xs"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">مرسل الرسالة (Source Sender)</label>
                <input
                  type="text"
                  value={sourceSender}
                  onChange={(e) => setSourceSender(e.target.value)}
                  placeholder="VF-Cash, NBE, InstaPay"
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-mono text-xs"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">العنوان يحتوي على (Title Contains)</label>
                <input
                  type="text"
                  value={titleContains}
                  onChange={(e) => setTitleContains(e.target.value)}
                  placeholder="تم استلام، تحويل ناجح"
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">نص الرسالة يحتوي على (Body Contains)</label>
                <input
                  type="text"
                  value={bodyContains}
                  onChange={(e) => setBodyContains(e.target.value)}
                  placeholder="تم إيداع، تحويل لك"
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">Regex استخلاص المبلغ</label>
                <input
                  type="text"
                  value={amountRegex}
                  onChange={(e) => setAmountRegex(e.target.value)}
                  placeholder="مبلغ\s*([\d,.]+)\s*جنيه"
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-mono text-xs"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-600 dark:text-slate-400 mb-1">Regex استخلاص هاتف المحول</label>
                <input
                  type="text"
                  value={payerPhoneRegex}
                  onChange={(e) => setPayerPhoneRegex(e.target.value)}
                  placeholder="من\s*(01\d{9})"
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
            >
              {loading ? 'جاري الحفظ...' : isEditing ? 'تحديث المصدر' : 'حفظ المصدر'}
            </button>
          </div>
        </form>
      )}

      {/* Sources Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sources.map((source) => (
          <div
            key={source.id}
            className={`border rounded-2xl p-4 transition-all duration-200 bg-white dark:bg-slate-900 ${
              source.enabled
                ? 'border-slate-200 dark:border-slate-800 shadow-sm'
                : 'border-slate-200/60 dark:border-slate-800/40 opacity-70 bg-slate-50/50 dark:bg-slate-950/40'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      source.enabled ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                  />
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">{source.displayName}</h3>
                </div>
                <div className="flex items-center gap-2 mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  <span>code: {source.code}</span>
                  <span>•</span>
                  <span>أولوية: {source.priority}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => startEdit(source)}
                  className="p-1.5 text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                  title="تعديل"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(source.id, source.code)}
                  className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                  title="حذف/تعطيل"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span>القناة:</span>
                <span className="font-semibold text-slate-900 dark:text-slate-200">
                  {source.channel === 'wallet' ? 'محفظة كاش' : source.channel === 'bank' ? 'حساب بنكي' : source.channel}
                </span>
              </div>
              {source.destination && (
                <div className="flex items-center justify-between">
                  <span>رقم الاستقبال:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white text-[11px]">{source.destination}</span>
                </div>
              )}
              {source.sourceSender && (
                <div className="flex items-center justify-between">
                  <span>مرسل الإشعار:</span>
                  <span className="font-mono text-slate-800 dark:text-slate-300 text-[11px]">{source.sourceSender}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <span>الأجهزة المرتبطة:</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300">
                  {source.activeDevicesCount ?? 0} أجهزة
                </span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">الحالة: {source.enabled ? 'مفعل' : 'معطل'}</span>
              <button
                onClick={() => handleToggle(source)}
                className={`text-xs font-bold px-3 py-1 rounded-lg transition-colors ${
                  source.enabled
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                    : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100'
                }`}
              >
                {source.enabled ? 'تعطيل' : 'تفعيل'}
              </button>
            </div>
          </div>
        ))}

        {sources.length === 0 && (
          <div className="col-span-full text-center py-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
            <p className="text-xs text-slate-500 dark:text-slate-400">لا توجد مصادر دفع مسجلة حالياً.</p>
          </div>
        )}
      </div>
    </div>
  );
};
