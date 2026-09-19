export type PricingUnit = 'kg' | 'piece';

export type OrderStatus = 'pending' | 'preparing' | 'delivering' | 'completed' | 'cancelled';

export type DepositStatus = 'confirmed' | 'pending' | 'not_required' | 'rejected';

export type PaymentMode = 'deposit_online' | 'cash_on_delivery';

export type DepositMethod =
  | 'instapay'
  | 'vodafone_cash'
  | 'orange_cash'
  | 'etisalat_cash'
  | 'bank_transfer'
  | 'cash'
  | 'card'
  | 'cash_on_delivery'
  | 'other';

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
  
  // Payment mode (نظام الدفع: عربون إلكتروني أو كاش عند الاستلام)
  paymentMode?: PaymentMode;

  // Deposit confirmation fields (تأكيد العربون)
  depositStatus: DepositStatus; // 'confirmed' | 'pending' | 'not_required' | 'rejected'
  depositAmount: number; // مبلغ العربون المطلوب بالجنيه المصري
  depositPaid?: number; // المبلغ المؤكد استلامه فعلياً
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
  accountsCount?: number;
  hasCustomPolicy?: boolean;
}

export interface CustomerAccount {
  id: string;
  customerId: string;
  phone: string;
  isPrimary: boolean;
  isActive: boolean;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  lastLoginAt?: string | null;
  linkedByAdminId?: string | null;
  notes?: string | null;
}

export interface CustomerPolicy {
  customerId: string;
  isBlocked: boolean;
  blockReason?: string | null;
  blockedUntil?: string | null;
  personalDiscountEnabled: boolean;
  personalDiscountType?: 'percentage' | 'fixed' | null;
  personalDiscountValue?: number | null;
  personalDiscountMaxAmount?: number | null;
  personalDiscountExpiresAt?: string | null;
  codOverride: 'inherit' | 'allow' | 'deny';
  codMaxOrderAmount?: number | null;
  codExpiresAt?: string | null;
  adminNotes?: string | null;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface EffectiveCustomerPolicy {
  customerId: string;
  isBlocked: boolean;
  effectiveBlocked: boolean;
  blockReason?: string | null;
  blockedUntil?: string | null;
  blockRemainingMinutes?: number | null;
  personalDiscount: {
    enabled: boolean;
    type: 'percentage' | 'fixed';
    value: number;
    maxAmount?: number | null;
    expiresAt?: string | null;
  } | null;
  codOverride: 'inherit' | 'allow' | 'deny';
  codMaxOrderAmount?: number | null;
  codExpiresAt?: string | null;
  codAllowed: boolean;
}

export interface CustomerDetails {
  customer: Customer;
  accounts: CustomerAccount[];
  policy: CustomerPolicy | null;
  effectivePolicy: EffectiveCustomerPolicy;
  stats: {
    totalOrders: number;
    totalSpent: number;
    lastOrderAt?: string | null;
  };
  recentOrders?: Array<{
    id: string;
    orderNumber: string;
    totalAmount: number;
    status: string;
    paymentMode: string;
    createdAt: string;
  }>;
}

export interface CustomerMergeResult {
  success: boolean;
  message: string;
  targetCustomerId: string;
  sourceCustomerId: string;
  accountsMovedCount: number;
  ordersMovedCount: number;
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
  | 'payments'
  | 'deposits'
  | 'order_demand'
  | 'customers'
  | 'products'
  | 'coupons'
  | 'categories'
  | 'delivery_regions'
  | 'settings';

export interface PaymentSource {
  id: string;
  code: string;
  displayName: string;
  enabled: boolean;
  channel: 'wallet' | 'bank_transfer' | 'instapay' | 'other';
  destination?: string | null;
  parserType: 'regex' | 'json' | 'keyword' | 'smart';
  sourcePackage?: string | null;
  sourcePackages?: string[];
  sourceSender?: string | null;
  titleContains?: string | null;
  bodyContains?: string | null;
  amountRegex?: string | null;
  payerPhoneRegex?: string | null;
  accountIdentifierRegex?: string | null;
  priority: number;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentDeviceSource {
  id: string;
  deviceId: string;
  paymentSourceId: string;
  destination?: string | null;
  destinationLabel?: string | null;
  enabled: boolean;
  source?: PaymentSource;
}

export interface CustomerPaymentMethod {
  id: string;
  code: string;
  displayName: string;
  nameAr?: string;
  nameEn?: string;
  descriptionAr?: string;
  enabled: boolean;
  channel: 'cash_on_delivery' | 'wallet' | 'instapay' | 'bank_transfer' | 'card' | 'other';
  instructions?: string | null;
  instructionsAr?: string | null;
  sortOrder: number;
  sources?: PaymentSource[];
  sourceIds?: string[];
  primarySourceId?: string | null;
  secondarySourceIds?: string[];
  requiresDeposit?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentDeviceItem {
  id: string;
  deviceId: string;
  name: string;
  paymentDestination: string;
  isEnabled: boolean;
  vfCashEnabled: boolean;
  bankAlAhlyEnabled: boolean;
  online: boolean;
  internetConnected: boolean;
  appRunning: boolean;
  notificationListenerEnabled: boolean;
  busy: boolean;
  busySessionId?: string | null;
  lastHeartbeatAt?: string;
  lastEventAt?: string;
  appVersion?: string;
  sources?: PaymentSource[];
  assignedSourceIds?: string[];
  assignedSources?: string[];
}

export interface PaymentBridgeEventItem {
  id: string;
  eventId: string;
  deviceId: string;
  reportedDeviceId: string;
  provider: string;
  paymentSourceId?: string | null;
  paymentChannel?: string | null;
  amountMinor: number;
  currency: string;
  payerPhone?: string | null;
  walletPhone?: string | null;
  transactionReference?: string | null;
  accountLast4?: string | null;
  accountIdentifier?: string | null;
  sourceSender?: string | null;
  sourcePackage?: string | null;
  notificationPostedAt?: string | null;
  capturedAt: string;
  matchStatus: string;
  matchedSessionId?: string | null;
  createdAt: string;
}

export interface PaymentSessionItem {
  id: string;
  clientToken: string;
  orderId: string;
  customerId?: string;
  customerPhone?: string;
  customerName?: string;
  provider: string;
  paymentSourceId?: string;
  paymentSourceName?: string;
  expectedAmount: number;
  amountTolerance: number;
  currency: string;
  deviceId?: string;
  devicePublicId?: string;
  paymentDestination?: string;
  status: 'waiting' | 'paid' | 'expired' | 'expired_needs_review' | 'needs_review' | 'cancelled';
  expiresAt: string;
  contactedSupportAt?: string;
  matchedEventId?: string;
  matchedAmount?: number;
  amountDifference?: number;
  payerPhone?: string;
  paidAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentReviewItemDetail {
  id: string;
  reason: 'underpaid' | 'late_payment' | 'ambiguous' | 'no_match' | 'customer_contacted_support';
  status: 'open' | 'resolved';
  sessionId?: string;
  eventId?: string;
  orderId?: string;
  customerName?: string;
  customerPhone?: string;
  expectedAmount?: number;
  receivedAmount?: number;
  amountDifference?: number;
  details?: Record<string, any>;
  resolutionNotes?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DepositPolicySettings {
  defaultPaymentPolicy: 'cod_allowed' | 'deposit_required';
  sessionTimeoutSeconds: number;
  amountTolerance: number;
  depositRequired: boolean;
  depositType: 'fixed' | 'percentage';
  depositValue: number;
  minimumDeposit: number;
}

