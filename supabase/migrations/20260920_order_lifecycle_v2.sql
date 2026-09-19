-- Order Lifecycle v2
-- One canonical fulfillment flow + independent payment/deposit state.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_orders_status_v2'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT chk_orders_status_v2
      CHECK (status IN ('pending','preparing','delivering','completed','cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_orders_deposit_status_v2'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT chk_orders_deposit_status_v2
      CHECK (deposit_status IN ('confirmed','pending','not_required','rejected'));
  END IF;
END $$;

-- A customer order may have historical sessions, but only one live waiting session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_sessions_one_waiting_per_order
  ON public.payment_sessions(order_id)
  WHERE status = 'waiting';

CREATE OR REPLACE FUNCTION public.transition_order_lifecycle(
  p_order_id TEXT,
  p_new_status TEXT
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_current TEXT;
  v_payment_satisfied BOOLEAN;
BEGIN
  SELECT *
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  v_current := v_order.status;
  v_payment_satisfied :=
    v_order.payment_mode = 'cash_on_delivery'
    OR v_order.deposit_status IN ('confirmed', 'not_required');

  IF p_new_status NOT IN ('pending','preparing','delivering','completed','cancelled') THEN
    RAISE EXCEPTION 'INVALID_ORDER_STATUS';
  END IF;

  IF p_new_status = v_current THEN
    RETURN v_order;
  END IF;

  IF v_current = 'pending' AND p_new_status NOT IN ('preparing','cancelled') THEN
    RAISE EXCEPTION 'INVALID_ORDER_TRANSITION';
  ELSIF v_current = 'preparing' AND p_new_status NOT IN ('delivering','cancelled') THEN
    RAISE EXCEPTION 'INVALID_ORDER_TRANSITION';
  ELSIF v_current = 'delivering' AND p_new_status <> 'completed' THEN
    RAISE EXCEPTION 'INVALID_ORDER_TRANSITION';
  ELSIF v_current IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'TERMINAL_ORDER';
  END IF;

  IF p_new_status = 'preparing' AND NOT v_payment_satisfied THEN
    RAISE EXCEPTION 'PAYMENT_NOT_CONFIRMED';
  END IF;

  UPDATE public.orders
     SET status = p_new_status,
         updated_at = now()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  IF p_new_status = 'cancelled' THEN
    -- Release any device occupied by a still-waiting payment session.
    UPDATE public.payment_devices d
       SET is_busy = false,
           busy_session_id = NULL,
           updated_at = now()
     WHERE d.busy_session_id IN (
       SELECT s.id
         FROM public.payment_sessions s
        WHERE s.order_id = p_order_id
          AND s.status = 'waiting'
     );

    UPDATE public.payment_sessions
       SET status = 'cancelled',
           cancelled_at = COALESCE(cancelled_at, now()),
           cancellation_reason = COALESCE(cancellation_reason, 'order_cancelled'),
           updated_at = now()
     WHERE order_id = p_order_id
       AND status = 'waiting';
  END IF;

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order_lifecycle(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_order_lifecycle(TEXT, TEXT) TO service_role;
