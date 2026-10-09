-- Staff role assignments (owner, 9 Oct 2026). Run AFTER migration
-- 202610090032_six_roles.sql. Sets each account's roles (up to two) by
-- email; an email with no portal account yet is listed as "not found"
-- (create it first in Admin › Configuration › Employee Accounts).
-- Passwords are never set here.

begin;

create temporary table wanted(email text, role_code text) on commit drop;
insert into wanted values
  ('newwavemaritimeber@gmail.com', 'releasing_officer'),
  ('newwavemaritimeber@gmail.com', 'mismo_officer'),
  ('accounting.newwavemtaci@gmail.com', 'cashier'),
  ('kgaret13@gmail.com', 'cashier'),
  ('kgaret13@gmail.com', 'accounting'),
  ('pkmesguerra.ph@gmail.com', 'admin');

-- Replace the roles of the accounts that exist.
delete from public.user_roles ur
using auth.users u
where u.id = ur.user_id
  and lower(u.email) in (select distinct lower(email) from wanted);

insert into public.user_roles(user_id, role_id)
select u.id, r.id
from wanted w
  join auth.users u on lower(u.email) = lower(w.email)
  join public.roles r on r.code = w.role_code and r.active
on conflict (user_id, role_id) do nothing;

insert into public.audit_logs(actor_role, action, record_type, record_id, new_values, reason)
select 'system', 'role.assigned', 'user_role', u.id::text,
       jsonb_build_object('email', u.email, 'roles', array_agg(w.role_code order by w.role_code)),
       'Staff roles set by owner, 9 Oct 2026'
from wanted w join auth.users u on lower(u.email) = lower(w.email)
group by u.id, u.email;

-- Result: who got which roles, and which emails have no account yet.
select w.email,
       case when u.id is null then 'not found — create the account first'
            else string_agg(w.role_code, ' + ' order by w.role_code) end as roles
from wanted w left join auth.users u on lower(u.email) = lower(w.email)
group by w.email, u.id
order by w.email;

commit;
