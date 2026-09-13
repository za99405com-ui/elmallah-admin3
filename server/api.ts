import express, { Request, Response, Router } from 'express';
import crypto from 'node:crypto';
import {
  requireAuth,
  requireRole,
  AuthenticatedRequest,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
  checkOrderRateLimit,
  recordOrderAttempt,
  logAuditAction,
} from './auth.js';
import { addRealtimeClient, broadcastRealtimeEvent } from './realtime.js';

export const router = Router();

import { supabaseAuthClient, supabaseServer } from './supabase.js';

// Safe numeric validation helper
function parseAndValidateNumber(
  value: unknown,
  fieldName: string,
  options: {
    min?: number;
    max?: number;
    integerOnly?: boolean;
    allowNull?: boolean;
  } = {}
): { valid: boolean; value?: number; error?: string } {
  if (value === undefined || (options.allowNull && value === null)) {
    return { valid: true };
  }
  if (typeof value === 'boolean') {
    return { valid: false, error: `الحقل ${fieldName} يجب أن يكون رقماً صالحاً` };
  }
  if (typeof value === 'string' && value.trim() === '') {
    return { valid: false, error: `الحقل ${fieldName} غير صالح` };
  }
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) {
    return { valid: false, error: `الحقل ${fieldName} يجب أن يكون رقماً صالحاً` };
  }
  if (options.min !== undefined && num < options.min) {
    return { valid: false, error: `الحقل ${fieldName} لا يمكن أن يقل عن ${options.min}` };
  }
  if (options.max !== undefined && num > options.max) {
    return { valid: false, error: `الحقل ${fieldName} لا يمكن أن يزيد عن ${options.max}` };
  }
  if (options.integerOnly && !Number.isInteger(num)) {
    return { valid: false, error: `الحقل ${fieldName} يجب أن يكون رقماً صحيحاً` };
  }
  return { valid: true, value: num };
}

// ==========================================
// 1. ADMIN AUTHENTICATION (PURE SUPABASE AUTH)
// ==========================================

// POST /api/admin/auth/login
router.post('/admin/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const clientIp = req.ip || 'unknown';

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || password.length === 0) {
    return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const rateLimitCheck = checkLoginRateLimit(normalizedEmail, clientIp);
  if (!rateLimitCheck.allowed) {
    return res.status(429).json({
      error: `تم تجاوز محاولات الدخول. يرجى الانتظار ${rateLimitCheck.waitSeconds} ثانية قبل المحاولة مجدداً`,
    });
  }

  try {
    const sbDataResult = await supabaseAuthClient.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (!sbDataResult.error && sbDataResult.data?.user && sbDataResult.data?.session) {
      const user = sbDataResult.data.user;

      const { data: adminRow, error: adminError } = await supabaseServer
        .from('admins')
        .select('id, name, email, role, avatar_url')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (adminError) {
        console.error('Supabase admin lookup failed:', adminError.message);
        return res.status(503).json({ error: 'تعذر التحقق من صلاحيات الحساب' });
      }

      if (!adminRow) {
        return res.status(403).json({
          error: 'غير مصرح: هذا الحساب ليس لديه صلاحيات وصول مسجلة في لوحة الإدارة.',
        });
      }

      const validRoles = ['super_admin', 'manager', 'operator'] as const;
      type AdminRole = (typeof validRoles)[number];

      if (!adminRow.role || !validRoles.includes(adminRow.role as AdminRole)) {
        return res.status(403).json({
          error: 'غير مصرح: دور الحساب غير صالح أو غير معتمد في لوحة الإدارة.',
        });
      }

      clearLoginRateLimit(normalizedEmail, clientIp);

      const role = adminRow.role as AdminRole;

      const payload = {
        id: adminRow.id || user.id,
        name:
          adminRow.name ||
          normalizedEmail.split('@')[0] ||
          'كابتن زياد الملاح (المدير العام)',
        email: adminRow.email || user.email || normalizedEmail,
        role,
        avatarUrl:
          adminRow.avatar_url ||
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
      };

      const { error: lastLoginError } = await supabaseServer
        .from('admins')
        .update({ last_login: new Date().toISOString() })
        .eq('email', normalizedEmail);

      if (lastLoginError) {
        console.error('Supabase admin last_login update failed:', lastLoginError.message);
      }

      logAuditAction(
        payload,
        'login_supabase',
        'admin',
        user.id,
        null,
        { email: user.email, role },
        String(clientIp)
      );

      return res.json({
        token: sbDataResult.data.session.access_token,
        session: sbDataResult.data.session,
        admin: payload,
      });
    }
  } catch {
    // Authentication/network failure is handled below.
  }

  recordFailedLogin(normalizedEmail, clientIp);

  return res.status(401).json({
    error: 'بيانات الدخول غير صحيحة. يرجى التأكد من البريد الإلكتروني وكلمة المرور المسجلة في Supabase.',
  });
});

// GET /api/admin/auth/me
router.get('/admin/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  return res.json({ admin: req.admin });
});

// POST /api/admin/auth/change-password (Via Supabase Admin)
router.post('/admin/auth/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' });
  }

  try {
    const { error } = await supabaseServer.auth.admin.updateUserById(req.admin!.id, {
      password: newPassword,
    });

    if (error) {
      return res.status(400).json({ error: error.message || 'فشل تحديث كلمة المرور في Supabase' });
    }

    logAuditAction(req.admin, 'change_password_supabase', 'admin', req.admin!.id, null, null, req.ip);
    return res.json({ message: 'تم تحديث كلمة المرور بنجاح في حساب Supabase' });
  } catch (err) {
    return res.status(500).json({ error: 'تعذر الاتصال بـ Supabase لتحديث كلمة المرور' });
  }
});

// GET /api/admin/auth/admins (Super Admin only)
router.get('/admin/auth/admins', requireAuth, requireRole(['super_admin']), async (_req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabaseServer
    .from('admins')
    .select('id, name, email, role, avatar_url, created_at, last_login')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase admins read failed:', error.message);
    return res.status(503).json({ error: 'تعذر تحميل المستخدمين الإداريين' });
  }

  return res.json(data || []);
});

// POST /api/admin/auth/admins
router.post('/admin/auth/admins', requireAuth, requireRole(['super_admin']), async (req: AuthenticatedRequest, res: Response) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  const ALLOWED_ADMIN_ROLES = ['super_admin', 'manager', 'operator'] as const;
  type AllowedAdminRole = (typeof ALLOWED_ADMIN_ROLES)[number];

  if (typeof role !== 'string' || !ALLOWED_ADMIN_ROLES.includes(role as AllowedAdminRole)) {
    return res.status(400).json({
      error: 'الدور المحدد غير صالح. الأدوار المسموح بها فقط: super_admin, manager, operator',
    });
  }

  if (typeof email !== 'string') {
    return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صحيحة' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const cleanName = typeof name === 'string' ? name.trim() : String(name);

  if (!normalizedEmail) {
    return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
  }

  const { data: existingAdmin, error: lookupError } = await supabaseServer
    .from('admins')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (lookupError) {
    console.error('Supabase admin duplicate check failed:', lookupError.message);
    return res.status(503).json({ error: 'تعذر التحقق من البريد الإلكتروني' });
  }

  if (existingAdmin) {
    return res.status(409).json({ error: 'البريد الإلكتروني مسجل بالفعل لمسؤول آخر' });
  }

  const validatedRole = role as AllowedAdminRole;

  try {
    const { data, error } = await supabaseServer.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { name: cleanName },
    });

    if (error) {
      return res.status(400).json({ error: error.message || 'فشل إنشاء المستخدم في Supabase' });
    }

    if (!data?.user?.id) {
      return res.status(500).json({ error: 'لم يتم استرجاع معرف المستخدم من Supabase' });
    }

    const id = data.user.id;
    const createdAt = new Date().toISOString();
    const avatarUrl =
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80';

    const { error: insertError } = await supabaseServer
      .from('admins')
      .insert({
        id,
        name: cleanName,
        email: normalizedEmail,
        role: validatedRole,
        avatar_url: avatarUrl,
        created_at: createdAt,
      });

    if (insertError) {
      try {
        await supabaseServer.auth.admin.deleteUser(id);
      } catch {
        // Best-effort cleanup.
      }

      console.error('Supabase admin profile insert failed:', insertError.message);
      return res.status(500).json({ error: 'فشل حفظ بيانات المسؤول' });
    }

    logAuditAction(
      req.admin,
      'create_admin_supabase',
      'admin',
      id,
      null,
      { email: normalizedEmail, role: validatedRole },
      req.ip
    );

    return res.status(201).json({
      id,
      name: cleanName,
      email: normalizedEmail,
      role: validatedRole,
    });
  } catch {
    return res.status(500).json({ error: 'حدث خطأ أثناء إنشاء المستخدم في Supabase' });
  }
});

// DELETE /api/admin/auth/admins/:id
router.delete('/admin/auth/admins/:id', requireAuth, requireRole(['super_admin']), async (req: AuthenticatedRequest, res: Response) => {
  const targetId = req.params.id;

  if (targetId === req.admin!.id) {
    return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });
  }

  const { data: existing, error: lookupError } = await supabaseServer
    .from('admins')
    .select('*')
    .eq('id', targetId)
    .maybeSingle();

  if (lookupError) {
    console.error('Supabase admin delete lookup failed:', lookupError.message);
    return res.status(503).json({ error: 'تعذر تحميل بيانات المستخدم الإداري' });
  }

  if (!existing) {
    return res.status(404).json({ error: 'المستخدم الإداري غير موجود' });
  }

  const { error: authDeleteError } = await supabaseServer.auth.admin.deleteUser(targetId);

  if (authDeleteError) {
    console.error('Supabase Auth admin delete failed:', authDeleteError.message);
    return res.status(503).json({ error: 'تعذر حذف حساب المستخدم من نظام المصادقة' });
  }

  const { error: profileDeleteError } = await supabaseServer
    .from('admins')
    .delete()
    .eq('id', targetId);

  if (profileDeleteError) {
    console.error('Supabase admin profile delete failed:', profileDeleteError.message);
    return res.status(503).json({
      error: 'تم حذف حساب المصادقة لكن تعذر حذف سجل المسؤول. يرجى مراجعة قاعدة البيانات.',
    });
  }

  logAuditAction(
    req.admin,
    'delete_admin_supabase',
    'admin',
    targetId,
    existing,
    null,
    req.ip
  );

  return res.json({ message: 'تم حذف المستخدم الإداري' });
});

// ==========================================
// 2. REALTIME SSE STREAM (SECURED VIA SUPABASE SESSION & LOCAL ADMIN)
// ==========================================
router.get('/admin/realtime', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  addRealtimeClient(clientId, res, req.admin!.id);
});

// ==========================================
// 3. DASHBOARD STATS
// ==========================================
router.get('/admin/dashboard/stats', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const now = new Date();
  const cutoffToday = new Date(now);

  if (now.getHours() < 3) {
    cutoffToday.setDate(cutoffToday.getDate() - 1);
  }

  cutoffToday.setHours(3, 0, 0, 0);
  const cutoffIso = cutoffToday.toISOString();

  const [
    totalOrdersResult,
    todayOrdersResult,
    statusResult,
    pendingDepositsResult,
    totalSalesResult,
    customersResult,
    productsResult,
    variantsResult,
    activeOrdersResult,
  ] = await Promise.all([
    supabaseServer.from('orders').select('id', { count: 'exact', head: true }),

    supabaseServer
      .from('orders')
      .select('total_amount')
      .gte('created_at', cutoffIso),

    supabaseServer
      .from('orders')
      .select('status'),

    supabaseServer
      .from('orders')
      .select('deposit_amount')
      .eq('deposit_status', 'pending'),

    supabaseServer
      .from('orders')
      .select('total_amount')
      .neq('status', 'cancelled'),

    supabaseServer.from('customers').select('id', { count: 'exact', head: true }),

    supabaseServer.from('products').select('id', { count: 'exact', head: true }),

    supabaseServer.from('product_variants').select('id', { count: 'exact', head: true }),

    supabaseServer
      .from('orders')
      .select('id')
      .in('status', ['pending', 'preparing']),
  ]);

  const resultsWithErrors = [
    totalOrdersResult,
    todayOrdersResult,
    statusResult,
    pendingDepositsResult,
    totalSalesResult,
    customersResult,
    productsResult,
    variantsResult,
    activeOrdersResult,
  ];

  const failed = resultsWithErrors.find((result) => result.error);

  if (failed?.error) {
    console.error('Supabase dashboard stats failed:', failed.error.message);
    return res.status(503).json({ error: 'تعذر تحميل إحصائيات لوحة التحكم' });
  }

  const todayOrders = todayOrdersResult.data || [];
  const statusRows = statusResult.data || [];
  const pendingDeposits = pendingDepositsResult.data || [];
  const salesOrders = totalSalesResult.data || [];

  const statusCounts: Record<string, number> = {};
  for (const row of statusRows) {
    const status = String(row.status || '');
    if (status) statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  const todaySales = todayOrders.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0
  );

  const pendingDepositsAmount = pendingDeposits.reduce(
    (sum, row) => sum + Number(row.deposit_amount || 0),
    0
  );

  const totalSales = salesOrders.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0
  );

  let activeDemandsCount = 0;
  const activeOrderIds = (activeOrdersResult.data || []).map((o) => o.id);

  if (activeOrderIds.length > 0) {
    const { data: demandItems, error: demandError } = await supabaseServer
      .from('order_items')
      .select('product_id')
      .in('order_id', activeOrderIds);

    if (demandError) {
      console.error('Supabase active demands stats failed:', demandError.message);
      return res.status(503).json({ error: 'تعذر تحميل الطلبات النشطة' });
    }

    activeDemandsCount = new Set(
      (demandItems || []).map((item) => String(item.product_id))
    ).size;
  }

  return res.json({
    totalOrders: totalOrdersResult.count || 0,
    todayOrders: todayOrders.length,
    pendingOrders: statusCounts.pending || 0,
    preparingOrders: statusCounts.preparing || 0,
    deliveringOrders: statusCounts.delivering || 0,
    completedOrders: statusCounts.completed || 0,
    cancelledOrders: statusCounts.cancelled || 0,
    pendingDepositsCount: pendingDeposits.length,
    pendingDepositsAmount,
    totalSales,
    todaySales,
    totalCustomers: customersResult.count || 0,
    totalProducts: productsResult.count || 0,
    activeDemandsCount,
    totalVariants: variantsResult.count || 0,
  });
});

// ==========================================
// 4. PRODUCTS & PRODUCT VARIANTS — SUPABASE
// ==========================================

function mapVariantRow(v: Record<string, unknown>) {
  return {
    id: v.id,
    productId: v.product_id,
    title: v.title,
    weightKg: v.weight_kg != null ? Number(v.weight_kg) : undefined,
    pieceCount: v.piece_count != null ? Number(v.piece_count) : undefined,
    approxPieceWeightG: v.approx_piece_weight_g != null ? Number(v.approx_piece_weight_g) : undefined,
    price: Number(v.price || 0),
    stockQuantity: Number(v.stock_quantity || 0),
    isActive: Boolean(v.is_active),
    sortOrder: Number(v.sort_order || 0),
    createdAt: v.created_at,
  };
}

function mapProductRow(
  p: Record<string, unknown>,
  categoryName = '',
  variants: Record<string, unknown>[] = []
) {
  return {
    id: p.id,
    name: p.name,
    description: p.description || '',
    categoryId: p.category_id,
    categoryName,
    pricingUnit: p.pricing_unit,
    price: Number(p.base_price || 0),
    stockQuantity: Number(p.stock_quantity || 0),
    inStock: Boolean(p.in_stock),
    imageUrl: p.image_url,
    isActive: Boolean(p.is_active),
    minOrderQuantity: p.min_order_quantity != null ? Number(p.min_order_quantity) : undefined,
    maxOrderQuantity: p.max_order_quantity != null ? Number(p.max_order_quantity) : undefined,
    sortOrder: Number(p.sort_order || 0),
    badge: p.badge,
    variants: variants.map(mapVariantRow),
    createdAt: p.created_at,
  };
}

async function getProductWithVariants(productId: string) {
  const { data: product, error } = await supabaseServer
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle();

  if (error) throw new Error(`PRODUCT_LOOKUP_FAILED:${error.message}`);
  if (!product) return null;

  const variantsResult = await supabaseServer
    .from('product_variants')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('weight_kg', { ascending: true })
    .order('piece_count', { ascending: true });

  if (variantsResult.error) throw new Error(`VARIANT_LOOKUP_FAILED:${variantsResult.error.message}`);

  let categoryName = '';
  if (product.category_id) {
    const categoryResult = await supabaseServer
      .from('categories')
      .select('name')
      .eq('id', product.category_id)
      .maybeSingle();

    if (categoryResult.error) throw new Error(`CATEGORY_LOOKUP_FAILED:${categoryResult.error.message}`);
    categoryName = categoryResult.data?.name || '';
  }

  return mapProductRow(
    product,
    categoryName,
    (variantsResult.data || []) as Record<string, unknown>[]
  );
}

router.get('/admin/products', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const [productsResult, variantsResult, categoriesResult] = await Promise.all([
    supabaseServer.from('products').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false }),
    supabaseServer.from('product_variants').select('*').order('sort_order', { ascending: true }).order('weight_kg', { ascending: true }).order('piece_count', { ascending: true }),
    supabaseServer.from('categories').select('id,name'),
  ]);

  const failed = [productsResult, variantsResult, categoriesResult].find((r) => r.error);
  if (failed?.error) {
    console.error('Supabase admin products read failed:', failed.error.message);
    return res.status(503).json({ error: 'تعذر تحميل المنتجات' });
  }

  const categoryNames = new Map((categoriesResult.data || []).map((c) => [String(c.id), String(c.name)]));
  const variantsByProduct = new Map<string, Record<string, unknown>[]>();
  for (const v of variantsResult.data || []) {
    const productId = String(v.product_id);
    const list = variantsByProduct.get(productId) || [];
    list.push(v as Record<string, unknown>);
    variantsByProduct.set(productId, list);
  }

  return res.json((productsResult.data || []).map((p) =>
    mapProductRow(p, categoryNames.get(String(p.category_id || '')) || '', variantsByProduct.get(String(p.id)) || [])
  ));
});

router.post('/admin/products', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const { name, description, categoryId, pricingUnit, price, imageUrl, badge, variants, minOrderQuantity, maxOrderQuantity, sortOrder } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'اسم المنتج والسعر الأساسي مطلوبان' });

  const priceCheck = parseAndValidateNumber(price, 'السعر الأساسي', { min: 0 });
  if (!priceCheck.valid) return res.status(400).json({ error: priceCheck.error });

  const productId = `prod-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const { error: productError } = await supabaseServer.from('products').insert({
    id: productId,
    name: String(name).trim(),
    description: description || '',
    category_id: categoryId || null,
    pricing_unit: pricingUnit || 'kg',
    base_price: priceCheck.value!,
    image_url: imageUrl || 'https://images.unsplash.com/photo-1534483509719-3feaee7c30da?auto=format&fit=crop&w=800&q=80',
    min_order_quantity: minOrderQuantity || null,
    max_order_quantity: maxOrderQuantity || null,
    sort_order: sortOrder || 0,
    badge: badge || null,
    is_active: true,
    created_at: now,
  });

  if (productError) {
    console.error('Supabase product create failed:', productError.message);
    return res.status(productError.code === '23505' ? 409 : 503).json({ error: 'تعذر إنشاء المنتج' });
  }

  if (Array.isArray(variants) && variants.length > 0) {
    const rows = variants.map((v, i) => ({
      id: `var-${Date.now()}-${i}-${crypto.randomBytes(2).toString('hex')}`,
      product_id: productId,
      title: v.title || `${v.pieceCount || 1} قطع / ${v.weightKg || 1} كجم`,
      weight_kg: Number(v.weightKg || 1),
      piece_count: Number(v.pieceCount || 1),
      approx_piece_weight_g: v.approxPieceWeightG ? Number(v.approxPieceWeightG) : null,
      price: Number(v.price || priceCheck.value!),
      is_active: true,
      sort_order: v.sortOrder || i,
      created_at: now,
    }));
    const { error } = await supabaseServer.from('product_variants').insert(rows);
    if (error) {
      await supabaseServer.from('products').delete().eq('id', productId);
      console.error('Supabase product variants create failed:', error.message);
      return res.status(503).json({ error: 'تعذر إنشاء أحجام المنتج' });
    }
  }

  const created = await getProductWithVariants(productId);
  logAuditAction(req.admin, 'create_product', 'product', productId, null, created, req.ip);
  broadcastRealtimeEvent('product_created', created);
  return res.status(201).json(created);
});

router.put('/admin/products/:id', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const productId = req.params.id;
  const existing = await getProductWithVariants(productId);
  if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });

  const { name, description, categoryId, pricingUnit, price, imageUrl, badge, isActive, variants } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = String(name).trim();
  if (description !== undefined) updates.description = description;
  if (categoryId !== undefined) updates.category_id = categoryId || null;
  if (pricingUnit !== undefined) updates.pricing_unit = pricingUnit;
  if (price !== undefined) {
    const v = parseAndValidateNumber(price, 'السعر الأساسي', { min: 0 });
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.base_price = v.value!;
  }
  if (imageUrl !== undefined) updates.image_url = imageUrl;
  if (badge !== undefined) updates.badge = badge || null;
  if (isActive !== undefined) updates.is_active = Boolean(isActive);

  if (Object.keys(updates).length > 0) {
    const { error } = await supabaseServer.from('products').update(updates).eq('id', productId);
    if (error) return res.status(503).json({ error: 'تعذر تعديل المنتج' });
  }

  if (Array.isArray(variants)) {
    const { data: currentVariants, error: currentError } = await supabaseServer.from('product_variants').select('id').eq('product_id', productId);
    if (currentError) return res.status(503).json({ error: 'تعذر تحميل أحجام المنتج' });

    const currentIds = new Set((currentVariants || []).map((v) => String(v.id)));
    const keepIds = new Set(variants.filter((v) => v.id && currentIds.has(String(v.id))).map((v) => String(v.id)));
    const removeIds = [...currentIds].filter((id) => !keepIds.has(id));
    if (removeIds.length > 0) {
      const { error } = await supabaseServer.from('product_variants').delete().in('id', removeIds);
      if (error) return res.status(503).json({ error: 'تعذر تحديث أحجام المنتج' });
    }

    const now = new Date().toISOString();
    const rows = variants.map((v, i) => ({
      id: v.id && currentIds.has(String(v.id)) ? String(v.id) : `var-${Date.now()}-${i}-${crypto.randomBytes(2).toString('hex')}`,
      product_id: productId,
      title: v.title || `${v.pieceCount || 1} قطع / ${v.weightKg || 1} كجم`,
      weight_kg: Number(v.weightKg || 1),
      piece_count: Number(v.pieceCount || 1),
      approx_piece_weight_g: v.approxPieceWeightG ? Number(v.approxPieceWeightG) : null,
      price: Number(v.price ?? existing.price),
      is_active: v.isActive !== false,
      sort_order: v.sortOrder || i,
      created_at: now,
    }));

    if (rows.length > 0) {
      const { error } = await supabaseServer.from('product_variants').upsert(rows, { onConflict: 'id' });
      if (error) return res.status(503).json({ error: 'تعذر تحديث أحجام المنتج' });
    }
  }

  const updated = await getProductWithVariants(productId);
  logAuditAction(req.admin, 'update_product', 'product', productId, existing, updated, req.ip);
  broadcastRealtimeEvent('product_updated', updated);
  return res.json(updated);
});

router.delete('/admin/products/:id', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const productId = req.params.id;
  const existing = await getProductWithVariants(productId);
  if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });

  const { error } = await supabaseServer.from('products').delete().eq('id', productId);
  if (error) return res.status(503).json({ error: 'تعذر حذف المنتج' });

  logAuditAction(req.admin, 'delete_product', 'product', productId, existing, null, req.ip);
  broadcastRealtimeEvent('product_deleted', { id: productId });
  return res.json({ message: 'تم حذف المنتج بنجاح' });
});

router.post('/admin/products/:id/variants', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const productId = req.params.id;
  const { data: product, error: productError } = await supabaseServer.from('products').select('id').eq('id', productId).maybeSingle();
  if (productError) return res.status(503).json({ error: 'تعذر تحميل المنتج' });
  if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });

  const { title, weightKg, pieceCount, approxPieceWeightG, price } = req.body;
  if (!title || price === undefined) return res.status(400).json({ error: 'اسم الحجم والسعر مطلوبان' });

  const priceCheck = parseAndValidateNumber(price, 'السعر', { min: 0 });
  if (!priceCheck.valid) return res.status(400).json({ error: priceCheck.error });

  const variantId = `var-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const { error } = await supabaseServer.from('product_variants').insert({
    id: variantId, product_id: productId, title: String(title).trim(),
    weight_kg: Number(weightKg || 1), piece_count: Number(pieceCount || 1),
    approx_piece_weight_g: approxPieceWeightG ? Number(approxPieceWeightG) : null,
    price: priceCheck.value!, is_active: true, created_at: new Date().toISOString(),
  });
  if (error) return res.status(503).json({ error: 'تعذر إنشاء الحجم' });

  const updatedProduct = await getProductWithVariants(productId);
  broadcastRealtimeEvent('product_updated', updatedProduct);
  return res.status(201).json({ id: variantId, productId, title, weightKg: Number(weightKg || 1), pieceCount: Number(pieceCount || 1), price: priceCheck.value! });
});

router.delete('/admin/products/:id/variants/:variantId', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const { id: productId, variantId } = req.params;
  const { data: existing, error: lookupError } = await supabaseServer.from('product_variants').select('id').eq('id', variantId).eq('product_id', productId).maybeSingle();
  if (lookupError) return res.status(503).json({ error: 'تعذر تحميل الحجم' });
  if (!existing) return res.status(404).json({ error: 'الحجم غير موجود' });

  const { error } = await supabaseServer.from('product_variants').delete().eq('id', variantId).eq('product_id', productId);
  if (error) return res.status(503).json({ error: 'تعذر حذف الحجم' });

  const updatedProduct = await getProductWithVariants(productId);
  broadcastRealtimeEvent('product_updated', updatedProduct);
  return res.json({ message: 'تم حذف الحجم بنجاح' });
});

// ==========================================
// 5. CATEGORIES
// ==========================================
router.get('/admin/categories', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const { data: rows, error } = await supabaseServer
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Supabase categories read failed:', error.message);
    return res.status(503).json({ error: 'تعذر تحميل التصنيفات' });
  }

  const { data: products, error: productsError } = await supabaseServer
    .from('products')
    .select('category_id');

  if (productsError) {
    console.error('Supabase category counts read failed:', productsError.message);
    return res.status(503).json({ error: 'تعذر تحميل التصنيفات' });
  }

  const counts = new Map<string, number>();
  for (const product of products || []) {
    const categoryId = String(product.category_id || '');
    if (categoryId) counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
  }

  return res.json(
    (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description || '',
      icon: r.icon,
      imageUrl: r.image_url,
      isActive: Boolean(r.is_active),
      sortOrder: r.sort_order,
      itemCount: counts.get(String(r.id)) || 0,
    }))
  );
});

router.post('/admin/categories', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const { name, slug, description, icon, imageUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم التصنيف مطلوب' });

  const catId = `cat-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const finalSlug = (slug || name)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0621-\u064A-]+/g, '');

  const { data: createdRow, error } = await supabaseServer
    .from('categories')
    .insert({
      id: catId,
      name: name.trim(),
      slug: finalSlug,
      description: description || '',
      icon: icon || 'Fish',
      image_url: imageUrl || null,
      is_active: true,
      sort_order: 0,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    console.error('Supabase category create failed:', error.message);

    if (error.code === '23505') {
      return res.status(409).json({ error: 'اسم أو رابط التصنيف مستخدم بالفعل' });
    }

    return res.status(503).json({ error: 'تعذر إنشاء التصنيف' });
  }

  const created = {
    id: createdRow.id,
    name: createdRow.name,
    slug: createdRow.slug,
    description: createdRow.description || '',
    icon: createdRow.icon,
    imageUrl: createdRow.image_url,
    isActive: Boolean(createdRow.is_active),
    sortOrder: Number(createdRow.sort_order || 0),
    itemCount: 0,
  };

  logAuditAction(req.admin, 'create_category', 'category', catId, null, created, req.ip);
  broadcastRealtimeEvent('category_created', created);

  return res.status(201).json(created);
});

router.put('/admin/categories/:id', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id;
  const { name, slug, description, icon, imageUrl, isActive, sortOrder } = req.body;

  const { data: existing, error: existingError } = await supabaseServer
    .from('categories')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (existingError) {
    console.error('Supabase category lookup failed:', existingError.message);
    return res.status(503).json({ error: 'تعذر تحميل التصنيف' });
  }

  if (!existing) {
    return res.status(404).json({ error: 'التصنيف غير موجود' });
  }

  const updates: Record<string, unknown> = {};

  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName) return res.status(400).json({ error: 'اسم التصنيف مطلوب' });
    updates.name = cleanName;
  }

  if (slug !== undefined || name !== undefined) {
    updates.slug = String(slug || name || existing.name)
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u0621-\u064A-]+/g, '');
  }

  if (description !== undefined) updates.description = description ?? '';
  if (icon !== undefined) updates.icon = icon;
  if (imageUrl !== undefined) updates.image_url = imageUrl || null;
  if (isActive !== undefined) updates.is_active = Boolean(isActive);
  if (sortOrder !== undefined) updates.sort_order = Number(sortOrder);

  const { data: updated, error: updateError } = await supabaseServer
    .from('categories')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (updateError) {
    console.error('Supabase category update failed:', updateError.message);

    if (updateError.code === '23505') {
      return res.status(409).json({ error: 'اسم أو رابط التصنيف مستخدم بالفعل' });
    }

    return res.status(503).json({ error: 'تعذر تحديث التصنيف' });
  }

  const { count, error: countError } = await supabaseServer
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', id);

  if (countError) {
    console.error('Supabase category product count failed:', countError.message);
  }

  const result = {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    description: updated.description || '',
    icon: updated.icon,
    imageUrl: updated.image_url,
    isActive: Boolean(updated.is_active),
    sortOrder: Number(updated.sort_order || 0),
    itemCount: count || 0,
  };

  logAuditAction(req.admin, 'update_category', 'category', id, existing, result, req.ip);
  broadcastRealtimeEvent('category_updated', result);

  return res.json(result);
});

router.delete('/admin/categories/:id', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id;

  const { data: existing, error: existingError } = await supabaseServer
    .from('categories')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (existingError) {
    console.error('Supabase category delete lookup failed:', existingError.message);
    return res.status(503).json({ error: 'تعذر تحميل التصنيف' });
  }

  if (!existing) {
    return res.status(404).json({ error: 'التصنيف غير موجود' });
  }

  const { error: deleteError } = await supabaseServer
    .from('categories')
    .delete()
    .eq('id', id);

  if (deleteError) {
    console.error('Supabase category delete failed:', deleteError.message);
    return res.status(503).json({ error: 'تعذر حذف التصنيف' });
  }

  logAuditAction(req.admin, 'delete_category', 'category', id, existing, null, req.ip);
  broadcastRealtimeEvent('category_deleted', { id });

  return res.json({ message: 'تم حذف التصنيف وفصل المنتجات المرتبطة بنجاح' });
});

// ==========================================
// 6. ORDERS & ORDER ITEMS — SUPABASE
// ==========================================

function parseSnapshotData(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

function mapOrderRow(order: Record<string, unknown>, items: Record<string, unknown>[] = []) {
  return {
    id: String(order.id), orderNumber: String(order.order_number),
    customerId: order.customer_id ? String(order.customer_id) : undefined,
    customerName: String(order.customer_name), customerPhone: String(order.customer_phone),
    customerAddress: String(order.customer_address), city: String(order.city || ''), district: String(order.district || ''),
    subtotal: Number(order.subtotal || 0), discountAmount: Number(order.discount_amount || 0),
    couponCode: order.coupon_code as string | null, deliveryFee: Number(order.delivery_fee || 0),
    totalAmount: Number(order.total_amount || 0), depositAmount: Number(order.deposit_amount || 0),
    depositStatus: String(order.deposit_status || 'not_required'), depositMethod: order.deposit_method as string | null,
    depositReference: order.deposit_reference as string | null, depositNotes: order.deposit_notes as string | null,
    depositConfirmedAt: order.deposit_confirmed_at as string | null, depositConfirmedBy: order.deposit_confirmed_by as string | null,
    remainingAmount: Number(order.remaining_amount || 0), status: String(order.status), notes: order.notes as string | null,
    items: items.map((i) => ({
      id: String(i.id), productId: String(i.product_id), productName: String(i.product_name),
      variantId: i.variant_id ? String(i.variant_id) : undefined, variantTitle: i.variant_title ? String(i.variant_title) : undefined,
      pricingUnit: String(i.pricing_unit), weightKg: i.weight_kg != null ? Number(i.weight_kg) : 0,
      pieceCount: i.piece_count != null ? Number(i.piece_count) : 0, unitPrice: Number(i.unit_price || 0),
      quantity: Number(i.quantity || 0), totalPrice: Number(i.total_price || 0), snapshotData: parseSnapshotData(i.snapshot_data),
    })),
    createdAt: String(order.created_at), updatedAt: String(order.updated_at),
  };
}

async function getOrderWithItems(orderId: string) {
  const { data: order, error } = await supabaseServer.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (error) throw new Error(`ORDER_LOOKUP_FAILED:${error.message}`);
  if (!order) return null;
  const { data: items, error: itemsError } = await supabaseServer.from('order_items').select('*').eq('order_id', orderId).order('created_at', { ascending: true });
  if (itemsError) throw new Error(`ORDER_ITEMS_LOOKUP_FAILED:${itemsError.message}`);
  return mapOrderRow(order, (items || []) as Record<string, unknown>[]);
}

async function verifyOrderItems(
  items: Array<Record<string, unknown>>, mode: 'admin' | 'public'
): Promise<{ error?: string; serviceError?: boolean; verifiedItems?: Array<Record<string, unknown>>; subtotal?: number }> {
  const productIds = [...new Set(items.map((item) => String(item.productId || '')).filter(Boolean))];
  if (productIds.length === 0) return { error: 'قائمة الأصناف غير صالحة' };
  const variantIds = [...new Set(items.map((item) => String(item.variantId || '')).filter(Boolean))];

  const productsResult = await supabaseServer.from('products')
    .select('id,name,base_price,pricing_unit,is_active,min_order_quantity,max_order_quantity').in('id', productIds);
  if (productsResult.error) return { serviceError: true, error: 'تعذر التحقق من المنتجات حالياً' };

  let variants: Record<string, unknown>[] = [];
  if (variantIds.length > 0) {
    const vr = await supabaseServer.from('product_variants').select('id,product_id,title,price,weight_kg,piece_count,is_active').in('id', variantIds);
    if (vr.error) return { serviceError: true, error: 'تعذر التحقق من أحجام المنتجات حالياً' };
    variants = (vr.data || []) as Record<string, unknown>[];
  }

  const productMap = new Map((productsResult.data || []).map((p) => [String(p.id), p as Record<string, unknown>]));
  const variantMap = new Map(variants.map((v) => [String(v.id), v]));
  let subtotal = 0;
  const verifiedItems: Array<Record<string, unknown>> = [];

  for (const item of items) {
    const productId = String(item.productId || '');
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: mode === 'public' ? `الكمية المطلوبة غير صالحة للصنف (${String(item.productName || productId)})` : `كمية غير صالحة للصنف (${String(item.productName || productId)})` };
    }

    const prod = productMap.get(productId);
    if (!prod) return { error: mode === 'public' ? `الصنف المطلوب غير موجود (${productId})` : `المنتج المحدد غير موجود (${productId})` };

    const productName = String(prod.name);
    const pricingUnit = String(prod.pricing_unit || 'kg');
    if (!Boolean(prod.is_active)) return { error: mode === 'public' ? `الصنف "${productName}" غير متاح حالياً للطلب` : `الصنف "${productName}" غير متاح حالياً` };
    if (pricingUnit === 'piece' && !Number.isInteger(quantity)) return { error: `الكمية المطلوبة للصنف "${productName}" بالقطعة ويجب أن تكون عدداً صحيحاً بدون كسور` };
    if (pricingUnit !== 'piece' && quantity < 0.05) return { error: `أقل كمية/وزن يمكن طلبه للصنف "${productName}" هو 0.05 كجم` };

    const minOrder = prod.min_order_quantity != null ? Number(prod.min_order_quantity) : null;
    const maxOrder = prod.max_order_quantity != null ? Number(prod.max_order_quantity) : null;
    const unitLabel = pricingUnit === 'piece' ? 'قطعة' : 'كجم';
    if (minOrder != null && minOrder > 0 && quantity < minOrder) return { error: `الحد الأدنى للطلب للصنف "${productName}" هو ${minOrder} ${unitLabel}` };
    if (maxOrder != null && maxOrder > 0 && quantity > maxOrder) return { error: `الحد الأقصى للطلب للصنف "${productName}" هو ${maxOrder} ${unitLabel}` };

    let unitPrice = Number(prod.base_price || 0);
    let variantTitle: string | undefined;
    let weightKg: number | undefined;
    let pieceCount: number | undefined;
    let variantId: string | undefined;

    if (item.variantId) {
      variantId = String(item.variantId);
      const variant = variantMap.get(variantId);
      if (!variant || String(variant.product_id) !== productId) return { error: mode === 'public' ? `الخيار أو الحجم المختار غير تابع للصنف ${productName}` : `الحجم المختار غير تابع للصنف "${productName}"` };
      if (!Boolean(variant.is_active)) return { error: mode === 'public' ? `الحجم "${String(variant.title)}" غير متاح حالياً للطلب` : `الحجم "${String(variant.title)}" غير متاح حالياً` };
      unitPrice = Number(variant.price || 0);
      variantTitle = String(variant.title);
      weightKg = variant.weight_kg != null ? Number(variant.weight_kg) : undefined;
      pieceCount = variant.piece_count != null ? Number(variant.piece_count) : undefined;
    }

    const totalPrice = Math.round(unitPrice * quantity * 100) / 100;
    subtotal += totalPrice;
    const snapshotData = { productId, variantId, productName, variantTitle, pricingUnit, weightKg, pieceCount, unitPrice, quantity, totalPrice };
    verifiedItems.push({ ...snapshotData, snapshotData });
  }

  return { verifiedItems, subtotal: Math.round(subtotal * 100) / 100 };
}

async function validateCouponForSubtotal(
  rawCode: unknown, subtotal: number
): Promise<{ error?: string; serviceError?: boolean; couponId?: string | null; cleanCode?: string | null; discountAmount?: number; coupon?: Record<string, unknown> }> {
  if (!rawCode) return { couponId: null, cleanCode: null, discountAmount: 0 };
  const cleanCode = String(rawCode).trim().toUpperCase();
  const { data: coupon, error } = await supabaseServer.from('coupons').select('*').ilike('code', cleanCode).maybeSingle();
  if (error) return { serviceError: true, error: 'تعذر التحقق من كود الخصم حالياً' };
  if (!coupon) return { error: `كود الخصم "${cleanCode}" غير صالح أو غير موجود` };
  if (!coupon.is_active) return { error: `كود الخصم "${cleanCode}" غير مفعّل حالياً` };
  if (coupon.expiry_date && new Date(String(coupon.expiry_date)) < new Date()) return { error: `كود الخصم "${cleanCode}" منتهي الصلاحية` };

  const minOrderValue = Number(coupon.min_order_value || 0);
  if (subtotal < minOrderValue) return { error: `الحد الأدنى لاستخدام كود الخصم هو ${minOrderValue} ج.م` };
  const usageLimit = coupon.usage_limit != null ? Number(coupon.usage_limit) : null;
  const usedCount = Number(coupon.used_count || 0);
  if (usageLimit !== null && usedCount >= usageLimit) return { error: `تم استنفاد الحد الأقصى لاستخدام كود الخصم "${cleanCode}"` };

  let discountAmount = 0;
  if (coupon.discount_type === 'percentage') {
    discountAmount = Math.round(((subtotal * Number(coupon.discount_value)) / 100) * 100) / 100;
    if (coupon.max_discount_value != null) discountAmount = Math.min(discountAmount, Number(coupon.max_discount_value));
  } else {
    discountAmount = Math.min(subtotal, Number(coupon.discount_value));
  }
  return { couponId: String(coupon.id), cleanCode, discountAmount, coupon };
}

router.get('/admin/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { status, depositStatus, search } = req.query;
  let query = supabaseServer.from('orders').select('*');
  if (status && status !== 'all') query = query.eq('status', String(status));
  if (depositStatus && depositStatus !== 'all') query = query.eq('deposit_status', String(depositStatus));
  if (search) {
    const term = String(search).replace(/[(),]/g, ' ').trim();
    if (term) query = query.or(`order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,deposit_reference.ilike.%${term}%`);
  }

  const { data: orders, error } = await query.order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(503).json({ error: 'تعذر تحميل الطلبات' });
  if (!orders || orders.length === 0) return res.json([]);

  const { data: items, error: itemsError } = await supabaseServer.from('order_items').select('*').in('order_id', orders.map((o) => String(o.id))).order('created_at', { ascending: true });
  if (itemsError) return res.status(503).json({ error: 'تعذر تحميل عناصر الطلبات' });

  const byOrder = new Map<string, Record<string, unknown>[]>();
  for (const item of items || []) {
    const id = String(item.order_id); const list = byOrder.get(id) || [];
    list.push(item as Record<string, unknown>); byOrder.set(id, list);
  }
  return res.json(orders.map((o) => mapOrderRow(o, byOrder.get(String(o.id)) || [])));
});

router.post('/admin/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { customerName, customerPhone, customerAddress, city, district, items, depositAmount, depositMethod, depositReference, depositStatus, notes, deliveryFee, couponCode } = req.body;
  if (!customerName || !customerPhone || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'اسم العميل، الهاتف، وقائمة الأصناف مطلوبة' });

  const verification = await verifyOrderItems(items as Array<Record<string, unknown>>, 'admin');
  if (verification.error) return res.status(verification.serviceError ? 503 : 400).json({ error: verification.error });
  const subtotal = verification.subtotal!;

  const couponResult = await validateCouponForSubtotal(couponCode, subtotal);
  if (couponResult.error) return res.status(couponResult.serviceError ? 503 : 400).json({ error: couponResult.error });

  const fee = deliveryFee !== undefined ? Number(deliveryFee) : 15;
  if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: 'سعر التوصيل غير صالح' });
  const totalAmount = Math.max(0, Math.round((subtotal - (couponResult.discountAmount || 0) + fee) * 100) / 100);
  const deposit = Number(depositAmount || 0);
  if (!Number.isFinite(deposit) || deposit < 0 || deposit > totalAmount) return res.status(400).json({ error: 'قيمة العربون غير صالحة' });

  const finalDepositStatus = depositStatus || (deposit > 0 ? 'confirmed' : 'pending');
  if (!['confirmed', 'pending', 'not_required', 'rejected'].includes(finalDepositStatus)) return res.status(400).json({ error: 'حالة العربون غير صالحة' });

  const now = new Date().toISOString();
  const remainingAmount = Math.max(0, Math.round((totalAmount - deposit) * 100) / 100);
  const payload = {
    customerName: String(customerName).trim(), customerPhone: String(customerPhone).trim(), customerAddress: customerAddress || '',
    city: city || 'القاهرة', district: district || '', subtotal, discountAmount: couponResult.discountAmount || 0,
    couponCode: couponResult.cleanCode, deliveryFee: fee, totalAmount, depositAmount: deposit, depositStatus: finalDepositStatus,
    depositMethod: depositMethod || 'instapay', depositReference: depositReference || null, depositNotes: null,
    depositConfirmedAt: finalDepositStatus === 'confirmed' ? now : null,
    depositConfirmedBy: finalDepositStatus === 'confirmed' ? req.admin!.name : null,
    remainingAmount, status: 'pending', notes: notes || null,
  };

  const { data: rpcData, error: rpcError } = await supabaseServer.rpc('create_order_atomic', {
    p_payload: payload, p_items: verification.verifiedItems, p_coupon_id: couponResult.couponId || null,
  });
  if (rpcError) {
    if (rpcError.message.includes('COUPON_NOT_AVAILABLE')) return res.status(400).json({ error: 'كود الخصم لم يعد متاحاً، يرجى إعادة المحاولة' });
    console.error('Supabase manual order RPC failed:', rpcError.message);
    return res.status(503).json({ error: 'حدث خطأ أثناء حفظ الطلب' });
  }

  const rpcOrder = (rpcData as { order?: Record<string, unknown> } | null)?.order;
  const orderId = rpcOrder?.id ? String(rpcOrder.id) : '';
  if (!orderId) return res.status(503).json({ error: 'تم إنشاء الطلب لكن تعذر تحميل رقمه' });

  const createdOrder = await getOrderWithItems(orderId);
  logAuditAction(req.admin, 'create_manual_order', 'order', orderId, null, { orderNumber: createdOrder?.orderNumber, totalAmount }, req.ip);
  broadcastRealtimeEvent('new_order', createdOrder);
  return res.status(201).json(createdOrder);
});

router.put('/admin/orders/:id/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const orderId = req.params.id; const { status } = req.body;
  if (!['pending', 'preparing', 'delivering', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'حالة الطلب غير صالحة' });
  const existing = await getOrderWithItems(orderId);
  if (!existing) return res.status(404).json({ error: 'الطلب غير موجود' });

  const { error } = await supabaseServer.from('orders').update({ status, updated_at: new Date().toISOString() }).eq('id', orderId);
  if (error) return res.status(503).json({ error: 'تعذر تحديث حالة الطلب' });

  const updated = await getOrderWithItems(orderId);
  logAuditAction(req.admin, 'update_order_status', 'order', orderId, { oldStatus: existing.status }, { newStatus: status }, req.ip);
  broadcastRealtimeEvent('order_status_updated', updated);
  return res.json(updated);
});

router.put('/admin/orders/:id/deposit', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const orderId = req.params.id;
  const { depositStatus, depositAmount, depositMethod, depositReference, depositNotes } = req.body;
  const existing = await getOrderWithItems(orderId);
  if (!existing) return res.status(404).json({ error: 'الطلب غير موجود' });

  const allowed = ['confirmed', 'pending', 'not_required', 'rejected'];
  if (depositStatus !== undefined && (typeof depositStatus !== 'string' || !allowed.includes(depositStatus))) {
    return res.status(400).json({ error: 'حالة العربون غير صالحة. الحالات المسموحة: مؤكد (confirmed)، قيد التحصيل (pending)، غير مطلوب (not_required)، مرفوض (rejected)' });
  }

  let newDepositAmount = existing.depositAmount;
  if (depositAmount !== undefined) {
    const val = parseAndValidateNumber(depositAmount, 'قيمة العربون', { min: 0 });
    if (!val.valid) return res.status(400).json({ error: val.error });
    const parsed = Math.round(val.value! * 100) / 100;
    if (parsed > existing.totalAmount) return res.status(400).json({ error: `قيمة العربون (${parsed} ج.م) لا يمكن أن تتجاوز إجمالي الطلب (${existing.totalAmount} ج.م)` });
    newDepositAmount = parsed;
  }

  const now = new Date().toISOString();
  const newRemaining = Math.max(0, Math.round((existing.totalAmount - newDepositAmount) * 100) / 100);
  const effectiveStatus = depositStatus !== undefined ? depositStatus : existing.depositStatus;
  let finalConfirmedAt: string | null = existing.depositConfirmedAt || null;
  let finalConfirmedBy: string | null = existing.depositConfirmedBy || null;

  if (depositStatus !== undefined) {
    if (depositStatus === 'confirmed' && existing.depositStatus !== 'confirmed') {
      finalConfirmedAt = now; finalConfirmedBy = req.admin!.name;
    } else if (depositStatus !== 'confirmed' && existing.depositStatus === 'confirmed') {
      finalConfirmedAt = null; finalConfirmedBy = null;
    }
  }

  const updates: Record<string, unknown> = {
    deposit_amount: newDepositAmount, remaining_amount: newRemaining,
    deposit_confirmed_at: finalConfirmedAt, deposit_confirmed_by: finalConfirmedBy, updated_at: now,
  };
  if (depositStatus !== undefined) updates.deposit_status = depositStatus;
  if (depositMethod !== undefined) updates.deposit_method = depositMethod;
  if (depositReference !== undefined) updates.deposit_reference = depositReference;
  if (depositNotes !== undefined) updates.deposit_notes = depositNotes;

  const { error } = await supabaseServer.from('orders').update(updates).eq('id', orderId);
  if (error) return res.status(503).json({ error: 'تعذر تحديث بيانات العربون' });

  const updated = await getOrderWithItems(orderId);
  logAuditAction(req.admin, 'update_order_deposit', 'order', orderId,
    { oldDeposit: existing.depositStatus, oldAmount: existing.depositAmount },
    { newDeposit: effectiveStatus, amount: newDepositAmount }, req.ip);
  broadcastRealtimeEvent('deposit_updated', updated);
  return res.json(updated);
});

router.delete('/admin/orders/:id', requireAuth, requireRole(['super_admin']), async (req: AuthenticatedRequest, res: Response) => {
  const orderId = req.params.id;
  const existing = await getOrderWithItems(orderId);
  if (!existing) return res.status(404).json({ error: 'الطلب غير موجود' });

  const { error } = await supabaseServer.from('orders').delete().eq('id', orderId);
  if (error) return res.status(503).json({ error: 'حدث خطأ أثناء حذف الطلب' });

  logAuditAction(req.admin, 'delete_order', 'order', orderId, { orderNumber: existing.orderNumber }, null, req.ip);
  broadcastRealtimeEvent('order_deleted', { id: orderId });
  return res.json({ message: 'تم حذف الطلب وعناصره بنجاح' });
});

// ==========================================
// 7. CUSTOMERS
// ==========================================
function mapCustomerRow(c: Record<string, unknown>) {
  return {
    id: c.id, name: c.name, email: c.email || '', phone: c.phone, city: c.city || 'القاهرة',
    district: c.district || '', address: c.address || '', totalOrders: Number(c.total_orders || 0),
    totalSpent: Number(c.total_spent || 0), lastOrderDate: c.last_order_date, status: c.status || 'active',
    notes: c.notes || '', registeredAt: c.created_at,
  };
}

router.get('/admin/customers', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabaseServer.from('customers').select('*').order('total_orders', { ascending: false }).order('created_at', { ascending: false });
  if (error) return res.status(503).json({ error: 'تعذر تحميل العملاء' });
  return res.json((data || []).map(mapCustomerRow));
});

router.put('/admin/customers/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const customerId = req.params.id; const { name, phone, city, district, address, status, notes } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name; if (phone !== undefined) updates.phone = phone;
  if (city !== undefined) updates.city = city; if (district !== undefined) updates.district = district;
  if (address !== undefined) updates.address = address; if (status !== undefined) updates.status = status;
  if (notes !== undefined) updates.notes = notes;

  const { data: updated, error } = await supabaseServer.from('customers').update(updates).eq('id', customerId).select('*').maybeSingle();
  if (error) return res.status(error.code === '23505' ? 409 : 503).json({ error: error.code === '23505' ? 'رقم الهاتف مستخدم لعميل آخر' : 'تعذر تحديث العميل' });
  if (!updated) return res.status(404).json({ error: 'العميل غير موجود' });

  logAuditAction(req.admin, 'update_customer', 'customer', customerId, null, updated, req.ip);
  broadcastRealtimeEvent('customer_updated', updated);
  return res.json(updated);
});

router.post('/admin/customers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { name, phone, email, city, district, address, notes, status } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'اسم العميل ورقم الهاتف مطلوبان' });
  const cleanPhone = String(phone).trim();

  const { data: existing, error: lookupError } = await supabaseServer.from('customers').select('id').eq('phone', cleanPhone).maybeSingle();
  if (lookupError) return res.status(503).json({ error: 'تعذر التحقق من العميل' });
  if (existing) return res.status(400).json({ error: 'يوجد عميل مسجل بالفعل بهذا الهاتف' });

  const id = `cust-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`; const now = new Date().toISOString();
  const { error } = await supabaseServer.from('customers').insert({
    id, name: String(name).trim(), email: email?.trim() || null, phone: cleanPhone,
    city: city || 'القاهرة', district: district || '', address: address || '',
    total_orders: 0, total_spent: 0, status: status || 'active', notes: notes || null, created_at: now,
  });
  if (error) return res.status(error.code === '23505' ? 409 : 503).json({ error: error.code === '23505' ? 'يوجد عميل مسجل بالفعل بهذا الهاتف' : 'تعذر إنشاء العميل' });

  const created = { id, name: String(name).trim(), email: email?.trim() || '', phone: cleanPhone, city: city || 'القاهرة',
    district: district || '', address: address || '', totalOrders: 0, totalSpent: 0, status: status || 'active',
    notes: notes || '', registeredAt: now };
  logAuditAction(req.admin, 'create_customer', 'customer', id, null, created, req.ip);
  broadcastRealtimeEvent('customer_created', created);
  return res.status(201).json(created);
});

router.delete('/admin/customers/:id', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id;
  const { data: existing, error: lookupError } = await supabaseServer.from('customers').select('*').eq('id', id).maybeSingle();
  if (lookupError) return res.status(503).json({ error: 'تعذر تحميل العميل' });
  if (!existing) return res.status(404).json({ error: 'العميل غير موجود' });

  const { count, error: countError } = await supabaseServer.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', id);
  if (countError) return res.status(503).json({ error: 'تعذر التحقق من طلبات العميل' });

  if ((count || 0) > 0) {
    const archiveNote = existing.notes ? `${existing.notes} | تم أرشفة/حظر العميل بواسطة الإدارة` : 'تم أرشفة/حظر العميل بواسطة الإدارة';
    const { data: archived, error } = await supabaseServer.from('customers').update({ status: 'blocked', notes: archiveNote }).eq('id', id).select('*').single();
    if (error) return res.status(503).json({ error: 'تعذر أرشفة العميل' });
    logAuditAction(req.admin, 'archive_customer', 'customer', id, existing, { status: 'blocked', archived: true }, req.ip);
    broadcastRealtimeEvent('customer_updated', archived);
    return res.json({ message: 'تم أرشفة وحظر العميل وحفظ سجل طلباته بنجاح' });
  }

  const { error } = await supabaseServer.from('customers').delete().eq('id', id);
  if (error) return res.status(503).json({ error: 'تعذر حذف العميل' });
  logAuditAction(req.admin, 'delete_customer', 'customer', id, existing, null, req.ip);
  broadcastRealtimeEvent('customer_deleted', { id });
  return res.json({ message: 'تم حذف العميل بنجاح' });
});

// ==========================================
// 8. COUPONS
// ==========================================
function mapCouponRow(c: Record<string, unknown>) {
  return {
    id: c.id, code: c.code, discountType: c.discount_type, discountValue: Number(c.discount_value || 0),
    minOrderValue: Number(c.min_order_value || 0), maxDiscountValue: c.max_discount_value != null ? Number(c.max_discount_value) : undefined,
    usageLimit: Number(c.usage_limit || 100), usedCount: Number(c.used_count || 0), expiryDate: c.expiry_date,
    isActive: Boolean(c.is_active), createdAt: c.created_at,
  };
}

router.get('/admin/coupons', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabaseServer.from('coupons').select('*').order('created_at', { ascending: false });
  if (error) return res.status(503).json({ error: 'تعذر تحميل الكوبونات' });
  return res.json((data || []).map(mapCouponRow));
});

router.post('/admin/coupons', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const { code, discountType, discountValue, minOrderValue, maxDiscountValue, usageLimit, expiryDate } = req.body;
  if (!code || !discountType || discountValue === undefined || !expiryDate) return res.status(400).json({ error: 'كود الكوبون، نوع الخصم، القيمة وتاريخ الانتهاء مطلوبة' });
  if (discountType !== 'percentage' && discountType !== 'fixed') return res.status(400).json({ error: 'نوع الخصم يجب أن يكون إما نسبة مئوية (percentage) أو قيمة ثابتة (fixed)' });

  const dVal = parseAndValidateNumber(discountValue, 'قيمة الخصم', { min: 0, max: discountType === 'percentage' ? 100 : undefined });
  if (!dVal.valid) return res.status(400).json({ error: dVal.error });
  const minVal = parseAndValidateNumber(minOrderValue !== undefined ? minOrderValue : 0, 'الحد الأدنى للطلب', { min: 0 });
  if (!minVal.valid) return res.status(400).json({ error: minVal.error });

  let maxDiscount: number | null = null;
  if (maxDiscountValue !== undefined && maxDiscountValue !== null && maxDiscountValue !== '') {
    const v = parseAndValidateNumber(maxDiscountValue, 'الحد الأقصى للخصم', { min: 0 });
    if (!v.valid) return res.status(400).json({ error: v.error }); maxDiscount = v.value!;
  }
  const usage = parseAndValidateNumber(usageLimit !== undefined ? usageLimit : 100, 'حد الاستخدام', { min: 1, integerOnly: true });
  if (!usage.valid) return res.status(400).json({ error: usage.error });

  const id = `cpn-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const { data: createdRow, error } = await supabaseServer.from('coupons').insert({
    id, code: String(code).toUpperCase().trim(), discount_type: discountType, discount_value: dVal.value!,
    min_order_value: minVal.value!, max_discount_value: maxDiscount, usage_limit: usage.value!,
    used_count: 0, expiry_date: expiryDate, is_active: true, created_at: new Date().toISOString(),
  }).select('*').single();

  if (error) return res.status(error.code === '23505' ? 409 : 503).json({ error: error.code === '23505' ? 'كود الكوبون مستخدم بالفعل' : 'تعذر إنشاء الكوبون' });
  const created = mapCouponRow(createdRow);
  logAuditAction(req.admin, 'create_coupon', 'coupon', id, null, created, req.ip);
  broadcastRealtimeEvent('coupon_created', created);
  return res.status(201).json(created);
});

router.put('/admin/coupons/:id', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id; const { code, discountType, discountValue, minOrderValue, maxDiscountValue, usageLimit, expiryDate, isActive } = req.body;
  const { data: existing, error: lookupError } = await supabaseServer.from('coupons').select('*').eq('id', id).maybeSingle();
  if (lookupError) return res.status(503).json({ error: 'تعذر تحميل الكوبون' });
  if (!existing) return res.status(404).json({ error: 'الكوبون غير موجود' });
  if (discountType !== undefined && discountType !== 'percentage' && discountType !== 'fixed') return res.status(400).json({ error: 'نوع الخصم يجب أن يكون إما نسبة مئوية (percentage) أو قيمة ثابتة (fixed)' });

  const effectiveType = discountType !== undefined ? discountType : String(existing.discount_type);
  const updates: Record<string, unknown> = {};
  if (code !== undefined) updates.code = String(code).toUpperCase().trim();
  if (discountType !== undefined) updates.discount_type = discountType;
  if (discountValue !== undefined) {
    const v = parseAndValidateNumber(discountValue, 'قيمة الخصم', { min: 0, max: effectiveType === 'percentage' ? 100 : undefined });
    if (!v.valid) return res.status(400).json({ error: v.error }); updates.discount_value = v.value!;
  }
  if (minOrderValue !== undefined) {
    const v = parseAndValidateNumber(minOrderValue, 'الحد الأدنى للطلب', { min: 0 });
    if (!v.valid) return res.status(400).json({ error: v.error }); updates.min_order_value = v.value!;
  }
  if (maxDiscountValue !== undefined) {
    if (maxDiscountValue === null || maxDiscountValue === '') updates.max_discount_value = null;
    else { const v = parseAndValidateNumber(maxDiscountValue, 'الحد الأقصى للخصم', { min: 0 }); if (!v.valid) return res.status(400).json({ error: v.error }); updates.max_discount_value = v.value!; }
  }
  if (usageLimit !== undefined) {
    const v = parseAndValidateNumber(usageLimit, 'حد الاستخدام', { min: 1, integerOnly: true });
    if (!v.valid) return res.status(400).json({ error: v.error }); updates.usage_limit = v.value!;
  }
  if (expiryDate !== undefined) updates.expiry_date = expiryDate;
  if (isActive !== undefined) updates.is_active = Boolean(isActive);

  const { data: updated, error } = await supabaseServer.from('coupons').update(updates).eq('id', id).select('*').single();
  if (error) return res.status(error.code === '23505' ? 409 : 503).json({ error: error.code === '23505' ? 'كود الكوبون مستخدم بالفعل' : 'تعذر تحديث الكوبون' });
  const result = mapCouponRow(updated);
  logAuditAction(req.admin, 'update_coupon', 'coupon', id, existing, result, req.ip);
  broadcastRealtimeEvent('coupon_updated', result);
  return res.json(result);
});

router.delete('/admin/coupons/:id', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id; const { error } = await supabaseServer.from('coupons').delete().eq('id', id);
  if (error) return res.status(503).json({ error: 'تعذر حذف الكوبون' });
  logAuditAction(req.admin, 'delete_coupon', 'coupon', id, null, null, req.ip);
  broadcastRealtimeEvent('coupon_deleted', { id });
  return res.json({ message: 'تم حذف الكوبون' });
});

// ==========================================
// 8.5. DELIVERY REGIONS
// ==========================================
router.get('/delivery-regions', async (_req: Request, res: Response) => {
  const { data: regions, error } = await supabaseServer
    .from('delivery_regions')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('Supabase delivery regions read failed:', error.message);
    return res.status(503).json({ error: 'تعذر تحميل مناطق التوصيل' });
  }

  return res.json(
    (regions || []).map((r) => ({
      id: r.id,
      name: r.name,
      city: r.city,
      deliveryFee: Number(r.delivery_fee),
      minOrderAmount: Number(r.min_order_amount || 0),
      estimatedHours: Number(r.estimated_hours || 3),
      sortOrder: Number(r.sort_order || 0),
      isActive: Boolean(r.is_active),
    }))
  );
});

router.get('/admin/delivery-regions', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const { data: regions, error } = await supabaseServer
    .from('delivery_regions')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('Supabase admin delivery regions read failed:', error.message);
    return res.status(503).json({ error: 'تعذر تحميل مناطق التوصيل' });
  }

  return res.json(
    (regions || []).map((r) => ({
      id: r.id,
      name: r.name,
      city: r.city,
      deliveryFee: Number(r.delivery_fee),
      minOrderAmount: Number(r.min_order_amount || 0),
      estimatedHours: Number(r.estimated_hours || 3),
      sortOrder: Number(r.sort_order || 0),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
    }))
  );
});

router.post('/admin/delivery-regions', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const { name, city, deliveryFee, minOrderAmount, estimatedHours, sortOrder, isActive } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'اسم المنطقة مطلوب' });
  }

  const feeCheck = parseAndValidateNumber(deliveryFee, 'سعر التوصيل', { min: 0 });
  if (!feeCheck.valid) {
    return res.status(400).json({ error: feeCheck.error });
  }

  const minOrderCheck = parseAndValidateNumber(
    minOrderAmount !== undefined ? minOrderAmount : 0,
    'الحد الأدنى للطلب',
    { min: 0 }
  );
  if (!minOrderCheck.valid) {
    return res.status(400).json({ error: minOrderCheck.error });
  }

  const hoursCheck = parseAndValidateNumber(
    estimatedHours !== undefined ? estimatedHours : 3,
    'مدة التوصيل التقديرية بالساعات',
    { min: 0.1 }
  );
  if (!hoursCheck.valid) {
    return res.status(400).json({ error: 'مدة التوصيل التقديرية يجب أن تكون أكبر من صفر' });
  }

  const sortCheck = parseAndValidateNumber(
    sortOrder !== undefined ? sortOrder : 0,
    'ترتيب العرض'
  );
  if (!sortCheck.valid) {
    return res.status(400).json({ error: sortCheck.error });
  }

  const id = `reg-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const now = new Date().toISOString();

  const { data: createdRow, error } = await supabaseServer
    .from('delivery_regions')
    .insert({
      id,
      name: name.trim(),
      city: city ? String(city).trim() : 'القاهرة',
      delivery_fee: feeCheck.value!,
      min_order_amount: minOrderCheck.value!,
      estimated_hours: hoursCheck.value!,
      sort_order: sortCheck.value!,
      is_active: isActive !== false,
      created_at: now,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Supabase delivery region create failed:', error.message);
    return res.status(503).json({ error: 'تعذر إنشاء منطقة التوصيل' });
  }

  const created = {
    id: createdRow.id,
    name: createdRow.name,
    city: createdRow.city,
    deliveryFee: Number(createdRow.delivery_fee),
    minOrderAmount: Number(createdRow.min_order_amount || 0),
    estimatedHours: Number(createdRow.estimated_hours || 3),
    sortOrder: Number(createdRow.sort_order || 0),
    isActive: Boolean(createdRow.is_active),
    createdAt: createdRow.created_at,
  };

  logAuditAction(req.admin, 'create_delivery_region', 'delivery_region', id, null, created, req.ip);
  broadcastRealtimeEvent('delivery_region_created', created);

  return res.status(201).json(created);
});

router.put('/admin/delivery-regions/:id', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id;
  const { name, city, deliveryFee, minOrderAmount, estimatedHours, sortOrder, isActive } = req.body;

  const { data: existing, error: lookupError } = await supabaseServer
    .from('delivery_regions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (lookupError) {
    console.error('Supabase delivery region lookup failed:', lookupError.message);
    return res.status(503).json({ error: 'تعذر تحميل منطقة التوصيل' });
  }

  if (!existing) {
    return res.status(404).json({ error: 'منطقة التوصيل غير موجودة' });
  }

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'اسم المنطقة غير صالح' });
  }

  const updates: Record<string, unknown> = {};

  if (name !== undefined) updates.name = name.trim();
  if (city !== undefined) updates.city = String(city).trim();

  if (deliveryFee !== undefined) {
    const v = parseAndValidateNumber(deliveryFee, 'سعر التوصيل', { min: 0 });
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.delivery_fee = v.value!;
  }

  if (minOrderAmount !== undefined) {
    const v = parseAndValidateNumber(minOrderAmount, 'الحد الأدنى للطلب', { min: 0 });
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.min_order_amount = v.value!;
  }

  if (estimatedHours !== undefined) {
    const v = parseAndValidateNumber(
      estimatedHours,
      'مدة التوصيل التقديرية بالساعات',
      { min: 0.1 }
    );
    if (!v.valid) {
      return res.status(400).json({ error: 'مدة التوصيل التقديرية يجب أن تكون أكبر من صفر' });
    }
    updates.estimated_hours = v.value!;
  }

  if (sortOrder !== undefined) {
    const v = parseAndValidateNumber(sortOrder, 'ترتيب العرض');
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.sort_order = v.value!;
  }

  if (isActive !== undefined) updates.is_active = Boolean(isActive);

  const { data: updated, error: updateError } = await supabaseServer
    .from('delivery_regions')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (updateError) {
    console.error('Supabase delivery region update failed:', updateError.message);
    return res.status(503).json({ error: 'تعذر تحديث منطقة التوصيل' });
  }

  const result = {
    id: updated.id,
    name: updated.name,
    city: updated.city,
    deliveryFee: Number(updated.delivery_fee),
    minOrderAmount: Number(updated.min_order_amount || 0),
    estimatedHours: Number(updated.estimated_hours || 3),
    sortOrder: Number(updated.sort_order || 0),
    isActive: Boolean(updated.is_active),
    createdAt: updated.created_at,
  };

  logAuditAction(req.admin, 'update_delivery_region', 'delivery_region', id, existing, result, req.ip);
  broadcastRealtimeEvent('delivery_region_updated', result);

  return res.json(result);
});

router.delete('/admin/delivery-regions/:id', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id;

  const { data: existing, error: lookupError } = await supabaseServer
    .from('delivery_regions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (lookupError) {
    console.error('Supabase delivery region delete lookup failed:', lookupError.message);
    return res.status(503).json({ error: 'تعذر تحميل منطقة التوصيل' });
  }

  if (!existing) {
    return res.status(404).json({ error: 'منطقة التوصيل غير موجودة' });
  }

  const { error: deleteError } = await supabaseServer
    .from('delivery_regions')
    .delete()
    .eq('id', id);

  if (deleteError) {
    console.error('Supabase delivery region delete failed:', deleteError.message);
    return res.status(503).json({ error: 'تعذر حذف منطقة التوصيل' });
  }

  logAuditAction(req.admin, 'delete_delivery_region', 'delivery_region', id, existing, null, req.ip);
  broadcastRealtimeEvent('delivery_region_deleted', { id });

  return res.json({ message: 'تم حذف منطقة التوصيل بنجاح' });
});

// ==========================================
// 9. STORE SETTINGS
// ==========================================
router.get('/admin/settings', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const { data: s, error } = await supabaseServer
    .from('store_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('Supabase admin settings read failed:', error.message);
    return res.status(503).json({ error: 'تعذر تحميل الإعدادات' });
  }
  if (!s) return res.status(404).json({ error: 'الإعدادات غير موجودة' });

  return res.json({
    storeName: s.store_name,
    tagline: s.tagline || '',
    phone: s.phone || '',
    whatsapp: s.whatsapp || '',
    instapayHandle: s.instapay_handle || '',
    instapayNumber: s.instapay_number || '',
    vodafoneCash: s.vodafone_cash || '',
    address: s.address || '',
    isOpen: Boolean(s.is_open),
    closedReason: s.closed_reason || '',
    deliveryFee: Number(s.default_delivery_fee || 15),
    freeDeliveryThreshold: Number(s.free_delivery_threshold || 400),
    minOrderAmount: Number(s.min_order_amount || 100),
    depositPercentage: Number(s.deposit_percentage || 20),
    minDepositAmount: Number(s.min_deposit_amount || 50),
    workingHours: s.working_hours || '',
    cutoffHour: Number(s.cutoff_hour || 3),
    currency: s.currency || 'ج.م',
  });
});

router.put('/admin/settings', requireAuth, requireRole(['super_admin', 'manager']), async (req: AuthenticatedRequest, res: Response) => {
  const {
    storeName,
    tagline,
    phone,
    whatsapp,
    instapayHandle,
    instapayNumber,
    vodafoneCash,
    address,
    isOpen,
    closedReason,
    deliveryFee,
    freeDeliveryThreshold,
    minOrderAmount,
    depositPercentage,
    minDepositAmount,
    workingHours,
    cutoffHour,
    currency,
  } = req.body;

  const { data: existing, error: existingError } = await supabaseServer
    .from('store_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (existingError) {
    console.error('Supabase store settings lookup failed:', existingError.message);
    return res.status(503).json({ error: 'تعذر تحميل إعدادات المتجر' });
  }

  if (!existing) {
    return res.status(404).json({ error: 'الإعدادات غير موجودة' });
  }

  const updates: Record<string, unknown> = {};

  if (storeName !== undefined) updates.store_name = String(storeName);
  if (tagline !== undefined) updates.tagline = String(tagline);
  if (phone !== undefined) updates.phone = String(phone);
  if (whatsapp !== undefined) updates.whatsapp = String(whatsapp);
  if (instapayHandle !== undefined) updates.instapay_handle = String(instapayHandle);
  if (instapayNumber !== undefined) updates.instapay_number = String(instapayNumber);
  if (vodafoneCash !== undefined) updates.vodafone_cash = String(vodafoneCash);
  if (address !== undefined) updates.address = String(address);
  if (isOpen !== undefined) updates.is_open = Boolean(isOpen);
  if (closedReason !== undefined) updates.closed_reason = String(closedReason);
  if (workingHours !== undefined) updates.working_hours = String(workingHours);
  if (currency !== undefined) updates.currency = String(currency);

  if (deliveryFee !== undefined) {
    const v = parseAndValidateNumber(deliveryFee, 'سعر التوصيل الافتراضي', { min: 0 });
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.default_delivery_fee = v.value!;
  }

  if (freeDeliveryThreshold !== undefined) {
    const v = parseAndValidateNumber(
      freeDeliveryThreshold,
      'الحد الأدنى للشحن المجاني',
      { min: 0 }
    );
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.free_delivery_threshold = v.value!;
  }

  if (minOrderAmount !== undefined) {
    const v = parseAndValidateNumber(minOrderAmount, 'الحد الأدنى للطلب', { min: 0 });
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.min_order_amount = v.value!;
  }

  if (depositPercentage !== undefined) {
    const v = parseAndValidateNumber(
      depositPercentage,
      'نسبة العربون',
      { min: 0, max: 100 }
    );
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.deposit_percentage = v.value!;
  }

  if (minDepositAmount !== undefined) {
    const v = parseAndValidateNumber(
      minDepositAmount,
      'الحد الأدنى لقيمة العربون',
      { min: 0 }
    );
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.min_deposit_amount = v.value!;
  }

  if (cutoffHour !== undefined) {
    const v = parseAndValidateNumber(
      cutoffHour,
      'ساعة إغلاق الطلبات اليومية',
      { min: 0, max: 23, integerOnly: true }
    );
    if (!v.valid) return res.status(400).json({ error: v.error });
    updates.cutoff_hour = v.value!;
  }

  updates.updated_at = new Date().toISOString();

  const { data: updated, error: updateError } = await supabaseServer
    .from('store_settings')
    .update(updates)
    .eq('id', 1)
    .select('*')
    .single();

  if (updateError) {
    console.error('Supabase store settings update failed:', updateError.message);
    return res.status(503).json({ error: 'تعذر حفظ إعدادات المتجر' });
  }

  logAuditAction(
    req.admin,
    'update_store_settings',
    'store_settings',
    '1',
    existing,
    updated,
    req.ip
  );

  const mappedSettings = {
    storeName: updated.store_name,
    tagline: updated.tagline || '',
    phone: updated.phone || '',
    whatsapp: updated.whatsapp || '',
    instapayHandle: updated.instapay_handle || '',
    instapayNumber: updated.instapay_number || '',
    vodafoneCash: updated.vodafone_cash || '',
    address: updated.address || '',
    isOpen: Boolean(updated.is_open),
    closedReason: updated.closed_reason || '',
    deliveryFee: Number(updated.default_delivery_fee || 15),
    freeDeliveryThreshold: Number(updated.free_delivery_threshold || 400),
    minOrderAmount: Number(updated.min_order_amount || 100),
    depositPercentage: Number(updated.deposit_percentage || 20),
    minDepositAmount: Number(updated.min_deposit_amount || 50),
    workingHours: updated.working_hours || '',
    cutoffHour: Number(updated.cutoff_hour || 3),
    currency: updated.currency || 'ج.م',
  };

  broadcastRealtimeEvent('store_settings_updated', mappedSettings);

  return res.json({
    message: 'تم حفظ إعدادات المتجر بنجاح',
    settings: mappedSettings,
  });
});

// ==========================================
// 10. AUDIT LOGS
// ==========================================
router.get('/admin/audit-logs', requireAuth, requireRole(['super_admin', 'manager']), async (_req: AuthenticatedRequest, res: Response) => {
  const { data: logs, error } = await supabaseServer
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Supabase audit logs read failed:', error.message);
    return res.status(503).json({ error: 'تعذر تحميل سجل العمليات' });
  }

  return res.json(
    (logs || []).map((l) => ({
      id: l.id,
      adminId: l.admin_id,
      adminName: l.admin_name,
      adminEmail: l.admin_email,
      action: l.action,
      entityType: l.entity_type,
      entityId: l.entity_id,
      oldValues: l.old_values,
      newValues: l.new_values,
      ipAddress: l.ip_address,
      createdAt: l.created_at,
    }))
  );
});

// ==========================================
// 11. ORDER DEMAND & REQUIRED QUANTITIES — SUPABASE
// ==========================================
router.get('/admin/order-demand', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const [productsResult, variantsResult, categoriesResult] = await Promise.all([
    supabaseServer.from('products').select('id,name,pricing_unit,category_id').eq('is_active', true).order('name', { ascending: true }),
    supabaseServer.from('product_variants').select('*').eq('is_active', true).order('weight_kg', { ascending: true }).order('piece_count', { ascending: true }),
    supabaseServer.from('categories').select('id,name'),
  ]);
  const failed = [productsResult, variantsResult, categoriesResult].find((r) => r.error);
  if (failed?.error) return res.status(503).json({ error: 'تعذر تحميل احتياجات الطلبات' });
  const categoryNames = new Map((categoriesResult.data || []).map((c) => [String(c.id), String(c.name)]));
  return res.json({
    products: (productsResult.data || []).map((p) => ({ id: p.id, name: p.name, categoryName: categoryNames.get(String(p.category_id || '')) || '', pricingUnit: p.pricing_unit })),
    variants: (variantsResult.data || []).map((v) => ({ id: v.id, productId: v.product_id, title: v.title, weightKg: v.weight_kg, pieceCount: v.piece_count, approxPieceWeightG: v.approx_piece_weight_g, price: v.price, isActive: Boolean(v.is_active) })),
  });
});

// ==========================================
// 11.5. SECURE CUSTOMER APP INTEGRATION API
// ==========================================
function requireIntegrationKey(req: Request, res: Response, next: express.NextFunction) {
  const configuredKey = process.env.CUSTOMER_APP_INTEGRATION_KEY; const providedKey = req.header('X-Integration-Key');
  if (!configuredKey) return res.status(503).json({ error: 'Integration service is not configured' });
  if (!providedKey) return res.status(401).json({ error: 'Unauthorized integration request' });
  const expected = Buffer.from(configuredKey, 'utf8'); const received = Buffer.from(providedKey, 'utf8');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return res.status(401).json({ error: 'Unauthorized integration request' });
  next();
}

function normalizeIntegrationPhone(value: unknown): string {
  if (typeof value !== 'string') return ''; return value.trim().replace(/[^0-9+]/g, '');
}

function mapIntegrationOrder(order: Record<string, unknown>, items: Record<string, unknown>[]) {
  return {
    id: order.id, orderNumber: order.order_number, customerId: order.customer_id || undefined,
    customerName: order.customer_name, customerPhone: order.customer_phone, customerAddress: order.customer_address,
    city: order.city || '', district: order.district || '', subtotal: Number(order.subtotal || 0),
    discountAmount: Number(order.discount_amount || 0), couponCode: order.coupon_code || undefined,
    deliveryFee: Number(order.delivery_fee || 0), totalAmount: Number(order.total_amount || 0),
    depositAmount: Number(order.deposit_amount || 0), depositStatus: order.deposit_status,
    depositMethod: order.deposit_method || undefined, depositReference: order.deposit_reference || undefined,
    remainingAmount: Number(order.remaining_amount || 0), status: order.status, notes: order.notes || '',
    createdAt: order.created_at, updatedAt: order.updated_at,
    items: items.map((item) => ({
      id: item.id, productId: item.product_id, variantId: item.variant_id || undefined,
      productName: item.product_name, variantTitle: item.variant_title || undefined, pricingUnit: item.pricing_unit,
      weightKg: item.weight_kg != null ? Number(item.weight_kg) : undefined,
      pieceCount: item.piece_count != null ? Number(item.piece_count) : undefined,
      unitPrice: Number(item.unit_price || 0), quantity: Number(item.quantity || 0), totalPrice: Number(item.total_price || 0),
    })),
  };
}

router.post('/integration/coupons/validate', requireIntegrationKey, async (req: Request, res: Response) => {
  const rawCode = req.body?.code; const subtotalCheck = parseAndValidateNumber(req.body?.subtotal, 'subtotal', { min: 0 });
  if (typeof rawCode !== 'string' || !rawCode.trim()) return res.status(400).json({ valid: false, error: 'Coupon code is required' });
  if (!subtotalCheck.valid || subtotalCheck.value === undefined) return res.status(400).json({ valid: false, error: 'Invalid subtotal' });

  const cleanCode = rawCode.trim().toUpperCase();
  const { data: coupon, error } = await supabaseServer.from('coupons').select('*').ilike('code', cleanCode).maybeSingle();
  if (error) return res.status(503).json({ valid: false, error: 'Coupon service unavailable' });
  if (!coupon) return res.status(400).json({ valid: false, error: `كود الخصم "${cleanCode}" غير صالح أو غير موجود` });
  if (!coupon.is_active) return res.status(400).json({ valid: false, error: `كود الخصم "${cleanCode}" غير مفعّل حالياً` });
  if (coupon.expiry_date && new Date(String(coupon.expiry_date)) < new Date()) return res.status(400).json({ valid: false, error: `كود الخصم "${cleanCode}" منتهي الصلاحية` });

  const subtotal = subtotalCheck.value; const minOrderValue = Number(coupon.min_order_value || 0);
  if (subtotal < minOrderValue) return res.status(400).json({ valid: false, error: `الحد الأدنى لاستخدام كود الخصم "${cleanCode}" هو ${minOrderValue} ج.م` });
  const usageLimit = coupon.usage_limit != null ? Number(coupon.usage_limit) : null; const usedCount = Number(coupon.used_count || 0);
  if (usageLimit !== null && usedCount >= usageLimit) return res.status(400).json({ valid: false, error: `تم استنفاد الحد الأقصى لاستخدام كود الخصم "${cleanCode}"` });

  let discountAmount = 0; const discountType = String(coupon.discount_type); const discountValue = Number(coupon.discount_value);
  if (discountType === 'percentage') {
    discountAmount = Math.round(((subtotal * discountValue) / 100) * 100) / 100;
    if (coupon.max_discount_value != null) discountAmount = Math.min(discountAmount, Number(coupon.max_discount_value));
  } else discountAmount = Math.min(subtotal, discountValue);

  return res.json({ valid: true, code: cleanCode, discountType, discountValue, discountAmount, minOrderValue,
    maxDiscountValue: coupon.max_discount_value != null ? Number(coupon.max_discount_value) : undefined, expiryDate: coupon.expiry_date });
});

router.post('/integration/customer/orders', requireIntegrationKey, async (req: Request, res: Response) => {
  const phone = normalizeIntegrationPhone(req.body?.phone);
  if (phone.length < 8 || phone.length > 20) return res.status(400).json({ error: 'Invalid phone' });

  const { data: orders, error } = await supabaseServer.from('orders').select('*').eq('customer_phone', phone).order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(503).json({ error: 'Order service unavailable' });
  if (!orders || orders.length === 0) return res.json({ orders: [] });

  const { data: items, error: itemsError } = await supabaseServer.from('order_items').select('*').in('order_id', orders.map((o) => String(o.id))).order('created_at', { ascending: true });
  if (itemsError) return res.status(503).json({ error: 'Order service unavailable' });

  const byOrder = new Map<string, Record<string, unknown>[]>();
  for (const item of items || []) { const id = String(item.order_id); const list = byOrder.get(id) || []; list.push(item as Record<string, unknown>); byOrder.set(id, list); }
  return res.json({ orders: orders.map((o) => mapIntegrationOrder(o, byOrder.get(String(o.id)) || [])) });
});

router.post('/integration/orders/lookup', requireIntegrationKey, async (req: Request, res: Response) => {
  const raw = req.body?.orderIdOrNumber; const phone = normalizeIntegrationPhone(req.body?.phone);
  if (typeof raw !== 'string' || !raw.trim()) return res.status(400).json({ error: 'Order id or number is required' });
  if (phone.length < 8 || phone.length > 20) return res.status(400).json({ error: 'Invalid phone' });
  const key = raw.trim();

  let result = await supabaseServer.from('orders').select('*').eq('id', key).eq('customer_phone', phone).maybeSingle();
  if (result.error) return res.status(503).json({ error: 'Order service unavailable' });
  if (!result.data) {
    result = await supabaseServer.from('orders').select('*').eq('order_number', key).eq('customer_phone', phone).maybeSingle();
    if (result.error) return res.status(503).json({ error: 'Order service unavailable' });
  }
  if (!result.data) return res.status(404).json({ error: 'Order not found' });

  const { data: items, error } = await supabaseServer.from('order_items').select('*').eq('order_id', result.data.id).order('created_at', { ascending: true });
  if (error) return res.status(503).json({ error: 'Order service unavailable' });
  return res.json({ order: mapIntegrationOrder(result.data, (items || []) as Record<string, unknown>[]) });
});

// ==========================================
// 12. UNIFIED PUBLIC API — SUPABASE
// ==========================================
router.get('/products', async (_req: Request, res: Response) => {
  const [productsResult, variantsResult, categoriesResult] = await Promise.all([
    supabaseServer.from('products').select('*').eq('is_active', true).order('sort_order', { ascending: true }).order('created_at', { ascending: false }),
    supabaseServer.from('product_variants').select('*').eq('is_active', true).order('sort_order', { ascending: true }).order('weight_kg', { ascending: true }).order('piece_count', { ascending: true }),
    supabaseServer.from('categories').select('id,name'),
  ]);
  const failed = [productsResult, variantsResult, categoriesResult].find((r) => r.error);
  if (failed?.error) return res.status(503).json({ error: 'تعذر تحميل المنتجات' });

  const categoryNames = new Map((categoriesResult.data || []).map((c) => [String(c.id), String(c.name)]));
  const byProduct = new Map<string, Record<string, unknown>[]>();
  for (const v of variantsResult.data || []) { const id = String(v.product_id); const list = byProduct.get(id) || []; list.push(v as Record<string, unknown>); byProduct.set(id, list); }
  return res.json((productsResult.data || []).map((p) => mapProductRow(p, categoryNames.get(String(p.category_id || '')) || '', byProduct.get(String(p.id)) || [])));
});

router.get('/categories', async (_req: Request, res: Response) => {
  const { data, error } = await supabaseServer.from('categories').select('*').eq('is_active', true).order('sort_order', { ascending: true });
  if (error) return res.status(503).json({ error: 'تعذر تحميل التصنيفات' });
  return res.json(data || []);
});

router.get('/settings', async (_req: Request, res: Response) => {
  const { data: s, error } = await supabaseServer.from('store_settings').select('*').eq('id', 1).maybeSingle();
  if (error) return res.status(503).json({ error: 'تعذر تحميل إعدادات المتجر' });
  if (!s) return res.status(404).json({ error: 'الإعدادات غير موجودة' });
  return res.json({
    storeName: s.store_name, tagline: s.tagline, phone: s.phone, whatsapp: s.whatsapp,
    instapayHandle: s.instapay_handle, instapayNumber: s.instapay_number, vodafoneCash: s.vodafone_cash,
    address: s.address, isOpen: Boolean(s.is_open), closedReason: s.closed_reason,
    deliveryFee: s.default_delivery_fee, freeDeliveryThreshold: s.free_delivery_threshold,
    minOrderAmount: s.min_order_amount, depositPercentage: s.deposit_percentage, minDepositAmount: s.min_deposit_amount,
    workingHours: s.working_hours, cutoffHour: Number(s.cutoff_hour ?? 3), currency: s.currency,
  });
});

router.post('/orders', async (req: Request, res: Response) => {
  const { customerName, customerPhone, customerAddress, city, district, deliveryRegionId, items, couponCode, depositMethod, depositReference, notes } = req.body;
  const clientIp = req.ip || 'unknown';
  const cleanPhone = customerPhone ? String(customerPhone).trim().replace(/[^0-9+]/g, '') : '';
  const rateLimitKeys = [`order:ip:${clientIp}`]; if (cleanPhone) rateLimitKeys.push(`order:phone:${cleanPhone}`);

  if (!checkOrderRateLimit(rateLimitKeys)) return res.status(429).json({ error: 'تم تجاوز الحد الأقصى المسموح به لإنشاء الطلبات مؤقتاً. يرجى الانتظار بضع دقائق قبل المحاولة مجدداً.' });
  if (!customerName || !customerPhone || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'بيانات العميل والأصناف مطلوبة لإتمام الطلب' });
  if (String(customerPhone).trim().length < 8) return res.status(400).json({ error: 'رقم الهاتف غير صالح (يجب أن يتكون من 8 أرقام على الأقل)' });
  recordOrderAttempt(rateLimitKeys);

  const { data: settings, error: settingsError } = await supabaseServer.from('store_settings').select('*').eq('id', 1).maybeSingle();
  if (settingsError || !settings) return res.status(503).json({ error: 'إعدادات المتجر غير متوفرة حالياً، يرجى المحاولة لاحقاً' });
  if (!settings.is_open) {
    const reason = settings.closed_reason ? String(settings.closed_reason).trim() : '';
    return res.status(400).json({ error: reason ? `المتجر مغلق حالياً: ${reason}` : 'المتجر مغلق حالياً ولا يستقبل طلبات جديدة في الوقت الحالي' });
  }

  const verification = await verifyOrderItems(items as Array<Record<string, unknown>>, 'public');
  if (verification.error) return res.status(verification.serviceError ? 503 : 400).json({ error: verification.error });
  const subtotal = verification.subtotal!;

  const minOrderAmount = Number(settings.min_order_amount || 0);
  if (minOrderAmount > 0 && subtotal < minOrderAmount) return res.status(400).json({ error: `الحد الأدنى للطلب في المتجر هو ${minOrderAmount} ج.م (إجمالي الأصناف الحالي: ${subtotal} ج.م)` });

  const couponResult = await validateCouponForSubtotal(couponCode, subtotal);
  if (couponResult.error) return res.status(couponResult.serviceError ? 503 : 400).json({ error: couponResult.error });

  let fee = Number(settings.default_delivery_fee || 15);
  if (deliveryRegionId) {
    const { data: region, error } = await supabaseServer.from('delivery_regions').select('*').eq('id', deliveryRegionId).eq('is_active', true).maybeSingle();
    if (error) return res.status(503).json({ error: 'تعذر التحقق من منطقة التوصيل' });
    if (!region) return res.status(400).json({ error: 'منطقة التوصيل المحددة غير صالحة أو غير مفعّلة حالياً' });
    fee = Number(region.delivery_fee);
    const regionMin = Number(region.min_order_amount || 0);
    if (regionMin > 0 && subtotal < regionMin) return res.status(400).json({ error: `الحد الأدنى للطلب لمنطقة ${region.name} هو ${regionMin} ج.م` });
  } else if (district && typeof district === 'string' && district.trim()) {
    const { data: regions, error } = await supabaseServer.from('delivery_regions').select('*').eq('is_active', true).ilike('name', `%${district.trim()}%`).limit(1);
    if (error) return res.status(503).json({ error: 'تعذر التحقق من منطقة التوصيل' });
    const region = regions?.[0];
    if (region) {
      fee = Number(region.delivery_fee); const regionMin = Number(region.min_order_amount || 0);
      if (regionMin > 0 && subtotal < regionMin) return res.status(400).json({ error: `الحد الأدنى للطلب لمنطقة ${region.name} هو ${regionMin} ج.م` });
    }
  }

  const freeThreshold = Number(settings.free_delivery_threshold || 400); if (freeThreshold > 0 && subtotal >= freeThreshold) fee = 0;
  const totalAmount = Math.max(0, Math.round((subtotal - (couponResult.discountAmount || 0) + fee) * 100) / 100);
  const depositPct = Number(settings.deposit_percentage || 20); const minDeposit = Number(settings.min_deposit_amount || 50);
  let depositAmount = 0;
  if (depositPct > 0) depositAmount = Math.min(totalAmount, Math.max(minDeposit, Math.round((totalAmount * depositPct) / 100)));
  const remainingAmount = Math.max(0, Math.round((totalAmount - depositAmount) * 100) / 100);

  const payload = {
    customerName: String(customerName).trim(), customerPhone: cleanPhone, customerAddress: customerAddress || '',
    city: city || 'القاهرة', district: district || '', subtotal, discountAmount: couponResult.discountAmount || 0,
    couponCode: couponResult.cleanCode, deliveryFee: fee, totalAmount, depositAmount, depositStatus: 'pending',
    depositMethod: depositMethod || 'instapay', depositReference: depositReference || null, depositNotes: null,
    depositConfirmedAt: null, depositConfirmedBy: null, remainingAmount, status: 'pending', notes: notes || null,
  };

  const { data: rpcData, error: rpcError } = await supabaseServer.rpc('create_order_atomic', {
    p_payload: payload, p_items: verification.verifiedItems, p_coupon_id: couponResult.couponId || null,
  });
  if (rpcError) {
    if (rpcError.message.includes('COUPON_NOT_AVAILABLE')) return res.status(400).json({ error: 'كود الخصم لم يعد متاحاً، يرجى إعادة المحاولة' });
    console.error('Supabase public order RPC failed:', rpcError.message);
    return res.status(500).json({ error: 'حدث خطأ أثناء معالجة الطلب' });
  }

  const rpcOrder = (rpcData as { order?: Record<string, unknown> } | null)?.order;
  const orderId = rpcOrder?.id ? String(rpcOrder.id) : '';
  if (!orderId) return res.status(503).json({ error: 'تم إنشاء الطلب لكن تعذر تحميل بياناته' });

  const createdOrder = await getOrderWithItems(orderId);
  logAuditAction(null, 'create_order', 'order', orderId, null, { orderNumber: createdOrder?.orderNumber, totalAmount, customerPhone: cleanPhone }, req.ip);
  broadcastRealtimeEvent('new_order', createdOrder);
  return res.status(201).json({ success: true, message: 'تم استلام طلبك بنجاح وجاري مراجعة العربون وتجهيز الصيد الطازج', order: createdOrder });
});
