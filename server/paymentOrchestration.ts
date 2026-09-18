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
    paymentSourceId: row.payment_source_id || undefined,
    customerPaymentMethodId: row.customer_payment_method_id || undefined,
    paymentIntent: row.payment_intent || undefined,
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

  // Standard Bridge HMAC contract: For GET requests (and requests without body),
  // rawBody is defined as "" (empty string). Body hash is sha256("").
  const rawBody =
    req.method === 'GET'
      ? ''
      : (typeof req.rawBody === 'string'
          ? req.rawBody
          : (req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : ''));
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
  eventId: string,
  confirmedBy: string = 'payment-orchestration'
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
  const isManual = confirmedBy !== 'payment-orchestration';
  const auditNote = isManual
    ? `تأكيد يدوي من لوحة الإدارة بواسطة ${confirmedBy} / event ${eventId} / فرق ${Number(session.amount_difference || 0).toFixed(2)} ج.م`
    : `تأكيد آلي من Payment Orchestration / event ${eventId} / فرق ${Number(session.amount_difference || 0).toFixed(2)} ج.م`;

  // FIX 22: Derive deposit_method generically from payment source / channel rather than hardcoded vf_cash
  let depositMethod = provider === 'vf_cash' ? 'vodafone_cash' : provider === 'bank_alahly' ? 'bank_transfer' : String(provider);
  if (session.payment_source_id) {
    const { data: src } = await supabaseServer
      .from('payment_sources')
      .select('code,channel')
      .eq('id', session.payment_source_id)
      .maybeSingle();
    if (src) {
      depositMethod = src.code || src.channel || depositMethod;
    }
  }

  const { error } = await supabaseServer
    .from('orders')
    .update({
      deposit_status: 'confirmed',
      deposit_amount: receivedAmount,
      deposit_method: depositMethod,
      deposit_confirmed_at: new Date().toISOString(),
      deposit_confirmed_by: confirmedBy,
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
    confirmedBy,
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
async function getAdminPaymentSettings(): Promise<{
  defaultPaymentPolicy: string;
  sessionTimeoutSeconds: number;
  amountTolerance: number;
  depositEnabled: boolean;
  depositRequired: boolean;
  depositType: 'fixed' | 'percentage';
  depositValue: number;
  minimumDeposit: number;
}> {
  const { data: legacy } = await supabaseServer
    .from('store_settings')
    .select('default_payment_policy,payment_session_timeout_seconds,payment_amount_tolerance')
    .eq('id', 1)
    .maybeSingle();

  const defaultPolicy = legacy?.default_payment_policy || 'cod_allowed';
  const timeoutSeconds = Number(legacy?.payment_session_timeout_seconds || 120);
  const tolerance = Number(legacy?.payment_amount_tolerance || 10);

  let depositRequired = defaultPolicy === 'deposit_required';
  let depositEnabled = depositRequired;
  let depositType: 'fixed' | 'percentage' = 'fixed';
  let depositValue = 100;
  let minimumDeposit = 50;

  try {
    const { data: v3, error: v3Error } = await supabaseServer
      .from('store_settings')
      .select('deposit_enabled,deposit_required,deposit_type,deposit_value,minimum_deposit')
      .eq('id', 1)
      .maybeSingle();

    if (!v3Error && v3) {
      if (v3.deposit_enabled !== null && v3.deposit_enabled !== undefined) {
        depositEnabled = Boolean(v3.deposit_enabled);
      }
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
    // V3 columns not available yet; proceed with legacy defaults
  }

  return {
    defaultPaymentPolicy: defaultPolicy,
    sessionTimeoutSeconds: timeoutSeconds,
    amountTolerance: tolerance,
    depositEnabled: depositEnabled || depositRequired,
    depositRequired,
    depositType,
    depositValue,
    minimumDeposit,
  };
}

paymentRouter.get('/admin/payments/settings', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const settings = await getAdminPaymentSettings();
  return res.json(settings);
});

paymentRouter.put(
  '/admin/payments/settings',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const policy = req.body?.defaultPaymentPolicy;
    const timeout = Number(req.body?.sessionTimeoutSeconds);
    const tolerance = Number(req.body?.amountTolerance);
    const depositEnabled = req.body?.depositEnabled !== undefined ? Boolean(req.body.depositEnabled) : undefined;
    const depositRequired = req.body?.depositRequired !== undefined ? Boolean(req.body.depositRequired) : undefined;
    const depositType = req.body?.depositType;
    const depositValue = req.body?.depositValue !== undefined ? Number(req.body.depositValue) : undefined;
    const minimumDeposit = req.body?.minimumDeposit !== undefined
      ? Number(req.body.minimumDeposit)
      : (req.body?.minDeposit !== undefined ? Number(req.body.minDeposit) : undefined);

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

    const currentSettings = await getAdminPaymentSettings();
    const effectiveDepositType = depositType || currentSettings.depositType;

    if (depositValue !== undefined) {
      if (!Number.isFinite(depositValue) || depositValue < 0) {
        return res.status(400).json({ error: 'قيمة العربون غير صالحة' });
      }
      if (effectiveDepositType === 'percentage' && (depositValue < 0 || depositValue > 100)) {
        return res.status(400).json({ error: 'نسبة العربون يجب أن تكون بين 0% و100%' });
      }
    }
    if (minimumDeposit !== undefined && (!Number.isFinite(minimumDeposit) || minimumDeposit < 0)) {
      return res.status(400).json({ error: 'الحد الأدنى للعربون يجب أن يكون أكبر من أو يساوي الصفر' });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (policy) updates.default_payment_policy = policy;
    if (timeout) updates.payment_session_timeout_seconds = timeout;
    if (tolerance !== undefined) updates.payment_amount_tolerance = tolerance;
    if (depositEnabled !== undefined) updates.deposit_enabled = depositEnabled;
    if (depositRequired !== undefined) {
      updates.deposit_required = depositRequired;
      if (depositRequired) {
        updates.deposit_enabled = true;
        if (!policy) updates.default_payment_policy = 'deposit_required';
      } else if (!policy && currentSettings.defaultPaymentPolicy === 'deposit_required') {
        updates.default_payment_policy = 'cod_allowed';
      }
    }
    if (depositType) updates.deposit_type = depositType;
    if (depositValue !== undefined) updates.deposit_value = depositValue;
    if (minimumDeposit !== undefined) updates.minimum_deposit = minimumDeposit;

    const { data: existing } = await supabaseServer.from('store_settings').select('*').eq('id', 1).maybeSingle();
    let savedData: any = null;

    const { data: updatedV3, error: v3Error } = await supabaseServer
      .from('store_settings')
      .update(updates)
      .eq('id', 1)
      .select('*')
      .maybeSingle();

    if (v3Error) {
      // If error due to V3 columns missing before migration, fallback to updating legacy fields only
      const legacyUpdates: Record<string, unknown> = {};
      if (updates.default_payment_policy) legacyUpdates.default_payment_policy = updates.default_payment_policy;
      if (updates.payment_session_timeout_seconds) legacyUpdates.payment_session_timeout_seconds = updates.payment_session_timeout_seconds;
      if (updates.payment_amount_tolerance !== undefined) legacyUpdates.payment_amount_tolerance = updates.payment_amount_tolerance;
      legacyUpdates.updated_at = new Date().toISOString();

      const { data: updatedLegacy, error: legacyErr } = await supabaseServer
        .from('store_settings')
        .update(legacyUpdates)
        .eq('id', 1)
        .select('*')
        .single();
      if (legacyErr) return res.status(503).json({ error: 'تعذر حفظ إعدادات الدفع' });
      savedData = updatedLegacy;
    } else {
      savedData = updatedV3;
    }

    logAuditAction(req.admin, 'update_payment_settings', 'store_settings', '1', existing, savedData, req.ip);
    const result = {
      defaultPaymentPolicy: savedData.default_payment_policy || policy || currentSettings.defaultPaymentPolicy,
      sessionTimeoutSeconds: Number(savedData.payment_session_timeout_seconds || timeout || currentSettings.sessionTimeoutSeconds),
      amountTolerance: Number(savedData.payment_amount_tolerance ?? tolerance ?? currentSettings.amountTolerance),
      depositEnabled: Boolean(savedData.deposit_enabled ?? depositEnabled ?? currentSettings.depositEnabled ?? currentSettings.depositRequired),
      depositRequired: Boolean(savedData.deposit_required ?? depositRequired ?? currentSettings.depositRequired),
      depositType: savedData.deposit_type || depositType || currentSettings.depositType,
      depositValue: Number(savedData.deposit_value ?? depositValue ?? currentSettings.depositValue),
      minimumDeposit: Number(savedData.minimum_deposit ?? minimumDeposit ?? currentSettings.minimumDeposit),
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

const ALLOWED_SOURCE_CHANNELS = ['wallet', 'bank_transfer', 'instapay', 'other'];
const ALLOWED_PARSER_TYPES = ['regex', 'json', 'keyword', 'smart', 'vf_cash_v1', 'bank_alahly_v1', 'generic_sms', 'generic_notification'];
const ALLOWED_CUSTOMER_METHOD_CHANNELS = ['cash_on_delivery', 'wallet', 'instapay', 'bank_transfer', 'card', 'other'];

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

paymentRouter.post(
  '/admin/payments/sources',
  requireAuth,
  requireRole(['super_admin', 'manager']),
  async (req: AuthenticatedRequest, res: Response) => {
    const code = String(req.body?.code || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const displayName = String(req.body?.displayName || '').trim();
    const channel = String(req.body?.channel || 'wallet').trim();
    const parserType = String(req.body?.parserType || 'regex').trim();
    const priority = Number(req.body?.priority ?? 100);

    if (!code || !displayName) {
      return res.status(400).json({ error: 'كود المصدر والاسم المعروض مطلوبان' });
    }

    if (!ALLOWED_SOURCE_CHANNELS.includes(channel)) {
      return res.status(400).json({ error: `قناة المصدر غير صالحة. القنوات المسموحة: ${ALLOWED_SOURCE_CHANNELS.join(', ')}` });
    }

    if (!ALLOWED_PARSER_TYPES.includes(parserType)) {
      return res.status(400).json({ error: `نوع المعالج غير صالح. الأنواع المسموحة: ${ALLOWED_PARSER_TYPES.join(', ')}` });
    }

    if (!Number.isInteger(priority) || priority < 1 || priority > 10000) {
      return res.status(400).json({ error: 'الأولوية يجب أن تكون رقماً صحيحاً بين 1 و 10000' });
    }

    if (req.body?.amountRegex && !isValidRegex(String(req.body.amountRegex))) {
      return res.status(400).json({ error: 'التعبير النمطي لاستخراج المبلغ غير صالح' });
    }
    if (req.body?.payerPhoneRegex && !isValidRegex(String(req.body.payerPhoneRegex))) {
      return res.status(400).json({ error: 'التعبير النمطي لاستخراج رقم المحول غير صالح' });
    }
    if (req.body?.accountIdentifierRegex && !isValidRegex(String(req.body.accountIdentifierRegex))) {
      return res.status(400).json({ error: 'التعبير النمطي لمعرف الحساب غير صالح' });
    }

    const row = {
      code,
      display_name: displayName,
      channel,
      destination: req.body?.destination ? String(req.body.destination).trim() : null,
      enabled: req.body?.enabled !== false,
      parser_type: parserType,
      source_package: req.body?.sourcePackage ? String(req.body.sourcePackage).trim() : null,
      source_packages: Array.isArray(req.body?.sourcePackages)
        ? req.body.sourcePackages.map((v: unknown) => String(v).trim()).filter(Boolean)
        : (req.body?.sourcePackage ? [String(req.body.sourcePackage).trim()] : []),
      source_sender: req.body?.sourceSender ? String(req.body.sourceSender).trim() : null,
      title_contains: req.body?.titleContains ? String(req.body.titleContains).trim() : null,
      body_contains: req.body?.bodyContains ? String(req.body.bodyContains).trim() : null,
      amount_regex: req.body?.amountRegex ? String(req.body.amountRegex).trim() : null,
      payer_phone_regex: req.body?.payerPhoneRegex ? String(req.body.payerPhoneRegex).trim() : null,
      account_identifier_regex: req.body?.accountIdentifierRegex ? String(req.body.accountIdentifierRegex).trim() : null,
      priority,
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
    if (req.body?.channel !== undefined) {
      const ch = String(req.body.channel).trim();
      if (!ALLOWED_SOURCE_CHANNELS.includes(ch)) {
        return res.status(400).json({ error: `قناة المصدر غير صالحة. القنوات المسموحة: ${ALLOWED_SOURCE_CHANNELS.join(', ')}` });
      }
      updates.channel = ch;
    }
    if (req.body?.destination !== undefined) updates.destination = req.body.destination ? String(req.body.destination).trim() : null;
    if (req.body?.parserType !== undefined) {
      const pt = String(req.body.parserType).trim();
      if (!ALLOWED_PARSER_TYPES.includes(pt)) {
        return res.status(400).json({ error: `نوع المعالج غير صالح. الأنواع المسموحة: ${ALLOWED_PARSER_TYPES.join(', ')}` });
      }
      updates.parser_type = pt;
    }
    if (req.body?.sourcePackage !== undefined) updates.source_package = req.body.sourcePackage ? String(req.body.sourcePackage).trim() : null;
    if (req.body?.sourcePackages !== undefined) {
      updates.source_packages = Array.isArray(req.body.sourcePackages)
        ? req.body.sourcePackages.map((v: unknown) => String(v).trim()).filter(Boolean)
        : [];
    }
    if (req.body?.sourceSender !== undefined) updates.source_sender = req.body.sourceSender ? String(req.body.sourceSender).trim() : null;
    if (req.body?.titleContains !== undefined) updates.title_contains = req.body.titleContains ? String(req.body.titleContains).trim() : null;
    if (req.body?.bodyContains !== undefined) updates.body_contains = req.body.bodyContains ? String(req.body.bodyContains).trim() : null;
    if (req.body?.amountRegex !== undefined) {
      const r = req.body.amountRegex ? String(req.body.amountRegex).trim() : null;
      if (r && !isValidRegex(r)) return res.status(400).json({ error: 'التعبير النمطي لاستخراج المبلغ غير صالح' });
      updates.amount_regex = r;
    }
    if (req.body?.payerPhoneRegex !== undefined) {
      const r = req.body.payerPhoneRegex ? String(req.body.payerPhoneRegex).trim() : null;
      if (r && !isValidRegex(r)) return res.status(400).json({ error: 'التعبير النمطي لاستخراج رقم المحول غير صالح' });
      updates.payer_phone_regex = r;
    }
    if (req.body?.accountIdentifierRegex !== undefined) {
      const r = req.body.accountIdentifierRegex ? String(req.body.accountIdentifierRegex).trim() : null;
      if (r && !isValidRegex(r)) return res.status(400).json({ error: 'التعبير النمطي لمعرف الحساب غير صالح' });
      updates.account_identifier_regex = r;
    }
    if (req.body?.priority !== undefined) {
      const pri = Number(req.body.priority);
      if (!Number.isInteger(pri) || pri < 1 || pri > 10000) {
        return res.status(400).json({ error: 'الأولوية يجب أن تكون رقماً صحيحاً بين 1 و 10000' });
      }
      updates.priority = pri;
    }
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
// Device ↔ Payment Source Assignments (FIX 2: Safe Upsert & Prune)
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

    // 1. Validate that device exists
    const { data: device, error: devError } = await supabaseServer
      .from('payment_devices')
      .select('*')
      .eq('id', deviceId)
      .maybeSingle();
    if (devError) return res.status(503).json({ error: 'تعذر فحص الجهاز' });
    if (!device) return res.status(404).json({ error: 'الجهاز غير موجود' });

    // 2. Validate that all sourceIds exist in payment_sources
    if (sourceIds.length > 0) {
      const { data: validSources, error: srcError } = await supabaseServer
        .from('payment_sources')
        .select('id,code')
        .in('id', sourceIds);
      if (srcError) return res.status(503).json({ error: 'تعذر التحقق من مصادر الدفع' });
      const validIdSet = new Set((validSources || []).map((s: any) => s.id));
      const invalidIds = sourceIds.filter((id) => !validIdSet.has(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({ error: `بعض مصادر الدفع المحددة غير موجودة: ${invalidIds.join(', ')}` });
      }
    }

    // 3. Upsert desired assignments
    if (sourceIds.length > 0) {
      const upsertRows = sourceIds.map((sid) => ({
        device_id: deviceId,
        payment_source_id: sid,
        enabled: true,
      }));
      await supabaseServer
        .from('payment_device_sources')
        .upsert(upsertRows, { onConflict: 'device_id,payment_source_id' });
    }

    // 4. Remove ONLY assignments that are no longer in sourceIds
    if (sourceIds.length === 0) {
      await supabaseServer.from('payment_device_sources').delete().eq('device_id', deviceId);
    } else {
      await supabaseServer
        .from('payment_device_sources')
        .delete()
        .eq('device_id', deviceId)
        .not('payment_source_id', 'in', `(${sourceIds.join(',')})`);
    }

    // 5. Update legacy boolean flags on payment_devices
    let vfCashEnabled = false;
    let bankAlAhlyEnabled = false;
    if (sourceIds.length > 0) {
      const { data: sources } = await supabaseServer.from('payment_sources').select('id,code').in('id', sourceIds);
      const codes = new Set((sources || []).map((s: any) => s.code));
      vfCashEnabled = codes.has('vf_cash');
      bankAlAhlyEnabled = codes.has('bank_alahly');
    }

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
// Customer Payment Methods Management (FIX 17: Validation & Channel check)
// ------------------------------------------------------------------------------
paymentRouter.get('/admin/payments/customer-methods', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const [methodsRes, methodSourcesRes] = await Promise.all([
    supabaseServer.from('customer_payment_methods').select('*').order('sort_order', { ascending: true }),
    supabaseServer.from('customer_payment_method_sources').select('customer_payment_method_id,payment_source_id,is_primary,payment_sources(*)'),
  ]);
  if (methodsRes.error) {
    if (methodsRes.error.code === '42P01') return res.json([]);
    return res.status(503).json({ error: 'تعذر تحميل طرق الدفع للعملاء' });
  }

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

    if (!ALLOWED_CUSTOMER_METHOD_CHANNELS.includes(channel)) {
      return res.status(400).json({ error: `قناة طريقة الدفع غير صالحة. القنوات المسموحة: ${ALLOWED_CUSTOMER_METHOD_CHANNELS.join(', ')}` });
    }

    const sourceIds: string[] = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds : [];
    if (sourceIds.length > 0) {
      const { data: validSources, error: srcError } = await supabaseServer
        .from('payment_sources')
        .select('id')
        .in('id', sourceIds);
      if (srcError) return res.status(503).json({ error: 'تعذر التحقق من مصادر الدفع' });
      const validSet = new Set((validSources || []).map((s: any) => s.id));
      const invalidIds = sourceIds.filter((id) => !validSet.has(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({ error: `مصادر الدفع التالية غير موجودة: ${invalidIds.join(', ')}` });
      }
    }

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
    if (req.body?.channel !== undefined) {
      const ch = String(req.body.channel).trim();
      if (!ALLOWED_CUSTOMER_METHOD_CHANNELS.includes(ch)) {
        return res.status(400).json({ error: `قناة طريقة الدفع غير صالحة. القنوات المسموحة: ${ALLOWED_CUSTOMER_METHOD_CHANNELS.join(', ')}` });
      }
      updates.channel = ch;
    }
    if (req.body?.instructions !== undefined) updates.instructions = req.body.instructions ? String(req.body.instructions).trim() : null;
    if (req.body?.sortOrder !== undefined) updates.sort_order = Number(req.body.sortOrder);

    if (Array.isArray(req.body?.sourceIds) && req.body.sourceIds.length > 0) {
      const { data: validSources, error: srcError } = await supabaseServer
        .from('payment_sources')
        .select('id')
        .in('id', req.body.sourceIds);
      if (srcError) return res.status(503).json({ error: 'تعذر التحقق من مصادر الدفع' });
      const validSet = new Set((validSources || []).map((s: any) => s.id));
      const invalidIds = req.body.sourceIds.filter((id: string) => !validSet.has(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({ error: `مصادر الدفع التالية غير موجودة: ${invalidIds.join(', ')}` });
      }
    }

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
  // Query orders with pending/rejected deposits, open review items, or problematic payment sessions
  const [ordersRes, reviewsRes, sessionsRes] = await Promise.all([
    supabaseServer
      .from('orders')
      .select('id,order_number,status,deposit_status,deposit_amount,deposit_paid,total_amount,payment_mode,deposit_method,customer_name,customer_phone,created_at')
      .or('deposit_status.eq.pending,deposit_status.eq.rejected')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseServer
      .from('payment_review_items')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false }),
    supabaseServer
      .from('payment_sessions')
      .select('*')
      .in('status', ['needs_review', 'expired_needs_review', 'underpaid', 'amount_mismatch', 'late_payment'])
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

  const sessionMapByOrder = new Map<string, any>();
  for (const s of problematicSessions) {
    if (s.order_id && !sessionMapByOrder.has(s.order_id)) {
      sessionMapByOrder.set(s.order_id, s);
    }
  }

  const ordersMap = new Map<string, any>();
  for (const o of ordersRes.data || []) {
    ordersMap.set(o.id, o);
  }

  // Find any order IDs mentioned in reviews or sessions that were not in ordersRes
  const extraOrderIds = new Set<string>();
  for (const r of openReviews) {
    if (r.order_id && !ordersMap.has(r.order_id)) extraOrderIds.add(r.order_id);
  }
  for (const s of problematicSessions) {
    if (s.order_id && !ordersMap.has(s.order_id)) extraOrderIds.add(s.order_id);
  }

  if (extraOrderIds.size > 0) {
    const { data: extraOrders } = await supabaseServer
      .from('orders')
      .select('id,order_number,status,deposit_status,deposit_amount,deposit_paid,total_amount,payment_mode,deposit_method,customer_name,customer_phone,created_at')
      .in('id', Array.from(extraOrderIds))
      .neq('status', 'cancelled');
    for (const o of extraOrders || []) {
      ordersMap.set(o.id, o);
    }
  }

  // Combine and deduplicate problematic orders
  const problemMap = new Map<string, any>();

  for (const [orderId, ord] of ordersMap.entries()) {
    const linkedReview = reviewMapByOrder.get(orderId);
    const linkedSession = sessionMapByOrder.get(orderId);

    let problemReason = 'بانتظار مراجعة الدفع';
    if (linkedReview) {
      problemReason = linkedReview.reason;
    } else if (linkedSession) {
      problemReason = `جلسة دفع: ${linkedSession.status}`;
    } else if (ord.deposit_status === 'rejected') {
      problemReason = 'عربون مرفوض';
    } else if (ord.deposit_status === 'pending') {
      problemReason = 'بانتظار تأكيد العربون';
    }

    problemMap.set(orderId, {
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
      problemReason,
      reviewId: linkedReview?.id || null,
      reviewStatus: linkedReview?.status || null,
      sessionId: linkedSession?.id || linkedReview?.session_id || null,
      sessionStatus: linkedSession?.status || null,
      createdAt: ord.created_at,
    });
  }

  // Also include any reviews without orders (e.g. unassigned bridge events)
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
        reviewStatus: r.status,
        sessionId: r.session_id || null,
        sessionStatus: null,
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
    problemOrdersRes,
    settings,
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
      .from('orders')
      .select('id,order_number,status,deposit_status,deposit_amount,deposit_paid,total_amount,payment_mode,deposit_method,customer_name,customer_phone,created_at')
      .or('deposit_status.eq.pending,deposit_status.eq.rejected')
      .order('created_at', { ascending: false })
      .limit(50),
    getAdminPaymentSettings(),
  ]);

  const failed = [devicesResult, reviewsResult, sessionsResult].find((r) => r.error);
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
    sourcePackages: Array.isArray(s.source_packages) && s.source_packages.length > 0
      ? s.source_packages
      : (s.source_package ? [s.source_package] : []),
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
    settings,
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
        const adminActor = req.admin?.email || req.admin?.id || 'admin';
        await confirmOrderPayment({ ...paid, amount_difference: difference }, received, provider, eventPublicId, adminActor);
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
// FIX 3, FIX 4, FIX 10, FIX 18: Deterministic source selection with device health
// ==============================================================================
async function findEligibleSourceForMethod(
  customerPaymentMethodId?: string | null,
  paymentMethodCode?: string | null,
  paymentSourceId?: string | null,
  fallbackProvider?: string | null
): Promise<
  | { source: any; provider: PaymentProvider; customerPaymentMethodId: string | null }
  | { notFound: true; customerPaymentMethodId: string | null }
  | { disabled: true; method: any; customerPaymentMethodId: string | null }
  | null
> {
  // Query active, non-busy devices:
  // - online = true, is_enabled = true
  // - internet_connected = true, app_running = true, notification_listener_enabled = true
  // - is_busy = false
  // - last_heartbeat_at >= NOW() - 45 seconds
  const cutoff = new Date(Date.now() - 45_000).toISOString();
  const { data: activeDevices } = await supabaseServer
    .from('payment_devices')
    .select('id,device_id,vf_cash_enabled,bank_alahly_enabled')
    .eq('is_enabled', true)
    .eq('online', true)
    .eq('internet_connected', true)
    .eq('app_running', true)
    .eq('notification_listener_enabled', true)
    .eq('is_busy', false)
    .gte('last_heartbeat_at', cutoff);

  const activeDeviceList = activeDevices || [];
  const activeDeviceIds = activeDeviceList.map((d: any) => d.id);

  if (activeDeviceIds.length === 0) {
    return null;
  }

  // Get device source mappings for active devices
  let activeAssignedSourceIds = new Set<string>();
  if (activeDeviceIds.length > 0) {
    const { data: devSources } = await supabaseServer
      .from('payment_device_sources')
      .select('payment_source_id,device_id')
      .eq('enabled', true)
      .in('device_id', activeDeviceIds);

    if (devSources && devSources.length > 0) {
      activeAssignedSourceIds = new Set(devSources.map((ds: any) => ds.payment_source_id));
    }
  }

  // 1. Validate and resolve via customer_payment_methods FIRST if requested
  let method: any = null;
  if (customerPaymentMethodId) {
    const { data } = await supabaseServer.from('customer_payment_methods').select('*').eq('id', customerPaymentMethodId).maybeSingle();
    method = data;
  } else if (paymentMethodCode) {
    const { data } = await supabaseServer.from('customer_payment_methods').select('*').eq('code', paymentMethodCode).maybeSingle();
    method = data;
  }

  // If customerPaymentMethodId or paymentMethodCode was requested:
  // Reject non-existent or disabled payment methods immediately (must never create a session)
  // An explicit paymentSourceId must never bypass a disabled or non-existent customer payment method.
  if (customerPaymentMethodId || paymentMethodCode) {
    if (!method) {
      return { notFound: true, customerPaymentMethodId: customerPaymentMethodId || null };
    }
    if (!method.enabled) {
      return { disabled: true, method, customerPaymentMethodId: method.id };
    }

    // Resolve allowed sources mapped to this enabled method
    const { data: mappedSources } = await supabaseServer
      .from('customer_payment_method_sources')
      .select('payment_source_id,is_primary,payment_sources(*)')
      .eq('customer_payment_method_id', method.id);

    const candidates = (mappedSources || [])
      .map((ms: any) => ({
        isPrimary: Boolean(ms.is_primary),
        source: ms.payment_sources,
      }))
      .filter((item: any) => item.source && item.source.enabled);

    // If an explicit paymentSourceId was ALSO supplied, it MUST be one of this method's allowed sources
    if (paymentSourceId) {
      const matched = candidates.find((c: any) => c.source.id === paymentSourceId);
      if (matched) {
        const src = matched.source;
        const isDirectlyAssigned = activeAssignedSourceIds.has(src.id);
        const isLegacyAssigned = activeDeviceList.some((d: any) =>
          (src.code === 'vf_cash' && d.vf_cash_enabled) ||
          (src.code === 'bank_alahly' && d.bank_alahly_enabled)
        );
        if (isDirectlyAssigned || isLegacyAssigned) {
          return {
            source: src,
            provider: normalizeProvider(src.code) || src.code,
            customerPaymentMethodId: method.id,
          };
        }
      }
      // If the explicit paymentSourceId is not allowed for this method or not active, do not bypass
      return null;
    }

    // Select the highest priority available source mapped to this method
    const sortedCandidates = candidates.sort((a: any, b: any) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return Number(b.source.priority || 0) - Number(a.source.priority || 0);
    });

    for (const item of sortedCandidates) {
      const src = item.source;
      const isDirectlyAssigned = activeAssignedSourceIds.has(src.id);
      const isLegacyAssigned = activeDeviceList.some((d: any) =>
        (src.code === 'vf_cash' && d.vf_cash_enabled) ||
        (src.code === 'bank_alahly' && d.bank_alahly_enabled)
      );

      if (isDirectlyAssigned || isLegacyAssigned) {
        return {
          source: src,
          provider: normalizeProvider(src.code) || src.code,
          customerPaymentMethodId: method.id,
        };
      }
    }

    return null;
  }

  // 2. Only if no customer payment method was supplied: handle explicit paymentSourceId
  if (paymentSourceId) {
    const { data: src } = await supabaseServer.from('payment_sources').select('*').eq('id', paymentSourceId).maybeSingle();
    if (src && src.enabled) {
      const isAssigned = activeAssignedSourceIds.has(src.id) || activeDeviceList.some((d: any) =>
        (src.code === 'vf_cash' && d.vf_cash_enabled) || (src.code === 'bank_alahly' && d.bank_alahly_enabled)
      );
      if (isAssigned) {
        return { source: src, provider: normalizeProvider(src.code) || src.code, customerPaymentMethodId: null };
      }
    }
    return null;
  }

  // 3. Fallback: legacy provider code resolution.
  // Once V3 payment_sources exists, its enabled state is authoritative.
  // Legacy device booleans are used only before the V3 table exists.
  const prov = normalizeProvider(fallbackProvider);
  if (prov) {
    const { data: src, error: srcError } = await supabaseServer
      .from('payment_sources')
      .select('*')
      .eq('code', prov)
      .eq('enabled', true)
      .maybeSingle();

    if (!srcError) {
      if (!src) return null;

      const isDirectlyAssigned = activeAssignedSourceIds.has(src.id);
      if (isDirectlyAssigned) {
        return { source: src, provider: prov, customerPaymentMethodId: null };
      }

      return null;
    }

    if (!isMissingRelationError(srcError, 'payment_sources')) {
      return null;
    }

    const isLegacyAssigned = activeDeviceList.some((d: any) =>
      (prov === 'vf_cash' && d.vf_cash_enabled) ||
      (prov === 'bank_alahly' && d.bank_alahly_enabled)
    );
    if (isLegacyAssigned) {
      return { source: null, provider: prov, customerPaymentMethodId: null };
    }
  }

  return null;
}

paymentRouter.post('/payments/sessions', requireIntegrationKey, async (req: Request, res: Response) => {
  await expireSessions();

  const orderId = String(req.body?.orderId || '').trim();
  const customerPaymentMethodId = req.body?.customerPaymentMethodId ? String(req.body.customerPaymentMethodId).trim() : null;
  const paymentMethodCode = req.body?.paymentMethodCode ? String(req.body.paymentMethodCode).trim() : null;
  const sourceId = req.body?.paymentSourceId ? String(req.body.paymentSourceId).trim() : null;
  const rawProvider = String(req.body?.provider || '').trim();

  const expectedAmount = Number(req.body?.expectedAmount);
  const customerId = req.body?.customerId ? String(req.body.customerId) : null;
  const customerPhone = normalizePhone(req.body?.customerPhone);

  if (!orderId) return res.status(400).json({ error: 'orderId is required' });
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

  // Resolve eligible payment source and online non-busy device (FIX 3, FIX 4, FIX 10, FIX 18)
  const resolved: any = await findEligibleSourceForMethod(customerPaymentMethodId, paymentMethodCode, sourceId, rawProvider);
  if (resolved?.disabled) {
    return res.status(400).json({
      error: 'payment_method_disabled',
      orderId,
      message: 'وسيلة الدفع المحددة معطلة حالياً ولا يمكن إنشاء جلسة دفع لها.',
    });
  }
  if (resolved?.notFound) {
    return res.status(400).json({
      error: 'invalid_payment_method',
      orderId,
      message: 'وسيلة الدفع المحددة غير صالحة أو غير موجودة.',
    });
  }
  if (!resolved || (!resolved.source && !resolved.provider)) {
    return res.status(503).json({
      error: 'no_payment_device_available',
      orderId,
      retryable: true,
      message: 'لا يوجد جهاز دفع أو محفظة متاحين لاستقبال الدفع حالياً. يرجى المحاولة بعد قليل أو اختيار وسيلة دفع أخرى.',
    });
  }

  const { source: resolvedSource, provider, customerPaymentMethodId: resolvedMethodId } = resolved;

  // Check for an existing waiting session for this order and provider
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
      customer_payment_method_id: resolvedMethodId || null,
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
      orderId,
      retryable: true,
      message: 'لا يوجد جهاز دفع أو محفظة متاحين لاستقبال الدفع حالياً. يرجى المحاولة بعد قليل أو اختيار وسيلة دفع أخرى.',
    });
  }

  const { data: complete, error: reloadError } = await supabaseServer
    .from('payment_sessions').select('*').eq('id', sessionId).single();
  if (reloadError) return res.status(503).json({ error: 'Payment session reservation failed' });

  const result = {
    ...mapSession(complete),
    clientToken,
    timeoutSeconds,
    instructions: resolvedSource?.destination ? `يرجى التحويل إلى: ${resolvedSource.destination}` : undefined,
  };
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

function isMissingRelationError(err: any, relation: string): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const relationName = relation.toLowerCase();
  const combined = [
    String(err.message || ''),
    String(err.details || ''),
    String(err.hint || ''),
  ].join(' ').toLowerCase();

  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (
      combined.includes(relationName) &&
      (
        combined.includes('schema cache') ||
        combined.includes('does not exist') ||
        combined.includes('could not find the table') ||
        combined.includes('relation')
      )
    )
  );
}

function isMissingV3ColumnError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const message = String(err.message || '').toLowerCase();
  const details = String(err.details || '').toLowerCase();
  const hint = String(err.hint || '').toLowerCase();

  const isColumnErrorCode = code === 'PGRST204' || code === '42703';
  const mentionsV3Columns =
    message.includes('payment_source_id') ||
    message.includes('account_identifier') ||
    message.includes('payment_intent') ||
    message.includes('deposit_enabled') ||
    message.includes('source_packages') ||
    details.includes('payment_source_id') ||
    details.includes('account_identifier') ||
    details.includes('payment_intent') ||
    details.includes('deposit_enabled') ||
    details.includes('source_packages') ||
    hint.includes('payment_source_id') ||
    hint.includes('account_identifier') ||
    hint.includes('payment_intent') ||
    hint.includes('deposit_enabled') ||
    hint.includes('source_packages');

  if (mentionsV3Columns) {
    return true;
  }

  if (isColumnErrorCode && (message.includes('column') || details.includes('column') || message.includes('schema cache'))) {
    return true;
  }

  return false;
}

paymentRouter.post('/payment-bridge/events', verifyBridgeRequest, async (req: RawBodyRequest, res: Response) => {
  const device = (req as any).paymentDevice;
  const reportedDeviceId = String(req.body?.deviceId || '').trim();
  if (!reportedDeviceId || reportedDeviceId !== device.device_id) {
    return res.status(400).json({ error: 'deviceId does not match authenticated device' });
  }

  const eventId = String(req.body?.eventId || '').trim();
  const rawPaymentSourceId = req.body?.paymentSourceId ? String(req.body.paymentSourceId).trim() : null;
  const rawProvider = req.body?.provider ? String(req.body.provider).trim() : '';
  const amountMinor = Number(req.body?.amountMinor);
  const capturedAtMs = Number(req.body?.capturedAt);

  if (!eventId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !Number.isFinite(capturedAtMs)) {
    return res.status(400).json({ error: 'Invalid payment event payload' });
  }

  let resolvedSource: any = null;
  let provider: string = '';

  // 1. If paymentSourceId is supplied: validate existence, enablement, and device assignment.
  // Before the V3 tables exist, a request may fall back to a valid legacy provider.
  if (rawPaymentSourceId) {
    const { data: src, error: srcErr } = await supabaseServer
      .from('payment_sources')
      .select('*')
      .eq('id', rawPaymentSourceId)
      .maybeSingle();

    if (srcErr) {
      if (!isMissingRelationError(srcErr, 'payment_sources')) {
        return res.status(503).json({ error: 'Payment source service unavailable' });
      }

      provider = normalizeProvider(rawProvider);
      const legacyAssigned =
        (provider === 'vf_cash' && Boolean(device.vf_cash_enabled)) ||
        (provider === 'bank_alahly' && Boolean(device.bank_alahly_enabled));

      if (!provider || !legacyAssigned) {
        return res.status(400).json({
          error: 'invalid_payment_source',
          message: 'V3 payment source is unavailable and no assigned legacy provider can be used',
        });
      }
    } else {
      if (!src) {
        return res.status(400).json({
          error: 'invalid_payment_source',
          message: 'Specified paymentSourceId does not exist or is invalid',
        });
      }

      if (!src.enabled) {
        return res.status(400).json({
          error: 'payment_source_disabled',
          message: 'Specified payment source is disabled',
        });
      }

      const { data: devSource, error: devSourceErr } = await supabaseServer
        .from('payment_device_sources')
        .select('enabled')
        .eq('device_id', device.id)
        .eq('payment_source_id', src.id)
        .maybeSingle();

      let assigned = Boolean(!devSourceErr && devSource?.enabled);
      if (devSourceErr && isMissingRelationError(devSourceErr, 'payment_device_sources')) {
        assigned =
          (src.code === 'vf_cash' && Boolean(device.vf_cash_enabled)) ||
          (src.code === 'bank_alahly' && Boolean(device.bank_alahly_enabled));
      } else if (devSourceErr) {
        return res.status(503).json({ error: 'Payment source assignment service unavailable' });
      }

      if (!assigned) {
        return res.status(400).json({
          error: 'payment_source_not_assigned',
          message: 'Payment source is not assigned or enabled for this device',
        });
      }

      resolvedSource = src;
      provider = normalizeProvider(src.code) || src.code;
    }
  } else {
    // 2. Legacy provider fallback remains temporarily supported.
    provider = normalizeProvider(rawProvider);
    if (!provider) {
      return res.status(400).json({
        error: 'missing_provider',
        message: 'Either a valid paymentSourceId or a supported provider is required',
      });
    }

    const { data: src, error: srcErr } = await supabaseServer
      .from('payment_sources')
      .select('*')
      .eq('code', provider)
      .eq('enabled', true)
      .maybeSingle();

    if (srcErr) {
      if (!isMissingRelationError(srcErr, 'payment_sources')) {
        return res.status(503).json({ error: 'Payment source service unavailable' });
      }

      const legacyAssigned =
        (provider === 'vf_cash' && Boolean(device.vf_cash_enabled)) ||
        (provider === 'bank_alahly' && Boolean(device.bank_alahly_enabled));

      if (!legacyAssigned) {
        return res.status(400).json({
          error: 'payment_source_not_assigned',
          message: 'Legacy provider is not enabled for this device',
        });
      }
    } else {
      // V3 exists: source enabled state and relational assignment are authoritative.
      if (!src) {
        return res.status(400).json({
          error: 'payment_source_disabled',
          message: 'Payment source is disabled or unavailable',
        });
      }

      const { data: devSource, error: devSourceErr } = await supabaseServer
        .from('payment_device_sources')
        .select('enabled')
        .eq('device_id', device.id)
        .eq('payment_source_id', src.id)
        .maybeSingle();

      if (devSourceErr) {
        if (!isMissingRelationError(devSourceErr, 'payment_device_sources')) {
          return res.status(503).json({ error: 'Payment source assignment service unavailable' });
        }

        const legacyAssigned =
          (src.code === 'vf_cash' && Boolean(device.vf_cash_enabled)) ||
          (src.code === 'bank_alahly' && Boolean(device.bank_alahly_enabled));

        if (!legacyAssigned) {
          return res.status(400).json({
            error: 'payment_source_not_assigned',
            message: 'Payment source is not assigned or enabled for this device',
          });
        }
      } else if (!devSource?.enabled) {
        return res.status(400).json({
          error: 'payment_source_not_assigned',
          message: 'Payment source is not assigned or enabled for this device',
        });
      }

      resolvedSource = src;
    }
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

  const eventInsert: Record<string, any> = {
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
    account_identifier: req.body?.accountIdentifier ? String(req.body.accountIdentifier).trim() : (req.body?.account_identifier ? String(req.body.account_identifier).trim() : null),
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

  let eventRow: any = null;
  const { data: v3EventRow, error: insertError } = await supabaseServer
    .from('payment_bridge_events')
    .insert(eventInsert)
    .select('*')
    .single();

  if (insertError) {
    if (isMissingV3ColumnError(insertError)) {
      // Missing V3 columns (pre-migration). Retry with legacy event columns only.
      const { payment_source_id, account_identifier, ...legacyEventInsert } = eventInsert;
      const { data: legacyRow, error: legacyError } = await supabaseServer
        .from('payment_bridge_events')
        .insert(legacyEventInsert)
        .select('*')
        .single();

      if (legacyError) {
        console.error('[PaymentBridge] Failed to store payment event on legacy retry:', legacyError);
        return res.status(503).json({ error: 'Could not store payment event' });
      }
      eventRow = legacyRow;
    } else {
      // Unrelated database error - do NOT hide
      console.error('[PaymentBridge] Failed to store payment event:', insertError);
      return res.status(503).json({ error: 'Could not store payment event' });
    }
  } else {
    eventRow = v3EventRow;
  }

  await supabaseServer
    .from('payment_devices')
    .update({ last_event_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', device.id);

  // FIX 7 & FIX 8: Robust candidate selection with timing window and scoring
  let candidates: Record<string, any>[] = [];
  const lowerBound = new Date(capturedAt.getTime() - LATE_MATCH_WINDOW_MS).toISOString();
  const upperBound = new Date(capturedAt.getTime() + 15_000).toISOString();

  const { data: recentSessions, error: sessionErr } = await supabaseServer
    .from('payment_sessions')
    .select('*')
    .eq('device_id', device.id)
    .in('status', ['waiting', 'expired', 'expired_needs_review', 'needs_review'])
    .lte('created_at', upperBound)
    .gte('expires_at', lowerBound)
    .order('created_at', { ascending: false })
    .limit(10);

  if (sessionErr) return res.status(503).json({ error: 'Payment matching service unavailable' });

  candidates = (recentSessions || []).filter((session: any) => {
    const providerMatches =
      normalizeProvider(session.provider) === provider ||
      (resolvedSource && session.payment_source_id === resolvedSource.id);
    if (!providerMatches) return false;
    const created = new Date(session.created_at).getTime();
    const expires = new Date(session.expires_at).getTime();
    // FIX 7: Ensure capturedAt was not before creation (with 15s leeway) and within late window
    return capturedAtMs >= created - 15_000 && capturedAtMs <= expires + LATE_MATCH_WINDOW_MS;
  });

  // If busy_session_id is known on the device and not already in candidates, check it as well
  if (device.busy_session_id && !candidates.some((c) => c.id === device.busy_session_id)) {
    const { data: busySession } = await supabaseServer
      .from('payment_sessions')
      .select('*')
      .eq('id', device.busy_session_id)
      .in('status', ['waiting', 'expired', 'expired_needs_review', 'needs_review'])
      .maybeSingle();

    if (busySession) {
      const created = new Date(busySession.created_at).getTime();
      const expires = new Date(busySession.expires_at).getTime();
      const providerMatches =
        normalizeProvider(busySession.provider) === provider ||
        (resolvedSource && busySession.payment_source_id === resolvedSource.id);
      if (providerMatches && capturedAtMs >= created - 15_000 && capturedAtMs <= expires + LATE_MATCH_WINDOW_MS) {
        candidates.push(busySession);
      }
    }
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

  // FIX 8: Run candidate scoring whenever candidates.length > 1 regardless of busy_session_id
  let chosen = candidates[0];
  if (candidates.length > 1) {
    const plausible = candidates
      .map((session) => {
        const expected = Number(session.expected_amount);
        const tolerance = Number(session.amount_tolerance || 0);
        const diff = receivedAmount - expected;
        const absDiff = Math.abs(diff);
        const phone = normalizePhone(session.customer_phone);
        const phoneBoost = payerPhone && phone && payerPhone === phone ? 10_000 : 0;
        const busyBoost = session.id === device.busy_session_id ? 1_500 : 0;
        const timeDistance = Math.abs(capturedAtMs - new Date(session.created_at).getTime());
        const amountScore = absDiff <= tolerance || diff < 0 ? Math.max(0, 5_000 - absDiff * 100) : 0;
        return { session, score: phoneBoost + busyBoost + amountScore - timeDistance / 1000, absDiff, tolerance };
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
