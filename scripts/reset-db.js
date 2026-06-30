/**
 * Database reset — sletter alle data UNDTAGEN brugere og paragraffer.
 * Bruges til fresh release eller test-reset.
 *
 * Kør:  node scripts/reset-db.js
 * (På Railway: åbn Shell i dashboardet og kør kommandoen)
 */

require('dotenv').config();
const path   = require('path');
const fs     = require('fs');
const initSqlJs = require('sql.js');

const dbFile = path.resolve(process.env.DB_PATH || './data/mdt.db');

if (!fs.existsSync(dbFile)) {
  console.error('Database ikke fundet:', dbFile);
  process.exit(1);
}

const TABELLER = [
  'rapporter',
  'boeder',
  'anholdelser',
  'retssager',
  'personer',
  'koeretoejer',
  'noedopkald',
  'cab_status',
];

initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(dbFile));

  console.log('\n=== POLITI MDT DATABASE RESET ===\n');

  let total = 0;
  for (const tabel of TABELLER) {
    try {
      const foer = db.exec(`SELECT COUNT(*) FROM ${tabel}`)[0]?.values[0]?.[0] || 0;
      db.run(`DELETE FROM ${tabel}`);
      console.log(`✓ ${tabel.padEnd(20)} — ${foer} rækker slettet`);
      total += Number(foer);
    } catch (e) {
      console.warn(`  ${tabel}: ${e.message}`);
    }
  }

  // Gem til disk
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
  db.close();

  console.log(`\nFærdig — ${total} rækker slettet i alt`);
  console.log('Brugere og paragraffer er bevaret.\n');
  console.log('Genstart serveren for at aktivere ændringerne.\n');
});
