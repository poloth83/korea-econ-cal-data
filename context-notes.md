# Context Notes

- 2026-07-12. User reported App Store version 1.0.2 still shows the July Michigan preliminary consumer sentiment release on 2026-07-10.
- Finding. `korea-econ-cal/src/App.jsx` already uses the corrected Michigan rule based on final release date as the last Friday of the month, with preliminary release 14 days earlier.
- Finding. `korea-econ-cal-data/scripts/sync-us-data.mjs` still used the old second-Friday/fourth-Friday rule, so generated `data/fed.ics` and `data/calendar.ics` still contained `umich_prelim_2026-07-10`.
- Decision. Fix the data automation rule first because app remote sync/archive can override the app-side generated fallback with stale remote ICS.
- Change. `scripts/sync-us-data.mjs` now uses the month’s last Friday as the Michigan final release date and preliminary release as 14 days before final, matching the app-side rule.
- Verification. A local Node check confirms July 2026 Michigan dates become preliminary `2026-07-17` and final `2026-07-31`.
- Local limitation. `npm run sync:us` could not update `data/fed.ics` locally because `FRED_API_KEY` is missing, so the script set `skippedWrite: true`. The GitHub Actions workflow should regenerate the remote ICS after this script change because it has the `FRED_API_KEY` secret.

## 2026-08-01 — ADP 발표일 규칙

- 문제. 월간 검증 루틴이 2026-10 ADP를 10-07로 표시. 기존 규칙은 "매월 1번째 수요일"이었으나, 사용자가 forexfactory에서 실제 09-30임을 확인.
- 원인. ADP는 BLS 고용지표 이틀 전 수요일에 나온다. 보통 그 달 1번째 수요일과 같지만, NFP가 1~2일이면(2026-10-02) ADP가 전월 말 수요일로 앞당겨진다.
- 발견. FRED가 주는 실제 BLS 일정을 보니 NFP 자체도 "첫째 금요일" 추정과 어긋나는 달이 많다 — 2026-01-09, 2026-02-11(수요일), 2026-05-08, 2025-11-20·2025-12-16(셧다운 지연). 즉 ADP를 추정 NFP에서 역산하면 안 되고 **FRED의 실제 NFP 날짜**에서 역산해야 한다.
- 결정. `adpReleaseDate(year, monthIdx, nfpDate)` = `min(NFP 직전 수요일, 그 달 1번째 수요일)`.
  - 1번째 수요일 상한을 둔 이유. 2025년 셧다운으로 BLS가 11-20/12-16까지 밀렸을 때 ADP는 따라가지 않고 11-05/12-03에 그대로 나왔다. 상한이 없으면 그 달들이 틀어진다.
  - 1번째 수요일은 기존대로 연방공휴일 회피(+7)를 유지. 1/1이 수요일인 해(2025-01-01)에 필요하다.
  - `nfpDate`가 없으면(FRED 미수집 월) 1번째 수요일로 폴백 — 기존 동작과 동일.
- 검증. 로컬 FRED 키로 재생성한 fed.ics diff는 ADP 2건만 이동. `adp_nfp_2026-10-07 → 2026-09-30`(사용자 확인 건), `adp_nfp_2025-08-06 → 2025-07-30`(2025-08-01 NFP 대응, 과거분). 셧다운 달 11-05/12-03은 그대로 유지됨.
- 한계. NFP 직전 수요일이 연방공휴일인 경우(7/4가 수요일인 해, 2029년경)는 미처리. 그 달은 월간 검증 루틴이 잡아줄 것.
- 부수 변경. `korea-econ-cal/scripts/verify-us-schedule.mjs`가 NFP를 자체 추정하던 것을 옆 repo `data/fed.ics`의 `UID:fred_50_*`(실제 BLS ET 발표일)를 읽도록 변경. fed.ics가 없으면 추정으로 폴백하고 표에 `*` 표시.
