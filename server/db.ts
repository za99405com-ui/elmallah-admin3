import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, 'almallah.db');
export const db = new DatabaseSync(DB_FILE);

// Enable WAL mode and foreign keys for high performance and integrity
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDatabase() {
  // 1. Admins table (Pure Supabase Identity metadata cache)
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      last_login TEXT
    );
  `);

  // Migrate legacy schema if needed
  try {
    const tableInfo = db.prepare('PRAGMA table_info(admins)').all() as Array<{ name: string }>;
    const hasPasswordHash = tableInfo.some((col) => col.name === 'password_hash');
    if (hasPasswordHash) {
      db.exec(`
        CREATE TABLE admins_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL,
          avatar_url TEXT,
          created_at TEXT NOT NULL,
          last_login TEXT
        );
        INSERT OR IGNORE INTO admins_new (id, name, email, role, avatar_url, created_at, last_login)
        SELECT id, name, email, role, avatar_url, created_at, last_login FROM admins;
        DROP TABLE admins;
        ALTER TABLE admins_new RENAME TO admins;
      `);
    }
  } catch {
    // Migration already completed or clean
  }

  // 2. Categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      icon TEXT,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // 3. Products table
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category_id TEXT,
      pricing_unit TEXT NOT NULL DEFAULT 'kg',
      base_price REAL NOT NULL,
      stock_quantity REAL NOT NULL DEFAULT 0,
      in_stock INTEGER NOT NULL DEFAULT 1,
      image_url TEXT,
      min_order_quantity REAL,
      max_order_quantity REAL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      badge TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
  `);

  // 4. Product Variants table (crucial requirement)
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      title TEXT NOT NULL,
      weight_kg REAL NOT NULL DEFAULT 1.0,
      piece_count INTEGER NOT NULL DEFAULT 1,
      approx_piece_weight_g REAL,
      price REAL NOT NULL,
      stock_quantity REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);

  // 5. Customers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT NOT NULL UNIQUE,
      city TEXT,
      district TEXT,
      address TEXT,
      total_orders INTEGER NOT NULL DEFAULT 0,
      total_spent REAL NOT NULL DEFAULT 0,
      last_order_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // 6. Orders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      customer_id TEXT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_address TEXT NOT NULL,
      city TEXT,
      district TEXT,
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      coupon_code TEXT,
      delivery_fee REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      deposit_amount REAL NOT NULL DEFAULT 0,
      deposit_status TEXT NOT NULL DEFAULT 'pending',
      deposit_method TEXT,
      deposit_reference TEXT,
      deposit_notes TEXT,
      deposit_confirmed_at TEXT,
      deposit_confirmed_by TEXT,
      remaining_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );
  `);

  // 7. Order Items table (with variant and snapshot tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      product_name TEXT NOT NULL,
      variant_title TEXT,
      pricing_unit TEXT NOT NULL,
      weight_kg REAL,
      piece_count INTEGER,
      unit_price REAL NOT NULL,
      quantity REAL NOT NULL,
      total_price REAL NOT NULL,
      snapshot_data TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  // 8. Coupons table
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      min_order_value REAL NOT NULL DEFAULT 0,
      max_discount_value REAL,
      usage_limit INTEGER NOT NULL DEFAULT 100,
      used_count INTEGER NOT NULL DEFAULT 0,
      expiry_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // 9. Delivery Regions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_regions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      delivery_fee REAL NOT NULL DEFAULT 15,
      min_order_amount REAL NOT NULL DEFAULT 0,
      estimated_hours REAL NOT NULL DEFAULT 3,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // Safe migrations for existing databases
  try {
    db.exec(`ALTER TABLE delivery_regions ADD COLUMN min_order_amount REAL NOT NULL DEFAULT 0;`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE delivery_regions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // Column already exists
  }

  // 10. Store Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      store_name TEXT NOT NULL,
      tagline TEXT,
      phone TEXT,
      whatsapp TEXT,
      instapay_handle TEXT,
      instapay_number TEXT,
      vodafone_cash TEXT,
      address TEXT,
      is_open INTEGER NOT NULL DEFAULT 1,
      closed_reason TEXT,
      default_delivery_fee REAL NOT NULL DEFAULT 15,
      free_delivery_threshold REAL NOT NULL DEFAULT 400,
      min_order_amount REAL NOT NULL DEFAULT 100,
      deposit_percentage REAL NOT NULL DEFAULT 20,
      min_deposit_amount REAL NOT NULL DEFAULT 50,
      working_hours TEXT,
      cutoff_hour INTEGER NOT NULL DEFAULT 3,
      currency TEXT NOT NULL DEFAULT 'ج.م',
      updated_at TEXT NOT NULL
    );
  `);

  // 11. Audit Logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      admin_name TEXT NOT NULL,
      admin_email TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      old_values TEXT,
      new_values TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Performance & Relationship Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items(variant_id);
    CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_deposit_status ON orders(deposit_status);
    CREATE INDEX IF NOT EXISTS idx_delivery_regions_active ON delivery_regions(is_active);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  `);

  seedInitialDataIfEmpty();
}

function seedInitialDataIfEmpty() {
  // Check if default admins exist in local metadata cache
  const insertAdmin = db.prepare(`
    INSERT OR IGNORE INTO admins (id, name, email, role, avatar_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const adminsToSeed = [
    {
      id: '09b338c3-1f61-43a3-96b8-dfbe83a7b7f4',
      name: 'كابتن زياد الملاح (المدير العام)',
      email: 'zyadmotz1@gmail.com',
      role: 'super_admin',
    },
    {
      id: '92516407-af67-4e43-905b-75e352c74580',
      name: 'كابتن زياد الملاح (المدير العام)',
      email: 'za99405.com@gmail.com',
      role: 'super_admin',
    },
    {
      id: 'admin-main',
      name: 'إدارة متجر الملاح',
      email: 'admin@almallah.com',
      role: 'super_admin',
    },
  ];

  for (const a of adminsToSeed) {
    const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(a.email);
    if (!existing) {
      insertAdmin.run(
        a.id,
        a.name,
        a.email.toLowerCase().trim(),
        a.role,
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
        new Date().toISOString()
      );
    }
  }

  // Check if store_settings exists
  const settingsRow = db.prepare('SELECT COUNT(*) as count FROM store_settings').get() as { count: number };
  if (settingsRow.count === 0) {
    db.prepare(`
      INSERT INTO store_settings (
        id, store_name, tagline, phone, whatsapp, instapay_handle, instapay_number,
        vodafone_cash, address, is_open, closed_reason, default_delivery_fee,
        free_delivery_threshold, min_order_amount, deposit_percentage, min_deposit_amount,
        working_hours, cutoff_hour, currency, updated_at
      ) VALUES (
        1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      'الملاح لبيع الأسماك',
      'صيد البحر الأحمر الطازج يومياً من الميناء إلى منزلك مباشرة',
      '01015192040',
      '01015192040',
      'almallah@instapay',
      '01015192040',
      '01015192040',
      'سوق السمك المركزي - حي المناخ - بورسعيد / القاهرة',
      1,
      '',
      15,
      400,
      100,
      20,
      50,
      'يومياً من 7:00 صباحاً حتى 11:00 مساءً (الإغلاق وتوزيع الطلبات 3:00 فجراً)',
      3,
      'ج.م',
      new Date().toISOString()
    );
  }

  // Check if categories exist
  const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number };
  if (catCount.count === 0) {
    const initialCategories = [
      { id: 'cat-1', name: 'أسماك البحر الأحمر الطازجة', slug: 'red-sea-fresh', description: 'صيد يومي طازج من مياه البحر الأحمر', icon: 'Fish', sort_order: 1 },
      { id: 'cat-2', name: 'مأكولات بحرية وقشريات', slug: 'crustaceans-shellfish', description: 'جمبري، استاكوزا، كابوريا وحبار بأعلى جودة', icon: 'Waves', sort_order: 2 },
      { id: 'cat-3', name: 'أسماك مستوردة ومجمدة', slug: 'frozen-imported', description: 'سلمون نرويجي وفيليه ممتاز مجمد سريعاً', icon: 'Snowflake', sort_order: 3 },
      { id: 'cat-4', name: 'أسماك بحرية فاخرة', slug: 'luxury-fish', description: 'ناجل ملكي وهامور ووقار عالي الجودة', icon: 'Crown', sort_order: 4 },
    ];

    const insertCat = db.prepare(`
      INSERT INTO categories (id, name, slug, description, icon, is_active, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);

    for (const c of initialCategories) {
      insertCat.run(c.id, c.name, c.slug, c.description, c.icon, c.sort_order, new Date().toISOString());
    }
  }

  // Check if delivery regions exist
  const regCount = db.prepare('SELECT COUNT(*) as count FROM delivery_regions').get() as { count: number };
  if (regCount.count === 0) {
    const regions = [
      { id: 'reg-1', name: 'المعادي والبساتين', city: 'القاهرة', fee: 15, hours: 2 },
      { id: 'reg-2', name: 'التجمع الأول والخامس', city: 'القاهرة الجديدة', fee: 25, hours: 3 },
      { id: 'reg-3', name: 'مدينة نصر ومصر الجديدة', city: 'القاهرة', fee: 20, hours: 2.5 },
      { id: 'reg-4', name: 'المهندسين والدقي والزمالك', city: 'الجيزة', fee: 20, hours: 3 },
      { id: 'reg-5', name: 'الشيخ زايد و6 أكتوبر', city: 'الجيزة', fee: 35, hours: 4 },
    ];
    const insertReg = db.prepare(`
      INSERT INTO delivery_regions (id, name, city, delivery_fee, estimated_hours, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    for (const r of regions) {
      insertReg.run(r.id, r.name, r.city, r.fee, r.hours, new Date().toISOString());
    }
  }

  // Check if products exist
  const prodCount = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
  if (prodCount.count === 0) {
    const now = new Date().toISOString();
    const initialProducts = [
      {
        id: 'prod-1',
        name: 'سمك دنيس بحري ممتاز',
        description: 'دنيس طازج صيد يومي من سواحل البحر الأحمر، غني بالدهون الصحية وطعم لا يقاوم مشوي أو زيت وليمون.',
        category_id: 'cat-1',
        pricing_unit: 'kg',
        base_price: 240,
        stock_quantity: 45,
        in_stock: 1,
        image_url: 'https://images.unsplash.com/photo-1534043464124-3be32fe00099?w=600&auto=format&fit=crop&q=80',
        badge: 'الأكثر طلباً',
        variants: [
          { id: 'var-1-1', title: 'حجم وسط (3-4 سمكات/كجم)', weight_kg: 1.0, piece_count: 4, price: 240, stock_quantity: 25 },
          { id: 'var-1-2', title: 'حجم كبير جامبو (1-2 سمكة/كجم)', weight_kg: 1.0, piece_count: 2, price: 270, stock_quantity: 20 },
        ],
      },
      {
        id: 'prod-2',
        name: 'سمك قاروص البحر المتوسط',
        description: 'قاروص أبيض ناصع ولحم طري متماسك، مثالي للطهي سنجاري بالفرن أو شرائح فيليه فاخرة.',
        category_id: 'cat-1',
        pricing_unit: 'kg',
        base_price: 260,
        stock_quantity: 30,
        in_stock: 1,
        image_url: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&auto=format&fit=crop&q=80',
        badge: 'طازج اليوم',
        variants: [
          { id: 'var-2-1', title: 'وسط مقاس سنجاري (800جم - 1كجم)', weight_kg: 1.0, piece_count: 1, price: 260, stock_quantity: 18 },
          { id: 'var-2-2', title: 'كبير فاخر (1.5كجم - 2كجم)', weight_kg: 1.5, piece_count: 1, price: 390, stock_quantity: 12 },
        ],
      },
      {
        id: 'prod-3',
        name: 'جمبري أحمر جامبو طازج',
        description: 'جمبري بلدي مقاس جامبو سوبر، قشور صلبة ولحم سكري ناصع البياض يصلح للشوي والسلق وطواجن الكريمة.',
        category_id: 'cat-2',
        pricing_unit: 'kg',
        base_price: 480,
        stock_quantity: 20,
        in_stock: 1,
        image_url: 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=600&auto=format&fit=crop&q=80',
        badge: 'عرض خاص',
        variants: [
          { id: 'var-3-1', title: 'جامبو وسط (20-25 حبة/كجم)', weight_kg: 1.0, piece_count: 22, price: 420, stock_quantity: 10 },
          { id: 'var-3-2', title: 'جامبو سوبر ملكي (12-16 حبة/كجم)', weight_kg: 1.0, piece_count: 14, price: 480, stock_quantity: 10 },
        ],
      },
      {
        id: 'prod-4',
        name: 'سمك وقار صخري حر (هامور)',
        description: 'لحم أبيض ناصع لا يحتوي على حسك رفيع، ملك المائدة البحرية للشوربة البيضاء والطهي في طواجن الطماطم والكزبرة.',
        category_id: 'cat-4',
        pricing_unit: 'kg',
        base_price: 380,
        stock_quantity: 15,
        in_stock: 1,
        image_url: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600&auto=format&fit=crop&q=80',
        badge: 'صيد حر',
        variants: [
          { id: 'var-4-1', title: 'قطعة كاملة مجهزة (1.5 كجم)', weight_kg: 1.5, piece_count: 1, price: 570, stock_quantity: 8 },
          { id: 'var-4-2', title: 'فيليه صافي خالي الشوك (1 كجم)', weight_kg: 1.0, piece_count: 1, price: 460, stock_quantity: 7 },
        ],
      },
      {
        id: 'prod-5',
        name: 'كابوريا بحرية نتي مبطرخة',
        description: 'كابوريا إناث مليئة بالبطارخ البرتقالية اللذيذة صيد مراكب بورسعيد والسويس اليومي.',
        category_id: 'cat-2',
        pricing_unit: 'kg',
        base_price: 190,
        stock_quantity: 28,
        in_stock: 1,
        image_url: 'https://images.unsplash.com/photo-1559742811-822873691df8?w=600&auto=format&fit=crop&q=80',
        badge: 'مبطرخة',
        variants: [
          { id: 'var-5-1', title: 'حجم وسط (6-8 قطع/كجم)', weight_kg: 1.0, piece_count: 7, price: 190, stock_quantity: 16 },
          { id: 'var-5-2', title: 'حجم كبير جامبو (4-5 قطع/كجم)', weight_kg: 1.0, piece_count: 5, price: 230, stock_quantity: 12 },
        ],
      },
      {
        id: 'prod-6',
        name: 'فيليه سلمون نرويجي طازج (Superior)',
        description: 'شرائح فيليه سلمون نرويجي أحمر عالي الجودة غني بأوميجا 3، مقطع ومنظف بدون شوك.',
        category_id: 'cat-3',
        pricing_unit: 'kg',
        base_price: 520,
        stock_quantity: 18,
        in_stock: 1,
        image_url: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&auto=format&fit=crop&q=80',
        badge: 'جودة نرويجية',
        variants: [
          { id: 'var-6-1', title: 'شريحة 500 جرام صافي', weight_kg: 0.5, piece_count: 1, price: 260, stock_quantity: 10 },
          { id: 'var-6-2', title: 'قطعة كاملة 1 كجم صافي', weight_kg: 1.0, piece_count: 1, price: 520, stock_quantity: 8 },
        ],
      },
      {
        id: 'prod-7',
        name: 'حبار وسبيط بلدي منظف',
        description: 'حبار بلدي طازج من مياه القناة وخليج السويس، منظف وجاهز للتقطيع حلقات للقلي أو حشو الأرز.',
        category_id: 'cat-2',
        pricing_unit: 'kg',
        base_price: 290,
        stock_quantity: 22,
        in_stock: 1,
        image_url: 'https://images.unsplash.com/photo-1599084993091-1cb5c0721cc6?w=600&auto=format&fit=crop&q=80',
        variants: [
          { id: 'var-7-1', title: 'أصابع وحلقات جاهزة للقلي (1 كجم)', weight_kg: 1.0, piece_count: 1, price: 290, stock_quantity: 12 },
          { id: 'var-7-2', title: 'سبيط كامل منظف للحشو (1 كجم)', weight_kg: 1.0, piece_count: 2, price: 310, stock_quantity: 10 },
        ],
      },
      {
        id: 'prod-8',
        name: 'سمك بربوني أحمر بلدي',
        description: 'بربوني البحر الأحمر البلدي الصغير المميز بنكهته العطرية ولحمه الشهي المقرمش عند القلي.',
        category_id: 'cat-1',
        pricing_unit: 'kg',
        base_price: 210,
        stock_quantity: 16,
        in_stock: 1,
        image_url: 'https://images.unsplash.com/photo-1510130387422-82ebd327640a?w=600&auto=format&fit=crop&q=80',
        badge: 'بلدي أحمر',
        variants: [
          { id: 'var-8-1', title: 'بربوني وسط مقلي (1 كجم)', weight_kg: 1.0, piece_count: 15, price: 210, stock_quantity: 16 },
        ],
      },
    ];

    const insertProd = db.prepare(`
      INSERT INTO products (
        id, name, description, category_id, pricing_unit, base_price,
        stock_quantity, in_stock, image_url, badge, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const insertVar = db.prepare(`
      INSERT INTO product_variants (
        id, product_id, title, weight_kg, piece_count, price, stock_quantity, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    for (const p of initialProducts) {
      insertProd.run(
        p.id,
        p.name,
        p.description,
        p.category_id,
        p.pricing_unit,
        p.base_price,
        p.stock_quantity,
        p.in_stock,
        p.image_url,
        p.badge || null,
        now
      );

      for (const v of p.variants) {
        insertVar.run(
          v.id,
          p.id,
          v.title,
          v.weight_kg,
          v.piece_count,
          v.price,
          v.stock_quantity,
          now
        );
      }
    }
  }

  // Check if coupons exist
  const coupCount = db.prepare('SELECT COUNT(*) as count FROM coupons').get() as { count: number };
  if (coupCount.count === 0) {
    const now = new Date().toISOString();
    const initialCoupons = [
      { id: 'coup-1', code: 'MALLAH20', discount_type: 'percentage', discount_value: 20, min_order_value: 250, max_discount_value: 80, usage_limit: 200, used_count: 18, expiry_date: '2026-12-31' },
      { id: 'coup-2', code: 'WELCOME50', discount_type: 'fixed', discount_value: 50, min_order_value: 300, usage_limit: 100, used_count: 12, expiry_date: '2026-12-31' },
      { id: 'coup-3', code: 'SEAFOOD10', discount_type: 'percentage', discount_value: 10, min_order_value: 150, max_discount_value: 40, usage_limit: 500, used_count: 45, expiry_date: '2026-12-31' },
    ];

    const insertCoup = db.prepare(`
      INSERT INTO coupons (
        id, code, discount_type, discount_value, min_order_value, max_discount_value,
        usage_limit, used_count, expiry_date, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    for (const c of initialCoupons) {
      insertCoup.run(
        c.id,
        c.code,
        c.discount_type,
        c.discount_value,
        c.min_order_value,
        c.max_discount_value || null,
        c.usage_limit,
        c.used_count,
        c.expiry_date,
        now
      );
    }
  }

  // Check if customers exist
  const custCount = db.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number };
  if (custCount.count === 0) {
    const now = new Date().toISOString();
    const initialCustomers = [
      { id: 'cust-1', name: 'أحمد عبد الفتاح', phone: '01023456789', city: 'القاهرة', district: 'المعادي', address: 'شارع 9 - برج السلام - المعادي', orders: 4, spent: 5400 },
      { id: 'cust-2', name: 'مروان الشافعي', phone: '01198765432', city: 'القاهرة الجديدة', district: 'التجمع الخامس', address: 'حي النرجس - فيلا 12', orders: 3, spent: 4800 },
      { id: 'cust-3', name: 'سارة محمود', phone: '01234567890', city: 'القاهرة', district: 'مدينة نصر', address: 'شارع عباس العقاد - عمارة 40', orders: 2, spent: 2900 },
      { id: 'cust-4', name: 'المهندس شريف خليل', phone: '01011223344', city: 'الجيزة', district: 'الشيخ زايد', address: 'كمبوند الياسمين - فيلا 8', orders: 5, spent: 8200 },
      { id: 'cust-5', name: 'د. طارق أنور', phone: '01555667788', city: 'الجيزة', district: 'المهندسين', address: 'شارع جامعة الدول العربية', orders: 3, spent: 4100 },
      { id: 'cust-6', name: 'نيفين سامي', phone: '01088776655', city: 'القاهرة', district: 'مصر الجديدة', address: 'ميدان الكوربة - عمارة 15', orders: 2, spent: 2300 },
    ];
    const insertCust = db.prepare(`
      INSERT INTO customers (id, name, phone, city, district, address, total_orders, total_spent, last_order_date, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `);
    for (const c of initialCustomers) {
      insertCust.run(c.id, c.name, c.phone, c.city, c.district, c.address, c.orders, c.spent, now, now);
    }
  }

  // Check if orders exist
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders').get() as { count: number };
  if (orderCount.count === 0) {
    const now = new Date();
    const isoNow = now.toISOString();

    const initialOrders = [
      {
        id: 'ord-101',
        order_number: 'ALM-10452',
        customer_id: 'cust-1',
        customer_name: 'أحمد عبد الفتاح',
        customer_phone: '01023456789',
        customer_address: 'شارع 9 - برج السلام - المعادي',
        city: 'القاهرة',
        district: 'المعادي',
        subtotal: 2040,
        discount_amount: 0,
        delivery_fee: 15,
        total_amount: 2055,
        deposit_amount: 400,
        deposit_status: 'confirmed',
        deposit_method: 'instapay',
        deposit_reference: 'INSTA-884219',
        deposit_confirmed_at: isoNow,
        deposit_confirmed_by: 'Super Admin',
        remaining_amount: 1655,
        status: 'pending',
        notes: 'يرجى تنظيف الدنيس سنجاري وتتبيل الجمبري',
        created_at: isoNow,
        items: [
          {
            id: 'item-101-1',
            product_id: 'prod-1',
            variant_id: 'var-1-2',
            product_name: 'سمك دنيس بحري ممتاز',
            variant_title: 'حجم كبير جامبو (1-2 سمكة/كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 2,
            unit_price: 270,
            quantity: 4.0,
            total_price: 1080,
          },
          {
            id: 'item-101-2',
            product_id: 'prod-3',
            variant_id: 'var-3-2',
            product_name: 'جمبري أحمر جامبو طازج',
            variant_title: 'جامبو سوبر ملكي (12-16 حبة/كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 14,
            unit_price: 480,
            quantity: 2.0,
            total_price: 960,
          },
        ],
      },
      {
        id: 'ord-102',
        order_number: 'ALM-10488',
        customer_id: 'cust-2',
        customer_name: 'مروان الشافعي',
        customer_phone: '01198765432',
        customer_address: 'حي النرجس - فيلا 12 - التجمع الخامس',
        city: 'القاهرة الجديدة',
        district: 'التجمع الخامس',
        subtotal: 2115,
        discount_amount: 0,
        delivery_fee: 25,
        total_amount: 2140,
        deposit_amount: 500,
        deposit_status: 'confirmed',
        deposit_method: 'instapay',
        deposit_reference: 'TXN-993214',
        deposit_confirmed_at: isoNow,
        deposit_confirmed_by: 'Super Admin',
        remaining_amount: 1640,
        status: 'preparing',
        notes: 'القاروص شوي زيت وليمون مع بطاطس',
        created_at: isoNow,
        items: [
          {
            id: 'item-102-1',
            product_id: 'prod-1',
            variant_id: 'var-1-2',
            product_name: 'سمك دنيس بحري ممتاز',
            variant_title: 'حجم كبير جامبو (1-2 سمكة/كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 2,
            unit_price: 270,
            quantity: 3.5,
            total_price: 945,
          },
          {
            id: 'item-102-2',
            product_id: 'prod-2',
            variant_id: 'var-2-2',
            product_name: 'سمك قاروص البحر المتوسط',
            variant_title: 'كبير فاخر (1.5كجم - 2كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.5,
            piece_count: 1,
            unit_price: 390,
            quantity: 3.0,
            total_price: 1170,
          },
        ],
      },
      {
        id: 'ord-103',
        order_number: 'ALM-10419',
        customer_id: 'cust-3',
        customer_name: 'سارة محمود',
        customer_phone: '01234567890',
        customer_address: 'شارع عباس العقاد - عمارة 40',
        city: 'القاهرة',
        district: 'مدينة نصر',
        subtotal: 1640,
        discount_amount: 0,
        delivery_fee: 20,
        total_amount: 1660,
        deposit_amount: 350,
        deposit_status: 'pending',
        deposit_method: 'vodafone_cash',
        deposit_reference: '01015192040',
        remaining_amount: 1310,
        status: 'pending',
        notes: 'تنظيف عادي مع فتح بطن وقشور',
        created_at: isoNow,
        items: [
          {
            id: 'item-103-1',
            product_id: 'prod-1',
            variant_id: 'var-1-1',
            product_name: 'سمك دنيس بحري ممتاز',
            variant_title: 'حجم وسط (3-4 سمكات/كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 4,
            unit_price: 240,
            quantity: 5.0,
            total_price: 1200,
          },
          {
            id: 'item-103-2',
            product_id: 'prod-5',
            variant_id: 'var-5-1',
            product_name: 'كابوريا بحرية نتي مبطرخة',
            variant_title: 'كابوريا نتي جامبو مبطرخة (1 كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 6,
            unit_price: 220,
            quantity: 2.0,
            total_price: 440,
          },
        ],
      },
      {
        id: 'ord-104',
        order_number: 'ALM-10492',
        customer_id: 'cust-4',
        customer_name: 'المهندس شريف خليل',
        customer_phone: '01011223344',
        customer_address: 'كمبوند الياسمين - فيلا 8',
        city: 'الجيزة',
        district: 'الشيخ زايد',
        subtotal: 1960,
        discount_amount: 0,
        delivery_fee: 35,
        total_amount: 1995,
        deposit_amount: 400,
        deposit_status: 'confirmed',
        deposit_method: 'instapay',
        deposit_reference: 'INSTA-443210',
        deposit_confirmed_at: isoNow,
        deposit_confirmed_by: 'Super Admin',
        remaining_amount: 1595,
        status: 'preparing',
        notes: 'الوقار فيليه متبل بالثوم والليمون جاهز للقلي',
        created_at: isoNow,
        items: [
          {
            id: 'item-104-1',
            product_id: 'prod-2',
            variant_id: 'var-2-1',
            product_name: 'سمك قاروص البحر المتوسط',
            variant_title: 'وسط مقاس سنجاري (800جم - 1كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 1,
            unit_price: 260,
            quantity: 4.0,
            total_price: 1040,
          },
          {
            id: 'item-104-2',
            product_id: 'prod-4',
            variant_id: 'var-4-2',
            product_name: 'سمك وقار صخري حر (هامور)',
            variant_title: 'فيليه صافي خالي الشوك (1 كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 1,
            unit_price: 460,
            quantity: 2.0,
            total_price: 920,
          },
        ],
      },
      {
        id: 'ord-105',
        order_number: 'ALM-10467',
        customer_id: 'cust-5',
        customer_name: 'د. طارق أنور',
        customer_phone: '01555667788',
        customer_address: 'شارع جامعة الدول العربية',
        city: 'الجيزة',
        district: 'المهندسين',
        subtotal: 1840,
        discount_amount: 0,
        delivery_fee: 20,
        total_amount: 1860,
        deposit_amount: 370,
        deposit_status: 'confirmed',
        deposit_method: 'instapay',
        deposit_reference: 'INSTA-110294',
        deposit_confirmed_at: isoNow,
        deposit_confirmed_by: 'Super Admin',
        remaining_amount: 1490,
        status: 'pending',
        notes: 'السبيط حلقات جاهزة للقلي',
        created_at: isoNow,
        items: [
          {
            id: 'item-105-1',
            product_id: 'prod-3',
            variant_id: 'var-3-1',
            product_name: 'جمبري أحمر جامبو طازج',
            variant_title: 'جامبو وسط (20-25 حبة/كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 22,
            unit_price: 420,
            quantity: 3.0,
            total_price: 1260,
          },
          {
            id: 'item-105-2',
            product_id: 'prod-7',
            variant_id: 'var-7-1',
            product_name: 'سبيط وحبار بلدي طازج',
            variant_title: 'أصابع وحلقات جاهزة للقلي (1 كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 1,
            unit_price: 290,
            quantity: 2.0,
            total_price: 580,
          },
        ],
      },
      {
        id: 'ord-106',
        order_number: 'ALM-10433',
        customer_id: 'cust-6',
        customer_name: 'نيفين سامي',
        customer_phone: '01088776655',
        customer_address: 'ميدان الكوربة - عمارة 15',
        city: 'القاهرة',
        district: 'مصر الجديدة',
        subtotal: 1140,
        discount_amount: 0,
        delivery_fee: 20,
        total_amount: 1160,
        deposit_amount: 250,
        deposit_status: 'confirmed',
        deposit_method: 'vodafone_cash',
        deposit_reference: 'VF-771234',
        deposit_confirmed_at: isoNow,
        deposit_confirmed_by: 'Super Admin',
        remaining_amount: 910,
        status: 'pending',
        notes: 'الدنيس شوي ردة',
        created_at: isoNow,
        items: [
          {
            id: 'item-106-1',
            product_id: 'prod-1',
            variant_id: 'var-1-1',
            product_name: 'سمك دنيس بحري ممتاز',
            variant_title: 'حجم وسط (3-4 سمكات/كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 4,
            unit_price: 240,
            quantity: 3.0,
            total_price: 720,
          },
          {
            id: 'item-106-2',
            product_id: 'prod-8',
            variant_id: 'var-8-1',
            product_name: 'سمك بربوني أحمر بلدي',
            variant_title: 'بربوني وسط مقلي (1 كجم)',
            pricing_unit: 'kg',
            weight_kg: 1.0,
            piece_count: 15,
            unit_price: 210,
            quantity: 2.0,
            total_price: 420,
          },
        ],
      },
    ];

    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, customer_name, customer_phone, customer_address,
        city, district, subtotal, discount_amount, delivery_fee, total_amount,
        deposit_amount, deposit_status, deposit_method, deposit_reference,
        deposit_confirmed_at, deposit_confirmed_by, remaining_amount,
        status, notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const insertItem = db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, variant_id, product_name, variant_title,
        pricing_unit, weight_kg, piece_count, unit_price, quantity, total_price, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const ord of initialOrders) {
      insertOrder.run(
        ord.id,
        ord.order_number,
        ord.customer_id,
        ord.customer_name,
        ord.customer_phone,
        ord.customer_address,
        ord.city,
        ord.district,
        ord.subtotal,
        ord.discount_amount,
        ord.delivery_fee,
        ord.total_amount,
        ord.deposit_amount,
        ord.deposit_status,
        ord.deposit_method,
        ord.deposit_reference,
        ord.deposit_confirmed_at || null,
        ord.deposit_confirmed_by || null,
        ord.remaining_amount,
        ord.status,
        ord.notes || null,
        ord.created_at,
        ord.created_at
      );

      for (const itm of ord.items) {
        insertItem.run(
          itm.id,
          ord.id,
          itm.product_id,
          itm.variant_id || null,
          itm.product_name,
          itm.variant_title || null,
          itm.pricing_unit,
          itm.weight_kg || null,
          itm.piece_count || null,
          itm.unit_price,
          itm.quantity,
          itm.total_price,
          ord.created_at
        );
      }
    }
  }
}
