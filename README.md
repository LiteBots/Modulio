# Modulio 4.0 — strona, panel klienta i panel zarządzania

Node.js + **MongoDB**, gotowe do wdrożenia na **Railway** z repozytorium GitHub.
Jedyna zależność: oficjalny sterownik `mongodb`. Pliki klientów (umowy, PDF-y) są zapisywane w MongoDB (GridFS), więc nic nie ginie przy restartach Railway.

| Adres | Co to jest |
|---|---|
| `/` | Strona firmowa + 5 podstron branżowych (SEO) |
| `/logowanie`, `/panel` | Panel klienta |
| `/admin` | Panel zarządzania całą platformą |

---

## Wdrożenie na Railway — krok po kroku

### 1. Wrzuć projekt na GitHub
```bash
cd modulio
git init
git add .
git commit -m "Modulio 4.0"
git branch -M main
git remote add origin https://github.com/TWOJ-LOGIN/modulio.git
git push -u origin main
```
Plik `.gitignore` pilnuje, żeby na GitHub nie trafiły `node_modules` ani pliki `.env`.

### 2. Utwórz projekt na Railway
1. [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → wybierz `modulio`.
2. W tym samym projekcie: **+ New** → **Database** → **MongoDB**.

### 3. Ustaw zmienne (usługa `modulio` → **Variables**)
| Zmienna | Wartość | Wymagana |
|---|---|---|
| `MONGO_URL` | `${{MongoDB.MONGO_URL}}` (przycisk **Add Reference** → MongoDB → MONGO_URL) | ✅ |
| `ADMIN_EMAIL` | Twój e-mail do panelu admina | ✅ |
| `ADMIN_PASSWORD` | Hasło (min. 8 znaków, litera + cyfra) | ✅ |
| `ADMIN_NAME` | np. `Gracjan` | |
| `ADMIN_QUICK_LOGIN` | `true` = wejście do /admin bez hasła (tymczasowo!) | |
| `SEED_DEMO` | `true` = przykładowe dane przy pustej bazie | |
| `SITE_URL` | `https://mojastrona.pl` (po podpięciu własnej domeny) | |
| `COMPANY_LEGAL_NAME`, `COMPANY_ADDRESS`, `COMPANY_NIP`, `COMPANY_BANK`, `CONTACT_EMAIL`, `CONTACT_PHONE` | dane firmy (później edycja w /admin/ustawienia) | |
| `LEAD_WEBHOOK_URL` | webhook Slack/Discord dla nowych zapytań | |

Pełna lista z opisami: `.env.example`. `PORT` ustawia Railway sam.

### 4. Domena
Usługa → **Settings** → **Networking** → **Generate Domain** (adres `*.up.railway.app`) lub **Custom Domain** dla `mojastrona.pl` (Railway poda rekord CNAME do ustawienia u rejestratora). Po podpięciu własnej domeny ustaw `SITE_URL`.

### 5. Gotowe
Railway sam zainstaluje zależności (`npm install`) i uruchomi `npm start`. Healthcheck: `/healthz` (ustawiony w `railway.json`).
Wejdź na `https://twoja-domena/admin` i zaloguj się danymi z `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Każdy `git push` na gałąź `main` = automatyczne nowe wdrożenie.

---

## Uruchomienie lokalne (opcjonalnie)
```bash
npm install
npm start                          # bez MONGO_URL: baza w pamięci + dane demo (znikają po restarcie)
MONGO_URL="mongodb://..." npm start   # z prawdziwą bazą (np. publiczny URL z Railway: MONGO_PUBLIC_URL)
```
Lokalne konta demo: `demo@modulio.pl` / `Demo1234!` (klient) i `admin@modulio.pl` / `Admin1234!` (admin).

## Narzędzia awaryjne (CLI)
Gdy zgubisz hasło administratora — z komputera, z publicznym adresem bazy z Railway (MongoDB → Variables → `MONGO_PUBLIC_URL`):
```bash
MONGO_URL="mongodb://...publiczny-adres..." npm run cli -- user:password --email twoj@email.pl
MONGO_URL="..." npm run cli -- admin:create --email nowy@email.pl --name "Imię"
MONGO_URL="..." npm run cli -- demo          # dane demonstracyjne
```

---

## Panel zarządzania `/admin`
| Moduł | Możliwości |
|---|---|
| **Pulpit** | Przychód miesiąca, MRR/ARR, klienci, należności, wykresy, lejek sprzedaży, zgłoszenia do obsłużenia, faktury po terminie, odnowienia, dziennik |
| **Statystyki** | 3/6/12/24 mies.: przychody, faktury, klienci, leady, konwersja, źródła, usługi, najwięksi klienci, abonamenty wg planu |
| **Leady** | Kanban (przeciągnij i upuść) + lista, wartość lejka, notatki, opiekun, zamiana leada w klienta (konto + hasło + projekt) |
| **Użytkownicy** | Edycja danych, role, blokada, reset/ustawienie hasła, wylogowanie wszędzie, podgląd konta klienta, usunięcie z danymi, notatki, historia |
| **Płatności** | Faktury (numeracja, VAT, kody rabatowe), wpłaty z automatycznym rozliczeniem faktury, wpłaty częściowe, anulowanie, CSV |
| **Do zrobienia** | Kanban etapów projektów, kamienie milowe z automatycznym postępem, aktualizacje dla klienta |
| **Aktywne oprogramowanie** | Systemy u klientów, plany, abonamenty, odnowienia, MRR |
| **Zgłoszenia** | Odpowiedzi z szablonami, notatki wewnętrzne, statusy, priorytety, przypisania |
| **Dokumenty** | Wysyłanie plików do klientów (do 10 MB, zapis w MongoDB) |
| **Marketing** | Ogłoszenia w panelu klienta, kody rabatowe, newsletter, źródła `?utm_source=`, komunikat do wszystkich |
| **Dziennik zdarzeń** | Kto, co, kiedy, z jakiego IP |
| **Ustawienia** | Dane firmy, rejestracja, tryb serwisowy, termin płatności, webhook, hasło, eksport CSV |

## Struktura
```
server/
  index.js          serwer HTTP, trasy stron, pliki statyczne, tryb serwisowy
  config.js         konfiguracja ze zmiennych środowiskowych (Railway Variables)
  db/index.js       połączenie z MongoDB, kolekcje, liczniki id, GridFS
  db/memory.js      baza w pamięci (lokalnie, gdy brak MONGO_URL)
  db/seed.js        dane demonstracyjne
  lib/              auth, http, settings, audit, csv, money
  api/              router, public, client, admin, mappers
  web/              szablony stron, SEO, treści branż
views/              partials · site · auth · client · admin
public/assets/      css · js · img (logo) · icons.svg
scripts/cli.js      narzędzia awaryjne
railway.json        konfiguracja wdrożenia Railway
```

## Kopie zapasowe
Railway → MongoDB → zakładka **Backups** (lub `mongodump` z publicznego adresu bazy). Wszystko — łącznie z plikami klientów — jest w jednej bazie.
