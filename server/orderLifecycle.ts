export type CanonicalOrderStatus =
  | 'pending'
  | 'preparing'
  | 'delivering'
  | 'completed'
  | 'cancelled';

export type CanonicalDepositStatus =
  | 'confirmed'
  | 'pending'
  | 'not_required'
  | 'rejected';

export type DerivedPaymentState =
  | 'not_required'
  | 'waiting'
  | 'paid'
  | 'needs_review';

type OrderLifecycleShape = {
  status?: unknown;
  paymentMode?: unknown;
  payment_mode?: unknown;
  depositStatus?: unknown;
  deposit_status?: unknown;
  depositAmount?: unknown;
  deposit_amount?: unknown;
  depositPaid?: unknown;
  deposit_paid?: unknown;
};

const ORDER_TRANSITIONS: Record<CanonicalOrderStatus, readonly CanonicalOrderStatus[]> = {
  pending: ['preparing', 'cancelled'],
  preparing: ['delivering', 'cancelled'],
  delivering: ['completed'],
  completed: [],
  cancelled: [],
};

export function normalizeOrderStatus(value: unknown): CanonicalOrderStatus | null {
  const status = String(value || '').trim();
  return status === 'pending' ||
    status === 'preparing' ||
    status === 'delivering' ||
    status === 'completed' ||
    status === 'cancelled'
    ? status
    : null;
}

export function normalizeDepositStatus(value: unknown): CanonicalDepositStatus | null {
  const status = String(value || '').trim();
  return status === 'confirmed' ||
    status === 'pending' ||
    status === 'not_required' ||
    status === 'rejected'
    ? status
    : null;
}

export function isTerminalOrderStatus(value: unknown): boolean {
  const status = normalizeOrderStatus(value);
  return status === 'completed' || status === 'cancelled';
}

export function derivePaymentState(order: OrderLifecycleShape): DerivedPaymentState {
  const paymentMode = String(order.paymentMode ?? order.payment_mode ?? '').trim();
  const depositStatus = normalizeDepositStatus(
    order.depositStatus ?? order.deposit_status
  );

  if (paymentMode === 'cash_on_delivery' || depositStatus === 'not_required') {
    return 'not_required';
  }

  if (depositStatus === 'confirmed') {
    return 'paid';
  }

  if (depositStatus === 'rejected') {
    return 'needs_review';
  }

  return 'waiting';
}

export function isPaymentSatisfied(order: OrderLifecycleShape): boolean {
  const state = derivePaymentState(order);
  return state === 'paid' || state === 'not_required';
}

export function validateOrderTransition(
  currentValue: unknown,
  nextValue: unknown,
  order: OrderLifecycleShape
): { ok: true } | { ok: false; code: string; message: string } {
  const current = normalizeOrderStatus(currentValue);
  const next = normalizeOrderStatus(nextValue);

  if (!current || !next) {
    return {
      ok: false,
      code: 'invalid_order_status',
      message: 'حالة الطلب غير صالحة',
    };
  }

  if (current === next) return { ok: true };

  if (!ORDER_TRANSITIONS[current].includes(next)) {
    return {
      ok: false,
      code: 'invalid_order_transition',
      message:
        current === 'completed' || current === 'cancelled'
          ? 'الطلب في حالة نهائية ولا يمكن إعادته لمسار التنفيذ'
          : 'الانتقال المطلوب غير مسموح ضمن دورة تنفيذ الطلب',
    };
  }

  if (next === 'preparing' && !isPaymentSatisfied(order)) {
    return {
      ok: false,
      code: 'payment_not_confirmed',
      message: 'لا يمكن قبول الطلب وبدء التحضير قبل تأكيد العربون أو اختيار الدفع عند الاستلام',
    };
  }

  if (next === 'cancelled' && derivePaymentState(order) === 'paid') {
    return {
      ok: false,
      code: 'paid_order_requires_refund_review',
      message: 'الطلب مدفوع بالفعل. يجب معالجة الاسترداد أو مراجعة الدفع قبل الإلغاء.',
    };
  }

  return { ok: true };
}

export function validatePaymentSessionStart(
  order: OrderLifecycleShape
): { ok: true } | { ok: false; code: string; message: string } {
  const status = normalizeOrderStatus(order.status);

  if (!status) {
    return { ok: false, code: 'invalid_order_status', message: 'حالة الطلب غير صالحة' };
  }

  if (status !== 'pending') {
    return {
      ok: false,
      code: 'order_not_payable',
      message:
        status === 'completed'
          ? 'الطلب مكتمل ولا يمكن إنشاء جلسة دفع جديدة'
          : status === 'cancelled'
            ? 'الطلب ملغي ولا يمكن إنشاء جلسة دفع'
            : 'بدأ تنفيذ الطلب بالفعل ولا يمكن إنشاء جلسة دفع جديدة',
    };
  }

  const paymentState = derivePaymentState(order);
  if (paymentState === 'paid') {
    return {
      ok: false,
      code: 'payment_already_confirmed',
      message: 'تم تأكيد دفع هذا الطلب بالفعل',
    };
  }

  if (paymentState === 'not_required') {
    return {
      ok: false,
      code: 'payment_not_required',
      message: 'هذا الطلب لا يحتاج جلسة دفع إلكتروني',
    };
  }

  return { ok: true };
}

export function orderStatusLabel(status: CanonicalOrderStatus): string {
  switch (status) {
    case 'pending': return 'جديد';
    case 'preparing': return 'قيد التحضير';
    case 'delivering': return 'خرج للتوصيل';
    case 'completed': return 'مكتمل';
    case 'cancelled': return 'ملغي';
  }
}
