import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('dashboard has semantic landmarks, accessible chart alternative, and external scripts', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');

  assert.match(html, /<html lang="de">/);
  assert.match(html, /href="#main"[^>]*>Zum Inhalt springen/);
  assert.match(html, /<main id="main" tabindex="-1">/);
  assert.match(html, /<h1>Fronius Curtailment Monitor<\/h1>/);
  assert.match(html, /<figure[^>]*aria-labelledby="power-chart-title"/);
  assert.match(html, /<table/);
  assert.match(html, /<caption>Messpunkte des gewählten Tages<\/caption>/);
  assert.match(html, /<label for="selected-date">Tag<\/label>/);
  assert.doesNotMatch(html, /<script[^>]*>\s*[^<]/);
});

test('dashboard supports reduced motion, focus visibility, and safe DOM rendering', () => {
  const css = fs.readFileSync('public/styles.css', 'utf8');
  const javascript = fs.readFileSync('public/app.js', 'utf8');

  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width:/);
  assert.doesNotMatch(javascript, /\.innerHTML\s*=/);
  assert.doesNotMatch(javascript, /\beval\s*\(/);
});
