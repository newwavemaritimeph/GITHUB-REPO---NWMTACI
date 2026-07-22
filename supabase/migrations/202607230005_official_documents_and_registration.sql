begin;

alter table public.trainees add column if not exists suffix text;
alter table public.trainees add column if not exists place_of_birth text;
alter table public.trainees add column if not exists rank text;
alter table public.trainees add column if not exists company text;
alter table public.trainees add column if not exists registration_reference text unique;
alter table public.trainees add column if not exists terms_version text;
alter table public.trainees add column if not exists terms_accepted_at timestamptz;
alter table public.trainees add column if not exists terms_acceptance_ip_hash text;

create table if not exists public.marketing_agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  email text,
  mobile text,
  commission_configuration jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.trainees add column if not exists marketing_agency_id uuid references public.marketing_agencies(id);

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  requires_reference boolean not null default false,
  allows_proof boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.payment_methods(code,name,requires_reference,sort_order) values
('cash','Cash',false,10),('gcash','GCash',true,20),('bank_transfer','Bank transfer',true,30),
('check','Check',true,40),('card','Card',true,50),('other','Other',false,60)
on conflict(code) do nothing;

create table if not exists public.terms_documents (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  public_asset_path text not null,
  effective_from date not null,
  active boolean not null default false,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
insert into public.terms_documents(version,title,public_asset_path,effective_from,active)
values('2026-07-03-r01','New Wave Maritime Terms and Conditions','/document-templates/terms-and-conditions.png','2026-07-03',true)
on conflict(version) do update set public_asset_path=excluded.public_asset_path,active=true;

alter table public.invoices add column if not exists payment_id uuid unique references public.payments(id);

create or replace function public.create_payment_documents() returns trigger
language plpgsql security definer set search_path=public as $$
declare payment_row public.payments; enrollment_row public.enrollments; trainee_row public.trainees; course_row public.courses; revision_number integer; total_paid bigint; balance bigint; receipt_snapshot jsonb; invoice_snapshot jsonb;
begin
  if exists(select 1 from public.receipts where payment_id=new.payment_id) then return new; end if;
  select * into payment_row from public.payments where id=new.payment_id;
  select * into enrollment_row from public.enrollments where id=new.enrollment_id;
  select * into trainee_row from public.trainees where id=enrollment_row.trainee_id;
  select * into course_row from public.courses where id=enrollment_row.course_id;
  select coalesce(sum(pa.amount_centavos),0) into total_paid from public.payment_allocations pa join public.payments p on p.id=pa.payment_id where pa.enrollment_id=enrollment_row.id and p.valid;
  balance := greatest(0,enrollment_row.selling_price_centavos-total_paid);
  receipt_snapshot := jsonb_build_object(
    'payment_number',payment_row.payment_number,'enrollment_number',enrollment_row.enrollment_number,
    'trainee_number',trainee_row.trainee_number,'trainee_name',concat_ws(' ',trainee_row.legal_first_name,trainee_row.legal_middle_name,trainee_row.legal_last_name,trainee_row.suffix),
    'address',trainee_row.address,'course_code',course_row.code,'course_name',course_row.name,
    'amount_centavos',new.amount_centavos,'method',payment_row.method,'reference_number',payment_row.reference_number,
    'received_at',payment_row.received_at,'total_due_centavos',enrollment_row.selling_price_centavos,
    'total_paid_centavos',total_paid,'balance_centavos',balance,'cashier_id',payment_row.cashier_id
  );
  insert into public.receipts(receipt_number,payment_id,snapshot,issued_by)
  values(public.next_reference('AR'),payment_row.id,receipt_snapshot,payment_row.cashier_id);
  select coalesce(max(revision),0)+1 into revision_number from public.invoices where enrollment_id=enrollment_row.id;
  invoice_snapshot := receipt_snapshot || jsonb_build_object('invoice_revision',revision_number,'document_type','Payment Invoice');
  insert into public.invoices(invoice_number,enrollment_id,payment_id,snapshot,revision,issued_at)
  values(public.next_reference('INV'),enrollment_row.id,payment_row.id,invoice_snapshot,revision_number,payment_row.received_at);
  return new;
end $$;
drop trigger if exists payment_documents_after_allocation on public.payment_allocations;
create trigger payment_documents_after_allocation after insert on public.payment_allocations for each row execute function public.create_payment_documents();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,complete_name,account_state)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'complete_name',new.email),'Invited')
  on conflict(id) do update set email=excluded.email,complete_name=coalesce(public.profiles.complete_name,excluded.complete_name);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users for each row execute function public.handle_new_user();

create or replace function public.submit_public_registration(
  target_first_name text,target_middle_name text,target_last_name text,target_suffix text,target_srn text,target_email text,target_address text,target_mobile text,
  target_place_of_birth text,target_birthdate date,target_rank text,target_company text,target_emergency_name text,target_emergency_mobile text,
  target_batch uuid,target_terms_version text,target_ip_hash text,target_marketing_agency uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare batch_row public.batches; course_row public.courses; trainee_row public.trainees; enrollment_row public.enrollments; registration_ref text;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  if not exists(select 1 from public.terms_documents where version=target_terms_version and active and effective_from<=current_date) then raise exception 'Terms version is not active'; end if;
  if exists(select 1 from public.trainees where lower(email)=lower(trim(target_email)) or mobile=trim(target_mobile) or (nullif(trim(target_srn),'') is not null and srn=trim(target_srn))) then raise exception 'A trainee record with the same email, mobile number, or SRN already exists'; end if;
  select * into batch_row from public.batches where id=target_batch for update;
  if batch_row.id is null or batch_row.status<>'Open' or batch_row.published_at is null or batch_row.enrollment_deadline<=now() or batch_row.starts_on<=current_date or batch_row.confirmed_count>=batch_row.capacity then raise exception 'The selected schedule is no longer available'; end if;
  select * into course_row from public.courses where id=batch_row.course_id and active;
  registration_ref:=public.next_reference('REG');
  insert into public.trainees(trainee_number,registration_reference,legal_first_name,legal_middle_name,legal_last_name,suffix,birthdate,place_of_birth,address,mobile,email,srn,rank,company,emergency_contact,marketing_agency_id,terms_version,terms_accepted_at,terms_acceptance_ip_hash,account_state)
  values(public.next_reference('NWM'),registration_ref,trim(target_first_name),nullif(trim(target_middle_name),''),trim(target_last_name),nullif(trim(target_suffix),''),target_birthdate,trim(target_place_of_birth),trim(target_address),trim(target_mobile),lower(trim(target_email)),nullif(trim(target_srn),''),nullif(trim(target_rank),''),nullif(trim(target_company),''),jsonb_build_object('name',trim(target_emergency_name),'mobile',trim(target_emergency_mobile)),target_marketing_agency,target_terms_version,now(),target_ip_hash,'Pending') returning * into trainee_row;
  insert into public.enrollments(enrollment_number,trainee_id,course_id,batch_id,enrollment_status,source,selling_price_centavos,rebate_centavos,partner_payable_centavos,rate_snapshot)
  values(public.next_reference('ENR'),trainee_row.id,course_row.id,batch_row.id,'Enrolled','Public registration',course_row.standard_price_centavos,0,0,jsonb_build_object('course_code',course_row.code,'course_name',course_row.name,'selling_price_centavos',course_row.standard_price_centavos,'captured_at',now())) returning * into enrollment_row;
  update public.batches set confirmed_count=confirmed_count+1,status=case when confirmed_count+1>=capacity then 'Full' else status end,updated_at=now() where id=batch_row.id;
  insert into public.audit_logs(action,record_type,record_id,new_values,request_ip_hash)
  values('registration.public_submitted','trainee',trainee_row.id::text,jsonb_build_object('registration_reference',registration_ref,'enrollment_id',enrollment_row.id,'terms_version',target_terms_version),target_ip_hash);
  return jsonb_build_object('registration_reference',registration_ref,'trainee_id',trainee_row.id,'enrollment_id',enrollment_row.id,'email',trainee_row.email,'complete_name',concat_ws(' ',trainee_row.legal_first_name,trainee_row.legal_last_name));
end $$;
grant execute on function public.submit_public_registration(text,text,text,text,text,text,text,text,text,date,text,text,text,text,uuid,text,text,uuid) to service_role;

do $$ begin
  if not exists(select 1 from public.employees where complete_name='Karen Mallari') then insert into public.employees(employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,active) values(public.next_reference('EMP'),'Karen Mallari','Cashier','Active',current_date,'Monthly',0,true); end if;
  if not exists(select 1 from public.employees where complete_name='April Cantoneros') then insert into public.employees(employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,active) values(public.next_reference('EMP'),'April Cantoneros','General Manager / Admin','Active',current_date,'Monthly',0,true); end if;
  if not exists(select 1 from public.employees where complete_name='Kathleen Garcia') then insert into public.employees(employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,active) values(public.next_reference('EMP'),'Kathleen Garcia','Accounting Manager','Active',current_date,'Monthly',0,true); end if;
end $$;

insert into public.organization_settings(id,address,mobile,public_email,terms_and_conditions)
values(true,'5F (505) GLC Building, T.M. Kalaw corner A. Mabini, Ermita, Manila 1000','0948 847 6530','newwavemaritime@gmail.com','2026-07-03-r01')
on conflict(id) do update set address=excluded.address,mobile=excluded.mobile,public_email=excluded.public_email,terms_and_conditions=excluded.terms_and_conditions,updated_at=now();

alter table public.marketing_agencies enable row level security;
alter table public.payment_methods enable row level security;
alter table public.terms_documents enable row level security;
create policy marketing_agencies_staff_read on public.marketing_agencies for select to authenticated using(public.has_staff_role());
create policy marketing_agencies_admin_write on public.marketing_agencies for all to authenticated using(public.has_any_role(array['admin'])) with check(public.has_any_role(array['admin']));
create policy payment_methods_staff_read on public.payment_methods for select to authenticated using(public.has_staff_role());
create policy payment_methods_admin_write on public.payment_methods for all to authenticated using(public.has_any_role(array['admin'])) with check(public.has_any_role(array['admin']));
create policy terms_public_read on public.terms_documents for select to anon,authenticated using(active or public.has_any_role(array['admin']));

commit;
