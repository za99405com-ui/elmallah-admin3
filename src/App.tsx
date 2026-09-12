import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { TopNavbar } from './components/layout/TopNavbar';
import { OverviewTab } from './components/dashboard/OverviewTab';
import { OrdersTab } from './components/orders/OrdersTab';
import { CustomersTab } from './components/customers/CustomersTab';
import { ProductsTab } from './components/products/ProductsTab';
import { CouponsTab } from './components/coupons/CouponsTab';
import { CategoriesTab } from './components/categories/CategoriesTab';
import { OrderDemandTab } from './components/demand/OrderDemandTab';
import { SettingsTab } from './components/settings/SettingsTab';
import { LoginScreen } from './components/auth/LoginScreen';
import { ToastContainer } from './components/common/ToastContainer';

const MainDashboardContent: React.FC = () => {
  const { activeTab, isAuthenticated, darkMode } = useApp();

  // If not authenticated, protect the dashboard with email & password screen
  if (!isAuthenticated) {
    return (
      <div className={`relative min-h-screen font-sans selection:bg-cyan-500 selection:text-slate-950 ${darkMode ? 'dark bg-[#070b14] text-slate-100' : 'bg-slate-100 text-slate-900'}`}>
        <LoginScreen />
        <ToastContainer />
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className={`min-h-screen w-full flex flex-col font-sans antialiased selection:bg-cyan-500/30 selection:text-cyan-600 dark:selection:text-cyan-200 ${
        darkMode ? 'bg-[#090e1a] text-slate-100' : 'bg-slate-100/90 text-slate-900'
      }`}
    >
      {/* 1. Unified Compact Top Control Panel (بدون قائمة جانبية - الخيارات مصفوفة فوق جمب بعض) */}
      <TopNavbar />

      {/* 2. Main Scrollable Dashboard Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-2.5 sm:px-4 md:px-6 py-3 sm:py-5">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'orders' && <OrdersTab />}
        {activeTab === 'deposits' && <OrdersTab defaultFilter="deposit_pending" />}
        {activeTab === 'order_demand' && <OrderDemandTab />}
        {activeTab === 'customers' && <CustomersTab />}
        {activeTab === 'products' && <ProductsTab />}
        {activeTab === 'coupons' && <CouponsTab />}
        {activeTab === 'categories' && <CategoriesTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </main>

      {/* 3. Toast Notifications Stack */}
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainDashboardContent />
    </AppProvider>
  );
}
