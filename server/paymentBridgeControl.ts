import crypto from 'node:crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { broadcastRealtimeEvent } from './realtime.js';
import { supabaseServer } from './supabase.js';

export const paymentBridgeControlRouter = Router();

export type RawBridgeRequest = Request & { rawBody?: string };
const MAX_SKEW_MS = 5 * 60_000;
const nonceCache = new Map<string, number>();

function safeCompare(a: string, b: string): boolean {
  const aa = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function pruneNonces(now = Date.now()) {
  for (const [key, timestamp] of nonceCache.entries()) {
    if (now - timestamp > MAX_SKEW_MS) nonceCache.delete(key);
  }
}

export async function verifyPaymentBridge(req: RawBridgeRequest, res: Response, next: NextFunction) {
  const deviceId = req.header('X-Device-Id')?.trim();
  const timestampRaw = req.header('X-Timestamp')?.trim();
  const nonce = req.header('X-Nonce')?.trim();
  const bodyHash = req.header('X-Body-Hash')?.trim().toLowerCase();
  const signature = req.header('X-Signature')?.trim().toLowerCase();

  if (!deviceId || !timestampRaw || !nonce || !bodyHash || !signature) {
    return res.status(401).json({ error: 'Missing bridge authentication headers' });
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_SKEW_MS) {
    return res.status(401).json({ error: 'Stale or invalid bridge timestamp' });
  }

  pruneNonces();
  const nonceKey = `${deviceId}:${nonce}`;
  if (nonceCache.has(nonceKey)) return res.status(409).json({ error: 'Replay detected' });

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
  const expectedHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
  if (!safeCompare(expectedHash, bodyHash)) return res.status(401).json({ error: 'Invalid bridge body hash' });

  const expectedSignature = crypto
    .createHmac('sha256', String(device.hmac_secret))
    .update(`${timestamp}.${nonce}.${rawBody}`, 'utf8')
    .digest('hex');
  if (!safeCompare(expectedSignature, signature)) return res.status(401).json({ error: 'Invalid bridge signature' });

  nonceCache.set(nonceKey, Date.now());
  (req as any).paymentDevice = device;
  (req as any).bridgeNonce = nonce;
  (req as any).bridgeBodyHash = bodyHash;
  next();
}

export async function fetchDeviceRules(deviceRowId: string, device: any) {
  // Query assigned sources from payment_device_sources
  const { data: assignments, error } = await supabaseServer
    .from('payment_device_sources')
    .select(`
      enabled,
      payment_source:payment_sources(*)
    `)
    .eq('device_id', deviceRowId)
    .eq('enabled', true);

  let sources: any[] = [];
  if (!error && assignments) {
    // If the table exists and returned results (including empty array []),
    // return only the sources assigned and enabled for this device.
    sources = assignments
      .map((a: any) => a.payment_source)
      .filter((s: any) => s && s.enabled);
  } else if (error) {
    // Graceful fallback ONLY if table does not exist or errored (legacy database state before migration)
    const codes: string[] = [];
    if (device.vf_cash_enabled) codes.push('vf_cash');
    if (device.bank_alahly_enabled) codes.push('bank_alahly');
    if (codes.length > 0) {
      const { data: fallbackSources } = await supabaseServer
        .from('payment_sources')
        .select('*')
        .in('code', codes)
        .eq('enabled', true);
      sources = fallbackSources || [];
    }
  }

  // Sort by priority descending, then code ascending
  sources.sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));

  const fingerprint = sources.map((s) => `${s.id}:${s.updated_at || s.code}`).join('|');
  const rulesVersion = crypto.createHash('sha256').update(fingerprint || 'empty').digest('hex').substring(0, 16);

  const rules = sources.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.display_name,
    enabled: Boolean(s.enabled),
    channel: s.channel,
    packageNames: Array.isArray(s.source_packages) && s.source_packages.length > 0
      ? s.source_packages
      : (s.source_package ? [s.source_package] : []),
    sourceSender: s.source_sender || undefined,
    titleContains: s.title_contains || undefined,
    bodyContains: s.body_contains || undefined,
    amountRegex: s.amount_regex || undefined,
    payerPhoneRegex: s.payer_phone_regex || undefined,
    accountIdentifierRegex: s.account_identifier_regex || undefined,
    priority: Number(s.priority ?? 100),
    parserType: s.parser_type || 'regex',
  }));

  return { rulesVersion, rules };
}

// GET /payment-bridge/rules - HMAC-protected rules assigned to this device
paymentBridgeControlRouter.get('/payment-bridge/rules', verifyPaymentBridge, async (req: RawBridgeRequest, res: Response) => {
  const device = (req as any).paymentDevice;
  const { rulesVersion, rules } = await fetchDeviceRules(device.id, device);
  return res.json({
    rulesVersion,
    rules,
  });
});

// POST /payment-bridge/source-config - save a tested parser configuration for an
// already-assigned source. The phone may configure parsing, but it cannot enable
// a disabled source or assign itself to a new source.
paymentBridgeControlRouter.post('/payment-bridge/source-config', verifyPaymentBridge, async (req: RawBridgeRequest, res: Response) => {
  const device = (req as any).paymentDevice;
  const sourceId = String(req.body?.sourceId || '').trim();
  if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });

  const { data: assignment, error: assignmentError } = await supabaseServer
    .from('payment_device_sources')
    .select('payment_source_id,enabled,payment_sources(*)')
    .eq('device_id', device.id)
    .eq('payment_source_id', sourceId)
    .eq('enabled', true)
    .maybeSingle();

  if (assignmentError) return res.status(503).json({ error: 'Payment source assignment service unavailable' });
  const source = assignment?.payment_sources as any;
  if (!assignment || !source) return res.status(403).json({ error: 'Source is not assigned to this device' });

  const packageNames = Array.isArray(req.body?.packageNames)
    ? req.body.packageNames.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 10)
    : [];
  if (packageNames.length === 0) return res.status(400).json({ error: 'At least one application package is required' });

  const parserType = String(req.body?.parserType || source.parser_type || 'regex').trim();
  const allowedParserTypes = new Set(['regex', 'json', 'keyword', 'smart', 'generic_notification', 'generic_sms', 'vf_cash_v1', 'bank_alahly_v1']);
  if (!allowedParserTypes.has(parserType)) return res.status(400).json({ error: 'Unsupported parser type' });

  const optionalText = (value: unknown, max: number) => {
    const text = String(value || '').trim();
    return text ? text.slice(0, max) : null;
  };
  const amountRegex = optionalText(req.body?.amountRegex, 1000);
  const payerPhoneRegex = optionalText(req.body?.payerPhoneRegex, 1000);
  const accountIdentifierRegex = optionalText(req.body?.accountIdentifierRegex, 1000);

  for (const pattern of [amountRegex, payerPhoneRegex, accountIdentifierRegex]) {
    if (!pattern) continue;
    try {
      new RegExp(pattern);
    } catch {
      return res.status(400).json({ error: 'One of the parser regular expressions is invalid' });
    }
  }

  const updates = {
    source_package: packageNames[0],
    source_packages: packageNames,
    source_sender: optionalText(req.body?.sourceSender, 250),
    title_contains: optionalText(req.body?.titleContains, 500),
    body_contains: optionalText(req.body?.bodyContains, 500),
    amount_regex: amountRegex,
    payer_phone_regex: payerPhoneRegex,
    account_identifier_regex: accountIdentifierRegex,
    parser_type: parserType,
    updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabaseServer
    .from('payment_sources')
    .update(updates)
    .eq('id', sourceId);

  if (updateError) return res.status(503).json({ error: 'Could not save payment source parser configuration' });

  const { rulesVersion, rules } = await fetchDeviceRules(device.id, device);
  return res.json({
    status: 'ok',
    sourceId,
    sourceEnabled: Boolean(source.enabled),
    rulesVersion,
    rules,
  });
});

// Mounted before paymentOrchestration.ts so this route is authoritative.
// Provider enablement is read from admin3, never overwritten by routine heartbeat.
paymentBridgeControlRouter.post('/payment-bridge/heartbeat', verifyPaymentBridge, async (req: RawBridgeRequest, res: Response) => {
  const device = (req as any).paymentDevice;
  const now = new Date().toISOString();

  const { data, error } = await supabaseServer
    .from('payment_devices')
    .update({
      online: true,
      internet_connected: req.body?.internetConnected !== false,
      app_running: req.body?.appRunning !== false,
      notification_listener_enabled: Boolean(req.body?.notificationListenerEnabled),
      app_version: req.body?.appVersion ? String(req.body.appVersion) : null,
      last_heartbeat_at: now,
      updated_at: now,
    })
    .eq('id', device.id)
    .select('device_id,is_busy,busy_session_id,last_heartbeat_at,vf_cash_enabled,bank_alahly_enabled')
    .single();

  if (error) return res.status(503).json({ error: 'Heartbeat could not be stored' });

  const { rulesVersion, rules } = await fetchDeviceRules(device.id, data);

  const result = {
    status: 'ok',
    online: true,
    busy: Boolean(data.is_busy),
    busySessionId: data.busy_session_id || null,
    vfCashEnabled: Boolean(data.vf_cash_enabled),
    bankAlAhlyEnabled: Boolean(data.bank_alahly_enabled),
    activeRulesCount: rules.length,
    rulesVersion,
    serverTime: Date.now(),
  };
  broadcastRealtimeEvent('payment_device_heartbeat', { deviceId: data.device_id, ...result });
  return res.json(result);
});

// Device-side mutation of vfCashEnabled/bankAlAhlyEnabled is deprecated and disabled.
// Source assignment and provider enablement are authoritative in Admin3.
// Device requests return the authoritative state from Admin3 without mutating it.
paymentBridgeControlRouter.post('/payment-bridge/config', verifyPaymentBridge, async (req: RawBridgeRequest, res: Response) => {
  const device = (req as any).paymentDevice;

  // Retrieve current authoritative state from database without overwriting with device's payload
  const { data, error } = await supabaseServer
    .from('payment_devices')
    .select('device_id,vf_cash_enabled,bank_alahly_enabled,is_busy,busy_session_id')
    .eq('id', device.id)
    .single();

  if (error || !data) return res.status(503).json({ error: 'Device configuration could not be read' });

  const result = {
    status: 'ok',
    message: 'Configuration is managed authoritatively by Admin3. Device-side mutations are ignored.',
    deviceId: data.device_id,
    vfCashEnabled: Boolean(data.vf_cash_enabled),
    bankAlAhlyEnabled: Boolean(data.bank_alahly_enabled),
    busy: Boolean(data.is_busy),
    busySessionId: data.busy_session_id || null,
  };
  return res.json(result);
});
