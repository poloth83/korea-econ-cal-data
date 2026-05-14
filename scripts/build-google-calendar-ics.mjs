#!/usr/bin/env node
// Build a single public ICS feed that Google Calendar can subscribe to.

import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'calendar.ics');

const SOURCE_ORDER = ['bok', 'moef', 'kostat', 'fed', 'fed_speech', 'ust'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function unfoldIcs(content) {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .reduce((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line);
      }
      return lines;
    }, [])
    .filter(line => line.length > 0);
}

function extractEvents(lines, sourceKey) {
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = [line];
      continue;
    }
    if (!current) continue;
    current.push(line);
    if (line === 'END:VEVENT') {
      const uidLine = current.find(item => item.startsWith('UID:'));
      const startLine = current.find(item => item.startsWith('DTSTART'));
      if (uidLine && startLine) {
        events.push({
          uid: uidLine.slice(4),
          sourceKey,
          sortTime: parseStartSortTime(startLine),
          lines: current,
        });
      }
      current = null;
    }
  }

  return events;
}

function parseStartSortTime(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return Number.MAX_SAFE_INTEGER;

  const property = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
  if (!match) return Number.MAX_SAFE_INTEGER;

  const [, yyyy, mm, dd, hh = '00', min = '00', ss = '00', zulu] = match;
  if (zulu) {
    return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
  }

  const timezoneOffsetMs = property.includes('TZID=Asia/Seoul') || !property.includes('TZID=')
    ? 9 * 60 * 60 * 1000
    : 0;
  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss)) - timezoneOffsetMs;
}

function eventCompare(a, b) {
  if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
  const sourceDiff = SOURCE_ORDER.indexOf(a.sourceKey) - SOURCE_ORDER.indexOf(b.sourceKey);
  if (sourceDiff !== 0) return sourceDiff;
  return a.uid.localeCompare(b.uid);
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function buildCalendar(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Korea Econ Cal Data//Google Calendar Combined Feed//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText('한국·미국 경제지표 캘린더')}`,
    `X-WR-CALDESC:${escapeIcsText('한국과 미국의 주요 경제지표 발표일정 통합 구독 캘린더')}`,
    'X-WR-TIMEZONE:Asia/Seoul',
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
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
    lines.push(...event.lines);
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function main() {
  const manifest = readJson(path.join(DATA_DIR, 'manifest.json'));
  const sourceFiles = SOURCE_ORDER
    .map(sourceKey => ({
      sourceKey,
      filename: manifest.agencies?.[sourceKey]?.filename,
    }))
    .filter(source => source.filename);

  const deduped = new Map();
  const counts = {};

  for (const source of sourceFiles) {
    const filePath = path.join(DATA_DIR, source.filename);
    if (!fs.existsSync(filePath)) {
      counts[source.sourceKey] = { filename: source.filename, count: 0, missing: true };
      continue;
    }

    const events = extractEvents(unfoldIcs(fs.readFileSync(filePath, 'utf8')), source.sourceKey);
    counts[source.sourceKey] = { filename: source.filename, count: events.length, missing: false };
    for (const event of events) {
      if (!deduped.has(event.uid)) deduped.set(event.uid, event);
    }
  }

  const events = [...deduped.values()].sort(eventCompare);
  const calendar = buildCalendar(events);

  if (DRY_RUN) {
    process.stdout.write(calendar);
  } else {
    fs.writeFileSync(OUTPUT_FILE, calendar);
  }

  console.error(`Built data/calendar.ics with ${events.length} event(s) from ${Object.keys(counts).length} source(s)`);
  for (const [sourceKey, result] of Object.entries(counts)) {
    console.error(`- ${sourceKey}: ${result.missing ? 'missing' : result.count} (${result.filename})`);
  }
}

main();
