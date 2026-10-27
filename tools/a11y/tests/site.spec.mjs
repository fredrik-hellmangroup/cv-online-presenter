import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = ['/', '/profile', '/services', '/projects', '/contact'];

for (const route of routes) {
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
