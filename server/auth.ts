import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { supabaseServer } from './supabase.js';

export interface AdminPayload {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'manager' | 'operator';
  avatarUrl?: string;
}

export interface AuthenticatedRequest extends Request {
  admin?: AdminPayload;
}

// Rate Limiting (Brute force protection for login)
interface RateLimitRecord {
  failedAttempts: number;
  blockedUntil: number;
}
const rateLimits = new Map<string, RateLimitRecord>();

export function checkRateLimit(key: string): { allowed: boolean; waitSeconds?: number } {
  const now = Date.now();
  const record = rateLimits.get(key);
  if (!record) return { allowed: true };

  if (record.blockedUntil > now) {
    const waitSeconds = Math.ceil((record.blockedUntil - now) / 1000);
    return { allowed: false, waitSeconds };
  }

  if (record.blockedUntil > 0 && record.blockedUntil <= now) {
    rateLimits.delete(key);
  }
  return { allowed: true };
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const record = rateLimits.get(key) || { failedAttempts: 0, blockedUntil: 0 };
  record.failedAttempts += 1;

  if (record.failedAttempts >= 5) {
    record.blockedUntil = now + 15 * 60 * 1000;
  }
  rateLimits.set(key, record);
}

export function clearRateLimit(key: string): void {
  rateLimits.delete(key);
}

export function checkLoginRateLimit(email: string, clientIp?: string): { allowed: boolean; waitSeconds?: number } {
  const emailCheck = checkRateLimit(`login:email:${email}`);
  if (!emailCheck.allowed) {
    return emailCheck;
  }

  if (clientIp && clientIp !== 'unknown') {
    const ipCheck = checkRateLimit(`login:ip:${clientIp}`);
    if (!ipCheck.allowed) {
      return ipCheck;
    }
  }

  return { allowed: true };
}

export function recordFailedLogin(email: string, clientIp?: string): void {
  recordFailedAttempt(`login:email:${email}`);
  if (clientIp && clientIp !== 'unknown') {
    recordFailedAttempt(`login:ip:${clientIp}`);
  }
}

export function clearLoginRateLimit(email: string, clientIp?: string): void {
  clearRateLimit(`login:email:${email}`);
  if (clientIp && clientIp !== 'unknown') {
    clearRateLimit(`login:ip:${clientIp}`);
  }
}

// Dedicated Rate Limiting for Public Order Creation (max 5 orders per 10 minutes)
interface OrderRateLimitRecord {
  timestamps: number[];
}
const orderRateLimits = new Map<string, OrderRateLimitRecord>();
let lastOrderRateLimitCleanup = Date.now();

function cleanupStaleOrderRateLimits(now: number, windowMs: number): void {
  // Opportunistic cleanup: run at most once per 60 seconds or if map grows large (> 500 entries)
  if (now - lastOrderRateLimitCleanup < 60 * 1000 && orderRateLimits.size < 500) {
    return;
  }
  lastOrderRateLimitCleanup = now;

  for (const [key, record] of orderRateLimits.entries()) {
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);
    if (record.timestamps.length === 0) {
      orderRateLimits.delete(key);
    }
  }
}

export function checkOrderRateLimit(keys: string[]): boolean {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxAttempts = 5;

  cleanupStaleOrderRateLimits(now, windowMs);

  for (const key of keys) {
    if (!key) continue;
    const record = orderRateLimits.get(key);
    if (record) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);
      if (record.timestamps.length === 0) {
        orderRateLimits.delete(key);
      } else if (record.timestamps.length >= maxAttempts) {
        return false;
      }
    }
  }
  return true;
}

export function recordOrderAttempt(keys: string[]): void {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;

  cleanupStaleOrderRateLimits(now, windowMs);

  for (const key of keys) {
    if (!key) continue;
    let record = orderRateLimits.get(key);
    if (!record) {
      record = { timestamps: [] };
      orderRateLimits.set(key, record);
    }
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);
    record.timestamps.push(now);
  }
}

/**
 * Authentication Middleware:
 * Strictly verifies the client session token against Supabase Auth.
 * Secures all dashboard endpoints using Supabase Auth Session.
 */
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'غير مصرح: يجب تسجيل الدخول عبر حساب Supabase للوصول إلى لوحة التحكم',
    });
  }

  const token = authHeader.split(' ')[1]?.trim();
  if (!token) {
    return res.status(401).json({
      error: 'غير مصرح: رمز جلسة Supabase مفقود',
    });
  }

  try {
    const { data, error } = await supabaseServer.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: 'انتهت صلاحية جلسة Supabase أو الرمز غير صالح. يرجى إعادة تسجيل الدخول.',
      });
    }

    const sbUser = data.user;
    const email = (sbUser.email || '').toLowerCase().trim();

    // Look up trusted admin record in Supabase to retrieve role from database only
    const { data: localAdmin, error: adminLookupError } = await supabaseServer
      .from('admins')
      .select('id, name, role, avatar_url')
      .eq('email', email)
      .maybeSingle();

    if (adminLookupError) {
      console.error('Supabase admin lookup failed:', adminLookupError.message);
      return res.status(503).json({
        error: 'تعذر التحقق من صلاحيات حساب الإدارة.',
      });
    }

    if (!localAdmin) {
      return res.status(403).json({
        error: 'غير مصرح: هذا الحساب ليس لديه صلاحيات وصول مسجلة في قاعدة بيانات الإدارة.',
      });
    }

    // Role MUST come strictly from the trusted database, NEVER from user_metadata and NEVER default
    const validRoles = ['super_admin', 'manager', 'operator'] as const;
    type AdminRole = (typeof validRoles)[number];

    if (!localAdmin.role || !validRoles.includes(localAdmin.role as AdminRole)) {
      return res.status(403).json({
        error: 'غير مصرح: دور الحساب غير صالح أو غير معتمد في لوحة الإدارة.',
      });
    }

    const validatedRole: AdminRole = localAdmin.role as AdminRole;

    const payload: AdminPayload = {
      id: localAdmin.id || sbUser.id,
      name: localAdmin.name || email.split('@')[0] || 'كابتن زياد الملاح (المدير العام)',
      email,
      role: validatedRole,
      avatarUrl:
        localAdmin.avatar_url ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
    };

    req.admin = payload;
    return next();
  } catch (err) {
    return res.status(401).json({
      error: 'تعذر التحقق من جلسة Supabase، يرجى إعادة المحاولة',
    });
  }
}

/**
 * Role Authorization Middleware
 */
export function requireRole(allowedRoles: Array<'super_admin' | 'manager' | 'operator'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.admin) {
      return res.status(401).json({ error: 'غير مصرح' });
    }

    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({
        error: `ليس لديك الصلاحية الكافية لتنفيذ هذا الإجراء (${req.admin.role}). مطلوب: ${allowedRoles.join(' أو ')}`,
      });
    }

    next();
  };
}

/**
 * Audit Logging
 */
export function logAuditAction(
  admin: AdminPayload | undefined,
  action: string,
  entityType: string,
  entityId: string,
  oldValues?: unknown,
  newValues?: unknown,
  ipAddress?: string
) {
  const id = `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  void (async () => {
    try {
      const { error } = await supabaseServer
        .from('audit_logs')
        .insert({
          id,
          admin_id: admin?.id || 'system',
          admin_name: admin?.name || 'النظام',
          admin_email: admin?.email || 'system@almallah.com',
          action,
          entity_type: entityType,
          entity_id: entityId,
          old_values: oldValues ? JSON.stringify(oldValues) : null,
          new_values: newValues ? JSON.stringify(newValues) : null,
          ip_address: ipAddress || 'unknown',
          created_at: new Date().toISOString(),
        });

      if (error) {
        console.error('Supabase audit log write error:', error.message);
      }
    } catch (err) {
      console.error('Supabase audit log write error:', err);
    }
  })();
}
