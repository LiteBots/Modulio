# Modulio 3.0 — strona, panel klienta i panel zarządzania

Cała platforma w jednym projekcie, **bez zależności npm**. Wymaga tylko **Node.js 22.13+** (wbudowane SQLite `node:sqlite` i kryptografia).

```bash
cp .env.example .env     # ustaw SITE_URL, ADMIN_EMAIL, ADMIN_PASSWORD i dane firmy
npm start                # http://localhost:3000
npm run dev              # auto-restart przy zmianach w server/ i views/
```

| Adres | Co to jest | Konto demo (tryb deweloperski) |
|---|---|---|
| `/` | Strona firmowa + 5 podstron branżowych (SEO) | — |
| `/logowanie`, `/panel` | Panel klienta | `demo@modulio.pl` / `Demo1234!` |
| `/admin` | **Panel zarządzania całą platformą** | `admin@modulio.pl` / `Admin1234!` |

Na produkcji (`NODE_ENV=production`) dane demo się nie tworzą — pierwsze konto administratora powstaje z `ADMIN_EMAIL` / `ADMIN_PASSWORD` w `.env` (albo `npm run cli -- admin:create --email ... --name ...`).

## Panel zarządzania `/admin`

| Moduł | Możliwości |
|---|---|
| **Pulpit** | Przychód miesiąca, MRR/ARR, klienci, należności, wykres wpłat, nowi klienci, lejek sprzedaży, zgłoszenia do obsłużenia, faktury po terminie, odnowienia, ostatnie zdarzenia |
| **Statystyki** | Zakres 3/6/12/24 mies.: przychody, faktury, liczba klientów, leady, konwersja, średnia wpłata, źródła leadów, przychód wg usługi, najwięksi klienci, abonamenty wg planu |
| **Leady** | Tablica kanban (przeciągnij i upuść) i lista, wartość lejka, opiekun, notatki, e-mail/telefon jednym kliknięciem, **zamiana leada w klienta** (konto + hasło + projekt) |
| **Użytkownicy** | Klienci i zespół, filtry, wyszukiwanie, edycja danych, role (klient / zespół / administrator), blokada, **reset i ręczne ustawienie hasła**, wylogowanie ze wszystkich urządzeń, **podgląd konta klienta („zaloguj jako”)**, usunięcie z danymi, notatki wewnętrzne, historia aktywności |
| **Płatności** | Wystawianie faktur (automatyczna numeracja, pozycje, VAT, kody rabatowe), rejestrowanie wpłat (przelew, BLIK, karta, gotówka) z automatycznym oznaczeniem faktury jako opłaconej, wpłaty częściowe, anulowanie, eksport CSV |
| **Do zrobienia (projekty)** | Kanban etapów: W kolejce → Analiza → Projekt → Wdrożenie → Testy → Uruchomiony → Rozwój; kamienie milowe z automatycznym postępem, aktualizacje publikowane w panelu klienta, „Uruchom jako oprogramowanie” |
| **Aktywne oprogramowanie** | Systemy u klientów: plan, abonament, limit użytkowników, adres, wersja, status (aktywne / zawieszone / wygasłe), odnowienia; MRR |
| **Zgłoszenia** | Wszystkie tickety, filtry (wymaga odpowiedzi, moje, zamknięte), odpowiedzi z szablonami, **notatki wewnętrzne**, status, priorytet, przypisanie do osoby |
| **Dokumenty** | Wysyłanie plików do klientów (PDF, DOCX, XLSX, obrazy, ZIP — do 10 MB), kategorie, pobieranie, usuwanie |
| **Marketing** | Ogłoszenia w panelu klienta, kody rabatowe, lista newslettera (zapis ze stopki strony), źródła pozyskania (`?utm_source=`), komunikat do wszystkich klientów |
| **Dziennik zdarzeń** | Logowania, nieudane próby, zmiany danych, płatności, eksporty — kto, co, kiedy, z jakiego IP |
| **Ustawienia** | Dane firmy (stopka, faktury, polityka), rejestracja on/off, **tryb serwisowy**, termin płatności, webhook dla leadów, zmiana hasła, eksport CSV |

Dodatkowo: wyszukiwarka globalna (**Ctrl + K**), szybkie dodawanie (+ Dodaj), jasny/ciemny motyw, widok mobilny, liczniki w menu odświeżane co minutę.

**Role:** `staff` (zespół) obsługuje leady, klientów, projekty, zgłoszenia i płatności; `admin` dodatkowo zmienia role, ustawienia, usuwa dane i używa podglądu konta klienta.

## Panel klienta `/panel`
Pulpit (ogłoszenia, projekty, kamienie milowe, aktywność, aktywne oprogramowanie, faktury), projekty z etapami, zgłoszenia z wątkami, faktury do druku/PDF, dokumenty do pobrania, ustawienia konta (dane, NIP, hasło, sesje), motyw ciemny.

## Bezpieczeństwo
Hasła scrypt + sól · sesje z losowym tokenem (w bazie tylko hash), ciasteczko `HttpOnly; SameSite=Lax; Secure` · ochrona CSRF · CSP bez skryptów inline · limity prób logowania i formularzy · rozdzielenie uprawnień klient / zespół / administrator · podgląd konta klienta nie daje dostępu do `/admin` · notatki wewnętrzne niewidoczne dla klienta · dziennik zdarzeń.

## SEO
Renderowanie po stronie serwera, meta + Open Graph + obraz 1200×630, JSON-LD (Organization, WebSite, Service, FAQPage, BreadcrumbList), dynamiczne `sitemap.xml` i `robots.txt` (`/panel`, `/admin`, `/api` wyłączone z indeksu), kompresja Brotli/gzip, cache zasobów.

## Struktura
```
server/
  index.js            serwer HTTP, trasy stron, pliki statyczne, tryb serwisowy
  config.js           konfiguracja z .env
  db/index.js         schemat SQLite + migracje
  db/seed.js          dane demonstracyjne
  lib/                auth (hasła, sesje), http (walidacja, nagłówki), settings, audit, csv, money
  api/router.js       router API, uprawnienia, słowniki
  api/public.js       kontakt, newsletter, logowanie, rejestracja
  api/client.js       API panelu klienta
  api/admin.js        API panelu zarządzania
  web/pages.js        szablony, SEO, sitemap
  web/content.js      treści podstron branżowych
views/
  partials/  site/  auth/  client/  admin/
public/assets/
  css/ site.css · app.css · admin.css
  js/  site.js · auth.js · panel.js · admin.js · admin-login.js · theme.js
  img/ logo.svg · logo-white.svg · favicon.svg · ikony PWA · og-image.png
  icons.svg           sprite ikon (npm run icons — przebudowa)
scripts/cli.js        narzędzia z terminala (npm run cli -- help)
```

## Wdrożenie (VPS)
```bash
NODE_ENV=production npm start      # jako usługa systemd lub pm2
```
Za nginx/Caddy ustaw `TRUST_PROXY=true` i HTTPS. **Kopia zapasowa** = katalog `data/` (baza + pliki klientów), np. codziennie: `sqlite3 data/modulio.db ".backup backup-$(date +%F).db"`.

## Do rozważenia w kolejnych krokach
Wysyłka e-maili (reset hasła, powiadomienia o odpowiedziach i fakturach) · płatności online (Przelewy24 / Stripe) · integracja z KSeF · uwierzytelnianie dwuskładnikowe dla administratorów · samodzielnie hostowane czcionki.
