import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  PackageCheck,
  Clock,
  Calendar,
  Share2,
  Printer,
  Download,
  Plus,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Scale,
  Fish,
  Utensils,
  Check,
  Send,
  Layers,
  PhoneCall,
  Table,
  LayoutGrid,
} from 'lucide-react';
import {
  getTodayPrepDate,
  getTomorrowPrepDate,
  formatArabicDate,
  getCutoffInfo,
  aggregatePrepRequirements,
} from '../../utils/dateCutoff';
import { PrepCycleFilter, Order, PricingUnit } from '../../types';

export const OrderDemandTab: React.FC = () => {
  const {
    products,
    orders,
    addOrder,
    addToast,
  } = useApp();

  // Cycle filter state
  const [cycleFilter, setCycleFilter] = useState<PrepCycleFilter>('today');
  const [customDate, setCustomDate] = useState<string>(getTodayPrepDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [prepStatusFilter, setPrepStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');

  // View Mode: 'cards' or 'table'
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // Expanded item row IDs to view orders breakdown
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  // Checklist for kitchen: items/variants marked as prepared
  const [preparedItems, setPreparedItems] = useState<Record<string, boolean>>({});

  // Quick manual intake modal state
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [intakeCustName, setIntakeCustName] = useState('');
  const [intakeCustPhone, setIntakeCustPhone] = useState('');
  const [intakeCustAddress, setIntakeCustAddress] = useState('استلام من فرع المحل');
  const [intakeProductId, setIntakeProductId] = useState('');
  const [intakeVariantTitle, setIntakeVariantTitle] = useState('');
  const [intakeQuantity, setIntakeQuantity] = useState('1');
  const [intakeNotes, setIntakeNotes] = useState('');
  const [intakeDepositAmount, setIntakeDepositAmount] = useState('0');

  // Live cutoff timer update
  const [cutoffData, setCutoffData] = useState(() => getCutoffInfo());

  useEffect(() => {
    const timer = setInterval(() => {
      setCutoffData(getCutoffInfo());
    }, 1000 * 30);
    return () => clearInterval(timer);
  }, []);

  // Calculate aggregation based on active cycle
  const prepResult = useMemo(() => {
    return aggregatePrepRequirements(orders, products, {
      filter: cycleFilter,
      customDate: cycleFilter === 'custom' ? customDate : undefined,
    });
  }, [orders, products, cycleFilter, customDate]);

  // Flattened list of all sizes/variants across all products for the Master Aggregation Table
  const allFlattenedVariants = useMemo(() => {
    const list: {
      productId: string;
      productName: string;
      categoryName?: string;
      variantId: string;
      variantTitle: string;
      requiredQuantity: number;
      pricingUnit: PricingUnit;
      ordersCount: number;
      orders: {
        orderNumber: string;
        customerName: string;
        customerPhone: string;
        quantity: number;
        notes?: string;
      }[];
    }[] = [];

    prepResult.prepItems.forEach((item) => {
      if (item.variantsBreakdown && item.variantsBreakdown.length > 0) {
        item.variantsBreakdown.forEach((vb) => {
          // Filter related orders for this specific variant
          const relatedOrders = item.orders
            .filter((o) => {
              if (!o.variantTitle) return vb.variantId === 'base' || vb.variantTitle.includes('الأساسي');
              return o.variantTitle.trim().toLowerCase() === vb.variantTitle.trim().toLowerCase();
            })
            .map((o) => ({
              orderNumber: o.orderNumber,
              customerName: o.customerName,
              customerPhone: o.customerPhone,
              quantity: o.quantity,
              notes: o.notes,
            }));

          list.push({
            productId: item.productId,
            productName: item.productName,
            categoryName: item.categoryName,
            variantId: vb.variantId,
            variantTitle: vb.variantTitle,
            requiredQuantity: vb.requiredQuantity,
            pricingUnit: vb.pricingUnit,
            ordersCount: vb.ordersCount || relatedOrders.length,
            orders: relatedOrders,
          });
        });
      } else {
        list.push({
          productId: item.productId,
          productName: item.productName,
          categoryName: item.categoryName,
          variantId: 'base',
          variantTitle: 'الحجم القياسي',
          requiredQuantity: item.totalRequired,
          pricingUnit: item.pricingUnit,
          ordersCount: item.ordersCount,
          orders: item.orders.map((o) => ({
            orderNumber: o.orderNumber,
            customerName: o.customerName,
            customerPhone: o.customerPhone,
            quantity: o.quantity,
            notes: o.notes,
          })),
        });
      }
    });

    return list;
  }, [prepResult.prepItems]);

  // Filtered prep items by search & preparation status
  const filteredPrepItems = useMemo(() => {
    return prepResult.prepItems.filter((item) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.productName.toLowerCase().includes(q);
        const matchesCategory = item.categoryName?.toLowerCase().includes(q);
        const matchesVariant = item.variantsBreakdown?.some((v) =>
          v.variantTitle.toLowerCase().includes(q)
        );
        if (!matchesName && !matchesCategory && !matchesVariant) return false;
      }

      const isCompleted = !!preparedItems[item.productId];
      if (prepStatusFilter === 'pending' && isCompleted) return false;
      if (prepStatusFilter === 'completed' && !isCompleted) return false;

      return true;
    });
  }, [prepResult.prepItems, searchQuery, prepStatusFilter, preparedItems]);

  // Filtered table variants
  const filteredTableVariants = useMemo(() => {
    return allFlattenedVariants.filter((item) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.productName.toLowerCase().includes(q);
        const matchesCategory = item.categoryName?.toLowerCase().includes(q);
        const matchesVariant = item.variantTitle.toLowerCase().includes(q);
        if (!matchesName && !matchesCategory && !matchesVariant) return false;
      }

      const rowKey = `${item.productId}-${item.variantId}`;
      const isCompleted = !!preparedItems[rowKey] || !!preparedItems[item.productId];
      if (prepStatusFilter === 'pending' && isCompleted) return false;
      if (prepStatusFilter === 'completed' && !isCompleted) return false;

      return true;
    });
  }, [allFlattenedVariants, searchQuery, prepStatusFilter, preparedItems]);

  // Count prepared items
  const preparedCount = useMemo(() => {
    return Object.values(preparedItems).filter(Boolean).length;
  }, [preparedItems]);

  const toggleExpand = (productId: string) => {
    setExpandedItems((prev) => ({ ...prev, [productId]: !prev[productId] }));
  };

  const togglePreparedStatus = (key: string) => {
    setPreparedItems((prev) => {
      const next = !prev[key];
      addToast({
        type: next ? 'success' : 'info',
        title: next ? 'تم تسجيل الصنف كجاهز' : 'تمت إعادة الصنف لقائمة التجهيز',
        description: next ? 'تم وضع علامة اكتمال تجهيز الكمية المطلوبة بالمطبخ' : 'تمت إعادة الصنف لقيد التجهيز',
      });
      return { ...prev, [key]: next };
    });
  };

  // Printable Kitchen Sheet
  const handlePrintPrepSheet = () => {
    window.print();
  };

  // Export CSV for supplier / kitchen with SIZES & VARIANTS included
  const handleExportCSV = () => {
    const headers = [
      'اسم الصنف',
      'الحجم / المقاس',
      'إجمالي المطلوب المجمع',
      'الوحدة',
      'عدد الطلبات',
      'ملاحظات العملاء والتنظيف',
    ];

    const rows = allFlattenedVariants.map((item) => [
      `"${item.productName}"`,
      `"${item.variantTitle}"`,
      item.requiredQuantity,
      item.pricingUnit === 'kg' ? 'كيلوجرام' : 'قطعة',
      item.ordersCount,
      `"${item.orders.map((o) => o.notes).filter(Boolean).join(' | ')}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `تجميع_طلبات_التجهيز_${cycleFilter}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    addToast({
      type: 'success',
      title: 'تم تصدير كشف التجميع بنجاح',
      description: 'تم تحميل ملف CSV مفصلاً بكافة الأصناف ومقاساتها المجمعة',
    });
  };

  // Share formatted WhatsApp Message with SIZES & VARIANTS
  const handleShareWhatsApp = () => {
    let msg = `*🐟 كشف وتجميع طلبات التجهيز للمطبخ - أسماك الملاح*\n`;
    msg += `📅 الدورة: ${prepResult.prepDateLabel}\n`;
    msg += `⏰ توقيت الإغلاق: 3:00 فجراً\n`;
    msg += `---------------------------------\n`;
    msg += `*📊 إجمالي الكميات المطلوبة للتجهيز:*\n`;
    msg += `• إجمالي الوزن المطلوب: ${prepResult.totalKg} كجم\n`;
    msg += `• إجمالي القطع المطلوبة: ${prepResult.totalPieces} قطعة\n`;
    msg += `• عدد الطلبات المدرجة: ${prepResult.totalOrdersCount} طلب\n\n`;

    msg += `*📋 تفصيل الكميات المطلوبة حسب الصنف والمقاس:*\n`;
    prepResult.prepItems.forEach((item, index) => {
      const unit = item.pricingUnit === 'kg' ? 'كجم' : 'ق';
      msg += `\n*${index + 1}. ${item.productName}* (الإجمالي: ${item.totalRequired} ${unit}):\n`;
      if (item.variantsBreakdown && item.variantsBreakdown.length > 0) {
        item.variantsBreakdown.forEach((vb) => {
          if (vb.requiredQuantity > 0) {
            msg += `   ▫️ ${vb.variantTitle}: *${vb.requiredQuantity} ${unit}* (${vb.ordersCount} طلبات)\n`;
          }
        });
      } else {
        msg += `   ▫️ المطلوب: *${item.totalRequired} ${unit}*\n`;
      }
    });

    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  // Submit quick order intake
  const handleQuickIntakeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!intakeCustName.trim() || !intakeCustPhone.trim()) {
      addToast({
        type: 'error',
        title: 'بيانات غير مكتملة',
        description: 'يرجى إدخال اسم العميل ورقم هاتفه',
      });
      return;
    }

    const selectedProd = products.find((p) => p.id === intakeProductId) || products[0];
    if (!selectedProd) return;

    const rawQty = intakeQuantity;
    const numQty = Number(rawQty);
    if (isNaN(numQty) || !isFinite(numQty) || numQty <= 0) {
      addToast({
        type: 'error',
        title: 'كمية غير صالحة',
        description: 'يرجى إدخال كمية رقمية صحيحة ومحددة أكبر من صفر',
      });
      return;
    }

    if (selectedProd.pricingUnit === 'piece' && !Number.isInteger(numQty)) {
      addToast({
        type: 'error',
        title: 'كمية غير صالحة',
        description: `الصنف "${selectedProd.name}" يُباع بالقطعة، ويجب تحديد كمية صحيحة بدون كسور`,
      });
      return;
    }

    if (selectedProd.minOrderQuantity && numQty < selectedProd.minOrderQuantity) {
      addToast({
        type: 'error',
        title: 'الحد الأدنى للطلب',
        description: `الحد الأدنى لطلب ${selectedProd.name} هو ${selectedProd.minOrderQuantity} ${selectedProd.pricingUnit === 'piece' ? 'قطعة' : 'كجم'}`,
      });
      return;
    }

    if (selectedProd.maxOrderQuantity && numQty > selectedProd.maxOrderQuantity) {
      addToast({
        type: 'error',
        title: 'تجاوز الحد الأقصى',
        description: `الحد الأقصى لطلب ${selectedProd.name} هو ${selectedProd.maxOrderQuantity} ${selectedProd.pricingUnit === 'piece' ? 'قطعة' : 'كجم'}`,
      });
      return;
    }

    const qty = numQty;
    const itemTotal = qty * selectedProd.price;
    const subtotal = itemTotal;
    const deliveryFee = 35;
    const totalAmount = subtotal + deliveryFee;
    const deposit = Number(intakeDepositAmount) || 0;

    const newOrderPayload: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'> = {
      customerName: intakeCustName.trim(),
      customerPhone: intakeCustPhone.trim(),
      customerAddress: intakeCustAddress.trim() || 'استلام من فرع المحل',
      items: [
        {
          productId: selectedProd.id,
          productName: selectedProd.name,
          variantTitle: intakeVariantTitle.trim() || undefined,
          pricingUnit: selectedProd.pricingUnit,
          unitPrice: selectedProd.price,
          quantity: qty,
          totalPrice: itemTotal,
        },
      ],
      subtotal,
      deliveryFee,
      discountAmount: 0,
      totalAmount,
      depositAmount: deposit,
      depositStatus: deposit > 0 ? 'confirmed' : 'pending',
      depositMethod: 'instapay',
      remainingAmount: Math.max(0, totalAmount - deposit),
      status: 'pending',
      notes: intakeNotes.trim() || undefined,
    };

    addOrder(newOrderPayload);
    setShowIntakeModal(false);
    setIntakeCustName('');
    setIntakeCustPhone('');
    setIntakeVariantTitle('');
    setIntakeNotes('');
    setIntakeDepositAmount('0');

    addToast({
      type: 'success',
      title: 'تم تسجيل الطلب وتجميعه',
      description: `تم إدراج ${qty} من ${selectedProd.name} في دورة التجهيز بنجاح`,
    });
  };

  return (
    <div className="space-y-4 sm:space-y-5 pb-12 animate-fadeIn" dir="rtl">
      {/* 1. Header Banner & Aggregation Notice */}
      <div className="bg-gradient-to-r from-cyan-50 via-sky-50 to-blue-50 dark:from-blue-950/70 dark:via-slate-900 dark:to-cyan-950/70 border border-cyan-200 dark:border-blue-800/40 rounded-2xl p-4 sm:p-5 shadow-xs transition-colors">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-cyan-500/15 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-400 flex items-center justify-center shrink-0 border border-cyan-500/30">
              <Scale className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <span>كشف وتجميع طلبات التجهيز للمطبخ</span>
                </h2>
                <span className="bg-cyan-500/15 dark:bg-cyan-500/20 text-cyan-800 dark:text-cyan-300 px-2.5 py-0.5 rounded-full text-[11px] font-bold border border-cyan-500/30">
                  تجميع آلي حسب الصنف والمقاس
                </span>
                <span className="bg-blue-500/15 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded-full text-[10px] font-bold border border-blue-500/30">
                  إغلاق 3:00 فجراً
                </span>
              </div>

              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                يقوم النظام تلقائياً بفرز وتجميع كميات الأسماك من كافة الطلبات الواردة بحسب <strong className="text-cyan-700 dark:text-cyan-300">النوع والحجم (المقاس)</strong> لتجهيزها وتنظيفها مباشرة بالمطبخ دون الحاجة لنظام مخزون.
              </p>
            </div>
          </div>

          {/* Action & Cutoff pill */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0 w-full lg:w-auto justify-between lg:justify-end pt-2 lg:pt-0 border-t border-slate-200 dark:border-slate-800 lg:border-t-0">
            <div className="bg-white/80 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-center shadow-xs">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">الإغلاق القادم (3 فجراً)</div>
              <div className="text-xs sm:text-sm font-mono font-bold text-cyan-600 dark:text-cyan-400">
                باقي {cutoffData.hoursUntilCutoff} س و {cutoffData.minutesUntilCutoff} د
              </div>
            </div>

            <button
              onClick={() => {
                setIntakeProductId(products[0]?.id || '');
                setShowIntakeModal(true);
              }}
              className="flex items-center gap-1.5 py-2 px-3 sm:px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs sm:text-sm transition-all shadow-xs cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>إدخال طلب يدوي</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Cycle Tabs & Fast Control Bar */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs transition-colors space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          {/* Day selection tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              onClick={() => setCycleFilter('today')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                cycleFilter === 'today'
                  ? 'bg-cyan-500 text-slate-950 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              <span>تجميع اليوم</span>
              <span className="text-[10px] opacity-80 px-1 py-0.2 rounded bg-black/10 dark:bg-black/30 font-mono">
                {formatArabicDate(getTodayPrepDate()).split('،')[0]}
              </span>
            </button>

            <button
              onClick={() => setCycleFilter('tomorrow')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                cycleFilter === 'tomorrow'
                  ? 'bg-cyan-500 text-slate-950 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>تجميع الغد</span>
              <span className="text-[10px] opacity-80 px-1 py-0.2 rounded bg-black/10 dark:bg-black/30 font-mono">
                {formatArabicDate(getTomorrowPrepDate()).split('،')[0]}
              </span>
            </button>

            <button
              onClick={() => setCycleFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                cycleFilter === 'all'
                  ? 'bg-cyan-500 text-slate-950 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>كافة الطلبات النشطة</span>
            </button>

            <button
              onClick={() => setCycleFilter('custom')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                cycleFilter === 'custom'
                  ? 'bg-cyan-500 text-slate-950 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>تاريخ مخصص</span>
            </button>
          </div>

          {/* View Switcher & Action Buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto justify-between sm:justify-end flex-wrap">
            {/* View Mode Toggle */}
            <div className="flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setViewMode('cards')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="عرض بطاقات الأصناف وتفاصيل الأحجام"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden md:inline">بطاقات الأصناف</span>
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="عرض جدول التجميع الشامل للأحجام والمطبخ"
              >
                <Table className="w-3.5 h-3.5" />
                <span className="hidden md:inline">جدول التجميع الشامل</span>
              </button>
            </div>

            {/* Actions: Print, CSV, WhatsApp */}
            <button
              onClick={handlePrintPrepSheet}
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
              title="طباعة كشف التجهيز للمطبخ"
            >
              <Printer className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              <span className="hidden sm:inline">طباعة</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
              title="تصدير كشف التجميع إلى Excel / CSV"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="hidden sm:inline">تصدير CSV</span>
            </button>

            <button
              onClick={handleShareWhatsApp}
              className="p-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 transition-colors shadow-xs cursor-pointer"
              title="إرسال كشف التجميع عبر واتساب"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">واتساب</span>
            </button>
          </div>
        </div>

        {/* Custom date picker row if active */}
        {cycleFilter === 'custom' && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center gap-3">
            <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">تاريخ دورة التجميع:</span>
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <span className="text-xs text-cyan-600 dark:text-cyan-400 font-bold">{formatArabicDate(customDate)}</span>
          </div>
        )}
      </div>

      {/* 3. Top Metrics Cards (Aggregated Totals) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Metric 1: Total Kg Required */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">إجمالي الوزن المطلوب</span>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
              <Scale className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
              {prepResult.totalKg}
            </span>
            <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400">كجم</span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
            مطلوب تجهيزه وتنظيفه لكافة الطلبات
          </div>
        </div>

        {/* Metric 2: Total Pieces */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">إجمالي القطع المطلوبة</span>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Fish className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
              {prepResult.totalPieces}
            </span>
            <span className="text-xs font-bold text-blue-600 dark:text-blue-400">قطعة</span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
            كابوريا، استاكوزا، وجبات بحرية
          </div>
        </div>

        {/* Metric 3: Total Orders Included */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">الطلبات المدرجة بالدورة</span>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <PackageCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
              {prepResult.totalOrdersCount}
            </span>
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">طلب</span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1 truncate">
            جميعها مجمعة ضمن كشف التجهيز
          </div>
        </div>

        {/* Metric 4: Kitchen Preparation Progress */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">حالة الإنجاز بالمطبخ</span>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
              {preparedCount}
            </span>
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">من {allFlattenedVariants.length} بند</span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1 truncate">
            {preparedCount === allFlattenedVariants.length && allFlattenedVariants.length > 0
              ? 'اكتمل تجهيز كافة بنود الدورة'
              : 'جاري التجهيز والتنظيف بالمطبخ'}
          </div>
        </div>
      </div>

      {/* 4. Search & Filter Bar */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs transition-colors flex flex-col sm:flex-row items-center justify-between gap-2.5">
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder="بحث عن صنف أو مقاس..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-xs rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-cyan-500"
          />
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end text-xs">
          <span className="text-slate-500 dark:text-slate-400 text-[11px] font-semibold flex items-center gap-1">
            <Filter className="w-3 h-3" />
            <span>حالة التجهيز:</span>
          </span>
          <button
            onClick={() => setPrepStatusFilter('all')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
              prepStatusFilter === 'all'
                ? 'bg-cyan-500 text-slate-950 shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            الكل ({allFlattenedVariants.length})
          </button>
          <button
            onClick={() => setPrepStatusFilter('pending')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
              prepStatusFilter === 'pending'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30'
            }`}
          >
            قيد التجهيز ({allFlattenedVariants.length - preparedCount})
          </button>
          <button
            onClick={() => setPrepStatusFilter('completed')}
            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
              prepStatusFilter === 'completed'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
            }`}
          >
            مكتمل ({preparedCount})
          </button>
        </div>
      </div>

      {/* 5. MAIN CONTENT: Cards View OR Master Table View */}
      {viewMode === 'table' ? (
        /* MASTER SIZES AGGREGATION TABLE VIEW */
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden transition-colors">
          <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Table className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                جدول التجميع الشامل للأحجام والمقاسات (كشف المطبخ)
              </h3>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              إجمالي {filteredTableVariants.length} بنود أحجام مجمعة
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold">
                <tr>
                  <th className="py-2.5 px-3 text-center w-10">#</th>
                  <th className="py-2.5 px-3">الصنف</th>
                  <th className="py-2.5 px-3">الحجم / المقاس</th>
                  <th className="py-2.5 px-3 text-center">إجمالي المطلوب للتجهيز</th>
                  <th className="py-2.5 px-3 text-center">الوحدة</th>
                  <th className="py-2.5 px-3 text-center">عدد الطلبات</th>
                  <th className="py-2.5 px-3">ملاحظات التجهيز والتنظيف الواردة</th>
                  <th className="py-2.5 px-3 text-center">تم التجهيز</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredTableVariants.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      لا توجد أصناف مطابقة لمعايير البحث في هذه الدورة
                    </td>
                  </tr>
                ) : (
                  filteredTableVariants.map((item, idx) => {
                    const rowKey = `${item.productId}-${item.variantId}`;
                    const isDone = !!preparedItems[rowKey];
                    const unit = item.pricingUnit === 'kg' ? 'كجم' : 'قطعة';

                    return (
                      <tr
                        key={rowKey}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                          isDone ? 'opacity-60 bg-emerald-500/5' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center font-mono text-slate-400">{idx + 1}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                          <div className="flex items-center gap-1.5">
                            <Fish className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                            <span>{item.productName}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-cyan-700 dark:text-cyan-300">
                          <span className="bg-cyan-50 dark:bg-cyan-950/50 px-2 py-0.5 rounded-md border border-cyan-200 dark:border-cyan-800/60 font-bold">
                            {item.variantTitle}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-black text-cyan-600 dark:text-cyan-400 text-sm">
                          {item.requiredQuantity}
                        </td>
                        <td className="py-2.5 px-3 text-center font-semibold text-slate-600 dark:text-slate-300">
                          {unit}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-slate-700 dark:text-slate-300 font-bold">
                          {item.ordersCount}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                          {item.orders.some((o) => o.notes) ? (
                            <div className="flex flex-col gap-0.5 text-[11px]">
                              {item.orders
                                .filter((o) => o.notes)
                                .map((o, nIdx) => (
                                  <span key={nIdx} className="truncate">
                                    • طلب #{o.orderNumber}: {o.notes}
                                  </span>
                                ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">تنظيف عادي</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => togglePreparedStatus(rowKey)}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                              isDone
                                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-xs'
                                : 'border-slate-300 dark:border-slate-700 hover:border-emerald-500 text-slate-400 hover:text-emerald-500'
                            }`}
                            title={isDone ? 'تم التجهيز' : 'تعليم كجاهز'}
                          >
                            <Check className="w-3.5 h-3.5 font-bold" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* CARDS VIEW WITH EMBEDDED SIZES AGGREGATION ACCORDION */
        <div className="space-y-3.5">
          {filteredPrepItems.length === 0 ? (
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center shadow-xs">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mx-auto mb-3">
                <PackageCheck className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                لا توجد أصناف مطلوبة للتجهيز في هذه الدورة
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                لم تسجل طلبات نشطة بحاجة لتجهيز وتنظيف خلال هذا التوقيت أو مطابقة لمعايير البحث.
              </p>
            </div>
          ) : (
            filteredPrepItems.map((item) => {
              const isExpanded = !!expandedItems[item.productId];
              const isPrepared = !!preparedItems[item.productId];
              const unitLabel = item.pricingUnit === 'kg' ? 'كجم' : 'قطعة';

              return (
                <div
                  key={item.productId}
                  className={`bg-white dark:bg-[#111827] border rounded-2xl transition-all shadow-xs overflow-hidden ${
                    isPrepared
                      ? 'border-emerald-500/50 bg-emerald-50/20 dark:bg-emerald-950/10'
                      : 'border-slate-200 dark:border-slate-800 hover:border-cyan-500/40'
                  }`}
                >
                  {/* Top Summary Bar of Product */}
                  <div className="p-3.5 sm:p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                    {/* Left: Product identification */}
                    <div className="flex items-center gap-3 w-full md:w-auto">
                      <button
                        onClick={() => togglePreparedStatus(item.productId)}
                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center border transition-all shrink-0 cursor-pointer ${
                          isPrepared
                            ? 'bg-emerald-500 border-emerald-400 text-slate-950 shadow-xs'
                            : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-slate-100 dark:bg-slate-800 text-transparent hover:text-slate-400'
                        }`}
                        title={isPrepared ? 'تم التجهيز والوزن' : 'انقر لتعيين كتم التجهيز'}
                      >
                        <Check className="w-4 h-4 font-bold stroke-[3]" />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4
                            className={`text-sm sm:text-base font-black ${
                              isPrepared
                                ? 'line-through text-slate-400'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {item.productName}
                          </h4>
                          {item.categoryName && (
                            <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                              {item.categoryName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-3 mt-1 flex-wrap">
                          <span>مطلوب في {item.ordersCount} طلبات عملاء</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Aggregated requirement box */}
                    <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto pt-2 md:pt-0 border-t border-slate-200 dark:border-slate-800 md:border-t-0">
                      {/* Big Aggregated Requirement Pill */}
                      <div className="bg-cyan-50 dark:bg-slate-900 border border-cyan-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-center min-w-[120px]">
                        <div className="text-[10px] text-cyan-700 dark:text-cyan-400 font-bold">إجمالي المطلوب المجمع</div>
                        <div className="text-base sm:text-lg font-black text-cyan-800 dark:text-cyan-300 font-mono">
                          {item.totalRequired}{' '}
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{unitLabel}</span>
                        </div>
                      </div>

                      {/* Expand / Collapse Button */}
                      <button
                        onClick={() => toggleExpand(item.productId)}
                        className="py-1.5 px-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold flex items-center gap-1 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
                      >
                        <span>التفاصيل ({item.ordersCount})</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* 2. SIZES & VARIANTS AGGREGATION SECTION */}
                  <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Scale className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                        <span>تجميع الطلبات حسب الأحجام والمقاسات:</span>
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        مطلوب كميات محددة لكل حجم على حدة
                      </span>
                    </div>

                    {/* Variant Cards Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {item.variantsBreakdown && item.variantsBreakdown.length > 0 ? (
                        item.variantsBreakdown.map((vb) => {
                          const variantKey = `${item.productId}-${vb.variantId}`;
                          const isVarDone = !!preparedItems[variantKey];

                          return (
                            <div
                              key={vb.variantId}
                              className={`p-2.5 rounded-xl border transition-all ${
                                isVarDone
                                  ? 'bg-emerald-50/30 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800/60'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xs'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-slate-900 dark:text-white">
                                  {vb.variantTitle}
                                </span>
                                <span className="bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 px-2 py-0.5 rounded-md font-mono font-black text-xs">
                                  {vb.requiredQuantity} {unitLabel}
                                </span>
                              </div>

                              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                                <span>من {vb.ordersCount || 1} طلبات عملاء</span>
                                <button
                                  onClick={() => togglePreparedStatus(variantKey)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer transition-colors ${
                                    isVarDone
                                      ? 'bg-emerald-500 text-slate-950'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-emerald-600'
                                  }`}
                                >
                                  <Check className="w-3 h-3" />
                                  <span>{isVarDone ? 'تم التجهيز' : 'تحديد كجاهز'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-800 dark:text-slate-200">الطلب الأساسي (حجم موحد)</span>
                            <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400">
                              {item.totalRequired} {unitLabel}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 3. Expanded Orders Breakdown Accordion */}
                  {isExpanded && (
                    <div className="bg-slate-100/70 dark:bg-slate-950/70 border-t border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 space-y-2">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-1.5">
                        <Utensils className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                        <span>تفاصيل وملاحظات الطلبات الواردة لصنف ({item.productName}):</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {item.orders.map((ord, idx) => (
                          <div
                            key={`${ord.orderId}-${idx}`}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-800 dark:text-slate-200 space-y-1.5 shadow-2xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-cyan-700 dark:text-cyan-400">
                                طلب #{ord.orderNumber}
                              </span>
                              <span className="bg-cyan-50 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-300 px-1.5 py-0.5 rounded font-mono font-bold text-[11px] border border-cyan-200 dark:border-cyan-800/60">
                                {ord.quantity} {unitLabel} {ord.variantTitle ? `(${ord.variantTitle})` : ''}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                                {ord.customerName}
                              </span>
                              <span className="font-mono text-[11px]">{ord.customerPhone}</span>
                            </div>

                            {ord.notes && (
                              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded p-1.5 text-[11px] text-amber-800 dark:text-amber-200">
                                <strong>تجهيز المطبخ:</strong> {ord.notes}
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
                              <span>
                                العربون:{' '}
                                <strong
                                  className={
                                    ord.depositStatus === 'confirmed'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-amber-600 dark:text-amber-400'
                                  }
                                >
                                  {ord.depositStatus === 'confirmed' ? 'مؤكد ومقبوض' : 'قيد التحصيل'}
                                </strong>
                              </span>
                              <span>
                                {new Date(ord.createdAt).toLocaleTimeString('ar-EG', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 6. Quick Manual Intake Modal */}
      {showIntakeModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl animate-scaleIn text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                  <PhoneCall className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">تسجيل طلب وارد فوري</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    يتم إدراجه وتجميعه فوراً ضمن كميات التجهيز والمقاسات المطلوبة
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowIntakeModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleQuickIntakeSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  اسم العميل *
                </label>
                <input
                  type="text"
                  required
                  placeholder="مثال: د. طارق عبد الرازق"
                  value={intakeCustName}
                  onChange={(e) => setIntakeCustName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    رقم الهاتف *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="01012345678"
                    value={intakeCustPhone}
                    onChange={(e) => setIntakeCustPhone(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    العنوان أو الاستلام
                  </label>
                  <input
                    type="text"
                    placeholder="المعادي أو استلام من المحل"
                    value={intakeCustAddress}
                    onChange={(e) => setIntakeCustAddress(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    الصنف المطلوب *
                  </label>
                  <select
                    value={intakeProductId}
                    onChange={(e) => setIntakeProductId(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.price} ج.م / {p.pricingUnit === 'kg' ? 'كجم' : 'ق'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    الحجم أو المقاس المطلوب
                  </label>
                  <input
                    type="text"
                    placeholder="مثال: حجم كبير (3 حبات) أو وسط"
                    value={intakeVariantTitle}
                    onChange={(e) => setIntakeVariantTitle(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    الكمية المطلوبة (كجم / ق) *
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    required
                    value={intakeQuantity}
                    onChange={(e) => setIntakeQuantity(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    مبلغ العربون (ج.م)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={intakeDepositAmount}
                    onChange={(e) => setIntakeDepositAmount(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ملاحظات التجهيز والتنظيف
                </label>
                <textarea
                  rows={2}
                  placeholder="مثال: تنظيف سنجاري وفتح من الظهر، أو تتبيل للشوي"
                  value={intakeNotes}
                  onChange={(e) => setIntakeNotes(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowIntakeModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>تأكيد وتسجيل الطلب وتجميعه</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
