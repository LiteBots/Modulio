import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, tx, FILES_DIR } from './db.js';
import { hashPassword } from './auth.js';

const DAY = 86400000;
const d = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const t = (offsetDays, hour = 10) => {
  const x = new Date(Date.now() + offsetDays * DAY);
  x.setUTCHours(hour, Math.floor(Math.random() * 50), 0, 0);
  return x.toISOString();
};

// Minimalny generator PDF (tekst ASCII, czcionka Helvetica)
export function simplePdf(title, lines) {
  const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1');
  const content = [
    'BT', '/F1 20 Tf', '56 780 Td', `(${ascii(title)}) Tj`, '/F1 11 Tf', '0 -34 Td', '15 TL',
    ...lines.map((l) => `(${ascii(l)}) '`), 'ET',
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function addDocument(userId, projectId, name, category, filename, title, lines, createdAt) {
  const buf = simplePdf(title, lines);
  const stored = `${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(FILES_DIR, stored), buf);
  q(`INSERT INTO documents (user_id, project_id, name, category, filename, stored_as, mime, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?)`).run(userId, projectId, name, category, filename, stored, buf.length, createdAt);
}

export async function createDemoAccount({ email = 'demo@modulio.pl', password = 'Demo1234!', name = 'Anna Kowalska', company = 'Bistro Zielona Łyżka sp. z o.o.' } = {}) {
  const hash = await hashPassword(password);
  return tx(() => {
    const u = q(`INSERT INTO users (email, password_hash, name, company, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(email, hash, name, company, '+48 600 100 200', t(-70));
    const userId = Number(u.lastInsertRowid);

    // --- Projekt 1: w trakcie wdrożenia
    const p1 = Number(q(`INSERT INTO projects (user_id, name, kind, stage, progress, description, modules, manager, start_date, due_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId, 'System operacyjny lokali', 'Pakiet Business', 'wdrozenie', 62,
      'Zapotrzebowanie i zakupy, grafik zmian, ewidencja czasu pracy oraz raport kosztów dla dwóch lokali.',
      JSON.stringify(['Zapotrzebowanie', 'Grafik zmian', 'Czas pracy', 'Koszty i rentowność', 'Raporty']),
      'Marek Nowak', d(-42), d(24), t(-45),
    ).lastInsertRowid);
    const ms1 = [
      ['Warsztat: mapa procesów zaplecza', -38, 1], ['Specyfikacja modułów i ról', -30, 1], ['Import produktów i dostawców', -18, 1],
      ['Konfiguracja grafiku i czasu pracy', -6, 1], ['Szkolenie managerów lokali', 5, 0], ['Testy z zespołem (2 tygodnie)', 14, 0], ['Uruchomienie produkcyjne', 24, 0],
    ];
    ms1.forEach(([title, off, done], i) => q('INSERT INTO milestones (project_id, title, due_date, done, position) VALUES (?, ?, ?, ?, ?)').run(p1, title, d(off), done, i));
    [
      ['Start projektu', 'Rozpoczęliśmy analizę. Zebraliśmy obecne arkusze zapotrzebowania i grafiku z obu lokali.', -42],
      ['Specyfikacja zaakceptowana', 'Zakres, role (właściciel, manager lokalu, pracownik) i harmonogram zostały zatwierdzone. Dokument znajdziesz w zakładce Dokumenty.', -29],
      ['Import danych zakończony', 'Zaimportowaliśmy 214 produktów i 11 dostawców. Ceny zakupu z ostatnich 3 miesięcy są już w systemie.', -17],
      ['Grafik i czas pracy gotowe do testów', 'Moduł grafiku jest skonfigurowany dla obu lokali. Prosimy o dodanie dostępności pracowników na kolejny tydzień.', -5],
    ].forEach(([title, body, off]) => q('INSERT INTO project_updates (project_id, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)').run(p1, title, body, 'Marek Nowak', t(off, 12)));

    // --- Projekt 2: rozszerzenie — analiza
    const p2 = Number(q(`INSERT INTO projects (user_id, name, kind, stage, progress, description, modules, manager, start_date, due_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId, 'Integracja z systemem POS', 'Rozszerzenie', 'analiza', 15,
      'Pobieranie dziennej sprzedaży z POS do raportu rentowności oraz automatyczne wyliczanie food cost.',
      JSON.stringify(['Integracja API', 'Automatyzacje', 'Raporty']),
      'Kasia Wiśniewska', d(-8), d(60), t(-9),
    ).lastInsertRowid);
    [['Analiza API dostawcy POS', 3, 0], ['Mapowanie pozycji menu', 12, 0], ['Prototyp raportu food cost', 30, 0], ['Wdrożenie integracji', 60, 0]]
      .forEach(([title, off, done], i) => q('INSERT INTO milestones (project_id, title, due_date, done, position) VALUES (?, ?, ?, ?, ?)').run(p2, title, d(off), done, i));
    q('INSERT INTO project_updates (project_id, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(p2, 'Otrzymaliśmy dostęp testowy do API', 'Dziękujemy za klucze. Sprawdzamy zakres danych — w przyszłym tygodniu wrócimy z propozycją mapowania.', 'Kasia Wiśniewska', t(-2, 9));

    // --- Zgłoszenia
    const addTicket = (projectId, subject, category, priority, status, msgs) => {
      const created = msgs[0][2];
      const updated = msgs[msgs.length - 1][2];
      const tid = Number(q(`INSERT INTO tickets (user_id, project_id, subject, category, priority, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, projectId, subject, category, priority, status, created, updated).lastInsertRowid);
      for (const [type, author, at, body] of msgs) {
        q('INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)').run(tid, type, author, body, at);
      }
    };
    addTicket(p1, 'Dodatkowa rola: szef kuchni', 'zmiana', 'normalny', 'oczekuje_na_klienta', [
      ['client', name, t(-4, 8), 'Czy możemy dodać rolę szefa kuchni, który zatwierdza zapotrzebowanie, ale nie widzi wyników finansowych?'],
      ['team', 'Marek Nowak', t(-3, 11), 'Jasne, to prosta zmiana w uprawnieniach. Potwierdź proszę, czy szef kuchni ma widzieć grafik całego lokalu, czy tylko kuchni?'],
    ]);
    addTicket(p1, 'Eksport grafiku do PDF', 'nowa_funkcja', 'niski', 'w_toku', [
      ['client', name, t(-9, 14), 'Chcielibyśmy drukować grafik tygodniowy i wieszać go na zapleczu.'],
      ['team', 'Marek Nowak', t(-8, 10), 'Dodamy eksport do PDF w formacie A4 poziomo. Planujemy to na etap testów.'],
    ]);
    addTicket(p1, 'Błędna jednostka przy imporcie mąki', 'blad', 'wysoki', 'rozwiazane', [
      ['client', name, t(-15, 9), 'Mąka zaimportowała się w sztukach zamiast w kilogramach.'],
      ['team', 'Marek Nowak', t(-15, 13), 'Poprawione — 6 produktów sypkich ma teraz jednostkę kg. Przeliczyliśmy też historię cen.'],
    ]);

    // --- Faktury
    const inv = (number, issue, due, status, items, projectId, paidOff) => q(`INSERT INTO invoices (user_id, project_id, number, issue_date, due_date, items, status, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, projectId, number, d(issue), d(due), JSON.stringify(items), status, paidOff !== undefined ? t(paidOff) : null);
    const ym = (off) => d(off).slice(0, 7).replace('-', '/');
    inv(`FV/${ym(-40)}/017`, -40, -26, 'oplacona', [{ name: 'Analiza przedwdrożeniowa i warsztat procesów', qty: 1, unit_net: 2400, vat: 23 }], p1, -30);
    inv(`FV/${ym(-30)}/021`, -30, -16, 'oplacona', [{ name: 'Abonament Modulio Business — miesiąc 1', qty: 1, unit_net: 199, vat: 23 }, { name: 'Użytkownicy dodatkowi', qty: 4, unit_net: 15, vat: 23 }], p1, -20);
    inv(`FV/${ym(-18)}/008`, -18, -4, 'oczekuje', [{ name: 'Wdrożenie — etap 2: import danych i konfiguracja', qty: 1, unit_net: 3200, vat: 23 }], p1);
    inv(`FV/${ym(-2)}/003`, -2, 12, 'oczekuje', [{ name: 'Abonament Modulio Business — miesiąc 2', qty: 1, unit_net: 199, vat: 23 }, { name: 'Użytkownicy dodatkowi', qty: 4, unit_net: 15, vat: 23 }], p1);

    // --- Dokumenty
    addDocument(userId, p1, 'Umowa wdrożeniowa', 'umowa', 'Umowa-wdrozeniowa-Modulio.pdf', 'Umowa wdrozeniowa - Modulio', ['Dokument demonstracyjny.', '', 'Strony: Modulio oraz Klient.', 'Przedmiot: wdrozenie systemu operacyjnego lokali.', 'Harmonogram: zgodnie ze specyfikacja.'], t(-41));
    addDocument(userId, p1, 'Specyfikacja funkcjonalna v1.2', 'specyfikacja', 'Specyfikacja-v1.2.pdf', 'Specyfikacja funkcjonalna v1.2', ['Dokument demonstracyjny.', '', 'Moduly: zapotrzebowanie, grafik, czas pracy, koszty, raporty.', 'Role: wlasciciel, manager lokalu, pracownik.'], t(-29));
    addDocument(userId, p1, 'Protokół importu danych', 'protokol', 'Protokol-importu.pdf', 'Protokol importu danych', ['Dokument demonstracyjny.', '', 'Produkty: 214', 'Dostawcy: 11', 'Historia cen: 3 miesiace'], t(-17));
    addDocument(userId, p1, 'Instrukcja dla managera lokalu', 'instrukcja', 'Instrukcja-manager.pdf', 'Instrukcja dla managera lokalu', ['Dokument demonstracyjny.', '', '1. Logowanie do systemu', '2. Zatwierdzanie zapotrzebowania', '3. Planowanie grafiku', '4. Raport tygodnia'], t(-5));
    addDocument(userId, p2, 'Zakres integracji POS — szkic', 'specyfikacja', 'Integracja-POS-szkic.pdf', 'Zakres integracji POS - szkic', ['Dokument demonstracyjny.', '', 'Zrodlo danych: API POS', 'Czestotliwosc: raz dziennie', 'Cel: raport food cost'], t(-2));

    return userId;
  });
}

export async function seedIfEmpty() {
  const { c } = q('SELECT COUNT(*) AS c FROM users').get();
  if (c > 0) return false;
  await createDemoAccount();
  console.log('  [seed] Utworzono konto demo z przykładowymi danymi.');
  return true;
}
