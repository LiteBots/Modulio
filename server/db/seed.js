// =====================================================================
//  Dane demonstracyjne (klient demo, administrator, zespół, historia)
//  Tworzone tylko przy pustej bazie i SEED_DEMO=true (lub lokalnie bez MONGO_URL).
// =====================================================================
import crypto from 'node:crypto';
import { insert, findAll, findOne, count, saveFile } from './index.js';
import { hashPassword } from '../lib/auth.js';
import { invoiceTotals } from '../lib/money.js';
import { newUserDoc } from '../api/public.js';

const DAY = 86400000;
const d = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const t = (offsetDays, hour = 10) => {
  const x = new Date(Date.now() + offsetDays * DAY);
  x.setUTCHours(hour, Math.floor(Math.random() * 50), 0, 0);
  return x.toISOString();
};

let seedR = 42;
const rnd = () => ((seedR = (seedR * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// Minimalny generator PDF (tekst ASCII, czcionka Helvetica)
export function simplePdf(title, lines) {
  const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1');
  const content = ['BT', '/F1 20 Tf', '56 780 Td', `(${ascii(title)}) Tj`, '/F1 11 Tf', '0 -34 Td', '15 TL', ...lines.map((l) => `(${ascii(l)}) '`), 'ET'].join('\n');
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

async function addDocument(userId, projectId, name, category, filename, title, lines, createdAt) {
  const buf = simplePdf(title, lines);
  const stored = `${crypto.randomUUID()}.pdf`;
  await saveFile(stored, buf, 'application/pdf');
  await insert('documents', { user_id: userId, project_id: projectId, name, category, filename, stored_as: stored, mime: 'application/pdf', size: buf.length, created_at: createdAt });
}

const project = (o) => insert('projects', {
  priority: 'normalny', budget: 0, modules: [], manager: '', start_date: null, due_date: null, progress: 0, description: '', ...o,
});

let invCounter = 0;
async function addInv(userId, projectId, issueOff, items, paid, { number, forceOverdue = false } = {}) {
  invCounter++;
  const issue = d(issueOff);
  const due = forceOverdue ? d(Math.min(issueOff + 14, -3)) : d(issueOff + 14);
  return insert('invoices', {
    user_id: userId, project_id: projectId, number: number || `FV/${issue.slice(0, 4)}/${issue.slice(5, 7)}/D${String(invCounter).padStart(3, '0')}`,
    issue_date: issue, due_date: due, items, discount_code: '', discount_pct: 0,
    status: paid ? 'oplacona' : 'oczekuje', paid_at: paid ? t(issueOff + 3 + Math.floor(rnd() * 8)) : null, created_at: t(issueOff),
  });
}

async function addTicket(userId, projectId, subject, category, priority, status, msgs) {
  const tk = await insert('tickets', { user_id: userId, project_id: projectId, assigned_to: null, subject, category, priority, status, created_at: msgs[0][2], updated_at: msgs[msgs.length - 1][2] });
  for (const [type, author, at, body] of msgs) await insert('ticket_messages', { ticket_id: tk.id, author_type: type, author_name: author, body, created_at: at });
}

// ---------------------------------------------------------------------
export async function createDemoAccount({ email = 'demo@modulio.pl', password = 'Demo1234!', name = 'Anna Kowalska', company = 'Bistro Zielona Łyżka sp. z o.o.' } = {}) {
  const u = await insert('users', newUserDoc({ email, password_hash: await hashPassword(password), name, company, phone: '+48 600 100 200', created_at: t(-70) }));
  const userId = u.id;

  const p1 = (await project({
    user_id: userId, name: 'System operacyjny lokali', kind: 'Pakiet Business', stage: 'wdrozenie', progress: 62,
    description: 'Zapotrzebowanie i zakupy, grafik zmian, ewidencja czasu pracy oraz raport kosztów dla dwóch lokali.',
    modules: ['Zapotrzebowanie', 'Grafik zmian', 'Czas pracy', 'Koszty i rentowność', 'Raporty'],
    manager: 'Marek Nowak', start_date: d(-42), due_date: d(24), created_at: t(-45),
  })).id;
  const ms1 = [
    ['Warsztat: mapa procesów zaplecza', -38, true], ['Specyfikacja modułów i ról', -30, true], ['Import produktów i dostawców', -18, true],
    ['Konfiguracja grafiku i czasu pracy', -6, true], ['Szkolenie managerów lokali', 5, false], ['Testy z zespołem (2 tygodnie)', 14, false], ['Uruchomienie produkcyjne', 24, false],
  ];
  for (const [i, [title, off, done]] of ms1.entries()) await insert('milestones', { project_id: p1, title, due_date: d(off), done, position: i });
  for (const [title, body, off] of [
    ['Start projektu', 'Rozpoczęliśmy analizę. Zebraliśmy obecne arkusze zapotrzebowania i grafiku z obu lokali.', -42],
    ['Specyfikacja zaakceptowana', 'Zakres, role (właściciel, manager lokalu, pracownik) i harmonogram zostały zatwierdzone. Dokument znajdziesz w zakładce Dokumenty.', -29],
    ['Import danych zakończony', 'Zaimportowaliśmy 214 produktów i 11 dostawców. Ceny zakupu z ostatnich 3 miesięcy są już w systemie.', -17],
    ['Grafik i czas pracy gotowe do testów', 'Moduł grafiku jest skonfigurowany dla obu lokali. Prosimy o dodanie dostępności pracowników na kolejny tydzień.', -5],
  ]) await insert('project_updates', { project_id: p1, title, body, author: 'Marek Nowak', created_at: t(off, 12) });

  const p2 = (await project({
    user_id: userId, name: 'Integracja z systemem POS', kind: 'Rozszerzenie', stage: 'analiza', progress: 15,
    description: 'Pobieranie dziennej sprzedaży z POS do raportu rentowności oraz automatyczne wyliczanie food cost.',
    modules: ['Integracja API', 'Automatyzacje', 'Raporty'], manager: 'Kasia Wiśniewska', start_date: d(-8), due_date: d(60), created_at: t(-9),
  })).id;
  for (const [i, [title, off]] of [['Analiza API dostawcy POS', 3], ['Mapowanie pozycji menu', 12], ['Prototyp raportu food cost', 30], ['Wdrożenie integracji', 60]].entries()) {
    await insert('milestones', { project_id: p2, title, due_date: d(off), done: false, position: i });
  }
  await insert('project_updates', { project_id: p2, title: 'Otrzymaliśmy dostęp testowy do API', body: 'Dziękujemy za klucze. Sprawdzamy zakres danych — w przyszłym tygodniu wrócimy z propozycją mapowania.', author: 'Kasia Wiśniewska', created_at: t(-2, 9) });

  await addTicket(userId, p1, 'Dodatkowa rola: szef kuchni', 'zmiana', 'normalny', 'oczekuje_na_klienta', [
    ['client', name, t(-4, 8), 'Czy możemy dodać rolę szefa kuchni, który zatwierdza zapotrzebowanie, ale nie widzi wyników finansowych?'],
    ['team', 'Marek Nowak', t(-3, 11), 'Jasne, to prosta zmiana w uprawnieniach. Potwierdź proszę, czy szef kuchni ma widzieć grafik całego lokalu, czy tylko kuchni?'],
  ]);
  await addTicket(userId, p1, 'Eksport grafiku do PDF', 'nowa_funkcja', 'niski', 'w_toku', [
    ['client', name, t(-9, 14), 'Chcielibyśmy drukować grafik tygodniowy i wieszać go na zapleczu.'],
    ['team', 'Marek Nowak', t(-8, 10), 'Dodamy eksport do PDF w formacie A4 poziomo. Planujemy to na etap testów.'],
  ]);
  await addTicket(userId, p1, 'Błędna jednostka przy imporcie mąki', 'blad', 'wysoki', 'rozwiazane', [
    ['client', name, t(-15, 9), 'Mąka zaimportowała się w sztukach zamiast w kilogramach.'],
    ['team', 'Marek Nowak', t(-15, 13), 'Poprawione — 6 produktów sypkich ma teraz jednostkę kg. Przeliczyliśmy też historię cen.'],
  ]);

  const ym = (off) => d(off).slice(0, 7).replace('-', '/');
  await addInv(userId, p1, -40, [{ name: 'Analiza przedwdrożeniowa i warsztat procesów', qty: 1, unit_net: 2400, vat: 23 }], true, { number: `FV/${ym(-40)}/017` });
  await addInv(userId, p1, -30, [{ name: 'Abonament Modulio Business — miesiąc 1', qty: 1, unit_net: 199, vat: 23 }, { name: 'Użytkownicy dodatkowi', qty: 4, unit_net: 15, vat: 23 }], true, { number: `FV/${ym(-30)}/021` });
  await addInv(userId, p1, -18, [{ name: 'Wdrożenie — etap 2: import danych i konfiguracja', qty: 1, unit_net: 3200, vat: 23 }], false, { number: `FV/${ym(-18)}/008` });
  await addInv(userId, p1, -2, [{ name: 'Abonament Modulio Business — miesiąc 2', qty: 1, unit_net: 199, vat: 23 }, { name: 'Użytkownicy dodatkowi', qty: 4, unit_net: 15, vat: 23 }], false, { number: `FV/${ym(-2)}/003` });

  await addDocument(userId, p1, 'Umowa wdrożeniowa', 'umowa', 'Umowa-wdrozeniowa-Modulio.pdf', 'Umowa wdrozeniowa - Modulio', ['Dokument demonstracyjny.', '', 'Strony: Modulio oraz Klient.', 'Przedmiot: wdrozenie systemu operacyjnego lokali.'], t(-41));
  await addDocument(userId, p1, 'Specyfikacja funkcjonalna v1.2', 'specyfikacja', 'Specyfikacja-v1.2.pdf', 'Specyfikacja funkcjonalna v1.2', ['Dokument demonstracyjny.', '', 'Moduly: zapotrzebowanie, grafik, czas pracy, koszty, raporty.'], t(-29));
  await addDocument(userId, p1, 'Protokół importu danych', 'protokol', 'Protokol-importu.pdf', 'Protokol importu danych', ['Dokument demonstracyjny.', '', 'Produkty: 214', 'Dostawcy: 11'], t(-17));
  await addDocument(userId, p1, 'Instrukcja dla managera lokalu', 'instrukcja', 'Instrukcja-manager.pdf', 'Instrukcja dla managera lokalu', ['Dokument demonstracyjny.', '', '1. Logowanie', '2. Zapotrzebowanie', '3. Grafik', '4. Raport tygodnia'], t(-5));
  await addDocument(userId, p2, 'Zakres integracji POS — szkic', 'specyfikacja', 'Integracja-POS-szkic.pdf', 'Zakres integracji POS - szkic', ['Dokument demonstracyjny.', '', 'Zrodlo danych: API POS', 'Cel: raport food cost'], t(-2));
  return userId;
}

// ---------------------------------------------------------------------
export async function seedPlatform() {
  const adminHash = await hashPassword('Admin1234!');
  const staffHash = await hashPassword('Zespol1234!');
  const clientHash = await hashPassword('Klient1234!');
  const phone = () => `+48 ${500 + Math.floor(rnd() * 399)} ${100 + Math.floor(rnd() * 899)} ${100 + Math.floor(rnd() * 899)}`;
  const addUser = async (email, hash, name, company, role, created) =>
    (await insert('users', newUserDoc({ email, password_hash: hash, name, company, phone: phone(), role, created_at: created, last_login_at: t(-Math.floor(rnd() * 5)) }))).id;

  if (!(await findOne('users', { email: 'admin@modulio.pl' }))) await addUser('admin@modulio.pl', adminHash, 'Gracjan', 'Modulio', 'admin', t(-400));
  const marek = await addUser('marek@modulio.pl', staffHash, 'Marek Nowak', 'Modulio', 'staff', t(-380));
  await addUser('kasia@modulio.pl', staffHash, 'Kasia Wiśniewska', 'Modulio', 'staff', t(-300));

  const companies = [
    ['Serwis Klimatyzacji Polar', 'Tomasz Zieliński', 'uslugi'], ['Przeprowadzki Ekspres', 'Paweł Wójcik', 'transport'],
    ['Studio Urody Aura', 'Magda Lewandowska', 'beauty'], ['Hurtownia Zdrowa Półka', 'Ewa Kamińska', 'handel'],
    ['Pizzeria Forno', 'Luca Rossi', 'gastro'], ['Instalbud', 'Krzysztof Mazur', 'uslugi'],
    ['TransLog Pomorze', 'Adam Krawczyk', 'transport'], ['Kawiarnia Ziarno', 'Ola Piotrowska', 'gastro'],
    ['Salon Fryzjerski Nożyczki', 'Karolina Grabowska', 'beauty'], ['Sklep Rowerowy Szprycha', 'Michał Pawlak', 'handel'],
  ];
  const clientIds = [];
  for (const [i, [company, name, slug]] of companies.entries()) {
    const monthsAgo = 11 - i;
    const created = t(-(monthsAgo * 30 + Math.floor(rnd() * 20) + 5));
    const uid = await addUser(`${slug}${i + 1}@example.com`, clientHash, name, company, 'client', created);
    clientIds.push(uid);
    const plan = pick(['Start', 'Business', 'Business', 'Custom']);
    const fee = plan === 'Start' ? 99 : plan === 'Business' ? 199 + Math.floor(rnd() * 4) * 15 : 450 + Math.floor(rnd() * 6) * 50;
    const stage = monthsAgo > 2 ? pick(['uruchomiony', 'rozwoj', 'uruchomiony']) : pick(['wdrozenie', 'testy', 'projekt']);
    const live = ['uruchomiony', 'rozwoj'].includes(stage);
    const pid = (await project({
      user_id: uid, name: `System ${company}`, kind: `Pakiet ${plan}`, stage, priority: pick(['normalny', 'wysoki', 'niski']),
      progress: live ? 100 : 30 + Math.floor(rnd() * 50), budget: 2000 + Math.floor(rnd() * 8) * 1000, description: 'Wdrożenie modułów operacyjnych.',
      modules: pick([['CRM', 'Zlecenia', 'Raporty'], ['Grafik', 'Czas pracy'], ['Magazyn', 'Dostawy', 'Raporty'], ['Wizyty', 'Klienci']]),
      manager: pick(['Marek Nowak', 'Kasia Wiśniewska']), start_date: created.slice(0, 10), due_date: d(-(monthsAgo * 30) + 60), created_at: created,
    })).id;
    await addInv(uid, pid, -(monthsAgo * 30), [{ name: 'Wdrożenie systemu — analiza i konfiguracja', qty: 1, unit_net: 1500 + Math.floor(rnd() * 10) * 250, vat: 23 }], true);
    if (live) {
      await insert('software', {
        user_id: uid, project_id: pid, name: `Modulio ${company.split(' ').slice(-1)[0]}`, plan, modules: ['CRM', 'Raporty'], monthly_fee: fee,
        users_limit: plan === 'Start' ? 3 : plan === 'Business' ? 10 : 30, url: `https://${slug}${i + 1}.app.modulio.pl`, version: `2.${Math.floor(rnd() * 5)}`,
        status: i === 9 ? 'zawieszone' : 'aktywne', started_at: d(-(monthsAgo * 30) + 30), renewal_date: d(Math.floor(rnd() * 40) + 3), created_at: created,
      });
      for (let m = monthsAgo - 1; m >= 0; m--) {
        const overdue = m === 0 && i % 4 === 0;
        await addInv(uid, pid, -(m * 30) - 2, [{ name: `Abonament Modulio ${plan} — miesiąc`, qty: 1, unit_net: fee, vat: 23 }], (!overdue && m > 0) || (m === 0 && i % 3 === 1), { forceOverdue: overdue });
      }
    }
  }

  // Projekty w kolejce „do zrobienia”
  for (const [idx, name, kind, priority, budget] of [[1, 'Moduł rezerwacji online', 'Rozszerzenie', 'wysoki', 6000], [3, 'Integracja z e-sklepem', 'Integracja', 'normalny', 4500], [6, 'Aplikacja dla kierowców', 'Custom', 'krytyczny', 18000]]) {
    await project({ user_id: clientIds[idx], name, kind, stage: 'do_zrobienia', priority, budget, description: 'Zakres zaakceptowany — czeka na rozpoczęcie prac.', manager: 'Marek Nowak', due_date: d(45 + Math.floor(rnd() * 40)), created_at: t(-Math.floor(rnd() * 10)) });
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
    const utm = ['google', 'facebook', 'polecenie'].includes(src);
    await insert('leads', {
      name: nm, email: `${nm.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.${i}@firma.pl`, phone: '+48 600 000 000',
      company: pick(['Firma Usługowa', 'Bistro', 'Hurtownia', 'Salon', 'Transport PL', '']), topic: pick(topics),
      message: 'Chcemy uporządkować zlecenia i koszty w jednym systemie. Prosimy o kontakt.', source: utm ? 'kontakt' : src, utm_source: utm ? src : '',
      status, value: [0, 2400, 4800, 9000, 15000][Math.floor(rnd() * 5)], notes: '', assigned_to: age < 40 ? marek : null, user_id: null, ip: '',
      created_at: t(-age), updated_at: t(-Math.max(0, age - 3)),
    });
  }

  // Marketing
  await insert('announcements', { title: 'Nowość: eksport raportów do Excela', body: 'W module raportów możesz teraz pobrać każde zestawienie jako plik XLSX. Zapytaj opiekuna o aktywację.', tone: 'info', active: true, starts_at: null, ends_at: null, created_at: t(-3) });
  await insert('announcements', { title: 'Prace serwisowe w niedzielę 02:00–04:00', body: 'System może być chwilowo niedostępny.', tone: 'warning', active: false, starts_at: null, ends_at: null, created_at: t(-20) });
  for (const [code, percent, description, max] of [['START10', 10, 'Rabat powitalny na wdrożenie', 0], ['POLECENIE15', 15, 'Za polecenie nowego klienta', 20], ['BLACKWEEK', 20, 'Kampania listopadowa', 50]]) {
    await insert('discount_codes', { code, percent, description, max_uses: max, used: Math.floor(rnd() * 5), active: true, expires_at: null, created_at: t(-60) });
  }
  for (let i = 0; i < 28; i++) await insert('newsletter', { email: `subskrybent${i + 1}@example.com`, source: pick(['stopka', 'stopka', 'blog']), created_at: t(-Math.floor(rnd() * 300)), unsubscribed_at: null });

  // Wpłaty dla faktur oznaczonych jako opłacone
  const paidInv = await findAll('invoices', { status: 'oplacona' });
  const havePay = new Set((await findAll('payments')).map((p) => p.invoice_id));
  for (const inv of paidInv.filter((i) => !havePay.has(i.id))) {
    const { gross } = invoiceTotals(inv.items, inv.discount_pct);
    await insert('payments', { invoice_id: inv.id, user_id: inv.user_id, amount: gross, method: pick(['przelew', 'przelew', 'blik', 'karta']), paid_at: (inv.paid_at || inv.due_date).slice(0, 10), note: '', created_at: inv.paid_at || inv.due_date });
  }
  await insert('audit_log', { user_id: null, user_name: 'system', action: 'seed', entity: 'platform', entity_id: null, details: 'Utworzono dane demonstracyjne', ip: '', created_at: nowIsoLocal() });
}
const nowIsoLocal = () => new Date().toISOString();

export async function seedIfEmpty() {
  if ((await count('users')) > 0) return false;
  await createDemoAccount();
  await seedPlatform();
  console.log('  [seed] Utworzono dane demo: klient, administrator, zespół i historia platformy.');
  return true;
}
