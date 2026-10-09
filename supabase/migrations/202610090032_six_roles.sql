-- =====================================================================
-- Six portal roles only (owner, 9 Oct 2026):
--   Registration, Cashier, Accounting, Releasing Officer,
--   MISMO Compliance Officer, Admin.
-- Super Admin, Scheduler (training_operations), HR and Instructor are
-- retired. Super Admin holders become Admin; the other retired roles are
-- taken off accounts (each removal is audited). The role rows stay,
-- inactive, for history. Additive and idempotent.
-- =====================================================================

begin;

-- 1. Super Admin holders keep full access as Admin.
insert into public.user_roles(user_id, role_id)
select ur.user_id, ar.id
from public.user_roles ur
  join public.roles sr on sr.id = ur.role_id and sr.code = 'super_admin'
  cross join public.roles ar
where ar.code = 'admin'
on conflict (user_id, role_id) do nothing;

-- 2. Audit, then remove, every assignment of a retired role.
insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, reason)
select null, 'system', 'role.retired', 'user_role', ur.user_id::text,
       jsonb_build_object('role', r.code), 'Roles reduced to six (owner, 9 Oct 2026)'
from public.user_roles ur
  join public.roles r on r.id = ur.role_id
where r.code in ('super_admin', 'training_operations', 'hr', 'instructor');

delete from public.user_roles ur
using public.roles r
where r.id = ur.role_id and r.code in ('super_admin', 'training_operations', 'hr', 'instructor');

-- 3. Retire the four roles (kept for history; has_any_role ignores inactive roles).
update public.roles set active = false
where code in ('super_admin', 'training_operations', 'hr', 'instructor');

-- 4. Display names.
update public.roles set name = 'Registration' where code = 'registration';
update public.roles set name = 'Cashier' where code = 'cashier';
update public.roles set name = 'Accounting' where code = 'accounting';
update public.roles set name = 'Releasing Officer' where code = 'releasing_officer';
update public.roles set name = 'MISMO Compliance Officer' where code = 'mismo_officer';
update public.roles set name = 'Admin' where code = 'admin';

commit;
