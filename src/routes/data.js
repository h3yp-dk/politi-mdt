const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireGodkendt, requireAdmin } = require('../middleware/auth');
const { sendEboks } = require('../eboksBridge');

function genNr(prefix) {
  const d = new Date();
  const dato = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return `${prefix}-${dato}-${String(Math.floor(Math.random()*9000)+1000)}`;
}

// Opret eller opdater den boede der er koblet til en anholdelse/rapport (kilde_type+kilde_id).
// Undgaar dubletter ved redigering — opdaterer beloeb/paragraffer paa den eksisterende
// koblede boede i stedet for at oprette en ny, og roerer aldrig en allerede betalt boede.
function synkroniserKildeBoede(kildeType, kildeId, discordId, borgerNavn, beloeb, paragraffer) {
  if (!beloeb || beloeb <= 0) return null;
  const eksist = db.prepare('SELECT * FROM boeder WHERE kilde_type=? AND kilde_id=?').get(kildeType, kildeId);
  if (eksist) {
    if (eksist.status === 'betalt') return eksist;
    db.prepare('UPDATE boeder SET beloeb=?, paragraffer=?, borger_navn=?, discord_id=? WHERE id=?')
      .run(beloeb, JSON.stringify(paragraffer), borgerNavn, discordId ? String(discordId) : null, eksist.id);
    return db.prepare('SELECT * FROM boeder WHERE id=?').get(eksist.id);
  }
  const bodeNr = genNr(kildeType === 'anholdelse' ? 'AB' : 'RB');
  const r = db.prepare(`INSERT INTO boeder
    (bode_nr,borger_navn,discord_id,udstedt_af_navn,beloeb,paragraffer,status,kilde_type,kilde_id)
    VALUES (?,?,?,?,?,?,'ubetalt',?,?)`
  ).run(bodeNr, borgerNavn, discordId ? String(discordId) : null, null, beloeb, JSON.stringify(paragraffer), kildeType, kildeId);
  return db.prepare('SELECT * FROM boeder WHERE id=?').get(r.lastInsertRowid);
}

// Leverer en formel e-Boks-besked for en rapport (kun ved indsendt/godkendt, ikke kladder).
// For rapport-type 'bøde' med citations synkroniseres en koblet boede, og beskeden bliver betalbar.
function leverRapportEboks({ rapportId, rapportNr, type, status, discordId, mistanktNavn, beskrivelse, lokation, citationListe }) {
  if (!discordId || (status !== 'indsendt' && status !== 'godkendt')) return;

  let bode = null;
  if (type === 'bøde' && citationListe?.length) {
    const total = citationListe.reduce((s, c) => s + (c.b || c.bøde || 0), 0);
    const paragraffer = citationListe.map(c => c.n || c.navn || '');
    bode = synkroniserKildeBoede('rapport', rapportId, discordId, mistanktNavn || 'Ukendt', total, paragraffer);
  }

  sendEboks({
    discord_id: discordId,
    afsender: 'Politiet',
    type: 'rapport',
    titel: `Rapport — ${rapportNr}`,
    linjer: [
      `Vi skal hermed give dig besked om en politirapport der vedrører dig.`,
      beskrivelse ? `Beskrivelse: ${beskrivelse}` : null,
      lokation ? `Lokation: ${lokation}` : null,
      bode ? `I forbindelse med rapporten er der udstedt en bøde på ${bode.beloeb} kr., som kan betales direkte fra din bankkonto i e-Boks.` : null,
    ].filter(Boolean),
    til_navn: mistanktNavn || null,
    ref: rapportNr,
    betaling: bode ? { beloeb: bode.beloeb, kilde: 'politi-mdt', ekstern_id: bode.bode_nr } : null,
  }).catch(() => {});
}

// ══════════════════════════════════════════════════════
//  OPSLAG
// ══════════════════════════════════════════════════════

// Hent ALLE ID-kort (til dashboard — kun admin)
router.get('/identifikation-alle', requireAuth, requireAdmin, async (req, res) => {
  try {
    const discord = require('./discord');
    const kanalId = process.env.DISCORD_IDENTIFIKATION_KANAL_ID;
    if (!kanalId) return res.status(500).json({ fejl: 'DISCORD_IDENTIFIKATION_KANAL_ID ikke sat' });

    const kort = await discord.hentAlleIdKort();
    res.json(kort);
  } catch (e) {
    res.status(500).json({ fejl: e.message });
  }
});

// Opdater et ID-kort (admin)
router.put('/identifikation/:tradId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const discord = require('./discord');
    const { navn, kon, adresse, discord_id } = req.body;
    if (!discord_id) return res.status(400).json({ fejl: 'Mangler discord_id for personen' });
    await discord.opdaterIdKort(discord_id, { navn, kon, adresse });
    res.json({ besked: 'MitID opdateret' });
  } catch (e) {
    res.status(500).json({ fejl: e.message });
  }
});

// Søg i identifikations-forum via CPR-nummer (primær søgemetode)
router.get('/identifikation/cpr/:cpr', requireAuth, requireGodkendt, async (req, res) => {
  try {
    const discord = require('./discord');
    const cpr = decodeURIComponent(req.params.cpr);
    const resultat = await discord.soegIdentifikationCPR(cpr);
    if (!resultat) {
      return res.status(404).json({ fejl: `CPR-nummer "${cpr}" ikke fundet` });
    }
    res.json(resultat);
  } catch (e) {
    res.status(500).json({ fejl: 'Søgningsfejl: ' + e.message });
  }
});

// Søg via de sidste 4 cifre af CPR-nummer
router.get('/identifikation/cpr4/:digits', requireAuth, requireGodkendt, async (req, res) => {
  try {
    const discord = require('./discord');
    const digits = req.params.digits;
    if (!/^\d{4}$/.test(digits)) return res.status(400).json({ fejl: 'Skal være præcis 4 cifre' });
    const resultat = await discord.soegIdentifikationCPR4(digits);
    res.json(resultat);
  } catch (e) {
    res.status(500).json({ fejl: e.message });
  }
});

// Søg i identifikations-forum via navn/username (fallback)
router.get('/identifikation/:query', requireAuth, requireGodkendt, async (req, res) => {
  try {
    const discord = require('./discord');
    const resultat = await discord.soegIdentifikation(decodeURIComponent(req.params.query));
    if (!resultat) {
      return res.status(404).json({ fejl: `Ingen identifikation fundet for "${req.params.query}"` });
    }
    res.json(resultat);
  } catch (e) {
    res.status(500).json({ fejl: 'Søgningsfejl: ' + e.message });
  }
});

router.get('/person/:navn', requireAuth, requireGodkendt, (req, res) => {
  const navn = req.params.navn;
  const person      = db.prepare('SELECT * FROM personer WHERE roblox_navn LIKE ? LIMIT 1').get(`%${navn}%`);
  const boeder      = db.prepare("SELECT * FROM boeder WHERE borger_navn LIKE ? ORDER BY oprettet DESC LIMIT 20").all(`%${navn}%`);
  const anholdelser = db.prepare("SELECT * FROM anholdelser WHERE anholdt_navn LIKE ? ORDER BY oprettet DESC LIMIT 10").all(`%${navn}%`);
  const koeretoejer = db.prepare("SELECT * FROM koeretoejer WHERE ejer_navn LIKE ? ORDER BY oprettet DESC").all(`%${navn}%`);
  const retssager   = db.prepare("SELECT * FROM retssager WHERE tiltalte_navn LIKE ? ORDER BY oprettet DESC LIMIT 10").all(`%${navn}%`);
  const ubetalt_total = boeder.filter(b => b.status === 'ubetalt').reduce((sum, b) => sum + b.beloeb, 0);
  res.json({ navn, person, boeder, anholdelser, koeretoejer, retssager,
    statistik: { antal_boeder: boeder.length, ubetalt_beloeb: ubetalt_total,
      antal_anholdelser: anholdelser.length,
      aktive_retssager: retssager.filter(r => r.status !== 'afgjort' && r.status !== 'frikendt').length }
  });
});

router.get('/koeretoej/:plade', requireAuth, requireGodkendt, (req, res) => {
  const plade = req.params.plade.toUpperCase();
  const koeretoej = db.prepare('SELECT * FROM koeretoejer WHERE nummerplade = ?').get(plade);
  if (!koeretoej) return res.status(404).json({ fejl: 'Nummerplade ikke fundet i systemet' });
  const boeder      = db.prepare("SELECT * FROM boeder WHERE borger_navn LIKE ? ORDER BY oprettet DESC LIMIT 5").all(`%${koeretoej.ejer_navn}%`);
  const anholdelser = db.prepare("SELECT COUNT(*) as n FROM anholdelser WHERE anholdt_navn LIKE ?").get(`%${koeretoej.ejer_navn}%`);
  const efterlyst   = db.prepare("SELECT * FROM retssager WHERE tiltalte_navn LIKE ? AND status NOT IN ('afgjort','frikendt')").all(`%${koeretoej.ejer_navn}%`);
  res.json({ ...koeretoej, ejer: { seneste_boeder: boeder, antal_anholdelser: anholdelser.n, aktive_sager: efterlyst.length > 0 } });
});

router.post('/person', requireAuth, requireGodkendt, (req, res) => {
  const { roblox_navn, roblox_id, koerekort, koerekort_noter, farlig, farlig_note } = req.body;
  if (!roblox_navn) return res.status(400).json({ fejl: 'roblox_navn mangler' });
  const eksist = db.prepare('SELECT id FROM personer WHERE roblox_navn = ?').get(roblox_navn);
  if (eksist) {
    db.prepare(`UPDATE personer SET roblox_id=COALESCE(?,roblox_id), koerekort=COALESCE(?,koerekort),
      koerekort_noter=COALESCE(?,koerekort_noter), farlig=COALESCE(?,farlig),
      farlig_note=COALESCE(?,farlig_note), opdateret=datetime('now') WHERE id=?`
    ).run(roblox_id||null, koerekort??null, koerekort_noter||null, farlig??null, farlig_note||null, eksist.id);
    return res.json({ besked: 'Person opdateret', id: eksist.id });
  }
  const r = db.prepare(`INSERT INTO personer (roblox_navn,roblox_id,koerekort,koerekort_noter,farlig,farlig_note,oprettet_af)
    VALUES (?,?,?,?,?,?,?)`).run(roblox_navn, roblox_id||null, koerekort??1, koerekort_noter||null, farlig??0, farlig_note||null, req.bruger.id);
  res.status(201).json({ besked: 'Person oprettet', id: r.lastInsertRowid });
});

router.post('/koeretoej', requireAuth, requireGodkendt, (req, res) => {
  const { nummerplade, ejer_navn, ejer_roblox_id, maerke, model, farve, aar, status, forsikring, registrering, noter } = req.body;
  if (!nummerplade) return res.status(400).json({ fejl: 'nummerplade mangler' });
  const plade = nummerplade.toUpperCase();
  db.prepare(`INSERT INTO koeretoejer
    (nummerplade,ejer_navn,ejer_roblox_id,maerke,model,farve,aar,status,forsikring,registrering,noter,oprettet_af)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(nummerplade) DO UPDATE SET ejer_navn=excluded.ejer_navn,ejer_roblox_id=excluded.ejer_roblox_id,
    maerke=excluded.maerke,model=excluded.model,farve=excluded.farve,aar=excluded.aar,status=excluded.status,
    forsikring=excluded.forsikring,registrering=excluded.registrering,noter=excluded.noter,opdateret=datetime('now')`
  ).run(plade, ejer_navn||null, ejer_roblox_id||null, maerke||null, model||null, farve||null, aar||null,
    status||'normal', forsikring??1, registrering??1, noter||null, req.bruger.id);
  res.json({ besked: 'Køretøj gemt', nummerplade: plade });
});

// ══════════════════════════════════════════════════════
//  BØDER
// ══════════════════════════════════════════════════════

router.get('/boeder', requireAuth, requireGodkendt, (req, res) => {
  const { navn, status, side = 1 } = req.query;
  const limit = 20, offset = (side - 1) * limit;
  let sql = 'SELECT * FROM boeder WHERE 1=1';
  const params = [];
  if (navn)   { sql += ' AND borger_navn LIKE ?'; params.push(`%${navn}%`); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY oprettet DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  res.json(db.prepare(sql).all(...params));
});

router.post('/boeder', requireAuth, requireGodkendt, (req, res) => {
  const {
    borger_navn, discord_id, roblox_id, beloeb, paragraffer, beskrivelse, lokation, nummerplade,
    betjent_data, borger_data, koeretoej_data, postnummer, betalingsfrist, dato, tid, bode_nr
  } = req.body;

  if (!borger_navn || !beloeb || !paragraffer?.length) {
    return res.status(400).json({ fejl: 'borger_navn, beloeb og paragraffer er påkrævet' });
  }
  if (!discord_id) {
    return res.status(400).json({ fejl: 'Du skal slå borgeren op via CPR, før bøden kan udstedes' });
  }

  const betjent = db.prepare('SELECT * FROM brugere WHERE id = ?').get(req.bruger.id);
  const bodeNr  = bode_nr || genNr('B');
  const betjentNavn = `${betjent.rang} ${betjent.fornavn} ${betjent.efternavn} [${betjent.badge_nummer}]`;

  const r = db.prepare(`INSERT INTO boeder
    (bode_nr,borger_navn,discord_id,roblox_id,udstedt_af_id,udstedt_af_navn,beloeb,paragraffer,beskrivelse,lokation,nummerplade)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(bodeNr, borger_navn, String(discord_id), roblox_id||null, req.bruger.id, betjentNavn,
    beloeb, JSON.stringify(paragraffer), beskrivelse||null, lokation||null,
    koeretoej_data?.plade || nummerplade || null);

  const bode = db.prepare('SELECT * FROM boeder WHERE id = ?').get(r.lastInsertRowid);
  const discord = require('./discord');

  // Fælles data-objekt brugt af begge Discord-poster
  const discordData = {
    bode_nr:          bodeNr,
    borger_navn,
    borger_foedsel:   borger_data?.foedsel   || null,
    borger_kon:       borger_data?.kon        || null,
    borger_adresse:   borger_data?.adresse    || null,
    discord_id,
    beloeb,
    paragraffer:      JSON.parse(bode.paragraffer || '[]'),
    lokation:         lokation || null,
    postnummer:       postnummer || null,
    noter:            beskrivelse || null,
    betalingsfrist:   betalingsfrist || null,
    koeretoej_plade:  koeretoej_data?.plade || nummerplade || null,
    koeretoej_model:  koeretoej_data?.model || null,
    koeretoej_farve:  koeretoej_data?.farve || null,
    betjent_navn:     betjentNavn,
    betjent_rang:     betjent_data?.rang  || betjent.rang,
    betjent_badge:    betjent_data?.badge || betjent.badge_nummer,
    betjent_signal:   betjent_data?.signal|| betjent.kaldesignal,
    betjent_afdeling: betjent_data?.afdeling || betjent.afdeling,
    betjent_myndighed:'Københavns Politi',
    dato:             dato || new Date().toLocaleDateString('da-DK'),
    tid:              tid  || new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }),
  };

  // Post til politi-Discord (intern bøde-kanal)
  discord.postBode(discordData).catch(() => {});

  // Post til Nyhavn RP main Discord e-Boks
  discord.postEboks(discordData).catch(() => {});

  // Lever formel e-Boks-besked til erlc-borgerservice — borgeren betaler selv fra sin Bank-konto
  sendEboks({
    discord_id,
    afsender: betjent_data?.myndighed || 'Politiet',
    type: 'boede',
    titel: `Bøde — ${bodeNr}`,
    linjer: [
      `Du er hermed pålagt en bøde for følgende overtrædelse(r):`,
      JSON.parse(bode.paragraffer || '[]').map(p => `• ${p}`).join('\n'),
      lokation ? `Lokation: ${lokation}` : null,
      beskrivelse ? `Bemærkninger: ${beskrivelse}` : null,
      `Samlet beløb: ${beloeb} kr.`,
      `Bøden kan betales direkte fra din bankkonto i e-Boks.`,
    ].filter(Boolean),
    til_navn: borger_navn,
    ref: bodeNr,
    betaling: { beloeb, kilde: 'politi-mdt', ekstern_id: bodeNr },
  }).then(ok => {
    if (ok) db.prepare('UPDATE boeder SET eboks_sendt=1 WHERE id=?').run(bode.id);
  }).catch(() => {});

  res.status(201).json(bode);
});

// Slet bøde (bruges ved redigering — slet gammel, opret ny)
router.delete('/boeder/:id', requireAuth, requireGodkendt, (req, res) => {
  const eksist = db.prepare('SELECT * FROM boeder WHERE id = ?').get(req.params.id);
  if (!eksist) return res.status(404).json({ fejl: 'Bøde ikke fundet' });
  // Slet gammel Discord-tråd hvis den findes
  if (eksist.discord_thread_id) {
    const discord = require('./discord');
    discord.sletGammelBesked?.(process.env.DISCORD_BOEDE_KANAL_ID, eksist.discord_thread_id).catch(() => {});
    discord.sletGammelBesked?.(process.env.DISCORD_MAIN_EBOKS_KANAL_ID, eksist.discord_thread_id).catch(() => {});
  }
  db.prepare('DELETE FROM boeder WHERE id = ?').run(req.params.id);
  res.json({ besked: 'Bøde slettet' });
});

// ══════════════════════════════════════════════════════
//  ANHOLDELSER
// ══════════════════════════════════════════════════════

router.get('/anholdelser', requireAuth, requireGodkendt, (req, res) => {
  const { navn } = req.query;
  let sql = 'SELECT * FROM anholdelser WHERE 1=1';
  const params = [];
  if (navn) { sql += ' AND anholdt_navn LIKE ?'; params.push(`%${navn}%`); }
  sql += ' ORDER BY oprettet DESC LIMIT 50';
  res.json(db.prepare(sql).all(...params));
});

router.post('/anholdelser', requireAuth, requireGodkendt, (req, res) => {
  const { anholdt_navn, discord_id, roblox_id, anklage_punkter, beskrivelse,
    lokation, vaaben_fundet, stoffer_fundet, faengsel_tid, boede_beloeb, betjent_data } = req.body;
  if (!anholdt_navn || !anklage_punkter?.length || !beskrivelse) {
    return res.status(400).json({ fejl: 'Navn, anklagepunkter og beskrivelse er påkrævet' });
  }
  if (!discord_id) {
    return res.status(400).json({ fejl: 'Du skal slå personen op via CPR, før anholdelsen kan registreres' });
  }
  const betjent   = db.prepare('SELECT * FROM brugere WHERE id = ?').get(req.bruger.id);
  const rapportNr = genNr('A');
  const r = db.prepare(`INSERT INTO anholdelser
    (rapport_nr,anholdt_navn,discord_id,roblox_id,betjent_id,betjent_navn,anklage_punkter,beskrivelse,lokation,vaaben_fundet,stoffer_fundet,faengsel_tid,boede_beloeb)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(rapportNr, anholdt_navn, String(discord_id), roblox_id||null, req.bruger.id,
    `${betjent.rang} ${betjent.fornavn} ${betjent.efternavn} [${betjent.badge_nummer}]`,
    JSON.stringify(anklage_punkter), beskrivelse, lokation||null,
    vaaben_fundet?1:0, stoffer_fundet?1:0, faengsel_tid||null, boede_beloeb||0);
  const anholdelse = db.prepare('SELECT * FROM anholdelser WHERE id = ?').get(r.lastInsertRowid);
  const sagsNr = genNr('S');
  db.prepare(`INSERT INTO retssager (sags_nr,tiltalte_navn,roblox_id,anklager_id,anklager_navn,tiltale_punkter,kendsgerninger)
    VALUES (?,?,?,?,?,?,?)`).run(sagsNr, anholdt_navn, roblox_id||null, req.bruger.id,
    `${betjent.rang} ${betjent.fornavn} ${betjent.efternavn}`, JSON.stringify(anklage_punkter), beskrivelse);
  const discord3 = require('./discord');
  discord3.postAnholdelse(anholdelse, betjent).catch(() => {});

  const bode = synkroniserKildeBoede('anholdelse', anholdelse.id, discord_id, anholdt_navn,
    boede_beloeb || 0, anklage_punkter);

  sendEboks({
    discord_id,
    afsender: betjent_data?.myndighed || 'Politiet',
    type: 'anholdelse',
    titel: `Anholdelse — ${rapportNr}`,
    linjer: [
      `Vi skal hermed meddele, at du er blevet anholdt.`,
      `Anklagepunkter:\n${anklage_punkter.map(p => `• ${p}`).join('\n')}`,
      lokation ? `Lokation: ${lokation}` : null,
      faengsel_tid ? `Idømt fængselstid: ${faengsel_tid}` : null,
      bode ? `I forbindelse med anholdelsen er der udstedt en bøde på ${bode.beloeb} kr., som kan betales direkte fra din bankkonto i e-Boks.` : null,
    ].filter(Boolean),
    til_navn: anholdt_navn,
    ref: rapportNr,
    betaling: bode ? { beloeb: bode.beloeb, kilde: 'politi-mdt', ekstern_id: bode.bode_nr } : null,
  }).catch(() => {});

  res.status(201).json(anholdelse);
});

// Slet anholdelse (bruges ved redigering)
router.delete('/anholdelser/:id', requireAuth, requireGodkendt, (req, res) => {
  const eksist = db.prepare('SELECT * FROM anholdelser WHERE id = ?').get(req.params.id);
  if (!eksist) return res.status(404).json({ fejl: 'Anholdelse ikke fundet' });
  // Slet gammel Discord-tråd
  if (eksist.discord_thread_id) {
    const discord = require('./discord');
    discord.sletGammelBesked?.(process.env.DISCORD_RAPPORT_KANAL_ID, eksist.discord_thread_id).catch(() => {});
  }
  // Slet tilknyttet retssag
  db.prepare("DELETE FROM retssager WHERE tiltalte_navn = ? AND kendsgerninger = ?")
    .run(eksist.anholdt_navn, eksist.beskrivelse);
  db.prepare('DELETE FROM anholdelser WHERE id = ?').run(req.params.id);
  res.json({ besked: 'Anholdelse slettet' });
});

// ══════════════════════════════════════════════════════
//  HÆNDELSESRAPPORTER  ← OPDATERET
// ══════════════════════════════════════════════════════

router.get('/rapporter', requireAuth, requireGodkendt, (req, res) => {
  const egne = req.bruger.er_admin ? '' : 'AND oprettet_af_id = ?';
  const params = req.bruger.er_admin ? [] : [req.bruger.id];
  const rapporter = db.prepare(
    `SELECT * FROM rapporter WHERE 1=1 ${egne} ORDER BY oprettet DESC LIMIT 50`
  ).all(...params);
  res.json(rapporter);
});

router.post('/rapporter', requireAuth, requireGodkendt, (req, res) => {
  const {
    titel, type, status, beskrivelse, lokation,
    betjente, tiltalepunkter, citations, discord_id,
    mistankt, medical, transport, noter
  } = req.body;

  // Kun type er strengt påkrævet — titel og beskrivelse er valgfri afhængigt af type
  if (!type) {
    return res.status(400).json({ fejl: 'type er påkrævet' });
  }
  if ((status || 'indsendt') !== 'kladde' && !discord_id) {
    return res.status(400).json({ fejl: 'Du skal slå personen op via CPR, før rapporten kan indsendes' });
  }

  const betjent   = db.prepare('SELECT * FROM brugere WHERE id = ?').get(req.bruger.id);
  const rapportNr = genNr('R');

  // Byg titel med mistænktens navn og rapport nr.
  const mistanktObj = typeof mistankt === 'object' ? mistankt : (()=>{try{return JSON.parse(mistankt||'{}')}catch{return {}}})();
  const finalTitel =
    type === 'anholdelse' ? `Anholdelse — ${mistanktObj?.navn || 'Ukendt'} — ${rapportNr}` :
    type === 'bøde'       ? `Bøde — ${mistanktObj?.navn || 'Ukendt'} — ${rapportNr}` :
    titel || `Rapport — ${rapportNr}`;

  // Saml beskrivelse fra alle felter
  const beskrivelseAfsnit = [];
  if (beskrivelse) beskrivelseAfsnit.push(beskrivelse);

  // Tiltalepunkter / citations til beskrivelse (til database)
  const tiltalePunktListe = (() => { try { return JSON.parse(tiltalepunkter || '[]'); } catch { return []; } })();
  const citationListe     = (() => { try { return JSON.parse(citations || '[]');      } catch { return []; } })();

  const r = db.prepare(`
    INSERT INTO rapporter
      (rapport_nr, titel, type, status, beskrivelse, lokation, involverede,
       tiltalepunkter, citations, mistankt, medical, transport, noter,
       betjente, oprettet_af_id, oprettet_af_navn, discord_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rapportNr,
    finalTitel || '',
    type,
    status || 'indsendt',
    beskrivelse || '',
    lokation || null,
    JSON.stringify(betjente || []),
    JSON.stringify(tiltalePunktListe),
    JSON.stringify(citationListe),
    JSON.stringify(mistankt || {}),
    JSON.stringify(medical || {}),
    JSON.stringify(transport || {}),
    noter || null,
    JSON.stringify(betjente || []),
    req.bruger.id,
    `${betjent.rang} ${betjent.fornavn} ${betjent.efternavn} [${betjent.badge_nummer}]`,
    discord_id ? String(discord_id) : null
  );

  const rapport = db.prepare('SELECT * FROM rapporter WHERE id = ?').get(r.lastInsertRowid);

  // Send til Discord (kun hvis indsendt, ikke kladde)
  if ((status || 'indsendt') === 'indsendt') {
    const discord2 = require('./discord');
    discord2.postRapport({
      rapport_nr:        rapportNr,
      titel:             finalTitel,
      type,
      status:            status || 'indsendt',
      beskrivelse:       beskrivelse || '',
      lokation:          lokation || null,
      betjente:          betjente || [],
      tiltalepunkter:    tiltalePunktListe,
      citations:         citationListe,
      mistankt:          mistankt || {},
      medical:           medical || {},
      transport:         transport || {},
      noter:             noter || null,
      betjent_navn:      `${betjent.rang} ${betjent.fornavn} ${betjent.efternavn} [${betjent.badge_nummer}]`,
      betjent_rn:        betjent.roblox_navn || betjent.fornavn + ' ' + betjent.efternavn,
      betjent_rang:      betjent.rang,
      betjent_badge:     betjent.badge_nummer,
      betjent_signal:    betjent.kaldesignal,
      betjent_afdeling:  betjent.afdeling,
      betjent_myndighed: 'Københavns Politi',
      discord_thread_id: null,
    }).then(msgId => {
      if (msgId) {
        db.prepare('UPDATE rapporter SET discord_thread_id = ? WHERE id = ?').run(String(msgId), r.lastInsertRowid);
      }
    }).catch(() => {});
  }

  leverRapportEboks({
    rapportId: r.lastInsertRowid, rapportNr, type, status: status || 'indsendt',
    discordId: discord_id, mistanktNavn: mistanktObj?.navn, beskrivelse, lokation, citationListe,
  });

  res.status(201).json({ ...rapport, rapport_nr: rapportNr });
});

// Hent enkelt rapport (til edit mode)
router.get('/rapporter/:id', requireAuth, requireGodkendt, (req, res) => {
  const rapport = db.prepare('SELECT * FROM rapporter WHERE id = ?').get(req.params.id);
  if (!rapport) return res.status(404).json({ fejl: 'Rapport ikke fundet' });
  // Kun opretter eller admin må hente
  if (!req.bruger.er_admin && rapport.oprettet_af_id !== req.bruger.id) {
    return res.status(403).json({ fejl: 'Ingen adgang' });
  }
  res.json(rapport);
});

// Opdater rapport (edit mode)
router.put('/rapporter/:id', requireAuth, requireGodkendt, (req, res) => {
  const {
    titel, type, status, beskrivelse, lokation,
    betjente, tiltalepunkter, citations, discord_id,
    mistankt, medical, transport, noter
  } = req.body;

  const eksist = db.prepare('SELECT * FROM rapporter WHERE id = ?').get(req.params.id);
  if (!eksist) return res.status(404).json({ fejl: 'Rapport ikke fundet' });
  if (!req.bruger.er_admin && eksist.oprettet_af_id !== req.bruger.id) {
    return res.status(403).json({ fejl: 'Du kan kun redigere dine egne rapporter' });
  }
  // Kun admin kan godkende
  if (status === 'godkendt' && !req.bruger.er_admin) {
    return res.status(403).json({ fejl: 'Kun admin kan godkende rapporter' });
  }
  if (status && status !== 'kladde' && !discord_id && !eksist.discord_id) {
    return res.status(400).json({ fejl: 'Du skal slå personen op via CPR, før rapporten kan indsendes' });
  }

  const betjent = db.prepare('SELECT * FROM brugere WHERE id = ?').get(req.bruger.id);

  // Titlen skal altid inkludere mistænktens navn og rapport nr.
  const mistanktNavn = (typeof mistankt === 'object' ? mistankt?.navn : JSON.parse(mistankt||'{}')?.navn) || '';
  const finalTitel =
    (type || eksist.type) === 'anholdelse' ? `Anholdelse — ${mistanktNavn || 'Ukendt'} — ${eksist.rapport_nr}` :
    (type || eksist.type) === 'bøde'       ? `Bøde — ${mistanktNavn || 'Ukendt'} — ${eksist.rapport_nr}` :
    titel || eksist.titel || `Rapport — ${eksist.rapport_nr}`;
  const tiltalePunktListe = (() => { try { return JSON.parse(tiltalepunkter || '[]'); } catch { return []; } })();
  const citationListe     = (() => { try { return JSON.parse(citations || '[]'); }      catch { return []; } })();
  const finalStatus = status || eksist.status || 'kladde';

  const discordIdVaerdi = discord_id ? String(discord_id) : (eksist.discord_id || null);

  db.prepare(`
    UPDATE rapporter SET
      titel          = ?,
      type           = ?,
      status         = ?,
      beskrivelse    = ?,
      lokation       = ?,
      tiltalepunkter = ?,
      citations      = ?,
      mistankt       = ?,
      medical        = ?,
      transport      = ?,
      noter          = ?,
      betjente       = ?,
      involverede    = ?,
      discord_id     = ?
    WHERE id = ?
  `).run(
    finalTitel,
    type || eksist.type,
    finalStatus,
    beskrivelse || '',
    lokation || null,
    JSON.stringify(tiltalePunktListe),
    JSON.stringify(citationListe),
    JSON.stringify(mistankt || {}),
    JSON.stringify(medical || {}),
    JSON.stringify(transport || {}),
    noter || null,
    JSON.stringify(betjente || []),
    JSON.stringify(betjente || []),
    discordIdVaerdi,
    req.params.id
  );

  const opdateret = db.prepare('SELECT * FROM rapporter WHERE id = ?').get(req.params.id);

  // Send/opdater på Discord hvis indsendt eller godkendt
  if (finalStatus === 'indsendt' || finalStatus === 'godkendt') {
    const discord2 = require('./discord');
    discord2.postRapport({
      rapport_nr:        opdateret.rapport_nr,
      titel:             finalTitel,
      type:              type || eksist.type,
      status:            finalStatus,
      beskrivelse:       beskrivelse || '',
      lokation:          lokation || null,
      betjente:          betjente || [],
      tiltalepunkter:    tiltalePunktListe,
      citations:         citationListe,
      mistankt:          mistankt || {},
      medical:           medical || {},
      transport:         transport || {},
      noter:             noter || null,
      betjent_navn:      `${betjent.rang} ${betjent.fornavn} ${betjent.efternavn} [${betjent.badge_nummer}]`,
      betjent_rn:        betjent.roblox_navn || betjent.fornavn + ' ' + betjent.efternavn,
      betjent_rang:      betjent.rang,
      betjent_badge:     betjent.badge_nummer,
      betjent_signal:    betjent.kaldesignal,
      betjent_afdeling:  betjent.afdeling,
      betjent_myndighed: 'Københavns Politi',
      discord_thread_id: eksist.discord_thread_id || null,
    }).then(msgId => {
      // Gem discord_thread_id hvis det er en ny besked
      if (msgId && !eksist.discord_thread_id) {
        db.prepare('UPDATE rapporter SET discord_thread_id = ? WHERE id = ?').run(String(msgId), req.params.id);
      }
    }).catch(() => {});
  }

  leverRapportEboks({
    rapportId: req.params.id, rapportNr: opdateret.rapport_nr, type: type || eksist.type,
    status: finalStatus, discordId: discordIdVaerdi, mistanktNavn, beskrivelse, lokation, citationListe,
  });

  res.json({ ...opdateret, rapport_nr: opdateret.rapport_nr });
});

// ══════════════════════════════════════════════════════
//  RETSSAGER
// ══════════════════════════════════════════════════════

router.get('/retssager', requireAuth, requireGodkendt, (req, res) => {
  res.json(db.prepare('SELECT * FROM retssager ORDER BY oprettet DESC LIMIT 50').all());
});

// Opdater sag (anklager, forsvarer, status, kendsgerninger)
router.put('/retssager/:id', requireAuth, requireGodkendt, (req, res) => {
  const { anklager_navn, forsvarer, kendsgerninger, status } = req.body;
  const eksist = db.prepare('SELECT * FROM retssager WHERE id = ?').get(req.params.id);
  if (!eksist) return res.status(404).json({ fejl: 'Sag ikke fundet' });

  db.prepare(`
    UPDATE retssager SET
      anklager_navn  = COALESCE(?, anklager_navn),
      forsvarer      = ?,
      kendsgerninger = COALESCE(?, kendsgerninger),
      status         = COALESCE(?, status)
    WHERE id = ?
  `).run(
    anklager_navn || null,
    forsvarer || null,
    kendsgerninger || null,
    status || null,
    req.params.id
  );
  res.json({ besked: 'Sag opdateret' });
});

// Afsig dom (kun admin)
router.put('/retssager/:id/dom', requireAuth, requireAdmin, (req, res) => {
  const { dom, straf, status } = req.body;
  db.prepare(`UPDATE retssager SET dom=?, straf=?, status=?, afgjort=datetime('now') WHERE id=?`
  ).run(dom||null, straf||null, status||'afgjort', req.params.id);
  res.json({ besked: 'Dom afsagt' });
});

// ══════════════════════════════════════════════════════
//  PARAGRAFFER
// ══════════════════════════════════════════════════════

router.get('/paragraffer', requireAuth, (req, res) => {
  const alleP = db.prepare('SELECT * FROM paragraffer').all();
  alleP.sort((a, b) => {
    if (a.kategori === 'Hastighedsovertrædelser' && b.kategori !== 'Hastighedsovertrædelser') return 1;
    if (b.kategori === 'Hastighedsovertrædelser' && a.kategori !== 'Hastighedsovertrædelser') return -1;
    const tal = k => (k.match(/\d+/g) || []).map(Number);
    const an = tal(a.kode), bn = tal(b.kode);
    for (let i = 0; i < Math.max(an.length, bn.length); i++) {
      const diff = (an[i] || 0) - (bn[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  res.json(alleP);
});

module.exports = router;

// ── Ryd database (kun admin) ──────────────────────────────────────────────────
router.delete('/ryd-database', requireAuth, requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM boeder').run();
    db.prepare('DELETE FROM anholdelser').run();
    db.prepare('DELETE FROM rapporter').run();
    db.prepare('DELETE FROM retssager').run();
    db.prepare('DELETE FROM noedopkald').run();
    // Reset auto-increment
    try { db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('boeder','anholdelser','rapporter','retssager','noedopkald')").run(); } catch {}
    res.json({ besked: 'Database ryddet' });
  } catch(e) {
    res.status(500).json({ fejl: e.message });
  }
});

// ── Bootstrap admin + ryd database (kun discord ID 623033555345342484) ────────
router.post('/bootstrap', (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.JWT_SECRET) {
    return res.status(403).json({ fejl: 'Forkert secret' });
  }
  try {
    // Sæt discord ID som admin
    db.prepare("UPDATE brugere SET er_admin = 1, godkendt = 1 WHERE discord_id = '623033555345342484'").run();
    // Ryd data
    db.prepare('DELETE FROM boeder').run();
    db.prepare('DELETE FROM anholdelser').run();
    db.prepare('DELETE FROM rapporter').run();
    db.prepare('DELETE FROM retssager').run();
    db.prepare('DELETE FROM noedopkald').run();
    try { db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('boeder','anholdelser','rapporter','retssager','noedopkald')").run(); } catch {}
    res.json({ besked: 'Admin sat og database ryddet!' });
  } catch(e) {
    res.status(500).json({ fejl: e.message });
  }
});
