import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { db } from './db';
import { supabaseServer } from './supabase';

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

    // Look up trusted local admin record to retrieve role from database only
    const localAdmin = db.prepare('SELECT id, name, role, avatar_url FROM admins WHERE email = ?').get(email) as
      | { id: string; name: string; role: string; avatar_url?: string }
      | undefined;

    if (!localAdmin) {
      return res.status(403).json({
        error: 'غير مصرح: هذا الحساب ليس لديه صلاحيات وصول مسجلة في قاعدة بيانات الإدارة.',
      });
    }

    // Role MUST come strictly from the trusted database, NEVER from user_metadata
    const validatedRole: 'super_admin' | 'manager' | 'operator' =
      localAdmin.role === 'super_admin' || localAdmin.role === 'manager' || localAdmin.role === 'operator'
        ? (localAdmin.role as 'super_admin' | 'manager' | 'operator')
        : 'operator';

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
  try {
    const id = `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO audit_logs (id, admin_id, admin_name, admin_email, action, entity_type, entity_id, old_values, new_values, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      admin?.id || 'system',
      admin?.name || 'النظام',
      admin?.email || 'system@almallah.com',
      action,
      entityType,
      entityId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ipAddress || 'unknown',
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Audit log write error:', err);
  }
}
