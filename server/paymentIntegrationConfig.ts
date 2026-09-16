import crypto from 'node:crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { supabaseServer } from './supabase.js';

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
