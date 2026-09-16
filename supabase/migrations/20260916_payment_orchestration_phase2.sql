-- ==============================================================================
-- Migration: 20260916_payment_orchestration_phase2.sql
-- Description: Payment Orchestration Phase 2 - devices, sessions, bridge events,
--              review queue, global defaults and atomic device reservation.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Global payment defaults (kept on the existing singleton store_settings row)
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.store_settings
    ADD COLUMN IF NOT EXISTS default_payment_policy TEXT NOT NULL DEFAULT 'cod_allowed',
    ADD COLUMN IF NOT EXISTS payment_session_timeout_seconds INTEGER NOT NULL DEFAULT 120,
    ADD COLUMN IF NOT EXISTS payment_amount_tolerance NUMERIC(10,2) NOT NULL DEFAULT 10.00;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_default_payment_policy'
    ) THEN
        ALTER TABLE public.store_settings
            ADD CONSTRAINT chk_store_default_payment_policy
            CHECK (default_payment_policy IN ('cod_allowed', 'deposit_required'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_session_timeout_seconds'
    ) THEN
        ALTER TABLE public.store_settings
            ADD CONSTRAINT chk_payment_session_timeout_seconds
            CHECK (payment_session_timeout_seconds BETWEEN 30 AND 600);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_amount_tolerance'
    ) THEN
        ALTER TABLE public.store_settings
            ADD CONSTRAINT chk_payment_amount_tolerance
            CHECK (payment_amount_tolerance >= 0);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Merchant payment devices
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    payment_destination TEXT NOT NULL,
    hmac_secret TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT true,

    vf_cash_enabled BOOLEAN NOT NULL DEFAULT false,
    bank_alahly_enabled BOOLEAN NOT NULL DEFAULT false,

    online BOOLEAN NOT NULL DEFAULT false,
    internet_connected BOOLEAN NOT NULL DEFAULT false,
    app_running BOOLEAN NOT NULL DEFAULT false,
    notification_listener_enabled BOOLEAN NOT NULL DEFAULT false,

    is_busy BOOLEAN NOT NULL DEFAULT false,
    busy_session_id UUID NULL,
    last_heartbeat_at TIMESTAMPTZ NULL,
    last_event_at TIMESTAMPTZ NULL,
    app_version TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_devices_availability
    ON public.payment_devices (is_enabled, online, is_busy, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_payment_devices_device_id
    ON public.payment_devices (device_id);

-- ------------------------------------------------------------------------------
-- 3. Payment sessions - server is authoritative for status and reservation
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    order_id TEXT NOT NULL,
    customer_id TEXT NULL,
    customer_phone TEXT NULL,
    provider TEXT NOT NULL,
    expected_amount NUMERIC(12,2) NOT NULL,
    amount_tolerance NUMERIC(10,2) NOT NULL DEFAULT 10.00,
    currency TEXT NOT NULL DEFAULT 'EGP',

    device_id UUID NULL REFERENCES public.payment_devices(id) ON DELETE SET NULL,
    device_public_id TEXT NULL,
    payment_destination TEXT NULL,

    status TEXT NOT NULL DEFAULT 'waiting',
    expires_at TIMESTAMPTZ NOT NULL,
    contacted_support_at TIMESTAMPTZ NULL,

    matched_event_id UUID NULL,
    matched_amount NUMERIC(12,2) NULL,
    amount_difference NUMERIC(12,2) NULL,
    payer_phone TEXT NULL,
    paid_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    cancellation_reason TEXT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_payment_session_provider
        CHECK (provider IN ('vf_cash', 'bank_alahly')),
    CONSTRAINT chk_payment_session_status
        CHECK (status IN ('waiting', 'paid', 'expired', 'expired_needs_review', 'needs_review', 'cancelled')),
    CONSTRAINT chk_payment_session_expected_amount
        CHECK (expected_amount > 0),
    CONSTRAINT chk_payment_session_tolerance
        CHECK (amount_tolerance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_order
    ON public.payment_sessions (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_device_status
    ON public.payment_sessions (device_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_expiry
    ON public.payment_sessions (status, expires_at);

-- At most one active waiting session can own a device.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_sessions_one_waiting_per_device
    ON public.payment_sessions (device_id)
    WHERE status = 'waiting' AND device_id IS NOT NULL;

-- Complete the circular relationship after payment_sessions exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_devices_busy_session'
    ) THEN
        ALTER TABLE public.payment_devices
            ADD CONSTRAINT fk_payment_devices_busy_session
            FOREIGN KEY (busy_session_id)
            REFERENCES public.payment_sessions(id)
            ON DELETE SET NULL
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. Raw bridge events. Transaction reference is retained for audit only and is
--    intentionally NOT part of the matching key.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_bridge_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    device_id UUID NOT NULL REFERENCES public.payment_devices(id) ON DELETE RESTRICT,
    reported_device_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    payment_channel TEXT NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EGP',
    payer_phone TEXT NULL,
    wallet_phone TEXT NULL,
    transaction_reference TEXT NULL,
    account_last4 TEXT NULL,
    source_sender TEXT NULL,
    source_package TEXT NULL,
    notification_posted_at TIMESTAMPTZ NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    parser_version TEXT NULL,
    parse_confidence TEXT NULL,
    raw_message_hash TEXT NULL,

    request_nonce TEXT NULL,
    body_hash TEXT NULL,
    match_status TEXT NOT NULL DEFAULT 'received',
    matched_session_id UUID NULL REFERENCES public.payment_sessions(id) ON DELETE SET NULL,
    amount_difference NUMERIC(12,2) NULL,
    processing_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_bridge_event_provider
        CHECK (provider IN ('vf_cash', 'bank_alahly')),
    CONSTRAINT chk_bridge_event_amount_minor
        CHECK (amount_minor > 0)
);

CREATE INDEX IF NOT EXISTS idx_payment_bridge_events_device_time
    ON public.payment_bridge_events (device_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_bridge_events_match
    ON public.payment_bridge_events (match_status, received_at DESC);

-- ------------------------------------------------------------------------------
-- 5. Manual review queue
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_review_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    session_id UUID NULL REFERENCES public.payment_sessions(id) ON DELETE SET NULL,
    event_id UUID NULL REFERENCES public.payment_bridge_events(id) ON DELETE SET NULL,
    order_id TEXT NULL,
    expected_amount NUMERIC(12,2) NULL,
    received_amount NUMERIC(12,2) NULL,
    amount_difference NUMERIC(12,2) NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolution TEXT NULL,
    resolved_by TEXT NULL,
    resolved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_payment_review_reason
        CHECK (reason IN (
            'no_match',
            'ambiguous',
            'underpaid',
            'late_payment',
            'expired_customer_contacted_support'
        )),
    CONSTRAINT chk_payment_review_status
        CHECK (status IN ('open', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_payment_review_open
    ON public.payment_review_items (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_review_session
    ON public.payment_review_items (session_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_review_unique_open_reason_session
    ON public.payment_review_items (reason, session_id)
    WHERE status = 'open' AND session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_review_unique_open_reason_event
    ON public.payment_review_items (reason, event_id)
    WHERE status = 'open' AND event_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 6. Atomic reservation. Criteria intentionally mirror the business rules:
--    online + fresh heartbeat + internet + service/app + listener + provider +
--    not busy. FOR UPDATE SKIP LOCKED prevents two customers taking one device.
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
BEGIN
    IF p_provider NOT IN ('vf_cash', 'bank_alahly') THEN
        RAISE EXCEPTION 'Unsupported payment provider';
    END IF;

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
            (p_provider = 'vf_cash' AND d.vf_cash_enabled = true)
         OR (p_provider = 'bank_alahly' AND d.bank_alahly_enabled = true)
       )
     ORDER BY d.last_heartbeat_at DESC, d.created_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1;

    IF v_device.id IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.payment_devices
       SET is_busy = true,
           busy_session_id = p_session_id,
           updated_at = now()
     WHERE id = v_device.id;

    UPDATE public.payment_sessions
       SET device_id = v_device.id,
           device_public_id = v_device.device_id,
           payment_destination = v_device.payment_destination,
           updated_at = now()
     WHERE id = p_session_id;

    RETURN QUERY SELECT v_device.id, v_device.device_id, v_device.payment_destination;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Expire waiting sessions and free their reserved devices.
--    API calls invoke this sweep opportunistically; no background scheduler is
--    required for correctness.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_payment_sessions()
RETURNS TABLE (expired_session_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH expired AS (
        UPDATE public.payment_sessions s
           SET status = 'expired',
               updated_at = now()
         WHERE s.status = 'waiting'
           AND s.expires_at <= now()
        RETURNING s.id
    ), released AS (
        UPDATE public.payment_devices d
           SET is_busy = false,
               busy_session_id = NULL,
               updated_at = now()
         WHERE d.busy_session_id IN (SELECT id FROM expired)
        RETURNING d.id
    )
    SELECT id FROM expired;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. RLS. The backend uses service_role. No payment secrets are exposed directly
--    to anon/authenticated clients; all access goes through the admin3 API.
-- ------------------------------------------------------------------------------
ALTER TABLE public.payment_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_bridge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_review_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_devices' AND policyname = 'service_role_all_payment_devices') THEN
        CREATE POLICY service_role_all_payment_devices ON public.payment_devices FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_sessions' AND policyname = 'service_role_all_payment_sessions') THEN
        CREATE POLICY service_role_all_payment_sessions ON public.payment_sessions FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_bridge_events' AND policyname = 'service_role_all_payment_bridge_events') THEN
        CREATE POLICY service_role_all_payment_bridge_events ON public.payment_bridge_events FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_review_items' AND policyname = 'service_role_all_payment_review_items') THEN
        CREATE POLICY service_role_all_payment_review_items ON public.payment_review_items FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
