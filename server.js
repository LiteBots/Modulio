'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(__dirname, 'data')
);

const INDEX_FILE = path.join(__dirname, 'index.html');
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

// Chroni przed równoczesną wysyłką tego samego zgłoszenia.
const active = new Set();

function reply(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', chunk => {
      size += chunk.length;

      if (size > 32768) {
        reject(
          Object.assign(
            new Error('Formularz jest zbyt duży.'),
            { status: 413 }
          )
        );
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        resolve(
          JSON.parse(Buffer.concat(chunks).toString('utf8'))
        );
      } catch {
        reject(
          Object.assign(
            new Error('Nieprawidłowe dane JSON.'),
            { status: 400 }
          )
        );
      }
    });

    req.on('error', reject);
  });
}

function validate(body) {
  const fail = message => {
    throw Object.assign(new Error(message), { status: 400 });
  };

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    fail('Nieprawidłowy formularz.');
  }

  const d = {};

  for (const key of [
    'id',
    'name',
    'email',
    'phone',
    'industry',
    'description'
  ]) {
    if (typeof body[key] !== 'string') {
      fail('Uzupełnij wszystkie pola.');
    }

    d[key] = body[key].trim();
  }

  d.id = d.id.toLowerCase();

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  if (!uuidPattern.test(d.id)) {
    fail('Nieprawidłowy identyfikator.');
  }

  d.budget = body.budget;

  if (
    !Number.isInteger(d.budget) ||
    d.budget < 500 ||
    d.budget > 1000000
  ) {
    fail('Budżet musi wynosić od 500 do 1 000 000 zł.');
  }

  if (d.name.length < 2 || d.name.length > 150) {
    fail('Wpisz imię i nazwisko lub nazwę firmy.');
  }

  if (d.industry.length < 2 || d.industry.length > 100) {
    fail('Wybierz branżę.');
  }

  if (
    d.description.length < 20 ||
    d.description.length > 5000
  ) {
    fail('Opis musi mieć od 20 do 5000 znaków.');
  }

  if (
    d.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)
  ) {
    fail('Podaj poprawny e-mail.');
  }

  if (
    !/^[+0-9 ()-]{7,25}$/.test(d.phone) ||
    d.phone.replace(/\D/g, '').length < 7
  ) {
    fail('Podaj poprawny numer telefonu.');
  }

  return d;
}

// Zapis zgłoszenia na dysku, poza plikami dostępnymi publicznie.
async function save(record) {
  const file = path.join(DATA_DIR, record.id + '.json');
  const temporary = file + '.' + randomUUID() + '.tmp';

  try {
    await fs.writeFile(
      temporary,
      JSON.stringify(record, null, 2),
      { mode: 0o600 }
    );

    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function notifyDiscord(record) {
  const d = record.data;

  const url = new URL(WEBHOOK);
  url.searchParams.set('wait', 'true');

  const contactDeadline = new Date(
    new Date(record.createdAt).getTime() + 48 * 3600000
  ).toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw'
  });

  const embeds = [
    {
      title: 'Nowe zgłoszenie — Modulio',
      color: 15553067,
      description: d.description.slice(0, 3500),
      fields: [
        {
          name: 'Klient / firma',
          value: d.name
        },
        {
          name: 'Budżet',
          value: d.budget.toLocaleString('pl-PL') + ' zł',
          inline: true
        },
        {
          name: 'Branża',
          value: d.industry,
          inline: true
        },
        {
          name: 'E-mail',
          value: d.email,
          inline: true
        },
        {
          name: 'Telefon',
          value: d.phone,
          inline: true
        },
        {
          name: 'Kontakt do',
          value: contactDeadline + ' (czas polski)'
        }
      ],
      timestamp: record.createdAt,
      footer: {
        text: 'ID zgłoszenia: ' + record.id
      }
    }
  ];

  // Długi opis trafia w całości, bez ucinania.
  if (d.description.length > 3500) {
    embeds.push({
      title: 'Opis projektu — ciąg dalszy',
      description: d.description.slice(3500),
      color: 15553067
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'Modulio · Zgłoszenia',
      allowed_mentions: {
        parse: []
      },
      embeds
    }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error'
  });

  if (!response.ok) {
    throw new Error('Discord nie przyjął wiadomości.');
  }
}

async function handler(req, res) {
  try {
    const pathname = new URL(
      req.url,
      'http://localhost'
    ).pathname;

    // Udostępniamy wyłącznie HTML, nie cały katalog projektu.
    if (
      req.method === 'GET' &&
      (pathname === '/' || pathname === '/index.html')
    ) {
      const html = await fs.readFile(INDEX_FILE);

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      });

      return res.end(html);
    }

    if (req.method === 'GET' && pathname === '/health') {
      return reply(res, 200, { ok: true });
    }

    if (
      req.method !== 'POST' ||
      pathname !== '/api/enquiries'
    ) {
      return reply(res, 404, {
        error: 'Nie znaleziono strony.'
      });
    }

    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return reply(res, 403, {
        error: 'Niedozwolone źródło zgłoszenia.'
      });
    }

    if (
      !req.headers['content-type']
        ?.toLowerCase()
        .startsWith('application/json')
    ) {
      return reply(res, 415, {
        error: 'Wymagany format JSON.'
      });
    }

    const data = validate(await readBody(req));

    if (active.has(data.id)) {
      return reply(res, 409, {
        error:
          'Zgłoszenie jest wysyłane. ' +
          'Poczekaj chwilę i spróbuj ponownie.'
      });
    }

    active.add(data.id);

    try {
      const file = path.join(DATA_DIR, data.id + '.json');
      let record;

      try {
        record = JSON.parse(
          await fs.readFile(file, 'utf8')
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      if (
        record &&
        Object.keys(data).some(
          key => data[key] !== record.data[key]
        )
      ) {
        return reply(res, 409, {
          error:
            'Dane zostały zmienione. ' +
            'Kliknij ponownie Wyślij zgłoszenie.',
          resetId: true
        });
      }

      // Poprzednia próba zakończyła się sukcesem.
      if (record?.sentAt) {
        return reply(res, 200, { id: data.id });
      }

      if (!record) {
        record = {
          id: data.id,
          data,
          createdAt: new Date().toISOString(),
          sentAt: null
        };

        await save(record);
      }

      try {
        await notifyDiscord(record);
      } catch {
        return reply(res, 503, {
          error:
            'Zapisaliśmy zgłoszenie, ale nie udało się ' +
            'przekazać go na Discorda. Spróbuj wysłać ponownie.'
        });
      }

      record.sentAt = new Date().toISOString();
      await save(record);

      return reply(res, 201, {
        id: record.id
      });
    } finally {
      active.delete(data.id);
    }
  } catch (error) {
    if (!error.status) {
      console.error(
        'Błąd obsługi zgłoszenia:',
        error.code || 'SERVER_ERROR'
      );
    }

    if (!res.headersSent) {
      reply(res, error.status || 500, {
        error: error.status
          ? error.message
          : 'Błąd serwera. Dane pozostały w formularzu. ' +
            'Spróbuj ponownie.'
      });
    }
  }
}

async function start(port = PORT) {
  let url;

  try {
    url = new URL(WEBHOOK);
  } catch {
    throw new Error(
      'Ustaw DISCORD_WEBHOOK_URL w zmiennych środowiskowych.'
    );
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'discord.com' ||
    !/^\/api\/webhooks\/\d+\/[^/]+$/.test(url.pathname)
  ) {
    throw new Error(
      'DISCORD_WEBHOOK_URL musi być poprawnym webhookiem Discorda.'
    );
  }

  await fs.access(INDEX_FILE);

  await fs.mkdir(DATA_DIR, {
    recursive: true,
    mode: 0o700
  });

  const server = http.createServer(handler);

  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });

  return server;
}

if (require.main === module) {
  start()
    .then(() => {
      console.log('Modulio działa na porcie ' + PORT);
    })
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { start };
