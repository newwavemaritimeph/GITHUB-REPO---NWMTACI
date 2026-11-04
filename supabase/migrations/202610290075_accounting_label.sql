-- "Accounting Manager" reads "Accounting" (owner, 4 Nov 2026). Only messages change; safe to re-run.
do $$
declare f record; body text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%Accounting Manager%'
  loop
    body := pg_get_functiondef(f.oid);
    body := replace(replace(body, 'the Accounting Manager', 'Accounting'), 'Accounting Manager', 'Accounting');
    execute body;
  end loop;
end $$;

select count(*) = 0 as label_updated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%Accounting Manager%';
