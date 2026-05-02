# korea-econ-cal-data

[한국 경제지표 캘린더](https://github.com/poloth83/korea-econ-cal) iOS 앱이 사용하는 **공용 ICS 데이터 저장소**.

이 저장소에 올라온 .ics 파일은 모든 앱 사용자에게 자동 배포됩니다. (jsDelivr CDN 통해 1~10분 내 반영)

## 디렉토리 구조

```
data/
├── manifest.json   ← 어떤 기관 ICS가 있는지 + 갱신일시
├── bok.ics         ← 한국은행 (선택)
└── moef.ics        ← 기획재정부 (선택)
```

## ICS 파일 갱신 워크플로

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

지원되는 `agencyKey`: `bok` (한국은행), `moef` (기획재정부)

## 라이선스

데이터는 각 발행 기관의 공개 자료. 이 저장소 자체는 비공개 운영 정책 (관리자 변경은 owner만).
