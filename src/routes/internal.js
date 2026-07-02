// Internt API — bruges af erlc-borgerservice til at bekraefte betaling af boeder.
// IKKE for MDT-brugere/browsere direkte — kraever INTERNAL_API_KEY i X-Internal-Key headeren.
const express = require('express');
const router = express.Router();
const db = require('../db/database');

function kraevInternAdgang(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ fejl: 'Ingen adgang' });
  }
  next();
}

// Kaldes naar en borger betaler en boede fra sin Bank-konto via erlc-borgerservice's eBoks.
// Atomisk (kun rammer raekken hvis den stadig er 'ubetalt') for at undgaa dobbelt-betaling.
router.post('/boeder/:bode_nr/betal', kraevInternAdgang, (req, res) => {
  const bode = db.prepare('SELECT * FROM boeder WHERE bode_nr = ?').get(req.params.bode_nr);
  if (!bode) return res.status(404).json({ fejl: 'Bøden findes ikke' });
  if (bode.status === 'betalt') return res.status(409).json({ fejl: 'Bøden er allerede betalt' });

  const r = db.prepare("UPDATE boeder SET status='betalt' WHERE id=? AND status='ubetalt'").run(bode.id);
  if (r.changes === 0) return res.status(409).json({ fejl: 'Bøden er allerede betalt' });

  res.json({ ok: true, beloeb: bode.beloeb });
});

module.exports = router;
