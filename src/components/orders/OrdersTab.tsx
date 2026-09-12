import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Order, OrderStatus, DepositMethod } from '../../types';
import {
  Search,
  CheckCircle2,
  Clock,
  Truck,
  XCircle,
  Package,
  Eye,
  Check,
  Printer,
  Calendar,
  Phone,
  MapPin,
  X,
  Sparkles,
  ShieldCheck,
  Banknote,
  FileText,
  Trash2,
} from 'lucide-react';

interface OrdersTabProps {
  defaultFilter?: string;
}

export const OrdersTab: React.FC<OrdersTabProps> = ({ defaultFilter }) => {
  const {
    orders,
    updateOrderStatus,
    confirmDeposit,
    updateOrder,
    deleteOrder,
    adminUser,
    settings,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>(defaultFilter || 'all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Sync if defaultFilter changes
  useEffect(() => {
    if (defaultFilter) {
      setSelectedStatus(defaultFilter);
    }
  }, [defaultFilter]);

  // Modal custom deposit edit state
  const [customDepositAmount, setCustomDepositAmount] = useState<number>(0);
  const [customDepositMethod, setCustomDepositMethod] = useState<DepositMethod>('instapay');
  const [customDepositRef, setCustomDepositRef] = useState<string>('');
  const [customDepositNotes, setCustomDepositNotes] = useState<string>('');
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);

  const handleOpenModal = (order: Order) => {
    setSelectedOrder(order);
    setCustomDepositAmount(order.depositAmount || 0);
    setCustomDepositMethod(order.depositMethod || 'instapay');
    setCustomDepositRef(order.depositReference || '');
    setCustomDepositNotes(order.depositNotes || '');
  };

  // Status definitions with deposit pending count
  const pendingDepositCount = orders.filter((o) => o.depositStatus === 'pending').length;

  const statusTabs: { id: string; label: string; count: number; isHighlight?: boolean }[] = [
    { id: 'all', label: 'الكل', count: orders.length },
    {
      id: 'deposit_pending',
      label: 'بانتظار العربون',
      count: pendingDepositCount,
      isHighlight: pendingDepositCount > 0,
    },
    { id: 'pending', label: 'قيد الانتظار', count: orders.filter((o) => o.status === 'pending').length },
    { id: 'preparing', label: 'التحضير', count: orders.filter((o) => o.status === 'preparing').length },
    { id: 'delivering', label: 'التوصيل', count: orders.filter((o) => o.status === 'delivering').length },
    { id: 'completed', label: 'مكتمل', count: orders.filter((o) => o.status === 'completed').length },
    { id: 'cancelled', label: 'ملغي', count: orders.filter((o) => o.status === 'cancelled').length },
  ];

  // Filtering logic
  const filteredOrders = orders.filter((order) => {
    let matchesStatus = true;
    if (selectedStatus === 'deposit_pending') {
      matchesStatus = order.depositStatus === 'pending';
    } else if (selectedStatus !== 'all') {
      matchesStatus = order.status === selectedStatus;
    }

    const matchesSearch =
      order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customerPhone.includes(searchQuery) ||
      (order.depositReference && order.depositReference.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/20">
            <Clock className="w-3 h-3" />
            انتظار
          </span>
        );
      case 'preparing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/15 text-cyan-500 border border-cyan-500/20">
            <Package className="w-3 h-3" />
            تحضير
          </span>
        );
      case 'delivering':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-500 border border-blue-500/20">
            <Truck className="w-3 h-3" />
            توصيل
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            مكتمل
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-500 border border-rose-500/20">
            <XCircle className="w-3 h-3" />
            ملغي
          </span>
        );
    }
  };

  const getDepositMethodLabel = (method?: DepositMethod) => {
    switch (method) {
      case 'instapay':
        return 'إنستاباي';
      case 'vodafone_cash':
        return 'فودافون كاش';
      case 'orange_cash':
        return 'أورنج كاش';
      case 'etisalat_cash':
        return 'إي آند كاش';
      case 'bank_transfer':
        return 'تحويل بنكي';
      case 'cash':
        return 'كاش';
      default:
        return 'إنستاباي / كاش';
    }
  };

  const getDepositBadge = (order: Order) => {
    if (order.depositStatus === 'confirmed') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <Check className="w-3 h-3" />
          عربون مؤكد ({order.depositAmount} ج.م)
        </span>
      );
    }
    if (order.depositStatus === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          <Clock className="w-3 h-3 animate-spin" style={{ animationDuration: '4s' }} />
          بانتظار العربون ({order.depositAmount} ج.م)
        </span>
      );
    }
    if (order.depositStatus === 'rejected') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/15 text-rose-500 border border-rose-500/20">
          <XCircle className="w-3 h-3" />
          عربون مرفوض
        </span>
      );
    }
    return <span className="text-[10px] text-slate-400">-</span>;
  };

  const handlePrint = (order: Order) => {
    setPrintingOrderId(order.id);
    setTimeout(() => {
      window.print();
      setPrintingOrderId(null);
    }, 300);
  };

  const handleQuickConfirmDeposit = (e: React.MouseEvent, order: Order) => {
    e.stopPropagation();
    confirmDeposit(order.id);
  };

  const handleModalConfirmDeposit = () => {
    if (!selectedOrder) return;
    confirmDeposit(selectedOrder.id, {
      depositAmount: customDepositAmount,
      depositMethod: customDepositMethod,
      depositReference: customDepositRef,
      depositNotes: customDepositNotes,
    });
    setSelectedOrder((prev) =>
      prev
        ? {
            ...prev,
            depositStatus: 'confirmed',
            depositAmount: customDepositAmount,
            remainingAmount: Math.max(0, prev.totalAmount - customDepositAmount),
            depositMethod: customDepositMethod,
            depositReference: customDepositRef,
            depositNotes: customDepositNotes,
            depositConfirmedAt: new Date().toISOString(),
            status: prev.status === 'pending' ? 'preparing' : prev.status,
          }
        : null
    );
  };

  const [showDeleteOrderConfirm, setShowDeleteOrderConfirm] = useState(false);

  const handleConfirmDeleteSelectedOrder = async () => {
    if (!selectedOrder) return;
    await deleteOrder(selectedOrder.id);
    setSelectedOrder(null);
    setShowDeleteOrderConfirm(false);
  };

  const handleModalRejectDeposit = () => {
    if (!selectedOrder) return;
    updateOrder(selectedOrder.id, {
      depositStatus: 'rejected',
      depositNotes: customDepositNotes ? `${customDepositNotes} (تم الرفض)` : 'تم رفض العربون',
    });
    setSelectedOrder((prev) =>
      prev
        ? {
            ...prev,
            depositStatus: 'rejected',
            depositNotes: customDepositNotes ? `${customDepositNotes} (تم الرفض)` : 'تم رفض العربون',
          }
        : null
    );
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Pending Deposit Reception Alert Banner */}
      {pendingDepositCount > 0 && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 animate-spin" style={{ animationDuration: '6s' }} />
            </div>
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-amber-600 dark:text-amber-300 flex items-center gap-2">
                <span>يوجد {pendingDepositCount} طلبات جديدة بانتظار تأكيد العربون</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-slate-950">
                  إجراء مطلوب
                </span>
              </h3>
              <p className="text-[11px] text-amber-600/80 dark:text-amber-300/80 mt-0.5">
                تأكد من استلام تحويل العربون (إنستاباي / كاش) لبدء التحضير.
              </p>
            </div>
          </div>
          <button
            onClick={() => setSelectedStatus('deposit_pending')}
            className="w-full sm:w-auto px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs shadow-xs transition-colors shrink-0 text-center flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>عرض العربونات ({pendingDepositCount})</span>
          </button>
        </div>
      )}

      {/* Top Filter and Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="بحث برقم الطلب، العميل، الهاتف، أو المرجع..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-3 pr-9 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 transition-colors shadow-xs"
          />
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {statusTabs.map((tab) => {
          const isSelected = selectedStatus === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSelectedStatus(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                isSelected
                  ? tab.id === 'deposit_pending'
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'bg-cyan-500 text-slate-950 shadow-xs'
                  : tab.isHighlight
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300'
                  : 'bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  isSelected
                    ? 'bg-slate-950/20 text-slate-950'
                    : tab.isHighlight
                    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Orders Table Container */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-2.5 sm:p-3 pr-4">الطلب</th>
                <th className="p-2.5 sm:p-3">العميل</th>
                <th className="p-2.5 sm:p-3">الأصناف</th>
                <th className="p-2.5 sm:p-3">العربون</th>
                <th className="p-2.5 sm:p-3">الإجمالي</th>
                <th className="p-2.5 sm:p-3">الحالة</th>
                <th className="p-2.5 sm:p-3 pl-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400 text-xs">
                    لا توجد طلبات مطابقة للبحث أو الفلتر المحدد
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    {/* Order number & Date */}
                    <td className="p-2.5 sm:p-3 pr-4 whitespace-nowrap">
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span>#{order.orderNumber}</span>
                        {order.depositStatus === 'pending' && (
                          <span
                            className="w-2 h-2 rounded-full bg-amber-400 animate-ping"
                            title="بانتظار العربون"
                          />
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {new Date(order.createdAt).toLocaleDateString('ar-EG', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>

                    {/* Customer */}
                    <td className="p-2.5 sm:p-3">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {order.customerName}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span className="dir-ltr">{order.customerPhone}</span>
                      </div>
                    </td>

                    {/* Items */}
                    <td className="p-2.5 sm:p-3">
                      <div className="space-y-0.5">
                        {order.items.map((item, idx) => (
                          <div
                            key={idx}
                            className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1.5"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shrink-0" />
                            <span>{item.productName}:</span>
                            <span className="font-bold text-cyan-600 dark:text-cyan-400">
                              {item.quantity} {item.pricingUnit === 'kg' ? 'كجم' : 'قطع'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>

                    {/* Deposit Status */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <div className="space-y-1">
                        {getDepositBadge(order)}
                        {order.depositStatus === 'pending' && (
                          <button
                            onClick={(e) => handleQuickConfirmDeposit(e, order)}
                            className="block px-2 py-0.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold border border-emerald-500/30 transition-colors cursor-pointer"
                            title="تأكيد العربون فوراً"
                          >
                            تأكيد العربون &larr;
                          </button>
                        )}
                        {order.depositReference && (
                          <div className="text-[9px] text-slate-400 font-mono">
                            {order.depositReference}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Total Invoice */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <div className="font-bold text-slate-900 dark:text-white text-sm">
                        {order.totalAmount} ج.م
                      </div>
                      {order.discountAmount > 0 && (
                        <span className="text-[10px] text-emerald-500 block">
                          خصم {order.discountAmount} ج.م
                        </span>
                      )}
                    </td>

                    {/* Status selection */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <div className="space-y-1">
                        {getStatusBadge(order.status)}
                        <select
                          value={order.status}
                          onChange={(e) => updateOrderStatus(order.id, e.target.value as OrderStatus)}
                          className="block text-[10px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 py-0.5 px-1.5 focus:outline-none focus:border-cyan-500 cursor-pointer"
                        >
                          <option value="pending">انتظار</option>
                          <option value="preparing">تحضير</option>
                          <option value="delivering">توصيل</option>
                          <option value="completed">مكتمل</option>
                          <option value="cancelled">ملغي</option>
                        </select>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="p-2.5 sm:p-3 pl-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleOpenModal(order)}
                          className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 transition-colors cursor-pointer"
                          title="عرض التفاصيل وتأكيد العربون"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handlePrint(order)}
                          className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                          title="طباعة الفاتورة"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Details & Deposit Confirmation Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-slate-900 dark:text-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold">
                  طلب #{selectedOrder.orderNumber}
                </h3>
                {getStatusBadge(selectedOrder.status)}
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Deposit Verification & Acceptance Section */}
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-500" />
                  <span className="text-xs font-bold">تأكيد تحصيل العربون</span>
                </div>
                <div>{getDepositBadge(selectedOrder)}</div>
              </div>

              {/* Deposit Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    قيمة العربون (ج.م)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={selectedOrder.totalAmount}
                    value={customDepositAmount}
                    onChange={(e) => setCustomDepositAmount(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    طريقة التحويل
                  </label>
                  <select
                    value={customDepositMethod}
                    onChange={(e) => setCustomDepositMethod(e.target.value as DepositMethod)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
                  >
                    <option value="instapay">إنستاباي InstaPay</option>
                    <option value="vodafone_cash">فودافون كاش</option>
                    <option value="orange_cash">أورنج كاش</option>
                    <option value="etisalat_cash">إي آند كاش</option>
                    <option value="bank_transfer">تحويل بنكي</option>
                    <option value="cash">كاش كامل</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    رقم العملية / المرجع
                  </label>
                  <input
                    type="text"
                    placeholder="مثال: TXN-89241"
                    value={customDepositRef}
                    onChange={(e) => setCustomDepositRef(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Deposit Financial Breakdown */}
              <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
                <div>
                  <span className="text-[10px] text-slate-400 block">الإجمالي</span>
                  <span className="text-xs font-bold">{selectedOrder.totalAmount} ج.م</span>
                </div>
                <div>
                  <span className="text-[10px] text-amber-500 block">العربون</span>
                  <span className="text-xs font-bold text-amber-500">{customDepositAmount} ج.م</span>
                </div>
                <div>
                  <span className="text-[10px] text-emerald-500 block">المتبقي</span>
                  <span className="text-xs font-bold text-emerald-500">
                    {Math.max(0, selectedOrder.totalAmount - customDepositAmount)} ج.م
                  </span>
                </div>
              </div>

              {/* Deposit Confirmation CTAs */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleModalConfirmDeposit}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>تأكيد واستلام العربون</span>
                </button>

                <button
                  type="button"
                  onClick={handleModalRejectDeposit}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-xs font-bold border border-rose-500/30 transition-colors cursor-pointer"
                >
                  رفض العربون
                </button>
              </div>
            </div>

            {/* Customer Info Card */}
            <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3 border border-slate-200 dark:border-slate-700/60 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">العميل:</span>
                <span className="font-bold">{selectedOrder.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">الهاتف:</span>
                <span className="font-bold dir-ltr">{selectedOrder.customerPhone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">العنوان:</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{selectedOrder.customerAddress}</span>
              </div>
            </div>

            {/* Fish Items Card */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">الأصناف المطلوبة:</span>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {selectedOrder.items.map((item, index) => (
                  <div key={index} className="p-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold block">{item.productName}</span>
                      <span className="text-[10px] text-slate-400">
                        {item.unitPrice} ج.م / {item.pricingUnit === 'kg' ? 'كجم' : 'قطعة'}
                      </span>
                    </div>
                    <div className="text-left font-bold text-cyan-600 dark:text-cyan-400">
                      {item.quantity} {item.pricingUnit === 'kg' ? 'كجم' : 'قطع'} = {item.totalPrice} ج.م
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Comprehensive Financial Calculation Breakdown */}
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-3 border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
              <span className="text-[11px] font-bold text-slate-500 block mb-1">البيان المالي الدقيق للحساب:</span>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>المجموع الفرعي للأصناف:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{selectedOrder.subtotal} ج.م</span>
              </div>
              {selectedOrder.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>خصم الكوبون {selectedOrder.couponCode ? `(${selectedOrder.couponCode})` : ''}:</span>
                  <span className="font-mono font-bold">- {selectedOrder.discountAmount} ج.م</span>
                </div>
              )}
              {selectedOrder.deliveryFee > 0 && (
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>رسوم التوصيل ({selectedOrder.city}):</span>
                  <span className="font-mono font-bold">+ {selectedOrder.deliveryFee} ج.م</span>
                </div>
              )}
              <div className="pt-1 border-t border-slate-200 dark:border-slate-800 flex justify-between font-bold text-slate-900 dark:text-slate-100">
                <span>الإجمالي الكلي للطلب:</span>
                <span className="font-mono text-cyan-600 dark:text-cyan-400">{selectedOrder.totalAmount} ج.م</span>
              </div>
              <div className="flex justify-between text-amber-600 dark:text-amber-400">
                <span>العربون ({selectedOrder.depositStatus === 'confirmed' ? 'مؤكد ومستلم' : 'غير مؤكد'}):</span>
                <span className="font-mono font-bold">- {selectedOrder.depositAmount} ج.م</span>
              </div>
              <div className="pt-1 border-t border-dashed border-slate-300 dark:border-slate-700 flex justify-between font-black text-sm text-emerald-600 dark:text-emerald-400">
                <span>المبلغ المتبقي للتحصيل عند التسليم:</span>
                <span className="font-mono">
                  {selectedOrder.remainingAmount !== undefined
                    ? selectedOrder.remainingAmount
                    : Math.max(0, selectedOrder.totalAmount - selectedOrder.depositAmount)}{' '}
                  ج.م
                </span>
              </div>
            </div>

            {/* Delete confirmation banner inside modal */}
            {showDeleteOrderConfirm && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-2">
                <span className="text-xs text-rose-500 font-bold">
                  هل أنت متأكد من حذف الطلب #{selectedOrder.orderNumber} نهائياً؟
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleConfirmDeleteSelectedOrder}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold cursor-pointer transition-colors"
                  >
                    تأكيد الحذف
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteOrderConfirm(false)}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold cursor-pointer"
                  >
                    تراجع
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePrint(selectedOrder)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة</span>
                </button>

                {adminUser?.role === 'super_admin' && !showDeleteOrderConfirm && (
                  <button
                    onClick={() => setShowDeleteOrderConfirm(true)}
                    className="px-3 py-1.5 rounded-lg border border-rose-500/30 text-xs font-bold text-rose-500 hover:bg-rose-500/10 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف الطلب</span>
                  </button>
                )}
              </div>

              <button
                onClick={() => {
                  setSelectedOrder(null);
                  setShowDeleteOrderConfirm(false);
                }}
                className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-xs cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
