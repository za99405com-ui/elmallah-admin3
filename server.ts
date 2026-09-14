import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { router as apiRouter } from './server/api';

function getValidPort(): number {
  if (process.env.PORT) {
    const parsed = Number(process.env.PORT);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
    console.warn(`[Almallah Server] Invalid PORT environment variable "${process.env.PORT}", defaulting to 3000.`);
  }
  return 3000;
}

async function startServer() {
  const app = express();
  const PORT = getValidPort();

  // Configure reverse proxy trust for canonical req.ip derivation
  app.set('trust proxy', 1);

  // CORS Hardening
  const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  function isOriginAllowed(
    origin: string | undefined,
    hostHeader: string | undefined,
    forwardedHost?: string | string[]
  ): boolean {
    if (!origin) {
      // Same-origin request without Origin header
      return true;
    }

    // Sandboxed iframes (e.g. AI Studio preview iframe) send 'null' as origin
    if (origin === 'null') {
      return true;
    }

    if (configuredOrigins.includes(origin)) {
      return true;
    }

    try {
      const originUrl = new URL(origin);
      const originHost = originUrl.host.toLowerCase();
      const originHostname = originUrl.hostname.toLowerCase();

      // Check host header match
      if (hostHeader && (originHost === hostHeader.toLowerCase() || originHostname === hostHeader.toLowerCase().split(':')[0])) {
        return true;
      }

      // Check x-forwarded-host match
      const fHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
      if (fHost && (originHost === fHost.toLowerCase() || originHostname === fHost.toLowerCase().split(':')[0])) {
        return true;
      }

      // Allow any Cloud Run application (*.run.app)
      if (originHostname.endsWith('.run.app') || originHostname === 'run.app') {
        return true;
      }

      // Allow Google AI Studio and Google domains
      if (
        originHostname.endsWith('.google.com') ||
        originHostname === 'google.com' ||
        originHostname.endsWith('.googleusercontent.com') ||
        originHostname.endsWith('.ai.studio') ||
        originHostname === 'ai.studio'
      ) {
        return true;
      }

      // Allow local development
      if (
        originHostname === 'localhost' ||
        originHostname === '127.0.0.1' ||
        originHostname === '0.0.0.0'
      ) {
        return true;
      }

      if (process.env.APP_URL) {
        try {
          const appUrlObj = new URL(process.env.APP_URL);
          if (appUrlObj.origin === originUrl.origin) {
            return true;
          }
        } catch {}
      }
    } catch {
      return false;
    }

    return false;
  }

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const forwardedHost = req.headers['x-forwarded-host'];

    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, X-Accel-Buffering');

    const allowed = isOriginAllowed(origin, host, forwardedHost);
    if (origin && (allowed || process.env.NODE_ENV !== 'production')) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'almallah-admin-backend',
      timestamp: new Date().toISOString(),
    });
  });

  // Mount API router FIRST
  app.use('/api', apiRouter);

  // Mount Vite middleware in development or serve static in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`[Almallah Server] Running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('[Almallah Server] Startup failed:', err);
  process.exit(1);
});
