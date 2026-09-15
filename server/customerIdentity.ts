import crypto from 'node:crypto';
import { supabaseServer } from './supabase.js';

export interface RawCustomerPolicy {
  customer_id: string;
  is_blocked: boolean;
  block_reason?: string | null;
  blocked_until?: string | null;
  personal_discount_enabled: boolean;
  personal_discount_type?: 'percentage' | 'fixed' | null;
  personal_discount_value?: number | null;
  personal_discount_max_amount?: number | null;
  personal_discount_expires_at?: string | null;
  cod_override: 'inherit' | 'allow' | 'deny';
  cod_max_order_amount?: number | null;
  cod_expires_at?: string | null;
  admin_notes?: string | null;
  updated_by?: string | null;
  updated_at: string;
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

/**
 * Normalizes an Egyptian phone number to standard local 11-digit format (01xxxxxxxxx).
 */
export function normalizeEgyptianPhone(rawPhone: unknown): { normalized: string; isValid: boolean } {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { normalized: '', isValid: false };
  }

  let cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, '');

  // Handle +20 or 0020 prefix
  if (cleaned.startsWith('+20')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (cleaned.startsWith('0020')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('20') && cleaned.length === 12) {
    cleaned = '0' + cleaned.slice(2);
  }

  // Validate Egyptian mobile format: 010, 011, 012, 015 followed by 8 digits
  const isValid = /^01[0125][0-9]{8}$/.test(cleaned);

  return { normalized: cleaned, isValid };
}

/**
 * Resolves live customer policy including expiration of blocks, personal discounts, and COD overrides.
 */
export function calculateEffectivePolicy(customerId: string, rawPolicy?: Partial<RawCustomerPolicy> | null): EffectiveCustomerPolicy {
  const now = new Date();

  const isBlocked = Boolean(rawPolicy?.is_blocked);
  const blockedUntil = rawPolicy?.blocked_until ? new Date(rawPolicy.blocked_until) : null;

  let effectiveBlocked = false;
  let blockRemainingMinutes: number | null = null;

  if (isBlocked) {
    if (!blockedUntil) {
      // Permanent block
      effectiveBlocked = true;
    } else if (blockedUntil > now) {
      // Temporary block still in effect
      effectiveBlocked = true;
      blockRemainingMinutes = Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 60000));
    } else {
      // Temporary block expired
      effectiveBlocked = false;
    }
  }

  // Personal discount resolution
  const discountEnabled = Boolean(rawPolicy?.personal_discount_enabled);
  const discountExpiry = rawPolicy?.personal_discount_expires_at ? new Date(rawPolicy.personal_discount_expires_at) : null;
  const isDiscountExpired = discountExpiry ? discountExpiry <= now : false;

  let personalDiscount: EffectiveCustomerPolicy['personalDiscount'] = null;
  if (discountEnabled && !isDiscountExpired && rawPolicy?.personal_discount_value != null && Number(rawPolicy.personal_discount_value) > 0) {
    personalDiscount = {
      enabled: true,
      type: (rawPolicy.personal_discount_type as 'percentage' | 'fixed') || 'percentage',
      value: Number(rawPolicy.personal_discount_value),
      maxAmount: rawPolicy.personal_discount_max_amount != null ? Number(rawPolicy.personal_discount_max_amount) : null,
      expiresAt: rawPolicy.personal_discount_expires_at || null,
    };
  }

  // COD override resolution
  const codExpiry = rawPolicy?.cod_expires_at ? new Date(rawPolicy.cod_expires_at) : null;
  const isCodExpired = codExpiry ? codExpiry <= now : false;

  let codOverride: 'inherit' | 'allow' | 'deny' = 'inherit';
  let codMaxOrderAmount: number | null = null;
  let codExpiresAt: string | null = null;

  if (!isCodExpired) {
    codOverride = (rawPolicy?.cod_override as 'inherit' | 'allow' | 'deny') || 'inherit';
    codMaxOrderAmount = rawPolicy?.cod_max_order_amount != null ? Number(rawPolicy.cod_max_order_amount) : null;
    codExpiresAt = rawPolicy?.cod_expires_at || null;
  }

  const codAllowed = codOverride === 'deny' ? false : true;

  return {
    customerId,
    isBlocked,
    effectiveBlocked,
    blockReason: rawPolicy?.block_reason || null,
    blockedUntil: rawPolicy?.blocked_until || null,
    blockRemainingMinutes,
    personalDiscount,
    codOverride,
    codMaxOrderAmount,
    codExpiresAt,
    codAllowed,
  };
}

/**
 * Fetches raw customer policy from database and resolves effective permissions.
 */
export async function getEffectiveCustomerPolicy(customerId: string): Promise<EffectiveCustomerPolicy> {
  try {
    const { data: policyRow } = await supabaseServer
      .from('customer_policies')
      .select('*')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (policyRow) {
      return calculateEffectivePolicy(customerId, policyRow as RawCustomerPolicy);
    }
  } catch (err) {
    console.error('Error fetching customer policy:', err);
  }

  // Fallback to customers table status if customer_policies row does not exist yet
  try {
    const { data: cust } = await supabaseServer
      .from('customers')
      .select('id, status, notes')
      .eq('id', customerId)
      .maybeSingle();

    if (cust) {
      const isBlocked = cust.status === 'blocked';
      return calculateEffectivePolicy(customerId, {
        customer_id: customerId,
        is_blocked: isBlocked,
        block_reason: isBlocked ? (cust.notes || 'محظور من سجلات المتجر') : null,
      });
    }
  } catch (err) {
    console.error('Error fallback customer policy:', err);
  }

  return calculateEffectivePolicy(customerId, null);
}

/**
 * Foundation check: Authoritatively checks whether a customer can place orders.
 * Inspects canonical customer identity, linked phone accounts, and resolves effective blocks.
 */
export async function assertCustomerCanPlaceOrder(
  identifier: { customerId?: string; phone?: string }
): Promise<{ allowed: boolean; reason?: string; customerId?: string; policy?: EffectiveCustomerPolicy }> {
  let resolvedCustomerId: string | null = identifier.customerId || null;

  if (!resolvedCustomerId && identifier.phone) {
    const { normalized } = normalizeEgyptianPhone(identifier.phone);
    const searchPhone = normalized || identifier.phone.trim();

    // 1. Try finding in linked customer_accounts
    try {
      const { data: accountRow } = await supabaseServer
        .from('customer_accounts')
        .select('customer_id, is_active')
        .eq('phone', searchPhone)
        .maybeSingle();

      if (accountRow?.customer_id) {
        resolvedCustomerId = accountRow.customer_id;
      }
    } catch {
      // Table might be initializing
    }

    // 2. Fallback to customers table
    if (!resolvedCustomerId) {
      try {
        const { data: customerRow } = await supabaseServer
          .from('customers')
          .select('id')
          .eq('phone', searchPhone)
          .maybeSingle();

        if (customerRow?.id) {
          resolvedCustomerId = customerRow.id;
        }
      } catch {
        // Continue
      }
    }
  }

  if (!resolvedCustomerId) {
    // New guest or unassociated customer: allowed by default
    return { allowed: true };
  }

  const effectivePolicy = await getEffectiveCustomerPolicy(resolvedCustomerId);

  if (effectivePolicy.effectiveBlocked) {
    return {
      allowed: false,
      reason: 'لا يمكن تنفيذ طلبات من هذا الحساب حالياً. يرجى التواصل مع خدمة العملاء.',
      customerId: resolvedCustomerId,
      policy: effectivePolicy,
    };
  }

  return {
    allowed: true,
    customerId: resolvedCustomerId,
    policy: effectivePolicy,
  };
}
