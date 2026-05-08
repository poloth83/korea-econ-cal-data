# korea-econ-cal-data

[한국 경제지표 캘린더](https://github.com/poloth83/korea-econ-cal) iOS 앱이 사용하는 **공용 ICS 데이터 저장소**.

이 저장소에 올라온 .ics 파일은 모든 앱 사용자에게 자동 배포됩니다. (jsDelivr CDN 통해 1~10분 내 반영)

## 디렉토리 구조

```
data/
├── manifest.json   ← 어떤 기관 ICS가 있는지 + 갱신일시
├── bok.ics         ← 자동 생성 한국은행 통계공표일정
├── moef.ics        ← 자동 생성 기획재정부 국고채 발행일정
├── kostat.ics      ← 자동 생성 통계청/국가데이터처 경제 보도계획
├── ust.ics         ← 미국 재무부 입찰 일정
├── fed.ics         ← 자동 생성 미국 경제지표 (FRED + FOMC + 정기 패턴)
└── fed_speech.ics  ← 자동 생성 Fed 연설/증언 일정
```

## 자동화

`.github/workflows/sync-kr-data.yml`가 매일 06:05 KST에 실행됩니다.

- `scripts/sync-kr-data.mjs`: `bok.ics`, `moef.ics`, `kostat.ics`, `manifest.json` 자동 갱신
- 한국은행은 통계공표일정 연도별 표를 조회해 과거 13개월 + 미래 180일 범위를 생성합니다
- 기획재정부는 국채시장 월간 발행일정을 월별 조회해 생성합니다
- 통계청/국가데이터처는 보도계획 중 시장 관련 경제지표성 항목만 필터링합니다
- 특정 기관 수집이 실패하면 기존 발행 ICS를 유지하고 `status.json`에 경고를 남깁니다

`.github/workflows/sync-us-data.yml`가 매일 06:20 KST에 실행됩니다.

- `scripts/sync-us-data.mjs`: `fed.ics`, `fed_speech.ics`, `manifest.json` 자동 갱신
- `scripts/verify-forexfactory.mjs`: Forex Factory/Fair Economy 주간 XML의 USD high-impact 일정과 `fed.ics` 교차검증
- 검증 불일치가 있으면 자동 commit을 막고 GitHub Actions artifact에 리포트를 남깁니다
- `FRED_API_KEY`는 GitHub repo secret으로 설정해야 FRED 기반 지표가 완전하게 생성됩니다

로컬 dry-run:

```bash
npm run sync:kr:dry
npm run sync:us:dry
npm run verify:forexfactory:dry
```

## 수동 ICS 파일 갱신 워크플로

자동화가 실패했을 때만 수동으로 사용합니다.

### 1. 새 ICS 다운로드

- **한국은행**: https://www.bok.or.kr/portal/stats/statsPublictSchdul/listKnd.do?menuNo=200776 → 우측 상단 캘린더 다운로드
- **기획재정부**: https://ktb.moef.go.kr/mnbyIsuCldr.do → ICS 다운로드

### 2. 파일 교체 + manifest 갱신

```bash
cd korea-econ-cal-data
# 다운로드한 파일 덮어쓰기
cp ~/Downloads/bok.ics data/bok.ics

# manifest.json의 해당 기관 uploadedAt을 현재 시각 ISO로 수정
# (또는 아래 한 줄 명령)
node -e "let m=require('./data/manifest.json'); m.agencies.bok={filename:'bok.ics',uploadedAt:new Date().toISOString()}; m.updatedAt=new Date().toISOString(); require('fs').writeFileSync('./data/manifest.json', JSON.stringify(m,null,2));"

# 커밋 + push
git add data/
git commit -m "Update BOK schedule"
git push
```

### 3. 반영 대기

jsDelivr는 GitHub의 main 브랜치 변경을 1~10분 내 캐싱. 그 후 모든 앱 사용자가 다음 실행 시 자동 동기화.

## manifest.json 스키마

```json
{
  "version": 1,
  "updatedAt": "2026-05-03T11:00:00.000Z",
  "agencies": {
    "bok":  { "filename": "bok.ics",  "uploadedAt": "2026-05-03T10:00:00.000Z" },
    "moef": { "filename": "moef.ics", "uploadedAt": "2026-05-01T09:30:00.000Z" }
  }
}
```

지원되는 `agencyKey`: `bok` (한국은행), `moef` (기획재정부), `kostat` (통계청/국가데이터처), `ust`, `fed`, `fed_speech`

## 라이선스

데이터는 각 발행 기관의 공개 자료. 이 저장소 자체는 비공개 운영 정책 (관리자 변경은 owner만).
