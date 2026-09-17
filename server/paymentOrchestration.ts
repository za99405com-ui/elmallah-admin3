import express, { NextFunction, Request, Response, Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth, requireRole, AuthenticatedRequest, logAuditAction } from './auth.js';
import { broadcastRealtimeEvent } from './realtime.js';
import { supabaseServer } from './supabase.js';

export const paymentRouter = Router();

type PaymentProvider = string;
type PaymentSessionStatus =
  | 'waiting'
  | 'paid'
  | 'expired'
  | 'expired_needs_review'
  | 'needs_review'
  | 'cancelled';
type ReviewReason =
  | 'no_match'
  | 'ambiguous'
  | 'underpaid'
  | 'late_payment'
  | 'expired_customer_contacted_support';

type RawBodyRequest = Request & { rawBody?: string };

const HEARTBEAT_FRESH_MS = 45_000;
const BRIDGE_SIGNATURE_MAX_SKEW_MS = 5 * 60_000;
const LATE_MATCH_WINDOW_MS = 15 * 60_000;
const nonceCache = new Map<string, number>();

interface SessionClient {
  id: string;
  res: Response;
}
const sessionClients = new Map<string, Map<string, SessionClient>>();

function safeCompare(a: string, b: string): boolean {
  const aa = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('20') && digits.length >= 12) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('1')) return `0${digits}`;
  return digits;
}

function normalizeProvider(value: unknown): string {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'vf_cash' || provider === 'vodafone_cash') return 'vf_cash';
  if (
    provider === 'bank_alahly' ||
    provider === 'nbe' ||
    provider === 'nbe_incoming_transfer' ||
    provider === 'bank_al_ahly'
  ) return 'bank_alahly';
  return provider;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSession(row: Record<string, any>) {
  return {
    id: row.id,
    orderId: row.order_id,
    customerId: row.customer_id || undefined,
    customerPhone: row.customer_phone || undefined,
    provider: row.provider,
    expectedAmount: Number(row.expected_amount),
    amountTolerance: Number(row.amount_tolerance || 0),
    currency: row.currency || 'EGP',
    deviceId: row.device_public_id || undefined,
    paymentDestination: row.payment_destination || undefined,
    status: row.status as PaymentSessionStatus,
    expiresAt: row.expires_at,
    contactedSupportAt: row.contacted_support_at || undefined,
    matchedAmount: row.matched_amount != null ? Number(row.matched_amount) : undefined,
    amountDifference: row.amount_difference != null ? Number(row.amount_difference) : undefined,
    payerPhone: row.payer_phone || undefined,
    paidAt: row.paid_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function pruneNonceCache(now = Date.now()) {
  for (const [key, timestamp] of nonceCache.entries()) {
    if (now - timestamp > BRIDGE_SIGNATURE_MAX_SKEW_MS) nonceCache.delete(key);
  }
}

async function verifyBridgeRequest(req: RawBodyRequest, res: Response, next: NextFunction) {
  const deviceId = req.header('X-Device-Id')?.trim();
  const timestampRaw = req.header('X-Timestamp')?.trim();
  const nonce = req.header('X-Nonce')?.trim();
  const bodyHash = req.header('X-Body-Hash')?.trim().toLowerCase();
  const signature = req.header('X-Signature')?.trim().toLowerCase();

  if (!deviceId || !timestampRaw || !nonce || !bodyHash || !signature) {
    return res.status(401).json({ error: 'Missing bridge authentication headers' });
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > BRIDGE_SIGNATURE_MAX_SKEW_MS) {
    return res.status(401).json({ error: 'Stale or invalid bridge timestamp' });
  }

  pruneNonceCache();
  const nonceKey = `${deviceId}:${nonce}`;
  if (nonceCache.has(nonceKey)) {
    return res.status(409).json({ error: 'Replay detected' });
  }

  const { data: device, error } = await supabaseServer
    .from('payment_devices')
    .select('*')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (error) return res.status(503).json({ error: 'Payment device service unavailable' });
  if (!device || !device.is_enabled) return res.status(401).json({ error: 'Unknown or disabled payment device' });

  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
  const calculatedBodyHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
  if (!safeCompare(calculatedBodyHash, bodyHash)) {
    return res.status(401).json({ error: 'Invalid bridge body hash' });
  }

  const calculatedSignature = crypto
    .createHmac('sha256', String(device.hmac_secret))
    .update(`${timestamp}.${nonce}.${rawBody}`, 'utf8')
    .digest('hex');

  if (!safeCompare(calculatedSignature, signature)) {
    return res.status(401).json({ error: 'Invalid bridge signature' });
  }

  nonceCache.set(nonceKey, Date.now());
  (req as any).paymentDevice = device;
  (req as any).bridgeNonce = nonce;
  (req as any).bridgeBodyHash = bodyHash;
  next();
}

async function expireSessions(): Promise<string[]> {
  const { data, error } = await supabaseServer.rpc('expire_payment_sessions');
  if (error) {
    console.error('[Payment Orchestration] Expiry sweep failed:', error.message);
    return [];
  }
  const ids = (data || []).map((row: any) => String(row.expired_session_id || row.id || '')).filter(Boolean);
  for (const id of ids) {
    const payload = { sessionId: id, status: 'expired', timestamp: new Date().toISOString() };
    broadcastSessionEvent(id, 'payment_session_updated', payload);
    broadcastRealtimeEvent('payment_session_updated', payload);
  }
  return ids;
}

async function releaseDeviceForSession(sessionId: string) {
  const { error } = await supabaseServer
    .from('payment_devices')
    .update({ is_busy: false, busy_session_id: null, updated_at: new Date().toISOString() })
    .eq('busy_session_id', sessionId);
  if (error) console.error('[Payment Orchestration] Device release failed:', error.message);
}

function broadcastSessionEvent(sessionId: string, event: string, data: unknown) {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [clientId, client] of clients.entries()) {
    try {
      client.res.write(payload);
    } catch {
      clients.delete(clientId);
    }
  }
  if (clients.size === 0) sessionClients.delete(sessionId);
}

async function createReviewItem(input: {
  reason: ReviewReason;
  sessionId?: string | null;
  eventId?: string | null;
  orderId?: string | null;
  expectedAmount?: number | null;
  receivedAmount?: number | null;
  amountDifference?: number | null;
  details?: Record<string, unknown>;
}) {
  const row = {
    reason: input.reason,
    status: 'open',
    session_id: input.sessionId || null,
    event_id: input.eventId || null,
    order_id: input.orderId || null,
    expected_amount: input.expectedAmount ?? null,
    received_amount: input.receivedAmount ?? null,
    amount_difference: input.amountDifference ?? null,
    details: input.details || {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseServer
    .from('payment_review_items')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    // Partial unique indexes make repeat webhook/event handling idempotent enough for the review queue.
    if (error.code !== '23505') console.error('[Payment Orchestration] Review insert failed:', error.message);
    return null;
  }

  broadcastRealtimeEvent('payment_review_created', data);
  return data;
}

async function markSessionNeedsReview(
  session: Record<string, any>,
  eventDbId: string | null,
  receivedAmount: number,
  amountDifference: number,
  payerPhone: string | null
) {
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from('payment_sessions')
    .update({
      status: 'needs_review',
      matched_event_id: eventDbId,
      matched_amount: receivedAmount,
      amount_difference: amountDifference,
      payer_phone: payerPhone,
      updated_at: now,
    })
    .eq('id', session.id)
    .select('*')
    .single();
  if (error) throw error;
  await releaseDeviceForSession(String(session.id));
  const mapped = mapSession(data);
  broadcastSessionEvent(String(session.id), 'payment_session_updated', mapped);
  broadcastRealtimeEvent('payment_session_updated', mapped);
  return data;
}

async function confirmOrderPayment(
  session: Record<string, any>,
  receivedAmount: number,
  provider: PaymentProvider,
  eventId: string
) {
  const { data: order, error: orderError } = await supabaseServer
    .from('orders')
    .select('id,total_amount,deposit_notes')
    .eq('id', session.order_id)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) return;

  const total = Number(order.total_amount || 0);
  const remaining = Math.max(0, Math.round((total - receivedAmount) * 100) / 100);
  const previousNotes = String(order.deposit_notes || '').trim();
  const auditNote = `تأكيد آلي من Payment Orchestration / event ${eventId} / فرق ${Number(session.amount_difference || 0).toFixed(2)} ج.م`;

  const { error } = await supabaseServer
    .from('orders')
    .update({
      deposit_status: 'confirmed',
      deposit_amount: receivedAmount,
      deposit_method: provider === 'vf_cash' ? 'vodafone_cash' : 'bank_transfer',
      deposit_confirmed_at: new Date().toISOString(),
      deposit_confirmed_by: 'payment-orchestration',
      deposit_notes: previousNotes ? `${previousNotes}\n${auditNote}` : auditNote,
      remaining_amount: remaining,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.order_id);

  if (error) throw error;
  broadcastRealtimeEvent('order_payment_confirmed', {
    orderId: session.order_id,
    sessionId: session.id,
    receivedAmount,
    provider,
  });
}

async function markSessionPaid(
  session: Record<string, any>,
  eventDbId: string,
  eventPublicId: string,
  receivedAmount: number,
  amountDifference: number,
  payerPhone: string | null,
  provider: PaymentProvider
) {
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from('payment_sessions')
    .update({
      status: 'paid',
      matched_event_id: eventDbId,
      matched_amount: receivedAmount,
      amount_difference: amountDifference,
      payer_phone: payerPhone,
      paid_at: now,
      updated_at: now,
    })
    .eq('id', session.id)
    .select('*')
    .single();
  if (error) throw error;

  await releaseDeviceForSession(String(session.id));
  const enriched = { ...data, amount_difference: amountDifference };
  await confirmOrderPayment(enriched, receivedAmount, provider, eventPublicId);

  const mapped = mapSession(enriched);
  broadcastSessionEvent(String(session.id), 'payment_confirmed', mapped);
  broadcastRealtimeEvent('payment_session_paid', mapped);
  return data;
}

// ==============================================================================
// Admin API
// ==============================================================================
paymentRouter.get('/admin/payments/settings', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabaseServer
    .from('store_settings')
    .select('default_payment_policy,payment_session_timeout_seconds,payment_amount_tolerance,deposit_required,deposit_type,deposit_value,minimum_deposit')
    .eq('id', 1)
    .maybeSingle();
  if (error) return res.status(503).json({ error: 'تعذر تحميل إعدادات الدفع' });
  if (!data) return res.status(404).json({ error: 'إعدادات المتجر غير موجودة' });
  return res.json({
    defaultPaymentPolicy: data.default_payment_policy || 'cod_allowed',
    sessionTimeoutSeconds: Number(data.payment_session_timeout_seconds || 120),
    amountTolerance: Number(data.payment_amount_tolerance || 10),
    depositRequired: Boolean(data.deposit_required || data.default_payment_policy === 'deposit_required'),
    depositType: data.deposit_type || 'fixed',
    depositValue: Number(data.deposit_value || 100),
    minimumDeposit: Number(data.minimum_deposit || 50),
  });
});

paymentRouter.put(
  '/admin/payments/settings',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const policy = req.body?.defaultPaymentPolicy;
    const timeout = Number(req.body?.sessionTimeoutSeconds);
    const tolerance = Number(req.body?.amountTolerance);
    const depositRequired = req.body?.depositRequired !== undefined ? Boolean(req.body.depositRequired) : undefined;
    const depositType = req.body?.depositType;
    const depositValue = req.body?.depositValue !== undefined ? Number(req.body.depositValue) : undefined;
    const minimumDeposit = req.body?.minimumDeposit !== undefined ? Number(req.body.minimumDeposit) : undefined;

    if (policy && !['cod_allowed', 'deposit_required'].includes(policy)) {
      return res.status(400).json({ error: 'سياسة الدفع الافتراضية غير صالحة' });
    }
    if (depositType && !['fixed', 'percentage'].includes(depositType)) {
      return res.status(400).json({ error: 'نوع العربون يجب أن يكون ثابت أو نسبة مئوية' });
    }
    if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 30 || timeout > 600)) {
      return res.status(400).json({ error: 'مهلة جلسة الدفع يجب أن تكون بين 30 و600 ثانية' });
    }
    if (tolerance !== undefined && (!Number.isFinite(tolerance) || tolerance < 0)) {
      return res.status(400).json({ error: 'هامش مطابقة المبلغ غير صالح' });
    }
    if (depositValue !== undefined && (!Number.isFinite(depositValue) || depositValue < 0)) {
      return res.status(400).json({ error: 'قيمة العربون غير صالحة' });
    }
    if (minimumDeposit !== undefined && (!Number.isFinite(minimumDeposit) || minimumDeposit < 0)) {
      return res.status(400).json({ error: 'الحد الأدنى للعربون غير صالح' });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (policy) updates.default_payment_policy = policy;
    if (timeout) updates.payment_session_timeout_seconds = timeout;
    if (tolerance !== undefined) updates.payment_amount_tolerance = tolerance;
    if (depositRequired !== undefined) {
      updates.deposit_required = depositRequired;
      if (depositRequired && !policy) updates.default_payment_policy = 'deposit_required';
    }
    if (depositType) updates.deposit_type = depositType;
    if (depositValue !== undefined) updates.deposit_value = depositValue;
    if (minimumDeposit !== undefined) updates.minimum_deposit = minimumDeposit;

    const { data: existing } = await supabaseServer.from('store_settings').select('*').eq('id', 1).maybeSingle();
    const { data, error } = await supabaseServer
      .from('store_settings')
      .update(updates)
      .eq('id', 1)
      .select('default_payment_policy,payment_session_timeout_seconds,payment_amount_tolerance,deposit_required,deposit_type,deposit_value,minimum_deposit')
      .single();
    if (error) return res.status(503).json({ error: 'تعذر حفظ إعدادات الدفع' });

    logAuditAction(req.admin, 'update_payment_settings', 'store_settings', '1', existing, data, req.ip);
    const result = {
      defaultPaymentPolicy: data.default_payment_policy,
      sessionTimeoutSeconds: Number(data.payment_session_timeout_seconds),
      amountTolerance: Number(data.payment_amount_tolerance),
      depositRequired: Boolean(data.deposit_required),
      depositType: data.deposit_type,
      depositValue: Number(data.deposit_value),
      minimumDeposit: Number(data.minimum_deposit),
    };
    broadcastRealtimeEvent('payment_settings_updated', result);
    return res.json(result);
  }
);

// ------------------------------------------------------------------------------
// Payment Sources CRUD
// ------------------------------------------------------------------------------
paymentRouter.get('/admin/payments/sources', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const [sourcesRes, deviceSourcesRes] = await Promise.all([
    supabaseServer
      .from('payment_sources')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true }),
    supabaseServer
      .from('payment_device_sources')
      .select('payment_source_id,enabled'),
  ]);

  if (sourcesRes.error) return res.status(503).json({ error: 'تعذر تحميل مصادر الدفع' });

  const deviceCounts = new Map<string, number>();
  for (const ds of deviceSourcesRes.data || []) {
    if (ds.enabled) {
      deviceCounts.set(ds.payment_source_id, (deviceCounts.get(ds.payment_source_id) || 0) + 1);
    }
  }

  const sources = (sourcesRes.data || []).map((s: any) => ({
    id: s.id,
    code: s.code,
    displayName: s.display_name,
    enabled: Boolean(s.enabled),
    channel: s.channel,
    destination: s.destination || null,
    parserType: s.parser_type || 'regex',
    sourcePackage: s.source_package || null,
    sourceSender: s.source_sender || null,
    titleContains: s.title_contains || null,
    bodyContains: s.body_contains || null,
    amountRegex: s.amount_regex || null,
    payerPhoneRegex: s.payer_phone_regex || null,
    accountIdentifierRegex: s.account_identifier_regex || null,
    priority: Number(s.priority ?? 100),
    notes: s.notes || null,
    activeDevicesCount: deviceCounts.get(s.id) || 0,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }));

  return res.json(sources);
});

paymentRouter.post(
  '/admin/payments/sources',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const code = String(req.body?.code || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const displayName = String(req.body?.displayName || '').trim();
    const channel = String(req.body?.channel || 'wallet').trim();

    if (!code || !displayName) {
      return res.status(400).json({ error: 'كود المصدر والاسم المعروض مطلوبان' });
    }

    const row = {
      code,
      display_name: displayName,
      channel,
      destination: req.body?.destination ? String(req.body.destination).trim() : null,
      enabled: req.body?.enabled !== false,
      parser_type: String(req.body?.parserType || 'regex').trim(),
      source_package: req.body?.sourcePackage ? String(req.body.sourcePackage).trim() : null,
      source_sender: req.body?.sourceSender ? String(req.body.sourceSender).trim() : null,
      title_contains: req.body?.titleContains ? String(req.body.titleContains).trim() : null,
      body_contains: req.body?.bodyContains ? String(req.body.bodyContains).trim() : null,
      amount_regex: req.body?.amountRegex ? String(req.body.amountRegex).trim() : null,
      payer_phone_regex: req.body?.payerPhoneRegex ? String(req.body.payerPhoneRegex).trim() : null,
      account_identifier_regex: req.body?.accountIdentifierRegex ? String(req.body.accountIdentifierRegex).trim() : null,
      priority: Number(req.body?.priority ?? 100),
      notes: req.body?.notes ? String(req.body.notes).trim() : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseServer.from('payment_sources').insert(row).select('*').single();
    if (error?.code === '23505') return res.status(409).json({ error: 'كود المصدر مستخدم بالفعل' });
    if (error) return res.status(503).json({ error: 'تعذر إنشاء مصدر الدفع' });

    logAuditAction(req.admin, 'create_payment_source', 'payment_source', data.id, null, row, req.ip);
    broadcastRealtimeEvent('payment_source_created', data);
    return res.status(201).json({
      id: data.id,
      code: data.code,
      displayName: data.display_name,
      enabled: Boolean(data.enabled),
      channel: data.channel,
      destination: data.destination,
      parserType: data.parser_type,
      priority: Number(data.priority),
    });
  }
);

paymentRouter.patch(
  '/admin/payments/sources/:id',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body?.displayName !== undefined) updates.display_name = String(req.body.displayName).trim();
    if (req.body?.enabled !== undefined) updates.enabled = Boolean(req.body.enabled);
    if (req.body?.channel !== undefined) updates.channel = String(req.body.channel).trim();
    if (req.body?.destination !== undefined) updates.destination = req.body.destination ? String(req.body.destination).trim() : null;
    if (req.body?.parserType !== undefined) updates.parser_type = String(req.body.parserType).trim();
    if (req.body?.sourcePackage !== undefined) updates.source_package = req.body.sourcePackage ? String(req.body.sourcePackage).trim() : null;
    if (req.body?.sourceSender !== undefined) updates.source_sender = req.body.sourceSender ? String(req.body.sourceSender).trim() : null;
    if (req.body?.titleContains !== undefined) updates.title_contains = req.body.titleContains ? String(req.body.titleContains).trim() : null;
    if (req.body?.bodyContains !== undefined) updates.body_contains = req.body.bodyContains ? String(req.body.bodyContains).trim() : null;
    if (req.body?.amountRegex !== undefined) updates.amount_regex = req.body.amountRegex ? String(req.body.amountRegex).trim() : null;
    if (req.body?.payerPhoneRegex !== undefined) updates.payer_phone_regex = req.body.payerPhoneRegex ? String(req.body.payerPhoneRegex).trim() : null;
    if (req.body?.accountIdentifierRegex !== undefined) updates.account_identifier_regex = req.body.accountIdentifierRegex ? String(req.body.accountIdentifierRegex).trim() : null;
    if (req.body?.priority !== undefined) updates.priority = Number(req.body.priority);
    if (req.body?.notes !== undefined) updates.notes = req.body.notes ? String(req.body.notes).trim() : null;

    const { data: existing, error: findError } = await supabaseServer
      .from('payment_sources')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (findError) return res.status(503).json({ error: 'تعذر فحص مصدر الدفع' });
    if (!existing) return res.status(404).json({ error: 'مصدر الدفع غير موجود' });

    const { data, error } = await supabaseServer
      .from('payment_sources')
      .update(updates)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) return res.status(503).json({ error: 'تعذر تحديث مصدر الدفع' });

    logAuditAction(req.admin, 'update_payment_source', 'payment_source', req.params.id, existing, updates, req.ip);
    broadcastRealtimeEvent('payment_source_updated', data);
    return res.json(data);
  }
);

paymentRouter.delete(
  '/admin/payments/sources/:id',
  requireAuth,
  requireRole(['super_admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    const { data: existing } = await supabaseServer.from('payment_sources').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'مصدر الدفع غير موجود' });

    // Protect legacy sources from hard deletion; soft-disable them instead
    if (['vf_cash', 'bank_alahly'].includes(existing.code)) {
      await supabaseServer.from('payment_sources').update({ enabled: false, updated_at: new Date().toISOString() }).eq('id', req.params.id);
      return res.json({ success: true, message: 'تم تعطيل المصدر الأساسي للحفاظ على التوافق التاريخي' });
    }

    const { error } = await supabaseServer.from('payment_sources').delete().eq('id', req.params.id);
    if (error) return res.status(503).json({ error: 'تعذر حذف مصدر الدفع' });

    logAuditAction(req.admin, 'delete_payment_source', 'payment_source', req.params.id, existing, null, req.ip);
    return res.json({ success: true });
  }
);

// ------------------------------------------------------------------------------
// Device ↔ Payment Source Assignments
// ------------------------------------------------------------------------------
paymentRouter.get('/admin/payments/devices/:id/sources', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabaseServer
    .from('payment_device_sources')
    .select('id,device_id,payment_source_id,enabled,created_at,payment_sources(*)')
    .eq('device_id', req.params.id);
  if (error) return res.status(503).json({ error: 'تعذر تحميل مصادر الجهاز' });
  return res.json(data || []);
});

paymentRouter.put(
  '/admin/payments/devices/:id/sources',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const deviceId = req.params.id;
    const sourceIds: string[] = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds : [];

    const { data: device } = await supabaseServer.from('payment_devices').select('*').eq('id', deviceId).maybeSingle();
    if (!device) return res.status(404).json({ error: 'الجهاز غير موجود' });

    // Clear existing assignments and set new ones
    await supabaseServer.from('payment_device_sources').delete().eq('device_id', deviceId);

    if (sourceIds.length > 0) {
      const rows = sourceIds.map((sid) => ({
        device_id: deviceId,
        payment_source_id: sid,
        enabled: true,
      }));
      await supabaseServer.from('payment_device_sources').insert(rows);
    }

    // Keep legacy boolean flags in sync
    const { data: sources } = await supabaseServer.from('payment_sources').select('id,code').in('id', sourceIds);
    const codes = new Set((sources || []).map((s: any) => s.code));
    const vfCashEnabled = codes.has('vf_cash');
    const bankAlAhlyEnabled = codes.has('bank_alahly');

    await supabaseServer
      .from('payment_devices')
      .update({
        vf_cash_enabled: vfCashEnabled,
        bank_alahly_enabled: bankAlAhlyEnabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deviceId);

    logAuditAction(req.admin, 'assign_device_sources', 'payment_device', deviceId, null, { sourceIds, vfCashEnabled, bankAlAhlyEnabled }, req.ip);
    return res.json({ success: true, assignedCount: sourceIds.length, vfCashEnabled, bankAlAhlyEnabled });
  }
);

// ------------------------------------------------------------------------------
// Customer Payment Methods Management
// ------------------------------------------------------------------------------
paymentRouter.get('/admin/payments/customer-methods', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const [methodsRes, methodSourcesRes] = await Promise.all([
    supabaseServer.from('customer_payment_methods').select('*').order('sort_order', { ascending: true }),
    supabaseServer.from('customer_payment_method_sources').select('customer_payment_method_id,payment_source_id,is_primary,payment_sources(*)'),
  ]);
  if (methodsRes.error) return res.status(503).json({ error: 'تعذر تحميل طرق الدفع للعملاء' });

  const methods = (methodsRes.data || []).map((m: any) => {
    const assignedSources = (methodSourcesRes.data || [])
      .filter((ms: any) => ms.customer_payment_method_id === m.id)
      .map((ms: any) => ({
        ...ms.payment_sources,
        isPrimary: ms.is_primary,
      }));
    return {
      id: m.id,
      code: m.code,
      displayName: m.display_name,
      enabled: Boolean(m.enabled),
      channel: m.channel,
      instructions: m.instructions || null,
      sortOrder: Number(m.sort_order || 0),
      sources: assignedSources,
      sourceIds: assignedSources.map((s: any) => s.id),
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    };
  });

  return res.json(methods);
});

paymentRouter.post(
  '/admin/payments/customer-methods',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const code = String(req.body?.code || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const displayName = String(req.body?.displayName || '').trim();
    const channel = String(req.body?.channel || 'other').trim();
    if (!code || !displayName) return res.status(400).json({ error: 'كود الطريقة والاسم مطلوبان' });

    const row = {
      code,
      display_name: displayName,
      enabled: req.body?.enabled !== false,
      channel,
      instructions: req.body?.instructions ? String(req.body.instructions).trim() : null,
      sort_order: Number(req.body?.sortOrder || 0),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseServer.from('customer_payment_methods').insert(row).select('*').single();
    if (error?.code === '23505') return res.status(409).json({ error: 'كود طريقة الدفع مستخدم بالفعل' });
    if (error) return res.status(503).json({ error: 'تعذر إنشاء طريقة الدفع' });

    const sourceIds: string[] = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds : [];
    if (sourceIds.length > 0) {
      await supabaseServer.from('customer_payment_method_sources').insert(
        sourceIds.map((sid, idx) => ({
          customer_payment_method_id: data.id,
          payment_source_id: sid,
          is_primary: idx === 0,
        }))
      );
    }

    logAuditAction(req.admin, 'create_customer_payment_method', 'customer_payment_method', data.id, null, { ...row, sourceIds }, req.ip);
    return res.status(201).json(data);
  }
);

paymentRouter.patch(
  '/admin/payments/customer-methods/:id',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body?.displayName !== undefined) updates.display_name = String(req.body.displayName).trim();
    if (req.body?.enabled !== undefined) updates.enabled = Boolean(req.body.enabled);
    if (req.body?.channel !== undefined) updates.channel = String(req.body.channel).trim();
    if (req.body?.instructions !== undefined) updates.instructions = req.body.instructions ? String(req.body.instructions).trim() : null;
    if (req.body?.sortOrder !== undefined) updates.sort_order = Number(req.body.sortOrder);

    const { data, error } = await supabaseServer
      .from('customer_payment_methods')
      .update(updates)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) return res.status(503).json({ error: 'تعذر تحديث طريقة الدفع' });

    if (Array.isArray(req.body?.sourceIds)) {
      await supabaseServer.from('customer_payment_method_sources').delete().eq('customer_payment_method_id', req.params.id);
      if (req.body.sourceIds.length > 0) {
        await supabaseServer.from('customer_payment_method_sources').insert(
          req.body.sourceIds.map((sid: string, idx: number) => ({
            customer_payment_method_id: req.params.id,
            payment_source_id: sid,
            is_primary: idx === 0,
          }))
        );
      }
    }

    return res.json(data);
  }
);

// ------------------------------------------------------------------------------
// Problem Orders Endpoint (طلبات تحتاج مراجعة)
// ------------------------------------------------------------------------------
paymentRouter.get('/admin/payments/problem-orders', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  // Query orders with pending deposits or linked to problematic payment reviews / sessions
  const [ordersRes, reviewsRes, sessionsRes] = await Promise.all([
    supabaseServer
      .from('orders')
      .select('id,order_number,status,deposit_status,deposit_amount,deposit_paid,total_amount,payment_mode,deposit_method,customer_name,customer_phone,created_at')
      .or('deposit_status.eq.pending,deposit_status.eq.rejected')
      .order('created_at', { ascending: false })
      .limit(150),
    supabaseServer
      .from('payment_review_items')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false }),
    supabaseServer
      .from('payment_sessions')
      .select('*')
      .in('status', ['needs_review', 'expired_needs_review'])
      .order('created_at', { ascending: false }),
  ]);

  const openReviews = reviewsRes.data || [];
  const problematicSessions = sessionsRes.data || [];
  const reviewMapByOrder = new Map<string, any>();
  const reviewMapBySession = new Map<string, any>();
  for (const r of openReviews) {
    if (r.order_id) reviewMapByOrder.set(r.order_id, r);
    if (r.session_id) reviewMapBySession.set(r.session_id, r);
  }

  // Combine and deduplicate problematic orders
  const problemMap = new Map<string, any>();

  // 1. Orders with deposit status pending or rejected
  for (const ord of ordersRes.data || []) {
    const linkedReview = reviewMapByOrder.get(ord.id);
    problemMap.set(ord.id, {
      id: ord.id,
      orderNumber: ord.order_number || ord.id,
      customerName: ord.customer_name || 'عميل غير مسجل',
      customerPhone: ord.customer_phone || '-',
      totalAmount: Number(ord.total_amount || 0),
      depositExpected: Number(ord.deposit_amount || 0),
      depositPaid: Number(ord.deposit_paid || 0),
      difference: Number(ord.deposit_paid || 0) - Number(ord.deposit_amount || 0),
      orderStatus: ord.status,
      depositStatus: ord.deposit_status,
      paymentMode: ord.payment_mode || 'deposit_online',
      paymentMethod: ord.deposit_method || 'electronic',
      problemReason: linkedReview ? linkedReview.reason : (ord.deposit_status === 'pending' ? 'بانتظار تأكيد العربون' : 'عربون مرفوض'),
      reviewId: linkedReview?.id || null,
      createdAt: ord.created_at,
    });
  }

  // 2. Open reviews with an orderId not already included
  for (const r of openReviews) {
    if (r.order_id && !problemMap.has(r.order_id)) {
      problemMap.set(r.order_id, {
        id: r.order_id,
        orderNumber: r.order_id,
        customerName: r.customer_name || 'عميل غير مسجل',
        customerPhone: r.customer_phone || '-',
        totalAmount: Number(r.expected_amount || 0),
        depositExpected: Number(r.expected_amount || 0),
        depositPaid: Number(r.received_amount || 0),
        difference: Number(r.amount_difference || 0),
        orderStatus: 'pending',
        depositStatus: 'pending',
        paymentMode: 'deposit_online',
        paymentMethod: 'electronic',
        problemReason: r.reason,
        reviewId: r.id,
        sessionId: r.session_id || null,
        createdAt: r.created_at,
      });
    }
  }

  const problemOrders = Array.from(problemMap.values());
  return res.json(problemOrders);
});

// ------------------------------------------------------------------------------
// Comprehensive Overview Endpoint
// ------------------------------------------------------------------------------
paymentRouter.get('/admin/payments/overview', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  await expireSessions();
  const [
    devicesResult,
    deviceSourcesResult,
    sourcesResult,
    customerMethodsResult,
    reviewsResult,
    sessionsResult,
    settingsResult,
    problemOrdersRes,
  ] = await Promise.all([
    supabaseServer
      .from('payment_devices')
      .select('id,device_id,name,payment_destination,is_enabled,vf_cash_enabled,bank_alahly_enabled,online,internet_connected,app_running,notification_listener_enabled,is_busy,busy_session_id,last_heartbeat_at,last_event_at,app_version,created_at,updated_at')
      .order('created_at', { ascending: true }),
    supabaseServer
      .from('payment_device_sources')
      .select('device_id,payment_source_id,enabled,payment_sources(*)'),
    supabaseServer
      .from('payment_sources')
      .select('*')
      .order('priority', { ascending: false }),
    supabaseServer
      .from('customer_payment_methods')
      .select('*')
      .order('sort_order', { ascending: true }),
    supabaseServer
      .from('payment_review_items')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseServer
      .from('payment_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseServer
      .from('store_settings')
      .select('default_payment_policy,payment_session_timeout_seconds,payment_amount_tolerance,deposit_required,deposit_type,deposit_value,minimum_deposit')
      .eq('id', 1)
      .maybeSingle(),
    supabaseServer
      .from('orders')
      .select('id,order_number,status,deposit_status,deposit_amount,deposit_paid,total_amount,payment_mode,deposit_method,customer_name,customer_phone,created_at')
      .or('deposit_status.eq.pending,deposit_status.eq.rejected')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const failed = [devicesResult, reviewsResult, sessionsResult, settingsResult].find((r) => r.error);
  if (failed?.error) return res.status(503).json({ error: 'تعذر تحميل مركز مراجعة المدفوعات' });

  const now = Date.now();

  // Attach sources to devices
  const deviceSourcesMap = new Map<string, any[]>();
  for (const ds of deviceSourcesResult.data || []) {
    if (ds.enabled && ds.payment_sources) {
      const list = deviceSourcesMap.get(ds.device_id) || [];
      list.push(ds.payment_sources);
      deviceSourcesMap.set(ds.device_id, list);
    }
  }

  const devices = (devicesResult.data || []).map((d: any) => {
    const assignedSources = deviceSourcesMap.get(d.id) || [];
    return {
      id: d.id,
      deviceId: d.device_id,
      name: d.name,
      paymentDestination: d.payment_destination,
      isEnabled: Boolean(d.is_enabled),
      vfCashEnabled: Boolean(d.vf_cash_enabled),
      bankAlAhlyEnabled: Boolean(d.bank_alahly_enabled),
      online: Boolean(d.online) && d.last_heartbeat_at && now - new Date(d.last_heartbeat_at).getTime() <= HEARTBEAT_FRESH_MS,
      internetConnected: Boolean(d.internet_connected),
      appRunning: Boolean(d.app_running),
      notificationListenerEnabled: Boolean(d.notification_listener_enabled),
      busy: Boolean(d.is_busy),
      busySessionId: d.busy_session_id || undefined,
      lastHeartbeatAt: d.last_heartbeat_at || undefined,
      lastEventAt: d.last_event_at || undefined,
      appVersion: d.app_version || undefined,
      sources: assignedSources,
      assignedSourceIds: assignedSources.map((s: any) => s.id),
    };
  });

  const sources = (sourcesResult.data || []).map((s: any) => ({
    id: s.id,
    code: s.code,
    displayName: s.display_name,
    enabled: Boolean(s.enabled),
    channel: s.channel,
    destination: s.destination || null,
    priority: Number(s.priority ?? 100),
    parserType: s.parser_type || 'regex',
    sourceSender: s.source_sender || null,
    sourcePackage: s.source_package || null,
    titleContains: s.title_contains || null,
    bodyContains: s.body_contains || null,
    amountRegex: s.amount_regex || null,
    payerPhoneRegex: s.payer_phone_regex || null,
    accountIdentifierRegex: s.account_identifier_regex || null,
    notes: s.notes || null,
  }));

  const customerMethods = (customerMethodsResult.data || []).map((m: any) => ({
    id: m.id,
    code: m.code,
    displayName: m.display_name,
    enabled: Boolean(m.enabled),
    channel: m.channel,
    instructions: m.instructions || null,
    sortOrder: Number(m.sort_order || 0),
  }));

  const problemOrders = (problemOrdersRes.data || []).map((ord: any) => ({
    id: ord.id,
    orderNumber: ord.order_number || ord.id,
    customerName: ord.customer_name || 'عميل غير مسجل',
    customerPhone: ord.customer_phone || '-',
    totalAmount: Number(ord.total_amount || 0),
    depositExpected: Number(ord.deposit_amount || 0),
    depositPaid: Number(ord.deposit_paid || 0),
    difference: Number(ord.deposit_paid || 0) - Number(ord.deposit_amount || 0),
    orderStatus: ord.status,
    depositStatus: ord.deposit_status,
    paymentMode: ord.payment_mode || 'deposit_online',
    paymentMethod: ord.deposit_method || 'electronic',
    problemReason: ord.deposit_status === 'pending' ? 'بانتظار تأكيد العربون' : 'عربون مرفوض',
    createdAt: ord.created_at,
  }));

  return res.json({
    devices,
    sources,
    customerMethods,
    reviews: reviewsResult.data || [],
    sessions: (sessionsResult.data || []).map((s: any) => mapSession(s)),
    problemOrders,
    settings: {
      defaultPaymentPolicy: settingsResult.data?.default_payment_policy || 'cod_allowed',
      sessionTimeoutSeconds: Number(settingsResult.data?.payment_session_timeout_seconds || 120),
      amountTolerance: Number(settingsResult.data?.payment_amount_tolerance || 10),
      depositRequired: Boolean(settingsResult.data?.deposit_required || settingsResult.data?.default_payment_policy === 'deposit_required'),
      depositType: settingsResult.data?.deposit_type || 'fixed',
      depositValue: Number(settingsResult.data?.deposit_value || 100),
      minimumDeposit: Number(settingsResult.data?.minimum_deposit || 50),
    },
  });
});

paymentRouter.post(
  '/admin/payments/devices',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const deviceId = String(req.body?.deviceId || '').trim();
    const name = String(req.body?.name || '').trim();
    const paymentDestination = String(req.body?.paymentDestination || '').trim();
    if (!deviceId || !name || !paymentDestination) {
      return res.status(400).json({ error: 'معرّف الجهاز والاسم ورقم/حساب التحصيل مطلوبة' });
    }

    const provisioningSecret = String(req.body?.provisioningSecret || '').trim() || crypto.randomBytes(32).toString('hex');
    if (provisioningSecret.length < 32) {
      return res.status(400).json({ error: 'مفتاح HMAC يجب ألا يقل عن 32 حرفاً' });
    }

    const row = {
      device_id: deviceId,
      name,
      payment_destination: paymentDestination,
      hmac_secret: provisioningSecret,
      is_enabled: req.body?.isEnabled !== false,
      vf_cash_enabled: Boolean(req.body?.vfCashEnabled),
      bank_alahly_enabled: Boolean(req.body?.bankAlAhlyEnabled),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseServer.from('payment_devices').insert(row).select('*').single();
    if (error?.code === '23505') return res.status(409).json({ error: 'هذا الجهاز مسجل بالفعل' });
    if (error) return res.status(503).json({ error: 'تعذر تسجيل جهاز الدفع' });

    logAuditAction(req.admin, 'create_payment_device', 'payment_device', data.id, null, { ...row, hmac_secret: '[REDACTED]' }, req.ip);
    return res.status(201).json({
      device: {
        id: data.id,
        deviceId: data.device_id,
        name: data.name,
        paymentDestination: data.payment_destination,
        vfCashEnabled: data.vf_cash_enabled,
        bankAlAhlyEnabled: data.bank_alahly_enabled,
      },
      provisioningSecret,
      warning: 'يظهر مفتاح التهيئة مرة واحدة فقط. أدخله في تطبيق Payment Bridge على هذا الهاتف.',
    });
  }
);

paymentRouter.patch(
  '/admin/payments/devices/:id',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body?.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body?.paymentDestination !== undefined) updates.payment_destination = String(req.body.paymentDestination).trim();
    if (req.body?.isEnabled !== undefined) updates.is_enabled = Boolean(req.body.isEnabled);
    if (req.body?.vfCashEnabled !== undefined) updates.vf_cash_enabled = Boolean(req.body.vfCashEnabled);
    if (req.body?.bankAlAhlyEnabled !== undefined) updates.bank_alahly_enabled = Boolean(req.body.bankAlAhlyEnabled);
    if (req.body?.provisioningSecret !== undefined) {
      const secret = String(req.body.provisioningSecret).trim();
      if (secret.length < 32) return res.status(400).json({ error: 'مفتاح HMAC يجب ألا يقل عن 32 حرفاً' });
      updates.hmac_secret = secret;
    }

    const { data: existing, error: lookupError } = await supabaseServer
      .from('payment_devices').select('*').eq('id', req.params.id).maybeSingle();
    if (lookupError) return res.status(503).json({ error: 'تعذر تحميل جهاز الدفع' });
    if (!existing) return res.status(404).json({ error: 'جهاز الدفع غير موجود' });

    const { data, error } = await supabaseServer
      .from('payment_devices')
      .update(updates)
      .eq('id', req.params.id)
      .select('id,device_id,name,payment_destination,is_enabled,vf_cash_enabled,bank_alahly_enabled,online,internet_connected,app_running,notification_listener_enabled,is_busy,busy_session_id,last_heartbeat_at,last_event_at,app_version,updated_at')
      .single();
    if (error) return res.status(503).json({ error: 'تعذر تحديث جهاز الدفع' });

    const auditUpdates = { ...updates } as Record<string, unknown>;
    if ('hmac_secret' in auditUpdates) auditUpdates.hmac_secret = '[REDACTED]';
    logAuditAction(req.admin, 'update_payment_device', 'payment_device', req.params.id, existing, auditUpdates, req.ip);
    broadcastRealtimeEvent('payment_device_updated', data);
    return res.json(data);
  }
);

paymentRouter.post(
  '/admin/payments/review/:id/resolve',
  requireAuth,
  requireRole(['super_admin', 'manager', 'operator']),
  async (req: AuthenticatedRequest, res: Response) => {
    const action = String(req.body?.action || '').trim();
    if (!['confirm_paid', 'dismiss', 'cancel_session'].includes(action)) {
      return res.status(400).json({ error: 'إجراء المراجعة غير صالح' });
    }

    const { data: review, error } = await supabaseServer
      .from('payment_review_items').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(503).json({ error: 'تعذر تحميل حالة المراجعة' });
    if (!review) return res.status(404).json({ error: 'حالة المراجعة غير موجودة' });
    if (review.status !== 'open') return res.status(409).json({ error: 'تم التعامل مع هذه الحالة مسبقاً' });

    if (action === 'confirm_paid') {
      if (!review.session_id) return res.status(400).json({ error: 'لا توجد جلسة مرتبطة يمكن تأكيدها' });
      const { data: session, error: sessionError } = await supabaseServer
        .from('payment_sessions').select('*').eq('id', review.session_id).maybeSingle();
      if (sessionError || !session) return res.status(503).json({ error: 'تعذر تحميل جلسة الدفع' });
      const received = Number(review.received_amount ?? session.matched_amount ?? session.expected_amount);
      const difference = received - Number(session.expected_amount);
      const provider = normalizeProvider(session.provider)!;
      const eventPublicId = review.event_id ? `review-${review.event_id}` : `manual-${review.id}`;
      const eventDbId = review.event_id || session.matched_event_id || crypto.randomUUID();

      if (review.event_id || session.matched_event_id) {
        await markSessionPaid(session, String(eventDbId), eventPublicId, received, difference, session.payer_phone || null, provider);
      } else {
        const now = new Date().toISOString();
        const { data: paid, error: paidError } = await supabaseServer
          .from('payment_sessions')
          .update({ status: 'paid', matched_amount: received, amount_difference: difference, paid_at: now, updated_at: now })
          .eq('id', session.id).select('*').single();
        if (paidError) return res.status(503).json({ error: 'تعذر تأكيد الجلسة' });
        await releaseDeviceForSession(String(session.id));
        await confirmOrderPayment({ ...paid, amount_difference: difference }, received, provider, eventPublicId);
        broadcastSessionEvent(String(session.id), 'payment_confirmed', mapSession(paid));
      }
    } else if (action === 'cancel_session' && review.session_id) {
      const now = new Date().toISOString();
      await supabaseServer
        .from('payment_sessions')
        .update({ status: 'cancelled', cancelled_at: now, cancellation_reason: 'admin_review', updated_at: now })
        .eq('id', review.session_id)
        .neq('status', 'paid');
      await releaseDeviceForSession(String(review.session_id));
      broadcastSessionEvent(String(review.session_id), 'payment_session_updated', { sessionId: review.session_id, status: 'cancelled' });
    }

    const finalStatus = action === 'dismiss' ? 'dismissed' : 'resolved';
    const { data: resolved, error: resolveError } = await supabaseServer
      .from('payment_review_items')
      .update({
        status: finalStatus,
        resolution: String(req.body?.notes || action),
        resolved_by: req.admin?.id || req.admin?.email || 'admin',
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', review.id)
      .select('*')
      .single();
    if (resolveError) return res.status(503).json({ error: 'تعذر إغلاق حالة المراجعة' });

    logAuditAction(req.admin, 'resolve_payment_review', 'payment_review_item', review.id, review, resolved, req.ip);
    broadcastRealtimeEvent('payment_review_resolved', resolved);
    return res.json(resolved);
  }
);

// ==============================================================================
// Customer-store integration API (server-to-server create/cancel)
// ==============================================================================
paymentRouter.post('/payments/sessions', requireIntegrationKey, async (req: Request, res: Response) => {
  await expireSessions();

  const orderId = String(req.body?.orderId || '').trim();
  const sourceId = req.body?.paymentSourceId ? String(req.body.paymentSourceId).trim() : null;
  const rawProvider = String(req.body?.provider || '').trim();
  let provider = normalizeProvider(rawProvider);

  // Resolve dynamic payment source
  let resolvedSource: any = null;
  if (sourceId) {
    const { data: src } = await supabaseServer.from('payment_sources').select('*').eq('id', sourceId).maybeSingle();
    resolvedSource = src;
    if (src) provider = src.code;
  } else if (provider) {
    const { data: src } = await supabaseServer.from('payment_sources').select('*').eq('code', provider).maybeSingle();
    resolvedSource = src;
  }

  const expectedAmount = Number(req.body?.expectedAmount);
  const customerId = req.body?.customerId ? String(req.body.customerId) : null;
  const customerPhone = normalizePhone(req.body?.customerPhone);

  if (!orderId) return res.status(400).json({ error: 'orderId is required' });
  if (!provider) return res.status(400).json({ error: 'Unsupported payment provider' });
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return res.status(400).json({ error: 'expectedAmount must be a positive number' });
  }

  const { data: order, error: orderError } = await supabaseServer
    .from('orders')
    .select('id,status,customer_id,customer_phone')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) return res.status(503).json({ error: 'Order service unavailable' });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'cancelled') return res.status(409).json({ error: 'Cancelled order cannot start payment' });

  const { data: existing } = await supabaseServer
    .from('payment_sessions')
    .select('*')
    .eq('order_id', orderId)
    .eq('provider', provider)
    .eq('status', 'waiting')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return res.json({ ...mapSession(existing), clientToken: existing.client_token });
  }

  const { data: settings, error: settingsError } = await supabaseServer
    .from('store_settings')
    .select('payment_session_timeout_seconds,payment_amount_tolerance')
    .eq('id', 1)
    .maybeSingle();
  if (settingsError) return res.status(503).json({ error: 'Payment settings unavailable' });

  const timeoutSeconds = Number(settings?.payment_session_timeout_seconds || 120);
  const tolerance = Number(settings?.payment_amount_tolerance || 10);
  const sessionId = crypto.randomUUID();
  const clientToken = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + timeoutSeconds * 1000);

  const { data: session, error: insertError } = await supabaseServer
    .from('payment_sessions')
    .insert({
      id: sessionId,
      client_token: clientToken,
      order_id: orderId,
      customer_id: customerId || order.customer_id || null,
      customer_phone: customerPhone || normalizePhone(order.customer_phone),
      provider,
      payment_source_id: resolvedSource?.id || null,
      expected_amount: Math.round(expectedAmount * 100) / 100,
      amount_tolerance: tolerance,
      status: 'waiting',
      expires_at: expiresAt.toISOString(),
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
    })
    .select('*')
    .single();
  if (insertError) return res.status(503).json({ error: 'Could not create payment session' });

  const { data: reserved, error: reserveError } = await supabaseServer.rpc('reserve_payment_device', {
    p_session_id: sessionId,
    p_provider: resolvedSource?.id || provider,
  });

  if (reserveError || !reserved || reserved.length === 0) {
    await supabaseServer.from('payment_sessions').delete().eq('id', sessionId);
    return res.status(503).json({
      error: 'no_payment_device_available',
      message: 'لا يوجد جهاز دفع متاح ومستوفي شروط الاتصال حالياً',
    });
  }

  const { data: complete, error: reloadError } = await supabaseServer
    .from('payment_sessions').select('*').eq('id', sessionId).single();
  if (reloadError) return res.status(503).json({ error: 'Payment session reservation failed' });

  const result = { ...mapSession(complete), clientToken, timeoutSeconds };
  broadcastRealtimeEvent('payment_session_created', mapSession(complete));
  return res.status(201).json(result);
});

paymentRouter.post('/payments/sessions/:id/cancel', requireIntegrationKey, async (req: Request, res: Response) => {
  const { data: session, error } = await supabaseServer
    .from('payment_sessions').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(503).json({ error: 'Payment session service unavailable' });
  if (!session) return res.status(404).json({ error: 'Payment session not found' });
  if (session.status === 'paid') return res.status(409).json({ error: 'Paid session cannot be cancelled' });

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseServer
    .from('payment_sessions')
    .update({ status: 'cancelled', cancelled_at: now, cancellation_reason: String(req.body?.reason || 'customer_cancelled'), updated_at: now })
    .eq('id', session.id).select('*').single();
  if (updateError) return res.status(503).json({ error: 'Could not cancel payment session' });
  await releaseDeviceForSession(String(session.id));
  const mapped = mapSession(updated);
  broadcastSessionEvent(String(session.id), 'payment_session_updated', mapped);
  broadcastRealtimeEvent('payment_session_updated', mapped);
  return res.json(mapped);
});

// ==============================================================================
// Customer-facing session status + realtime stream. clientToken is a scoped,
// unguessable capability token; integration/API secrets are never exposed.
// ==============================================================================
async function loadClientSession(req: Request, res: Response): Promise<Record<string, any> | null> {
  await expireSessions();
  const token = String(req.query.token || req.header('X-Payment-Session-Token') || '').trim();
  if (!token) {
    res.status(401).json({ error: 'Payment session token required' });
    return null;
  }
  const { data, error } = await supabaseServer
    .from('payment_sessions')
    .select('*')
    .eq('id', req.params.id)
    .eq('client_token', token)
    .maybeSingle();
  if (error) {
    res.status(503).json({ error: 'Payment session service unavailable' });
    return null;
  }
  if (!data) {
    res.status(404).json({ error: 'Payment session not found' });
    return null;
  }
  return data;
}

paymentRouter.get('/payments/sessions/:id/status', async (req: Request, res: Response) => {
  const session = await loadClientSession(req, res);
  if (!session) return;
  return res.json(mapSession(session));
});

paymentRouter.get('/payments/sessions/:id/events', async (req: Request, res: Response) => {
  const session = await loadClientSession(req, res);
  if (!session) return;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sessionId = String(session.id);
  const clientId = crypto.randomUUID();
  let clients = sessionClients.get(sessionId);
  if (!clients) {
    clients = new Map();
    sessionClients.set(sessionId, clients);
  }
  clients.set(clientId, { id: clientId, res });

  res.write(`: padding ${' '.repeat(2048)}\n\n`);
  res.write(`event: payment_session_updated\ndata: ${JSON.stringify(mapSession(session))}\n\n`);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 15_000);

  req.on('close', () => {
    clearInterval(ping);
    const current = sessionClients.get(sessionId);
    current?.delete(clientId);
    if (current?.size === 0) sessionClients.delete(sessionId);
  });
});

paymentRouter.post('/payments/sessions/:id/contact-support', async (req: Request, res: Response) => {
  const session = await loadClientSession(req, res);
  if (!session) return;

  const expired = new Date(session.expires_at).getTime() <= Date.now();
  if (!expired && session.status === 'waiting') {
    return res.status(409).json({ error: 'Payment session has not expired yet' });
  }
  if (session.status === 'paid' || session.status === 'cancelled') {
    return res.status(409).json({ error: `Session is already ${session.status}` });
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabaseServer
    .from('payment_sessions')
    .update({ status: 'expired_needs_review', contacted_support_at: now, updated_at: now })
    .eq('id', session.id)
    .select('*')
    .single();
  if (error) return res.status(503).json({ error: 'Could not flag session for support review' });

  await releaseDeviceForSession(String(session.id));
  await createReviewItem({
    reason: 'expired_customer_contacted_support',
    sessionId: String(session.id),
    orderId: String(session.order_id),
    expectedAmount: Number(session.expected_amount),
    details: { contactedAt: now, previousStatus: session.status },
  });

  const mapped = mapSession(updated);
  broadcastSessionEvent(String(session.id), 'payment_session_updated', mapped);
  broadcastRealtimeEvent('payment_session_updated', mapped);
  return res.json(mapped);
});

// ==============================================================================
// Payment Bridge API. The bridge reports facts; admin3 decides matching/status.
// ==============================================================================
paymentRouter.get('/payment-bridge/health', (_req: Request, res: Response) => {
  return res.json({ status: 'ok', version: 'phase2', serverTime: Date.now() });
});

paymentRouter.post('/payment-bridge/heartbeat', verifyBridgeRequest, async (req: RawBodyRequest, res: Response) => {
  const device = (req as any).paymentDevice;
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from('payment_devices')
    .update({
      online: true,
      internet_connected: req.body?.internetConnected !== false,
      app_running: req.body?.appRunning !== false,
      notification_listener_enabled: Boolean(req.body?.notificationListenerEnabled),
      vf_cash_enabled: Boolean(req.body?.vfCashEnabled),
      bank_alahly_enabled: Boolean(req.body?.bankAlAhlyEnabled),
      app_version: req.body?.appVersion ? String(req.body.appVersion) : null,
      last_heartbeat_at: now,
      updated_at: now,
    })
    .eq('id', device.id)
    .select('device_id,is_busy,busy_session_id,last_heartbeat_at,vf_cash_enabled,bank_alahly_enabled')
    .single();
  if (error) return res.status(503).json({ error: 'Heartbeat could not be stored' });

  const result = {
    status: 'ok',
    online: true,
    busy: Boolean(data.is_busy),
    busySessionId: data.busy_session_id || null,
    vfCashEnabled: Boolean(data.vf_cash_enabled),
    bankAlAhlyEnabled: Boolean(data.bank_alahly_enabled),
    serverTime: Date.now(),
  };
  broadcastRealtimeEvent('payment_device_heartbeat', { deviceId: data.device_id, ...result });
  return res.json(result);
});

paymentRouter.post('/payment-bridge/events', verifyBridgeRequest, async (req: RawBodyRequest, res: Response) => {
  const device = (req as any).paymentDevice;
  const reportedDeviceId = String(req.body?.deviceId || '').trim();
  if (!reportedDeviceId || reportedDeviceId !== device.device_id) {
    return res.status(400).json({ error: 'deviceId does not match authenticated device' });
  }

  const eventId = String(req.body?.eventId || '').trim();
  const provider = normalizeProvider(req.body?.provider);
  const amountMinor = Number(req.body?.amountMinor);
  const capturedAtMs = Number(req.body?.capturedAt);
  if (!eventId || !provider || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !Number.isFinite(capturedAtMs)) {
    return res.status(400).json({ error: 'Invalid payment event payload' });
  }

  const { data: duplicate, error: duplicateError } = await supabaseServer
    .from('payment_bridge_events')
    .select('event_id,match_status,matched_session_id')
    .eq('event_id', eventId)
    .maybeSingle();
  if (duplicateError) return res.status(503).json({ error: 'Payment event service unavailable' });
  if (duplicate) {
    return res.json({
      status: 'duplicate',
      eventId,
      matchStatus: duplicate.match_status,
      orderId: null,
      message: 'Event already processed',
      serverTimestamp: Date.now(),
    });
  }

  const capturedAt = new Date(capturedAtMs);
  if (Number.isNaN(capturedAt.getTime())) return res.status(400).json({ error: 'Invalid capturedAt timestamp' });
  const notificationPostedAtMs = numberOrNull(req.body?.notificationPostedAt);
  const notificationPostedAt = notificationPostedAtMs ? new Date(notificationPostedAtMs) : null;
  const receivedAmount = Math.round((amountMinor / 100) * 100) / 100;
  const payerPhone = normalizePhone(req.body?.payerPhone);

  // Resolve payment source if provided or by provider code
  let resolvedSource: any = null;
  if (req.body?.paymentSourceId) {
    const { data: src } = await supabaseServer
      .from('payment_sources')
      .select('*')
      .eq('id', req.body.paymentSourceId)
      .maybeSingle();
    resolvedSource = src;
  }
  if (!resolvedSource && provider) {
    const { data: src } = await supabaseServer
      .from('payment_sources')
      .select('*')
      .eq('code', provider)
      .maybeSingle();
    resolvedSource = src;
  }

  const eventInsert = {
    event_id: eventId,
    device_id: device.id,
    reported_device_id: reportedDeviceId,
    provider,
    payment_source_id: resolvedSource?.id || null,
    payment_channel: String(req.body?.paymentChannel || resolvedSource?.channel || provider),
    amount_minor: amountMinor,
    currency: String(req.body?.currency || 'EGP'),
    payer_phone: payerPhone,
    wallet_phone: normalizePhone(req.body?.walletPhone),
    transaction_reference: req.body?.transactionReference ? String(req.body.transactionReference) : null,
    account_last4: req.body?.accountLast4 ? String(req.body.accountLast4) : null,
    source_sender: req.body?.sourceSender ? String(req.body.sourceSender) : null,
    source_package: req.body?.sourcePackage ? String(req.body.sourcePackage) : null,
    notification_posted_at: notificationPostedAt && !Number.isNaN(notificationPostedAt.getTime()) ? notificationPostedAt.toISOString() : null,
    captured_at: capturedAt.toISOString(),
    parser_version: req.body?.parserVersion ? String(req.body.parserVersion) : null,
    parse_confidence: req.body?.parseConfidence ? String(req.body.parseConfidence) : null,
    raw_message_hash: req.body?.rawMessageHash ? String(req.body.rawMessageHash) : null,
    request_nonce: (req as any).bridgeNonce,
    body_hash: (req as any).bridgeBodyHash,
    match_status: 'received',
  };

  const { data: eventRow, error: insertError } = await supabaseServer
    .from('payment_bridge_events')
    .insert(eventInsert)
    .select('*')
    .single();
  if (insertError) return res.status(503).json({ error: 'Could not store payment event' });

  await supabaseServer
    .from('payment_devices')
    .update({ last_event_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', device.id);

  // Authoritative active reservation check
  let candidates: Record<string, any>[] = [];
  let activeMatches = false;

  if (device.busy_session_id) {
    const { data: activeSession } = await supabaseServer
      .from('payment_sessions')
      .select('*')
      .eq('id', device.busy_session_id)
      .in('status', ['waiting', 'expired', 'expired_needs_review', 'needs_review'])
      .maybeSingle();

    if (activeSession) {
      const created = new Date(activeSession.created_at).getTime();
      const expires = new Date(activeSession.expires_at).getTime();
      const providerMatches =
        normalizeProvider(activeSession.provider) === provider ||
        (resolvedSource && activeSession.payment_source_id === resolvedSource.id);

      if (providerMatches && capturedAtMs >= created - 15_000 && capturedAtMs <= expires + LATE_MATCH_WINDOW_MS) {
        candidates = [activeSession];
        activeMatches = true;
      }
    }
  }

  // Fallback: search recent historical sessions for this device
  if (!activeMatches) {
    const lowerBound = new Date(capturedAt.getTime() - LATE_MATCH_WINDOW_MS).toISOString();
    const { data, error } = await supabaseServer
      .from('payment_sessions')
      .select('*')
      .eq('device_id', device.id)
      .in('status', ['waiting', 'expired', 'expired_needs_review', 'needs_review'])
      .lte('created_at', new Date(capturedAt.getTime() + 15_000).toISOString())
      .gte('expires_at', lowerBound)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) return res.status(503).json({ error: 'Payment matching service unavailable' });

    candidates = (data || []).filter((session: any) => {
      const providerMatches =
        normalizeProvider(session.provider) === provider ||
        (resolvedSource && session.payment_source_id === resolvedSource.id);
      if (!providerMatches) return false;
      const created = new Date(session.created_at).getTime();
      const expires = new Date(session.expires_at).getTime();
      return capturedAtMs >= created - 15_000 && capturedAtMs <= expires + LATE_MATCH_WINDOW_MS;
    });
  }

  if (candidates.length === 0) {
    await supabaseServer
      .from('payment_bridge_events')
      .update({ match_status: 'no_match', processing_notes: { reason: 'no_session_on_reserved_device_time_window' } })
      .eq('id', eventRow.id);
    await createReviewItem({
      reason: 'no_match',
      eventId: eventRow.id,
      receivedAmount,
      details: { deviceId: device.device_id, provider, capturedAt: capturedAt.toISOString() },
    });
    return res.json({ status: 'accepted', eventId, matchStatus: 'NO_MATCH', message: 'Queued for review', serverTimestamp: Date.now() });
  }

  // If the reserved session is known, it wins. Otherwise evaluate approximate
  // amount + time + optional VF-Cash payer phone without transaction reference.
  let chosen = candidates[0];
  if (!device.busy_session_id && candidates.length > 1) {
    const plausible = candidates
      .map((session) => {
        const expected = Number(session.expected_amount);
        const tolerance = Number(session.amount_tolerance || 0);
        const diff = receivedAmount - expected;
        const absDiff = Math.abs(diff);
        const phone = normalizePhone(session.customer_phone);
        const phoneBoost = provider === 'vf_cash' && payerPhone && phone && payerPhone === phone ? 10_000 : 0;
        const timeDistance = Math.abs(capturedAtMs - new Date(session.created_at).getTime());
        const amountScore = absDiff <= tolerance || diff < 0 ? Math.max(0, 5_000 - absDiff * 100) : 0;
        return { session, score: phoneBoost + amountScore - timeDistance / 1000, absDiff, tolerance };
      })
      .sort((a, b) => b.score - a.score);

    if (plausible.length > 1 && Math.abs(plausible[0].score - plausible[1].score) < 300) {
      await supabaseServer
        .from('payment_bridge_events')
        .update({
          match_status: 'ambiguous',
          processing_notes: { candidateSessionIds: plausible.slice(0, 5).map((p) => p.session.id) },
        })
        .eq('id', eventRow.id);
      await createReviewItem({
        reason: 'ambiguous',
        eventId: eventRow.id,
        receivedAmount,
        details: { candidateSessionIds: plausible.slice(0, 5).map((p) => p.session.id) },
      });
      return res.json({ status: 'accepted', eventId, matchStatus: 'AMBIGUOUS', message: 'Queued for review', serverTimestamp: Date.now() });
    }
    chosen = plausible[0].session;
  }

  const expected = Number(chosen.expected_amount);
  const tolerance = Number(chosen.amount_tolerance || 0);
  const difference = Math.round((receivedAmount - expected) * 100) / 100;
  const late = capturedAtMs > new Date(chosen.expires_at).getTime();

  await supabaseServer
    .from('payment_bridge_events')
    .update({
      matched_session_id: chosen.id,
      amount_difference: difference,
      match_status: late ? 'late_payment' : difference < 0 ? 'underpaid' : difference <= tolerance ? 'matched' : 'ambiguous',
      processing_notes: {
        matchedBy: ['reserved_device', 'event_time', 'approximate_amount', ...(provider === 'vf_cash' && payerPhone ? ['payer_phone_if_available'] : [])],
        transactionReferenceUsed: false,
      },
    })
    .eq('id', eventRow.id);

  if (late) {
    await markSessionNeedsReview(chosen, eventRow.id, receivedAmount, difference, payerPhone);
    await createReviewItem({
      reason: 'late_payment',
      sessionId: chosen.id,
      eventId: eventRow.id,
      orderId: chosen.order_id,
      expectedAmount: expected,
      receivedAmount,
      amountDifference: difference,
      details: { expiresAt: chosen.expires_at, capturedAt: capturedAt.toISOString() },
    });
    return res.json({ status: 'accepted', eventId, matchStatus: 'PENDING_REVIEW', orderId: chosen.order_id, message: 'Late payment requires review', serverTimestamp: Date.now() });
  }

  if (difference < 0) {
    await markSessionNeedsReview(chosen, eventRow.id, receivedAmount, difference, payerPhone);
    await createReviewItem({
      reason: 'underpaid',
      sessionId: chosen.id,
      eventId: eventRow.id,
      orderId: chosen.order_id,
      expectedAmount: expected,
      receivedAmount,
      amountDifference: difference,
      details: { provider, capturedAt: capturedAt.toISOString() },
    });
    return res.json({ status: 'accepted', eventId, matchStatus: 'PENDING_REVIEW', orderId: chosen.order_id, message: 'Underpayment requires review', serverTimestamp: Date.now() });
  }

  if (difference <= tolerance) {
    await markSessionPaid(chosen, eventRow.id, eventId, receivedAmount, difference, payerPhone, provider);
    return res.json({
      status: 'accepted',
      eventId,
      matchStatus: 'MATCHED',
      orderId: chosen.order_id,
      message: difference === 0 ? 'Payment confirmed' : `Payment confirmed with ${difference.toFixed(2)} EGP positive difference`,
      serverTimestamp: Date.now(),
    });
  }

  await markSessionNeedsReview(chosen, eventRow.id, receivedAmount, difference, payerPhone);
  await createReviewItem({
    reason: 'ambiguous',
    sessionId: chosen.id,
    eventId: eventRow.id,
    orderId: chosen.order_id,
    expectedAmount: expected,
    receivedAmount,
    amountDifference: difference,
    details: { reason: 'amount_above_tolerance', configuredTolerance: tolerance },
  });
  return res.json({ status: 'accepted', eventId, matchStatus: 'AMBIGUOUS', orderId: chosen.order_id, message: 'Amount is above configured tolerance', serverTimestamp: Date.now() });
});
