import {
  AdminUser,
  Category,
  Product,
  Order,
  OrderStatus,
  DepositStatus,
  DepositMethod,
  Coupon,
  StoreSettings,
  Customer,
  CustomerAccount,
  CustomerPolicy,
  EffectiveCustomerPolicy,
  CustomerDetails,
  CustomerMergeResult,
  AuditLog,
  DashboardStats,
  DeliveryRegion,
} from '../types';

const TOKEN_KEY = 'almallah_admin_auth_token';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function removeStoredToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    // Session expired or invalid
    removeStoredToken();
    if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
      window.dispatchEvent(new CustomEvent('almallah:unauthorized'));
    }
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'حدث خطأ في الاتصال بالخادم');
  }

  return data as T;
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<{ token: string; admin: AdminUser }> {
    const res = await request<{ token: string; admin: AdminUser }>('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(res.token);
    return res;
  },

  async getMe(): Promise<{ admin: AdminUser }> {
    return request<{ admin: AdminUser }>('/api/admin/auth/me');
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    return request<{ message: string }>('/api/admin/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  logout(): void {
    removeStoredToken();
  },

  // Dashboard Stats
  async getDashboardStats(): Promise<DashboardStats> {
    return request<DashboardStats>('/api/admin/dashboard/stats');
  },

  // Products & Variants
  async getProducts(): Promise<Product[]> {
    return request<Product[]>('/api/admin/products');
  },

  async createProduct(product: Partial<Product>): Promise<Product> {
    return request<Product>('/api/admin/products', {
      method: 'POST',
      body: JSON.stringify(product),
    });
  },

  async updateProduct(id: string, updates: Partial<Product>): Promise<Product> {
    return request<Product>(`/api/admin/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteProduct(id: string): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/admin/products/${id}`, {
      method: 'DELETE',
    });
  },

  // Categories
  async getCategories(): Promise<Category[]> {
    return request<Category[]>('/api/admin/categories');
  },

  async createCategory(category: Partial<Category>): Promise<Category> {
    return request<Category>('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify(category),
    });
  },

  async updateCategory(id: string, updates: Partial<Category>): Promise<Category> {
    return request<Category>(`/api/admin/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteCategory(id: string): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/admin/categories/${id}`, {
      method: 'DELETE',
    });
  },

  // Orders
  async getOrders(params?: { status?: string; depositStatus?: string; search?: string }): Promise<Order[]> {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'all') query.set('status', params.status);
    if (params?.depositStatus && params.depositStatus !== 'all') query.set('depositStatus', params.depositStatus);
    if (params?.search) query.set('search', params.search);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return request<Order[]>(`/api/admin/orders${queryString}`);
  },

  async createManualOrder(orderData: Partial<Order>): Promise<Order> {
    return request<Order>('/api/admin/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  },

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
    return request<Order>(`/api/admin/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  },

  async updateOrderDeposit(
    orderId: string,
    details: {
      depositStatus?: DepositStatus;
      depositAmount?: number;
      depositMethod?: DepositMethod;
      depositReference?: string;
      depositNotes?: string;
    }
  ): Promise<Order> {
    return request<Order>(`/api/admin/orders/${orderId}/deposit`, {
      method: 'PUT',
      body: JSON.stringify(details),
    });
  },

  async deleteOrder(orderId: string): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/admin/orders/${orderId}`, {
      method: 'DELETE',
    });
  },

  // Customers
  async getCustomers(): Promise<Customer[]> {
    return request<Customer[]>('/api/admin/customers');
  },

  async createCustomer(customer: Partial<Customer>): Promise<Customer> {
    return request<Customer>('/api/admin/customers', {
      method: 'POST',
      body: JSON.stringify(customer),
    });
  },

  async updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer> {
    return request<Customer>(`/api/admin/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteCustomer(id: string): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/admin/customers/${id}`, {
      method: 'DELETE',
    });
  },

  async getCustomerDetails(id: string): Promise<CustomerDetails> {
    return request<CustomerDetails>(`/api/admin/customers/${id}`);
  },

  async linkCustomerAccount(
    customerId: string,
    data: { phone: string; isPrimary?: boolean; notes?: string }
  ): Promise<CustomerAccount> {
    return request<CustomerAccount>(`/api/admin/customers/${customerId}/accounts`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateCustomerAccount(
    customerId: string,
    accountId: string,
    updates: { isActive?: boolean; isPrimary?: boolean; notes?: string }
  ): Promise<CustomerAccount> {
    return request<CustomerAccount>(`/api/admin/customers/${customerId}/accounts/${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async updateCustomerPolicy(
    customerId: string,
    policy: Partial<CustomerPolicy>
  ): Promise<{ policy: CustomerPolicy; effectivePolicy: EffectiveCustomerPolicy }> {
    return request<{ policy: CustomerPolicy; effectivePolicy: EffectiveCustomerPolicy }>(
      `/api/admin/customers/${customerId}/policy`,
      {
        method: 'PUT',
        body: JSON.stringify(policy),
      }
    );
  },

  async mergeCustomers(
    targetCustomerId: string,
    data: { sourceCustomerId: string; confirmBlockedSource?: boolean }
  ): Promise<CustomerMergeResult> {
    return request<CustomerMergeResult>(`/api/admin/customers/${targetCustomerId}/merge`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Order Demand & Preparation Requirements
  async getOrderDemand(): Promise<{ products: Product[]; variants: unknown[] }> {
    return request<{ products: Product[]; variants: unknown[] }>('/api/admin/order-demand');
  },

  // Coupons
  async getCoupons(): Promise<Coupon[]> {
    return request<Coupon[]>('/api/admin/coupons');
  },

  async createCoupon(coupon: Partial<Coupon>): Promise<Coupon> {
    return request<Coupon>('/api/admin/coupons', {
      method: 'POST',
      body: JSON.stringify(coupon),
    });
  },

  async updateCoupon(id: string, updates: Partial<Coupon>): Promise<Coupon> {
    return request<Coupon>(`/api/admin/coupons/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteCoupon(id: string): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/admin/coupons/${id}`, {
      method: 'DELETE',
    });
  },

  // Delivery Regions
  async getDeliveryRegions(): Promise<DeliveryRegion[]> {
    return request<DeliveryRegion[]>('/api/admin/delivery-regions');
  },

  async createDeliveryRegion(region: Partial<DeliveryRegion>): Promise<DeliveryRegion> {
    return request<DeliveryRegion>('/api/admin/delivery-regions', {
      method: 'POST',
      body: JSON.stringify(region),
    });
  },

  async updateDeliveryRegion(id: string, updates: Partial<DeliveryRegion>): Promise<DeliveryRegion> {
    return request<DeliveryRegion>(`/api/admin/delivery-regions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteDeliveryRegion(id: string): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/admin/delivery-regions/${id}`, {
      method: 'DELETE',
    });
  },

  // Store Settings
  async getSettings(): Promise<StoreSettings> {
    return request<StoreSettings>('/api/admin/settings');
  },

  async updateSettings(settings: Partial<StoreSettings>): Promise<{ message: string }> {
    return request<{ message: string }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  // Audit Logs
  async getAuditLogs(): Promise<AuditLog[]> {
    return request<AuditLog[]>('/api/admin/audit-logs');
  },
};
