# Modulio 2.0 — strona + logowanie + panel klienta

Zero zależności npm. Wystarczy **Node.js 22.13+** (wbudowane SQLite `node:sqlite` i kryptografia).

```bash
cp .env.example .env    # uzupełnij SITE_URL i dane firmy
npm start               # http://localhost:3000
npm run dev             # auto-restart przy zmianach w server/ i views/
```

W trybie deweloperskim tworzy się konto demo: **demo@modulio.pl / Demo1234!**

## Co jest w środku

| Obszar | Opis |
|---|---|
| Strona główna `/` | Nowe sekcje (liczby, porównanie, panel klienta, bezpieczeństwo, CTA), konfigurator z paskiem postępu i pułapką fokusu, formularz z walidacją, zgodą RODO i honeypotem |
| Podstrony branżowe `/branze/*` | 5 landing pages pod SEO (gastronomia, usługi, transport, beauty, handel) — treść w `server/content.js` |
| Logowanie `/logowanie`, `/rejestracja` | Zakładki, siła hasła, pokaż hasło, „zapamiętaj mnie”, przekierowanie `?next=` |
| Panel `/panel` | Pulpit, projekty (etapy, kamienie milowe, aktualizacje), zgłoszenia (wątki, filtry, wyszukiwarka), faktury (podgląd do druku/PDF), dokumenty (pobieranie), konto (profil, hasło, sesje), jasny/ciemny motyw, nawigacja mobilna |
| API `/api/*` | JSON, walidacja, rate limiting, ochrona CSRF (nagłówek + Origin) |

## SEO
- Renderowanie po stronie serwera (treść branż w HTML, nie w JS), jeden `h1` na stronę, semantyczne sekcje
- `title`/`description`/canonical/hreflang/Open Graph/Twitter + obraz `og-image.png` 1200×630
- JSON-LD: Organization, WebSite, Service + OfferCatalog, FAQPage, BreadcrumbList
- Dynamiczne `sitemap.xml` i `robots.txt` (panel i API wyłączone z indeksu)
- Wydajność: brak GSAP i biblioteki ikon w JS — ikony to sprite SVG (30 KB), kompresja Brotli/gzip, cache `immutable` dla zasobów z `?v=`

## Bezpieczeństwo
Hasła: scrypt + sól · sesje: losowy token, w bazie tylko hash SHA-256, ciasteczko `HttpOnly; SameSite=Lax; Secure` · CSP bez `unsafe-inline` dla skryptów · HSTS · limity prób logowania/formularzy · dostęp do danych zawsze filtrowany po `user_id` · pobieranie plików tylko dla właściciela.

## Zarządzanie (CLI — zamiast panelu admina)
```bash
npm run cli -- help
npm run cli -- user:create --email jan@firma.pl --name "Jan Kowalski" --company "Firma"
npm run cli -- project:create --user jan@firma.pl --name "Wdrożenie CRM" --modules "CRM,Zlecenia" --manager "Marek" --due 2026-12-01
npm run cli -- milestone:add --project 3 --title "Import danych" --due 2026-11-10
npm run cli -- project:update 3 --stage wdrozenie --progress 40
npm run cli -- update:post --project 3 --title "Import zakończony" --body "..."
npm run cli -- tickets
npm run cli -- ticket:reply 5 --body "Poprawione!" --author "Marek" --status rozwiazane
npm run cli -- invoice:add --user jan@firma.pl --number FV/2026/10/001 --due 2026-10-24 --item "Abonament Business;1;199;23"
npm run cli -- invoice:paid 7
npm run cli -- doc:add --user jan@firma.pl --file umowa.pdf --category umowa --project 3
npm run cli -- leads
```

## Wdrożenie (VPS)
```bash
NODE_ENV=production npm start   # najlepiej jako usługa systemd lub pm2
```
Za nginx/Caddy ustaw `TRUST_PROXY=true` i HTTPS. Kopia zapasowa = katalog `data/` (baza `modulio.db` + pliki klientów).

## Struktura
```
server/   index.js (HTTP, statyczne, trasy) · api.js · auth.js · db.js · pages.js (SSR/SEO) · content.js · seed.js
views/    szablony HTML + partials (head, header, footer)
public/   assets/css, assets/js, assets/icons.svg, assets/img, site.webmanifest
scripts/  cli.js · build-icons.js (npm run icons — przebudowa sprite'a po dodaniu nowych ikon, wymaga react-icons)
```

## Następne kroki (do rozważenia)
Panel admina w przeglądarce · wysyłka e-maili (reset hasła, powiadomienia o odpowiedziach) · załączniki w zgłoszeniach · samodzielnie hostowane czcionki (RODO) · analityka bez cookies.
