-- ==============================================================================
-- Migration: 20260915_customer_identity_and_policies.sql
-- Description: Canonical Customer Identity, Linked Accounts, Policies & Merges
-- ==============================================================================

-- 1. Create customer_accounts table
CREATE TABLE IF NOT EXISTS public.customer_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    phone VARCHAR(15) NOT NULL UNIQUE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    verified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NULL,
    last_login_at TIMESTAMPTZ NULL,
    linked_by_admin_id TEXT NULL,
    notes TEXT NULL
);

-- Indexes for customer_accounts
CREATE INDEX IF NOT EXISTS idx_customer_accounts_customer_id ON public.customer_accounts (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_phone ON public.customer_accounts (phone);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_is_active ON public.customer_accounts (is_active);

-- Partial unique index: Enforce at most one primary account per customer
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_primary_per_customer 
ON public.customer_accounts (customer_id) 
WHERE is_primary = true;

-- 2. Create customer_policies table
CREATE TABLE IF NOT EXISTS public.customer_policies (
    customer_id TEXT PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
    is_blocked BOOLEAN NOT NULL DEFAULT false,
    block_reason TEXT NULL,
    blocked_until TIMESTAMPTZ NULL,
    personal_discount_enabled BOOLEAN NOT NULL DEFAULT false,
    personal_discount_type VARCHAR(20) NULL,
    personal_discount_value NUMERIC(10,2) NULL,
    personal_discount_max_amount NUMERIC(10,2) NULL,
    personal_discount_expires_at TIMESTAMPTZ NULL,
    cod_override VARCHAR(20) NOT NULL DEFAULT 'inherit',
    cod_max_order_amount NUMERIC(10,2) NULL,
    cod_expires_at TIMESTAMPTZ NULL,
    admin_notes TEXT NULL,
    updated_by TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_personal_discount_type CHECK (
        personal_discount_type IS NULL OR personal_discount_type IN ('percentage', 'fixed')
    ),
    CONSTRAINT chk_cod_override CHECK (
        cod_override IN ('inherit', 'allow', 'deny')
    ),
    CONSTRAINT chk_personal_discount_value CHECK (
        personal_discount_value IS NULL 
        OR (personal_discount_type = 'percentage' AND personal_discount_value > 0 AND personal_discount_value <= 100)
        OR (personal_discount_type = 'fixed' AND personal_discount_value > 0)
    ),
    CONSTRAINT chk_cod_max_order_amount CHECK (
        cod_max_order_amount IS NULL OR cod_max_order_amount >= 0
    )
);

-- 3. Create customer_identity_merges audit table
CREATE TABLE IF NOT EXISTS public.customer_identity_merges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_customer_id TEXT NOT NULL,
    target_customer_id TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    performed_by TEXT NOT NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    snapshot_json JSONB NOT NULL,
    notes TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_identity_merges_target ON public.customer_identity_merges (target_customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_identity_merges_source ON public.customer_identity_merges (source_customer_id);

-- 4. Safely migrate existing customers to customer_accounts
-- Each existing customer gets one primary active account based on their existing phone number.
-- Preserves existing customers.id and maintains idempotency.
INSERT INTO public.customer_accounts (
    customer_id,
    phone,
    is_primary,
    is_active,
    verified_at,
    created_at
)
SELECT 
    c.id AS customer_id,
    TRIM(c.phone) AS phone,
    true AS is_primary,
    true AS is_active,
    COALESCE(c.created_at, now()) AS verified_at,
    COALESCE(c.created_at, now()) AS created_at
FROM public.customers c
WHERE c.phone IS NOT NULL AND TRIM(c.phone) <> ''
ON CONFLICT (phone) DO NOTHING;

-- 5. Seed initial policies for existing blocked customers
INSERT INTO public.customer_policies (
    customer_id,
    is_blocked,
    block_reason,
    updated_at
)
SELECT 
    c.id AS customer_id,
    true AS is_blocked,
    COALESCE(c.notes, 'محظور من لوحة الإدارة السابقة') AS block_reason,
    now() AS updated_at
FROM public.customers c
WHERE c.status = 'blocked'
ON CONFLICT (customer_id) DO UPDATE 
SET is_blocked = EXCLUDED.is_blocked,
    block_reason = COALESCE(customer_policies.block_reason, EXCLUDED.block_reason);

-- Enable RLS (Row Level Security) if needed and grant permissions to service_role / authenticated
ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_identity_merges ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS by default in Supabase, but adding permissive policy for service_role ensures backend API operates smoothly
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'customer_accounts' AND policyname = 'service_role_all_customer_accounts'
    ) THEN
        CREATE POLICY service_role_all_customer_accounts ON public.customer_accounts FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'customer_policies' AND policyname = 'service_role_all_customer_policies'
    ) THEN
        CREATE POLICY service_role_all_customer_policies ON public.customer_policies FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'customer_identity_merges' AND policyname = 'service_role_all_merges'
    ) THEN
        CREATE POLICY service_role_all_merges ON public.customer_identity_merges FOR ALL USING (true);
    END IF;
END $$;
