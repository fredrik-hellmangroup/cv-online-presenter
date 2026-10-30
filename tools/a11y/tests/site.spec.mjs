import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = ['/', '/profile', '/services', '/projects', '/contact'];

test('unknown URLs return a useful, private 404', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv-SE');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('h1')).toHaveText('Sidan hittades inte');
  await expect(page.getByRole('link', { name: 'Till startsidan' })).toHaveAttribute('href', '/');
  const html = await page.locator('body').innerText();
  expect(html).not.toContain('Exception');
  expect(html).not.toContain('StackTrace');
});

for (const route of routes) {
  test(`${route} keeps content and navigation available without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(route);
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Huvudnavigation' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Huvudnavigation' }).getByRole('link', { name: 'Profil', exact: true })).toBeVisible();
    const colorScheme = await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme);
    expect(colorScheme).toBe('dark');
    await expect(page.getByRole('button', { name: 'Växla tema' })).toBeHidden();
    await context.close();
  });

  test(`${route} supports narrow and enlarged layouts`, async ({ page }) => {
    for (const width of [320, 360, 768, 1440, 720]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await expect(page.locator('main h1')).toHaveCount(1);
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth
      }));
      expect(dimensions.content, `${route} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    }
  });

  test(`${route} theme and easter egg are keyboard operable`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(route);

    const themeToggle = page.getByRole('button', { name: 'Växla tema' });
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(themeToggle).toHaveAttribute('aria-pressed', 'true');
    const darkAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(darkAudit.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);

    const eggToggle = page.getByRole('button', { name: 'Visa en överraskning' });
    await eggToggle.focus();
    await page.keyboard.press('Enter');
    await expect(eggToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Du hittade en liten detalj i portfoliomallen.')).toBeVisible();
  });

  test(`${route} seasonal layers retain contrast and reduced motion`, async ({ page, browserName }) => {
    if (browserName !== 'chromium') test.skip();
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await page.goto(route);
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
      for (const layer of ['christmas', 'new-year']) {
        await page.locator('html').evaluate((element, value) => { element.dataset.calendarLayer = value; }, layer);
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(audit.violations.filter(item => item.id === 'color-contrast')).toEqual([]);
        const motion = await page.locator('header').evaluate(element => getComputedStyle(element).animationDuration);
        expect(parseFloat(motion)).toBeLessThanOrEqual(0.00001);
      }
    }
  });

  test(`${route} has page language and a keyboard skip link`, async ({ page, browserName }) => {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('lang', 'sv-SE');
    if (browserName !== 'chromium') test.skip();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Hoppa till innehåll' })).toBeFocused();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const severe = results.violations.filter(item => item.impact === 'critical' || item.impact === 'serious');
    expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
  });
}
