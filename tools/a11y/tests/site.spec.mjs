import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = ['/', '/profile', '/services', '/projects', '/contact', '/cv'];

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

  test(`${route} theme toggle works and both themes pass contrast audits`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(route);

    const themeToggle = page.getByRole('button', { name: 'Växla tema' });
    await expect(themeToggle).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(darkAudit.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);

    await themeToggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(themeToggle).toHaveAttribute('aria-pressed', 'false');
    const lightAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(lightAudit.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
  });

  test(`${route} keeps the easter egg hidden until a secret trigger is used`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole('button', { name: 'Växla tema' })).toBeVisible();
    const egg = page.getByText('Du hittade en liten detalj i portfoliomallen.');
    await expect(page.getByRole('button', { name: 'Visa en överraskning' })).toHaveCount(0);
    await expect(egg).toBeHidden();

    await page.keyboard.type('kod');
    await expect(egg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(egg).toBeHidden();

    await page.locator('#brand-mark').evaluate(mark => { for (let click = 0; click < 5; click++) mark.click(); });
    await expect(egg).toBeVisible();
    await page.getByRole('button', { name: 'Stäng' }).click();
    await expect(egg).toBeHidden();
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

test('/cv has a scroll-following table of contents', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/cv');
  const toc = page.getByRole('complementary', { name: 'Innehållsförteckning' });
  await expect(toc).toBeVisible();
  const links = toc.getByRole('link');
  expect(await links.count()).toBeGreaterThanOrEqual(2);
  const last = links.last();
  await last.click();
  await expect(last).toHaveAttribute('aria-current', 'location');
  await page.mouse.wheel(0, 400);
  await expect(toc).toBeInViewport();
});

test('/cv search is a floating panel and /search no longer exists as a page', async ({ page }) => {
  await page.goto('/cv');
  const toggle = page.getByRole('button', { name: /^Sök/ });
  await expect(toggle).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sök', exact: true })).toHaveCount(0);

  await page.keyboard.press('Control+k');
  const input = page.getByRole('searchbox', { name: 'Sök i CV:t' });
  await expect(input).toBeFocused();
  await input.fill('Fredrik');
  await expect(page.locator('#cv-search-results a').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(input).toBeHidden();
  await expect(toggle).toBeFocused();

  await page.goto('/search?q=Fredrik');
  await expect(page).toHaveURL(/\/cv$/);
});

test('/cv particle canvas is present and reduced motion keeps it static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/cv');
  await expect(page.locator('#particle-field')).toHaveAttribute('aria-hidden', 'true');
  const sample = () => page.locator('#particle-field').evaluate(canvas => canvas.toDataURL());
  const first = await sample();
  await page.waitForTimeout(500);
  expect(await sample()).toBe(first);
});
