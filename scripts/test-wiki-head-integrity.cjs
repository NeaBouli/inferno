#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const wikiDir = path.join(root, 'docs', 'wiki');
const htmlFiles = fs.readdirSync(wikiDir)
  .filter((name) => name.endsWith('.html'))
  .sort();

function attributes(tag) {
  const result = new Map();
  for (const match of tag.matchAll(/\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])(.*?)\2/g)) {
    result.set(match[1].toLowerCase(), match[3]);
  }
  return result;
}

function tags(head, name) {
  return [...head.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) => ({
    source: match[0],
    attributes: attributes(match[0]),
  }));
}

assert.ok(htmlFiles.length > 0, 'No Wiki HTML pages found');

for (const file of htmlFiles) {
  const source = fs.readFileSync(path.join(wikiDir, file), 'utf8');
  const headMatches = [...source.matchAll(/<head\b[^>]*>([\s\S]*?)<\/head>/gi)];
  assert.equal(headMatches.length, 1, `${file}: expected exactly one <head>`);
  const head = headMatches[0][1];
  const expectedUrl = file === 'index.html'
    ? 'https://ifrunit.tech/wiki/'
    : `https://ifrunit.tech/wiki/${file}`;

  assert.doesNotMatch(
    head,
    /<(?:link|meta)\b[^>]*>>/,
    `${file}: malformed duplicate tag-closing bracket in <head>`
  );

  const linkTags = tags(head, 'link');
  const canonical = linkTags.filter(({ attributes: attrs }) => attrs.get('rel') === 'canonical');
  assert.equal(canonical.length, 1, `${file}: expected exactly one canonical link`);
  assert.equal(canonical[0].attributes.get('href'), expectedUrl, `${file}: canonical URL mismatch`);

  for (const language of ['en', 'x-default']) {
    const alternate = linkTags.filter(({ attributes: attrs }) => (
      attrs.get('rel') === 'alternate' && attrs.get('hreflang') === language
    ));
    assert.equal(alternate.length, 1, `${file}: expected exactly one ${language} alternate`);
    assert.equal(
      alternate[0].attributes.get('href'),
      expectedUrl,
      `${file}: ${language} alternate URL mismatch`
    );
  }

  const viewport = tags(head, 'meta').filter(({ attributes: attrs }) => (
    attrs.get('name')?.toLowerCase() === 'viewport'
  ));
  assert.equal(viewport.length, 1, `${file}: expected exactly one viewport meta`);
  const viewportParts = new Map(
    (viewport[0].attributes.get('content') || '')
      .split(',')
      .map((part) => part.trim().toLowerCase().split('=').map((value) => value.trim()))
      .filter(([key, value]) => key && value)
  );
  assert.equal(viewportParts.get('width'), 'device-width', `${file}: viewport width must be device-width`);
  assert.equal(viewportParts.get('initial-scale'), '1.0', `${file}: viewport initial-scale must be 1.0`);
  assert.notEqual(viewportParts.get('user-scalable'), 'no', `${file}: viewport must permit user zoom`);
  assert.notEqual(viewportParts.get('maximum-scale'), '1', `${file}: viewport must permit zoom above 1x`);
}

console.log(`[wiki-head-integrity] PASS (${htmlFiles.length} pages)`);
