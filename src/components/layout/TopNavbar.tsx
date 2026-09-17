import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { ActiveTab } from '../../types';
import {
  LayoutDashboard,
  ShoppingBag,
  Banknote,
  PackageCheck,
  Users,
  Fish,
  TicketPercent,
  Layers,
  Settings,
  Bell,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Smartphone,
  Zap,
  LogOut,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Store,
  CreditCard,
} from 'lucide-react';

export const TopNavbar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    darkMode,
    toggleDarkMode,
    soundEnabled,
    toggleSound,
    phoneNotificationsEnabled,
    togglePhoneNotifications,
    sendPhoneNotification,
    orders,
    customers,
    products,
    coupons,
    settings,
    toggleStoreStatus,
    adminUser,
    logout,
  } = useApp();

  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const pendingOrders = orders.filter((o) => o.status === 'pending');
  const pendingDeposits = orders.filter((o) => o.depositStatus === 'pending');
  const activeCouponsCount = coupons.filter((c) => c.isActive).length;

  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
    badgeVariant?: 'warning' | 'danger' | 'info' | 'success';
  }[] = [
    {
      id: 'overview',
      label: 'الرئيسية',
      icon: <LayoutDashboard className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
    },
    {
      id: 'orders',
      label: 'الطلبات',
      icon: <ShoppingBag className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
      badge: pendingOrders.length > 0 ? pendingOrders.length : undefined,
      badgeVariant: 'warning',
    },
    {
      id: 'payments',
      label: 'المدفوعات والمراجعة',
      icon: <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
      badge: pendingDeposits.length > 0 ? pendingDeposits.length : undefined,
      badgeVariant: 'danger',
    },
    {
      id: 'order_demand',
      label: 'تجهيز وتجميع الطلبات',
      icon: <PackageCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
      badge: '3:00 فجراً',
      badgeVariant: 'info',
    },
    {
      id: 'customers',
      label: 'العملاء',
      icon: <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
      badge: customers.length > 0 ? customers.length : undefined,
      badgeVariant: 'info',
    },
    {
      id: 'products',
      label: 'المنتجات',
      icon: <Fish className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
    },
    {
      id: 'categories',
      label: 'التصنيفات',
      icon: <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
    },
    {
      id: 'coupons',
      label: 'الكوبونات',
      icon: <TicketPercent className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
      badge: activeCouponsCount > 0 ? activeCouponsCount : undefined,
      badgeVariant: 'info',
    },
    {
      id: 'settings',
      label: 'الإعدادات',
      icon: <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />,
    },
  ];

  return (
    <header
      dir="rtl"
      className={`sticky top-0 z-40 w-full border-b transition-colors duration-200 backdrop-blur-md shadow-xs ${
        darkMode
          ? 'bg-[#0b101d]/95 border-slate-800/80 text-slate-100'
          : 'bg-white/95 border-slate-200 text-slate-800'
      }`}
    >
      {/* 1. Top Compact Header Bar */}
      <div className="max-w-7xl mx-auto px-2.5 sm:px-4 py-2 flex items-center justify-between gap-2">
        {/* Brand & Store Status */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div
            onClick={() => setActiveTab('overview')}
            className="flex items-center gap-2 cursor-pointer select-none group"
            title="الرئيسية"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-cyan-500 flex items-center justify-center text-slate-950 font-black shadow-[0_0_12px_rgba(6,182,212,0.3)] shrink-0 transition-transform group-hover:scale-105">
              <Fish className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs sm:text-sm font-black tracking-tight leading-none text-cyan-500 dark:text-cyan-400">
                أسماك الملاح
              </span>
              <span className="text-[10px] sm:text-[11px] font-medium text-slate-400 leading-tight">
                لوحة الإدارة
              </span>
            </div>
          </div>

          {/* Store status compact pill button */}
          <button
            onClick={toggleStoreStatus}
            title={settings.isOpen ? 'المتجر مفتوح ويستقبل الطلبات' : 'المتجر مغلق حالياً'}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border transition-colors ${
              settings.isOpen
                ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                settings.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span className="text-[10px] sm:text-xs">
              {settings.isOpen ? 'مفتوح' : 'مغلق'}
            </span>
          </button>
        </div>

        {/* Action Controls & Fast Buttons */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Phone Notifications Button with status indicator */}
          <button
            onClick={togglePhoneNotifications}
            title={
              phoneNotificationsEnabled
                ? 'إشعارات الهاتف واهتزاز الجهاز مفعلة (انقر للتعطيل)'
                : 'تفعيل إشعارات واهتزاز الهاتف لتصلك تنبيهات الطلبات والعربون فوراً'
            }
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
              phoneNotificationsEnabled
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 shadow-xs'
                : darkMode
                ? 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'
                : 'bg-slate-100 text-slate-700 border-slate-300 hover:border-slate-400'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {phoneNotificationsEnabled ? 'إشعارات الهاتف نشطة' : 'تفعيل الهاتف'}
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                phoneNotificationsEnabled ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
          </button>

          {/* Sound Toggle */}
          <button
            onClick={toggleSound}
            title={soundEnabled ? 'صوت التنبيهات يعمل' : 'صوت التنبيهات مكتوم'}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              soundEnabled
                ? darkMode
                  ? 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10'
                  : 'text-cyan-700 border-cyan-300 bg-cyan-50'
                : darkMode
                ? 'text-slate-400 border-slate-800 bg-slate-900'
                : 'text-slate-600 border-slate-300 bg-slate-100 hover:bg-slate-200'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Dark / Light Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            title={darkMode ? 'التحويل إلى الوضع النهاري (Light Mode)' : 'التحويل إلى الوضع الليلي (Dark Mode)'}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              darkMode
                ? 'text-amber-400 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20'
                : 'text-indigo-600 border-indigo-200 bg-indigo-50 hover:bg-indigo-100'
            }`}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Notifications Popover */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              title="تنبيهات الطلبات والعربونات"
              className={`relative p-1.5 rounded-lg border transition-colors cursor-pointer ${
                pendingOrders.length > 0
                  ? darkMode
                    ? 'text-rose-400 border-rose-500/30 bg-rose-500/10'
                    : 'text-rose-600 border-rose-300 bg-rose-50'
                  : darkMode
                  ? 'text-slate-400 border-slate-800 bg-slate-900 hover:text-slate-200'
                  : 'text-slate-600 border-slate-200 bg-slate-100 hover:text-slate-800'
              }`}
            >
              <Bell className="w-4 h-4" />
              {pendingOrders.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center shadow-xs animate-pulse">
                  {pendingOrders.length}
                </span>
              )}
            </button>

            {/* Notifications Dropdown */}
            {showNotifications && (
              <div
                className={`absolute left-0 mt-2 w-72 sm:w-80 rounded-2xl shadow-xl border p-3 z-50 transition-all ${
                  darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                  <span className="text-xs font-bold">التنبيهات والطلبات الحديثة</span>
                  <span className="text-[10px] text-cyan-500 font-semibold">
                    {pendingOrders.length} بانتظار التجهيز
                  </span>
                </div>

                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 my-1">
                  {orders.slice(0, 5).map((ord) => (
                    <div
                      key={ord.id}
                      onClick={() => {
                        setActiveTab('orders');
                        setShowNotifications(false);
                      }}
                      className="py-2 px-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold">{ord.customerName}</span>
                        <span className="text-cyan-500 font-bold">{ord.totalAmount} ج.م</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-0.5">
                        <span>طلب #{ord.orderNumber}</span>
                        {ord.depositStatus === 'pending' ? (
                          <span className="text-amber-500 font-bold">بانتظار العربون ({ord.depositAmount} ج.م)</span>
                        ) : ord.depositStatus === 'confirmed' ? (
                          <span className="text-emerald-500">عربون مؤكد</span>
                        ) : (
                          <span>{ord.status}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    onClick={() => {
                      setActiveTab('orders');
                      setShowNotifications(false);
                    }}
                    className="w-full text-center text-xs font-bold text-cyan-500 hover:text-cyan-400 py-1"
                  >
                    عرض كل الطلبات
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User Profile / Logout Dropdown */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-1.5 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-500 dark:text-cyan-300 font-black text-xs flex items-center justify-center">
                {adminUser.name.slice(0, 1)}
              </div>
              <span className="text-xs font-bold hidden sm:inline truncate max-w-20">
                {adminUser.name.split(' ')[0]}
              </span>
            </button>

            {showUserMenu && (
              <div
                className={`absolute left-0 mt-2 w-48 rounded-xl shadow-xl border p-2 z-50 ${
                  darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                <div className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-800 mb-1">
                  <p className="text-xs font-bold truncate">{adminUser.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{adminUser.email}</p>
                </div>
                <button
                  onClick={() => {
                    setActiveTab('settings');
                    setShowUserMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-right"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>إعدادات الحساب</span>
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-bold rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-right mt-1 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>تسجيل الخروج</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. Compact Horizontal Segmented Navigation Bar (الخيارات جمب بعض فوق) */}
      <div
        className={`border-t transition-colors ${
          darkMode ? 'border-slate-800/70 bg-[#090e1a]/80' : 'border-slate-200/80 bg-slate-50/90'
        }`}
      >
        <div className="max-w-7xl mx-auto px-2 sm:px-4">
          <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto py-1.5 scrollbar-none">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-150 shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950 shadow-xs font-black'
                      : darkMode
                      ? 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>

                  {item.badge !== undefined && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-black leading-none ${
                        isActive
                          ? 'bg-slate-950 text-cyan-400'
                          : item.badgeVariant === 'danger'
                          ? 'bg-rose-500/20 text-rose-500 dark:text-rose-400'
                          : item.badgeVariant === 'warning'
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          : 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
};
