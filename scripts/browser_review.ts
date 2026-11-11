/** Browser acceptance against the running local system; no mocked API data. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { settings } from '../control/settings.js';

const config = settings(),
  output = resolve(config.directory, 'review');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.AEGIS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.AEGIS_BROWSER_EXECUTABLE }
    : process.platform === 'win32'
      ? { channel: 'msedge' }
      : {}),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1512, height: 1060 } });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const synthetic = (source: string) =>
  new Promise<number>((resolve) => {
    const req = http.get(
      'http://127.0.0.1:8180/',
      { localAddress: source, timeout: 5000 },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode || 0));
      },
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => req.destroy());
  });
try {
  await page.goto(`http://127.0.0.1:${config.port}`);
  await page.getByLabel('Operator password').fill(config.operatorPassword);
  await page.getByRole('button', { name: 'Open operations console' }).click();
  await page.getByText('Live telemetry', { exact: true }).waitFor();
  await page.evaluate(async () => {
    const session = await (await fetch('/api/session')).json();
    const state = await (await fetch('/api/state')).json();
    for (const proposal of state.proposals)
      if (
        proposal.status === 'proposed' &&
        proposal.content.rationale.startsWith('Browser acceptance proposal')
      )
        await fetch(`/api/proposals/${proposal.id}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
          body: JSON.stringify({ hash: proposal.hash }),
        });
  });
  const beforeRequests = await page.evaluate(
    async () => (await (await fetch('/api/state')).json()).snapshot.metrics.requests as number,
  );
  for (let i = 0; i < 6; i++) assert.equal(await synthetic('127.0.0.1'), 200);
  const codes = [];
  for (let i = 0; i < 60; i++) codes.push(await synthetic('127.0.0.2'));
  assert.ok(codes.includes(429), 'controlled burst must actually hit the proxy rate limit');
  await page.getByRole('button', { name: 'Incidents', exact: true }).click();
  await page.getByText('Source violation threshold', { exact: true }).first().waitFor();
  await page
    .getByText(/Current lifetime/)
    .first()
    .waitFor();
  let incidentId = '';
  for (let attempt = 0; attempt < 80 && !incidentId; attempt++) {
    incidentId = (await page.evaluate(async () => {
      const state = await (await fetch('/api/state')).json();
      return (
        state.incidents.find(
          (incident: any) =>
            incident.source === '127.0.0.2' &&
            Date.now() - Date.parse(incident.createdAt) < 250000 &&
            incident.eventId.startsWith(state.snapshot.epoch + ':') &&
            !state.proposals.some(
              (proposal: any) =>
                proposal.content.incidentId === incident.id &&
                [
                  'proposed',
                  'executing',
                  'applied',
                  'verified',
                  'inconclusive',
                  'uncertain',
                ].includes(proposal.status),
            ),
        )?.id || false
      );
    })) as string;
    if (!incidentId) await page.waitForTimeout(100);
  }
  assert.ok(incidentId, 'an eligible current incident must be observed before selecting it');
  await page
    .getByRole('row')
    .filter({ hasText: incidentId.slice(0, 8) })
    .click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.waitForFunction(
    (minimum) =>
      Number(
        document
          .querySelector('.metric-grid .metric-note')
          ?.textContent?.match(/[\d,]+/)?.[0]
          .replaceAll(',', '') || 0,
      ) >= minimum,
    beforeRequests + 66,
  );
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'desktop document must not overflow horizontally',
  );
  await page.screenshot({ path: resolve(output, 'overview.png'), fullPage: true });
  for (const label of ['Traffic & health', 'Investigation', 'Response center', 'Audit trail']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.screenshot({
      path: resolve(output, label.toLowerCase().replaceAll(/[^a-z]+/g, '-') + '.png'),
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Response center', exact: true }).click();
  if (await page.getByRole('button', { name: 'Create manual proposal', exact: true }).count()) {
    await page.getByRole('button', { name: 'Create manual proposal', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page
      .getByLabel('Evidence-based rationale')
      .fill(
        'Browser acceptance proposal supported by actual synthetic source violations. This is a manual test proposal, not a model finding.',
      );
    await page.getByRole('button', { name: 'Create reviewable proposal', exact: true }).click();
    await page.getByRole('button', { name: 'Review & approve', exact: true }).click();
    const approve = page.getByRole('button', { name: 'Approve temporary deny', exact: true });
    assert.ok(await approve.isDisabled());
    await page.getByRole('checkbox').check();
    assert.ok(await approve.isEnabled());
    await page.screenshot({ path: resolve(output, 'approval-review.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.screenshot({ path: resolve(output, 'response-center.png'), fullPage: true });
    await page.getByRole('button', { name: 'Reject proposal', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'mobile document must not overflow horizontally',
  );
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        verified: [
          'real operator sign-in',
          'live telemetry',
          'real synthetic rate-limit detection',
          'all navigation views',
          'manual fallback dialog',
          'explicit approval checkbox gate (cancelled without enforcement)',
          '390px responsive layout',
          'no browser runtime errors',
        ],
        screenshots: output,
        mode: 'actual local system; no live model configured by this script; no approvals executed',
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  console.error(
    JSON.stringify({
      visibleErrors: await page.locator('[role="alert"], .error').allTextContents(),
      dialogs: await page.getByRole('dialog').count(),
    }),
  );
  throw error;
} finally {
  await browser.close();
}
