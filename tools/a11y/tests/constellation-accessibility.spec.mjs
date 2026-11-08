import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = ['/', '/services', '/cv'];
const axeRoutes = [...routes, '/projects', '/contact'];
const narrowWidths = [320, 375, 390, 428];
const themes = ['dark', 'light'];

async function settleAnimations(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined))));
}

async function selectTheme(page, theme) {
  const toggle = page.locator('#theme-toggle');
  await expect(toggle).toBeVisible();
  if (await page.locator('html').getAttribute('data-theme') !== theme) await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function readConstellationData(page) {
  return page.locator('#constellation-data').getAttribute('data-json').then(value => JSON.parse(value));
}

test.describe('demo-content constellation accessibility regressions', () => {
  test('has no horizontal scroll at narrow widths in both themes', async ({ page }) => {
    for (const route of routes) {
      await page.goto(route);
      for (const theme of themes) {
        await selectTheme(page, theme);
        for (const width of narrowWidths) {
          await page.setViewportSize({ width, height: 812 });
          const dimensions = await page.evaluate(() => ({
            clientWidth: document.scrollingElement.clientWidth,
            scrollWidth: document.scrollingElement.scrollWidth
          }));
          expect(dimensions.scrollWidth, `${route} ${theme} at ${width}px`).toBeLessThanOrEqual(dimensions.clientWidth);
        }
      }
    }
  });

  test('passes axe WCAG 2.2 AA at 375px in both themes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const route of axeRoutes) {
      await page.goto(route);
      for (const theme of themes) {
        await selectTheme(page, theme);
        await settleAnimations(page);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        expect(result.violations, `${route} ${theme}: ${JSON.stringify(result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) })))}`).toEqual([]);
      }
    }
  });

  test('server-rendered skill groups and skills match constellation JSON', async ({ page }) => {
    for (const route of ['/services', '/cv']) {
      await page.goto(route);
      const expected = await readConstellationData(page);
      const actual = await page.locator('.skill-group').evaluateAll(groups => groups.map(group => ({
        name: group.getAttribute('aria-label')?.trim() ?? group.querySelector('.skill-group-name')?.textContent.trim(),
        skills: [...group.querySelectorAll('[data-skill]')].map(button => button.getAttribute('data-skill'))
      })));
      expect(actual, route).toEqual(expected.groups.map(group => ({ name: group.name, skills: group.skills })));
    }
  });

  test('skill groups and skills remain available without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5187'
    });
    const page = await context.newPage();
    for (const route of ['/services', '/cv']) {
      await page.goto(route);
      const data = await readConstellationData(page);
      const actual = await page.locator('.skill-group').evaluateAll(groups => groups.map(group => ({
        name: group.getAttribute('aria-label')?.trim() ?? group.querySelector('.skill-group-name')?.textContent.trim(),
        skills: [...group.querySelectorAll('[data-skill]')].map(button => button.getAttribute('data-skill'))
      })));
      expect(actual, `${route} without JavaScript`).toEqual(data.groups.map(group => ({ name: group.name, skills: group.skills })));
      expect(await page.locator('.skill-group [data-skill]').count(), route).toBe(data.groups.reduce((total, group) => total + group.skills.length, 0));
    }
    await context.close();
  });

  test('constellation canvas is static when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/services');
    const canvas = page.locator('#constellation-field');
    await expect(canvas).toHaveAttribute('aria-hidden', 'true');
    const snapshot = () => canvas.evaluate(element => element.toDataURL());
    await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const first = await snapshot();
    await page.waitForTimeout(1_000);
    expect(await snapshot()).toBe(first);
  });

  test('skill pin works by keyboard and Escape clears the status', async ({ page }) => {
    await page.goto('/services');
    const button = page.locator('button[data-skill]').first();
    const skill = await button.getAttribute('data-skill');
    const status = page.locator('[data-pin-status]');
    await button.focus();
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toContainText(`Markerad: ${skill}`);
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(status).toBeEmpty();
  });

  test('header controls meet WCAG 2.5.8 size or spacing exception', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/services');
    const controls = page.locator('.site-header nav a, #theme-toggle');
    await expect(controls.first()).toBeVisible();
    const sizes = await controls.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { label: element.textContent.trim(), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    expect(sizes.length).toBeGreaterThan(0);
    const spacingFailures = sizes.flatMap((size, index) => {
      if (size.width >= 24 && size.height >= 24) return [];
      const centerX = size.x + size.width / 2;
      const centerY = size.y + size.height / 2;
      const neighbors = sizes.filter((_, otherIndex) => otherIndex !== index);
      return neighbors.filter(other => {
        const dx = Math.max(other.x - centerX, 0, centerX - other.x - other.width);
        const dy = Math.max(other.y - centerY, 0, centerY - other.y - other.height);
        return Math.hypot(dx, dy) < 12;
      }).map(other => ({ target: size.label, overlapsSpacingCircleOf: other.label }));
    });
    test.info().annotations.push({
      type: 'header target-size measurements',
      description: JSON.stringify({ sizes, spacingExceptionFailures: spacingFailures, under44: sizes.filter(size => size.width < 44 || size.height < 44).map(({ label, width, height }) => ({ label, width, height })) })
    });
    expect(spacingFailures, JSON.stringify({ sizes, spacingFailures })).toEqual([]);
  });

  test('records skill and group button heights against the 44px project policy', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const measurements = [];
    for (const route of ['/services', '/cv']) {
      await page.goto(route);
      const result = await page.locator('.skill-btn, .skill-group-btn').evaluateAll(buttons => buttons.map(button => ({
        route: location.pathname,
        name: button.textContent.trim(),
        height: button.getBoundingClientRect().height
      })));
      measurements.push(...result);
    }
    const undersized = measurements.filter(item => item.height < 44);
    test.info().annotations.push({
      type: 'report-only project target (44px)',
      description: JSON.stringify({ total: measurements.length, undersizedCount: undersized.length, undersized: undersized.slice(0, 20) })
    });
  });

});

test.describe('integration contract: motion control', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    test.skip(!(await page.locator('#motion-toggle').count()), 'Workstream B motion-toggle contract is not present on main.');
    await expect(page.locator('html')).toHaveAttribute('data-constellation-motion', /^(running|paused|reduced)$/);
  });

  test('motion toggle is an accessible 44px button and is hidden for reduced motion', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    const toggle = page.locator('.site-header button#motion-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('type', 'button');
    await expect(toggle).toHaveAccessibleName(/animation/i);
    const size = await toggle.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-constellation-motion', 'reduced');
    await expect(page.locator('#motion-toggle')).toBeHidden();
  });

  test('uses responsive default motion state, toggles, and persists the choice', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-constellation-motion', 'paused');
    const toggle = page.locator('#motion-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const storedBefore = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-constellation-motion', 'running');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const storedAfter = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    expect(storedAfter).not.toEqual(storedBefore);
    await expect.poll(() => page.locator('#constellation-field').evaluate(canvas => canvas.toDataURL())).not.toBe(await page.locator('#constellation-field').evaluate(canvas => canvas.toDataURL()));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-constellation-motion', 'running');
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-constellation-motion', 'paused');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const pausedFrame = await page.locator('#constellation-field').evaluate(canvas => canvas.toDataURL());
    await page.waitForTimeout(1_000);
    expect(await page.locator('#constellation-field').evaluate(canvas => canvas.toDataURL())).toBe(pausedFrame);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-constellation-motion', 'paused');
  });
});

test.describe('integration contract: constellation legend', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/services');
    test.skip(!(await page.locator('#motion-toggle').count()), 'Workstream B integration contract is not present on main.');
  });

  test('services explains that lines connect technologies used in the same assignment', async ({ page }) => {
    const legend = page.locator('.constellation-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText(/linjer.*tekniker.*samma uppdrag/i);
  });
});

test.describe('integration contract: group pinning and mobile targets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/services');
    test.skip(!(await page.locator('#motion-toggle').count()), 'Workstream B integration contract is not present on main.');
  });

  for (const route of ['/services', '/cv']) {
    test(`${route} group buttons pin their group, skills, and live status`, async ({ page }) => {
      await page.goto(route);
      const groups = page.locator('.skill-group');
      const markup = await groups.evaluateAll(items => items.map(item => ({
        name: item.getAttribute('aria-label')?.trim() ?? item.querySelector('.skill-group-name')?.textContent.trim(),
        buttons: [...item.querySelectorAll('button.skill-group-btn[data-group]')].map(button => button.getAttribute('data-group'))
      })));
      expect(markup.every(item => item.buttons.length === 1 && item.buttons[0] === item.name), JSON.stringify(markup)).toBe(true);
      const group = groups.first();
      const groupName = (await group.getAttribute('aria-label'))?.trim() ?? (await group.locator('.skill-group-name').innerText()).trim();
      const button = group.locator('button.skill-group-btn[data-group]');
      const skills = await group.locator('[data-skill]').evaluateAll(items => items.map(item => item.getAttribute('data-skill')));
      await expect(button).toHaveCount(1);
      await expect(button).toHaveAttribute('data-group', groupName);
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const pressedPins = () => page.locator('.skill-group-btn[aria-pressed="true"], button[data-skill][aria-pressed="true"]').count();
      expect(await pressedPins()).toBe(1);
      const status = page.locator('[data-pin-status]');
      await expect(status).toContainText(groupName);
      for (const skill of skills) await expect(status).toContainText(skill);
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(status).toBeEmpty();
      expect(await pressedPins()).toBe(0);
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(await pressedPins()).toBe(1);

      const skillButton = group.locator('button[data-skill]').first();
      await skillButton.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(skillButton).toHaveAttribute('aria-pressed', 'true');
      expect(await pressedPins()).toBe(1);
      await page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(skillButton).toHaveAttribute('aria-pressed', 'false');
      expect(await pressedPins()).toBe(0);
      await expect(status).toBeEmpty();
    });
  }

  test('group and skill controls are at least 44px tall on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const route of ['/services', '/cv']) {
      await page.goto(route);
      const measurements = await page.locator('.skill-group-btn, .skill-btn').evaluateAll(buttons => buttons.map(button => ({
        label: button.textContent.trim(),
        height: button.getBoundingClientRect().height
      })));
      expect(measurements.length, route).toBeGreaterThan(0);
      expect(measurements.filter(item => item.height < 44), `${route}: ${JSON.stringify(measurements.filter(item => item.height < 44).slice(0, 20))}`).toEqual([]);
    }
  });
});
