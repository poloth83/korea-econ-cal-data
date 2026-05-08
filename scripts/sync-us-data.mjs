#!/usr/bin/env node
// Generate curated US economic-calendar ICS files for korea-econ-cal.
//
// Outputs:
//   data/fed.ics         FRED releases + FOMC + Beige Book + scheduled private indicators
//   data/fed_speech.ics  Federal Reserve speeches/testimony from federalreserve.gov
//   data/manifest.json   Adds/updates generated sources only when content changes
//
// FRED_API_KEY is optional for dry-runs and local development. In production,
// configure it as a GitHub Actions secret for complete FRED coverage.

import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const REPORT_DIR = path.join(ROOT, 'reports');
const FRED_API_KEY = process.env.FRED_API_KEY || process.env.VITE_FRED_API_KEY || '';
const FRED_API_BASE = 'https://api.stlouisfed.org/fred/';
const FED_CALENDAR_URL = 'https://www.federalreserve.gov/json/calendar.json';
const FETCH_TIMEOUT_MS = 15_000;

const now = new Date();
const startDate = new Date(now);
startDate.setMonth(startDate.getMonth() - 13);
startDate.setHours(0, 0, 0, 0);
const endDate = new Date(now);
endDate.setDate(endDate.getDate() + 180);
endDate.setHours(23, 59, 59, 999);

const FOMC_MEETINGS = [
  { year: 2026, meeting: '1월',  decisionUtc: '2026-01-28T19:00:00Z', pressConf: false },
  { year: 2026, meeting: '3월',  decisionUtc: '2026-03-18T18:00:00Z', pressConf: true },
  { year: 2026, meeting: '4월',  decisionUtc: '2026-04-29T18:00:00Z', pressConf: false },
  { year: 2026, meeting: '6월',  decisionUtc: '2026-06-17T18:00:00Z', pressConf: true },
  { year: 2026, meeting: '7월',  decisionUtc: '2026-07-29T18:00:00Z', pressConf: false },
  { year: 2026, meeting: '9월',  decisionUtc: '2026-09-16T18:00:00Z', pressConf: true },
  { year: 2026, meeting: '10월', decisionUtc: '2026-10-28T18:00:00Z', pressConf: false },
  { year: 2026, meeting: '12월', decisionUtc: '2026-12-16T19:00:00Z', pressConf: true },
];

const fmtKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtUtcStamp = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;

function nthWeekday(year, month, n, weekday) {
  const d = new Date(year, month, 1);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + (n - 1) * 7);
  return d;
}

function isDstEt(year, monthIdx, day) {
  const dstStart = nthWeekday(year, 2, 2, 0);
  const dstEnd = nthWeekday(year, 10, 1, 0);
  const d = new Date(year, monthIdx, day);
  return d >= dstStart && d < dstEnd;
}

function etToKst(etDateStr, etHHMM) {
  const [yy, mm, dd] = etDateStr.split('-').map(Number);
  const [hh, mn] = etHHMM.split(':').map(Number);
  const offset = isDstEt(yy, mm - 1, dd) ? 4 : 5;
  const utc = new Date(Date.UTC(yy, mm - 1, dd, hh + offset, mn));
  const kst = new Date(utc.getTime() + 9 * 3600 * 1000);
  return {
    date: `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`,
    time: `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`,
  };
}

function observedHoliday(actualDate) {
  const dow = actualDate.getDay();
  if (dow === 6) { const d = new Date(actualDate); d.setDate(d.getDate() - 1); return d; }
  if (dow === 0) { const d = new Date(actualDate); d.setDate(d.getDate() + 1); return d; }
  return actualDate;
}
function nthMondayOfMonth(year, monthIdx, n) {
  const d = new Date(year, monthIdx, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + (n - 1) * 7);
  return d;
}
function lastMondayOfMonth(year, monthIdx) {
  const d = new Date(year, monthIdx + 1, 0);
  while (d.getDay() !== 1) d.setDate(d.getDate() - 1);
  return d;
}
function nthThursdayOfMonth(year, monthIdx, n) {
  const d = new Date(year, monthIdx, 1);
  while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + (n - 1) * 7);
  return d;
}
function isUsFederalHoliday(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const fixed = [[0, 1], [5, 19], [6, 4], [10, 11], [11, 25]];
  for (const [hM, hD] of fixed) {
    const obs = observedHoliday(new Date(y, hM, hD));
    if (obs.getMonth() === m && obs.getDate() === date.getDate()) return true;
  }
  if (m === 0 && date.getDate() === nthMondayOfMonth(y, 0, 3).getDate()) return true;
  if (m === 1 && date.getDate() === nthMondayOfMonth(y, 1, 3).getDate()) return true;
  if (m === 4 && date.getDate() === lastMondayOfMonth(y, 4).getDate()) return true;
  if (m === 8 && date.getDate() === nthMondayOfMonth(y, 8, 1).getDate()) return true;
  if (m === 9 && date.getDate() === nthMondayOfMonth(y, 9, 2).getDate()) return true;
  if (m === 10 && date.getDate() === nthThursdayOfMonth(y, 10, 4).getDate()) return true;
  return false;
}
function isUsBusinessDay(date) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  return !isUsFederalHoliday(date);
}
function nthBusinessDayOfMonth(year, monthIdx, n) {
  const d = new Date(year, monthIdx, 1);
  let count = 0;
  while (true) {
    if (isUsBusinessDay(d)) {
      count++;
      if (count >= n) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
    if (d.getMonth() !== monthIdx) return null;
  }
}
function firstFridayOfMonth(year, monthIdx) {
  const d = new Date(year, monthIdx, 1);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  return d;
}
function adpReleaseDate(year, monthIdx) {
  const d = new Date(year, monthIdx, 1);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  while (isUsFederalHoliday(d) && d.getMonth() === monthIdx) d.setDate(d.getDate() + 7);
  return d;
}
function qraBorrowingEstDate(year, monthIdx) {
  if (![1, 4, 7, 10].includes(monthIdx)) return null;
  const wed = new Date(year, monthIdx, 1);
  while (wed.getDay() !== 3) wed.setDate(wed.getDate() + 1);
  const mon = new Date(wed); mon.setDate(wed.getDate() - 2);
  return mon;
}
function qraRefundingStmtDate(year, monthIdx) {
  if (![1, 4, 7, 10].includes(monthIdx)) return null;
  const d = new Date(year, monthIdx, 1);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  return d;
}
function nthFridayOfMonth(year, monthIdx, n) {
  const d = firstFridayOfMonth(year, monthIdx);
  d.setDate(d.getDate() + (n - 1) * 7);
  if (d.getMonth() !== monthIdx) return null;
  return d;
}
function lastTuesdayOfMonth(year, monthIdx) {
  const d = new Date(year, monthIdx + 1, 0);
  while (d.getDay() !== 2) d.setDate(d.getDate() - 1);
  return d;
}

function mapFredReleaseName(englishName) {
  if (englishName === 'FOMC Press Release') return null;
  if (/^State /i.test(englishName)) return null;
  const lower = englishName.toLowerCase();
  if (lower.includes('employment situation')) return '미국 고용지표 (NFP)';
  if (lower.includes('consumer price index')) return '미국 CPI';
  if (lower.includes('producer price index')) return '미국 PPI';
  if (lower === 'gross domestic product') return '미국 GDP';
  if (lower === 'advance monthly sales for retail and food services') return '미국 소매판매';
  if (lower.includes('industrial production')) return '미국 산업생산';
  if (lower.includes('personal income') || lower.includes('personal consumption')) return '미국 PCE / 개인소득·지출';
  if (lower.includes('jolts') || lower.includes('job openings')) return '미국 JOLTS (구인이직)';
  if (lower.includes('housing starts')) return '미국 주택착공';
  if (lower.includes('new residential sales') || lower.includes('new home sales')) return '미국 신규주택판매';
  if (lower.includes('existing home sales')) return '미국 기존주택판매';
  if (lower.includes('international trade') && lower.includes('goods')) return '미국 무역수지';
  if (lower === 'u.s. import and export price indexes') return '미국 수출입물가지수';
  if (lower.includes('durable goods')) return '미국 내구재주문';
  if (lower === 'unemployment insurance weekly claims report' || lower.includes('initial claims')) return '미국 주간실업수당청구';
  if (lower.includes('construction spending')) return '미국 건설지출';
  if (lower.includes('fomc') && lower.includes('minutes')) return 'FOMC 의사록';
  if (lower.includes('treasury international capital')) return 'TIC 자본유출입';
  return null;
}

function defaultFredReleaseTimeEt(englishName) {
  const lower = englishName.toLowerCase();
  if (lower.includes('fomc')) return '14:00';
  if (lower.includes('industrial production')) return '09:15';
  if (lower.includes('jolts') || lower.includes('job openings') ||
      lower.includes('new residential') || lower.includes('existing home') ||
      lower.includes('michigan') || lower.includes('consumer sentiment') ||
      lower.includes('consumer confidence') || lower.includes('construction spending') ||
      lower.includes('beige book')) return '10:00';
  if (lower.includes('treasury international capital')) return '16:00';
  return '08:30';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'korea-econ-cal-data/0.1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.error_code || data?.error_message) {
        throw new Error(`FRED ${data.error_code || 'error'}: ${data.error_message || 'unknown error'}`);
      }
      return data;
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** i));
    }
  }
  throw lastError;
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'korea-econ-cal-data/0.1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** i));
    }
  }
  throw lastError;
}

async function fetchFredEvents() {
  if (!FRED_API_KEY) return { success: false, skipped: true, events: [], error: 'FRED_API_KEY missing' };

  const start = fmtKey(startDate);
  const end = fmtKey(endDate);
  const pageSize = 1000;
  const allRecords = [];
  let offset = 0;

  for (let safety = 0; safety < 20; safety++) {
    const url = `${FRED_API_BASE}releases/dates?api_key=${FRED_API_KEY}` +
      `&realtime_start=${start}&realtime_end=${end}` +
      `&include_release_dates_with_no_data=true&file_type=json` +
      `&limit=${pageSize}&offset=${offset}` +
      `&order_by=release_date&sort_order=asc`;
    const data = await fetchJson(url);
    const records = data.release_dates || [];
    allRecords.push(...records);
    const total = data.count || 0;
    if (allRecords.length >= total || records.length < pageSize) break;
    offset += pageSize;
  }

  const events = allRecords.map(rd => {
    const title = mapFredReleaseName(rd.release_name);
    if (!title) return null;
    const etTime = defaultFredReleaseTimeEt(rd.release_name);
    const kst = etToKst(rd.date, etTime);
    return {
      id: `fred_${rd.release_id}_${rd.date}`,
      agencyKey: 'fed',
      date: kst.date,
      time: kst.time,
      title,
      note: `${rd.release_name} · ${etTime} ET`,
    };
  }).filter(Boolean);

  return { success: true, events, count: events.length, sourceRecords: allRecords.length };
}

function generateFomcEvents() {
  return FOMC_MEETINGS.map(m => {
    const utc = new Date(m.decisionUtc);
    const kst = new Date(utc.getTime() + 9 * 3600 * 1000);
    const dateStr = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
    const timeStr = `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
    const titleSuffix = m.pressConf ? ' + 의장 회견' : '';
    return {
      id: `fomc_${m.year}_${m.meeting.replace(/[월\s]/g, '')}`,
      agencyKey: 'fed',
      date: dateStr,
      time: timeStr,
      title: `FOMC ${m.meeting} 금리결정${titleSuffix}`,
      note: `Fed 공식 일정 · 14:00 ET (KST 기준 다음날 ${timeStr})`,
    };
  });
}

function generateBeigeBookEvents() {
  return FOMC_MEETINGS.map(m => {
    const fomcUtc = new Date(m.decisionUtc);
    const bbDate = new Date(fomcUtc.getUTCFullYear(), fomcUtc.getUTCMonth(), fomcUtc.getUTCDate());
    bbDate.setDate(bbDate.getDate() - 14);
    const etDate = fmtKey(bbDate);
    const kst = etToKst(etDate, '14:00');
    return {
      id: `beige_${m.year}_${m.meeting.replace(/[월\s]/g, '')}`,
      agencyKey: 'fed',
      date: kst.date,
      time: kst.time,
      title: `Fed Beige Book (${m.meeting} FOMC 대비)`,
      note: `${m.meeting} FOMC 회의 14일 전 (수요일) · 14:00 ET`,
    };
  });
}

function generateUsScheduledIndicators(rangeStart, rangeEnd) {
  const events = [];
  const cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  const last = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, 0);
  const addEvent = (date, etTime, title, idPrefix, note) => {
    if (!date || date < rangeStart || date > rangeEnd) return;
    const dateStr = fmtKey(date);
    const kst = etToKst(dateStr, etTime);
    events.push({
      id: `${idPrefix}_${dateStr}`,
      agencyKey: 'fed',
      date: kst.date,
      time: kst.time,
      title,
      note,
    });
  };

  while (cur <= last) {
    const yy = cur.getFullYear();
    const mm = cur.getMonth();
    const ismMfg = nthBusinessDayOfMonth(yy, mm, 1);
    const ismSvc = nthBusinessDayOfMonth(yy, mm, 3);
    const adpDate = adpReleaseDate(yy, mm);
    const challengerDate = nthThursdayOfMonth(yy, mm, 1);
    const qraBE = qraBorrowingEstDate(yy, mm);
    const qraRS = qraRefundingStmtDate(yy, mm);
    const umPrelim = nthFridayOfMonth(yy, mm, 2);
    const umFinal = nthFridayOfMonth(yy, mm, 4);
    const cbConf = lastTuesdayOfMonth(yy, mm);

    addEvent(ismMfg, '10:00', '미국 ISM 제조업 PMI', 'ism_mfg', 'ISM Manufacturing PMI · 10:00 ET · 매월 1번째 영업일');
    addEvent(ismMfg, '09:45', 'S&P 글로벌 제조업 PMI (확정)', 'spg_mfg_final', 'S&P Global US Manufacturing PMI Final · 9:45 ET');
    addEvent(ismSvc, '10:00', '미국 ISM 서비스업 PMI', 'ism_svc', 'ISM Services PMI · 10:00 ET · 매월 3번째 영업일');
    addEvent(ismSvc, '09:45', 'S&P 글로벌 서비스업·종합 PMI (확정)', 'spg_svc_final', 'S&P Global US Services + Composite PMI Final · 9:45 ET');
    addEvent(adpDate, '08:15', '미국 ADP 민간고용', 'adp_nfp', 'ADP National Employment Report · 8:15 ET');
    addEvent(challengerDate, '07:30', '미국 챌린저 감원계획', 'challenger', 'Challenger Job Cut Report · 7:30 ET');
    addEvent(qraBE, '15:00', 'QRA — 분기 차입 추정치', 'qra_be', 'Treasury Quarterly Borrowing Estimate · 15:00 ET');
    addEvent(qraRS, '08:30', 'QRA — 분기 환매 성명', 'qra_rs', 'Treasury Quarterly Refunding Statement · 8:30 ET');
    addEvent(umPrelim, '10:00', '미시간대 소비자심리 (예비)', 'umich_prelim', 'University of Michigan Surveys of Consumers (Preliminary) · 10:00 ET');
    addEvent(umFinal, '10:00', '미시간대 소비자심리 (확정)', 'umich_final', 'University of Michigan Surveys of Consumers (Final) · 10:00 ET');
    addEvent(cbConf, '10:00', 'CB 소비자신뢰지수', 'cb_conf', 'Conference Board Consumer Confidence Index · 10:00 ET');
    cur.setMonth(cur.getMonth() + 1);
  }

  return events;
}

function parseFedTime(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i);
  if (!m) return null;
  let hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ampm = m[3].toLowerCase();
  if (ampm === 'p' && hh < 12) hh += 12;
  if (ampm === 'a' && hh === 12) hh = 0;
  return { h: hh, m: mm };
}

function parseFedSpeechTitle(rawTitle, type) {
  const actionMap = {
    'Speech': '연설',
    'Discussion': '토론',
    'Panel Discussion': '패널토론',
    'Testimony': '증언',
    'Event': '행사',
    'Welcoming Remarks': '환영사',
    'Opening Remarks': '개회사',
    'Keynote': '기조연설',
    'Conversation': '대담',
    'Q&A': '질의응답',
    'Fireside Chat': '대담',
  };
  const parts = String(rawTitle || '').split(/\s+-\s+/);
  if (parts.length < 2) {
    const fallback = type === 'Testimony' ? '증언' : '연설';
    return { short: rawTitle || fallback, action: fallback };
  }
  const action = parts[0].trim();
  const personPart = parts.slice(1).join(' - ').trim();
  const lastName = (personPart.split(/\s+/).pop() || '').replace(/[^A-Za-z]/g, '');
  const actionKr = actionMap[action] || (type === 'Testimony' ? '증언' : action);
  return { short: lastName ? `${lastName} ${actionKr}` : actionKr, action: actionKr };
}

async function fetchFedSpeechEvents() {
  const text = await fetchText(FED_CALENDAR_URL);
  const data = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  const events = [];

  for (const item of data.events || []) {
    if (!['Speeches', 'Testimony'].includes(item.type)) continue;
    if (!item.month || !item.days) continue;
    const [yy, mm] = String(item.month).split('-').map(Number);
    const days = String(item.days).split(',').map(d => parseInt(d.trim(), 10)).filter(Number.isFinite);
    const t = parseFedTime(item.time);
    const etH = t ? t.h : 14;
    const etM = t ? t.m : 0;
    const titleInfo = parseFedSpeechTitle(item.title, item.type);

    for (const day of days) {
      const eventDate = new Date(yy, mm - 1, day);
      if (eventDate < startDate || eventDate > endDate) continue;
      const dateStr = `${yy}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const kst = etToKst(dateStr, `${String(etH).padStart(2, '0')}:${String(etM).padStart(2, '0')}`);
      const noteParts = [];
      if (item.location) noteParts.push(item.location);
      noteParts.push(`${item.time || 'TBD'} ET`);
      if (item.title) noteParts.push(item.title);
      events.push({
        id: `fed_speech_${dateStr}_${day}_${(item.title || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`,
        agencyKey: 'fed_speech',
        date: kst.date,
        time: kst.time,
        title: titleInfo.short,
        note: noteParts.join(' · '),
      });
    }
  }

  return events;
}

function dedupeSort(events) {
  const map = new Map();
  for (const event of events) map.set(event.id, event);
  return [...map.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if ((a.time || '') !== (b.time || '')) return (a.time || '').localeCompare(b.time || '');
    return a.title.localeCompare(b.title);
  });
}

function escIcs(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function eventsToIcs(events, calendarName) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Korea Econ Cal Data//Automated US Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escIcs(calendarName)}`,
    'X-WR-TIMEZONE:Asia/Seoul',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Seoul',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:KST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const event of events) {
    const start = `${event.date.replace(/-/g, '')}T${(event.time || '09:00').replace(':', '')}00`;
    const end = new Date(`${event.date}T${event.time || '09:00'}:00`);
    end.setHours(end.getHours() + 1);
    const endStr = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}T${String(end.getHours()).padStart(2, '0')}${String(end.getMinutes()).padStart(2, '0')}00`;
    const stamp = fmtUtcStamp(new Date(`${event.date}T${event.time || '09:00'}:00+09:00`));
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escIcs(event.id)}@korea-econ-cal-data`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Seoul:${start}`,
      `DTEND;TZID=Asia/Seoul:${endStr}`,
      `SUMMARY:${escIcs(event.title)}`,
      `DESCRIPTION:${escIcs(event.note || '')}`,
      'LOCATION:United States',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function writeIfChanged(filename, content) {
  const filePath = path.join(DATA_DIR, filename);
  const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  if (previous === content) return false;
  if (!DRY_RUN) fs.writeFileSync(filePath, content);
  return true;
}

function updateManifest(changes) {
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const uploadedAt = now.toISOString();
  let changed = false;

  for (const change of changes) {
    if (!change.changed && manifest.agencies?.[change.agencyKey]?.filename === change.filename) continue;
    manifest.agencies ||= {};
    manifest.agencies[change.agencyKey] = {
      filename: change.filename,
      uploadedAt: change.changed ? uploadedAt : (manifest.agencies[change.agencyKey]?.uploadedAt || uploadedAt),
    };
    changed = true;
  }

  if (changed) {
    manifest.updatedAt = uploadedAt;
    if (!DRY_RUN) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  return changed;
}

function writeReport(report) {
  if (!fs.existsSync(REPORT_DIR) && !DRY_RUN) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const output = JSON.stringify(report, null, 2) + '\n';
  if (DRY_RUN) {
    process.stdout.write(output);
    return;
  }
  fs.writeFileSync(path.join(REPORT_DIR, 'us-sync-report.json'), output);
}

async function main() {
  const report = {
    generatedAt: now.toISOString(),
    dryRun: DRY_RUN,
    window: { start: fmtKey(startDate), end: fmtKey(endDate) },
    fred: null,
    fed: null,
    fedSpeech: null,
    manifestChanged: false,
  };

  let fredResult;
  try {
    fredResult = await fetchFredEvents();
  } catch (err) {
    fredResult = { success: false, events: [], error: err.message };
  }
  report.fred = {
    success: fredResult.success,
    skipped: !!fredResult.skipped,
    count: fredResult.count || 0,
    sourceRecords: fredResult.sourceRecords || 0,
    error: fredResult.error || null,
  };

  const generatedFedEvents = dedupeSort([
    ...(fredResult.events || []),
    ...generateFomcEvents(),
    ...generateBeigeBookEvents(),
    ...generateUsScheduledIndicators(startDate, endDate),
  ]);
  const fedIcs = eventsToIcs(generatedFedEvents, 'US Economic Data Releases');
  const shouldWriteFed = !!fredResult.success;
  const fedChanged = shouldWriteFed ? writeIfChanged('fed.ics', fedIcs) : false;
  report.fed = {
    count: generatedFedEvents.length,
    changed: fedChanged,
    skippedWrite: !shouldWriteFed,
    filename: 'fed.ics',
  };

  let speechEvents = [];
  let speechError = null;
  try {
    speechEvents = dedupeSort(await fetchFedSpeechEvents());
  } catch (err) {
    speechError = err.message;
  }
  const speechChanged = speechEvents.length > 0
    ? writeIfChanged('fed_speech.ics', eventsToIcs(speechEvents, 'Federal Reserve Speeches and Testimony'))
    : false;
  report.fedSpeech = {
    count: speechEvents.length,
    changed: speechChanged,
    error: speechError,
    filename: 'fed_speech.ics',
  };

  const manifestInputs = [];
  if (shouldWriteFed || fs.existsSync(path.join(DATA_DIR, 'fed.ics'))) {
    manifestInputs.push({ agencyKey: 'fed', filename: 'fed.ics', changed: fedChanged });
  }
  if (speechEvents.length > 0 || fs.existsSync(path.join(DATA_DIR, 'fed_speech.ics'))) {
    manifestInputs.push({ agencyKey: 'fed_speech', filename: 'fed_speech.ics', changed: speechChanged });
  }
  report.manifestChanged = updateManifest(manifestInputs);

  writeReport(report);
  console.error(`US sync complete: fed=${report.fed.count} speech=${report.fedSpeech.count} dryRun=${DRY_RUN}`);
}

await main();
