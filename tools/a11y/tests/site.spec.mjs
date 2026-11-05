import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const routes = ['/', '/services', '/projects', '/contact', '/cv'];

// Entrance animations and colour transitions change computed colours mid-flight, which would skew contrast checks.
// Animations replaced by a theme switch reject `finished` with AbortError; they are no longer running, so that is settled too.
const settled = page => page.evaluate(() => Promise.all(
  document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined))
));

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
    await expect(page.getByRole('navigation', { name: 'Huvudnavigation' }).getByRole('link', { name: 'CV', exact: true })).toBeVisible();
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
    await settled(page);
    const darkAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(darkAudit.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);

    await themeToggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(themeToggle).toHaveAttribute('aria-pressed', 'false');
    await settled(page);
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
    const themeToggle = page.getByRole('button', { name: 'Växla tema' });
    await expect(themeToggle).toBeVisible();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
      await themeToggle.click();
      await expect(html).toHaveAttribute('data-theme', colorScheme);
      await expect(themeToggle).toHaveAttribute('aria-pressed', String(colorScheme === 'dark'));
      for (const layer of ['christmas', 'new-year']) {
        await html.evaluate((element, value) => { element.dataset.calendarLayer = value; }, layer);
        await expect(html).toHaveAttribute('data-theme', colorScheme);
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(audit.violations.filter(item => item.id === 'color-contrast')).toEqual([]);
      }
    }
  });

  test(`${route} has page language and a keyboard skip link`, async ({ page, browserName }) => {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('lang', 'sv-SE');
    if (browserName !== 'chromium') test.skip();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Hoppa till innehåll' })).toBeFocused();
    await settled(page);
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
  const searchTerm = (await page.locator('.assignment h3').first().innerText()).trim();
  await input.fill(searchTerm);
  await expect(page.locator('#cv-search-results a').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(input).toBeHidden();
  await expect(toggle).toBeFocused();

  await page.goto(`/search?q=${encodeURIComponent(searchTerm)}`);
  await expect(page).toHaveURL(/\/cv$/);
});

test('/cv constellation background respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/cv');
  const canvas = page.locator('#constellation-field');
  await expect(canvas).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#aurora-field')).toHaveCount(0);
  const sample = () => canvas.evaluate(element => element.toDataURL());
  const normalFrame = await sample();
  await expect.poll(sample).not.toBe(normalFrame);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  let previousFrame;
  let stableSamples = 0;
  await expect.poll(async () => {
    const frame = await sample();
    if (frame === previousFrame) stableSamples += 1;
    else {
      previousFrame = frame;
      stableSamples = 0;
    }
    return stableSamples >= 3;
  }, { intervals: [100], timeout: 5_000 }).toBe(true);

  const reducedFrame = await sample();
  let changedDuringObservation = false;
  let observationSamples = 0;
  await expect.poll(async () => {
    if (await sample() !== reducedFrame) changedDuringObservation = true;
    observationSamples += 1;
    return !changedDuringObservation && observationSamples >= 6;
  }, { intervals: [100], timeout: 1_500 }).toBe(true);
});

test('/cv constellation reacts to hovering an assignment and runs without errors', async ({ page, browserName }) => {
  if (browserName !== 'chromium') test.skip();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  await page.goto('/cv');
  const canvas = page.locator('#constellation-field');
  // Layout and obstacle measurement finish a frame or two after load; capture the ambient frame once they have.
  await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const ambient = await canvas.evaluate(element => element.toDataURL());
  const frame = () => canvas.evaluate(element => element.toDataURL());
  await page.locator('.git-row.branch a').first().hover();
  await expect.poll(frame).not.toBe(ambient);
  const hovered = await frame();
  await page.mouse.move(0, 0);
  // Leaving the hover hands the highlight back to the section in view, so the frame changes again rather than matching the first frame.
  await expect.poll(frame).not.toBe(hovered);
  expect(problems).toEqual([]);
});

test('/cv presents the CV as hero, figures, git log and cards without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/cv');
  await expect(page.locator('main h1')).toHaveCount(1);
  expect(await page.locator('.cv-figures > div').count()).toBeGreaterThanOrEqual(3);
  expect(await page.locator('.git-log .git-row').count()).toBeGreaterThan(10);
  expect(await page.locator('.assignment').count()).toBeGreaterThanOrEqual(5);
  expect(await page.locator('.assignment .tags li').count()).toBeGreaterThan(10);
  expect(await page.locator('.skill-group .chips li').count()).toBeGreaterThan(10);
  const hrefs = await page.locator('.git-row.branch a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    if (href?.startsWith('#')) await expect(page.locator(`[id="${href.slice(1)}"]`)).toHaveCount(1);
    else expect(href).toMatch(/^\/projects\//);
  }
  await context.close();
});


test('homepage hero is centered while the header and footer match the sub pages', async ({ page }) => {
  await page.goto('/');
  const alignment = await page.evaluate(() => {
    const header = document.querySelector('.site-header');
    const brand = header?.querySelector('.brand-wrap');
    const nav = header?.querySelector('nav');
    const article = document.querySelector('main.home article');
    const footer = document.querySelector('footer');
    if (!header || !brand || !nav || !article || !footer) return null;

    return {
      header: {
        flexDirection: getComputedStyle(header).flexDirection,
        alignItems: getComputedStyle(header).alignItems,
        justifyContent: getComputedStyle(header).justifyContent,
        textAlign: getComputedStyle(header).textAlign
      },
      brand: getComputedStyle(brand).justifyContent,
      navigation: getComputedStyle(nav).justifyContent,
      article: getComputedStyle(article).textAlign,
      footer: {
        justifyContent: getComputedStyle(footer).justifyContent,
        textAlign: getComputedStyle(footer).textAlign
      }
    };
  });

  expect(alignment).toEqual({
    // The header and footer match the sub pages; only the hero article is centered.
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' },
    brand: 'flex-start',
    navigation: 'center',
    article: 'center',
    footer: { justifyContent: 'normal', textAlign: 'start' }
  });
});

test('real-content home renders the source name H1 and role separately', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_CONTENT_MODE !== 'real');
  const pagesRoot = process.env.EDITORIAL_CONTENT_PAGES;
  expect(pagesRoot, 'real-content mode requires EDITORIAL_CONTENT_PAGES').toBeTruthy();
  const source = readFileSync(join(pagesRoot, 'home.md'), 'utf8');
  const markdown = source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '');
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex(line => /^#\s+/.test(line));
  const name = headingIndex < 0 ? undefined : lines[headingIndex].replace(/^#\s+/, '').trim();
  const tagline = headingIndex < 0 ? undefined : lines.slice(headingIndex + 1).find(line => line.trim())?.trim();
  expect(name, 'external home.md must contain a name H1').toBeTruthy();
  expect(tagline && !/^#{1,6}\s/u.test(tagline), 'external home.md must contain a separate role paragraph').toBeTruthy();

  await page.goto('/');
  const heading = page.locator('main h1');
  await expect(heading).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toHaveCount(1);
  await expect(heading).toHaveText(name);
  await expect(page.locator('main.home article > h1 + p')).toHaveText(tagline);
});

test('editorial home, services and project pages expose clear content and links', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main.home h1')).toHaveCount(1);
  await expect(page.locator('main.home article > h1 + p')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Roller', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Översikt', exact: true })).toHaveCount(0);

  await page.goto('/services');
  await expect(page.locator('main h1')).toHaveCount(1);
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(page.getByRole('tabpanel')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Teknik i uppdragen' })).toBeVisible();
  await expect(page.locator('.service-cv-cta').getByRole('link', { name: /fullständigt cv/i })).toHaveAttribute('href', '/cv');

  await page.goto('/projects');
  const cards = page.locator('.project-card');
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) {
    await expect(card.getByRole('heading', { level: 2 }).getByRole('link')).toHaveAttribute('href', /\/projects\//);
    await expect(card.locator('.project-card-description')).not.toBeEmpty();
  }

  const detailRoutes = await cards.locator('h2 a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  for (const route of detailRoutes) {
    await page.goto(route);
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.locator('.project-intro')).toHaveCount(1);
    await expect(page.locator('.project-responsibilities')).toBeVisible();
    await expect(page.locator('.project-results')).toBeVisible();
    await expect(page.locator('.project-technologies')).toHaveCount(1);
    const levels = await page.locator('main h1, main h2, main h3, main h4, main h5, main h6').evaluateAll(headings => headings.map(heading => Number(heading.tagName.slice(1))));
    expect(levels[0]).toBe(1);
    for (let index = 1; index < levels.length; index++) expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
    await settled(page);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(audit.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
  }
});
