import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from '../config.js';
import { industries } from './content.js';
import { company } from '../lib/settings.js';

const VIEWS = path.join(ROOT, 'views');
const cache = new Map();

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function readView(name) {
  if (config.isProd && cache.has(name)) return cache.get(name);
  let html = fs.readFileSync(path.join(VIEWS, `${name}.html`), 'utf8');
  // SSI: <!--#include partial-->
  html = html.replace(/<!--#include ([\w/-]+)-->/g, (_, p) => readView(`partials/${p}`));
  if (config.isProd) cache.set(name, html);
  return html;
}

export function iconSvg(name, cls = '') {
  return `<svg class="i${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="/assets/icons.svg?v=${config.version}#${name}"></use></svg>`;
}


function orgJsonLd() {
  return {
    '@type': 'Organization',
    '@id': `${config.siteUrl}/#organization`,
    name: 'Modulio',
    legalName: company().legalName,
    url: config.siteUrl,
    logo: `${config.siteUrl}/assets/img/icon-512.png`, image: `${config.siteUrl}/assets/img/logo.svg`,
    email: company().email,
    contactPoint: [{ '@type': 'ContactPoint', contactType: 'sales', email: company().email, telephone: company().phone, availableLanguage: ['pl'] }],
  };
}

function jsonLdScript(graph) {
  const data = { '@context': 'https://schema.org', '@graph': graph };
  // bezpieczne osadzenie w <script>
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/**
 * Renderuje widok z metadanymi SEO.
 * vars: title, description, path, robots, jsonld (tablica węzłów @graph), bodyClass, ...
 */
export function render(view, vars = {}) {
  const canonical = `${config.siteUrl}${vars.path ?? '/'}`;
  const base = {
    TITLE: esc(vars.title || 'Modulio — system, który pracuje tak jak Twoja firma'),
    DESCRIPTION: esc(vars.description || ''),
    CANONICAL: canonical,
    ROBOTS: vars.robots || 'index, follow, max-image-preview:large',
    OG_TYPE: vars.ogType || 'website',
    OG_IMAGE: `${config.siteUrl}/assets/img/og-image.png`,
    SITE_URL: config.siteUrl,
    V: config.version,
    YEAR: String(new Date().getFullYear()),
    BODY_CLASS: vars.bodyClass || '',
    CONTACT_EMAIL: esc(company().email),
    CONTACT_PHONE: esc(company().phone),
    LEGAL_NAME: esc(company().legalName),
    COMPANY_ADDRESS: esc(company().address),
    JSONLD: vars.jsonld ? jsonLdScript([orgJsonLd(), ...vars.jsonld]) : '',
    INDUSTRY_LINKS: industries.map((i) => `<a href="/branze/${i.slug}">${esc(i.name)}</a>`).join(''),
  };
  const all = { ...base, ...(vars.raw || {}) };
  let html = readView(view);
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => (k in all ? all[k] : ''));
  html = html.replace(/<i data-lucide="([\w-]+)"(?: class="([^"]*)")?><\/i>/g, (_, n, c) => iconSvg(n, c));
  return html;
}

// ------------------------------------------------------------------
// Strona główna
// ------------------------------------------------------------------
const HOME_FAQ = [
  ['Czy mogę kupić system bezpośrednio na stronie?', 'Nie. Strona służy do poznania oferty, konfiguracji potrzeb i kontaktu. Uruchomienie oprogramowania wymaga bezpośredniego ustalenia zakresu, ceny, terminu i warunków współpracy.'],
  ['Czym różni się pakiet od systemu dedykowanego?', 'Pakiet wykorzystuje gotowe moduły Modulio i jest szybszym punktem startu. System dedykowany projektujemy pod nietypowe procesy, integracje, role lub logikę biznesową konkretnej firmy.'],
  ['Czy mogę zacząć od jednego modułu i rozbudować system później?', 'Tak. Modułowa konstrukcja pozwala rozpocząć od najważniejszego procesu, a później dodawać kolejne obszary, integracje i automatyzacje.'],
  ['Ile trwa wdrożenie?', 'Pakiet oparty na gotowych modułach uruchamiamy zwykle w kilka tygodni. Czas projektu dedykowanego zależy od zakresu — harmonogram ustalamy po analizie.'],
  ['Czy konfigurator podaje ostateczną cenę?', 'Nie. Konfigurator porządkuje potrzeby i pokazuje orientacyjną skalę wdrożenia. Ostateczna wycena powstaje po analizie zakresu.'],
  ['Czy przeniesiecie dane z arkuszy lub innego programu?', 'Tak. Import danych z arkuszy, CSV lub innego systemu jest częścią wdrożenia — ustalamy go na etapie analizy.'],
  ['Czy system działa na telefonie i komputerze?', 'Tak. Projektujemy interfejs jako responsywną aplikację webową — dostosowaną do komputera, tabletu i telefonu, zależnie od roli użytkownika.'],
  ['Co daje panel klienta?', 'Po rozpoczęciu współpracy logujesz się do panelu, w którym widzisz etap i postęp wdrożenia, kamienie milowe, dokumenty, faktury oraz zgłaszasz zmiany i problemy.'],
];

export function faqJsonLd(faq) {
  return {
    '@type': 'FAQPage',
    mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
}

function faqHtml(faq, openFirst = true) {
  return faq.map(([q, a], i) => `<details${openFirst && i === 0 ? ' open' : ''}><summary>${esc(q)}<span class="faq-plus"><i data-lucide="plus"></i></span></summary><p>${esc(a)}</p></details>`).join('');
}

function industryTabsHtml() {
  const tabs = industries.map((x, i) => `
    <button class="industry-tab${i === 0 ? ' is-active' : ''}" role="tab" id="tab-${x.slug}" aria-controls="panel-${x.slug}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">
      <span class="tab-icon"><i data-lucide="${x.icon}"></i></span>
      <span><b>${esc(x.name)}</b><small>${esc(x.tag)}</small></span>
      <i data-lucide="arrow-right"></i>
    </button>`).join('');
  const panels = industries.map((x, i) => `
    <div class="industry-panel" role="tabpanel" id="panel-${x.slug}" aria-labelledby="tab-${x.slug}" style="--preview-color:${x.color}"${i === 0 ? '' : ' hidden'}>
      <div class="industry-preview-inner">
        <div>
          <div class="meta"><span class="pill">MODULIO / ${esc(x.name)}</span><span class="pill">PRZYKŁADOWY ZAKRES</span></div>
          <h3>${esc(x.title)}</h3>
          <p class="lead">${esc(x.lead)}</p>
        </div>
        <div class="industry-board">
          <div class="board-head"><b>Tak może wyglądać Twój system</b><span>DEMO INTERFEJSU</span></div>
          <div class="board-grid">${x.board.map((b) => `<div class="board-item"><span class="board-icon"><i data-lucide="${b[0]}"></i></span><b>${esc(b[1])}</b><span>${esc(b[2])}</span></div>`).join('')}</div>
        </div>
        <div class="industry-foot">
          <div class="industry-features">${x.features.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
          <a class="button button-dark button-small" href="/branze/${x.slug}">Rozwiązanie: ${esc(x.name.toLowerCase())} <i data-lucide="arrow-up-right"></i></a>
        </div>
      </div>
    </div>`).join('');
  return { tabs, panels };
}

export function renderHome() {
  const { tabs, panels } = industryTabsHtml();
  return render('site/index', {
    path: '/',
    title: 'Modulio — modułowe i dedykowane oprogramowanie dla firm',
    description: 'Modulio łączy zlecenia, zespół, klientów, koszty i raporty w jednym systemie. Gotowe moduły dla gastronomii, usług, transportu, beauty i handlu albo oprogramowanie dedykowane.',
    jsonld: [
      { '@type': 'WebSite', '@id': `${config.siteUrl}/#website`, url: config.siteUrl, name: 'Modulio', inLanguage: 'pl-PL', publisher: { '@id': `${config.siteUrl}/#organization` } },
      {
        '@type': 'Service',
        name: 'Modułowe i dedykowane oprogramowanie dla firm',
        provider: { '@id': `${config.siteUrl}/#organization` },
        areaServed: { '@type': 'Country', name: 'Polska' },
        serviceType: 'Oprogramowanie dla firm (CRM, zlecenia, grafik, koszty, magazyn, raporty)',
        hasOfferCatalog: {
          '@type': 'OfferCatalog', name: 'Pakiety Modulio',
          itemListElement: [
            { '@type': 'Offer', name: 'Start', price: '99', priceCurrency: 'PLN', description: 'Do 3 użytkowników, 1 główny moduł. Cena netto miesięcznie, od.' },
            { '@type': 'Offer', name: 'Business', price: '199', priceCurrency: 'PLN', description: 'Do 10 użytkowników, do 3 modułów operacyjnych. Cena netto miesięcznie, od.' },
            { '@type': 'Offer', name: 'Custom', description: 'Oprogramowanie dedykowane — wycena indywidualna.' },
          ],
        },
      },
      faqJsonLd(HOME_FAQ),
    ],
    raw: { INDUSTRY_TABS: tabs, INDUSTRY_PANELS: panels, FAQ: faqHtml(HOME_FAQ) },
  });
}

// ------------------------------------------------------------------
// Podstrony branżowe
// ------------------------------------------------------------------
export function renderIndustry(slug) {
  const x = industries.find((i) => i.slug === slug);
  if (!x) return null;
  const others = industries.filter((i) => i.slug !== slug);
  const pathName = `/branze/${x.slug}`;
  return render('site/industry', {
    path: pathName,
    title: x.seoTitle,
    description: x.seoDescription,
    bodyClass: 'subpage',
    jsonld: [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Modulio', item: `${config.siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: 'Branże', item: `${config.siteUrl}/#rozwiazania` },
          { '@type': 'ListItem', position: 3, name: x.name, item: `${config.siteUrl}${pathName}` },
        ],
      },
      { '@type': 'Service', name: `Modulio — ${x.name}`, description: x.seoDescription, provider: { '@id': `${config.siteUrl}/#organization` }, areaServed: { '@type': 'Country', name: 'Polska' } },
      faqJsonLd(x.faq),
    ],
    raw: {
      IND_NAME: esc(x.name),
      IND_NAME_LOWER: esc(x.name.toLowerCase()),
      IND_TAG: esc(x.tag),
      IND_TITLE: esc(x.title),
      IND_LEAD: esc(x.lead),
      IND_COLOR: x.color,
      IND_ICON: iconSvg(x.icon),
      IND_PAINS: x.pains.map((p) => `<li>${iconSvg('x')}<span>${esc(p)}</span></li>`).join(''),
      IND_MODULES: x.modules.map(([ic, t, d]) => `<article class="ind-module reveal"><span class="icon-box">${iconSvg(ic)}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join(''),
      IND_BOARD: x.board.map((b) => `<div class="board-item"><span class="board-icon">${iconSvg(b[0])}</span><b>${esc(b[1])}</b><span>${esc(b[2])}</span></div>`).join(''),
      IND_FEATURES: x.features.map((f) => `<span>${esc(f)}</span>`).join(''),
      IND_FAQ: faqHtml(x.faq),
      IND_OTHERS: others.map((o) => `<a class="other-ind" href="/branze/${o.slug}"><span class="icon-box">${iconSvg(o.icon)}</span><span><b>${esc(o.name)}</b><small>${esc(o.tag)}</small></span>${iconSvg('arrow-up-right')}</a>`).join(''),
    },
  });
}

// ------------------------------------------------------------------
// SEO: sitemap i robots
// ------------------------------------------------------------------
const BUILD_DATE = new Date().toISOString().slice(0, 10);
export function sitemapXml() {
  const urls = [
    ['/', '1.0', 'weekly'],
    ...industries.map((i) => [`/branze/${i.slug}`, '0.8', 'monthly']),
    ['/polityka-prywatnosci', '0.2', 'yearly'],
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([p, pr, cf]) => `  <url><loc>${config.siteUrl}${p}</loc><lastmod>${BUILD_DATE}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`;
}

export function robotsTxt() {
  return `User-agent: *
Allow: /
Disallow: /panel
Disallow: /admin
Disallow: /api/
Disallow: /logowanie
Disallow: /rejestracja

Sitemap: ${config.siteUrl}/sitemap.xml
`;
}
