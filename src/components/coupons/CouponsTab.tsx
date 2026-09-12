import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Coupon, DiscountType } from '../../types';
import {
  TicketPercent,
  Plus,
  Search,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  Copy,
  Calendar,
  X,
  Percent,
  Coins,
} from 'lucide-react';

export const CouponsTab: React.FC = () => {
  const { coupons, addCoupon, updateCoupon, deleteCoupon, toggleCouponActive, addToast } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);

  // Form states
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState<number>(15);
  const [minOrderValue, setMinOrderValue] = useState<number>(150);
  const [maxDiscountValue, setMaxDiscountValue] = useState<number>(50);
  const [usageLimit, setUsageLimit] = useState<number>(100);
  const [expiryDate, setExpiryDate] = useState<string>('2026-12-31');
  const [isActive, setIsActive] = useState<boolean>(true);

  const openAddModal = () => {
    setEditingCoupon(null);
    setCode(`FISH${Math.floor(10 + Math.random() * 80)}`);
    setDiscountType('percentage');
    setDiscountValue(20);
    setMinOrderValue(150);
    setMaxDiscountValue(60);
    setUsageLimit(100);
    setExpiryDate('2026-12-31');
    setIsActive(true);
    setIsModalOpen(true);
  };

  const openEditModal = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    setCode(coupon.code);
    setDiscountType(coupon.discountType);
    setDiscountValue(coupon.discountValue);
    setMinOrderValue(coupon.minOrderValue);
    setMaxDiscountValue(coupon.maxDiscountValue || 0);
    setUsageLimit(coupon.usageLimit);
    setExpiryDate(coupon.expiryDate);
    setIsActive(coupon.isActive);
    setIsModalOpen(true);
  };

  const handleCopyCode = (couponCode: string) => {
    navigator.clipboard.writeText(couponCode);
    addToast({
      type: 'info',
      title: 'تم النسخ',
      description: `تم نسخ الكوبون: ${couponCode}`,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      addToast({ type: 'error', title: 'خطأ', description: 'يرجى إدخال كود الكوبون' });
      return;
    }

    const cleanCode = code.trim().toUpperCase();

    if (editingCoupon) {
      updateCoupon(editingCoupon.id, {
        code: cleanCode,
        discountType,
        discountValue: Number(discountValue),
        minOrderValue: Number(minOrderValue),
        maxDiscountValue: discountType === 'percentage' ? Number(maxDiscountValue) : undefined,
        usageLimit: Number(usageLimit),
        expiryDate,
        isActive,
      });
    } else {
      addCoupon({
        code: cleanCode,
        discountType,
        discountValue: Number(discountValue),
        minOrderValue: Number(minOrderValue),
        maxDiscountValue: discountType === 'percentage' ? Number(maxDiscountValue) : undefined,
        usageLimit: Number(usageLimit),
        expiryDate,
        isActive,
      });
    }

    setIsModalOpen(false);
  };

  const filteredCoupons = coupons.filter((c) =>
    c.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4 pb-12">
      {/* Top Search & Actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="بحث بكود الكوبون..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-3 pr-9 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 shadow-xs"
          />
        </div>

        <button
          onClick={openAddModal}
          className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>إنشاء كوبون</span>
        </button>
      </div>

      {/* Coupons Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-2.5 sm:p-3 pr-4">الكود</th>
                <th className="p-2.5 sm:p-3">قيمة الخصم</th>
                <th className="p-2.5 sm:p-3">الحد الأدنى</th>
                <th className="p-2.5 sm:p-3">الاستخدام</th>
                <th className="p-2.5 sm:p-3">الحالة</th>
                <th className="p-2.5 sm:p-3 pl-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
              {filteredCoupons.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    لا توجد كوبونات مطابقة للبحث
                  </td>
                </tr>
              ) : (
                filteredCoupons.map((coupon) => {
                  const usagePercentage = Math.min(
                    100,
                    Math.round((coupon.usedCount / coupon.usageLimit) * 100)
                  );
                  const isExpired = new Date(coupon.expiryDate) < new Date();

                  return (
                    <tr
                      key={coupon.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Code */}
                      <td className="p-2.5 sm:p-3 pr-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-cyan-600 dark:text-cyan-400 font-mono font-bold text-xs border border-slate-200 dark:border-slate-700">
                            {coupon.code}
                          </span>
                          <button
                            onClick={() => handleCopyCode(coupon.code)}
                            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-white"
                            title="نسخ الكود"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* Value */}
                      <td className="p-2.5 sm:p-3 whitespace-nowrap">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {coupon.discountType === 'percentage'
                            ? `${coupon.discountValue}%`
                            : `${coupon.discountValue} ج.م`}
                        </span>
                        {coupon.maxDiscountValue && coupon.discountType === 'percentage' && (
                          <span className="text-[10px] text-slate-400 block">
                            سقف {coupon.maxDiscountValue} ج.م
                          </span>
                        )}
                      </td>

                      {/* Min order */}
                      <td className="p-2.5 sm:p-3 whitespace-nowrap">
                        <span className="text-slate-700 dark:text-slate-300 font-medium">
                          {coupon.minOrderValue} ج.م
                        </span>
                      </td>

                      {/* Usage */}
                      <td className="p-2.5 sm:p-3 whitespace-nowrap">
                        <div className="w-24 space-y-1">
                          <div className="flex justify-between text-[10px] text-slate-400">
                            <span>{coupon.usedCount}</span>
                            <span>/ {coupon.usageLimit}</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-cyan-500 rounded-full"
                              style={{ width: `${usagePercentage}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="p-2.5 sm:p-3 whitespace-nowrap">
                        <button
                          onClick={() => toggleCouponActive(coupon.id)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer ${
                            coupon.isActive && !isExpired
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'bg-rose-500/15 text-rose-500'
                          }`}
                        >
                          {coupon.isActive && !isExpired ? 'نشط' : isExpired ? 'منتهي' : 'معطل'}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="p-2.5 sm:p-3 pl-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditModal(coupon)}
                            className="p-1 rounded-lg text-slate-400 hover:text-cyan-500 cursor-pointer"
                            title="تعديل"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteCoupon(coupon.id)}
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer"
                            title="حذف"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-4 sm:p-6 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold">
                {editingCoupon ? 'تعديل الكوبون' : 'إنشاء كوبون جديد'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">كود الخصم *</label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="FISH20"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono font-bold uppercase focus:outline-none focus:border-cyan-500 dir-ltr text-right"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">النوع</label>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="percentage">نسبة مئوية (%)</option>
                    <option value="fixed">مبلغ ثابت (ج.م)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">القيمة *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={discountValue}
                    onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">الحد الأدنى للطلب</label>
                  <input
                    type="number"
                    min="0"
                    value={minOrderValue}
                    onChange={(e) => setMinOrderValue(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">حد مرات الاستخدام</label>
                  <input
                    type="number"
                    min="1"
                    value={usageLimit}
                    onChange={(e) => setUsageLimit(parseInt(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">تاريخ الانتهاء</label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400"
                >
                  {editingCoupon ? 'حفظ' : 'إنشاء'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
