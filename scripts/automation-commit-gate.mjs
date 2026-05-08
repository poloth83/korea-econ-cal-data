#!/usr/bin/env node
// GitHub Actions helper: block auto-commit only when Forex Factory found
// comparable high-impact USD mismatches. External feed outages should not
// prevent official/source updates from being published.

import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.join(process.cwd(), 'reports', 'forexfactory-verify.json');
let commit = true;
let reason = 'verification-ok-or-unavailable';

if (fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.status === 'mismatch' || (report.counts?.mismatches || 0) > 0) {
    commit = false;
    reason = `forexfactory-mismatch-${report.counts?.mismatches || 0}`;
  } else {
    reason = `forexfactory-${report.status || 'unknown'}`;
  }
} else {
  reason = 'no-forexfactory-report';
}

const output = `commit=${commit ? 'true' : 'false'}\nreason=${reason}\n`;
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
} else {
  process.stdout.write(output);
}

if (!commit) {
  console.error(`Auto-commit blocked: ${reason}`);
}
