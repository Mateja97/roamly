# Plan — replace the interim GetYourGuide mark

**Status:** interim asset shipped, official asset outstanding.
**Owner:** whoever holds the GetYourGuide partner account.
**Created:** 2026-08-06.

## Partner ID — where it lives

`EXPO_PUBLIC_GYG_PARTNER_ID` is set in `app/.env`, which is gitignored
(`app/.gitignore:34`). **It is deliberately not committed:** this repo is
public, and a harvested affiliate ID appended to someone else's spam links can
get the partner account flagged for low-quality traffic. `docker-compose.yaml`
and `app/Dockerfile` pin the variable with an empty default; real builds pass it
from the shell env or a CI secret.

The value itself is in the partner portal under **Tools → Links** — build any
link and read its `partner_id=` parameter. Without it, `toursPartner.ts`'s
`hasPartnerId()` omits the tours ticket entirely, by design. If the ticket ever
"disappears", check this variable first.

## What shipped, and why it's interim

`app/assets/getyourguide-logo.svg` and `app/src/components/GetYourGuideLogo.tsx`
render GetYourGuide's mark on the tours ticket's issuer seal. The file came from
Wikimedia Commons (`GetYourGuide_logo.svg`), tagged `{{PD-textlogo}}` — below the
threshold of originality, so public domain for **copyright**. The Commons page
carries its own trademark notice.

Copyright was never the binding constraint. Trademark use rests on **Partner TCs
§4.3.1**, which licenses partners to display each other's Brand Elements subject
to four conditions — of which **§4.3.1(iv), "removes, distorts, or alters any
element", is the one at risk.** The Commons file lists "Unknown author" and a
single 2025 upload by a third party who extracted it from getyourguide.com. It
cannot be verified as GetYourGuide's current, unaltered mark. It may be a
community re-trace, or a superseded version.

This was accepted knowingly. **§4.3.2** cures a breach by correcting it at the
partner's expense on request, so the realistic downside is a file swap, not
liability. The same reasoning already governs `TripadvisorLogo.tsx`, which is
also Commons-sourced.

## The ask (partner portal → contact form)

1. Wordmark as **SVG**, plus 2×/3× PNG fallbacks.
2. Whether a **light plate** behind the mark is required, permitted, or
   discouraged. The ticket currently uses a white seal — their orange `#F53` has
   no contrast against wine `#7D2027`, so some light backing is unavoidable.
3. **Minimum size and clear-space** rules. Confirm 32px tall clears their floor
   (see "The sizing problem" below).
4. Whether a **horizontal** lockup exists. It would suit the seal far better than
   the stacked one.
5. Approved **attribution wording** — "Tours and booking by GetYourGuide" vs.
   their own phrasing.
6. Whether the **commission disclosure** has required wording in their programme.

Items 3 and 4 are the ones that could change the design, not just the file.

## The sizing problem

The Commons mark is a **three-line stacked lockup**, viewBox `382 × 302` (~1.26:1).
`DESIGN_STANDARDS.md`'s partner-logo floor of ≥20px tall was written for
Tripadvisor's ~4.7:1 horizontal mark; applied here it puts each line's cap height
under 5px. Displaying a partner's mark too small to read is its own kind of
distortion.

Hence the seal: **48px circle, 32px mark**. If the ask returns a horizontal
lockup, revisit — a pill straddling the perforation at 20px would be lighter and
closer to the Tripadvisor precedent.

## Swap procedure

1. Drop the official file at `app/assets/getyourguide-logo.svg`.
2. Mirror its `<svg>` element into `GETYOURGUIDE_LOGO_XML` in
   `app/src/components/GetYourGuideLogo.tsx` (Metro has no
   `react-native-svg-transformer`; the asset file is the source of record, the
   string is what renders).
3. Update `ASPECT_RATIO` from the new viewBox.
4. If the aspect went horizontal, change the seal back to a pill in
   `ToursTicket.tsx` — `SEAL_SIZE`/`SEAL_MARK_HEIGHT` and the `stamp` style.
5. Delete the INTERIM ASSET comment block in `GetYourGuideLogo.tsx`.
6. Delete this plan.

## Do not

- Recolour the mark to cream or gold to fit the palette (§4.3.1 iv).
- Let it become the largest or most prominent logo on any screen (§4.3.1 ii).
- Re-source it from a logo aggregator (logo.dev, Brandfetch) or an app
  screenshot — those are further from the original than Commons, not closer.

## Related

- `pipeline`-independent; this is a standing item, not a task in a run.
- Design: `Roamly Tours Partner.dc.html`, section B.
- The wider partner constraints live in `BUSINESS_STANDARDS.md`'s Tours &
  Experiences note.
