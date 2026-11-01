import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`Mock ${theme}: workflow builder excludes deferred integrations and runs an allowed flow`, async ({ page }) => {
    await page.goto(`/?mode=mock&theme=${theme}&start=workflows`);
    await expect(page.getByText('Protect focus', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Receipts to Files', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Morning brief Spoken rundown of your day, weekdays at 7', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Weekly review One-page recap of your week, Fridays at 5', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New automation', exact: true }).click();
    await page.getByRole('button', { name: 'Edit When step', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Message trigger', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Email trigger', exact: true })).toBeVisible();
    await page.screenshot({path:test.info().outputPath('workflow-step-editor-close.png'),animations:'disabled'});
    await page.getByRole('button', { name: 'Close step editor', exact: true }).click();
    for (const [kind, omitted] of [
      ['Read', ['New messages']],
      ['If', ["It's from a favorite"]],
      ['Send', ['A message to Maya', 'A reply to the sender']],
      ['Do', ['Add the amount to Wallet']],
    ] as const) {
      await page.getByRole('button', { name: `Add ${kind} step`, exact: true }).click();
      for (const label of omitted) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
      if (kind === 'Send') await expect(page.getByRole('textbox', { name: 'Step text', exact: true })).toHaveValue('An email to me');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Run now', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Run now', exact: true }).click();
    await expect(page.getByRole('button', { name: /Today, .*succeeded/ }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Today, .*succeeded/ }).first().click();
    await expect(page.getByText(/Succeeded ·/)).toBeVisible();
    await expect(page.getByText(/Wallet|Contacts|New messages|message to Maya/)).toHaveCount(0);
  });
}

for (const prompt of ['whenever Maya texts, check my calendar', 'every day at 6, add the amount to Wallet']) {
  test(`Mock assistant rejects deferred workflow: ${prompt}`, async ({ page }) => {
    await page.goto('/?mode=mock&start=sheet');
    await page.getByRole('textbox', { name: 'Message Alpha', exact: true }).fill(prompt);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText("I can't set up that workflow on this phone yet.", { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on', exact: true })).toHaveCount(0);
    await expect(page.getByText('Everything went through.', { exact: false })).toHaveCount(0);
  });
}

test('Mock assistant keeps email triggers and call-note summaries in scope', async ({ page }) => {
  await page.goto('/?mode=mock&start=workflows:new');
  await page.getByRole('button', { name: 'Describe it to Alpha', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Alpha', exact: true }).fill('whenever Maya emails, summarize call notes');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText("Here's the workflow. Turn it on?", { exact: true })).toBeVisible();
  await expect(page.getByText(/When an email mentions “maya”/)).toBeVisible();
  await expect(page.getByText("I can't set up that workflow on this phone yet.", { exact: true })).toHaveCount(0);
});
