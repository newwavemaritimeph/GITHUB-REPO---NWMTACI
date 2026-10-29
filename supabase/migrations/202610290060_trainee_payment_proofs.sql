-- Trainee-uploaded proof of payment (owner, 29 Oct 2026): sent from the website after
-- registration or from Trainee Status, filed in Google Drive only, and listed for the
-- Cashier until a payment (receipt) uses it or the Cashier marks it Not Valid.
begin;

alter table public.payment_proofs add column if not exists trainee_id uuid references public.trainees(id);
alter table public.payment_proofs add column if not exists source text not null default 'Cashier';
alter table public.payment_proofs add column if not exists claimed_method text;
alter table public.payment_proofs add column if not exists claimed_amount_centavos bigint check (claimed_amount_centavos is null or claimed_amount_centavos > 0);
alter table public.payment_proofs add column if not exists submitted_at timestamptz;
alter table public.payment_proofs add column if not exists dismissed_at timestamptz;
alter table public.payment_proofs add column if not exists dismissed_by uuid references public.profiles(id);
alter table public.payment_proofs add column if not exists dismiss_reason text;
do $$ begin
  alter table public.payment_proofs add constraint payment_proofs_source_check check (source in ('Cashier','Trainee'));
exception when duplicate_object then null; end $$;
create index if not exists payment_proofs_trainee_idx on public.payment_proofs(source, trainee_id);
create index if not exists payments_proof_idx on public.payments(proof_id) where proof_id is not null;

-- Where trainees send their payment, shown on the website upload box.
alter table public.payment_methods add column if not exists account_details text;

notify pgrst, 'reload schema';
commit;
