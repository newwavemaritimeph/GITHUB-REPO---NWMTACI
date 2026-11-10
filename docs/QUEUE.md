# New Wave Queue: Setup (Phase 1)

The walk-in queue runs from this same project and deployment. On `queue.newwavemaritimemtaci.com` the fixed paths are:

| Path | What it is |
|---|---|
| `/join` (and `/`) | Trainee form: name, mobile, service, consent |
| `/t/{token}` | Trainee's live ticket |
| `/display` | Office monitor |
| `/staff` | Staff console (ITMS sign-in) |

The same pages also open on the main site under `/queue/join`, `/queue/display` and `/queue/staff`, which is handy for testing.

## One-time setup (owner)

1. **Database:** in the Supabase SQL Editor, run `supabase/migrations/202610290093_queue.sql`, then `202610290094_queue_windows.sql`.
2. **Domain:** in Vercel, open this project, go to Settings › Domains, and add `queue.newwavemaritimemtaci.com`.
3. **DNS:** the domain's DNS is in Vercel, so adding the domain in step 2 usually sets it up on its own. If Vercel asks for a record, add Name `queue`, Type `CNAME`, Value `cname.vercel-dns.com`.
4. **Sign-in:** in Supabase, go to Authentication › URL Configuration › Redirect URLs, and add `https://queue.newwavemaritimemtaci.com/**`.
5. **Optional:** in Vercel, add the environment variable `IP_HASH_SALT` (any long random text). It is used to hash trainee IPs, and it is server-only.
6. **Realtime:** Supabase Realtime must be on (it is by default). The pages also refresh every 10 to 15 seconds, so they still update if a live message is missed.

## Office monitor (any Windows PC or mini PC with Chrome, connected to the TV by HDMI)

- **Kiosk shortcut** (sound works without the morning click):
  `chrome.exe --kiosk --autoplay-policy=no-user-gesture-required https://queue.newwavemaritimemtaci.com/display`
- Without the shortcut, press **Start Display** each morning. That unlocks sound and keeps the screen awake.
- Turn off Windows sleep and the screen saver, and set Chrome to start with Windows.
- Use a wired connection if you can. If the internet drops, the screen shows "Offline, reconnecting…" and catches up when the connection is back.

## Staff

- Sign in at `https://queue.newwavemaritimemtaci.com/staff` with your ITMS account.
- Pick your window:
  - Registration uses Window 1 or Window 2. Both share one line: Enrollment, Inquiry and Certificate Release.
  - The Cashier uses Window 3 (Payment).
  - The Admin can use any window.
- On the monitor, **Voice Settings** sets the voice, the speed and an optional Tagalog line for that monitor. Use **Test Voice** to hear it.
- Buttons: **Call Next** (N), **Recall** (R), **Done** (D) and **No-Show**.

## Coming in Phase 2

- Rotating screen QR
- Display PIN registration
- Transfer, re-queue and manual walk-in
- Admin settings (services, windows, hours, voice)
- The queue section in the owner's daily email
- The 30-day deletion of names and mobiles
