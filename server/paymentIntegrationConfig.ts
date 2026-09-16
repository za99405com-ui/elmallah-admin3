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

paymentIntegrationConfigRouter.get('/payments/config', requireIntegrationKey, async (_req: Request, res: Response) => {
  const { data: settings, error } = await supabaseServer
    .from('store_settings')
    .select('default_payment_policy,payment_session_timeout_seconds,payment_amount_tolerance')
    .eq('id', 1)
    .maybeSingle();

  if (error) return res.status(503).json({ error: 'Payment settings unavailable' });
  if (!settings) return res.status(404).json({ error: 'Payment settings not found' });

  const { data: devices, error: deviceError } = await supabaseServer
    .from('payment_devices')
    .select('vf_cash_enabled,bank_alahly_enabled,is_enabled,online,internet_connected,app_running,notification_listener_enabled,is_busy,last_heartbeat_at')
    .eq('is_enabled', true);

  if (deviceError) return res.status(503).json({ error: 'Payment device service unavailable' });

  const freshAfter = Date.now() - 45_000;
  const eligible = (devices || []).filter((device: any) => {
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

  return res.json({
    defaultPaymentPolicy: settings.default_payment_policy || 'cod_allowed',
    sessionTimeoutSeconds: Number(settings.payment_session_timeout_seconds || 120),
    amountTolerance: Number(settings.payment_amount_tolerance || 10),
    providers: {
      vfCashAvailable: eligible.some((device: any) => Boolean(device.vf_cash_enabled)),
      bankAlAhlyAvailable: eligible.some((device: any) => Boolean(device.bank_alahly_enabled)),
    },
  });
});
