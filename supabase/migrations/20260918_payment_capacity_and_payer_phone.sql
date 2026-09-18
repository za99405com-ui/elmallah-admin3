-- Payment session capacity + payer phone matching.
-- One payment phone can safely serve multiple concurrent sessions while admin3
-- remains authoritative for allocation and matching.

ALTER TABLE public.payment_devices
  ADD COLUMN IF NOT EXISTS max_concurrent_sessions INTEGER NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_device_max_concurrent_sessions'
  ) THEN
    ALTER TABLE public.payment_devices
      ADD CONSTRAINT chk_payment_device_max_concurrent_sessions
      CHECK (max_concurrent_sessions BETWEEN 1 AND 10);
  END IF;
END $$;

ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS expected_payer_phone TEXT NULL,
  ADD COLUMN IF NOT EXISTS payer_phone_confirmed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_payment_sessions_device_waiting
  ON public.payment_sessions (device_id, status, expires_at)
  WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_payment_sessions_expected_payer_phone
  ON public.payment_sessions (expected_payer_phone)
  WHERE expected_payer_phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.refresh_payment_device_capacity(p_device_id UUID)
RETURNS TABLE(active_sessions INTEGER, max_sessions INTEGER, is_full BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active INTEGER := 0;
  v_max INTEGER := 3;
  v_full BOOLEAN := false;
  v_marker UUID := NULL;
BEGIN
  SELECT COALESCE(max_concurrent_sessions, 3)
    INTO v_max
    FROM public.payment_devices
   WHERE id = p_device_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER
    INTO v_active
    FROM public.payment_sessions
   WHERE device_id = p_device_id
     AND status = 'waiting'
     AND expires_at > now();

  v_full := v_active >= v_max;

  IF v_full THEN
    SELECT id
      INTO v_marker
      FROM public.payment_sessions
     WHERE device_id = p_device_id
       AND status = 'waiting'
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  UPDATE public.payment_devices
     SET is_busy = v_full,
         busy_session_id = v_marker,
         updated_at = now()
   WHERE id = p_device_id;

  RETURN QUERY SELECT v_active, v_max, v_full;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_payment_device(
  p_session_id UUID,
  p_provider TEXT
)
RETURNS TABLE(device_row_id UUID, device_public_id TEXT, destination TEXT)
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
  v_active INTEGER;
  v_max INTEGER;
BEGIN
  v_clean_provider := lower(trim(p_provider));

  SELECT *
    INTO v_source
    FROM public.payment_sources
   WHERE (code = v_clean_provider OR id::text = v_clean_provider)
     AND enabled = true
   LIMIT 1;

  IF v_source.id IS NULL THEN
    IF v_clean_provider IN ('vodafone_cash', 'vf_cash') THEN
      SELECT *
        INTO v_source
        FROM public.payment_sources
       WHERE code = 'vf_cash'
         AND enabled = true
       LIMIT 1;
    ELSIF v_clean_provider IN ('bank_alahly', 'nbe', 'bank_al_ahly') THEN
      SELECT *
        INTO v_source
        FROM public.payment_sources
       WHERE code = 'bank_alahly'
         AND enabled = true
       LIMIT 1;
    END IF;
  END IF;

  FOR v_device IN
    SELECT d.*
      FROM public.payment_devices d
     WHERE d.is_enabled = true
       AND d.online = true
       AND d.internet_connected = true
       AND d.app_running = true
       AND d.notification_listener_enabled = true
       AND d.last_heartbeat_at IS NOT NULL
       AND d.last_heartbeat_at >= now() - interval '45 seconds'
       AND (
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
         OR (
           v_source.id IS NOT NULL
           AND v_clean_provider IN ('vf_cash', 'vodafone_cash')
           AND d.vf_cash_enabled = true
           AND COALESCE(
             NULLIF(trim(d.payment_destination), ''),
             NULLIF(trim(v_source.destination), '')
           ) IS NOT NULL
         )
         OR (
           v_source.id IS NOT NULL
           AND v_clean_provider IN ('bank_alahly', 'nbe')
           AND d.bank_alahly_enabled = true
           AND COALESCE(
             NULLIF(trim(d.payment_destination), ''),
             NULLIF(trim(v_source.destination), '')
           ) IS NOT NULL
         )
       )
     ORDER BY
       (
         SELECT COUNT(*)
           FROM public.payment_sessions s
          WHERE s.device_id = d.id
            AND s.status = 'waiting'
            AND s.expires_at > now()
       ) ASC,
       d.last_heartbeat_at DESC,
       d.created_at ASC
  LOOP
    -- Serialize allocation per device so concurrent checkout requests cannot
    -- exceed the configured capacity.
    PERFORM pg_advisory_xact_lock(hashtext(v_device.id::text));

    SELECT COALESCE(max_concurrent_sessions, 3)
      INTO v_max
      FROM public.payment_devices
     WHERE id = v_device.id;

    SELECT COUNT(*)::INTEGER
      INTO v_active
      FROM public.payment_sessions
     WHERE device_id = v_device.id
       AND status = 'waiting'
       AND expires_at > now();

    IF v_active >= v_max THEN
      CONTINUE;
    END IF;

    v_assignment := NULL;
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

    IF v_destination IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.payment_sessions
       SET device_id = v_device.id,
           device_public_id = v_device.device_id,
           payment_destination = v_destination,
           payment_source_id = COALESCE(v_source.id, payment_source_id),
           updated_at = now()
     WHERE id = p_session_id
       AND status = 'waiting';

    IF NOT FOUND THEN
      RETURN;
    END IF;

    v_active := v_active + 1;

    UPDATE public.payment_devices
       SET is_busy = (v_active >= v_max),
           busy_session_id = CASE WHEN v_active >= v_max THEN p_session_id ELSE NULL END,
           updated_at = now()
     WHERE id = v_device.id;

    RETURN QUERY SELECT v_device.id, v_device.device_id, v_destination;
    RETURN;
  END LOOP;

  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_payment_sessions()
RETURNS TABLE(expired_session_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    UPDATE public.payment_sessions s
       SET status = 'expired',
           updated_at = now()
     WHERE s.status = 'waiting'
       AND s.expires_at <= now()
     RETURNING s.id, s.device_id
  LOOP
    IF v_row.device_id IS NOT NULL THEN
      PERFORM public.refresh_payment_device_capacity(v_row.device_id);
    END IF;

    expired_session_id := v_row.id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Normalize the compatibility busy flag for the current state immediately.
DO $$
DECLARE
  v_device RECORD;
BEGIN
  FOR v_device IN SELECT id FROM public.payment_devices LOOP
    PERFORM public.refresh_payment_device_capacity(v_device.id);
  END LOOP;
END $$;
