const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db/database');
const { isKlar: dbKlar } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const DISCORD_API = 'https://discord.com/api/v10';

// ── Hjælpere ──────────────────────────────────────────────────────────────────
function hashAdgangskode(plain) {
  return crypto.createHash('sha256').update(plain + process.env.JWT_SECRET).digest('hex');
}

function lavJWT(bruger) {
  return jwt.sign(
    { id: bruger.id, discord: bruger.discord_id, godkendt: bruger.godkendt === 1, er_admin: bruger.er_admin === 1, rang: bruger.rang, kaldesignal: bruger.kaldesignal },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function discordFetch(endpoint, token) {
  const { default: fetch } = await import('node-fetch');
  const r = await fetch(`${DISCORD_API}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Discord ${r.status}`);
  return r.json();
}

async function hentMedlem(discordId) {
  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch(`${DISCORD_API}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordId}`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } });
    if (!r.ok) {
      console.error('[AUTH] hentMedlem fejl:', r.status, await r.text());
      return null;
    }
    return r.json();
  } catch(e) {
    console.error('[AUTH] hentMedlem exception:', e.message);
    return null;
  }
}

function harPolitiRolle(rolleIds) {
  const politi = (process.env.DISCORD_POLITI_ROLLE_IDS || '').split(',').map(r => r.trim());
  const admin  = (process.env.DISCORD_ADMIN_ROLLE_IDS  || '').split(',').map(r => r.trim());
  const erAdmin  = rolleIds.some(id => admin.includes(id));
  const erPoliti = rolleIds.some(id => politi.includes(id)) || erAdmin;
  return { erPoliti, erAdmin };
}

// ── STEP 1: Discord verification (kun første gang) ───────────────────────────
router.get('/login', (req, res) => {
  // Gem tvang i session params
  const tvang = req.query.tvang === '1' ? '&tvang=1' : '';
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify'
  });
  const tvangParam = req.query.tvang === '1' ? '&state=tvang' : '';
  res.redirect(`https://discord.com/oauth2/authorize?${params}${tvangParam}`);
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/login?fejl=adgang_naegtede');
  if (!dbKlar()) return res.redirect('/login?fejl=server_fejl');

  try {
    const { default: fetch } = await import('node-fetch');
    const tokenSvar = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code, redirect_uri: process.env.DISCORD_REDIRECT_URI
      })
    });

    if (!tokenSvar.ok) throw new Error('Token fejl');
    const tokens = await tokenSvar.json();
    const discordBruger = await discordFetch('/users/@me', tokens.access_token);
    console.log('[AUTH] Discord bruger:', discordBruger.id, discordBruger.username);
    const medlem = await hentMedlem(discordBruger.id);
    console.log('[AUTH] Medlem:', medlem ? 'fundet' : 'ikke fundet', 'roller:', (medlem?.roles || []).length);

    if (!medlem) return res.redirect('/login?fejl=ikke_paa_serveren');

    const { erPoliti, erAdmin } = harPolitiRolle(medlem.roles || []);
    console.log('[AUTH] erPoliti:', erPoliti, 'erAdmin:', erAdmin);
    if (!erPoliti) return res.redirect('/login?fejl=ingen_rolle');

    // Tjek om brugeren allerede eksisterer med Discord
    let bruger = db.prepare('SELECT * FROM brugere WHERE discord_id = ?').get(discordBruger.id);

    if (bruger) {
      // Marker som discord-verificeret
      db.prepare('UPDATE brugere SET discord_verified = 1, discord_avatar = ?, er_admin = ? WHERE id = ?')
        .run(discordBruger.avatar, erAdmin ? 1 : 0, bruger.id);
      bruger = db.prepare('SELECT * FROM brugere WHERE id = ?').get(bruger.id);
    } else {
      // Ny bruger — opret med discord info, ikke godkendt endnu (mangler email/pw)
      const result = db.prepare(`
        INSERT INTO brugere (discord_id, discord_navn, discord_avatar, er_admin, godkendt, discord_verified)
        VALUES (?, ?, ?, ?, 1, 1)
      `).run(discordBruger.id, discordBruger.username, discordBruger.avatar, erAdmin ? 1 : 0);
      bruger = db.prepare('SELECT * FROM brugere WHERE id = ?').get(result.lastInsertRowid);
      // Opret CAB status
      db.prepare("INSERT INTO cab_status (bruger_id, status) VALUES (?, 'offline')").run(bruger.id);
    }

    // Lav et midlertidigt token til at sende discord_id videre
    const tmpToken = jwt.sign(
      { discord_id: discordBruger.id, discord_navn: discordBruger.username, discord_avatar: discordBruger.avatar, er_admin: erAdmin ? 1 : 0 },
      process.env.JWT_SECRET, { expiresIn: '10m' }
    );

    // Web-redirect: har konto → login, ny bruger → registrer med tmp token
    const harKonto = bruger.email && bruger.adgangskode;
    if (harKonto) {
      res.redirect(`/login?discord=ok`);
    } else {
      res.redirect(`/registrer?tmp=${tmpToken}`);
    }

  } catch (err) {
    console.error('[AUTH] Callback fejl:', err.message);
    console.error('[AUTH] Stack:', err.stack);
    res.redirect(`/login?fejl=${encodeURIComponent(err.message)}`);
  }
});



// ── Opret konto med email + adgangskode (efter Discord verify) ───────────────
router.post('/opret-konto', async (req, res) => {
  const { tmp_token, email, adgangskode, fornavn, efternavn, badge_nummer, kaldesignal, rang, afdeling, roblox_navn } = req.body;

  if (!tmp_token || !email || !adgangskode || !fornavn || !efternavn || !badge_nummer || !kaldesignal) {
    return res.status(400).json({ fejl: 'Alle felter er påkrævet' });
  }
  if (adgangskode.length < 6) return res.status(400).json({ fejl: 'Adgangskode skal være mindst 6 tegn' });

  let tmpData;
  try {
    tmpData = jwt.verify(tmp_token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ fejl: 'Verificeringslink udløbet — log ind med Discord igen' });
  }

  // Tjek om email er taget af EN ANDEN bruger
  const emailTaget = db.prepare('SELECT id FROM brugere WHERE email = ? AND discord_id != ?').get(email.toLowerCase().trim(), tmpData.discord_id);
  if (emailTaget) return res.status(409).json({ fejl: 'Email er allerede i brug af en anden konto' });

  // Opdater bruger med email + adgangskode + profildata
  const hash = hashAdgangskode(adgangskode);
  db.prepare(`
    UPDATE brugere SET
      email        = ?,
      adgangskode  = ?,
      fornavn      = ?,
      efternavn    = ?,
      badge_nummer = ?,
      kaldesignal  = ?,
      rang         = ?,
      afdeling     = ?
    WHERE discord_id = ?
  `).run(
    email.toLowerCase().trim(), hash,
    fornavn.trim(), efternavn.trim(),
    badge_nummer.trim().toUpperCase(), kaldesignal.trim().toUpperCase(),
    rang || 'Betjent', afdeling || 'Patrulje',
    tmpData.discord_id
  );

  const bruger = db.prepare('SELECT * FROM brugere WHERE discord_id = ?').get(tmpData.discord_id);
  const token = lavJWT(bruger);
  res.json({ besked: 'Konto oprettet', token });
});

// ── Log ind med email + adgangskode ──────────────────────────────────────────
router.post('/login-email', (req, res) => {
  const { email, adgangskode } = req.body;
  if (!email || !adgangskode) return res.status(400).json({ fejl: 'Email og adgangskode er påkrævet' });

  const bruger = db.prepare('SELECT * FROM brugere WHERE email = ?').get(email.toLowerCase().trim());
  if (!bruger) return res.status(401).json({ fejl: 'Forkert email eller adgangskode' });

  const hash = hashAdgangskode(adgangskode);
  if (bruger.adgangskode !== hash) return res.status(401).json({ fejl: 'Forkert email eller adgangskode' });
  if (!bruger.discord_verified) return res.status(403).json({ fejl: 'Konto ikke Discord-verificeret' });

  // Sæt offline ved login
  db.prepare("UPDATE cab_status SET status = 'out_of_service' WHERE bruger_id = ?").run(bruger.id);
  db.prepare("UPDATE brugere SET sidst_login = datetime('now') WHERE id = ?").run(bruger.id);

  const token = lavJWT(bruger);
  res.json({ token, bruger: { fornavn: bruger.fornavn, efternavn: bruger.efternavn, rang: bruger.rang, discord_id: bruger.discord_id, discord_avatar: bruger.discord_avatar, roblox_navn: bruger.roblox_navn } });
});

// ── Hent mig ─────────────────────────────────────────────────────────────────
router.get('/mig', requireAuth, (req, res) => {
  const bruger = db.prepare(`
    SELECT b.*, c.status as cab_status FROM brugere b
    LEFT JOIN cab_status c ON c.bruger_id = b.id WHERE b.id = ?
  `).get(req.bruger.id);
  if (!bruger) return res.status(404).json({ fejl: 'Ikke fundet' });
  res.json(bruger);
});

// ── Opdater profil ────────────────────────────────────────────────────────────
router.put('/profil', requireAuth, (req, res) => {
  const { fornavn, efternavn, badge_nummer, kaldesignal, rang, afdeling, email, ny_adgangskode, roblox_navn } = req.body;

  if (email) {
    const taget = db.prepare('SELECT id FROM brugere WHERE email = ? AND id != ?').get(email.toLowerCase(), req.bruger.id);
    if (taget) return res.status(409).json({ fejl: 'Email allerede i brug' });
  }

  const updates = [];
  const params  = [];
  if (fornavn)       { updates.push('fornavn = ?');      params.push(fornavn.trim()); }
  if (efternavn)     { updates.push('efternavn = ?');    params.push(efternavn.trim()); }
  if (badge_nummer)  { updates.push('badge_nummer = ?'); params.push(badge_nummer.toUpperCase()); }
  if (kaldesignal)   { updates.push('kaldesignal = ?');  params.push(kaldesignal.toUpperCase()); }
  if (rang)          { updates.push('rang = ?');         params.push(rang); }
  if (afdeling)      { updates.push('afdeling = ?');     params.push(afdeling); }
  if (roblox_navn !== undefined) { updates.push('roblox_navn = ?'); params.push(roblox_navn.trim() || null); }
  if (email)         { updates.push('email = ?');        params.push(email.toLowerCase()); }
  if (ny_adgangskode && ny_adgangskode.length >= 6) {
    updates.push('adgangskode = ?');
    params.push(hashAdgangskode(ny_adgangskode));
  }

  if (updates.length) {
    params.push(req.bruger.id);
    db.prepare(`UPDATE brugere SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const opdateret = db.prepare('SELECT * FROM brugere WHERE id = ?').get(req.bruger.id);
  const nytToken  = lavJWT(opdateret);
  res.json({ besked: 'Opdateret', token: nytToken, bruger: opdateret });
});

// ── Admin ─────────────────────────────────────────────────────────────────────
router.get('/brugere', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id,discord_id,discord_navn,discord_avatar,fornavn,efternavn,badge_nummer,kaldesignal,rang,afdeling,godkendt,er_admin,email,oprettet,sidst_login FROM brugere ORDER BY oprettet DESC').all());
});

router.put('/brugere/:id/godkend', requireAuth, requireAdmin, (req, res) => {
  db.prepare('UPDATE brugere SET godkendt = ? WHERE id = ?').run(req.body.godkendt, req.params.id);
  res.json({ besked: 'Opdateret' });
});

router.put('/brugere/:id/rang', requireAuth, requireAdmin, (req, res) => {
  db.prepare('UPDATE brugere SET rang = ? WHERE id = ?').run(req.body.rang, req.params.id);
  res.json({ besked: 'Rang opdateret' });
});

module.exports = router;
