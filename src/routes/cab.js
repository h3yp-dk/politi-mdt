const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireGodkendt } = require('../middleware/auth');

const GYLDIGE_STATUSSER = [
  'offline',
  'patrulje',
  'tilgaengelig',
  'optaget',
  'eftersaettelse',
  'utilgaengelig',
  'out_of_service'
];

const STATUS_LABELS = {
  offline:         'Offline',
  patrulje:        'På Patrulje',
  tilgaengelig:    'Tilgængelig',
  optaget:         'Optaget',
  eftersaettelse:  'Aktiv Eftersættelse',
  utilgaengelig:   'Utilgængelig',
  out_of_service:  'Out of Service'
};

// Hent alle aktive enheder (ikke offline eller out_of_service)
router.get('/', requireAuth, requireGodkendt, (req, res) => {
  // Sæt til out_of_service hvis ingen aktivitet i 1 time
  db.prepare(`
    UPDATE cab_status
    SET status = 'out_of_service'
    WHERE status NOT IN ('offline', 'out_of_service')
    AND opdateret < datetime('now', '-1 hours')
  `).run();

  const enheder = db.prepare(`
    SELECT
      b.id, b.fornavn, b.efternavn, b.badge_nummer,
      b.kaldesignal, b.rang, b.afdeling, b.discord_avatar,
      c.status, c.opdateret
    FROM brugere b
    JOIN cab_status c ON c.bruger_id = b.id
    WHERE b.godkendt = 1
    AND c.status NOT IN ('offline', 'out_of_service')
    ORDER BY
      CASE c.status
        WHEN 'eftersaettelse' THEN 0
        WHEN 'optaget'        THEN 1
        WHEN 'patrulje'       THEN 2
        WHEN 'tilgaengelig'   THEN 3
        WHEN 'utilgaengelig'  THEN 4
        ELSE 5
      END,
      b.rang, b.kaldesignal
  `).all();

  res.json(enheder.map(e => ({
    ...e,
    status_label: STATUS_LABELS[e.status] || e.status
  })));
});

// Opdater din egen status
router.put('/status', requireAuth, requireGodkendt, (req, res) => {
  const { status } = req.body;
  if (!GYLDIGE_STATUSSER.includes(status)) {
    return res.status(400).json({
      fejl: `Ugyldig status. Gyldige: ${GYLDIGE_STATUSSER.join(', ')}`
    });
  }

  const eksist = db.prepare('SELECT bruger_id FROM cab_status WHERE bruger_id = ?').get(req.bruger.id);
  if (eksist) {
    db.prepare(`UPDATE cab_status SET status = ?, opdateret = datetime('now') WHERE bruger_id = ?`).run(status, req.bruger.id);
  } else {
    db.prepare(`INSERT INTO cab_status (bruger_id, status, opdateret) VALUES (?, ?, datetime('now'))`).run(req.bruger.id, status);
  }

  const bruger = db.prepare(`
    SELECT b.id, b.fornavn, b.efternavn, b.badge_nummer,
           b.kaldesignal, b.rang, b.afdeling, c.status
    FROM brugere b
    JOIN cab_status c ON c.bruger_id = b.id
    WHERE b.id = ?
  `).get(req.bruger.id);

  const { broadcast } = require('../websocket');
  broadcast('cab_opdatering', {
    ...bruger,
    status_label: STATUS_LABELS[status]
  });

  res.json({ besked: 'Status opdateret', status, status_label: STATUS_LABELS[status] });
});

// Hent alle gyldige statusser
router.get('/statusser', requireAuth, (req, res) => {
  res.json(GYLDIGE_STATUSSER.map(s => ({ vaerdi: s, label: STATUS_LABELS[s] })));
});

module.exports = router;
