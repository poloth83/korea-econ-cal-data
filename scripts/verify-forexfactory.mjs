#!/usr/bin/env node
// Cross-check USD high-impact Forex Factory events against generated fed.ics.
//
// Forex Factory / Fair Economy publishes weekly XML feeds commonly used by
// calendar tools. This script treats them as a market-calendar cross-check,
// not as the source of truth. Mismatches block automated commits in the
// GitHub Actions workflow so a human can review before distribution.

import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const ROOT = process.cwd();
const REPORT_DIR = path.join(ROOT, 'reports');
const FEEDS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
];

const WATCHLIST = [
  { ff: /non-farm|nonfarm|employment change|unemployment rate/i, app: /고용지표|NFP|ADP|실업률/i },
  { ff: /unemployment claims|jobless claims/i, app: /주간실업수당/i },
  { ff: /\bCPI\b|consumer price/i, app: /CPI/i },
  { ff: /\bPPI\b|producer price/i, app: /PPI/i },
  { ff: /\bGDP\b|gross domestic/i, app: /GDP/i },
  { ff: /retail sales/i, app: /소매판매/i },
  { ff: /ISM manufacturing/i, app: /ISM 제조업/i },
  { ff: /ISM services|ISM non-manufacturing/i, app: /ISM 서비스업/i },
  { ff: /FOMC|federal funds|fed interest rate/i, app: /FOMC/i },
  { ff: /JOLTS|job openings/i, app: /JOLTS/i },
  { ff: /CB consumer confidence|consumer confidence/i, app: /CB 소비자신뢰|소비자신뢰/i },
  { ff: /UoM|University of Michigan|consumer sentiment/i, app: /미시간대/i },
  { ff: /PCE|personal consumption|personal income/i, app: /PCE|개인소득|개인지출/i },
  { ff: /durable goods/i, app: /내구재/i },
  { ff: /industrial production/i, app: /산업생산/i },
  { ff: /trade balance/i, app: /무역수지/i },
];

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

function decodeXml(s) {
  return stripTags(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeXml(m[1]) : '';
}

function parseFfDate(dateValue) {
  const value = String(dateValue || '').trim();
  let m = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchText(url) {
  // Since 2026-09-21 the feed CDN serves HTTP 200 with an empty/blank body to
  // requests from GitHub Actions IPs using Node's default `node` User-Agent,
  // which silently disabled verification. A browser-like UA avoids the filter.
  // The feed also rate-limits aggressively per IP (HTTP 429 observed from both
  // local and shared runner IPs), so back off and retry before giving up.
  const backoffMs = [45_000, 90_000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        'Accept': 'text/xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (res.status === 429 && attempt < backoffMs.length) {
      console.error(`${url} HTTP 429 — retrying in ${backoffMs[attempt] / 1000}s`);
      await sleep(backoffMs[attempt]);
      continue;
    }
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return res.text();
  }
}

async function fetchForexFactoryEvents() {
  const events = [];
  const feedErrors = [];

  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed);
      const blocks = [...xml.matchAll(/<event>([\s\S]*?)<\/event>/gi)].map(m => m[1]);
      if (blocks.length === 0) {
        // HTTP 200 with no parsable events means the feed is blocked or its
        // format changed — record it so status.json shows why instead of a
        // silent zero-event "blocked" that looks like a quiet week.
        feedErrors.push({
          feed,
          error: `HTTP 200 but 0 <event> blocks parsed (bodyLength=${xml.length}, head=${JSON.stringify(xml.slice(0, 160))})`,
        });
      }
      const countBefore = events.length;
      for (const block of blocks) {
        const country = tag(block, 'country');
        const impact = tag(block, 'impact');
        const title = tag(block, 'title');
        const date = parseFfDate(tag(block, 'date'));
        if (country !== 'USD') continue;
        // High only used to suffice, but FF re-rates US releases per week
        // (e.g. week of 2026-09-21 had zero High USD events — Claims and UoM
        // were Medium), which starved verification. The WATCHLIST still
        // narrows what gets compared, so Medium adds coverage, not noise.
        if (!/high|medium/i.test(impact)) continue;
        if (!date || !title) continue;
        events.push({
          id: `${date}_${title}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96),
          date,
          time: tag(block, 'time'),
          title,
          impact,
          source: feed,
        });
      }
      if (blocks.length > 0 && events.length === countBefore) {
        // Blocks parsed but nothing survived the USD impact filter — dump the
        // value distributions so the workflow log shows what this run got.
        const dist = field => {
          const counts = {};
          for (const b of blocks) {
            const v = tag(b, field) || '(empty)';
            counts[v] = (counts[v] || 0) + 1;
          }
          return JSON.stringify(counts);
        };
        console.error(`feed diagnostic: blocks=${blocks.length} country=${dist('country')} impact=${dist('impact')}`);
      }
    } catch (err) {
      feedErrors.push({ feed, error: err.message });
    }
  }

  return { events, feedErrors };
}

function parseIcsDate(value) {
  const raw = String(value || '');
  const clean = raw.replace(/Z$/, '');
  if (!clean.includes('T')) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  const datePart = clean.split('T')[0];
  return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`;
}

function parseFedIcs() {
  const filePath = path.join(ROOT, 'data', 'fed.ics');
  if (!fs.existsSync(filePath)) {
    return { exists: false, events: [] };
  }
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const blocks = [...text.matchAll(/BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/gi)].map(m => m[1]);
  const events = blocks.map(block => {
    const summary = (block.match(/^SUMMARY:(.*)$/m)?.[1] || '').replace(/\\,/g, ',').replace(/\\;/g, ';');
    const dtstart = block.match(/^DTSTART[^:]*:(.*)$/m)?.[1] || '';
    return { title: summary, date: parseIcsDate(dtstart) };
  }).filter(event => event.title && event.date);
  return { exists: true, events };
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function findComparableRule(title) {
  return WATCHLIST.find(rule => rule.ff.test(title));
}

function verify(ffEvents, appEvents) {
  const checked = [];
  const mismatches = [];
  const ignored = [];

  for (const event of ffEvents) {
    const rule = findComparableRule(event.title);
    if (!rule) {
      ignored.push(event);
      continue;
    }

    const allowedDates = new Set([addDays(event.date, -1), event.date, addDays(event.date, 1)]);
    const match = appEvents.find(appEvent => allowedDates.has(appEvent.date) && rule.app.test(appEvent.title));
    const result = {
      forexFactory: event,
      appMatch: match || null,
      allowedDates: [...allowedDates],
    };
    checked.push(result);
    if (!match) mismatches.push(result);
  }

  return { checked, mismatches, ignored };
}

function writeReport(report) {
  const output = JSON.stringify(report, null, 2) + '\n';
  if (DRY_RUN) {
    process.stdout.write(output);
    return;
  }
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'forexfactory-verify.json'), output);
}

async function main() {
  const generatedAt = new Date().toISOString();
  let ffResult;
  try {
    ffResult = await fetchForexFactoryEvents();
  } catch (err) {
    ffResult = { events: [], feedErrors: [{ feed: 'all', error: err.message }] };
  }

  const appSource = parseFedIcs();
  const appEvents = appSource.events;
  let verificationSkippedReason = null;
  let result = { checked: [], mismatches: [], ignored: ffResult.events };

  if (!appSource.exists) {
    verificationSkippedReason = 'data/fed.ics is missing; run sync with FRED_API_KEY before Forex Factory cross-checks can compare releases.';
  } else if (appEvents.length === 0) {
    verificationSkippedReason = 'data/fed.ics contains no comparable events; Forex Factory cross-check skipped.';
  } else {
    result = verify(ffResult.events, appEvents);
  }

  // 'blocked' means verification could not run (missing fed.ics or feed
  // errors). A healthy feed that simply has no comparable USD events this
  // week is 'no-comparable-events' — a quiet week, not an alarm. Before
  // 2026-09-25 that case was mislabeled 'blocked'.
  const status = verificationSkippedReason
    ? 'blocked'
    : result.mismatches.length > 0
      ? 'mismatch'
      : ffResult.events.length > 0
        ? 'ok'
        : ffResult.feedErrors.length > 0
          ? 'blocked'
          : 'no-comparable-events';

  const report = {
    generatedAt,
    dryRun: DRY_RUN,
    status,
    verificationSkippedReason,
    source: 'Forex Factory / Fair Economy weekly XML feeds',
    note: 'Forex Factory is used only as a market-calendar cross-check. Official/source data remains authoritative.',
    feedErrors: ffResult.feedErrors,
    counts: {
      forexFactoryHighUsd: ffResult.events.length,
      appFedEvents: appEvents.length,
      checked: result.checked.length,
      mismatches: result.mismatches.length,
      ignored: result.ignored.length,
    },
    mismatches: result.mismatches,
    checked: result.checked,
    ignored: result.ignored,
  };

  writeReport(report);
  console.error(`ForexFactory verification: status=${status} checked=${result.checked.length} mismatches=${result.mismatches.length}`);
  if (status === 'mismatch') process.exitCode = 2;
}

await main();
