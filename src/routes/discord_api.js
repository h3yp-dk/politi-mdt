const express = require('express');
const router  = express.Router();
const { requireAuth, requireGodkendt } = require('../middleware/auth');
const { hentBeskeder, postEfterlyst } = require('./discord');
const db = require('../db/database');

// ── Hent Discord kanal beskeder ───────────────────────────────────────────────
router.get('/boeder', requireAuth, requireGodkendt, async (req, res) => {
  const msgs = await hentBeskeder(process.env.DISCORD_BOEDE_KANAL_ID, 30);
  res.json(msgs);
});

router.get('/rapporter', requireAuth, requireGodkendt, async (req, res) => {
  const msgs = await hentBeskeder(process.env.DISCORD_RAPPORT_KANAL_ID, 30);
  res.json(msgs);
});

router.get('/efterlyste', requireAuth, requireGodkendt, async (req, res) => {
  const msgs = await hentBeskeder(process.env.DISCORD_EFTERLYST_KANAL_ID, 30);
  res.json(msgs);
});

// ── Opret efterlyst ───────────────────────────────────────────────────────────
router.post('/efterlyst', requireAuth, requireGodkendt, async (req, res) => {
  const { navn, toej, sigtet_for, vaaben, andet, farlighedsgrad } = req.body;
  if (!navn || !sigtet_for) {
    return res.status(400).json({ fejl: 'Navn og sigtelsesgrund er påkrævet' });
  }

  const bruger = db.prepare('SELECT * FROM brugere WHERE id = ?').get(req.bruger.id);
  const betjentNavn = `${bruger.rang} ${bruger.fornavn} ${bruger.efternavn} [${bruger.badge_nummer}]`;

  const msgId = await postEfterlyst({
    navn, toej, sigtet_for, vaaben, andet,
    farlighedsgrad: farlighedsgrad || 'lav',
    betjent_navn: betjentNavn
  });

  res.json({ besked: 'Efterlysning oprettet på Discord', discord_msg_id: msgId });
});

module.exports = router;
