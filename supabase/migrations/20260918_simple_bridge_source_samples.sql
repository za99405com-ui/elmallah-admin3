alter table if exists public.payment_device_sources
  add column if not exists app_name text,
  add column if not exists sample_sender_title text,
  add column if not exists sample_message text;

comment on column public.payment_device_sources.app_name is
  'Merchant-selected Android app label used for this payment source on this device.';
comment on column public.payment_device_sources.sample_sender_title is
  'Notification/SMS sender title captured from the merchant sample message.';
comment on column public.payment_device_sources.sample_message is
  'Full merchant-approved incoming payment message sample used to configure parsing.';
