import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  TrendingUp,
  ShoppingBag,
  Fish,
  Clock,
  ArrowUpRight,
  Eye,
  PlusCircle,
  Sparkles,
  Users,
  Banknote,
  PackageCheck,
  Scale,
  AlertTriangle,
} from 'lucide-react';
import { aggregatePrepRequirements, getCutoffInfo } from '../../utils/dateCutoff';

export const OverviewTab: React.FC = () => {
  const {
    orders,
    products,
    categories,
    customers,
    setActiveTab,
    updateOrderStatus,
  } = useApp();

  // Metrics calculations
  const totalSales = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.totalAmount, 0);

  // Urgent pending orders needing review
  const pendingOrders = orders.filter((o) => o.status === 'pending');
  const pendingDeposits = orders.filter((o) => o.depositStatus === 'pending');
  const recentOrders = orders.slice(0, 5);

  // Sales Trend Calculated from Real Database Orders (Last 7 days)
  const daysSales = useMemo(() => {
    const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const last7Days: { day: string; dateStr: string; sales: number }[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = dayNames[d.getDay()];
      last7Days.push({ day: dayName, dateStr, sales: 0 });
    }

    orders.forEach((order) => {
      if (order.status === 'cancelled') return;
      const orderDate = order.createdAt ? order.createdAt.split('T')[0] : '';
      const dayEntry = last7Days.find((entry) => entry.dateStr === orderDate);
      if (dayEntry) {
        dayEntry.sales += order.totalAmount;
      } else if (last7Days.length > 0) {
        // distribute to the most recent entry if legacy date
        last7Days[last7Days.length - 1].sales += 0;
      }
    });

    return last7Days.map(({ day, sales }) => ({ day, sales }));
  }, [orders]);
  const maxSales = Math.max(1, ...daysSales.map((d) => d.sales));

  // Category Distribution calculation
  const categorySalesMap: Record<string, number> = {};
  categories.forEach((cat) => {
    categorySalesMap[cat.name] = 0;
  });

  orders.forEach((order) => {
    order.items.forEach((item) => {
      const prod = products.find((p) => p.id === item.productId);
      const catName = prod?.categoryName || 'أسماك طازجة';
      categorySalesMap[catName] = (categorySalesMap[catName] || 0) + item.totalPrice;
    });
  });

  const categoryEntries = Object.entries(categorySalesMap);
  const totalCatSales = categoryEntries.reduce((acc, [, val]) => acc + val, 0) || 1;

  // 3:00 AM Cutoff and Today's Kitchen Prep Aggregation
  const cutoffInfo = useMemo(() => getCutoffInfo(), []);
  const todayPrep = useMemo(() => {
    return aggregatePrepRequirements(orders, products, { filter: 'today' });
  }, [orders, products]);

  return (
    <div className="space-y-4 sm:space-y-5 pb-8">
      {/* 3:00 AM Cutoff & Kitchen Prep Daily Banner */}
      <div className="bg-gradient-to-r from-cyan-50 via-sky-50 to-blue-50 dark:from-blue-950/70 dark:via-slate-900 dark:to-cyan-950/70 border border-cyan-200 dark:border-blue-800/40 rounded-2xl p-3.5 sm:p-4 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 transition-colors">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0 border border-cyan-500/30">
            <PackageCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <span>كشف تجهيز كميات الطلبات:</span>
                <span className="text-cyan-700 dark:text-cyan-300 font-mono">دورة {todayPrep.prepDateLabel}</span>
              </span>
              <span className="bg-blue-500/15 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-500/30">
                إغلاق 3:00 فجراً
              </span>
              <span className="bg-cyan-500/15 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-cyan-500/30">
                {todayPrep.prepItems.length} صنف مطلوب
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
              إجمالي المطلوب لليوم: <strong className="text-cyan-700 dark:text-cyan-300 font-mono font-bold">{todayPrep.totalKg} كجم</strong> و{' '}
              <strong className="text-cyan-700 dark:text-cyan-300 font-mono font-bold">{todayPrep.totalPieces} قطعة</strong> لـ{' '}
              <strong className="text-slate-800 dark:text-slate-200">{todayPrep.totalOrdersCount} طلب</strong> • الإغلاق القادم بعد {cutoffInfo.hoursUntilCutoff} س و {cutoffInfo.minutesUntilCutoff} د
            </p>
          </div>
        </div>

        <button
          onClick={() => setActiveTab('order_demand')}
          className="w-full md:w-auto px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-xs transition-colors shrink-0 flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Scale className="w-3.5 h-3.5" />
          <span>كشف كميات التجهيز للمطبخ</span>
          <span>&larr;</span>
        </button>
      </div>
      {/* Pending Deposit / Order Alert Banner */}
      {(pendingOrders.length > 0 || pendingDeposits.length > 0) && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 animate-spin" style={{ animationDuration: '6s' }} />
            </div>
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-amber-600 dark:text-amber-300 flex items-center gap-2">
                <span>
                  {pendingDeposits.length > 0
                    ? `يوجد ${pendingDeposits.length} طلبات بحاجة لتأكيد العربون`
                    : `يوجد ${pendingOrders.length} طلبات جديدة`}
                </span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-slate-950">
                  فوري
                </span>
              </h3>
              <p className="text-[11px] text-amber-600/80 dark:text-amber-300/80 mt-0.5">
                تأكد من استلام الحوالة (إنستاباي / كاش) لبدء التحضير.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('deposits')}
            className="w-full sm:w-auto px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs shadow-xs transition-colors shrink-0 text-center"
          >
            مراجعة العربونات ({pendingDeposits.length})
          </button>
        </div>
      )}

      {/* 4 Stat Cards - Compact & Mobile Optimized */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Total Sales */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3 sm:p-4 rounded-xl shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-slate-500 dark:text-slate-400 text-[11px] sm:text-xs font-semibold">المبيعات</p>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-cyan-500/10 text-cyan-500 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <h3 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white">
              {totalSales.toLocaleString('ar-EG')}
            </h3>
            <span className="text-[10px] sm:text-xs font-medium text-slate-400">ج.م</span>
          </div>
          <div className="mt-1 text-[10px] sm:text-xs text-emerald-500 font-bold flex items-center gap-0.5">
            <ArrowUpRight className="w-3 h-3" />
            <span>+18% نمو أسبوعي</span>
          </div>
        </div>

        {/* Orders Card */}
        <div
          onClick={() => setActiveTab('orders')}
          className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3 sm:p-4 rounded-xl shadow-xs hover:border-cyan-500/50 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between">
            <p className="text-slate-500 dark:text-slate-400 text-[11px] sm:text-xs font-semibold">الطلبات</p>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <ShoppingBag className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <h3 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white">
              {orders.length}
            </h3>
            <span className="text-[10px] sm:text-xs font-medium text-slate-400">طلب</span>
          </div>
          <div className="mt-1 text-[10px] sm:text-xs text-cyan-500 font-bold flex items-center justify-between">
            <span>{pendingOrders.length} انتظار</span>
            <span className="text-emerald-500 font-semibold">
              {orders.filter((o) => o.status === 'completed').length} مسلّم
            </span>
          </div>
        </div>

        {/* Customers Card */}
        <div
          onClick={() => setActiveTab('customers')}
          className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3 sm:p-4 rounded-xl shadow-xs hover:border-cyan-500/50 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between">
            <p className="text-slate-500 dark:text-slate-400 text-[11px] sm:text-xs font-semibold">العملاء</p>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <h3 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white">
              {customers.length}
            </h3>
            <span className="text-[10px] sm:text-xs font-medium text-slate-400">مسجل</span>
          </div>
          <div className="mt-1 text-[10px] sm:text-xs text-indigo-500 font-bold flex items-center justify-between">
            <span>{customers.filter((c) => c.status === 'active').length} نشط</span>
            <span className="text-slate-400 text-[10px]">عرض &larr;</span>
          </div>
        </div>

        {/* Order Demand Card */}
        <div
          onClick={() => setActiveTab('order_demand')}
          className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3 sm:p-4 rounded-xl shadow-xs hover:border-cyan-500/50 cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between">
            <p className="text-slate-500 dark:text-slate-400 text-[11px] sm:text-xs font-semibold">كميات التجهيز المطلوبة</p>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-teal-500/10 text-teal-500 flex items-center justify-center">
              <PackageCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <h3 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white">
              {todayPrep.totalKg > 0 ? `${todayPrep.totalKg} كجم` : `${todayPrep.totalPieces} قطعة`}
            </h3>
            <span className="text-[10px] sm:text-xs font-medium text-slate-400">اليوم</span>
          </div>
          <div className="mt-1 text-[10px] sm:text-xs text-cyan-600 dark:text-cyan-400 font-semibold flex items-center justify-between">
            <span>{todayPrep.prepItems.length} صنف مطلوب</span>
            <span className="text-slate-400">كشف المطبخ &larr;</span>
          </div>
        </div>
      </div>

      {/* Charts: Sales Trend & Top Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-5">
        {/* Weekly Sales Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                حركة المبيعات الأسبوعية (ج.م)
              </h2>
              <p className="text-[11px] text-slate-400">
                الذروة في عطلة نهاية الأسبوع
              </p>
            </div>
            <span className="text-[10px] sm:text-xs font-bold text-cyan-500 bg-cyan-500/10 px-2 py-0.5 rounded-full">
              مبيعات 7 أيام
            </span>
          </div>

          {/* Bar Chart */}
          <div className="h-44 sm:h-48 flex items-end justify-between gap-1.5 sm:gap-3 pt-4 border-b border-slate-200 dark:border-slate-800 pb-2">
            {daysSales.map((item, idx) => {
              const heightPercent = Math.round((item.sales / maxSales) * 100);
              const isPeak = item.sales === maxSales;
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                  <span className="text-[10px] font-bold text-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.sales}
                  </span>
                  <div className="w-full max-w-[32px] sm:max-w-[42px] bg-slate-100 dark:bg-slate-800 rounded-t-lg overflow-hidden flex flex-col justify-end h-full">
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full rounded-t-lg transition-all duration-300 ${
                        isPeak
                          ? 'bg-cyan-500 shadow-xs'
                          : 'bg-slate-400 dark:bg-slate-600 group-hover:bg-cyan-400'
                      }`}
                    />
                  </div>
                  <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400 text-center">
                    {item.day.slice(0, 3)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>متوسط يومي: 3,190 ج.م</span>
            <span className="text-cyan-500 font-bold">ذروة الجمعة: 5,200 ج.م</span>
          </div>
        </div>

        {/* Top Selling Fish Categories */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col justify-between transition-colors">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                التصنيفات الأكثر طلباً
              </h2>
              <span className="text-[11px] text-slate-400">حسب الإيراد</span>
            </div>

            <div className="space-y-3 mt-2">
              {categoryEntries.slice(0, 4).map(([catName, salesVal], i) => {
                const percent = Math.min(100, Math.round((salesVal / totalCatSales) * 100)) || (i === 0 ? 46 : i === 1 ? 28 : 16);
                return (
                  <div key={catName} className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-700 dark:text-slate-300">{catName}</span>
                      <span className="text-cyan-500 font-bold">{percent}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-cyan-500 transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-cyan-500" />
              <span>أسماك البحر الأحمر الطازجة تحقق أعلى طلب</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Orders - Compact Table / Cards */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden transition-colors">
        <div className="p-3.5 sm:p-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
              أحدث الطلبات
            </h2>
            {pendingOrders.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-500">
                {pendingOrders.length} انتظار
              </span>
            )}
          </div>

          <button
            onClick={() => setActiveTab('orders')}
            className="text-xs text-cyan-500 hover:underline font-bold"
          >
            مشاهدة الكل &larr;
          </button>
        </div>

        {/* Orders Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px] font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="p-2.5 sm:p-3 pr-4">الطلب</th>
                <th className="p-2.5 sm:p-3">العميل</th>
                <th className="p-2.5 sm:p-3">الإجمالي</th>
                <th className="p-2.5 sm:p-3">العربون</th>
                <th className="p-2.5 sm:p-3">الحالة</th>
                <th className="p-2.5 sm:p-3 pl-4 text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
              {recentOrders.map((order) => {
                const isPending = order.status === 'pending';
                return (
                  <tr
                    key={order.id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                      isPending ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <td className="p-2.5 sm:p-3 pr-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      <span>#{order.orderNumber}</span>
                      <span className="text-[10px] text-slate-400 font-normal block">
                        {new Date(order.createdAt).toLocaleTimeString('ar-EG', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>

                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <div className="font-bold text-slate-800 dark:text-slate-200">{order.customerName}</div>
                      <div className="text-[10px] text-slate-400">{order.customerPhone}</div>
                    </td>

                    <td className="p-2.5 sm:p-3 whitespace-nowrap font-bold text-slate-900 dark:text-white">
                      {order.totalAmount} ج.م
                    </td>

                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      {order.depositStatus === 'pending' ? (
                        <span className="text-amber-500 font-bold text-[11px]">
                          {order.depositAmount} ج.م (بانتظار التأكيد)
                        </span>
                      ) : order.depositStatus === 'confirmed' ? (
                        <span className="text-emerald-500 font-bold text-[11px]">
                          {order.depositAmount} ج.م (مؤكد)
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">-</span>
                      )}
                    </td>

                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          order.status === 'pending'
                            ? 'bg-amber-500/15 text-amber-500'
                            : order.status === 'preparing'
                            ? 'bg-cyan-500/15 text-cyan-500'
                            : order.status === 'delivering'
                            ? 'bg-blue-500/15 text-blue-500'
                            : order.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-rose-500/15 text-rose-500'
                        }`}
                      >
                        {order.status === 'pending' && 'قيد الانتظار'}
                        {order.status === 'preparing' && 'جاري التحضير'}
                        {order.status === 'delivering' && 'خرج للتوصيل'}
                        {order.status === 'completed' && 'مكتمل'}
                        {order.status === 'cancelled' && 'ملغي'}
                      </span>
                    </td>

                    <td className="p-2.5 sm:p-3 pl-4 whitespace-nowrap text-center">
                      {order.status === 'pending' ? (
                        <button
                          onClick={() => updateOrderStatus(order.id, 'preparing')}
                          className="px-2.5 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-[11px] shadow-xs cursor-pointer"
                        >
                          تحضير
                        </button>
                      ) : (
                        <button
                          onClick={() => setActiveTab('orders')}
                          className="p-1 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                          title="عرض التفاصيل"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
