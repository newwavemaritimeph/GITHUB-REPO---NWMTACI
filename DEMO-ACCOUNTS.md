# Demo staff accounts — quick setup

Create login accounts for a demo **without** relying on email (invites/resets need
SMTP, which isn't configured yet). This uses Supabase's "Add user → Auto Confirm",
so no confirmation email is sent — the account is usable immediately.

Passwords are set by **you** in the Supabase dashboard, never by the app or in this
repo. Use throwaway passwords for the demo and rotate/delete the accounts afterward.

## Step 1 — create each account (Supabase dashboard)

Supabase → **Authentication → Users → Add user**:

1. Enter an **email** and a **password** (see the table below).
2. Turn **Auto Confirm User = ON** (important — skips the verification email).
3. **Create user.** Repeat for each role you want to demo.

Any email format works with Auto Confirm since nothing is actually sent — these are
demo addresses, not real inboxes. Change them to whatever you like.

| Role                | Suggested demo email            | Password (you set) |
|---------------------|---------------------------------|--------------------|
| Admin               | *(already exists)*              | —                  |
| Accounting          | *(already exists)*              | —                  |
| Cashier             | `cashier.demo@newwave.test`     | _______            |
| Registration        | `registration.demo@newwave.test`| _______            |
| HR                  | `hr.demo@newwave.test`          | _______            |
| Training Operations | `training.demo@newwave.test`    | _______            |

## Step 2 — give each account its role (in the portal)

Sign in as **Admin** → **Settings → users → Existing accounts**. Each new account
appears in the list; use the role dropdown → **Update** to set it to Cashier,
Registration, HR, Training Operations, etc.

Until a role is assigned, a new account can sign in but sees only the default view.

## Step 3 — (optional) link to an employee

For HR/attendance/payroll to attribute the person, add them in
**HR & payroll → Directory → + Add employee** and match the name. The portal invite
flow links employee↔account automatically; for dashboard-created accounts this link
is optional and only matters for HR features.

## Cleanup after the demo

Delete demo accounts in **Supabase → Authentication → Users** (removes the login).
Their role rows in `user_roles` go away with the user.

---

For real (non-demo) onboarding, use **Admin → Settings → Invite employee account**,
which emails an invite so the person sets their own password — that path needs SMTP
configured (see the Auth email & SMTP section in `DEPLOYMENT.md`).
