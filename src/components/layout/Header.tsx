import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Menu,
  Moon,
  Sun,
  Bell,
  Volume2,
  VolumeX,
  PlusCircle,
  Store,
  Database,
  CheckCircle,
  ExternalLink,
  ShoppingBag,
  LogOut,
  Users,
} from 'lucide-react';

export const Header: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    darkMode,
    toggleDarkMode,
    soundEnabled,
    toggleSound,
    settings,
    toggleStoreStatus,
    setIsSidebarOpen,
    orders,
    customers,
    adminUser,
    realtimeConnected,
    logout,
  } = useApp();

  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close notifications dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const pendingOrders = orders.filter((o) => o.status === 'pending');
  const recentOrders = orders.slice(0, 5);

  const getTabTitle = () => {
    switch (activeTab) {
      case 'overview':
        return 'لوحة الإحصائيات العامة';
      case 'orders':
        return 'إدارة الطلبات والمبيعات';
      case 'customers':
        return 'بيانات العملاء والمسجلين';
      case 'products':
        return 'المنتجات وقائمة الأسماك';
      case 'coupons':
        return 'الكوبونات وقسائم الخصم';
      case 'categories':
        return 'إدارة تصنيفات الأسماك';
      case 'settings':
        return 'الإعدادات وأمان الحساب';
      default:
        return 'لوحة التحكم';
    }
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-20 px-4 sm:px-8 bg-slate-900/60 backdrop-blur-md border-b border-slate-800 text-slate-100 transition-colors">
      {/* Right side: Mobile Menu + Current Page Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="lg:hidden p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800/70 border border-slate-700/50 transition-colors"
          aria-label="فتح القائمة الجانبية"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex flex-col">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {getTabTitle()}
            </h1>
            {activeTab === 'orders' && pendingOrders.length > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {pendingOrders.length} طلب جديد
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 hidden sm:block">
            متجر الملاح للأسماك الطازجة والمأكولات البحرية
          </p>
        </div>
      </div>

      {/* Left side: Controls & User */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Store Status Toggle */}
        <button
          onClick={toggleStoreStatus}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
            settings.isOpen
              ? 'bg-green-500/10 text-green-400 border-green-500/20 shadow-[0_0_12px_rgba(34,197,94,0.15)]'
              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
          }`}
          title={settings.isOpen ? 'المتجر يستقبل الطلبات' : 'المتجر مغلق حالياً'}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              settings.isOpen ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-rose-500'
            }`}
          />
          <span className="hidden sm:inline">{settings.isOpen ? 'المتجر مفتوح' : 'المتجر مغلق'}</span>
        </button>

        {/* Realtime Server Status indicator */}
        <div
          className={`hidden xl:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
            realtimeConnected
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
          }`}
          title="قاعدة بيانات المتجر الموحدة مع بث إشعارات وتحديثات لحظية مباشر"
        >
          <Database className="w-3.5 h-3.5 text-cyan-400" />
          <span>{realtimeConnected ? 'البث اللحظي متصل' : 'قاعدة البيانات متصلة'}</span>
        </div>

        {/* Audio notification toggle */}
        <button
          onClick={toggleSound}
          className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800/70 border border-slate-700/50 hover:bg-slate-800 transition-colors"
          title={soundEnabled ? 'تنبيهات الصوت مفعلة' : 'تنبيهات الصوت صامتة'}
          aria-label="تبديل صوت التنبيهات"
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
        </button>

        {/* Dark/Light mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800/70 border border-slate-700/50 hover:bg-slate-800 transition-colors"
          title={darkMode ? 'التحويل إلى الوضع النهاري' : 'التحويل إلى الوضع الليلي'}
          aria-label="تبديل الوضع الليلي والنهاري"
        >
          {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-400" />}
        </button>

        {/* Notifications Popover */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setShowNotifications((prev) => !prev)}
            className="relative p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800/70 border border-slate-700/50 hover:bg-slate-800 transition-colors"
            title="الإشعارات والطلبات الجديدة"
            aria-label="عرض الإشعارات"
          >
            <Bell className="w-4 h-4" />
            {pendingOrders.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-slate-900 animate-pulse" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute left-0 sm:right-auto sm:left-0 mt-2 w-80 sm:w-96 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-slate-800 shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-bold text-white">أحدث إشعارات الطلبات</h3>
                </div>
                <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full font-semibold">
                  {pendingOrders.length} قيد الانتظار
                </span>
              </div>

              <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto mt-2">
                {recentOrders.map((order) => (
                  <div
                    key={order.id}
                    onClick={() => {
                      setActiveTab('orders');
                      setShowNotifications(false);
                    }}
                    className="py-2.5 px-2 hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">
                        طلب #{order.orderNumber}
                      </span>
                      <span
                        className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                          order.status === 'pending'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : order.status === 'preparing'
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            : 'bg-green-500/10 text-green-400 border border-green-500/20'
                        }`}
                      >
                        {order.status === 'pending'
                          ? 'بانتظار المراجعة'
                          : order.status === 'preparing'
                          ? 'جاري التحضير'
                          : 'مكتمل'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                      <span>{order.customerName}</span>
                      <span className="font-semibold text-slate-200">{order.totalAmount} ج.م</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 mt-2 border-t border-slate-800 flex justify-between items-center">
                <button
                  onClick={() => {
                    setActiveTab('orders');
                    setShowNotifications(false);
                  }}
                  className="w-full text-center text-xs text-cyan-400 hover:underline font-bold flex items-center justify-center gap-1 py-1"
                >
                  <span>عرض كل الطلبات ({orders.length})</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-6 w-[1px] bg-slate-800" />

        {/* Admin Profile Pill */}
        <div className="flex items-center gap-2.5 pl-1 p-1 rounded-2xl bg-slate-800/40 border border-slate-800/60">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 p-0.5 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
            <img
              src={adminUser.avatarUrl}
              alt={adminUser.name}
              className="w-full h-full rounded-full object-cover"
            />
          </div>
          <div className="hidden lg:flex flex-col text-right pl-2">
            <span className="text-xs font-bold text-white leading-tight">
              {adminUser.name}
            </span>
            <span className="text-[10px] text-cyan-400 font-medium">
              مدير المتجر
            </span>
          </div>
        </div>

        {/* Logout button */}
        <button
          onClick={() => {
            if (confirm('هل تريد تسجيل الخروج من لوحة التحكم؟')) {
              logout();
            }
          }}
          className="p-2 rounded-xl text-slate-400 hover:text-rose-400 bg-slate-800/70 hover:bg-rose-500/10 border border-slate-700/50 transition-colors"
          title="تسجيل الخروج"
          aria-label="تسجيل الخروج"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
