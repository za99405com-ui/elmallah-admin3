import crypto from 'node:crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { supabaseServer } from './supabase.js';
import { normalizeEgyptianPhone } from './customerIdentity.js';

export const paymentIntegrationConfigRouter = Router();

function safeCompare(a: string, b: string): boolean {
  const aa = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function requireIntegrationKey(req: Request, res: Response, next: NextFunction) {
  const configured = process.env.CUSTOMER_APP_INTEGRATION_KEY;
  const provided = req.header('X-Integration-Key');
  if (!configured) return res.status(503).json({ error: 'Integration service is not configured' });
  if (!provided || !safeCompare(configured, provided)) {
    return res.status(401).json({ error: 'Unauthorized integration request' });
  }
  next();
}

/**
 * Source-of-truth checkout guard. The global policy is a default for accounts
 * that inherit policy; a live per-customer allow/deny override takes priority.
 */
paymentIntegrationConfigRouter.post('/orders', async (req: Request, res: Response, next: NextFunction) => {
  if (req.body?.paymentMode !== 'cash_on_delivery') return next();

  const { data: settings, error } = await supabaseServer
    .from('store_settings')
    .select('default_payment_policy')
    .eq('id', 1)
    .maybeSingle();
  if (error) return res.status(503).json({ error: 'Payment policy service unavailable' });

  let effectiveOverride: 'inherit' | 'allow' | 'deny' = 'inherit';
  const normalizedPhone = normalizeEgyptianPhone(req.body?.customerPhone);

  if (normalizedPhone.isValid) {
    let customerId: string | null = null;

    const { data: account } = await supabaseServer
      .from('customer_accounts')
      .select('customer_id')
      .eq('phone', normalizedPhone.normalized)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    customerId = account?.customer_id ? String(account.customer_id) : null;

    if (!customerId) {
      const { data: customer } = await supabaseServer
        .from('customers')
        .select('id')
        .eq('phone', normalizedPhone.normalized)
        .limit(1)
        .maybeSingle();
      customerId = customer?.id ? String(customer.id) : null;
    }

    if (customerId) {
      const { data: policy } = await supabaseServer
        .from('customer_policies')
        .select('cod_override,cod_expires_at')
        .eq('customer_id', customerId)
        .maybeSingle();

      if (policy?.cod_override === 'allow' || policy?.cod_override === 'deny') {
        const expiresAt = policy.cod_expires_at ? new Date(policy.cod_expires_at).getTime() : null;
        if (expiresAt === null || expiresAt > Date.now()) {
          effectiveOverride = policy.cod_override;
        }
      }
    }
  }

  if (effectiveOverride === 'allow') return next();

  if (effectiveOverride === 'deny' || settings?.default_payment_policy === 'deposit_required') {
    return res.status(403).json({
      error: 'العربون الإلكتروني مطلوب لهذا الطلب ولا يمكن استخدام الدفع عند الاستلام.',
      code: 'deposit_required',
    });
  }

  return next();
});

async function getStorePaymentSettings(): Promise<{
  default_payment_policy: string;
  payment_session_timeout_seconds: number;
  payment_amount_tolerance: number;
  deposit_required: boolean;
  deposit_type: 'fixed' | 'percentage';
  deposit_value: number;
  minimum_deposit: number;
}> {
  // 1. Read legacy-safe columns only (guaranteed to exist before migration)
  const { data: legacy } = await supabaseServer
    .from('store_settings')
    .select('default_payment_policy,payment_session_timeout_seconds,payment_amount_tolerance')
    .eq('id', 1)
    .maybeSingle();

  const defaultPolicy = legacy?.default_payment_policy || 'cod_allowed';
  const timeoutSeconds = Number(legacy?.payment_session_timeout_seconds || 120);
  const tolerance = Number(legacy?.payment_amount_tolerance || 10);

  let depositRequired = defaultPolicy === 'deposit_required';
  let depositType: 'fixed' | 'percentage' = 'fixed';
  let depositValue = 100;
  let minimumDeposit = 50;

  // 2. Attempt V3 fields separately or gracefully detect missing columns
  try {
    const { data: v3, error: v3Error } = await supabaseServer
      .from('store_settings')
      .select('deposit_required,deposit_type,deposit_value,minimum_deposit')
      .eq('id', 1)
      .maybeSingle();

    if (!v3Error && v3) {
      if (v3.deposit_required !== null && v3.deposit_required !== undefined) {
        depositRequired = Boolean(v3.deposit_required);
      }
      if (v3.deposit_type === 'fixed' || v3.deposit_type === 'percentage') {
        depositType = v3.deposit_type;
      }
      if (v3.deposit_value !== null && v3.deposit_value !== undefined) {
        depositValue = Number(v3.deposit_value);
      }
      if (v3.minimum_deposit !== null && v3.minimum_deposit !== undefined) {
        minimumDeposit = Number(v3.minimum_deposit);
      }
    }
  } catch (_err) {
    // V3 columns not available yet; proceed with legacy settings
  }

  return {
    default_payment_policy: defaultPolicy,
    payment_session_timeout_seconds: timeoutSeconds,
    payment_amount_tolerance: tolerance,
    deposit_required: depositRequired,
    deposit_type: depositType,
    deposit_value: depositValue,
    minimum_deposit: minimumDeposit,
  };
}

paymentIntegrationConfigRouter.get('/payments/config', requireIntegrationKey, async (_req: Request, res: Response) => {
  const settings = await getStorePaymentSettings();

  const [devicesRes, methodsRes, methodSourcesRes, deviceSourcesRes] = await Promise.all([
    supabaseServer
      .from('payment_devices')
      .select('id,device_id,vf_cash_enabled,bank_alahly_enabled,is_enabled,online,internet_connected,app_running,notification_listener_enabled,is_busy,last_heartbeat_at')
      .eq('is_enabled', true),
    supabaseServer
      .from('customer_payment_methods')
      .select('*')
      .order('sort_order', { ascending: true }),
    supabaseServer
      .from('customer_payment_method_sources')
      .select('customer_payment_method_id,payment_source_id,is_primary,payment_sources(*)'),
    supabaseServer
      .from('payment_device_sources')
      .select('device_id,payment_source_id,enabled')
      .eq('enabled', true),
  ]);

  const freshAfter = Date.now() - 45_000;
  const eligibleDevices = (devicesRes.data || []).filter((device: any) => {
    const heartbeat = device.last_heartbeat_at ? new Date(device.last_heartbeat_at).getTime() : 0;
    return Boolean(
      device.online &&
      device.internet_connected &&
      device.app_running &&
      device.notification_listener_enabled &&
      !device.is_busy &&
      heartbeat >= freshAfter
    );
  });

  // Map which payment source IDs have at least one eligible device
  const eligibleSourceIds = new Set<string>();
  for (const d of eligibleDevices) {
    const assigned = (deviceSourcesRes.data || []).filter((ds: any) => ds.device_id === d.id);
    for (const a of assigned) {
      eligibleSourceIds.add(a.payment_source_id);
    }
    // Also include legacy boolean flags
    if (d.vf_cash_enabled) eligibleSourceIds.add('vf_cash_legacy');
    if (d.bank_alahly_enabled) eligibleSourceIds.add('bank_alahly_legacy');
  }

  const rawMethods = methodsRes.data || [];
  let methods: any[] = [];

  if (rawMethods.length > 0) {
    // Build customer payment methods from V3 tables
    methods = rawMethods.map((method: any) => {
      const mappedSources = (methodSourcesRes.data || [])
        .filter((ms: any) => ms.customer_payment_method_id === method.id)
        .map((ms: any) => ms.payment_sources)
        .filter(Boolean);

      let isAvailable = false;
      if (method.channel === 'cash_on_delivery') {
        isAvailable = Boolean(method.enabled);
      } else {
        // Available if at least one mapped source has an eligible device or legacy provider matches
        isAvailable = mappedSources.some((src: any) => {
          if (!src.enabled) return false;
          if (eligibleSourceIds.has(src.id)) return true;
          if (src.code === 'vf_cash' && eligibleSourceIds.has('vf_cash_legacy')) return true;
          if (src.code === 'bank_alahly' && eligibleSourceIds.has('bank_alahly_legacy')) return true;
          return false;
        });
        // Fallback: if no mapped sources yet, check by method code
        if (!isAvailable && mappedSources.length === 0) {
          if (method.code === 'vodafone_cash' && eligibleDevices.some((d: any) => d.vf_cash_enabled)) isAvailable = true;
          if (method.code === 'bank_transfer' && eligibleDevices.some((d: any) => d.bank_alahly_enabled)) isAvailable = true;
        }
      }

      return {
        id: method.id,
        code: method.code,
        name: method.display_name,
        enabled: Boolean(method.enabled),
        available: Boolean(method.enabled && isAvailable),
        channel: method.channel,
        instructions: method.instructions || undefined,
        sortOrder: Number(method.sort_order || 0),
      };
    });
  } else {
    // FIX 27: Graceful fallback when V3 tables do not exist yet (or are empty)
    const vfAvailable = eligibleDevices.some((d: any) => Boolean(d.vf_cash_enabled));
    const ahlyAvailable = eligibleDevices.some((d: any) => Boolean(d.bank_alahly_enabled));
    methods = [
      {
        id: 'legacy-cod',
        code: 'cash_on_delivery',
        name: 'الدفع عند الاستلام',
        enabled: settings.default_payment_policy !== 'deposit_required',
        available: settings.default_payment_policy !== 'deposit_required',
        channel: 'cash_on_delivery',
        sortOrder: 1,
      },
      {
        id: 'legacy-vf-cash',
        code: 'vodafone_cash',
        name: 'فودافون كاش',
        enabled: true,
        available: vfAvailable,
        channel: 'wallet',
        sortOrder: 2,
      },
      {
        id: 'legacy-bank-transfer',
        code: 'bank_transfer',
        name: 'تحويل بنك مصر / الأهلي',
        enabled: true,
        available: ahlyAvailable,
        channel: 'bank_transfer',
        sortOrder: 3,
      },
    ];
  }

  const isDepositRequired = Boolean(settings.deposit_required || settings.default_payment_policy === 'deposit_required');

  return res.json({
    depositPolicy: {
      required: isDepositRequired,
      type: settings.deposit_type || 'fixed',
      value: Number(settings.deposit_value || 100),
      minimumDeposit: Number(settings.minimum_deposit || 50),
    },
    paymentMethods: methods,
    sessionTimeoutSeconds: Number(settings.payment_session_timeout_seconds || 120),
    amountTolerance: Number(settings.payment_amount_tolerance || 10),
    defaultPaymentPolicy: settings.default_payment_policy || 'cod_allowed',
    providers: {
      vfCashAvailable: eligibleDevices.some((device: any) => Boolean(device.vf_cash_enabled)),
      bankAlAhlyAvailable: eligibleDevices.some((device: any) => Boolean(device.bank_alahly_enabled)),
    },
  });
});

paymentIntegrationConfigRouter.post('/payments/calculate-deposit', requireIntegrationKey, async (req: Request, res: Response) => {
  const totalAmount = Math.max(0, Number(req.body?.totalAmount || 0));
  const customerPhone = req.body?.customerPhone;
  const customerId = req.body?.customerId;

  const settings = await getStorePaymentSettings();

  let effectiveOverride: 'inherit' | 'allow' | 'deny' = 'inherit';

  // Check customer override if customer identifier is provided
  if (customerPhone || customerId) {
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && customerPhone) {
      const normalized = normalizeEgyptianPhone(customerPhone);
      if (normalized.isValid) {
        const { data: customer } = await supabaseServer
          .from('customers')
          .select('id')
          .eq('phone', normalized.normalized)
          .limit(1)
          .maybeSingle();
        resolvedCustomerId = customer?.id;
      }
    }

    if (resolvedCustomerId) {
      const { data: policy } = await supabaseServer
        .from('customer_policies')
        .select('cod_override,cod_expires_at')
        .eq('customer_id', resolvedCustomerId)
        .maybeSingle();

      if (policy?.cod_override === 'allow' || policy?.cod_override === 'deny') {
        const expiresAt = policy.cod_expires_at ? new Date(policy.cod_expires_at).getTime() : null;
        if (expiresAt === null || expiresAt > Date.now()) {
          effectiveOverride = policy.cod_override;
        }
      }
    }
  }

  // Precedence: customer allow => no deposit; customer deny => deposit required; otherwise global settings
  let depositRequired = false;
  if (effectiveOverride === 'allow') {
    depositRequired = false;
  } else if (effectiveOverride === 'deny') {
    depositRequired = true;
  } else {
    depositRequired = Boolean(settings?.deposit_required || settings?.default_payment_policy === 'deposit_required');
  }

  if (!depositRequired || totalAmount === 0) {
    return res.json({
      depositRequired: false,
      depositType: settings?.deposit_type || 'fixed',
      depositAmount: 0,
      remainingAmount: totalAmount,
      totalAmount,
    });
  }

  // FIX 15: Validate deposit calculation parameters
  const depositType = settings?.deposit_type === 'percentage' ? 'percentage' : 'fixed';
  let depositValue = Number(settings?.deposit_value ?? 100);
  if (!Number.isFinite(depositValue) || depositValue < 0) depositValue = 0;
  if (depositType === 'percentage' && depositValue > 100) depositValue = 100;

  let minimumDeposit = Number(settings?.minimum_deposit ?? 50);
  if (!Number.isFinite(minimumDeposit) || minimumDeposit < 0) minimumDeposit = 0;

  let depositAmount = 0;
  if (depositType === 'percentage') {
    const raw = (totalAmount * depositValue) / 100;
    depositAmount = Math.max(minimumDeposit, Math.round(raw));
  } else {
    depositAmount = Math.max(minimumDeposit, depositValue);
  }

  // Deposit amount cannot exceed total order amount
  depositAmount = Math.min(totalAmount, Math.round(depositAmount * 100) / 100);
  const remainingAmount = Math.max(0, Math.round((totalAmount - depositAmount) * 100) / 100);

  return res.json({
    depositRequired: true,
    depositType,
    depositAmount,
    remainingAmount,
    totalAmount,
  });
});
