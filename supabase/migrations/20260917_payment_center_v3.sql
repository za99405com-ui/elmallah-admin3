-- ==============================================================================
-- Migration: 20260917_payment_center_v3.sql
-- Description: Payment Center V3 - Generic Payment Sources, Device-Source Assignment,
--              Customer Payment Methods, Extended Deposit Policy, and Backward Compatibility.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Extend store_settings with structured deposit policy
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.store_settings
    ADD COLUMN IF NOT EXISTS deposit_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deposit_type TEXT NOT NULL DEFAULT 'fixed',
    ADD COLUMN IF NOT EXISTS deposit_value NUMERIC(10,2) NOT NULL DEFAULT 100.00,
    ADD COLUMN IF NOT EXISTS minimum_deposit NUMERIC(10,2) NOT NULL DEFAULT 50.00;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_deposit_type'
    ) THEN
        ALTER TABLE public.store_settings
            ADD CONSTRAINT chk_store_deposit_type
            CHECK (deposit_type IN ('fixed', 'percentage'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_deposit_value'
    ) THEN
        ALTER TABLE public.store_settings
            ADD CONSTRAINT chk_store_deposit_value
            CHECK (
                (deposit_type = 'percentage' AND deposit_value >= 0 AND deposit_value <= 100) OR
                (deposit_type = 'fixed' AND deposit_value >= 0)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_minimum_deposit'
    ) THEN
        ALTER TABLE public.store_settings
            ADD CONSTRAINT chk_store_minimum_deposit
            CHECK (minimum_deposit >= 0);
    END IF;
END $$;

-- Preserve legacy behaviour while separating "deposit available" from "deposit mandatory".
UPDATE public.store_settings
   SET deposit_required = (default_payment_policy = 'deposit_required'),
       deposit_enabled = CASE
         WHEN default_payment_policy = 'deposit_required' THEN true
         ELSE COALESCE(deposit_enabled, false)
       END
 WHERE id = 1;

-- ------------------------------------------------------------------------------
-- 2. Generic Payment Sources
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    channel TEXT NOT NULL DEFAULT 'wallet', -- 'wallet', 'bank_transfer', 'instapay', 'other'
    destination TEXT NULL,
    parser_type TEXT NOT NULL DEFAULT 'regex', -- 'regex', 'json', 'keyword', 'smart'
    source_package TEXT NULL,
    source_packages TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    source_sender TEXT NULL,
    title_contains TEXT NULL,
    body_contains TEXT NULL,
    amount_regex TEXT NULL,
    payer_phone_regex TEXT NULL,
    account_identifier_regex TEXT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_sources_enabled_priority
    ON public.payment_sources (enabled, priority DESC);
CREATE INDEX IF NOT EXISTS idx_payment_sources_code
    ON public.payment_sources (code);

-- Seed legacy-compatible payment sources and common Egyptian channels
INSERT INTO public.payment_sources (
    code, display_name, enabled, channel, source_sender, parser_type, priority, notes,
    amount_regex, payer_phone_regex
) VALUES
(
    'vf_cash',
    'فودافون كاش (Vodafone Cash)',
    true,
    'wallet',
    'VF-Cash',
    'regex',
    100,
    'المصدر الافتراضي لمحفظة فودافون كاش',
    '(?:تم استلام|استلمت|تحويل بمبلغ|مبلغ)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:جنيه|ج\.م|EGP)?',
    '(01[0125][0-9]{8})'
),
(
    'bank_alahly',
    'البنك الأهلي المصري (NBE)',
    true,
    'bank_transfer',
    'NBE',
    'regex',
    90,
    'المصدر الافتراضي لإشعارات البنك الأهلي المصري',
    '(?:تحويل وارد بمبلغ|إيداع بمبلغ|مبلغ|EGP)\s*([0-9,]+(?:\.[0-9]+)?)',
    NULL
),
(
    'instapay',
    'إنستاباي (InstaPay)',
    false,
    'instapay',
    'InstaPay',
    'regex',
    95,
    'شبكة المدفوعات اللحظية إنستاباي',
    '(?:received|استلام|مبلغ|EGP)\s*([0-9,]+(?:\.[0-9]+)?)',
    NULL
),
(
    'banque_misr',
    'بنك مصر (Banque Misr)',
    false,
    'bank_transfer',
    'BM',
    'regex',
    85,
    'حسابات وتحويلات بنك مصر',
    '(?:إيداع بمبلغ|تحويل بمبلغ)\s*([0-9,]+(?:\.[0-9]+)?)',
    NULL
)
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    channel = EXCLUDED.channel,
    source_sender = COALESCE(public.payment_sources.source_sender, EXCLUDED.source_sender),
    amount_regex = COALESCE(public.payment_sources.amount_regex, EXCLUDED.amount_regex);

-- ------------------------------------------------------------------------------
-- 3. Device ↔ Payment Source relational assignment
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_device_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.payment_devices(id) ON DELETE CASCADE,
    payment_source_id UUID NOT NULL REFERENCES public.payment_sources(id) ON DELETE CASCADE,
    destination TEXT NULL,
    destination_label TEXT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, payment_source_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_device_sources_lookup
    ON public.payment_device_sources (device_id, payment_source_id, enabled);

-- Existing installations may already have payment_device_sources.
ALTER TABLE IF EXISTS public.payment_device_sources
    ADD COLUMN IF NOT EXISTS destination TEXT NULL,
    ADD COLUMN IF NOT EXISTS destination_label TEXT NULL;

-- Backward-compatible initial destination: inherit the device's old single destination.
UPDATE public.payment_device_sources pds
   SET destination = d.payment_destination
  FROM public.payment_devices d
 WHERE pds.device_id = d.id
   AND NULLIF(trim(COALESCE(pds.destination, '')), '') IS NULL
   AND NULLIF(trim(COALESCE(d.payment_destination, '')), '') IS NOT NULL;

-- Seed device sources from existing boolean columns for backward compatibility
DO $$
DECLARE
    v_vf_id UUID;
    v_nbe_id UUID;
BEGIN
    SELECT id INTO v_vf_id FROM public.payment_sources WHERE code = 'vf_cash' LIMIT 1;
    SELECT id INTO v_nbe_id FROM public.payment_sources WHERE code = 'bank_alahly' LIMIT 1;

    IF v_vf_id IS NOT NULL THEN
        INSERT INTO public.payment_device_sources (device_id, payment_source_id, enabled)
        SELECT id, v_vf_id, true
          FROM public.payment_devices
         WHERE vf_cash_enabled = true
        ON CONFLICT (device_id, payment_source_id) DO NOTHING;
    END IF;

    IF v_nbe_id IS NOT NULL THEN
        INSERT INTO public.payment_device_sources (device_id, payment_source_id, enabled)
        SELECT id, v_nbe_id, true
          FROM public.payment_devices
         WHERE bank_alahly_enabled = true
        ON CONFLICT (device_id, payment_source_id) DO NOTHING;
    END IF;
END $;

-- Seeded legacy assignments are created after the first compatibility backfill,
-- so run the destination inheritance once more for those newly-created rows.
UPDATE public.payment_device_sources pds
   SET destination = d.payment_destination
  FROM public.payment_devices d
 WHERE pds.device_id = d.id
   AND NULLIF(trim(COALESCE(pds.destination, '')), '') IS NULL
   AND NULLIF(trim(COALESCE(d.payment_destination, '')), '') IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 4. Customer-facing Payment Methods & Mappings
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    channel TEXT NOT NULL DEFAULT 'other', -- 'cash_on_delivery', 'wallet', 'instapay', 'bank_transfer', 'card', 'other'
    instructions TEXT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_payment_methods_sort
    ON public.customer_payment_methods (enabled, sort_order ASC);

CREATE TABLE IF NOT EXISTS public.customer_payment_method_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_payment_method_id UUID NOT NULL REFERENCES public.customer_payment_methods(id) ON DELETE CASCADE,
    payment_source_id UUID NOT NULL REFERENCES public.payment_sources(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_payment_method_id, payment_source_id)
);

-- Seed standard customer payment methods
INSERT INTO public.customer_payment_methods (code, display_name, enabled, channel, instructions, sort_order)
VALUES
(
    'cash_on_delivery',
    'الدفع عند الاستلام (COD)',
    true,
    'cash_on_delivery',
    'الدفع نقداً عند استلام الطلب من مندوب التوصيل',
    1
),
(
    'vodafone_cash',
    'فودافون كاش / المحافظ الإلكترونية',
    true,
    'wallet',
    'تحويل المبلغ إلى رقم المحفظة الظاهر، وتأكيد العملية فورياً',
    2
),
(
    'instapay',
    'إنستاباي (InstaPay)',
    false,
    'instapay',
    'تحويل عبر تطبيق إنستاباي إلى عنوان الدفع اللحظي أو رقم الحساب',
    3
),
(
    'bank_transfer',
    'تحويل بنكي مباشر',
    true,
    'bank_transfer',
    'تحويل مصرفي مباشر إلى الحساب البنكي',
    4
)
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    channel = EXCLUDED.channel,
    instructions = COALESCE(public.customer_payment_methods.instructions, EXCLUDED.instructions);

-- Connect customer payment methods with underlying payment sources
DO $$
DECLARE
    v_c_vf UUID;
    v_c_insta UUID;
    v_c_bank UUID;
    v_s_vf UUID;
    v_s_nbe UUID;
    v_s_insta UUID;
    v_s_bm UUID;
BEGIN
    SELECT id INTO v_c_vf FROM public.customer_payment_methods WHERE code = 'vodafone_cash';
    SELECT id INTO v_c_insta FROM public.customer_payment_methods WHERE code = 'instapay';
    SELECT id INTO v_c_bank FROM public.customer_payment_methods WHERE code = 'bank_transfer';

    SELECT id INTO v_s_vf FROM public.payment_sources WHERE code = 'vf_cash';
    SELECT id INTO v_s_nbe FROM public.payment_sources WHERE code = 'bank_alahly';
    SELECT id INTO v_s_insta FROM public.payment_sources WHERE code = 'instapay';
    SELECT id INTO v_s_bm FROM public.payment_sources WHERE code = 'banque_misr';

    IF v_c_vf IS NOT NULL AND v_s_vf IS NOT NULL THEN
        INSERT INTO public.customer_payment_method_sources (customer_payment_method_id, payment_source_id, is_primary)
        VALUES (v_c_vf, v_s_vf, true)
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_c_insta IS NOT NULL AND v_s_insta IS NOT NULL THEN
        INSERT INTO public.customer_payment_method_sources (customer_payment_method_id, payment_source_id, is_primary)
        VALUES (v_c_insta, v_s_insta, true)
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_c_bank IS NOT NULL AND v_s_nbe IS NOT NULL THEN
        INSERT INTO public.customer_payment_method_sources (customer_payment_method_id, payment_source_id, is_primary)
        VALUES (v_c_bank, v_s_nbe, true)
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_c_bank IS NOT NULL AND v_s_bm IS NOT NULL THEN
        INSERT INTO public.customer_payment_method_sources (customer_payment_method_id, payment_source_id, is_primary)
        VALUES (v_c_bank, v_s_bm, false)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. Extend payment_sessions and payment_bridge_events for generic sources
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.payment_sessions
    ADD COLUMN IF NOT EXISTS payment_source_id UUID NULL REFERENCES public.payment_sources(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS customer_payment_method_id UUID NULL REFERENCES public.customer_payment_methods(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payment_intent TEXT NULL;

DO $
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_session_intent'
    ) THEN
        ALTER TABLE public.payment_sessions
            ADD CONSTRAINT chk_payment_session_intent
            CHECK (payment_intent IS NULL OR payment_intent IN ('full_payment', 'deposit'));
    END IF;
END $;

CREATE INDEX IF NOT EXISTS idx_payment_sessions_source
    ON public.payment_sessions (payment_source_id, created_at DESC);

-- Relax provider constraint on payment_sessions to allow generic source codes
DO $$
BEGIN
    ALTER TABLE public.payment_sessions
        DROP CONSTRAINT IF EXISTS chk_payment_session_provider;
END $$;

ALTER TABLE IF EXISTS public.payment_bridge_events
    ADD COLUMN IF NOT EXISTS payment_source_id UUID NULL REFERENCES public.payment_sources(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS account_identifier TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_bridge_events_source
    ON public.payment_bridge_events (payment_source_id, captured_at DESC);

DO $$
BEGIN
    ALTER TABLE public.payment_bridge_events
        DROP CONSTRAINT IF EXISTS chk_bridge_event_provider;
END $$;

-- Backfill payment_source_id in existing sessions and events
UPDATE public.payment_sessions s
   SET payment_source_id = src.id
  FROM public.payment_sources src
 WHERE s.payment_source_id IS NULL
   AND (
        (s.provider = 'vf_cash' AND src.code = 'vf_cash')
     OR (s.provider = 'bank_alahly' AND src.code = 'bank_alahly')
     OR (s.provider = src.code)
   );

UPDATE public.payment_bridge_events e
   SET payment_source_id = src.id
  FROM public.payment_sources src
 WHERE e.payment_source_id IS NULL
   AND (
        (e.provider = 'vf_cash' AND src.code = 'vf_cash')
     OR (e.provider = 'bank_alahly' AND src.code = 'bank_alahly')
     OR (e.provider = src.code)
   );

-- ------------------------------------------------------------------------------
-- 6. Updated Atomic Device Reservation supporting Generic Payment Sources
--    Device must be: enabled, online, fresh heartbeat, internet, service/app,
--    listener active, not busy, AND assigned to the enabled payment source.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_payment_device(
    p_session_id UUID,
    p_provider TEXT
)
RETURNS TABLE (
    device_row_id UUID,
    device_public_id TEXT,
    destination TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_device public.payment_devices%ROWTYPE;
    v_source public.payment_sources%ROWTYPE;
    v_assignment public.payment_device_sources%ROWTYPE;
    v_clean_provider TEXT;
    v_destination TEXT;
BEGIN
    v_clean_provider := lower(trim(p_provider));

    -- Resolve payment source by code or UUID
    SELECT *
      INTO v_source
      FROM public.payment_sources
     WHERE (code = v_clean_provider OR id::text = v_clean_provider)
       AND enabled = true
     LIMIT 1;

    -- Fallback lookup for legacy aliases
    IF v_source.id IS NULL THEN
        IF v_clean_provider IN ('vodafone_cash', 'vf_cash') THEN
            SELECT * INTO v_source FROM public.payment_sources WHERE code = 'vf_cash' LIMIT 1;
        ELSIF v_clean_provider IN ('bank_alahly', 'nbe', 'bank_al_ahly') THEN
            SELECT * INTO v_source FROM public.payment_sources WHERE code = 'bank_alahly' LIMIT 1;
        END IF;
    END IF;

    -- Select best eligible device with FOR UPDATE SKIP LOCKED
    SELECT d.*
      INTO v_device
      FROM public.payment_devices d
     WHERE d.is_enabled = true
       AND d.online = true
       AND d.internet_connected = true
       AND d.app_running = true
       AND d.notification_listener_enabled = true
       AND d.is_busy = false
       AND d.busy_session_id IS NULL
       AND d.last_heartbeat_at IS NOT NULL
       AND d.last_heartbeat_at >= now() - interval '45 seconds'
       AND (
            -- Either device is assigned to this dynamic source in payment_device_sources
            (v_source.id IS NOT NULL AND EXISTS (
                SELECT 1
                  FROM public.payment_device_sources pds
                 WHERE pds.device_id = d.id
                   AND pds.payment_source_id = v_source.id
                   AND pds.enabled = true
                   AND COALESCE(
                        NULLIF(trim(pds.destination), ''),
                        NULLIF(trim(d.payment_destination), ''),
                        NULLIF(trim(v_source.destination), '')
                   ) IS NOT NULL
            ))
            -- Or legacy fallback boolean flags, only with a usable destination.
            OR (
                v_clean_provider IN ('vf_cash', 'vodafone_cash')
                AND d.vf_cash_enabled = true
                AND COALESCE(NULLIF(trim(d.payment_destination), ''), NULLIF(trim(v_source.destination), '')) IS NOT NULL
            )
            OR (
                v_clean_provider IN ('bank_alahly', 'nbe')
                AND d.bank_alahly_enabled = true
                AND COALESCE(NULLIF(trim(d.payment_destination), ''), NULLIF(trim(v_source.destination), '')) IS NOT NULL
            )
       )
     ORDER BY d.last_heartbeat_at DESC, d.created_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1;

    IF v_device.id IS NULL THEN
        RETURN;
    END IF;

    -- Resolve the destination specifically for the selected device + source.
    IF v_source.id IS NOT NULL THEN
        SELECT *
          INTO v_assignment
          FROM public.payment_device_sources
         WHERE device_id = v_device.id
           AND payment_source_id = v_source.id
           AND enabled = true
         LIMIT 1;
    END IF;

    v_destination := COALESCE(
        NULLIF(trim(v_assignment.destination), ''),
        NULLIF(trim(v_device.payment_destination), ''),
        NULLIF(trim(v_source.destination), '')
    );

    -- Atomically occupy the device
    UPDATE public.payment_devices
       SET is_busy = true,
           busy_session_id = p_session_id,
           updated_at = now()
     WHERE id = v_device.id;

    -- Update session with device and resolved payment source
    UPDATE public.payment_sessions
       SET device_id = v_device.id,
           device_public_id = v_device.device_id,
           payment_destination = v_destination,
           payment_source_id = COALESCE(v_source.id, payment_source_id),
           updated_at = now()
     WHERE id = p_session_id;

    RETURN QUERY SELECT v_device.id, v_device.device_id, v_destination;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Security Hardening / RLS for new tables
-- ------------------------------------------------------------------------------
ALTER TABLE public.payment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_device_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payment_method_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS service_role_all_payment_sources ON public.payment_sources;
    DROP POLICY IF EXISTS service_role_all_payment_device_sources ON public.payment_device_sources;
    DROP POLICY IF EXISTS service_role_all_customer_payment_methods ON public.customer_payment_methods;
    DROP POLICY IF EXISTS service_role_all_customer_payment_method_sources ON public.customer_payment_method_sources;

    CREATE POLICY service_role_all_payment_sources
        ON public.payment_sources FOR ALL TO service_role USING (true) WITH CHECK (true);

    CREATE POLICY service_role_all_payment_device_sources
        ON public.payment_device_sources FOR ALL TO service_role USING (true) WITH CHECK (true);

    CREATE POLICY service_role_all_customer_payment_methods
        ON public.customer_payment_methods FOR ALL TO service_role USING (true) WITH CHECK (true);

    CREATE POLICY service_role_all_customer_payment_method_sources
        ON public.customer_payment_method_sources FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;

REVOKE ALL ON TABLE public.payment_sources FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_device_sources FROM anon, authenticated;
REVOKE ALL ON TABLE public.customer_payment_methods FROM anon, authenticated;
REVOKE ALL ON TABLE public.customer_payment_method_sources FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_payment_device(UUID, TEXT) TO service_role;
