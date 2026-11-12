-- Consultancy group payments (owner, 12 Nov 2026): a consultancy pays several trainees with one transfer and one
-- reference number. Recorded once in Record Payment › Paid By: Consultancy; each trainee still gets their own payment,
-- Acknowledgement Receipt and TAR. Payments in the same group are not flagged "Duplicate Review" against each other.
-- Accounting or the Admin can clear an older false "Duplicate Review" flag; the amount never changes and it is audited.

create table if not exists public.payment_groups (
  id uuid primary key default gen_random_uuid(),
  group_no text not null unique,
  agency_id uuid references public.marketing_agencies(id),
  reference_number text not null,
  method text not null,
  receiving_account text not null,
  total_centavos bigint not null check (total_centavos > 0),
  received_at timestamptz not null,
  proof_id uuid references public.payment_proofs(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.payment_groups enable row level security;
drop policy if exists payment_groups_staff_read on public.payment_groups;
create policy payment_groups_staff_read on public.payment_groups for select to authenticated using (public.has_any_role(array['admin','accounting','cashier']));
create or replace function public.payment_groups_immutable() returns trigger language plpgsql as $$ begin raise exception 'Group payments cannot be changed or deleted; void each payment instead'; end $$;
drop trigger if exists payment_groups_immutable on public.payment_groups;
create trigger payment_groups_immutable before update or delete on public.payment_groups for each row execute function public.payment_groups_immutable();

-- The group a payment was posted in. Set at insert from the transaction setting post_group_payment uses,
-- so post_payment itself does not change its signature and payments stay insert-only.
alter table public.payments add column if not exists group_key uuid default nullif(current_setting('nwm.payment_group', true), '')::uuid;
create index if not exists payments_group_idx on public.payments (group_key) where group_key is not null;

-- post_payment: a payment in the same group is not a duplicate (adds to the sibling rule of 202610290071).
do $$
declare
  def text;
  anchor text := 'and valid and not (trainee_id = target_trainee';
begin
  def := pg_get_functiondef('public.post_payment(uuid,bigint,text,text,text,timestamptz,uuid,jsonb,text)'::regprocedure);
  if position('nwm.payment_group' in def) > 0 then
    raise notice 'Group payments already applied.';
  elsif position(anchor in def) = 0 then
    raise exception 'post_payment changed (apply 202610290071 first); nothing was applied.';
  else
    execute replace(def, anchor, 'and valid and coalesce(group_key::text, '''') <> coalesce(nullif(current_setting(''nwm.payment_group'', true), ''''), ''-'') and not (trainee_id = target_trainee');
  end if;
end $$;

-- One transfer, several trainees, all or nothing: one payment per trainee (their courses share that payment's receipt).
create or replace function public.post_group_payment(
  target_agency uuid, target_method text, target_receiving_account text, target_reference text,
  target_received_at timestamptz, target_proof uuid, target_total bigint, target_lines jsonb, target_remarks text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare gid uuid := gen_random_uuid(); gno text; tr uuid; allocs jsonb; amt bigint; pay public.payments; made jsonb := '[]'::jsonb; total bigint; matched int;
begin
  if not public.has_any_role(array['admin','cashier','accounting']) then raise exception 'Not authorized'; end if;
  if nullif(trim(target_reference), '') is null then raise exception 'Enter the reference number of the transfer'; end if;
  if jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) = 0 then raise exception 'Tick at least one trainee'; end if;
  select coalesce(sum((l->>'amount_centavos')::bigint), 0), count(e.id) into total, matched
    from jsonb_array_elements(target_lines) l left join public.enrollments e on e.id = (l->>'enrollment_id')::uuid;
  if matched <> jsonb_array_length(target_lines) then raise exception 'An enrollment was not found'; end if;
  if total <> target_total then raise exception 'The trainees'' amounts must add up to the transfer'; end if;
  gno := public.next_reference('GRP');
  insert into public.payment_groups(id, group_no, agency_id, reference_number, method, receiving_account, total_centavos, received_at, proof_id, created_by)
    values (gid, gno, target_agency, trim(target_reference), target_method, target_receiving_account, target_total, target_received_at, target_proof, auth.uid());
  perform set_config('nwm.payment_group', gid::text, true);
  for tr in select distinct e.trainee_id from jsonb_array_elements(target_lines) l join public.enrollments e on e.id = (l->>'enrollment_id')::uuid loop
    select jsonb_agg(jsonb_build_object('enrollment_id', e.id, 'amount_centavos', (l->>'amount_centavos')::bigint)), sum((l->>'amount_centavos')::bigint)
      into allocs, amt
      from jsonb_array_elements(target_lines) l join public.enrollments e on e.id = (l->>'enrollment_id')::uuid where e.trainee_id = tr;
    pay := public.post_payment(tr, amt, target_method, target_receiving_account, trim(target_reference), target_received_at, target_proof, allocs, coalesce(nullif(trim(target_remarks), ''), 'Group payment ' || gno));
    made := made || jsonb_build_array(jsonb_build_object('payment_id', pay.id, 'trainee_id', tr, 'amount_centavos', amt, 'verification_state', pay.verification_state));
  end loop;
  perform set_config('nwm.payment_group', '', true);
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
    values (auth.uid(), 'cashier', 'payment.group_posted', 'payment_group', gid::text, jsonb_build_object('group_no', gno, 'reference', trim(target_reference), 'total_centavos', target_total, 'payments', made));
  return jsonb_build_object('group_id', gid, 'group_no', gno, 'payments', made);
end $$;
grant execute on function public.post_group_payment(uuid, text, text, text, timestamptz, uuid, bigint, jsonb, text) to authenticated;

-- Payments stay immutable, with two narrow exceptions: a void (as before), and clearing a false
-- "Duplicate Review" to "Verified" (Accounting or the Admin, from the server, audited). Nothing else may change.
create or replace function public.payments_void_only() returns trigger language plpgsql as $$
declare skip text[] := array['valid','void_reason','voided_by','voided_at'];
begin
  if tg_op = 'UPDATE'
     and old.valid and not new.valid
     and old.voided_at is null and new.voided_at is not null
     and coalesce(length(trim(new.void_reason)), 0) > 0
     and (to_jsonb(new) - skip) = (to_jsonb(old) - skip) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.valid and new.valid
     and old.verification_state = 'Duplicate Review' and new.verification_state = 'Verified'
     and (to_jsonb(new) - 'verification_state') = (to_jsonb(old) - 'verification_state') then
    return new;
  end if;
  raise exception 'Immutable records cannot be changed or deleted';
end $$;

select position('nwm.payment_group' in pg_get_functiondef('public.post_payment(uuid,bigint,text,text,text,timestamptz,uuid,jsonb,text)'::regprocedure)) > 0 as group_payments_applied;
