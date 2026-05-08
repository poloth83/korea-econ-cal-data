#!/usr/bin/env node
// Generate curated Korea economic-calendar ICS files for korea-econ-cal.
//
// Outputs:
//   data/bok.ics       Bank of Korea statistical release schedule
//   data/moef.ics      Korea Treasury Bond issuance calendar
//   data/kostat.ics    KOSTAT/National Data Office economic press schedule
//   data/manifest.json Adds/updates generated Korean sources only when content changes

import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const REPORT_DIR = path.join(ROOT, 'reports');
const FETCH_TIMEOUT_MS = 15_000;

const BOK_URL = 'https://www.bok.or.kr/portal/stats/statsPublictSchdul/listKnd.do';
const MOEF_MONTH_URL = 'https://ktb.moef.go.kr/mnbyIsuCldr.do';
const KOSTAT_URL = 'https://kostat.go.kr/newsPln.es';

const now = new Date();
const startDate = new Date(now);
startDate.setMonth(startDate.getMonth() - 13);
startDate.setHours(0, 0, 0, 0);
const endDate = new Date(now);
endDate.setDate(endDate.getDate() + 180);
endDate.setHours(23, 59, 59, 999);

const KOSTAT_INCLUDE = [
  /소비자물가|물가동향|고용동향|경제활동인구|산업활동|광공업|광업|제조업/i,
  /온라인쇼핑|서비스업동향|소매판매|건설|설비투자|전산업생산/i,
  /가계동향|가계금융|기업생멸|사업체|지역내총생산|GRDP/i,
  /인구동향|국내인구이동|농가경제|어가경제|양곡소비/i,
];

const KOSTAT_EXCLUDE = [
  /발대식|학술대회|초청연수|업무협약|협력체계|공모전|설명회|간담회|회의|행사|채용|인사/i,
];

function fmtKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtUtcStamp(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;
}

function addMinutes(dateStr, timeStr, minutes) {
  const [yy, mm, dd] = dateStr.split('-').map(Number);
  const [hh, mn] = timeStr.split(':').map(Number);
  const d = new Date(Date.UTC(yy, mm - 1, dd, hh, mn));
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return {
    date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  };
}

function inWindow(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  return d >= startDate && d <= endDate;
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, '·');
}

function cleanHtml(s) {
  return decodeHtml(String(s || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\s+\n/g, '\n'))
    .trim();
}

function stableHash(input) {
  let h = 2166136261;
  for (const ch of String(input)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function escIcs(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function eventsToIcs(events, calendarName, prodId) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
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

  for (const event of dedupeSort(events)) {
    const time = event.time || '09:00';
    const start = `${event.date.replace(/-/g, '')}T${time.replace(':', '')}00`;
    const end = addMinutes(event.date, time, event.durationMinutes || 30);
    const endStr = `${end.date.replace(/-/g, '')}T${end.time.replace(':', '')}00`;
    const stamp = fmtUtcStamp(new Date(`${event.date}T${time}:00+09:00`));
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escIcs(event.id)}@korea-econ-cal-data`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Seoul:${start}`,
      `DTEND;TZID=Asia/Seoul:${endStr}`,
      `SUMMARY:${escIcs(event.title)}`,
      `DESCRIPTION:${escIcs(event.note || '')}`,
      `LOCATION:${escIcs(event.location || 'South Korea')}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
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

async function fetchText(url, options = {}, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'korea-econ-cal-data/0.1',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err?.name === 'AbortError'
        ? new Error(`${url} request timed out after ${FETCH_TIMEOUT_MS}ms`)
        : err;
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** i));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function yearsInWindow() {
  const years = [];
  for (let y = startDate.getFullYear(); y <= endDate.getFullYear(); y++) years.push(y);
  return years;
}

function monthsInWindow() {
  const months = [];
  const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cur <= last) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function extractDiv(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start === -1) return '';
  const end = html.indexOf('</div>', start);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

async function fetchBokEvents() {
  const events = [];
  const fetchedYears = [];

  for (const year of yearsInWindow()) {
    const params = new URLSearchParams({ menuNo: '200776', year: String(year) });
    const html = await fetchText(`${BOK_URL}?${params.toString()}`);
    fetchedYears.push(year);

    const titleArea = extractDiv(html, 'rockLeftDiv');
    const dataArea = extractDiv(html, 'dataDiv');
    const titles = [...titleArea.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(m => cleanHtml(m[1]))
      .filter(Boolean);
    const rows = [...dataArea.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1]));

    if (titles.length === 0 || rows.length === 0) {
      throw new Error(`BOK ${year} table parse failed`);
    }

    rows.forEach((cells, rowIdx) => {
      const statName = titles[rowIdx] || '한국은행 통계';
      cells.forEach((cell, monthIdx) => {
        const parts = cell.split(/<br\s*\/?\s*>/i).map(cleanHtml).filter(Boolean);
        for (const part of parts) {
          if (part === '-' || !/\d{1,2}\.\d{1,2}/.test(part)) continue;
          const re = /(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*\(([^)]*)\))?/g;
          let match;
          while ((match = re.exec(part))) {
            const [, mmRaw, ddRaw, hhRaw, minRaw, periodRaw] = match;
            const mm = Number(mmRaw);
            const dd = Number(ddRaw);
            if (!Number.isFinite(mm) || !Number.isFinite(dd)) continue;
            const date = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
            if (mm !== monthIdx + 1 || !inWindow(date)) continue;
            const time = `${String(Number(hhRaw)).padStart(2, '0')}:${minRaw}`;
            const period = cleanHtml(periodRaw || '');
            events.push({
              id: `bok-${date}-${stableHash(`${statName}-${time}-${period}`)}`,
              date,
              time,
              title: `[BOK] ${statName}`,
              note: [
                '한국은행 통계공표일정',
                period ? `대상기간: ${period}` : null,
                `${time} KST`,
              ].filter(Boolean).join(' · '),
              location: 'Bank of Korea',
            });
          }
        }
      });
    });
  }

  return { events: dedupeSort(events), meta: { years: fetchedYears } };
}

function parseMoefRows(html) {
  const article = html.match(/<article class="mschd">[\s\S]*?<\/article>/)?.[0] || '';
  const rows = [];
  for (const row of article.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
    const dateRaw = cleanHtml(row[1]);
    const title = cleanHtml(row[2]);
    const m = dateRaw.match(/(\d{4})\.(\d{2})\.(\d{2})\./);
    if (!m || !title) continue;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    rows.push({ date, title });
  }
  return rows;
}

async function fetchMoefEvents() {
  const events = [];
  for (const { year, month } of monthsInWindow()) {
    const mm = String(month).padStart(2, '0');
    const body = new URLSearchParams({
      searchYear: String(year),
      searchMonth: String(month),
      searchDate: '1',
      useDate: `${year}${mm}01`,
      scrollY: '',
    });
    const html = await fetchText(MOEF_MONTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    for (const row of parseMoefRows(html)) {
      if (!inWindow(row.date)) continue;
      const isInflationLinked = /물가채/.test(row.title);
      events.push({
        id: `moef-${row.date}-${stableHash(row.title)}`,
        date: row.date,
        time: '11:00',
        title: `[국고채 입찰] ${row.title}`,
        note: `기획재정부 국채시장 월간 발행일정 · ${isInflationLinked ? '물가연동국고채' : '국고채'} · 결과발표 통상 11:00 KST`,
        location: 'Ministry of Economy and Finance',
      });
    }
  }
  return { events: dedupeSort(events), meta: { months: monthsInWindow().length } };
}

function shouldIncludeKostat(title, department) {
  const text = `${title} ${department}`;
  if (KOSTAT_EXCLUDE.some(re => re.test(text))) return false;
  return KOSTAT_INCLUDE.some(re => re.test(text));
}

async function fetchKostatEvents() {
  const html = await fetchText(`${KOSTAT_URL}?mid=a10305000000&oa_mm=ALL`);
  const headingYear = Number(html.match(/<h3>\s*(\d{4})년\s+.*?보도계획\s*<\/h3>/)?.[1]) || now.getFullYear();
  const tbody = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] || '';
  const events = [];

  for (const row of tbody.matchAll(/<tr class="tr-notice">([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => cleanHtml(m[1]));
    if (cells.length < 3) continue;
    const [dateRaw, timeRaw, title, department, noteRaw] = cells;
    if (!shouldIncludeKostat(title, department)) continue;
    const m = dateRaw.match(/(\d{2})\.(\d{2})\./);
    if (!m) continue;
    const timeMatch = timeRaw.match(/(\d{1,2}):(\d{2})/);
    const date = `${headingYear}-${m[1]}-${m[2]}`;
    if (!inWindow(date)) continue;
    const time = timeMatch
      ? `${String(Number(timeMatch[1])).padStart(2, '0')}:${timeMatch[2]}`
      : '12:00';
    events.push({
      id: `kostat-${date}-${stableHash(`${title}-${time}`)}`,
      date,
      time,
      title: `[통계청] ${title}`,
      note: [
        '국가데이터처 보도계획',
        department ? `담당: ${department}` : null,
        noteRaw || null,
        `${time} KST`,
      ].filter(Boolean).join(' · '),
      location: 'Statistics Korea / National Data Office',
    });
  }

  return { events: dedupeSort(events), meta: { year: headingYear } };
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
  fs.writeFileSync(path.join(REPORT_DIR, 'kr-sync-report.json'), output);
}

async function runSource(report, agencyKey, filename, fetcher, calendarName, prodId) {
  try {
    const result = await fetcher();
    const events = dedupeSort(result.events || []);
    if (events.length === 0) throw new Error(`${agencyKey} returned no events`);
    const content = eventsToIcs(events, calendarName, prodId);
    const changed = writeIfChanged(filename, content);
    report.sources[agencyKey] = {
      success: true,
      count: events.length,
      changed,
      skippedWrite: false,
      filename,
      meta: result.meta || null,
      error: null,
    };
    return { agencyKey, filename, changed };
  } catch (err) {
    report.sources[agencyKey] = {
      success: false,
      count: 0,
      changed: false,
      skippedWrite: true,
      filename,
      meta: null,
      error: err?.message || 'unknown error',
    };
    return null;
  }
}

async function main() {
  const report = {
    generatedAt: now.toISOString(),
    dryRun: DRY_RUN,
    window: { start: fmtKey(startDate), end: fmtKey(endDate) },
    sources: {},
    manifestChanged: false,
  };

  const changes = [];
  const sourceResults = await Promise.all([
    runSource(report, 'bok', 'bok.ics', fetchBokEvents, 'Bank of Korea Statistical Release Schedule', '-//Korea Econ Cal Data//BOK Statistical Releases//KO'),
    runSource(report, 'moef', 'moef.ics', fetchMoefEvents, 'Korea Treasury Bond Issuance Calendar', '-//Korea Econ Cal Data//MOEF KTB Calendar//KO'),
    runSource(report, 'kostat', 'kostat.ics', fetchKostatEvents, 'KOSTAT Economic Press Schedule', '-//Korea Econ Cal Data//KOSTAT Economic Releases//KO'),
  ]);

  for (const result of sourceResults) {
    if (result) changes.push(result);
  }
  report.manifestChanged = updateManifest(changes);

  writeReport(report);
  const summary = Object.entries(report.sources)
    .map(([key, source]) => `${key}=${source.count}${source.success ? '' : ':failed'}`)
    .join(' ');
  console.error(`KR sync complete: ${summary} dryRun=${DRY_RUN}`);
}

await main();
