#!/usr/bin/env node
// Publish a compact app-readable status file from automation reports.

import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const REPORT_DIR = path.join(ROOT, 'reports');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function fileAvailable(filename) {
  if (!filename) return false;
  return fs.existsSync(path.join(DATA_DIR, filename));
}

const manifest = readJson(path.join(DATA_DIR, 'manifest.json'), { agencies: {} });
const syncReport = readJson(path.join(REPORT_DIR, 'us-sync-report.json'));
const ffReport = readJson(path.join(REPORT_DIR, 'forexfactory-verify.json'));

const agencies = Object.fromEntries(
  Object.entries(manifest.agencies || {}).map(([key, info]) => [
    key,
    {
      filename: info.filename || null,
      uploadedAt: info.uploadedAt || null,
      available: fileAvailable(info.filename),
    },
  ]),
);

const warnings = [];
if (!agencies.fed?.available) {
  warnings.push({
    code: 'fed-ics-missing',
    message: 'data/fed.ics is not published yet. Configure FRED_API_KEY to publish full US economic releases.',
  });
}
if (syncReport?.fred?.skipped) {
  warnings.push({
    code: 'fred-api-key-missing',
    message: 'FRED releases were skipped because FRED_API_KEY was not available to automation.',
  });
} else if (syncReport?.fred?.partial) {
  warnings.push({
    code: 'fred-fetch-partial',
    message: `FRED releases partially updated; ${syncReport.fred.failures?.length || 0} release(s) failed.`,
  });
} else if (syncReport?.fred && !syncReport.fred.success) {
  warnings.push({
    code: 'fred-fetch-failed',
    message: `FRED releases failed during automation: ${syncReport.fred.error || 'unknown error'}`,
  });
}
if (ffReport?.status === 'mismatch') {
  warnings.push({
    code: 'forexfactory-mismatch',
    message: `Forex Factory cross-check found ${ffReport.counts?.mismatches || 0} comparable mismatch(es).`,
  });
}
if (Array.isArray(ffReport?.feedErrors) && ffReport.feedErrors.length > 0) {
  warnings.push({
    code: 'forexfactory-feed-warning',
    message: `Forex Factory feed returned ${ffReport.feedErrors.length} warning(s).`,
  });
}

const status = {
  version: 1,
  generatedAt: new Date().toISOString(),
  manifestUpdatedAt: manifest.updatedAt || null,
  agencies,
  sync: syncReport ? {
    generatedAt: syncReport.generatedAt || null,
    window: syncReport.window || null,
    fred: syncReport.fred || null,
    fed: syncReport.fed || null,
    fedSpeech: syncReport.fedSpeech || null,
    manifestChanged: !!syncReport.manifestChanged,
  } : null,
  verification: {
    forexFactory: ffReport ? {
      generatedAt: ffReport.generatedAt || null,
      status: ffReport.status || 'unknown',
      verificationSkippedReason: ffReport.verificationSkippedReason || null,
      counts: ffReport.counts || null,
      feedErrors: Array.isArray(ffReport.feedErrors) ? ffReport.feedErrors : [],
    } : null,
  },
  warnings,
};

const output = JSON.stringify(status, null, 2) + '\n';
if (DRY_RUN) {
  process.stdout.write(output);
} else {
  fs.writeFileSync(path.join(DATA_DIR, 'status.json'), output);
  console.error(`Wrote data/status.json with ${warnings.length} warning(s)`);
}
