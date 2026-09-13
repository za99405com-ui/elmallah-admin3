import express from 'express';
import { router as apiRouter } from '../server/api';

const app = express();

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
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Integration-Key'
  );

  if (origin && allowed) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(origin && !allowed ? 403 : 204);
  }

  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'almallah-admin-backend',
    runtime: 'vercel',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', apiRouter);

export default app;
