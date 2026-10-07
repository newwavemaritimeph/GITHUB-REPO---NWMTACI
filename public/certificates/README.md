# MARINA Certificates of Course Approval

Source: the five files supplied in the `new-wave-claude-skill` assets folder.
Those originals are **not served** by the site; they stay in that folder,
unmodified, as the record copies.

| Full-size (served) | Thumbnail | Certificate | Course |
|------|------|-------------|--------|
| `full/acc-2026-034.png` | `acc-2026-034.webp` | ACC 2026-034 | Security Awareness Training and Seafarers with Designated Security Duties |
| `full/acc-2026-035.png` | `acc-2026-035.webp` | ACC 2026-035 | Ship Security Officers |
| `full/acc-2026-036.png` | `acc-2026-036.webp` | ACC 2026-036 | Safety Training for Personnel Providing Direct Service to Passengers in Passengers Spaces |
| `full/acc-2026-037.png` | `acc-2026-037.webp` | ACC 2026-037 | Passenger Ship Crowd Management Training |
| `full/acc-2026-038.png` | `acc-2026-038.webp` | ACC 2026-038 | Passenger Ship Crisis Management and Human Behaviour Training |

All five were issued 12 May 2026 and expire 12 May 2036. Each states
"not valid without MARINA seal"; the site does not claim independent
verification.

## What is blurred, and why

On every served copy the lower-left block — reference number, date,
**the amount paid to MARINA**, and the stamp-tax line — is blurred. The owner
asked for this on 7 October 2026 because the fee is commercial information
that does not belong on a public page. The block is blurred rather than
painted over so the embossed MARINA seal behind it remains visible.

Nothing else is altered: certificate number, course title, grant text, issue
and expiry dates, signature, QR code and seals are as issued.

## Regenerating

The published files are derived from the skill originals by a small `sharp`
script (blur region ≈ x 7–37 %, y 83–89 % of the page). Re-run it against the
originals if a certificate is reissued; never edit the served copies by hand.
