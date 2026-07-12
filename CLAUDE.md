# korea-econ-cal-data — 데이터 생성기

이 repo는 korea-econ-cal 앱이 소비하는 ICS 캘린더 데이터를 생성한다. GitHub Actions(`sync-{us,kr}-data.yml`)가 매일 06:20 KST에 `scripts/sync-*-data.mjs`를 돌려 `data/*.ics`를 재생성·커밋한다.

- **규칙 수정** — 해당 `sync-*-data.mjs` 편집 → `node scripts/sync-kr-data.mjs --dry-run` 검증 → commit/push → 필요시 `gh workflow run sync-kr-data.yml`.
- **알려진 정상 케이스** — fed.ics는 KST 저장(10:00 ET 겨울 이벤트가 날짜 +1로 보이며 UID의 날짜가 실제 ET 발표일), BOK 차년도 미발표 시 `skippedYears`로 스킵.

전체 운영 맥락(메모리·예약 루틴·iOS 릴리스 정책)은 짝 repo의 정문 문서 참조: `~/Desktop/Claude_workspace/korea-econ-cal/CLAUDE.md`.
