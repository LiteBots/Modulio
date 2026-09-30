import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, tx, FILES_DIR } from './index.js';
import { hashPassword } from '../lib/auth.js';
import { invoiceTotals } from '../lib/money.js';

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
  await seedPlatform();
  console.log('  [seed] Utworzono dane demo: klient, administrator, zespół i historia platformy.');
  return true;
}

// =====================================================================
// Dane demonstracyjne całej platformy (admin, zespół, klienci, historia)
// =====================================================================

let seedR = 42;
const rnd = () => ((seedR = (seedR * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];

export async function seedPlatform() {
  const adminHash = await hashPassword('Admin1234!');
  const staffHash = await hashPassword('Zespol1234!');
  const clientHash = await hashPassword('Klient1234!');
  tx(() => {
    const ins = (email, hash, name, company, role, created) => Number(q(`INSERT INTO users (email, password_hash, name, company, phone, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(email, hash, name, company, `+48 ${500 + Math.floor(rnd() * 399)} ${100 + Math.floor(rnd() * 899)} ${100 + Math.floor(rnd() * 899)}`, role, created, t(-Math.floor(rnd() * 5))).lastInsertRowid);
    ins('admin@modulio.pl', adminHash, 'Gracjan', 'Modulio', 'admin', t(-400));
    const marek = ins('marek@modulio.pl', staffHash, 'Marek Nowak', 'Modulio', 'staff', t(-380));
    ins('kasia@modulio.pl', staffHash, 'Kasia Wiśniewska', 'Modulio', 'staff', t(-300));

    // Dodatkowi klienci rozłożeni w czasie (do statystyk)
    const companies = [
      ['Serwis Klimatyzacji Polar', 'Tomasz Zieliński', 'uslugi', 'Usługi i serwis'], ['Przeprowadzki Ekspres', 'Paweł Wójcik', 'transport', 'Transport'],
      ['Studio Urody Aura', 'Magda Lewandowska', 'beauty', 'Beauty & wellness'], ['Hurtownia Zdrowa Półka', 'Ewa Kamińska', 'handel', 'Handel'],
      ['Pizzeria Forno', 'Luca Rossi', 'gastro', 'Gastronomia'], ['Instalbud', 'Krzysztof Mazur', 'uslugi', 'Usługi i serwis'],
      ['TransLog Pomorze', 'Adam Krawczyk', 'transport', 'Transport'], ['Kawiarnia Ziarno', 'Ola Piotrowska', 'gastro', 'Gastronomia'],
      ['Salon Fryzjerski Nożyczki', 'Karolina Grabowska', 'beauty', 'Beauty & wellness'], ['Sklep Rowerowy Szprycha', 'Michał Pawlak', 'handel', 'Handel'],
    ];
    companies.forEach(([company, name, slug], i) => {
      const monthsAgo = 11 - i;
      const created = t(-(monthsAgo * 30 + Math.floor(rnd() * 20) + 5));
      const uid = ins(`${slug}${i + 1}@example.com`, clientHash, name, company, 'client', created);
      const plan = pick(['Start', 'Business', 'Business', 'Custom']);
      const fee = plan === 'Start' ? 99 : plan === 'Business' ? 199 + Math.floor(rnd() * 4) * 15 : 450 + Math.floor(rnd() * 6) * 50;
      const stage = monthsAgo > 2 ? pick(['uruchomiony', 'rozwoj', 'uruchomiony']) : pick(['wdrozenie', 'testy', 'projekt']);
      const pid = Number(q(`INSERT INTO projects (user_id, name, kind, stage, priority, progress, budget, description, modules, manager, start_date, due_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, `System ${company}`, `Pakiet ${plan}`, stage, pick(['normalny', 'wysoki', 'niski']),
        ['uruchomiony', 'rozwoj'].includes(stage) ? 100 : 30 + Math.floor(rnd() * 50), 2000 + Math.floor(rnd() * 8) * 1000, 'Wdrożenie modułów operacyjnych.',
        JSON.stringify(pick([['CRM', 'Zlecenia', 'Raporty'], ['Grafik', 'Czas pracy'], ['Magazyn', 'Dostawy', 'Raporty'], ['Wizyty', 'Klienci']])), pick(['Marek Nowak', 'Kasia Wiśniewska']),
        created.slice(0, 10), d(-(monthsAgo * 30) + 60), created).lastInsertRowid);
      // wdrożenie + abonamenty z wpłatami
      const setup = 1500 + Math.floor(rnd() * 10) * 250;
      addInv(uid, pid, -(monthsAgo * 30), [{ name: 'Wdrożenie systemu — analiza i konfiguracja', qty: 1, unit_net: setup, vat: 23 }], true);
      if (['uruchomiony', 'rozwoj'].includes(stage)) {
        q(`INSERT INTO software (user_id, project_id, name, plan, modules, monthly_fee, users_limit, url, version, status, started_at, renewal_date, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, pid, `Modulio ${company.split(' ').slice(-1)[0]}`, plan, JSON.stringify(['CRM', 'Raporty']), fee,
          plan === 'Start' ? 3 : plan === 'Business' ? 10 : 30, `https://${slug}${i + 1}.app.modulio.pl`, `2.${Math.floor(rnd() * 5)}`,
          i === 9 ? 'zawieszone' : 'aktywne', d(-(monthsAgo * 30) + 30), d(Math.floor(rnd() * 40) + 3), created);
        for (let m = monthsAgo - 1; m >= 0; m--) {
          const overdue = m === 0 && i % 4 === 0;
          addInv(uid, pid, -(m * 30) - 2, [{ name: `Abonament Modulio ${plan} — miesiąc`, qty: 1, unit_net: fee, vat: 23 }], !overdue && m > 0 || (m === 0 && i % 3 === 1), overdue);
        }
      }
    });

    // Projekty w kolejce „do zrobienia”
    const queued = [[6, 'Moduł rezerwacji online', 'Rozszerzenie', 'wysoki', 6000], [8, 'Integracja z e-sklepem', 'Integracja', 'normalny', 4500], [11, 'Aplikacja dla kierowców', 'Custom', 'krytyczny', 18000]];
    for (const [uid, name, kind, prio, budget] of queued) {
      if (!q('SELECT 1 FROM users WHERE id = ?').get(uid)) continue;
      q(`INSERT INTO projects (user_id, name, kind, stage, priority, progress, budget, description, modules, manager, due_date, created_at) VALUES (?, ?, ?, 'do_zrobienia', ?, 0, ?, ?, '[]', 'Marek Nowak', ?, ?)`)
        .run(uid, name, kind, prio, budget, 'Zakres zaakceptowany — czeka na rozpoczęcie prac.', d(45 + Math.floor(rnd() * 40)), t(-Math.floor(rnd() * 10)));
    }

    // Leady z 12 miesięcy
    const sources = ['kontakt', 'konfigurator', 'branza', 'google', 'facebook', 'polecenie'];
    const topics = ['Dobór systemu Modulio', 'Pakiet Business', 'Oprogramowanie dedykowane', 'Pakiet Start', 'Integracja / rozszerzenie'];
    const names = ['Jan Kowalczyk', 'Anna Nowicka', 'Piotr Szymański', 'Marta Dąbrowska', 'Robert Kozłowski', 'Agnieszka Jankowska', 'Łukasz Wojciechowski', 'Natalia Kwiatkowska', 'Bartek Kaczmarek', 'Zofia Mazurek'];
    for (let i = 0; i < 46; i++) {
      const age = Math.floor(rnd() * 350);
      const status = age < 10 ? pick(['nowy', 'nowy', 'w_kontakcie']) : age < 40 ? pick(['w_kontakcie', 'oferta', 'nowy']) : pick(['wygrany', 'przegrany', 'przegrany', 'wygrany', 'oferta']);
      const src = pick(sources);
      const nm = pick(names);
      q(`INSERT INTO leads (name, email, phone, company, topic, message, source, utm_source, status, value, assigned_to, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(nm, `${nm.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^\x00-\x7f]/g, '').replace('ł', 'l')}.${i}@firma.pl`,
        '+48 600 000 000', pick(['Firma Usługowa', 'Bistro', 'Hurtownia', 'Salon', 'Transport PL', '']), pick(topics),
        'Chcemy uporządkować zlecenia i koszty w jednym systemie. Prosimy o kontakt.', ['google', 'facebook', 'polecenie'].includes(src) ? 'kontakt' : src,
        ['google', 'facebook', 'polecenie'].includes(src) ? src : '', status, [0, 2400, 4800, 9000, 15000][Math.floor(rnd() * 5)], age < 40 ? marek : null, t(-age), t(-Math.max(0, age - 3)));
    }

    // Marketing
    q(`INSERT INTO announcements (title, body, tone, active, created_at) VALUES (?, ?, 'info', 1, ?)`)
      .run('Nowość: eksport raportów do Excela', 'W module raportów możesz teraz pobrać każde zestawienie jako plik XLSX. Zapytaj opiekuna o aktywację.', t(-3));
    q(`INSERT INTO announcements (title, body, tone, active, created_at) VALUES (?, ?, 'warning', 0, ?)`)
      .run('Prace serwisowe w niedzielę 02:00–04:00', 'System może być chwilowo niedostępny.', t(-20));
    ['START10:10:Rabat powitalny na wdrożenie:0', 'POLECENIE15:15:Za polecenie nowego klienta:20', 'BLACKWEEK:20:Kampania listopadowa:50']
      .forEach((s) => { const [c, p, desc, max] = s.split(':'); q('INSERT INTO discount_codes (code, percent, description, max_uses, used, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(c, Number(p), desc, Number(max), Math.floor(rnd() * 5), t(-60)); });
    for (let i = 0; i < 28; i++) q('INSERT OR IGNORE INTO newsletter (email, source, created_at) VALUES (?, ?, ?)').run(`subskrybent${i + 1}@example.com`, pick(['stopka', 'stopka', 'blog']), t(-Math.floor(rnd() * 300)));

    // Wpłaty dla faktur demo oznaczonych jako opłacone
    for (const inv of q(`SELECT i.* FROM invoices i WHERE status = 'oplacona' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)`).all()) {
      const { gross } = invoiceTotals(JSON.parse(inv.items), inv.discount_pct);
      q('INSERT INTO payments (invoice_id, user_id, amount, method, paid_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(inv.id, inv.user_id, gross, pick(['przelew', 'przelew', 'blik', 'karta']), (inv.paid_at || inv.due_date).slice(0, 10), '', inv.paid_at || inv.due_date);
    }
    q(`INSERT INTO audit_log (user_name, action, entity, details, created_at) VALUES ('system', 'seed', 'platform', 'Utworzono dane demonstracyjne', ?)`).run(t(0));
  });
}

let invCounter = 0;
function addInv(userId, projectId, issueOff, items, paid, forceOverdue = false) {
  invCounter++;
  const issue = d(issueOff);
  const due = forceOverdue ? d(Math.min(issueOff + 14, -3)) : d(issueOff + 14);
  q(`INSERT INTO invoices (user_id, project_id, number, issue_date, due_date, items, status, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, projectId, `FV/${issue.slice(0, 4)}/${issue.slice(5, 7)}/D${String(invCounter).padStart(3, '0')}`, issue, due, JSON.stringify(items),
      paid ? 'oplacona' : 'oczekuje', paid ? t(issueOff + 3 + Math.floor(rnd() * 8)) : null, t(issueOff));
}
