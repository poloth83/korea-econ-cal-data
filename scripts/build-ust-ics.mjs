#!/usr/bin/env node
// US Treasury Tentative Auction Schedule PDF → ust.ics 변환기
//
// 사용법:
//   1. PDF 텍스트를 stdin으로 받거나 인자 파일로 전달
//   2. 출력은 ust.ics 형식 (UTC 시각 기준, RFC 5545)
//
// 입력 PDF: https://home.treasury.gov/system/files/221/Tentative-Auction-Schedule.pdf
//   - 분기마다 (보통 2/5/8/11월 refunding announcement 시) 갱신됨
//   - Read tool 또는 pdftotext로 텍스트 추출 후 본 스크립트에 넘김
//
// 입찰 시각:
//   - 모든 Bill: 11:30 AM ET
//   - Notes/Bonds/TIPS/FRN: 1:00 PM ET (13:00)
//
// 행 형식 예시:
//   "3-Year NOTE Wednesday, February 04, 2026 Tuesday, February 10, 2026 Tuesday, February 17, 2026"
//   "30-Year TIPS T Thursday, February 12, 2026 Thursday, February 19, 2026 Friday, February 27, 2026"
//   "10-Year NOTE R Thursday, March 05, 2026 Wednesday, March 11, 2026 Monday, March 16, 2026"
//   "10-Year TIPS R T Thursday, March 12, 2026 Thursday, March 19, 2026 Tuesday, March 31, 2026"
// (T = TIPS marker, R = reopening)

import fs from 'node:fs';

const inputPath = process.argv[2];
const text = inputPath ? fs.readFileSync(inputPath, 'utf8') : fs.readFileSync(0, 'utf8');

const MONTHS = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

// "Tuesday, February 10, 2026" → Date object
function parseDateStr(s) {
  const m = s.match(/\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], MONTHS[m[1]], +m[2]));
}

// 미국 동부 DST 판정 (3월 둘째 일요일 ~ 11월 첫째 일요일)
function nthSundayUtc(year, monthIdx, n) {
  const d = new Date(Date.UTC(year, monthIdx, 1));
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + (n - 1) * 7);
  return d;
}
function isDstEt(date) {
  const y = date.getUTCFullYear();
  return date >= nthSundayUtc(y, 2, 2) && date < nthSundayUtc(y, 10, 1);
}

// ET 14:00 또는 11:30 → UTC 시각으로 변환 (DST 자동 적용)
function etTimeToUtcHHMM(date, hh, mm) {
  const offset = isDstEt(date) ? 4 : 5; // EDT(-4) or EST(-5)
  const utcH = hh + offset;
  return { h: utcH, m: mm };
}

function fmtIcsUtc(date, hh, mm) {
  const yy = date.getUTCFullYear();
  const M = String(date.getUTCMonth() + 1).padStart(2, '0');
  const D = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}${M}${D}T${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}00Z`;
}

const SECURITY_TYPES = new Set(['BILL', 'NOTE', 'BOND', 'TIPS', 'FRN']);

// 행 파싱
const rows = [];
const lines = text.split('\n');
for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith('Holiday')) continue;
  if (line.startsWith('Tentative Auction')) continue;
  if (line.startsWith('Security Type')) continue;
  if (line.startsWith('T --')) continue;
  if (line.startsWith('R --')) continue;
  if (line.startsWith('For additional')) continue;
  if (line.startsWith('https://')) continue;

  // 첫 토큰: "13-Week" 또는 "30-Year" 등
  const tokens = line.split(/\s+/);
  if (tokens.length < 4) continue;
  const term = tokens[0];
  if (!/^\d+-(Week|Year|Month)$/.test(term)) continue;
  const type = tokens[1];
  if (!SECURITY_TYPES.has(type)) continue;

  // 다음 토큰들: 'T' 'R' 두 플래그 가능
  let idx = 2;
  let isTips = false, isReopen = false;
  while (idx < tokens.length && (tokens[idx] === 'T' || tokens[idx] === 'R')) {
    if (tokens[idx] === 'T') isTips = true;
    if (tokens[idx] === 'R') isReopen = true;
    idx++;
  }
  if (type === 'TIPS') isTips = true;

  // 나머지: 3개 날짜 (Day, Month DD, YYYY × 3)
  const rest = tokens.slice(idx).join(' ');
  const dates = [...rest.matchAll(/\w+,\s+\w+\s+\d{1,2},\s+\d{4}/g)].map(m => m[0]);
  if (dates.length < 3) continue;

  const announceDate = parseDateStr(dates[0]);
  const auctionDate = parseDateStr(dates[1]);
  const settleDate = parseDateStr(dates[2]);
  if (!announceDate || !auctionDate || !settleDate) continue;

  rows.push({ term, type, isReopen, isTips, announceDate, auctionDate, settleDate });
}

// 한글화
function termKr(term) {
  return term.replace(/-Week/g, '주').replace(/-Year/g, '년').replace(/-Month/g, '개월');
}
function typeKr(type, isTips) {
  if (isTips) return 'TIPS';
  return { BILL: 'T-Bill', NOTE: '노트', BOND: '본드', FRN: 'FRN' }[type] || type;
}
function fmtAnnounce(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ICS 생성
const now = new Date();
const dtStamp = fmtIcsUtc(now, now.getUTCHours(), now.getUTCMinutes());

const icsLines = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Korea Econ Cal//US Treasury Auction Schedule//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:US Treasury Auction Schedule',
  'X-WR-TIMEZONE:UTC',
];

for (const r of rows) {
  const isBill = r.type === 'BILL';
  const etHH = isBill ? 11 : 13;
  const etMM = isBill ? 30 : 0;
  const utc = etTimeToUtcHHMM(r.auctionDate, etHH, etMM);
  const dtStart = fmtIcsUtc(r.auctionDate, utc.h, utc.m);
  // 30분 추가 시 minute overflow 처리
  let endH = utc.h;
  let endM = utc.m + 30;
  if (endM >= 60) { endM -= 60; endH += 1; }
  const dtEnd = fmtIcsUtc(r.auctionDate, endH, endM);

  const reopenSuffix = r.isReopen ? ' (재발행)' : '';
  const summary = `미국 ${termKr(r.term)} ${typeKr(r.type, r.isTips)} 입찰${reopenSuffix}`;
  const desc = `발표 ${fmtAnnounce(r.announceDate)} · 결제 ${fmtAnnounce(r.settleDate)} · ${etHH}:${String(etMM).padStart(2, '0')} ET`;

  const uid = `ust-${r.term.toLowerCase()}-${r.type.toLowerCase()}-${fmtAnnounce(r.auctionDate)}${r.isReopen ? '-r' : ''}${r.isTips ? '-t' : ''}@korea-econ-cal-data`;

  icsLines.push(
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    'LOCATION:US Department of Treasury',
    'URL:https://www.treasurydirect.gov/auctions/upcoming/',
    'END:VEVENT',
  );
}

icsLines.push('END:VCALENDAR');

process.stdout.write(icsLines.join('\r\n') + '\r\n');
process.stderr.write(`✓ ${rows.length} auction events generated\n`);
