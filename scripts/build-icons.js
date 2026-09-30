#!/usr/bin/env node
// Buduje sprite SVG (public/assets/icons.svg) tylko z ikon Lucide używanych w projekcie.
// Źródło ikon: pakiet react-icons (zestaw "lu") — `npm i -D react-icons` lub instalacja globalna.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);

function findLucideSource() {
  const candidates = [];
  try { candidates.push(require.resolve('react-icons/lu/index.js')); } catch { /* brak lokalnie */ }
  try { candidates.push(path.join(execSync('npm root -g').toString().trim(), 'react-icons/lu/index.js')); } catch { /* brak globalnie */ }
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) { console.error('Nie znaleziono react-icons. Zainstaluj: npm i -D react-icons'); process.exit(1); }
  return found;
}

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase();

// 1) Wczytaj wszystkie ikony
const src = fs.readFileSync(findLucideSource(), 'utf8');
const icons = new Map();
for (const m of src.matchAll(/module\.exports\.Lu(\w+) = function[^{]+\{\s*return GenIcon\((\{.*?\})\)\(props\);/gs)) {
  icons.set(kebab(m[1]), JSON.parse(m[2]));
}

// 2) Zbierz nazwy użyte w plikach projektu
const files = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(html|js)$/.test(f.name) && !p.includes('icons.svg')) files.push(p);
  }
};
['views', 'server', 'public/assets/js'].forEach((d) => walk(path.join(ROOT, d)));
const used = new Set();
for (const f of files) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"`]/g)) {
    if (icons.has(m[1])) used.add(m[1]);
  }
}
// zawsze potrzebne w dynamicznych miejscach
['menu', 'x', 'eye', 'eye-off', 'sun', 'moon', 'loader-circle', 'circle-check', 'circle-alert', 'info', 'chevron-right', 'arrow-right'].forEach((n) => used.add(n));

// 3) Zbuduj sprite
const attrName = (k) => ({ strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', fillRule: 'fill-rule', clipRule: 'clip-rule' }[k] || k);
const node = (n) => {
  const attrs = Object.entries(n.attr || {}).map(([k, v]) => ` ${attrName(k)}="${String(v).replace(/"/g, '&quot;')}"`).join('');
  return `<${n.tag}${attrs}>${(n.child || []).map(node).join('')}</${n.tag}>`;
};
const symbols = [...used].sort().map((name) => {
  const svg = icons.get(name);
  return `<symbol id="${name}" viewBox="${svg.attr.viewBox || '0 0 24 24'}">${svg.child.map(node).join('')}</symbol>`;
});
const out = `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>\n`;
fs.writeFileSync(path.join(ROOT, 'public/assets/icons.svg'), out);
console.log(`✔ icons.svg: ${symbols.length} ikon, ${(out.length / 1024).toFixed(1)} KB`);

// 4) Ostrzeż o brakujących nazwach w data-lucide
for (const f of files) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/data-lucide="([\w-]+)"/g)) {
    if (!icons.has(m[1])) console.warn(`⚠ brak ikony "${m[1]}" w ${path.relative(ROOT, f)}`);
  }
}
