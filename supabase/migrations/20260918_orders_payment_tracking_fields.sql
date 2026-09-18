-- Order payment tracking fields required by Payment Center overview.
-- Applied additively and safe to re-run.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deposit_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_mode TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_payment_mode'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT chk_orders_payment_mode
      CHECK (payment_mode IS NULL OR payment_mode IN ('deposit_online', 'cash_on_delivery'));
  END IF;
END $$;

UPDATE public.orders
   SET payment_mode = CASE
       WHEN deposit_method = 'cash_on_delivery' OR deposit_status = 'not_required'
         THEN 'cash_on_delivery'
       ELSE 'deposit_online'
     END
 WHERE payment_mode IS NULL;

UPDATE public.orders
   SET deposit_paid = deposit_amount
 WHERE deposit_status = 'confirmed'
   AND COALESCE(deposit_paid, 0) = 0;

CREATE OR REPLACE FUNCTION public.sync_order_payment_tracking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_mode IS NULL THEN
    NEW.payment_mode := CASE
      WHEN NEW.deposit_method = 'cash_on_delivery' OR NEW.deposit_status = 'not_required'
        THEN 'cash_on_delivery'
      ELSE 'deposit_online'
    END;
  END IF;

  IF NEW.deposit_status = 'confirmed' THEN
    NEW.deposit_paid := GREATEST(
      COALESCE(NEW.deposit_paid, 0),
      COALESCE(NEW.deposit_amount, 0)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_payment_tracking ON public.orders;
CREATE TRIGGER trg_sync_order_payment_tracking
BEFORE INSERT OR UPDATE OF
  deposit_status,
  deposit_method,
  deposit_amount,
  payment_mode,
  deposit_paid
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_payment_tracking();
