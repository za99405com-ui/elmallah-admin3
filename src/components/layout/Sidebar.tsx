import React from 'react';
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
  X,
  LogOut,
  ShieldCheck,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    isSidebarOpen,
    setIsSidebarOpen,
    orders,
    products,
    coupons,
    customers,
    supabaseConnected,
    adminUser,
    logout,
  } = useApp();

  const pendingOrdersCount = orders.filter((o) => o.status === 'pending').length;
  const pendingDepositsCount = orders.filter((o) => o.depositStatus === 'pending').length;
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
      label: 'نظرة عامة',
      icon: <LayoutDashboard className="w-5 h-5" />,
    },
    {
      id: 'orders',
      label: 'إدارة الطلبات',
      icon: <ShoppingBag className="w-5 h-5" />,
      badge: pendingOrdersCount > 0 ? pendingOrdersCount : undefined,
      badgeVariant: 'warning',
    },
    {
      id: 'deposits',
      label: 'العربونات والمدفوعات',
      icon: <Banknote className="w-5 h-5" />,
      badge: pendingDepositsCount > 0 ? pendingDepositsCount : undefined,
      badgeVariant: 'danger',
    },
    {
      id: 'order_demand',
      label: 'تجهيز وتجميع الطلبات',
      icon: <PackageCheck className="w-5 h-5" />,
      badge: '3:00 فجراً',
      badgeVariant: 'info',
    },
    {
      id: 'customers',
      label: 'العملاء والمسجلين',
      icon: <Users className="w-5 h-5" />,
      badge: customers.length > 0 ? customers.length : undefined,
      badgeVariant: 'info',
    },
    {
      id: 'products',
      label: 'المنتجات والأسماك',
      icon: <Fish className="w-5 h-5" />,
    },
    {
      id: 'categories',
      label: 'التصنيفات',
      icon: <Layers className="w-5 h-5" />,
    },
    {
      id: 'coupons',
      label: 'الكوبونات والخصومات',
      icon: <TicketPercent className="w-5 h-5" />,
      badge: activeCouponsCount > 0 ? activeCouponsCount : undefined,
      badgeVariant: 'info',
    },
    {
      id: 'settings',
      label: 'الإعدادات والأمان',
      icon: <Settings className="w-5 h-5" />,
    },
  ];

  const handleNavClick = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsSidebarOpen(false);
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed lg:static top-0 right-0 z-40 h-screen w-64 bg-[#0d131f] border-l border-slate-800/90 text-slate-100 flex flex-col transition-transform duration-300 ease-in-out ${
          isSidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="p-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)] shrink-0">
              <Fish className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <span className="text-base font-bold tracking-tight text-white block truncate">
                الملاح للأسماك
              </span>
              <span className="text-[11px] text-slate-400">لوحة الإدارة والمبيعات</span>
            </div>
          </div>

          <button
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-400 font-bold border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={isActive ? 'text-cyan-400' : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>

                {item.badge !== undefined && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      item.badgeVariant === 'warning'
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
                        : item.badgeVariant === 'danger'
                        ? 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
                        : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User Card & Logout */}
        <div className="p-3 border-t border-slate-800/90 space-y-2">
          {/* User Profile Card */}
          <div className="flex items-center justify-between p-2.5 bg-slate-900/90 rounded-2xl border border-slate-800/80">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-bold text-xs shrink-0">
                {adminUser.name.slice(0, 2)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{adminUser.name}</p>
                <p className="text-[10px] text-slate-400 truncate">{adminUser.email}</p>
              </div>
            </div>

            {/* Logout button */}
            <button
              onClick={() => {
                if (confirm('هل تريد تسجيل الخروج من لوحة التحكم؟')) {
                  logout();
                }
              }}
              title="تسجيل الخروج من لوحة الإدارة"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Connection status */}
          <div className="flex items-center justify-between text-[11px] px-2 text-slate-400">
            <span className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  supabaseConnected ? 'bg-emerald-400' : 'bg-cyan-400'
                }`}
              />
              <span className={supabaseConnected ? 'text-emerald-400' : 'text-slate-300'}>
                {supabaseConnected ? 'Supabase متصل' : 'تخزين آمن'}
              </span>
            </span>
            <span className="text-[10px] text-slate-500">نظام محمي</span>
          </div>
        </div>
      </aside>
    </>
  );
};
