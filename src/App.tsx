import React, { useState, useEffect } from 'react';
import { CreditCard } from 'lucide-react';
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
import { PaymentReviewTab } from './components/payments/PaymentReviewTab';
import { LoginScreen } from './components/auth/LoginScreen';
import { ResetPasswordScreen } from './components/auth/ResetPasswordScreen';
import { ToastContainer } from './components/common/ToastContainer';

const MainDashboardContent: React.FC = () => {
  const { activeTab, isAuthenticated, darkMode } = useApp();

  // Client-side route detection for /reset-password
  const [isResetPasswordRoute, setIsResetPasswordRoute] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return (
        window.location.pathname.startsWith('/reset-password') ||
        window.location.hash.includes('type=recovery') ||
        window.location.hash.includes('access_token=')
      );
    }
    return false;
  });

  useEffect(() => {
    const handlePopState = () => {
      const isRecovery =
        window.location.pathname.startsWith('/reset-password') ||
        window.location.hash.includes('type=recovery') ||
        window.location.hash.includes('access_token=');
      setIsResetPasswordRoute(isRecovery);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // If user navigated to /reset-password route or clicked recovery email link
  if (isResetPasswordRoute) {
    return (
      <div
        className={`relative min-h-screen font-sans selection:bg-cyan-500 selection:text-slate-950 ${
          darkMode ? 'dark bg-[#070b14] text-slate-100' : 'bg-slate-100 text-slate-900'
        }`}
      >
        <ResetPasswordScreen
          onNavigateToLogin={() => {
            window.history.replaceState(null, '', '/');
            setIsResetPasswordRoute(false);
          }}
        />
        <ToastContainer />
      </div>
    );
  }

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
      {/* 1. Unified Compact Top Control Panel */}
      <TopNavbar />

      {/* 2. Main Scrollable Dashboard Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-2.5 sm:px-4 md:px-6 py-3 sm:py-5">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'orders' && <OrdersTab />}
        {activeTab === 'payments' && <PaymentReviewTab />}
        {activeTab === 'deposits' && <PaymentReviewTab initialTab="problems" />}
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
