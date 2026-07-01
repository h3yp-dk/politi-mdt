const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireGodkendt } = require('../middleware/auth');
const { broadcast } = require('../websocket');

// Cache for at undgå for mange API-kald
let cache = null;
let sidstHentet = 0;
const CACHE_TID = 3000;

// Ryd cache ved opstart så vi altid henter friske data
setTimeout(() => { cache = null; sidstHentet = 0; }, 100);

async function hentERLC() {
  const nu = Date.now();
  if (cache && nu - sidstHentet < CACHE_TID) return cache;

  const { default: fetch } = await import('node-fetch');
  const r = await fetch(
    'https://api.policeroleplay.community/v2/server?Players=true&EmergencyCalls=true&Vehicles=true',
    { headers: { 'Server-Key': process.env.ERLC_SERVER_KEY } }
  );
  if (!r.ok) throw new Error(`ER:LC API: ${r.status}`);
  cache = await r.json();
  sidstHentet = nu;
  return cache;
}

// Live server data — kun politi-teamet
router.get('/live', requireAuth, requireGodkendt, async (req, res) => {
  try {
    const data = await hentERLC();

    // Send alle ikke-civile spillere - frontend bestemmer hvem der vises
    const civileTeams = ['civilian', 'civile', 'civilians', 'civ'];
    const alleIkkeCivile = (data.Players || []).filter(p => {
      const team = (p.Team || '').toLowerCase().trim();
      return team && !civileTeams.some(c => team.includes(c));
    });

    // Politi-teams til kortet (bredt filter)
    // Kun 'Police' teamet - præcis match
    const politiEnheder = alleIkkeCivile.filter(p => p.Team === 'Police');

    // Hvis ingen matcher politi-filter, vis alle ikke-civile (fallback)
    const visEnheder = politiEnheder.length > 0 ? politiEnheder : alleIkkeCivile;

    // Log faktiske teamnavne for kalibrering
    const unikeTeams = [...new Set((data.Players||[]).map(p => p.Team).filter(Boolean))];
    console.log(`[ER:LC] Teams på serveren:`, unikeTeams);
    console.log(`[ER:LC] Spillere total: ${(data.Players||[]).length}, ikke-civile: ${alleIkkeCivile.length}, politi: ${politiEnheder.length}`);

    const alleOpkald = data.EmergencyCalls || [];
    // Kun opkald til politiet — ikke Fire/EMS/DOT
    const ikkePoliti = ['fire', 'ems', 'dot', 'medical', 'ambulance'];
    const politiOpkald = alleOpkald.filter(o => {
      const team = (o.Team || '').toLowerCase();
      return !ikkePoliti.some(t => team.includes(t));
    });
    console.log('[ERLC] Opkald total:', alleOpkald.length, '→ politiopkald:', politiOpkald.length);

    res.json({
      server: {
        navn:     data.Name,
        spillere: data.CurrentPlayers,
        max:      data.MaxPlayers,
        joinKey:  data.JoinKey
      },
      politi:      visEnheder,
      alleSpillere: alleIkkeCivile,
      noedopkald:  politiOpkald
    });
  } catch (err) {
    res.status(503).json({ fejl: 'Kan ikke nå ER:LC — tjek Server-Key i .env' });
  }
});

// Kortbillede proxy (undgår CORS i Electron)
router.get('/kort/:navn', async (req, res) => {
  const gyldige = ['fall_blank', 'fall_postals', 'snow_blank', 'snow_postals'];
  if (!gyldige.includes(req.params.navn)) {
    return res.status(400).send('Ugyldigt kortnavn');
  }
  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch(
      `https://api.policeroleplay.community/maps/${req.params.navn}.png`
    );
    if (!r.ok) return res.status(r.status).send('Kort utilgængeligt');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    r.body.pipe(res);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Cache for Roblox→registreret-opslag mod Bilregisteret (erlc-borgerservice)
const registreretCache = new Map(); // roblox_navn (lowercase) -> { registreret: bool, tid: number }
const REGISTRERET_CACHE_TID = 15000;

async function erRegistreret(robloxNavn) {
  const key = (robloxNavn || '').toLowerCase().trim();
  if (!key) return null; // ukendt ejer — kan ikke afgøres

  const cached = registreretCache.get(key);
  const nu = Date.now();
  if (cached && nu - cached.tid < REGISTRERET_CACHE_TID) return cached.registreret;

  const url = process.env.ERLC_BORGERSERVICE_URL;
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!url || !apiKey) return null; // broen er ikke konfigureret — kan ikke afgøres

  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch(
      `${url.replace(/\/$/, '')}/api/bilregister/internt/opslag/${encodeURIComponent(robloxNavn)}`,
      { headers: { 'X-Internal-Key': apiKey } }
    );
    if (!r.ok) return null;
    const koeretoejer = await r.json();
    const registreret = Array.isArray(koeretoejer) && koeretoejer.length > 0;
    registreretCache.set(key, { registreret, tid: nu });
    return registreret;
  } catch {
    return null;
  }
}

// Hent spawned køretøjer fra serveren — flagger uregistrerede mod Bilregisteret
router.get('/koertojer', requireAuth, requireGodkendt, async (req, res) => {
  try {
    // Tving frisk hentning ved køretøjsopslag
    cache = null; sidstHentet = 0;
    const data = await hentERLC();
    const vehicles = data.Vehicles || [];
    console.log(`[ER:LC] Køretøjer hentet: ${vehicles.length}`, vehicles.slice(0,3).map(v => v.Plate));

    const berigede = await Promise.all(vehicles.map(async v => {
      const registreret = await erRegistreret(v.Owner);
      return { ...v, registreret };
    }));

    res.json(berigede);
  } catch (err) {
    console.error('[ER:LC] Køretøj fejl:', err.message);
    res.status(503).json({ fejl: 'Kan ikke hente køretøjer' });
  }
});

// ── Nødopkald polling ─────────────────────────────────────────────────────────
const setteOpkald = new Set();

async function pollNoedopkald() {
  try {
    const data = await hentERLC();
    const opkald = data.EmergencyCalls || [];

    for (const o of opkald) {
      const unikId = `${o.CallNumber}-${o.StartedAt}`;
      if (setteOpkald.has(unikId)) continue;
      setteOpkald.add(unikId);

      // Gem i DB
      try {
        db.prepare(`
          INSERT OR IGNORE INTO noedopkald
            (erlc_id, team, beskrivelse, lokation, koordinat_x, koordinat_z)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          unikId,
          o.Team || '',
          o.Description || '',
          o.PositionDescriptor || '',
          o.Position?.[0] || null,
          o.Position?.[1] || null
        );
      } catch {}

      // Broadcast til alle tilsluttede klienter
      // Kun send nødopkald der er relevante for politiet
      // Skip ikke-politiopkald
      const ikkePoliti2 = ['fire', 'ems', 'dot', 'medical', 'ambulance'];
      if (ikkePoliti2.some(t => (o.Team||'').toLowerCase().includes(t))) continue;

      broadcast('nyt_noedopkald', {
        id:          unikId,
        team:        o.Team,
        beskrivelse: o.Description,
        lokation:    o.PositionDescriptor,
        position:    o.Position,
        opkaldsnr:   o.CallNumber,
        tid:         new Date().toISOString()
      });
    }

    // Ryd gammelt data
    if (setteOpkald.size > 500) setteOpkald.clear();
  } catch {}
}

// Poll hvert 10. sekund
setInterval(pollNoedopkald, 10000);

// Roblox bruger opslag (til roblox_connect siden)
router.get('/roblox-bruger/:navn', requireAuth, async (req, res) => {
  try {
    const { default: fetch } = await import('node-fetch');
    const navn = req.params.navn;
    // Roblox Users API
    const r = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(navn)}&limit=5`);
    if (!r.ok) return res.status(404).json({ fejl: 'Ikke fundet' });
    const data = await r.json();
    const bruger = data.data?.find(u => u.name.toLowerCase() === navn.toLowerCase());
    if (!bruger) return res.status(404).json({ fejl: 'Ikke fundet' });

    // Hent avatar thumbnail
    let avatar = null;
    try {
      const avR = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${bruger.id}&size=48x48&format=Png`);
      const avData = await avR.json();
      avatar = avData.data?.[0]?.imageUrl || null;
    } catch {}

    res.json({ id: bruger.id, navn: bruger.name, display: bruger.displayName, avatar });
  } catch (err) {
    res.status(503).json({ fejl: 'Roblox API fejl' });
  }
});

// Søg efter specifik spiller i ERLC (til opslag-siden)
router.get('/spiller/:navn', requireAuth, requireGodkendt, async (req, res) => {
  try {
    const data = await hentERLC();
    const søg = req.params.navn.toLowerCase().trim();
    const spiller = (data.Players || []).find(p => {
      const navn = (p.Player || '').split(':')[0].toLowerCase().trim();
      return navn === søg || navn.includes(søg) || søg.includes(navn);
    });

    if (!spiller) return res.json({ fundet: false });

    // Log ALLE felter fra spilleren så vi kan se strukturen
    console.log('[ERLC Spiller rådata]', JSON.stringify(spiller, null, 2));

    // ER:LC bruger WantedStars — > 0 betyder wanted
    const wantedStars = spiller.WantedStars || 0;
    const erWanted = wantedStars > 0;

    console.log('[ERLC Wanted]', spiller.Player, '→ WantedStars:', wantedStars, '| wanted:', erWanted);

    res.json({
      fundet: true,
      spiller: {
        navn: (spiller.Player || '').split(':')[0],
        team: spiller.Team,
        callsign: spiller.Callsign,
        wanted: erWanted,
        wantedStars: wantedStars,
        crimes: [] // ER:LC giver ikke forbrydelsestype via API — bruges in-game MDT
      }
    });
  } catch (err) {
    res.status(503).json({ fejl: 'Kan ikke nå ER:LC' });
  }
});

module.exports = router;
