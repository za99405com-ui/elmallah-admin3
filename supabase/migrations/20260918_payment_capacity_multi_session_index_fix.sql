-- Legacy Phase 2 enforced one waiting session per payment device.
-- Device capacity is now controlled by payment_devices.max_concurrent_sessions
-- and reserve_payment_device(), so the old unique index must be removed.

DROP INDEX IF EXISTS public.idx_payment_sessions_one_waiting_per_device;

-- Keep a non-unique lookup index for active-session capacity counts.
CREATE INDEX IF NOT EXISTS idx_payment_sessions_device_waiting
  ON public.payment_sessions (device_id, status, expires_at)
  WHERE status = 'waiting';
