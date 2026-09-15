import React, { useState, useEffect } from 'react';
import {
  X,
  Phone,
  Shield,
  ShieldAlert,
  ShieldCheck,
  GitMerge,
  User,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Ban,
  ShoppingBag,
  ExternalLink,
  MessageCircle,
  Tag,
  CreditCard,
  Percent,
} from 'lucide-react';
import {
  Customer,
  CustomerDetails,
  CustomerAccount,
  CustomerPolicy,
  CustomerMergeResult,
} from '../../types';
import { api } from '../../lib/api';

interface CustomerIdentityModalProps {
  customer: Customer;
  isOpen: boolean;
  onClose: () => void;
  onCustomerUpdated?: () => void;
  allCustomers: Customer[];
}

export const CustomerIdentityModal: React.FC<CustomerIdentityModalProps> = ({
  customer,
  isOpen,
  onClose,
  onCustomerUpdated,
  allCustomers,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'accounts' | 'policy' | 'merge'>('overview');
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // New account form state
  const [newPhone, setNewPhone] = useState('');
  const [isPrimaryNew, setIsPrimaryNew] = useState(false);
  const [accountNotes, setAccountNotes] = useState('');
  const [isAddingAccount, setIsAddingAccount] = useState(false);

  // Policy form state
  const [policyForm, setPolicyForm] = useState<{
    isBlocked: boolean;
    blockReason: string;
    blockedUntil: string;
    personalDiscountEnabled: boolean;
    personalDiscountType: 'percentage' | 'fixed';
    personalDiscountValue: number | string;
    personalDiscountMaxAmount: number | string;
    personalDiscountExpiresAt: string;
    codOverride: 'inherit' | 'allow' | 'deny';
    codMaxOrderAmount: number | string;
    codExpiresAt: string;
    adminNotes: string;
  }>({
    isBlocked: false,
    blockReason: '',
    blockedUntil: '',
    personalDiscountEnabled: false,
    personalDiscountType: 'percentage',
    personalDiscountValue: '',
    personalDiscountMaxAmount: '',
    personalDiscountExpiresAt: '',
    codOverride: 'inherit',
    codMaxOrderAmount: '',
    codExpiresAt: '',
    adminNotes: '',
  });

  // Merge form state
  const [sourceCustomerId, setSourceCustomerId] = useState('');
  const [confirmBlockedSource, setConfirmBlockedSource] = useState(false);
  const [requiresBlockedConfirmation, setRequiresBlockedConfirmation] = useState(false);
  const [blockedWarningMessage, setBlockedWarningMessage] = useState('');

  const loadDetails = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await api.getCustomerDetails(customer.id);
      setDetails(data);

      if (data.policy) {
        setPolicyForm({
          isBlocked: Boolean(data.policy.isBlocked),
          blockReason: data.policy.blockReason || '',
          blockedUntil: data.policy.blockedUntil ? data.policy.blockedUntil.slice(0, 16) : '',
          personalDiscountEnabled: Boolean(data.policy.personalDiscountEnabled),
          personalDiscountType: data.policy.personalDiscountType || 'percentage',
          personalDiscountValue: data.policy.personalDiscountValue ?? '',
          personalDiscountMaxAmount: data.policy.personalDiscountMaxAmount ?? '',
          personalDiscountExpiresAt: data.policy.personalDiscountExpiresAt ? data.policy.personalDiscountExpiresAt.slice(0, 16) : '',
          codOverride: data.policy.codOverride || 'inherit',
          codMaxOrderAmount: data.policy.codMaxOrderAmount ?? '',
          codExpiresAt: data.policy.codExpiresAt ? data.policy.codExpiresAt.slice(0, 16) : '',
          adminNotes: data.policy.adminNotes || '',
        });
      } else {
        setPolicyForm({
          isBlocked: customer.status === 'blocked',
          blockReason: customer.status === 'blocked' ? (customer.notes || 'محظور إدارياً') : '',
          blockedUntil: '',
          personalDiscountEnabled: false,
          personalDiscountType: 'percentage',
          personalDiscountValue: '',
          personalDiscountMaxAmount: '',
          personalDiscountExpiresAt: '',
          codOverride: 'inherit',
          codMaxOrderAmount: '',
          codExpiresAt: '',
          adminNotes: '',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر تحميل بيانات العميل';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadDetails();
      setSuccessMessage(null);
      setErrorMessage(null);
    }
  }, [isOpen, customer.id]);

  if (!isOpen) return null;

  // 1. Link new account handler
  const handleLinkAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhone.trim()) return;

    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await api.linkCustomerAccount(customer.id, {
        phone: newPhone.trim(),
        isPrimary: isPrimaryNew,
        notes: accountNotes.trim() || undefined,
      });

      setSuccessMessage('تم ربط رقم الهاتف الجديد بحساب العميل بنجاح');
      setNewPhone('');
      setAccountNotes('');
      setIsPrimaryNew(false);
      setIsAddingAccount(false);
      await loadDetails();
      onCustomerUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر ربط رقم الهاتف';
      setErrorMessage(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // 2. Toggle active account
  const handleToggleAccountActive = async (account: CustomerAccount) => {
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await api.updateCustomerAccount(customer.id, account.id, {
        isActive: !account.isActive,
      });
      setSuccessMessage(account.isActive ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب');
      await loadDetails();
      onCustomerUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر تعديل حالة الحساب';
      setErrorMessage(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // 3. Set Primary Account
  const handleSetPrimaryAccount = async (account: CustomerAccount) => {
    if (account.isPrimary) return;

    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await api.updateCustomerAccount(customer.id, account.id, {
        isPrimary: true,
      });
      setSuccessMessage('تم تعيين الرقم كرقم أساسي للعميل بنجاح');
      await loadDetails();
      onCustomerUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر تعيين الرقم كرئيسي';
      setErrorMessage(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // 4. Save Customer Policy
  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload: Partial<CustomerPolicy> = {
        isBlocked: policyForm.isBlocked,
        blockReason: policyForm.blockReason || null,
        blockedUntil: policyForm.blockedUntil ? new Date(policyForm.blockedUntil).toISOString() : null,
        personalDiscountEnabled: policyForm.personalDiscountEnabled,
        personalDiscountType: policyForm.personalDiscountEnabled ? policyForm.personalDiscountType : null,
        personalDiscountValue:
          policyForm.personalDiscountEnabled && policyForm.personalDiscountValue !== ''
            ? Number(policyForm.personalDiscountValue)
            : null,
        personalDiscountMaxAmount:
          policyForm.personalDiscountEnabled && policyForm.personalDiscountMaxAmount !== ''
            ? Number(policyForm.personalDiscountMaxAmount)
            : null,
        personalDiscountExpiresAt:
          policyForm.personalDiscountEnabled && policyForm.personalDiscountExpiresAt
            ? new Date(policyForm.personalDiscountExpiresAt).toISOString()
            : null,
        codOverride: policyForm.codOverride,
        codMaxOrderAmount:
          policyForm.codMaxOrderAmount !== '' ? Number(policyForm.codMaxOrderAmount) : null,
        codExpiresAt: policyForm.codExpiresAt ? new Date(policyForm.codExpiresAt).toISOString() : null,
        adminNotes: policyForm.adminNotes || null,
      };

      await api.updateCustomerPolicy(customer.id, payload);
      setSuccessMessage('تم حفظ سياسة العميل وصلاحياته بنجاح');
      await loadDetails();
      onCustomerUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر حفظ سياسة العميل';
      setErrorMessage(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // 5. Merge Customer
  const handleMergeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceCustomerId) return;

    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setRequiresBlockedConfirmation(false);

    try {
      const result = await api.mergeCustomers(customer.id, {
        sourceCustomerId,
        confirmBlockedSource,
      });

      setSuccessMessage(result.message || 'تم دمج العميل بنجاح');
      setSourceCustomerId('');
      setConfirmBlockedSource(false);
      setRequiresBlockedConfirmation(false);
      await loadDetails();
      onCustomerUpdated?.();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'error' in err && (err as { error: string }).error === 'SOURCE_CUSTOMER_IS_BLOCKED') {
        setRequiresBlockedConfirmation(true);
        setBlockedWarningMessage((err as { message?: string }).message || 'العميل المُراد دمجه محظور حالياً.');
      } else {
        const msg = err instanceof Error ? err.message : 'فشلت عملية دمج العميل';
        setErrorMessage(msg);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const candidateCustomers = allCustomers.filter((c) => c.id !== customer.id);
  const selectedSourceCustomer = candidateCustomers.find((c) => c.id === sourceCustomerId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col text-slate-900 dark:text-slate-100 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-black flex items-center justify-center text-base">
              {customer.name.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  {customer.name}
                </h3>
                {details?.effectivePolicy?.effectiveBlocked ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-500 flex items-center gap-1">
                    <Ban className="w-3 h-3" />
                    محظور
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    نشط
                  </span>
                )}
                {customer.totalSpent >= 1000 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-500">
                    VIP
                  </span>
                )}
              </div>
              <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                المعرّف الأساسي الدائم: <span className="text-slate-600 dark:text-slate-300 select-all">{customer.id}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 px-4 gap-2 overflow-x-auto text-xs font-bold">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-3 px-2 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>نظرة عامة والطلبات</span>
          </button>

          <button
            onClick={() => setActiveTab('accounts')}
            className={`py-3 px-2 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'accounts'
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Phone className="w-3.5 h-3.5" />
            <span>الأرقام المرتبطة ({details?.accounts?.length || 1})</span>
          </button>

          <button
            onClick={() => setActiveTab('policy')}
            className={`py-3 px-2 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'policy'
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>السياسات والحظر والـ COD</span>
          </button>

          <button
            onClick={() => setActiveTab('merge')}
            className={`py-3 px-2 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'merge'
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <GitMerge className="w-3.5 h-3.5" />
            <span>دمج الهوية</span>
          </button>
        </div>

        {/* Feedback alerts */}
        {errorMessage && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Tab Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {loading && !details ? (
            <div className="py-12 text-center text-slate-400 text-xs">جاري تحميل الملف الموحد للعميل...</div>
          ) : (
            <>
              {/* TAB 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-slate-400 block mb-1">الرقم الرئيسي</span>
                      <span className="font-mono font-bold dir-ltr block text-right text-slate-900 dark:text-white">
                        {customer.phone}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-slate-400 block mb-1">المدينة والحي</span>
                      <span className="font-bold text-slate-900 dark:text-white truncate block">
                        {customer.city} {customer.district ? `- ${customer.district}` : ''}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-slate-400 block mb-1">عدد الطلبات</span>
                      <span className="font-black text-cyan-600 dark:text-cyan-400 text-base block">
                        {details?.stats?.totalOrders ?? customer.totalOrders}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-slate-400 block mb-1">إجمالي المشتريات</span>
                      <span className="font-black text-emerald-500 text-base block">
                        {(details?.stats?.totalSpent ?? customer.totalSpent).toLocaleString('ar-EG')} ج.م
                      </span>
                    </div>
                  </div>

                  {customer.address && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
                      <span className="text-slate-400 block mb-1">العنوان التفصيلي</span>
                      <p className="font-medium text-slate-800 dark:text-slate-200">{customer.address}</p>
                    </div>
                  )}

                  {/* Effective Policy Banner */}
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-cyan-500" />
                        حالة الصلاحيات والسياسات الفعّالة للعميل
                      </span>
                      {details?.effectivePolicy?.effectiveBlocked ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-500">
                          محظور من تنفيذ الطلبات
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-500">
                          مسموح له بالطلب
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] pt-1">
                      <div>
                        <span className="text-slate-400">الدفع عند الاستلام (COD):</span>{' '}
                        <span className="font-bold">
                          {details?.effectivePolicy?.codOverride === 'allow'
                            ? 'متاح ومستثنى دائماً'
                            : details?.effectivePolicy?.codOverride === 'deny'
                            ? 'ممنوع (يلزم عربون)'
                            : 'حسب إعدادات المتجر'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400">الخصم الشخصي:</span>{' '}
                        <span className="font-bold">
                          {details?.effectivePolicy?.personalDiscount
                            ? `${details.effectivePolicy.personalDiscount.value} ${
                                details.effectivePolicy.personalDiscount.type === 'percentage' ? '%' : 'ج.م'
                              }`
                            : 'غير مفعل'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400">الأرقام المرتبطة:</span>{' '}
                        <span className="font-bold">{details?.accounts?.length || 1} أرقام تتبع نفس الهوية</span>
                      </div>
                    </div>
                  </div>

                  {/* Recent Orders Table */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <ShoppingBag className="w-3.5 h-3.5" />
                      آخر طلبات العميل (سجل موحد لجميع أرقامه)
                    </h4>

                    {details?.recentOrders && details.recentOrders.length > 0 ? (
                      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                        <table className="w-full text-right text-xs">
                          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px]">
                            <tr>
                              <th className="p-2.5 pr-3">رقم الطلب</th>
                              <th className="p-2.5">التاريخ</th>
                              <th className="p-2.5">المبلغ</th>
                              <th className="p-2.5">طريقة الدفع</th>
                              <th className="p-2.5 pl-3">الحالة</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {details.recentOrders.map((ord) => (
                              <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                <td className="p-2.5 pr-3 font-mono font-bold text-cyan-600 dark:text-cyan-400">
                                  #{ord.orderNumber}
                                </td>
                                <td className="p-2.5 text-slate-500">
                                  {new Date(ord.createdAt).toLocaleDateString('ar-EG')}
                                </td>
                                <td className="p-2.5 font-bold text-slate-900 dark:text-white">
                                  {ord.totalAmount} ج.م
                                </td>
                                <td className="p-2.5 text-[11px] text-slate-500">
                                  {ord.paymentMode === 'cash_on_delivery' ? 'عند الاستلام' : 'عربون إلكتروني'}
                                </td>
                                <td className="p-2.5 pl-3">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                    {ord.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-6 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                        لا توجد طلبات سابقة مسجلة لهذا العميل حتى الآن.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: LINKED ACCOUNTS */}
              {activeTab === 'accounts' && (
                <div className="space-y-4">
                  <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-xs text-cyan-900 dark:text-cyan-200">
                    <p className="font-bold flex items-center gap-1.5 mb-1">
                      <Phone className="w-4 h-4 text-cyan-500" />
                      منظومة الهوية الموحدة للعميل (Customer Identity)
                    </p>
                    <p className="text-[11px] leading-relaxed opacity-90">
                      رقم الهاتف هو وسيلة تسجيل دخول واتصال، وليس الهوية نفسها. جميع أرقام الهواتف المرتبطة بهذا العميل
                      تشارك نفس سجل الطلبات، ونفس الصلاحيات، وسياسات الحظر والخصم تلقائياً.
                    </p>
                  </div>

                  {/* Add New Account Accordion/Form */}
                  {!isAddingAccount ? (
                    <button
                      type="button"
                      onClick={() => setIsAddingAccount(true)}
                      className="w-full py-2.5 px-3 rounded-xl border border-dashed border-cyan-500/40 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/5 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>ربط رقم هاتف إضافي بهذا العميل</span>
                    </button>
                  ) : (
                    <form
                      onSubmit={handleLinkAccountSubmit}
                      className="p-3.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <Plus className="w-3.5 h-3.5 text-cyan-500" />
                          إضافة رقم هاتف جديد للعميل
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsAddingAccount(false)}
                          className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-xs"
                        >
                          إلغاء
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                            رقم الهاتف المصري *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="01012345678"
                            value={newPhone}
                            onChange={(e) => setNewPhone(e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono dir-ltr text-right focus:outline-none focus:border-cyan-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                            ملاحظات على الرقم (اختياري)
                          </label>
                          <input
                            type="text"
                            placeholder="مثل: هاتف العمل، رقم المحل..."
                            value={accountNotes}
                            onChange={(e) => setAccountNotes(e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <label className="flex items-center gap-2 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={isPrimaryNew}
                            onChange={(e) => setIsPrimaryNew(e.target.checked)}
                            className="rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
                          />
                          <span className="text-slate-700 dark:text-slate-300">
                            تعيين هذا الرقم كرقم رئيسي معتمد للعميل
                          </span>
                        </label>

                        <button
                          type="submit"
                          disabled={actionLoading}
                          className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? 'جاري الربط...' : 'ربط الرقم'}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* List of accounts */}
                  <div className="space-y-2">
                    {details?.accounts?.map((acc) => (
                      <div
                        key={acc.id}
                        className={`p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs transition-colors ${
                          acc.isPrimary
                            ? 'border-cyan-500/40 bg-cyan-50/20 dark:bg-cyan-950/10'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                              acc.isActive
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-400'
                            }`}
                          >
                            <Phone className="w-4 h-4" />
                          </div>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900 dark:text-white dir-ltr">
                                {acc.phone}
                              </span>
                              {acc.isPrimary && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-cyan-500 text-slate-950">
                                  رئيسي
                                </span>
                              )}
                              {!acc.isActive && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-500/15 text-rose-500">
                                  معطل
                                </span>
                              )}
                            </div>

                            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                              <span>أُضيف في: {new Date(acc.createdAt).toLocaleDateString('ar-EG')}</span>
                              {acc.notes && <span>• {acc.notes}</span>}
                            </div>
                          </div>
                        </div>

                        {/* Account Actions */}
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          {!acc.isPrimary && (
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleSetPrimaryAccount(acc)}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300 cursor-pointer disabled:opacity-50"
                            >
                              تعيين كرئيسي
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => handleToggleAccountActive(acc)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors disabled:opacity-50 ${
                              acc.isActive
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20'
                                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                            }`}
                          >
                            {acc.isActive ? 'تعطيل' : 'تفعيل'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 3: POLICY & PERMISSIONS */}
              {activeTab === 'policy' && (
                <form onSubmit={handleSavePolicy} className="space-y-4">
                  {/* Section A: Blocking Policy */}
                  <div className="p-3.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className={`w-4 h-4 ${policyForm.isBlocked ? 'text-rose-500' : 'text-slate-400'}`} />
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          حظر العميل ومنع إنشاء الطلبات
                        </span>
                      </div>

                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={policyForm.isBlocked}
                          onChange={(e) => setPolicyForm({ ...policyForm, isBlocked: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-500"></div>
                      </label>
                    </div>

                    {policyForm.isBlocked && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs pt-1">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                            سبب الحظر
                          </label>
                          <input
                            type="text"
                            placeholder="مثال: رفض استلام طلبات متكرر / حساب احتيالي"
                            value={policyForm.blockReason}
                            onChange={(e) => setPolicyForm({ ...policyForm, blockReason: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs focus:outline-none focus:border-rose-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                            محظور حتى (اتركه فارغاً للحظر الدائم)
                          </label>
                          <input
                            type="datetime-local"
                            value={policyForm.blockedUntil}
                            onChange={(e) => setPolicyForm({ ...policyForm, blockedUntil: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs focus:outline-none focus:border-rose-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Section B: Cash on Delivery (COD) Override */}
                  <div className="p-3.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-cyan-500" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        صلاحية الدفع عند الاستلام (COD Policy)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                          حالة السماح بالدفع عند الاستلام
                        </label>
                        <select
                          value={policyForm.codOverride}
                          onChange={(e) =>
                            setPolicyForm({
                              ...policyForm,
                              codOverride: e.target.value as 'inherit' | 'allow' | 'deny',
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
                        >
                          <option value="inherit">افتراضي (حسب سياسة المتجر العامة)</option>
                          <option value="allow">مسموح دائماً (استثناء خاص لهذا العميل)</option>
                          <option value="deny">ممنوع نهائياً (إلزام العميل بدفع العربون)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                          الحد الأقصى لمبلغ الطلب عند الاستلام (ج.م)
                        </label>
                        <input
                          type="number"
                          placeholder="اتركه فارغاً لعدم وضع حد"
                          value={policyForm.codMaxOrderAmount}
                          onChange={(e) => setPolicyForm({ ...policyForm, codMaxOrderAmount: e.target.value })}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section C: Personal Discount Settings */}
                  <div className="p-3.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Percent className="w-4 h-4 text-purple-500" />
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          خصم شخصي خاص بالعميل (Personal Discount)
                        </span>
                      </div>

                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={policyForm.personalDiscountEnabled}
                          onChange={(e) =>
                            setPolicyForm({ ...policyForm, personalDiscountEnabled: e.target.checked })
                          }
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                      </label>
                    </div>

                    {policyForm.personalDiscountEnabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs pt-1">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                            نوع الخصم
                          </label>
                          <select
                            value={policyForm.personalDiscountType}
                            onChange={(e) =>
                              setPolicyForm({
                                ...policyForm,
                                personalDiscountType: e.target.value as 'percentage' | 'fixed',
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs focus:outline-none focus:border-purple-500"
                          >
                            <option value="percentage">نسبة مئوية (%)</option>
                            <option value="fixed">مبلغ ثابت (ج.م)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                            قيمة الخصم *
                          </label>
                          <input
                            type="number"
                            required
                            placeholder="مثال: 10 أو 50"
                            value={policyForm.personalDiscountValue}
                            onChange={(e) => setPolicyForm({ ...policyForm, personalDiscountValue: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs focus:outline-none focus:border-purple-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                            تاريخ انتهاء الخصم
                          </label>
                          <input
                            type="datetime-local"
                            value={policyForm.personalDiscountExpiresAt}
                            onChange={(e) =>
                              setPolicyForm({ ...policyForm, personalDiscountExpiresAt: e.target.value })
                            }
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs focus:outline-none focus:border-purple-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Section D: Internal Notes */}
                  <div className="p-3.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1.5 text-xs">
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      ملاحظات إدارية سرية (تظهر لفريق العمل فقط)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="سجل أي ملاحظات بخصوص سياسة هذا العميل..."
                      value={policyForm.adminNotes}
                      onChange={(e) => setPolicyForm({ ...policyForm, adminNotes: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      {actionLoading ? 'جاري الحفظ...' : 'حفظ السياسات والصلاحيات'}
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 4: MERGE IDENTITY */}
              {activeTab === 'merge' && (
                <div className="space-y-4">
                  <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                    <p className="font-bold flex items-center gap-1.5">
                      <GitMerge className="w-4 h-4 text-amber-500" />
                      دمج الهوية المزدوجة (Customer Identity Merge)
                    </p>
                    <p className="text-[11px] leading-relaxed opacity-90">
                      إذا قام هذا العميل مسبقاً بإنشاء حسابين برقمين مختلفين وترغب في توحيد بياناته، قم باختيار الحساب الآخر أدناه.
                      سيتم نقل كافة أرقام الهواتف المرتبطة به وسجل الطلبات بالكامل إلى هذا الحساب الأساسي ({customer.name}).
                    </p>
                  </div>

                  <form onSubmit={handleMergeSubmit} className="space-y-3.5">
                    <div className="space-y-1.5 text-xs">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        اختر العميل المُراد دمجه ونقله إلى هذا الملف ({customer.name})
                      </label>
                      <select
                        required
                        value={sourceCustomerId}
                        onChange={(e) => {
                          setSourceCustomerId(e.target.value);
                          setRequiresBlockedConfirmation(false);
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                      >
                        <option value="">-- اختر عميلاً من القائمة --</option>
                        {candidateCustomers.map((cand) => (
                          <option key={cand.id} value={cand.id}>
                            {cand.name} - {cand.phone} ({cand.totalOrders} طلب - {cand.totalSpent} ج.م) {cand.status === 'blocked' ? '[محظور]' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedSourceCustomer && (
                      <div className="p-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl text-xs space-y-2">
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          ملخص الحساب المُراد دمجه وأرشفته:
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div>الاسم: <span className="font-bold">{selectedSourceCustomer.name}</span></div>
                          <div>الهاتف: <span className="font-mono dir-ltr font-bold">{selectedSourceCustomer.phone}</span></div>
                          <div>عدد الطلبات: <span className="font-bold text-cyan-600">{selectedSourceCustomer.totalOrders}</span></div>
                          <div>إجمالي الإنفاق: <span className="font-bold text-emerald-500">{selectedSourceCustomer.totalSpent} ج.م</span></div>
                          <div>الحالة الحالية: <span className="font-bold">{selectedSourceCustomer.status === 'blocked' ? 'محظور' : 'نشط'}</span></div>
                        </div>
                      </div>
                    )}

                    {requiresBlockedConfirmation && (
                      <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs space-y-2 text-rose-600 dark:text-rose-400">
                        <div className="font-bold flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4" />
                          تنبيه أمني: العميل المُراد دمجه محظور!
                        </div>
                        <p className="text-[11px] leading-relaxed">
                          {blockedWarningMessage}
                        </p>
                        <label className="flex items-center gap-2 cursor-pointer pt-1 font-bold">
                          <input
                            type="checkbox"
                            checked={confirmBlockedSource}
                            onChange={(e) => setConfirmBlockedSource(e.target.checked)}
                            className="rounded border-rose-400 text-rose-600 focus:ring-rose-500"
                          />
                          <span>أؤكد نقل حالة الحظر إلى الحساب الموحد لحماية المتجر</span>
                        </label>
                      </div>
                    )}

                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={!sourceCustomerId || actionLoading || (requiresBlockedConfirmation && !confirmBlockedSource)}
                        className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-40"
                      >
                        {actionLoading ? 'جاري تنفيذ الدمج والأرشفة...' : 'تأكيد دمج العميلين نهائياً'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/40 text-xs">
          <span className="text-[11px] text-slate-400">
            النظام المرجعي للهوية الموحدة • za99405com-ui/elmallah-admin3
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
          >
            إغلاق النافذة
          </button>
        </div>
      </div>
    </div>
  );
};
