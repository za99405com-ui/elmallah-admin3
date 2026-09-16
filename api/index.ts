import express from 'express';
import { router as apiRouter } from '../server/api.js';
import { paymentRouter } from '../server/paymentOrchestration.js';
import { paymentIntegrationConfigRouter } from '../server/paymentIntegrationConfig.js';
import { paymentBridgeControlRouter } from '../server/paymentBridgeControl.js';

const app = express();

/*
 * Vercel sends every nested /api/* request to this single function.
 * Restore the original API pathname before Express routing.
 */
app.use((req, _res, next) => {
  const url = new URL(req.url, 'http://localhost');
  const rewrittenPath = url.searchParams.get('__vercel_path');

  if (rewrittenPath) {
    url.searchParams.delete('__vercel_path');
    const query = url.searchParams.toString();

    req.url =
      `/api/${rewrittenPath}` +
      (query ? `?${query}` : '');
  }

  next();
});

app.set('trust proxy', 1);

const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isOriginAllowed(
  origin: string | undefined,
  hostHeader: string | undefined
): boolean {
  if (!origin) return true;

  if (configuredOrigins.includes(origin)) {
    return true;
  }

  if (process.env.APP_URL) {
    try {
      if (new URL(process.env.APP_URL).origin === new URL(origin).origin) {
        return true;
      }
    } catch {}
  }

  try {
    const originUrl = new URL(origin);
    if (hostHeader && originUrl.host === hostHeader) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = isOriginAllowed(origin, req.headers.host);

  res.header('Vary', 'Origin');
  res.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, PATCH, OPTIONS'
  );
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, X-Accel-Buffering, X-Integration-Key, X-Payment-Session-Token, X-Device-Id, X-Timestamp, X-Nonce, X-Body-Hash, X-Signature'
  );

  if (origin && allowed) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(origin && !allowed ? 403 : 204);
  }

  next();
});

app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'almallah-admin-backend',
    runtime: 'vercel',
    timestamp: new Date().toISOString(),
  });
});

// Keep the same authoritative route order as server.ts.
// Global payment policy must run before the legacy order API.
app.use('/api', paymentIntegrationConfigRouter);
app.use('/api', apiRouter);

// Bridge control must run before the broader payment router so heartbeat/config
// remain authoritative, while payment events still share the same HMAC verifier.
app.use('/api', paymentBridgeControlRouter);
app.use('/api', paymentRouter);

export default app;
