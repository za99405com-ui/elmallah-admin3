export type PricingUnit = 'kg' | 'piece';

export type OrderStatus = 'pending' | 'preparing' | 'delivering' | 'completed' | 'cancelled';

export type DepositStatus = 'confirmed' | 'pending' | 'not_required' | 'rejected';

export type DepositMethod = 'instapay' | 'vodafone_cash' | 'orange_cash' | 'etisalat_cash' | 'bank_transfer' | 'cash' | 'other';

export type DiscountType = 'percentage' | 'fixed';

export type AdminRole = 'super_admin' | 'manager' | 'operator';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  imageUrl?: string;
  icon?: string;
  itemCount?: number;
  isActive: boolean;
  sortOrder?: number;
  createdAt?: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  title: string; // e.g. "حجم وسط - 4 إلى 6 قطع/كجم"
  weightKg: number; // e.g. 1.0 kg
  pieceCount: number; // e.g. 4, 6, 8 pcs
  approxPieceWeightG?: number; // e.g. 250 g
  price: number; // Price in EGP
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName?: string;
  pricingUnit: PricingUnit; // 'kg' or 'piece'
  price: number; // Base price in EGP (ج.م)
  imageUrl: string;
  isActive?: boolean;
  minOrderQuantity?: number;
  maxOrderQuantity?: number;
  sortOrder?: number;
  badge?: string; // e.g. 'طازج اليوم', 'الأكثر طلباً'
  variants?: ProductVariant[];
  createdAt: string;
}

export interface OrderItem {
  id?: string;
  productId: string;
  productName: string;
  variantId?: string;
  variantTitle?: string;
  pricingUnit: PricingUnit;
  weightKg?: number;
  pieceCount?: number;
  unitPrice: number;
  quantity: number; // e.g. 2.0 kg or 3 pieces
  totalPrice: number;
  snapshotData?: Record<string, unknown>;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  city?: string;
  district?: string;
  items: OrderItem[];
  subtotal: number;
  discountAmount: number;
  couponCode?: string;
  deliveryFee: number;
  totalAmount: number;
  status: OrderStatus;
  notes?: string;
  
  // Deposit confirmation fields (تأكيد العربون)
  depositStatus: DepositStatus; // 'confirmed' | 'pending' | 'not_required' | 'rejected'
  depositAmount: number; // مبلغ العربون بالجنيه المصري
  depositMethod?: DepositMethod; // طريقة تحويل العربون (إنستاباي، فودافون كاش، etc)
  depositReference?: string; // رقم عملية التحويل أو رقم المحفظة
  depositConfirmedAt?: string; // تاريخ ووقت تأكيد استلام العربون
  depositConfirmedBy?: string; // المسؤول الذي أكد استلام العربون
  depositNotes?: string; // ملاحظات تدقيق العربون
  remainingAmount: number; // المبلغ المتبقي عند الاستلام (totalAmount - depositAmount)
  
  createdAt: string;
  updatedAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: DiscountType; // percentage or fixed
  discountValue: number;
  minOrderValue: number;
  maxDiscountValue?: number;
  usageLimit: number;
  usedCount: number;
  expiryDate: string;
  isActive: boolean;
  createdAt: string;
}

export interface StoreSettings {
  storeName: string;
  tagline: string;
  phone: string;
  whatsapp: string;
  instapayHandle: string;
  instapayNumber: string;
  vodafoneCash: string;
  address: string;
  isOpen: boolean;
  closedReason?: string;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  minOrderAmount: number;
  depositPercentage: number;
  minDepositAmount: number;
  workingHours: string;
  cutoffHour: number;
  currency: string;
}

export interface DeliveryRegion {
  id: string;
  name: string;
  city: string;
  deliveryFee: number;
  minOrderAmount?: number;
  estimatedHours: number;
  sortOrder?: number;
  isActive: boolean;
  createdAt?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
  timestamp: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  avatarUrl: string;
  lastLogin?: string;
}

export interface AuthCredentials {
  email: string;
  password?: string;
  lastUpdated?: string;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone: string;
  city: string;
  district: string;
  address: string;
  registeredAt: string;
  registrationSource?: 'web' | 'mobile' | 'manual';
  totalOrders: number;
  totalSpent: number;
  lastOrderDate?: string;
  status: 'active' | 'blocked';
  notes?: string;
}

export interface AuditLog {
  id: string;
  adminId: string;
  adminName: string;
  adminEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: string;
  newValues?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface DashboardStats {
  totalOrders: number;
  todayOrders: number;
  pendingOrders: number;
  preparingOrders: number;
  deliveringOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  pendingDepositsCount: number;
  pendingDepositsAmount: number;
  totalSales: number;
  todaySales: number;
  totalCustomers: number;
  totalProducts: number;
  activeDemandsCount?: number;
  totalVariants: number;
}

export interface PrepOrderBreakdown {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  quantity: number;
  variantTitle?: string;
  orderStatus: OrderStatus;
  depositStatus: DepositStatus;
  createdAt: string;
  notes?: string;
}

export interface PrepVariantRequirement {
  variantId: string;
  variantTitle: string;
  pieceCount?: number;
  weightKg?: number;
  price: number;
  requiredQuantity: number; // e.g. 5 kg for 3 حبات or 3 kg for 4 في الكيلو
  pricingUnit: PricingUnit;
  ordersCount: number;
}

export interface PrepItemSummary {
  productId: string;
  productName: string;
  imageUrl?: string;
  categoryName?: string;
  pricingUnit: PricingUnit;
  totalRequired: number; // e.g. 15.5 kg or 12 pieces
  ordersCount: number;
  variantsBreakdown: PrepVariantRequirement[]; // تفصيل المقاسات والأنواع (مثل 5 كيلو 3 حبات، 3 كيلو 4 في الكيلو)
  orders: PrepOrderBreakdown[];
  isMarkedPrepared?: boolean;
}

export type PrepCycleFilter = 'today' | 'tomorrow' | 'all' | 'custom';

export type ActiveTab =
  | 'overview'
  | 'orders'
  | 'deposits'
  | 'order_demand'
  | 'customers'
  | 'products'
  | 'coupons'
  | 'categories'
  | 'delivery_regions'
  | 'settings';
