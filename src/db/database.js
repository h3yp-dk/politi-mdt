const path = require('path');
const fs   = require('fs');

const dbDir  = path.resolve(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : './data');
const dbFile = path.resolve(process.env.DB_PATH || './data/mdt.db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let db;

function init() {
  const initSqlJs = require('sql.js');
  return initSqlJs().then(SQL => {
    if (fs.existsSync(dbFile)) {
      db = new SQL.Database(fs.readFileSync(dbFile));
      console.log('[DB] Eksisterende database indlæst ✓');
    } else {
      db = new SQL.Database();
      console.log('[DB] Ny database oprettet ✓');
    }
    opretTabeller();
    indsaetParagraffer();
    setInterval(gemTilDisk, 10000);
    process.on('exit',    gemTilDisk);
    process.on('SIGINT',  () => { gemTilDisk(); process.exit(); });
    process.on('SIGTERM', () => { gemTilDisk(); process.exit(); });
    // Tilføj nye kolonner hvis de ikke eksisterer (migration)
  try { db.prepare("ALTER TABLE brugere ADD COLUMN email TEXT").run(); } catch {}
  try { db.prepare("ALTER TABLE brugere ADD COLUMN adgangskode TEXT").run(); } catch {}
  try { db.prepare("ALTER TABLE brugere ADD COLUMN discord_verified INTEGER DEFAULT 0").run(); } catch {}
  try { db.prepare("ALTER TABLE brugere ADD COLUMN roblox_navn TEXT").run(); } catch {}

  // Rapporter — nye kolonner (migration, fejler ikke hvis de allerede eksisterer)
  try { db.prepare("ALTER TABLE rapporter ADD COLUMN tiltalepunkter TEXT DEFAULT '[]'").run(); } catch {}
  try { db.prepare("ALTER TABLE rapporter ADD COLUMN citations TEXT DEFAULT '[]'").run(); } catch {}
  try { db.prepare("ALTER TABLE rapporter ADD COLUMN mistankt TEXT DEFAULT '{}'").run(); } catch {}
  try { db.prepare("ALTER TABLE rapporter ADD COLUMN medical TEXT DEFAULT '{}'").run(); } catch {}
  try { db.prepare("ALTER TABLE rapporter ADD COLUMN transport TEXT DEFAULT '{}'").run(); } catch {}
  try { db.prepare("ALTER TABLE rapporter ADD COLUMN noter TEXT").run(); } catch {}
  try { db.prepare("ALTER TABLE rapporter ADD COLUMN betjente TEXT DEFAULT '[]'").run(); } catch {}

  // Boeder — discord_id (kraevet af CPR-opslag) + kilde-spor for boeder der er
  // auto-oprettet fra en anholdelse eller rapport (i stedet for "Boeder"-siden direkte)
  try { db.prepare("ALTER TABLE boeder ADD COLUMN discord_id TEXT").run(); } catch {}
  try { db.prepare("ALTER TABLE boeder ADD COLUMN kilde_type TEXT DEFAULT 'boede'").run(); } catch {}
  try { db.prepare("ALTER TABLE boeder ADD COLUMN kilde_id INTEGER").run(); } catch {}
  try { db.prepare("ALTER TABLE boeder ADD COLUMN eboks_sendt INTEGER DEFAULT 0").run(); } catch {}

  // Anholdelser/rapporter — discord_id kraevet af CPR-opslag
  try { db.prepare("ALTER TABLE anholdelser ADD COLUMN discord_id TEXT").run(); } catch {}
  try { db.prepare("ALTER TABLE rapporter ADD COLUMN discord_id TEXT").run(); } catch {}

  console.log('[DB] Database klar ✓');
  });
}

function gemTilDisk() {
  if (!db) return;
  try { fs.writeFileSync(dbFile, Buffer.from(db.export())); } catch {}
}

function flatP(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function isKlar() { return !!db; }

function prepare(sql) {
  if (!db) throw new Error('Database ikke initialiseret endnu — vent på initDB()');
  return {
    run(...params) {
      try {
        db.run(sql, flatP(params));
        const r = db.exec('SELECT last_insert_rowid() as id');
        return { lastInsertRowid: r[0]?.values[0]?.[0] ?? null, changes: db.getRowsModified() };
      } catch(e) { console.error('[DB run]', e.message, sql); throw e; }
    },
    get(...params) {
      try {
        const s = db.prepare(sql);
        s.bind(flatP(params));
        const row = s.step() ? s.getAsObject() : undefined;
        s.free();
        return row;
      } catch(e) { console.error('[DB get]', e.message, sql); throw e; }
    },
    all(...params) {
      try {
        const res = db.exec(sql, flatP(params));
        if (!res.length) return [];
        const { columns, values } = res[0];
        return values.map(r => Object.fromEntries(columns.map((c,i) => [c, r[i]])));
      } catch(e) { console.error('[DB all]', e.message, sql); throw e; }
    }
  };
}

function exec(sql) { db.run(sql); }

function transaction(fn) {
  return () => {
    db.run('BEGIN');
    try { fn(); db.run('COMMIT'); }
    catch(e) { db.run('ROLLBACK'); throw e; }
  };
}

function opretTabeller() {
  db.run(`
    CREATE TABLE IF NOT EXISTS brugere (
      id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT UNIQUE NOT NULL,
      discord_navn TEXT NOT NULL, discord_avatar TEXT,
      fornavn TEXT, efternavn TEXT, badge_nummer TEXT, kaldesignal TEXT,
      rang TEXT DEFAULT 'Betjent', afdeling TEXT DEFAULT 'Patrulje',
      godkendt INTEGER DEFAULT 0, er_admin INTEGER DEFAULT 0,
      oprettet TEXT DEFAULT (datetime('now')), sidst_login TEXT
    );
    CREATE TABLE IF NOT EXISTS cab_status (
      bruger_id INTEGER PRIMARY KEY, status TEXT DEFAULT 'offline',
      opdateret TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS personer (
      id INTEGER PRIMARY KEY AUTOINCREMENT, roblox_navn TEXT NOT NULL,
      roblox_id TEXT, koerekort INTEGER DEFAULT 1, koerekort_noter TEXT,
      farlig INTEGER DEFAULT 0, farlig_note TEXT, antal_kontakter INTEGER DEFAULT 0,
      oprettet_af INTEGER, oprettet TEXT DEFAULT (datetime('now')),
      opdateret TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS koeretoejer (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nummerplade TEXT UNIQUE NOT NULL,
      ejer_navn TEXT, ejer_roblox_id TEXT, maerke TEXT, model TEXT, farve TEXT, aar TEXT,
      status TEXT DEFAULT 'normal', forsikring INTEGER DEFAULT 1, registrering INTEGER DEFAULT 1,
      noter TEXT, oprettet_af INTEGER, oprettet TEXT DEFAULT (datetime('now')),
      opdateret TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS boeder (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bode_nr TEXT UNIQUE NOT NULL,
      borger_navn TEXT NOT NULL, roblox_id TEXT, udstedt_af_id INTEGER,
      udstedt_af_navn TEXT, beloeb INTEGER NOT NULL, paragraffer TEXT NOT NULL,
      beskrivelse TEXT, lokation TEXT, nummerplade TEXT, status TEXT DEFAULT 'ubetalt',
      discord_msg_id TEXT, discord_thread_id TEXT, oprettet TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS anholdelser (
      id INTEGER PRIMARY KEY AUTOINCREMENT, rapport_nr TEXT UNIQUE NOT NULL,
      anholdt_navn TEXT NOT NULL, roblox_id TEXT, betjent_id INTEGER, betjent_navn TEXT,
      anklage_punkter TEXT NOT NULL, beskrivelse TEXT NOT NULL, lokation TEXT,
      vaaben_fundet INTEGER DEFAULT 0, stoffer_fundet INTEGER DEFAULT 0,
      faengsel_tid TEXT, boede_beloeb INTEGER DEFAULT 0, retssag_id INTEGER,
      status TEXT DEFAULT 'aktiv', discord_thread_id TEXT, oprettet TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS rapporter (
      id INTEGER PRIMARY KEY AUTOINCREMENT, rapport_nr TEXT UNIQUE NOT NULL,
      titel TEXT, type TEXT NOT NULL, beskrivelse TEXT,
      lokation TEXT, involverede TEXT DEFAULT '[]', oprettet_af_id INTEGER,
      oprettet_af_navn TEXT, status TEXT DEFAULT 'kladde', discord_thread_id TEXT,
      tiltalepunkter TEXT DEFAULT '[]', citations TEXT DEFAULT '[]',
      mistankt TEXT DEFAULT '{}', medical TEXT DEFAULT '{}',
      transport TEXT DEFAULT '{}', noter TEXT, betjente TEXT DEFAULT '[]',
      oprettet TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS retssager (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sags_nr TEXT UNIQUE NOT NULL,
      tiltalte_navn TEXT NOT NULL, roblox_id TEXT, anklager_id INTEGER, anklager_navn TEXT,
      forsvarer TEXT, tiltale_punkter TEXT NOT NULL, kendsgerninger TEXT, beviser TEXT,
      dom TEXT, straf TEXT, status TEXT DEFAULT 'afventer', discord_thread_id TEXT,
      oprettet TEXT DEFAULT (datetime('now')), afgjort TEXT
    );
    CREATE TABLE IF NOT EXISTS noedopkald (
      id INTEGER PRIMARY KEY AUTOINCREMENT, erlc_id TEXT UNIQUE, team TEXT,
      beskrivelse TEXT, lokation TEXT, postal TEXT, koordinat_x REAL, koordinat_z REAL,
      tildelt_til INTEGER, status TEXT DEFAULT 'nyt', oprettet TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS paragraffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kode TEXT UNIQUE NOT NULL, navn TEXT NOT NULL,
      beskrivelse TEXT, min_boede INTEGER DEFAULT 0, max_boede INTEGER DEFAULT 0,
      faengsel INTEGER DEFAULT 0, kategori TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_boeder_borger     ON boeder(borger_navn);
    CREATE INDEX IF NOT EXISTS idx_anholdelser_navn  ON anholdelser(anholdt_navn);
    CREATE INDEX IF NOT EXISTS idx_koeretoejer_plade ON koeretoejer(nummerplade);
    CREATE INDEX IF NOT EXISTS idx_personer_navn     ON personer(roblox_navn);
  `);
}

function indsaetParagraffer() {
  const r = db.exec("SELECT COUNT(*) as n FROM paragraffer");
  if ((r[0]?.values[0]?.[0] || 0) > 0) return;
  const p = [
    ['§ 1.1','Hastighedsoverskridelse (let)',  'Op til 20 km/t over grænsen',         1000, 3000,0,'Trafik'],
    ['§ 1.2','Hastighedsoverskridelse (grov)', 'Over 20 km/t over grænsen',            3000, 8000,0,'Trafik'],
    ['§ 1.3','Kørsel mod rødt lys',            'Kørsel mod rødt lys i kryds',          2000, 4000,0,'Trafik'],
    ['§ 1.4','Ulovlig parkering',              'Parkering på forbudt område',            500, 1500,0,'Trafik'],
    ['§ 1.5','Farlig kørsel',                  'Kørsel der bringer andres liv i fare', 4000,10000,0,'Trafik'],
    ['§ 1.6','Spirituskørsel',                 'Kørsel under påvirkning',              5000,15000,1,'Trafik'],
    ['§ 1.7','Uregistreret køretøj',           'Kørsel i uregistreret køretøj',        3000, 7000,0,'Trafik'],
    ['§ 1.8','Kørsel uden kørekort',           'Kørsel uden gyldigt kørekort',         3000, 8000,0,'Trafik'],
    ['§ 2.1','Simpel vold',                    'Vold mod person',                      5000,15000,1,'Vold'],
    ['§ 2.2','Grov vold',                      'Grov vold med skade til følge',       10000,30000,1,'Vold'],
    ['§ 2.3','Vold mod tjenestemand',          'Vold mod betjent i tjeneste',         15000,50000,1,'Vold'],
    ['§ 3.1','Tyveri',                         'Tyveri af ejendom',                    3000,10000,1,'Kriminalitet'],
    ['§ 3.2','Røveri',                         'Røveri med vold/trussel',             10000,40000,1,'Kriminalitet'],
    ['§ 3.3','Indbrud',                        'Ulovlig indtrængen med tyveri',        8000,25000,1,'Kriminalitet'],
    ['§ 3.4','Hærværk',                        'Beskadigelse af ejendom',              2000, 8000,0,'Kriminalitet'],
    ['§ 4.1','Ulovlig våbenbesiddelse',        'Besiddelse af ulovligt våben',         8000,25000,1,'Våben'],
    ['§ 4.2','Skydning fra køretøj',          'Skydning fra kørende køretøj',        15000,50000,1,'Våben'],
    ['§ 4.3','Trusler med våben',             'Trussel om vold med våben',             8000,20000,1,'Våben'],
    ['§ 5.1','Flugt fra politiet (til fods)', 'Undvigelse fra politiet',               5000,12000,1,'Flugt'],
    ['§ 5.2','Politiflugt (køretøj)',         'Flugt fra politiet i køretøj',          8000,20000,1,'Flugt'],
    ['§ 6.1','Narkotikabesiddelse',           'Besiddelse af ulovlige stoffer',         5000,20000,1,'Narkotika'],
    ['§ 6.2','Narkotikahandel',              'Salg af ulovlige stoffer',              20000,60000,1,'Narkotika'],
    ['§ 7.1','Forstyrrelse af offentlig ro', 'Larm og uro på offentlig sted',           500, 3000,0,'Orden'],
    ['§ 7.2','Chikane',                      'Chikane af borger eller betjent',        2000, 6000,0,'Orden'],
  ];
  db.run('BEGIN');
  for (const row of p) {
    db.run('INSERT OR IGNORE INTO paragraffer (kode,navn,beskrivelse,min_boede,max_boede,faengsel,kategori) VALUES (?,?,?,?,?,?,?)', row);
  }
  db.run('COMMIT');
  console.log('[DB] Standard paragraffer indsat ✓');
}

module.exports = { init, prepare, exec, transaction, gemTilDisk, isKlar };
