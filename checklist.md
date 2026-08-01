# Checklist

- [x] Confirm whether the app code or remote data still emits the wrong Michigan date.
- [x] Align data automation Michigan release rule with the app rule.
- [x] Attempt to regenerate US calendar data locally.
- [x] Verify July 2026 Michigan preliminary date is no longer July 10 in the corrected rule.
- [x] Run relevant checks.
- [ ] Commit and push the data correction.

## 2026-08-01 — ADP 발표일 규칙 수정

- [x] 사용자 forexfactory 확인으로 2026-10 ADP = 09-30 확정.
- [x] `sync-us-data.mjs` ADP 규칙을 NFP 역산으로 변경 (1번째 수요일 상한 유지).
- [x] `korea-econ-cal/src/App.jsx` fallback + `scripts/verify-us-schedule.mjs` 동일 규칙 반영.
- [x] 로컬 재생성으로 fed.ics diff 확인 (ADP 2건만 이동, 다른 이벤트 무변화).
- [x] 앱 lint/build 통과.
- [x] 양쪽 repo 커밋.
