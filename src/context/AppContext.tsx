import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import {
  ActiveTab,
  Category,
  Product,
  Order,
  OrderStatus,
  DepositStatus,
  DepositMethod,
  Coupon,
  StoreSettings,
  AdminUser,
  ToastMessage,
  Customer,
  AuthCredentials,
  DeliveryRegion,
} from '../types';
import { api, getStoredToken, setStoredToken, removeStoredToken } from '../lib/api';
import {
  getSupabaseClient,
  signOutFromSupabase,
  getSupabaseSession,
} from '../lib/supabase';

interface AppContextType {
  // Authentication & Security
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  login: (email: string, pass: string) => Promise<boolean>;
  logout: () => void;
  authCredentials: AuthCredentials;
  updateCredentials: (
    currentPassword: string,
    newEmail: string,
    newPassword?: string
  ) => Promise<{ success: boolean; message: string }>;

  // Theme & Layout
  darkMode: boolean;
  toggleDarkMode: () => void;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;

  // Sound & Phone Notifications
  soundEnabled: boolean;
  toggleSound: () => void;
  phoneNotificationsEnabled: boolean;
  notificationPermission: NotificationPermission;
  requestPhoneNotificationPermission: () => Promise<boolean>;
  togglePhoneNotifications: () => Promise<void>;
  sendPhoneNotification: (title: string, body: string, tag?: string) => void;

  // Realtime Status
  realtimeConnected: boolean;

  // Admin User & Profile
  adminUser: AdminUser;
  updateAdminProfile: (updates: Partial<AdminUser>) => void;

  // Customers & Registered Users
  customers: Customer[];
  addCustomer: (
    customer: Omit<Customer, 'id' | 'registeredAt' | 'totalOrders' | 'totalSpent'>
  ) => Promise<void>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  toggleCustomerStatus: (id: string) => Promise<void>;

  // Delivery Regions
  deliveryRegions: DeliveryRegion[];
  isLoadingDeliveryRegions: boolean;
  addDeliveryRegion: (region: Omit<DeliveryRegion, 'id' | 'createdAt'>) => Promise<void>;
  updateDeliveryRegion: (id: string, updates: Partial<DeliveryRegion>) => Promise<void>;
  deleteDeliveryRegion: (id: string) => Promise<void>;

  // Products
  products: Product[];
  isLoadingProducts: boolean;
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<void>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;

  // Orders
  orders: Order[];
  isLoadingOrders: boolean;
  addOrder: (order: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateOrderStatus: (orderId: string, newStatus: OrderStatus) => Promise<Order | null>;
  confirmDeposit: (
    orderId: string,
    details?: {
      depositAmount?: number;
      depositMethod?: DepositMethod;
      depositReference?: string;
      depositNotes?: string;
      depositStatus?: DepositStatus;
    }
  ) => Promise<Order | null>;
  updateOrder: (orderId: string, updates: Partial<Order>) => Promise<Order | null>;
  deleteOrder: (orderId: string) => Promise<void>;

  // Coupons
  coupons: Coupon[];
  addCoupon: (coupon: Omit<Coupon, 'id' | 'usedCount' | 'createdAt'>) => Promise<void>;
  updateCoupon: (id: string, updates: Partial<Coupon>) => Promise<void>;
  deleteCoupon: (id: string) => Promise<void>;
  toggleCouponActive: (id: string) => Promise<void>;

  // Categories
  categories: Category[];
  addCategory: (category: Omit<Category, 'id'>) => Promise<void>;
  updateCategory: (id: string, updates: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  // Settings
  settings: StoreSettings;
  updateSettings: (updates: Partial<StoreSettings>) => Promise<void>;
  toggleStoreStatus: () => Promise<void>;

  // Toasts
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id' | 'timestamp'>) => void;
  removeToast: (id: string) => void;

  // Refresh
  refreshData: () => Promise<void>;
}

const defaultSettings: StoreSettings = {
  storeName: 'الملاح لبيع الأسماك',
  tagline: 'صيد البحر الأحمر الطازج يومياً',
  phone: '01015192040',
  whatsapp: '01015192040',
  instapayHandle: 'almallah@instapay',
  instapayNumber: '01015192040',
  vodafoneCash: '01015192040',
  address: 'سوق السمك المركزي - حي المناخ - بورسعيد / القاهرة',
  isOpen: true,
  deliveryFee: 15,
  freeDeliveryThreshold: 400,
  minOrderAmount: 100,
  depositPercentage: 20,
  minDepositAmount: 50,
  workingHours: 'يومياً 7:00 ص - 11:00 م (توزيع وإغلاق 3:00 فجراً)',
  cutoffHour: 3,
  currency: 'ج.م',
};

const defaultAdminUser: AdminUser = {
  id: 'admin-zyad',
  name: 'كابتن زياد الملاح (المدير العام)',
  email: 'zyadmotz1@gmail.com',
  role: 'super_admin',
  avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // 1. Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);
  const [adminUser, setAdminUser] = useState<AdminUser>(defaultAdminUser);
  const [authCredentials, setAuthCredentials] = useState<AuthCredentials>({
    email: 'zyadmotz1@gmail.com',
  });

  // 2. Real-time Status
  const [realtimeConnected, setRealtimeConnected] = useState<boolean>(false);

  // 3. Theme & UI State
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('almallah_dark_mode');
      if (saved !== null) return saved === 'true';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('almallah_dark_mode', String(darkMode));
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      try {
        localStorage.setItem('almallah_dark_mode', String(next));
      } catch {}
      return next;
    });
  }, []);
  const [activeTab, setActiveTabState] = useState<ActiveTab>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path.startsWith('/payments-review') || path.startsWith('/payments')) {
        return 'payments';
      }
    }
    return 'overview';
  });

  const setActiveTab = useCallback((tab: ActiveTab) => {
    setActiveTabState(tab);
    if (typeof window !== 'undefined') {
      const targetPath = tab === 'payments' ? '/payments-review' : '/';
      if (window.location.pathname !== targetPath || window.history.state?.tab !== tab) {
        window.history.pushState({ tab }, '', targetPath);
      }
    }
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        if (path.startsWith('/payments-review') || path.startsWith('/payments')) {
          setActiveTabState('payments');
        } else if (event.state && event.state.tab) {
          setActiveTabState(event.state.tab);
        } else {
          setActiveTabState('overview');
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const toggleSound = () => setSoundEnabled((prev) => !prev);

  // 4. Phone Notifications
  const [phoneNotificationsEnabled, setPhoneNotificationsEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('almallah_phone_notifications') === 'true';
    }
    return false;
  });

  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  // 5. Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id' | 'timestamp'>) => {
    const newToast: ToastMessage = {
      ...toast,
      id: 'toast-' + Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
    };
    setToasts((prev) => [newToast, ...prev].slice(0, 6));

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Audio chime
  const playAlertSound = useCallback(() => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch {
      // Ignore
    }
  }, [soundEnabled]);

  const sendPhoneNotification = useCallback(
    (title: string, body: string, tag?: string) => {
      playAlertSound();

      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([200, 100, 200, 100, 300]);
        } catch {
          // Ignore
        }
      }

      if (
        phoneNotificationsEnabled &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(title, {
            body,
            icon: '/favicon.ico',
            tag: tag || 'order-' + Date.now(),
          });
        } catch (e) {
          console.warn('Notification error:', e);
        }
      }
    },
    [phoneNotificationsEnabled, playAlertSound]
  );

  const requestPhoneNotificationPermission = async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      addToast({
        type: 'warning',
        title: 'المتصفح لا يدعم إشعارات النظام المباشرة',
        description: 'يمكنك الاعتماد على التنبيه الصوتي داخل المتصفح',
      });
      return false;
    }

    try {
      const perm = await Notification.requestPermission();
      setNotificationPermission(perm);
      if (perm === 'granted') {
        setPhoneNotificationsEnabled(true);
        localStorage.setItem('almallah_phone_notifications', 'true');
        sendPhoneNotification('🔔 تم تفعيل إشعارات الهاتف بنجاح!', 'ستصلك الآن تنبيهات الطلبات وتأكيد العربون فوراً.');
        addToast({
          type: 'success',
          title: 'تم تفعيل إشعارات الهاتف بنجاح',
          description: 'ستصلك الآن تنبيهات الاهتزاز والإشعارات الفورية عند وصول أي طلب جديد أو عربون.',
        });
        return true;
      } else {
        setPhoneNotificationsEnabled(false);
        localStorage.setItem('almallah_phone_notifications', 'false');
        addToast({
          type: 'warning',
          title: 'تم رفض إذن الإشعارات',
          description: 'يرجى السماح بالإشعارات من إعدادات المتصفح على هاتفك.',
        });
        return false;
      }
    } catch (err) {
      console.error('Error requesting notification permission:', err);
      return false;
    }
  };

  const togglePhoneNotifications = async () => {
    if (!phoneNotificationsEnabled) {
      await requestPhoneNotificationPermission();
    } else {
      setPhoneNotificationsEnabled(false);
      localStorage.setItem('almallah_phone_notifications', 'false');
      addToast({
        type: 'info',
        title: 'تم إيقاف إشعارات الهاتف',
        description: 'لن تتلقى إشعارات على هاتفك حتى تقوم بإعادة تفعيلها.',
      });
    }
  };

  // 6. Data Entities State
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState<boolean>(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState<boolean>(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [deliveryRegions, setDeliveryRegions] = useState<DeliveryRegion[]>([]);
  const [isLoadingDeliveryRegions, setIsLoadingDeliveryRegions] = useState<boolean>(false);
  const [settings, setSettings] = useState<StoreSettings>(defaultSettings);

  // 7. Data Loader Function
  const refreshData = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;

    try {
      setIsLoadingProducts(true);
      setIsLoadingOrders(true);
      setIsLoadingDeliveryRegions(true);

      const [catsRes, prodsRes, ordersRes, custsRes, coupsRes, settingsRes, regionsRes] = await Promise.allSettled([
        api.getCategories(),
        api.getProducts(),
        api.getOrders(),
        api.getCustomers(),
        api.getCoupons(),
        api.getSettings(),
        api.getDeliveryRegions(),
      ]);

      if (catsRes.status === 'fulfilled') setCategories(catsRes.value);
      if (prodsRes.status === 'fulfilled') setProducts(prodsRes.value);
      if (ordersRes.status === 'fulfilled') setOrders(ordersRes.value);
      if (custsRes.status === 'fulfilled') setCustomers(custsRes.value);
      if (coupsRes.status === 'fulfilled') setCoupons(coupsRes.value);
      if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value);
      if (regionsRes.status === 'fulfilled') setDeliveryRegions(regionsRes.value);
    } catch (err) {
      console.error('Error refreshing admin data:', err);
    } finally {
      setIsLoadingProducts(false);
      setIsLoadingOrders(false);
      setIsLoadingDeliveryRegions(false);
    }
  }, []);

  // 8. Session Initialization
  useEffect(() => {
    const isRecoveryMode =
      typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/reset-password') ||
        window.location.hash.includes('type=recovery') ||
        window.location.hash.includes('access_token='));

    // If user is resetting their password via email link, do not authenticate them into the dashboard yet
    if (isRecoveryMode) {
      setIsLoadingAuth(false);
      return;
    }

    const initAuth = async () => {
      try {
        // 1. Check Supabase session first
        const sbSession = await getSupabaseSession();
        if (sbSession?.access_token && sbSession?.user) {
          setStoredToken(sbSession.access_token);
          try {
            // Retrieve strictly validated admin record from backend database
            const meRes = await api.getMe();
            if (meRes?.admin) {
              setAdminUser(meRes.admin);
              setAuthCredentials({ email: meRes.admin.email });
              setIsAuthenticated(true);
              await refreshData();
              setIsLoadingAuth(false);
              return;
            }
          } catch (backendAuthErr) {
            console.warn('Supabase session exists but not authorized in admin database:', backendAuthErr);
            setIsAuthenticated(false);
            removeStoredToken();
            setIsLoadingAuth(false);
            return;
          }
        }

        const token = getStoredToken();
        if (!token) {
          setIsAuthenticated(false);
          setIsLoadingAuth(false);
          return;
        }

        const meRes = await api.getMe();
        if (meRes?.admin) {
          setAdminUser(meRes.admin);
          setAuthCredentials({ email: meRes.admin.email });
          setIsAuthenticated(true);
          await refreshData();
        } else {
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.warn('Stored token was invalid or expired:', err);
        removeStoredToken();
        setIsAuthenticated(false);
      } finally {
        setIsLoadingAuth(false);
      }
    };

    initAuth();

    // Supabase auth state listener
    const sbClient = getSupabaseClient();
    const { data: authListener } = sbClient.auth.onAuthStateChange(async (event, session) => {
      const currentPathIsRecovery =
        typeof window !== 'undefined' &&
        (window.location.pathname.startsWith('/reset-password') ||
          window.location.hash.includes('type=recovery'));

      if (event === 'PASSWORD_RECOVERY' || currentPathIsRecovery) {
        // Password recovery event - handled by ResetPasswordScreen
        return;
      }

      if (event === 'SIGNED_OUT') {
        setIsAuthenticated(false);
        removeStoredToken();
      } else if (event === 'SIGNED_IN' && session) {
        setStoredToken(session.access_token);
        try {
          const meRes = await api.getMe();
          if (meRes?.admin) {
            setAdminUser(meRes.admin);
            setAuthCredentials({ email: meRes.admin.email });
            setIsAuthenticated(true);
            await refreshData();
          } else {
            setIsAuthenticated(false);
          }
        } catch {
          setIsAuthenticated(false);
        }
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [refreshData]);

  // Handle unauthorized event
  useEffect(() => {
    const handleUnauthorized = () => {
      setIsAuthenticated(false);
      addToast({
        type: 'warning',
        title: 'انتهت الجلسة',
        description: 'يرجى تسجيل الدخول مجدداً للمتابعة',
      });
    };
    window.addEventListener('almallah:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('almallah:unauthorized', handleUnauthorized);
  }, [addToast]);

  // 9. Real-Time SSE Stream Listener (Authenticated via Authorization: Bearer header)
  useEffect(() => {
    const token = getStoredToken();
    if (isLoadingAuth || !isAuthenticated || !token) {
      setRealtimeConnected(false);
      return;
    }

    const abortController = new AbortController();
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const dispatchRealtimeEvent = (eventType: string, dataStr: string) => {
      if (eventType === 'connected') {
        setRealtimeConnected(true);
        return;
      }

      if (eventType === 'new_order') {
        try {
          const newOrder = JSON.parse(dataStr) as Order;
          setOrders((prev) => [newOrder, ...prev.filter((o) => o.id !== newOrder.id)]);

          sendPhoneNotification(
            `🐟 طلب جديد وارد! #${newOrder.orderNumber}`,
            `العميل: ${newOrder.customerName} - القيمة: ${newOrder.totalAmount} ج.م (عربون: ${newOrder.depositAmount} ج.م)`
          );

          addToast({
            type: 'success',
            title: `🔔 طلب جديد وارد! #${newOrder.orderNumber}`,
            description: `العميل: ${newOrder.customerName} - القيمة: ${newOrder.totalAmount} ج.م (عربون: ${newOrder.depositAmount} ج.م)`,
          });

          // Refresh products catalog and customer stats
          api.getProducts().then(setProducts).catch(console.error);
          api.getCustomers().then(setCustomers).catch(console.error);
        } catch (err) {
          console.error('Failed to parse new_order event:', err);
        }
        return;
      }

      if (eventType === 'order_status_updated') {
        try {
          const updated = JSON.parse(dataStr) as Order;
          setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
        } catch (err) {
          console.error('Failed to parse order_status_updated event:', err);
        }
        return;
      }

      if (eventType === 'deposit_updated') {
        try {
          const updated = JSON.parse(dataStr) as Order;
          setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
          addToast({
            type: updated.depositStatus === 'confirmed' ? 'success' : 'warning',
            title: `تحديث العربون - الطلب #${updated.orderNumber}`,
            description: `الحالة: ${updated.depositStatus === 'confirmed' ? 'مؤكد ومستلم' : updated.depositStatus}`,
          });
        } catch (err) {
          console.error('Failed to parse deposit_updated event:', err);
        }
        return;
      }

      if (eventType === 'product_created') {
        try {
          const prod = JSON.parse(dataStr) as Product;
          setProducts((prev) => [prod, ...prev.filter((p) => p.id !== prod.id)]);
        } catch (err) {
          console.error('Failed to parse product_created event:', err);
        }
        return;
      }

      if (eventType === 'product_updated') {
        try {
          const prod = JSON.parse(dataStr) as Product;
          setProducts((prev) => prev.map((p) => (p.id === prod.id ? prod : p)));
        } catch (err) {
          console.error('Failed to parse product_updated event:', err);
        }
        return;
      }

      if (eventType === 'product_deleted') {
        try {
          const { id } = JSON.parse(dataStr) as { id: string };
          setProducts((prev) => prev.filter((p) => p.id !== id));
        } catch (err) {
          console.error('Failed to parse product_deleted event:', err);
        }
        return;
      }

      if (eventType === 'order_deleted') {
        try {
          const { id } = JSON.parse(dataStr) as { id: string };
          setOrders((prev) => prev.filter((o) => o.id !== id));
        } catch (err) {
          console.error('Failed to parse order_deleted event:', err);
        }
        return;
      }

      if (eventType === 'customer_created') {
        try {
          const cust = JSON.parse(dataStr) as Customer;
          setCustomers((prev) => [cust, ...prev.filter((c) => c.id !== cust.id)]);
        } catch (err) {
          console.error('Failed to parse customer_created event:', err);
        }
        return;
      }

      if (eventType === 'customer_updated') {
        try {
          const cust = JSON.parse(dataStr) as Customer;
          setCustomers((prev) => prev.map((c) => (c.id === cust.id ? cust : c)));
        } catch (err) {
          console.error('Failed to parse customer_updated event:', err);
        }
        return;
      }

      if (eventType === 'customer_deleted') {
        try {
          const { id } = JSON.parse(dataStr) as { id: string };
          setCustomers((prev) => prev.filter((c) => c.id !== id));
        } catch (err) {
          console.error('Failed to parse customer_deleted event:', err);
        }
        return;
      }

      if (eventType === 'category_created') {
        try {
          const cat = JSON.parse(dataStr) as Category;
          setCategories((prev) => [cat, ...prev.filter((c) => c.id !== cat.id)]);
        } catch (err) {
          console.error('Failed to parse category_created event:', err);
        }
        return;
      }

      if (eventType === 'category_updated') {
        try {
          const cat = JSON.parse(dataStr) as Category;
          setCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)));
        } catch (err) {
          console.error('Failed to parse category_updated event:', err);
        }
        return;
      }

      if (eventType === 'category_deleted') {
        try {
          const { id } = JSON.parse(dataStr) as { id: string };
          setCategories((prev) => prev.filter((c) => c.id !== id));
        } catch (err) {
          console.error('Failed to parse category_deleted event:', err);
        }
        return;
      }

      if (eventType === 'coupon_created') {
        try {
          const coup = JSON.parse(dataStr) as Coupon;
          setCoupons((prev) => [coup, ...prev.filter((c) => c.id !== coup.id)]);
        } catch (err) {
          console.error('Failed to parse coupon_created event:', err);
        }
        return;
      }

      if (eventType === 'coupon_updated') {
        try {
          const coup = JSON.parse(dataStr) as Coupon;
          setCoupons((prev) => prev.map((c) => (c.id === coup.id ? coup : c)));
        } catch (err) {
          console.error('Failed to parse coupon_updated event:', err);
        }
        return;
      }

      if (eventType === 'coupon_deleted') {
        try {
          const { id } = JSON.parse(dataStr) as { id: string };
          setCoupons((prev) => prev.filter((c) => c.id !== id));
        } catch (err) {
          console.error('Failed to parse coupon_deleted event:', err);
        }
        return;
      }

      if (eventType === 'delivery_region_created') {
        try {
          const reg = JSON.parse(dataStr) as DeliveryRegion;
          setDeliveryRegions((prev) => [reg, ...prev.filter((r) => r.id !== reg.id)]);
        } catch (err) {
          console.error('Failed to parse delivery_region_created event:', err);
        }
        return;
      }

      if (eventType === 'delivery_region_updated') {
        try {
          const reg = JSON.parse(dataStr) as DeliveryRegion;
          setDeliveryRegions((prev) => prev.map((r) => (r.id === reg.id ? reg : r)));
        } catch (err) {
          console.error('Failed to parse delivery_region_updated event:', err);
        }
        return;
      }

      if (eventType === 'delivery_region_deleted') {
        try {
          const { id } = JSON.parse(dataStr) as { id: string };
          setDeliveryRegions((prev) => prev.filter((r) => r.id !== id));
        } catch (err) {
          console.error('Failed to parse delivery_region_deleted event:', err);
        }
        return;
      }

      if (eventType === 'store_settings_updated') {
        try {
          const updatedSettings = JSON.parse(dataStr) as StoreSettings;
          setSettings(updatedSettings);
        } catch (err) {
          console.error('Failed to parse store_settings_updated event:', err);
        }
        return;
      }
    };

    const connectSSE = async () => {
      if (abortController.signal.aborted) return;

      let shouldReconnect = true;

      try {
        const url = `/api/admin/realtime?token=${encodeURIComponent(token)}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: abortController.signal,
        });

        if (response.status === 401 || response.status === 403) {
          shouldReconnect = false;
          setRealtimeConnected(false);
          return;
        }

        if (!response.ok || !response.body) {
          setRealtimeConnected(false);
          return;
        }

        const reader = response.body.getReader();
        activeReader = reader;
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          while (true) {
            let boundaryIndex = -1;
            let delimiterLength = 2;

            const idxDoubleNewline = buffer.indexOf('\n\n');
            const idxCRLFDouble = buffer.indexOf('\r\n\r\n');

            if (idxDoubleNewline !== -1 && (idxCRLFDouble === -1 || idxDoubleNewline <= idxCRLFDouble)) {
              boundaryIndex = idxDoubleNewline;
              delimiterLength = 2;
            } else if (idxCRLFDouble !== -1) {
              boundaryIndex = idxCRLFDouble;
              delimiterLength = 4;
            }

            if (boundaryIndex === -1) break;

            const rawMessage = buffer.slice(0, boundaryIndex);
            buffer = buffer.slice(boundaryIndex + delimiterLength);

            if (!rawMessage.trim()) continue;

            const lines = rawMessage.split(/\r?\n/);
            let eventType = 'message';
            const dataParts: string[] = [];

            for (const line of lines) {
              if (line.startsWith(':')) {
                // Heartbeat ping or comment
                continue;
              }
              if (line.startsWith('event:')) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataParts.push(line.slice(5).trimStart());
              }
            }

            const eventData = dataParts.join('\n');
            dispatchRealtimeEvent(eventType, eventData);
          }
        }
      } catch (err: unknown) {
        const error = err as Error;
        if (
          error?.name === 'AbortError' ||
          abortController.signal.aborted ||
          error?.message?.includes('aborted')
        ) {
          shouldReconnect = false;
          return;
        }
        // Gracefully reconnect on transient network drops
      } finally {
        activeReader = null;
        setRealtimeConnected(false);
        if (shouldReconnect && !abortController.signal.aborted) {
          retryTimeoutId = setTimeout(connectSSE, 3000);
        }
      }
    };

    connectSSE();

    return () => {
      abortController.abort();
      if (activeReader) {
        activeReader.cancel().catch(() => {});
        activeReader = null;
      }
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
      }
      setRealtimeConnected(false);
    };
  }, [isAuthenticated, isLoadingAuth, addToast, sendPhoneNotification]);

  // 10. Authentication Handlers
  const login = async (email: string, pass: string): Promise<boolean> => {
    try {
      const normalizedEmail = (email || '').toLowerCase().trim();
      if (!normalizedEmail || typeof pass !== 'string' || pass.length === 0) {
        addToast({
          type: 'error',
          title: 'خطأ في تسجيل الدخول',
          description: 'يرجى إدخال البريد الإلكتروني وكلمة المرور',
        });
        return false;
      }

      // Normal admin dashboard login uses ONLY the backend api.login(email, pass) path.
      // The backend /api/admin/auth/login is the single authentication authority.
      const res = await api.login(normalizedEmail, pass);
      if (res?.token && res?.admin) {
        setStoredToken(res.token);
        setAdminUser(res.admin);
        setAuthCredentials({ email: res.admin.email });
        setIsAuthenticated(true);
        addToast({
          type: 'success',
          title: `مرحباً بك يا ${res.admin.name}!`,
          description: 'تم تسجيل الدخول بنجاح عبر خادم الإدارة',
        });
        await refreshData();
        return true;
      }

      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'بيانات الدخول غير صحيحة';
      addToast({
        type: 'error',
        title: 'خطأ في تسجيل الدخول',
        description: msg,
      });
      return false;
    }
  };

  const logout = () => {
    signOutFromSupabase().catch(() => {});
    api.logout();
    setIsAuthenticated(false);
    addToast({
      type: 'info',
      title: 'تم تسجيل الخروج',
      description: 'تم تسجيل الخروج وقفل لوحة التحكم الإدارية بأمان',
    });
  };

  const updateCredentials = async (
    currentPassword: string,
    newEmail: string,
    newPassword?: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
      if (newPassword) {
        await api.changePassword(currentPassword, newPassword);
      }
      setAuthCredentials((prev) => ({ ...prev, email: newEmail }));
      setAdminUser((prev) => ({ ...prev, email: newEmail }));
      addToast({
        type: 'success',
        title: 'تم تحديث بيانات الدخول',
        description: 'تم تغيير كلمة المرور وتأمين الحساب في قاعدة البيانات',
      });
      return { success: true, message: 'تم تحديث بيانات الحساب بنجاح' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل تحديث البيانات';
      addToast({
        type: 'error',
        title: 'خطأ في التحديث',
        description: msg,
      });
      return { success: false, message: msg };
    }
  };

  const updateAdminProfile = (updates: Partial<AdminUser>) => {
    setAdminUser((prev) => ({ ...prev, ...updates }));
    addToast({
      type: 'success',
      title: 'تم تحديث الملف الشخصي',
      description: 'تم حفظ بيانات المشرف بنجاح',
    });
  };

  // 11. Product Actions
  const addProduct = async (productData: Omit<Product, 'id' | 'createdAt'>) => {
    try {
      const created = await api.createProduct(productData);
      setProducts((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      addToast({
        type: 'success',
        title: 'تمت إضافة المنتج بنجاح',
        description: `أضيف الصنف: ${created.name} (${created.variants?.length || 0} أحجام/خيارات)`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في إضافة المنتج',
        description: err instanceof Error ? err.message : 'تعذر حفظ المنتج في الخادم',
      });
      throw err;
    }
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    try {
      const updated = await api.updateProduct(id, updates);
      setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
      addToast({
        type: 'info',
        title: 'تم تحديث بيانات الصنف',
        description: 'تم حفظ تعديلات المنتج في قاعدة البيانات بنجاح',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في تعديل المنتج',
        description: err instanceof Error ? err.message : 'تعذر تعديل المنتج',
      });
      throw err;
    }
  };

  const deleteProduct = async (id: string) => {
    try {
      await api.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      addToast({
        type: 'warning',
        title: 'تم حذف المنتج',
        description: 'تم حذف الصنف وجميع خياراته من قاعدة البيانات',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في حذف المنتج',
        description: err instanceof Error ? err.message : 'تعذر الحذف',
      });
    }
  };

  // 12. Order Actions
  const addOrder = async (orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'>) => {
    try {
      const created = await api.createManualOrder(orderData);
      setOrders((prev) => [created, ...prev.filter((o) => o.id !== created.id)]);
      addToast({
        type: 'success',
        title: 'تم تسجيل الطلب بنجاح',
        description: `تم حفظ الطلب #${created.orderNumber} للعميل ${created.customerName}`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في حفظ الطلب',
        description: err instanceof Error ? err.message : 'تعذر الحفظ',
      });
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const updated = await api.updateOrderStatus(orderId, newStatus);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      addToast({
        type: 'info',
        title: 'تم تحديث حالة الطلب',
        description: `الطلب #${updated.orderNumber} أصبح بحالة: ${newStatus}`,
      });
      return updated;
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في تحديث الحالة',
        description: err instanceof Error ? err.message : 'فشل التحديث',
      });
      return null;
    }
  };

  const confirmDeposit = async (
    orderId: string,
    details?: {
      depositAmount?: number;
      depositMethod?: DepositMethod;
      depositReference?: string;
      depositNotes?: string;
      depositStatus?: DepositStatus;
    }
  ) => {
    try {
      const updated = await api.updateOrderDeposit(orderId, {
        depositStatus: details?.depositStatus || 'confirmed',
        depositAmount: details?.depositAmount,
        depositMethod: details?.depositMethod,
        depositReference: details?.depositReference,
        depositNotes: details?.depositNotes,
      });

      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      addToast({
        type: 'success',
        title: 'تم تحديث الدفع بنجاح',
        description: `الطلب #${updated.orderNumber} - حالة الدفع: ${updated.depositStatus}`,
      });
      return updated;
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في تحديث الدفع',
        description: err instanceof Error ? err.message : 'فشل التحديث',
      });
      return null;
    }
  };

  const updateOrder = async (orderId: string, updates: Partial<Order>): Promise<Order | null> => {
    const hasStatusUpdate = Boolean(updates.status);
    const hasPaymentUpdate =
      Boolean(updates.depositStatus) ||
      updates.depositAmount !== undefined ||
      updates.depositMethod !== undefined ||
      updates.depositReference !== undefined ||
      updates.depositNotes !== undefined;

    if (hasStatusUpdate && hasPaymentUpdate) {
      addToast({
        type: 'error',
        title: 'تحديث غير صالح',
        description: 'حالة تنفيذ الطلب وحالة الدفع يجب تحديثهما كعمليتين منفصلتين وواضحتين.',
      });
      return null;
    }

    if (updates.status) {
      return updateOrderStatus(orderId, updates.status);
    }

    if (hasPaymentUpdate) {
      return confirmDeposit(orderId, {
        depositStatus: updates.depositStatus,
        depositAmount: updates.depositAmount,
        depositMethod: updates.depositMethod,
        depositReference: updates.depositReference,
        depositNotes: updates.depositNotes,
      });
    }

    return null;
  };

  const deleteOrder = async (orderId: string) => {
    try {
      await api.deleteOrder(orderId);
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      addToast({
        type: 'warning',
        title: 'تم حذف الطلب',
        description: 'تم حذف الطلب نهائياً من قاعدة البيانات',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في حذف الطلب',
        description: err instanceof Error ? err.message : 'تعذر حذف الطلب',
      });
    }
  };

  // 13. Coupon Actions
  const addCoupon = async (couponData: Omit<Coupon, 'id' | 'usedCount' | 'createdAt'>) => {
    try {
      const created = await api.createCoupon(couponData);
      setCoupons((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
      addToast({
        type: 'success',
        title: 'تم إنشاء الكوبون بنجاح',
        description: `كود الخصم: ${created.code}`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في إنشاء الكوبون',
        description: err instanceof Error ? err.message : 'تعذر حفظ الكوبون',
      });
    }
  };

  const updateCoupon = async (id: string, updates: Partial<Coupon>) => {
    try {
      const updated = await api.updateCoupon(id, updates);
      setCoupons((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      addToast({
        type: 'success',
        title: 'تم حفظ الكوبون',
        description: `تم تحديث الكوبون ${updated.code} في قاعدة البيانات`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في تحديث الكوبون',
        description: err instanceof Error ? err.message : 'فشل التحديث',
      });
    }
  };

  const deleteCoupon = async (id: string) => {
    try {
      await api.deleteCoupon(id);
      setCoupons((prev) => prev.filter((c) => c.id !== id));
      addToast({
        type: 'warning',
        title: 'تم حذف الكوبون',
        description: 'تم حذف الكوبون من قاعدة البيانات',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في حذف الكوبون',
        description: err instanceof Error ? err.message : 'تعذر الحذف',
      });
    }
  };

  const toggleCouponActive = async (id: string) => {
    const c = coupons.find((item) => item.id === id);
    if (!c) return;
    await updateCoupon(id, { isActive: !c.isActive });
  };

  // 14. Category Actions
  const addCategory = async (catData: Omit<Category, 'id'>) => {
    try {
      const created = await api.createCategory(catData);
      setCategories((prev) => [...prev, created]);
      addToast({
        type: 'success',
        title: 'تمت إضافة التصنيف',
        description: `تصنيف جديد: ${created.name}`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في إضافة التصنيف',
        description: err instanceof Error ? err.message : 'تعذر الحفظ',
      });
    }
  };

  const updateCategory = async (id: string, updates: Partial<Category>) => {
    try {
      const updated = await api.updateCategory(id, updates);
      setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      addToast({
        type: 'success',
        title: 'تم تحديث التصنيف',
        description: `تم حفظ تعديلات التصنيف ${updated.name}`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في تحديث التصنيف',
        description: err instanceof Error ? err.message : 'تعذر التحديث',
      });
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      await api.deleteCategory(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      addToast({
        type: 'warning',
        title: 'تم حذف التصنيف',
        description: 'تم إزالة التصنيف وفصل منتجاته بنجاح',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في حذف التصنيف',
        description: err instanceof Error ? err.message : 'تعذر الحذف',
      });
    }
  };

  // 15. Customer Actions
  const addCustomer = async (newCust: Omit<Customer, 'id' | 'registeredAt' | 'totalOrders' | 'totalSpent'>) => {
    try {
      const created = await api.createCustomer(newCust);
      setCustomers((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
      addToast({
        type: 'success',
        title: 'تم تسجيل العميل بنجاح',
        description: `تم حفظ العميل: ${created.name}`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في تسجيل العميل',
        description: err instanceof Error ? err.message : 'فشل التسجيل',
      });
    }
  };

  const updateCustomer = async (id: string, updates: Partial<Customer>) => {
    try {
      const updated = await api.updateCustomer(id, updates);
      setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      addToast({
        type: 'success',
        title: 'تم تحديث بيانات العميل',
        description: 'تم حفظ التعديلات في قاعدة البيانات',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في تحديث العميل',
        description: err instanceof Error ? err.message : 'فشل التحديث',
      });
    }
  };

  const deleteCustomer = async (id: string) => {
    try {
      const res = await api.deleteCustomer(id);
      setCustomers((prev) => prev.filter((c) => c.id !== id));
      addToast({
        type: 'warning',
        title: 'تم إجراء حذف/أرشفة العميل',
        description: res.message || 'تم تحديث السجل',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في حذف العميل',
        description: err instanceof Error ? err.message : 'تعذر الحذف',
      });
    }
  };

  const toggleCustomerStatus = async (id: string) => {
    const c = customers.find((cust) => cust.id === id);
    if (!c) return;
    const newStatus = c.status === 'active' ? 'blocked' : 'active';
    await updateCustomer(id, { status: newStatus });
  };

  // 15.5. Delivery Regions Actions
  const addDeliveryRegion = async (regionData: Omit<DeliveryRegion, 'id' | 'createdAt'>) => {
    try {
      const created = await api.createDeliveryRegion(regionData);
      setDeliveryRegions((prev) => [...prev, created]);
      addToast({
        type: 'success',
        title: 'تمت إضافة منطقة التوصيل',
        description: `${created.name} (${created.deliveryFee} ج.م)`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في إضافة منطقة التوصيل',
        description: err instanceof Error ? err.message : 'تعذر الحفظ',
      });
    }
  };

  const updateDeliveryRegion = async (id: string, updates: Partial<DeliveryRegion>) => {
    try {
      const updated = await api.updateDeliveryRegion(id, updates);
      setDeliveryRegions((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
      addToast({
        type: 'success',
        title: 'تم تحديث منطقة التوصيل',
        description: `تم حفظ تعديلات منطقة ${updated.name}`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في تحديث منطقة التوصيل',
        description: err instanceof Error ? err.message : 'تعذر التحديث',
      });
    }
  };

  const deleteDeliveryRegion = async (id: string) => {
    try {
      await api.deleteDeliveryRegion(id);
      setDeliveryRegions((prev) => prev.filter((r) => r.id !== id));
      addToast({
        type: 'warning',
        title: 'تم حذف منطقة التوصيل',
        description: 'تم إزالة المنطقة من قاعدة البيانات',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في حذف منطقة التوصيل',
        description: err instanceof Error ? err.message : 'تعذر الحذف',
      });
    }
  };

  // 16. Store Settings Actions
  const updateSettings = async (updates: Partial<StoreSettings>) => {
    try {
      await api.updateSettings(updates);
      setSettings((prev) => ({ ...prev, ...updates }));
      addToast({
        type: 'success',
        title: 'تم حفظ إعدادات المتجر',
        description: 'تم تطبيق الإعدادات المحدثة في قاعدة البيانات',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'خطأ في حفظ الإعدادات',
        description: err instanceof Error ? err.message : 'تعذر الحفظ',
      });
    }
  };

  const toggleStoreStatus = async () => {
    const nextStatus = !settings.isOpen;
    await updateSettings({ isOpen: nextStatus });
  };

  const contextValue = useMemo(
    () => ({
      isAuthenticated,
      isLoadingAuth,
      login,
      logout,
      authCredentials,
      updateCredentials,
      darkMode,
      toggleDarkMode,
      activeTab,
      setActiveTab,
      isSidebarOpen,
      setIsSidebarOpen,
      soundEnabled,
      toggleSound,
      phoneNotificationsEnabled,
      notificationPermission,
      requestPhoneNotificationPermission,
      togglePhoneNotifications,
      sendPhoneNotification,
      realtimeConnected,
      adminUser,
      updateAdminProfile,
      customers,
      addCustomer,
      updateCustomer,
      deleteCustomer,
      toggleCustomerStatus,
      products,
      isLoadingProducts,
      addProduct,
      updateProduct,
      deleteProduct,
      orders,
      isLoadingOrders,
      addOrder,
      updateOrderStatus,
      confirmDeposit,
      updateOrder,
      deleteOrder,
      coupons,
      addCoupon,
      updateCoupon,
      deleteCoupon,
      toggleCouponActive,
      categories,
      addCategory,
      updateCategory,
      deleteCategory,
      deliveryRegions,
      isLoadingDeliveryRegions,
      addDeliveryRegion,
      updateDeliveryRegion,
      deleteDeliveryRegion,
      settings,
      updateSettings,
      toggleStoreStatus,
      toasts,
      addToast,
      removeToast,
      refreshData,
    }),
    [
      isAuthenticated,
      isLoadingAuth,
      login,
      logout,
      authCredentials,
      updateCredentials,
      darkMode,
      toggleDarkMode,
      activeTab,
      setActiveTab,
      isSidebarOpen,
      setIsSidebarOpen,
      soundEnabled,
      toggleSound,
      phoneNotificationsEnabled,
      notificationPermission,
      requestPhoneNotificationPermission,
      togglePhoneNotifications,
      sendPhoneNotification,
      realtimeConnected,
      adminUser,
      updateAdminProfile,
      customers,
      addCustomer,
      updateCustomer,
      deleteCustomer,
      toggleCustomerStatus,
      products,
      isLoadingProducts,
      addProduct,
      updateProduct,
      deleteProduct,
      orders,
      isLoadingOrders,
      addOrder,
      updateOrderStatus,
      confirmDeposit,
      updateOrder,
      deleteOrder,
      coupons,
      addCoupon,
      updateCoupon,
      deleteCoupon,
      toggleCouponActive,
      categories,
      addCategory,
      updateCategory,
      deleteCategory,
      deliveryRegions,
      isLoadingDeliveryRegions,
      addDeliveryRegion,
      updateDeliveryRegion,
      deleteDeliveryRegion,
      settings,
      updateSettings,
      toggleStoreStatus,
      toasts,
      addToast,
      removeToast,
      refreshData,
    ]
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
