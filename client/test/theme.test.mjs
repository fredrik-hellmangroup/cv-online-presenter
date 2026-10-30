import assert from 'node:assert/strict';
import test from 'node:test';
import { nextTheme, resolveTheme } from '../wwwroot/js/theme.js';

test('saved choice takes precedence over system preference', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('invalid saved choice falls back to system preference', () => {
  assert.equal(resolveTheme('invalid', true), 'dark');
  assert.equal(resolveTheme(null, false), 'light');
});

test('theme toggle alternates choices', () => {
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
});
