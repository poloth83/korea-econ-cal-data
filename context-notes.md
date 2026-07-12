# Context Notes

- 2026-07-12. User reported App Store version 1.0.2 still shows the July Michigan preliminary consumer sentiment release on 2026-07-10.
- Finding. `korea-econ-cal/src/App.jsx` already uses the corrected Michigan rule based on final release date as the last Friday of the month, with preliminary release 14 days earlier.
- Finding. `korea-econ-cal-data/scripts/sync-us-data.mjs` still used the old second-Friday/fourth-Friday rule, so generated `data/fed.ics` and `data/calendar.ics` still contained `umich_prelim_2026-07-10`.
- Decision. Fix the data automation rule first because app remote sync/archive can override the app-side generated fallback with stale remote ICS.
- Change. `scripts/sync-us-data.mjs` now uses the month’s last Friday as the Michigan final release date and preliminary release as 14 days before final, matching the app-side rule.
- Verification. A local Node check confirms July 2026 Michigan dates become preliminary `2026-07-17` and final `2026-07-31`.
- Local limitation. `npm run sync:us` could not update `data/fed.ics` locally because `FRED_API_KEY` is missing, so the script set `skippedWrite: true`. The GitHub Actions workflow should regenerate the remote ICS after this script change because it has the `FRED_API_KEY` secret.
