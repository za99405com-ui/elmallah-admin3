/// <reference types="vite/client" />
import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';

// User-provided Supabase Project Config
export const DEFAULT_SUPABASE_URL = 'https://aiaekigbslfsrmehjjii.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_4uEgesDyiidCl1sFPdRfPQ_RzImn4Ah';

export function cleanSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl) return DEFAULT_SUPABASE_URL;
  let url = rawUrl.trim();
  url = url.replace(/\/rest\/v1\/?$/i, '');
  url = url.replace(/\/auth\/v1\/?$/i, '');
  url = url.replace(/\/+$/, '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url;
}

// Configuration keys
const STORAGE_KEY_URL = 'almallah_supabase_url';
const STORAGE_KEY_ANON = 'almallah_supabase_anon';

export function getSavedSupabaseConfig(): { url: string; anonKey: string } {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const envUrl = metaEnv.VITE_SUPABASE_URL || '';
  const envAnon = metaEnv.VITE_SUPABASE_ANON_KEY || '';

  const storedUrl = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_URL) || '' : '';
  const storedAnon = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_ANON) || '' : '';

  const rawUrl = storedUrl || envUrl || DEFAULT_SUPABASE_URL;
  const cleanUrl = cleanSupabaseUrl(rawUrl);
  const cleanAnon = (storedAnon || envAnon || DEFAULT_SUPABASE_ANON_KEY).trim();

  // If stored URL had /rest/v1 or trailing slashes, clean it up in localStorage
  if (typeof window !== 'undefined' && storedUrl && storedUrl !== cleanUrl) {
    localStorage.setItem(STORAGE_KEY_URL, cleanUrl);
  }

  return {
    url: cleanUrl,
    anonKey: cleanAnon,
  };
}

export function saveSupabaseConfig(url: string, anonKey: string): void {
  if (typeof window !== 'undefined') {
    const cleaned = cleanSupabaseUrl(url);
    localStorage.setItem(STORAGE_KEY_URL, cleaned);
    localStorage.setItem(STORAGE_KEY_ANON, anonKey.trim());
    supabaseInstance = null; // reset cached client
  }
}

export function clearSupabaseConfig(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY_URL);
    localStorage.removeItem(STORAGE_KEY_ANON);
  }
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSavedSupabaseConfig();
  const effectiveUrl = url || DEFAULT_SUPABASE_URL;
  const effectiveAnonKey = anonKey || DEFAULT_SUPABASE_ANON_KEY;

  if (!supabaseInstance) {
    supabaseInstance = createClient(effectiveUrl, effectiveAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return supabaseInstance;
}

export function isSupabaseConnected(): boolean {
  const { url, anonKey } = getSavedSupabaseConfig();
  return Boolean(url && anonKey && url.startsWith('http'));
}

export async function signInWithSupabase(
  email: string,
  password: string
): Promise<{ session: Session | null; user: User | null; error: Error | null }> {
  const client = getSupabaseClient();
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (typeof password !== 'string' || password.length === 0 || !cleanEmail) {
    return {
      session: null,
      user: null,
      error: new Error('يرجى إدخال البريد الإلكتروني وكلمة المرور'),
    };
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: cleanEmail,
    password: password,
  });

  return {
    session: data?.session || null,
    user: data?.user || null,
    error: error ? new Error(error.message) : null,
  };
}

export async function signOutFromSupabase(): Promise<void> {
  const client = getSupabaseClient();
  await client.auth.signOut();
}

export async function getSupabaseSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  const { data } = await client.auth.getSession();
  return data.session;
}

// SQL Schema for the user to copy directly into Supabase SQL Editor if they want to setup remote tables
export const SUPABASE_SQL_SCHEMA = `-- مخطط جداول متجر أسماك الملاح (Al-Mallah Fish Store)
-- انسخ والصق هذا الكود في Supabase SQL Editor

-- 1. جدول التصنيفات
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. جدول المنتجات والمنيو (بدون أي خيارات طهي أو تنظيف)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  pricing_unit TEXT CHECK (pricing_unit IN ('kg', 'piece')) NOT NULL DEFAULT 'kg',
  price NUMERIC(10, 2) NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. جدول الكوبونات
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed')) NOT NULL,
  discount_value NUMERIC(10, 2) NOT NULL,
  min_order_value NUMERIC(10, 2) DEFAULT 0,
  max_discount_value NUMERIC(10, 2),
  usage_limit INTEGER DEFAULT 100,
  used_count INTEGER DEFAULT 0,
  expiry_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. جدول الطلبات
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  items JSONB NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL,
  discount_amount NUMERIC(10, 2) DEFAULT 0,
  coupon_code TEXT,
  delivery_fee NUMERIC(10, 2) DEFAULT 15,
  total_amount NUMERIC(10, 2) NOT NULL,
  status TEXT CHECK (status IN ('pending', 'preparing', 'delivering', 'completed', 'cancelled')) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. جدول إعدادات المتجر
CREATE TABLE IF NOT EXISTS store_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  store_name TEXT NOT NULL,
  tagline TEXT,
  phone TEXT,
  address TEXT,
  is_open BOOLEAN DEFAULT true,
  closed_reason TEXT,
  delivery_fee NUMERIC(10, 2) DEFAULT 15,
  free_delivery_threshold NUMERIC(10, 2) DEFAULT 400,
  min_order_amount NUMERIC(10, 2) DEFAULT 100,
  working_hours TEXT,
  currency TEXT DEFAULT 'ج.م',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- تمكين Realtime للتحديث اللحظي للطلبات والمنتجات
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE coupons;
`;
