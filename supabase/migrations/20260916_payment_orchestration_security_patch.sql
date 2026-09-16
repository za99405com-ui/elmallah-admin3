-- ==============================================================================
-- Payment Orchestration security hardening
-- Restrict financial tables/RPCs to the backend service role only.
-- ==============================================================================

DO $$
BEGIN
    DROP POLICY IF EXISTS service_role_all_payment_devices ON public.payment_devices;
    DROP POLICY IF EXISTS service_role_all_payment_sessions ON public.payment_sessions;
    DROP POLICY IF EXISTS service_role_all_payment_bridge_events ON public.payment_bridge_events;
    DROP POLICY IF EXISTS service_role_all_payment_review_items ON public.payment_review_items;

    CREATE POLICY service_role_all_payment_devices
        ON public.payment_devices
        FOR ALL TO service_role
        USING (true) WITH CHECK (true);

    CREATE POLICY service_role_all_payment_sessions
        ON public.payment_sessions
        FOR ALL TO service_role
        USING (true) WITH CHECK (true);

    CREATE POLICY service_role_all_payment_bridge_events
        ON public.payment_bridge_events
        FOR ALL TO service_role
        USING (true) WITH CHECK (true);

    CREATE POLICY service_role_all_payment_review_items
        ON public.payment_review_items
        FOR ALL TO service_role
        USING (true) WITH CHECK (true);
END $$;

REVOKE ALL ON TABLE public.payment_devices FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_bridge_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_review_items FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.reserve_payment_device(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_payment_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_payment_device(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_payment_sessions() TO service_role;
