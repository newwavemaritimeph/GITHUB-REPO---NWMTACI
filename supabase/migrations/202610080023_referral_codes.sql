-- Referral codes (owner, 8 Oct 2026). Each agency or consultancy has a secret
-- code; a trainee who registers with it is tagged as that agency's referral,
-- and the agency's rebate is deducted from what the trainee pays.
-- Additive; safe to re-run.

alter table public.marketing_agencies add column if not exists referral_code text;
create unique index if not exists marketing_agencies_referral_code_key on public.marketing_agencies (upper(referral_code)) where referral_code is not null;

-- The agency that referred this enrollment (set from the registration form).
alter table public.enrollments add column if not exists referral_agency_id uuid references public.marketing_agencies(id);

-- How a rebate was settled, e.g. "Deducted from the trainee's payment".
alter table public.agency_rebates add column if not exists settlement text;

-- Every agency gets a code automatically: up to five letters of its name plus six digits.
do $$
declare a record; candidate text;
begin
  for a in select id, name from public.marketing_agencies where referral_code is null loop
    loop
      candidate := coalesce(nullif(left(regexp_replace(upper(a.name), '[^A-Z]', '', 'g'), 5), ''), 'NW') || lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from public.marketing_agencies where upper(referral_code) = candidate);
    end loop;
    update public.marketing_agencies set referral_code = candidate where id = a.id;
  end loop;
end $$;
