const { Client, GatewayIntentBits, EmbedBuilder, ChannelType } = require('discord.js');

let client = null;

// ── ID-system hjælper ─────────────────────────────────────────────────────────
const ADMIN_USER_ID = '623033555345342484';

const DANSKE_FORNAVNE = [
  'Anders','Andreas','Benjamin','Bjarne','Bo','Brian','Casper','Christian','Daniel',
  'David','Emil','Erik','Frederik','Henrik','Jacob','Jakob','Jan','Jonas','Jonathan',
  'Kasper','Kenneth','Lars','Lasse','Lukas','Magnus','Mathias','Mikkel','Morten',
  'Nicolai','Niels','Oliver','Oscar','Patrick','Peter','Philip','Rasmus','Rene',
  'Sebastian','Simon','Søren','Thomas','Thor','Tobias','Tom','Victor','Villads','William',
  'Adam','Alexander','Alfred','Anton','August','Axel','Bastian','Carl','Christoffer',
  'Dennis','Elias','Esben','Finn','Frank','Georg','Hans','Hugo','Ivan','Jens','Johan',
  'Johannes','Jonatan','Jørgen','Karl','Klaus','Knud','Kristian','Kristoffer','Kurt',
  'Leon','Liam','Ludvig','Marco','Marcus','Mark','Martin','Max','Michael','Nils',
  'Noah','Poul','Robert','Robin','Rune','Stefan','Steffen','Stig','Sune','Svend',
  'Troels','Ulrik','Viktor','Walther'
];

const DANSKE_EFTERNAVNE = [
  'Hansen','Jensen','Nielsen','Pedersen','Andersen','Christensen','Larsen','Sørensen',
  'Rasmussen','Jørgensen','Petersen','Madsen','Kristensen','Olsen','Thomsen','Christiansen',
  'Poulsen','Johansen','Møller','Mortensen','Knudsen','Lund','Schmidt','Eriksen','Dahl',
  'Henriksen','Jacobsen','Karlsen','Jakobsen','Olesen','Bruun','Laursen','Lauridsen',
  'Clausen','Holm','Koch','Iversen','Christoffersen','Mikkelsen','Frederiksen','Simonsen',
  'Nissen','Søndergaard','Vestergaard','Kjeldsen','Kjær','Lindberg','Berg','Bech',
  'Brandt','Dalsgaard','Damgaard','Frandsen','Friis','Gram','Greve','Hald','Hammer',
  'Hedegaard','Holt','Juhl','Juul','Kirkegaard','Klausen','Krogh','Lange','Lassen',
  'Lykke','Mogensen','Nygaard','Overgaard','Pallesen','Ravn','Riis','Rosenberg',
  'Sandberg','Schultz','Steffensen','Strand','Svendsen','Thygesen','Toft','Torp',
  'Ulrichsen','Winther','Wulff','Østergaard','Aagaard','Abildgaard'
];

function idNavn(discordId) {
  const h = BigInt(discordId || '0');
  const fi = Number(h % BigInt(DANSKE_FORNAVNE.length));
  const ei = Number((h / BigInt(DANSKE_FORNAVNE.length)) % BigInt(DANSKE_EFTERNAVNE.length));
  return `${DANSKE_FORNAVNE[fi]} ${DANSKE_EFTERNAVNE[ei]}`;
}

function idFoedsel(discordId) {
  const h   = BigInt(discordId || '0');
  const år  = 1990 + Number(h % 18n);
  const mdr = 1 + Number((h / 18n) % 12n);
  const max = [0,31,28,31,30,31,30,31,31,30,31,30,31][mdr] || 28;
  const dag = 1 + Number((h / 216n) % BigInt(max));
  return { dag, mdr, år };
}

function idCPR(discordId) {
  const { dag, mdr, år } = idFoedsel(discordId);
  const h      = BigInt(discordId || '0');
  const base   = String(Number((h / 1000n) % 1000n)).padStart(3, '0');
  const sidst  = [1,3,5,7,9][Number((h / 1000000n) % 5n)];
  const dagStr = String(dag).padStart(2,'0');
  const mdrStr = String(mdr).padStart(2,'0');
  return `${dagStr}${mdrStr}${år}-${base}${sidst}`;
}

function idFoedselStr(discordId) {
  const { dag, mdr, år } = idFoedsel(discordId);
  return `${String(dag).padStart(2,'0')}/${String(mdr).padStart(2,'0')}/${år}`;
}

function byggIdEmbed(userId, username) {
  const navn = idNavn(userId);
  const cpr  = idCPR(userId);
  const embed = new EmbedBuilder()
    .setColor(0x1a2e4a)
    .setTitle('IDENTIFIKATIONSKORT')
    .addFields(
      { name: 'Navn',       value: navn,      inline: false },
      { name: 'CPR-Nummer', value: cpr,       inline: false },
      { name: 'Køn',        value: 'Mand',    inline: false },
      { name: 'Adresse',    value: 'Hjemløs', inline: false },
    )
    .setFooter({ text: `${username}  ·  ${userId}` })
    .setTimestamp();
  return { embed, navn, cpr };
}

function init() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn('[Discord Bot] Ingen token — bot deaktiveret');
    return;
  }
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent
    ]
  });
  client.once('clientReady', async () => {
    console.log(`[Discord Bot] Logget ind som ${client.user.tag} ✓`);

    // Log hvilke servere botten er i
    client.guilds.cache.forEach(g => {
      console.log(`[Discord Bot] Tilsluttet server: ${g.name} (${g.id})`);
    });

    // Tjek at Nyhavn RP e-boks kanalen er tilgængelig
    const eboksKanal = process.env.DISCORD_MAIN_EBOKS_KANAL_ID;
    if (eboksKanal) {
      const kanal = await client.channels.fetch(eboksKanal).catch(() => null);
      if (kanal) {
        console.log(`[Discord Bot] Nyhavn RP e-Boks klar: #${kanal.name} ✓`);
      } else {
        console.warn(`[Discord Bot] Kunne ikke finde e-Boks kanal ${eboksKanal} — er botten inviteret til Nyhavn RP?`);
      }
    }

  });

  client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    console.error('[Discord Bot] Login fejl:', err.message);
  });
}

async function hentKanal(kanalId) {
  if (!client?.isReady()) return null;
  try { return await client.channels.fetch(kanalId); } catch { return null; }
}

async function hentBeskeder(kanalId, antal = 30) {
  const kanal = await hentKanal(kanalId);
  if (!kanal) return [];
  try {
    let alleEmbeds = [];
    if (kanal.type === 15) {
      const aktive = await kanal.threads.fetchActive();
      const arkiv  = await kanal.threads.fetchArchived({ limit: antal }).catch(() => ({ threads: new Map() }));
      const tråde  = [...aktive.threads.values(), ...arkiv.threads.values()].slice(0, antal);
      for (const tråd of tråde) {
        try {
          const msgs = await tråd.messages.fetch({ limit: 1 });
          const foersteBesked = msgs.last();
          if (foersteBesked) {
            alleEmbeds.push({
              id: tråd.id, titel: tråd.name, indhold: foersteBesked.content,
              embeds: foersteBesked.embeds.map(e => ({
                titel: e.title, farve: e.hexColor,
                felter: e.fields.map(f => ({ navn: f.name, vaerdi: f.value })),
                beskrivelse: e.description
              })),
              tid: tråd.createdAt?.toISOString() || new Date().toISOString()
            });
          }
        } catch {}
      }
    } else {
      const msgs = await kanal.messages.fetch({ limit: antal });
      alleEmbeds = msgs.map(m => ({
        id: m.id, titel: m.embeds[0]?.title || '', indhold: m.content,
        embeds: m.embeds.map(e => ({
          titel: e.title, farve: e.hexColor,
          felter: e.fields.map(f => ({ navn: f.name, vaerdi: f.value })),
          beskrivelse: e.description
        })),
        tid: m.createdAt.toISOString()
      }));
    }
    return alleEmbeds.sort((a, b) => new Date(b.tid) - new Date(a.tid));
  } catch (e) {
    console.error('[Discord] Hent beskeder fejl:', e.message);
    return [];
  }
}

// ── Slet gammel besked/tråd ───────────────────────────────────────────────────
async function sletGammelBesked(kanalId, msgId) {
  if (!msgId) return;
  try {
    const kanal = await hentKanal(kanalId);
    if (!kanal) return;
    const erForum = kanal.type === 15 || kanal.constructor?.name === 'ForumChannel';
    if (erForum) {
      // Slet hele tråden
      const tråd = await client.channels.fetch(msgId).catch(() => null);
      if (tråd && tråd.delete) {
        await tråd.delete();
        console.log(`[Discord] Forum tråd slettet: ${msgId}`);
      }
    } else {
      // Slet beskeden
      const besked = await kanal.messages.fetch(msgId).catch(() => null);
      if (besked && besked.delete) {
        await besked.delete();
        console.log(`[Discord] Besked slettet: ${msgId}`);
      }
    }
  } catch (e) {
    console.warn(`[Discord] Kunne ikke slette gammel besked: ${e.message}`);
  }
}

// ── Slet alle tråde/beskeder der matcher rapport-nummer ──────────────────────
async function sletTrådemedRapportNr(kanalId, rapportNr) {
  if (!rapportNr) return;
  try {
    const kanal = await hentKanal(kanalId);
    if (!kanal) return;
    const erForum = kanal.type === 15 || kanal.constructor?.name === 'ForumChannel';

    if (erForum) {
      // Søg i aktive og arkiverede tråde
      const aktive = await kanal.threads.fetchActive().catch(() => ({ threads: new Map() }));
      const arkiv  = await kanal.threads.fetchArchived({ limit: 50 }).catch(() => ({ threads: new Map() }));
      const alleTråde = [...aktive.threads.values(), ...arkiv.threads.values()];

      for (const tråd of alleTråde) {
        if (tråd.name && tråd.name.includes(rapportNr)) {
          try {
            await tråd.delete();
            console.log(`[Discord] Slettet gammel tråd: ${tråd.name}`);
          } catch (e) {
            console.warn(`[Discord] Kunne ikke slette tråd ${tråd.name}: ${e.message}`);
          }
        }
      }
    } else {
      // Tekstkanal — søg i seneste beskeder
      const msgs = await kanal.messages.fetch({ limit: 50 }).catch(() => null);
      if (!msgs) return;
      for (const msg of msgs.values()) {
        const harRapportNr = msg.embeds?.some(e =>
          (e.title || '').includes(rapportNr) ||
          (e.footer?.text || '').includes(rapportNr) ||
          (e.description || '').includes(rapportNr)
        );
        if (harRapportNr) {
          try {
            await msg.delete();
            console.log(`[Discord] Slettet gammel besked med ${rapportNr}`);
          } catch (e) {
            console.warn(`[Discord] Kunne ikke slette besked: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    console.warn(`[Discord] sletTrådemedRapportNr fejl: ${e.message}`);
  }
}

// ── Send ny besked ────────────────────────────────────────────────────────────
async function sendTilKanal(kanalId, navn, indhold) {
  const kanal = await hentKanal(kanalId);
  if (!kanal) { console.warn(`[Discord] Kanal ${kanalId} ikke fundet`); return null; }
  try {
    const erForum = kanal.type === 15 || kanal.constructor?.name === 'ForumChannel';
    if (erForum) {
      const thread = await kanal.threads.create({ name: navn.substring(0, 100), message: indhold });
      return thread.id;
    }
    if (typeof kanal.send === 'function') {
      const msg = await kanal.send(indhold);
      return msg.id;
    }
    return null;
  } catch (e) {
    console.error(`[Discord] Send fejl (type ${kanal.type}):`, e.message);
    return null;
  }
}

// ── Hjælpefunktioner ──────────────────────────────────────────────────────────
function trunc(str, max = 1024) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;
  return s.length > max ? s.substring(0, max - 3) + '...' : s;
}

function parse(val, fallback) {
  if (typeof val === 'object' && val !== null) return val;
  try { return JSON.parse(val || (Array.isArray(fallback) ? '[]' : '{}')); }
  catch { return fallback; }
}

function typeLabel(type) {
  const m = {
    'hændelse':    'Hændelsesrapport',
    'trafikulykke':'Trafikulykke',
    'indbrud':     'Indbrud',
    'vold':        'Voldsrapport',
    'forfølgelse': 'Forfølgelsesrapport',
    'røveri':      'Røveri',
    'anholdelse':  'Anholdelsesrapport',
    'bøde':        'Bøderapport',
    'skyderi':     'Skyderi',
    'andet':       'Rapport',
  };
  return m[type] || 'Rapport';
}

const TYPE_FARVER = {
  'hændelse':    0x3b82f6,
  'trafikulykke':0xe6b422,
  'indbrud':     0xe8720c,
  'vold':        0xc0392b,
  'forfølgelse': 0x8e44ad,
  'røveri':      0xe67e22,
  'anholdelse':  0x1e8449,
  'bøde':        0xb7950b,
  'skyderi':     0x922b21,
  'andet':       0x4a5568,
};

// ── Post BØDE til Discord ─────────────────────────────────────────────────────
async function postBode(data) {
  const nu      = new Date();
  const datoStr = data.dato || nu.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const tidStr  = data.tid  || nu.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });

  let fristStr = data.betalingsfrist || null;
  if (!fristStr) {
    const frist = new Date(nu);
    frist.setDate(frist.getDate() + 7);
    fristStr = frist.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  const overtraedelser      = data.paragraffer || [];
  const overtraedelsesTekst = overtraedelser.length
    ? overtraedelser.map((p, i) => `${i + 1}.  ${p}`).join('\n')
    : '—';
  const totalBeloeb = Number(data.beloeb || 0);

  const embed = new EmbedBuilder()
    .setColor(0xb7950b)
    .setTitle(`BØDE  —  ${data.borger_navn}  —  ${data.bode_nr}`)
    .setDescription([
      `**Bøde nr.** ${data.bode_nr}`,
      `**Status** Ubetalt`,
      `**Dato** ${datoStr}  ·  ${tidStr}`,
      `**Udstedt af** ${data.betjent_navn}`,
      data.lokation   ? `**Lokation** ${data.lokation}`     : null,
      data.postnummer ? `**Postnummer** ${data.postnummer}` : null,
    ].filter(Boolean).join('\n'))
    .addFields(
      {
        name: '━━━━━━━━━━━━━━━\nUDSTEDENDE BETJENT',
        value: [
          `**Navn** ${data.betjent_navn}`,
          data.betjent_rang     ? `**Rang** ${data.betjent_rang}`         : null,
          data.betjent_badge    ? `**Badge nr.** ${data.betjent_badge}`   : null,
          data.betjent_signal   ? `**Kaldesignal** ${data.betjent_signal}`: null,
          data.betjent_afdeling ? `**Afdeling** ${data.betjent_afdeling}` : null,
          `**Myndighed** ${data.betjent_myndighed || 'Københavns Politi'}`,
        ].filter(Boolean).join('\n'),
        inline: false
      },
      {
        name: '━━━━━━━━━━━━━━━\nBORGER',
        value: [
          `**Navn** ${data.borger_navn}`,
          data.borger_cpr     ? `**CPR-Nummer** ${data.borger_cpr}`      : null,
          data.borger_foedsel ? `**Fødselsdato** ${data.borger_foedsel}` : null,
          data.borger_kon     ? `**Køn** ${data.borger_kon}`             : null,
          data.borger_adresse ? `**Adresse** ${data.borger_adresse}`     : null,
        ].filter(Boolean).join('\n') || '—',
        inline: false
      },
      {
        name: `━━━━━━━━━━━━━━━\nOVERTRÆDELSER  (${overtraedelser.length})`,
        value: trunc(overtraedelsesTekst, 1024),
        inline: false
      },
      {
        name: '━━━━━━━━━━━━━━━\nBØDE',
        value: [
          `**Samlet beløb** kr. ${totalBeloeb.toLocaleString('da-DK')}`,
          `**Betalingsfrist** ${fristStr}`,
        ].join('\n'),
        inline: false
      }
    );

  // Køretøj hvis relevant
  if (data.koeretoej_plade || data.koeretoej_model) {
    embed.addFields({
      name: '━━━━━━━━━━━━━━━\nKØRETØJ',
      value: [
        data.koeretoej_plade ? `**Nummerplade** ${data.koeretoej_plade}` : null,
        data.koeretoej_model ? `**Køretøj** ${data.koeretoej_model}`     : null,
        data.koeretoej_farve ? `**Farve** ${data.koeretoej_farve}`       : null,
      ].filter(Boolean).join('\n'),
      inline: false
    });
  }

  // Bemærkninger
  if (data.noter && data.noter.trim()) {
    embed.addFields({ name: '━━━━━━━━━━━━━━━\nBEMÆRKNINGER', value: trunc(data.noter, 512), inline: false });
  }

  embed
    .setFooter({ text: `${data.betjent_navn}  ·  ${data.bode_nr}  ·  Frist: ${fristStr}` })
    .setTimestamp();

  const trådNavn = `Bøde — ${data.borger_navn} — ${data.bode_nr}`;
  return sendTilKanal(process.env.DISCORD_BOEDE_KANAL_ID, trådNavn, { embeds: [embed] });
}

// ── IDENTIFIKATION: Søg på CPR-nummer ────────────────────────────────────────
async function soegIdentifikationCPR(cpr) {
  const kanalId = process.env.DISCORD_IDENTIFIKATION_KANAL_ID;
  if (!kanalId || !client?.isReady()) return null;

  try {
    const kanal = await client.channels.fetch(kanalId).catch(() => null);
    if (!kanal) return null;

    const aktive = await kanal.threads.fetchActive().catch(() => ({ threads: new Map() }));
    const arkiv1 = await kanal.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));
    const alleTråde = [...aktive.threads.values(), ...arkiv1.threads.values()];

    for (const tråd of alleTråde) {
      try {
        const msgs = await tråd.messages.fetch({ limit: 3 });
        for (const msg of msgs.values()) {
          for (const embed of msg.embeds) {
            const cprFelt = embed.fields?.find(f =>
              f.name.toLowerCase().includes('cpr')
            );
            if (cprFelt && cprFelt.value.replace(/\s/g,'') === cpr.replace(/\s/g,'')) {
              // Fundet! Hent alle felter
              const navnFelt    = embed.fields?.find(f => f.name.toLowerCase() === 'navn');
              const kønFelt     = embed.fields?.find(f => f.name.toLowerCase().includes('køn'));
              const adresseFelt = embed.fields?.find(f => f.name.toLowerCase().includes('adresse'));
              const footer      = embed.footer?.text || '';
              // Udtræk discord ID fra footer
              const discordId   = footer.split('·').pop()?.trim() || null;
              const username    = footer.split('·')[0]?.trim() || tråd.name;

              return {
                roblox_navn:  tråd.name,
                rp_navn:      navnFelt?.value || '',
                navn:         navnFelt?.value || '',
                cpr:          cprFelt?.value || cpr,
                kon:          kønFelt?.value || 'Mand',
                adresse:      adresseFelt?.value || 'Hjemløs',
                discord_id:   discordId,
                username,
                tråd_id:      tråd.id,
                tråd_navn:    tråd.name,
              };
            }
          }
        }
      } catch {}
    }
    return null;
  } catch (e) {
    console.error('[ID] soegIdentifikationCPR fejl:', e.message);
    return null;
  }
}

// ── IDENTIFIKATION: Hent alle ID-kort (til dashboard) ────────────────────────
async function hentAlleIdKort() {
  const kanalId = process.env.DISCORD_IDENTIFIKATION_KANAL_ID;
  if (!kanalId || !client?.isReady()) return [];

  try {
    const kanal = await client.channels.fetch(kanalId).catch(() => null);
    if (!kanal) return [];

    const aktive = await kanal.threads.fetchActive().catch(() => ({ threads: new Map() }));
    const arkiv1 = await kanal.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));
    const arkiv2 = await kanal.threads.fetchArchived({ limit: 100, before: [...arkiv1.threads.values()].pop()?.id }).catch(() => ({ threads: new Map() }));
    const alleTråde = [
      ...aktive.threads.values(),
      ...arkiv1.threads.values(),
      ...arkiv2.threads.values(),
    ];

    const resultat = [];
    for (const tråd of alleTråde) {
      try {
        const msgs = await tråd.messages.fetch({ limit: 3 });
        for (const msg of msgs.values()) {
          for (const embed of msg.embeds) {
            const cprFelt     = embed.fields?.find(f => f.name.toLowerCase().includes('cpr'));
            const navnFelt    = embed.fields?.find(f => f.name.toLowerCase() === 'navn');
            const kønFelt     = embed.fields?.find(f => f.name.toLowerCase().includes('køn'));
            const adresseFelt = embed.fields?.find(f => f.name.toLowerCase().includes('adresse'));
            if (cprFelt) {
              const footer   = embed.footer?.text || '';
              const username = footer.split('·')[0]?.trim() || tråd.name;
              const discordId= footer.split('·').pop()?.trim() || null;
              resultat.push({
                tråd_id:  tråd.id,
                username,
                discord_id: discordId,
                navn:     navnFelt?.value || '—',
                cpr:      cprFelt?.value  || '—',
                kon:      kønFelt?.value  || 'Mand',
                adresse:  adresseFelt?.value || 'Hjemløs',
                msg_id:   msg.id,
              });
              break;
            }
          }
        }
      } catch {}
    }

    return resultat.sort((a,b) => a.navn.localeCompare(b.navn, 'da'));
  } catch (e) {
    console.error('[ID] hentAlleIdKort fejl:', e.message);
    return [];
  }
}

// ── IDENTIFIKATION: Opdater et ID-kort ───────────────────────────────────────
async function opdaterIdKort(trådId, data) {
  if (!client?.isReady()) throw new Error('Bot ikke klar');
  const { navn, kon, adresse, cpr, username } = data;

  // Hent tråden
  const tråd = await client.channels.fetch(trådId).catch(() => null);
  if (!tråd) throw new Error('Tråd ikke fundet');

  // Hent første besked med embed
  const msgs = await tråd.messages.fetch({ limit: 5 });
  let målBesked = null;
  for (const msg of msgs.values()) {
    if (msg.embeds?.length) { målBesked = msg; break; }
  }
  if (!målBesked) throw new Error('Ingen embed-besked fundet i tråden');

  // Byg opdateret embed
  const embed = new EmbedBuilder()
    .setColor(0x1a2e4a)
    .setTitle('IDENTIFIKATIONSKORT')
    .addFields(
      { name: 'Navn',       value: navn || '—',      inline: false },
      { name: 'CPR-Nummer', value: cpr  || '—',      inline: false },
      { name: 'Køn',        value: kon  || 'Mand',   inline: false },
      { name: 'Adresse',    value: adresse || 'Hjemløs', inline: false },
    )
    .setFooter({ text: `${username || tråd.name}  ·  ${målBesked.author?.id || ''}` })
    .setTimestamp();

  await målBesked.edit({ embeds: [embed] });
  console.log(`[ID] ID-kort opdateret: ${tråd.name} → ${navn}`);
}

// ── Søg i identifikations-forum efter person ──────────────────────────────────
async function soegIdentifikation(query) {
  const kanalId = process.env.DISCORD_IDENTIFIKATION_KANAL_ID;
  if (!kanalId) return null;

  const kanal = await hentKanal(kanalId);
  if (!kanal) return null;

  const q = query.toLowerCase().trim();

  try {
    // Hent aktive og arkiverede tråde
    const aktive = await kanal.threads.fetchActive().catch(() => ({ threads: new Map() }));
    const arkiv1 = await kanal.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));
    const arkiv2 = await kanal.threads.fetchArchived({ limit: 100, before: arkiv1.threads.last()?.id }).catch(() => ({ threads: new Map() }));

    const alleTråde = [
      ...aktive.threads.values(),
      ...arkiv1.threads.values(),
      ...arkiv2.threads.values(),
    ];

    // Find tråde der matcher query i tråd-navn
    const matchendeTråde = alleTråde.filter(t =>
      t.name.toLowerCase().includes(q)
    );

    if (!matchendeTråde.length) return null;

    // Tag den nyeste match
    const tråd = matchendeTråde.sort((a, b) =>
      (b.createdTimestamp || 0) - (a.createdTimestamp || 0)
    )[0];

    // Hent første besked i tråden (identifikationskortet)
    const msgs = await tråd.messages.fetch({ limit: 5 });
    const beskeder = [...msgs.values()];

    // Saml al tekst + embed-felter fra beskeder
    let robloxNavn = '';
    let rpNavn     = '';
    let foedsel    = '';
    let kon        = '';
    let adresse    = '';
    let discord_id = tråd.ownerId || null;

    for (const msg of beskeder) {
      // Tjek embeds
      for (const embed of msg.embeds) {
        const felter = embed.fields || [];
        const desc   = embed.description || '';
        const titel  = embed.title || '';
        const alTekst = (titel + ' ' + desc + ' ' + felter.map(f => f.name + ' ' + f.value).join(' ')).toLowerCase();

        // Udtræk felter
        for (const felt of felter) {
          const navn = felt.name.toLowerCase();
          const val  = felt.value?.trim() || '';
          if (navn.includes('roblox') || navn.includes('brugernavn') || navn.includes('username'))  { if (!robloxNavn) robloxNavn = val; }
          if (navn.includes('rp navn') || navn.includes('rpnavn') || navn.includes('karakter') || navn.includes('navn') && !navn.includes('roblox')) { if (!rpNavn) rpNavn = val; }
          if (navn.includes('fødsel') || navn.includes('birthday') || navn.includes('alder'))        { if (!foedsel) foedsel = val; }
          if (navn.includes('køn') || navn.includes('gender'))                                        { if (!kon) kon = val; }
          if (navn.includes('adresse') || navn.includes('address') || navn.includes('bopæl'))        { if (!adresse) adresse = val; }
        }

        // Fallback: udtræk fra description med regex
        if (!robloxNavn) {
          const m = desc.match(/roblox[:\s]+([^\n,]+)/i);
          if (m) robloxNavn = m[1].trim();
        }
        if (!rpNavn) {
          const m = desc.match(/(?:rp navn|karakter|navn)[:\s]+([^\n,]+)/i);
          if (m) rpNavn = m[1].trim();
        }
        if (!foedsel) {
          const m = desc.match(/(?:fødsel|birthday|alder)[:\s]+([^\n,]+)/i);
          if (m) foedsel = m[1].trim();
        }
      }

      // Tjek også plain text beskeder
      const tekst = msg.content;
      if (tekst) {
        if (!robloxNavn) { const m = tekst.match(/roblox[:\s]+([^\n,]+)/i); if (m) robloxNavn = m[1].trim(); }
        if (!rpNavn)     { const m = tekst.match(/(?:rp navn|karakter)[:\s]+([^\n,]+)/i); if (m) rpNavn = m[1].trim(); }
        if (!foedsel)    { const m = tekst.match(/(?:fødsel|birthday)[:\s]+([^\n,]+)/i); if (m) foedsel = m[1].trim(); }
        if (!discord_id) { discord_id = msg.author?.id || null; }
      }
    }

    // Tråd-navn bruges som fallback for navn
    if (!robloxNavn && !rpNavn) {
      // Tråd-navn er typisk "Fornavn Efternavn" eller "RobloxNavn | RP navn"
      const tråd_navn = tråd.name;
      const split = tråd_navn.split(/[|\/\-–]/);
      if (split.length >= 2) {
        robloxNavn = split[0].trim();
        rpNavn     = split[1].trim();
      } else {
        robloxNavn = tråd_navn.trim();
      }
    }

    return {
      roblox_navn:  robloxNavn || tråd.name,
      rp_navn:      rpNavn || '',
      foedselsdato: foedsel || '',
      kon:          kon || '',
      adresse:      adresse || '',
      discord_id:   discord_id,
      tråd_id:      tråd.id,
      tråd_navn:    tråd.name,
    };

  } catch (e) {
    console.error('[Discord] soegIdentifikation fejl:', e.message);
    return null;
  }
}


async function postEboks(data) {
  const kanalId = process.env.DISCORD_MAIN_EBOKS_KANAL_ID;
  if (!kanalId) {
    console.warn('[Discord] DISCORD_MAIN_EBOKS_KANAL_ID ikke sat i .env');
    return null;
  }

  const nu      = new Date();
  const datoStr = nu.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const tidStr  = nu.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });

  // Betalingsfrist — standard 7 dage hvis ikke angivet
  let fristStr = data.betalingsfrist || null;
  if (!fristStr) {
    const frist = new Date(nu);
    frist.setDate(frist.getDate() + 7);
    fristStr = frist.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  const mention            = data.discord_id ? `<@${data.discord_id}>` : null;
  const overtraedelser     = data.paragraffer || [];
  const overtraedelsesTekst = overtraedelser.length
    ? overtraedelser.map((p, i) => `${i + 1}.  ${p}`).join('\n')
    : '—';
  const totalBeloeb = Number(data.beloeb || 0);

  const embed = new EmbedBuilder()
    .setColor(0xb7950b)
    .setTitle(`BØDE  —  ${data.borger_navn}  —  ${data.bode_nr}`)
    .setDescription(mention
      ? `${mention}\nDu har modtaget en bøde udstedt af **${data.betjent_navn}**.\nBøden skal betales inden betalingsfristen. Kontakt en betjent ved spørgsmål.`
      : `Der er udstedt en bøde til **${data.borger_navn}** af **${data.betjent_navn}**.\nBøden skal betales inden betalingsfristen.`
    )
    .addFields(
      {
        name: '━━━━━━━━━━━━━━━\nBORGER',
        value: [
          `**Navn** ${data.borger_navn}`,
          data.borger_cpr     ? `**CPR-Nummer** ${data.borger_cpr}`      : null,
          data.borger_foedsel ? `**Fødselsdato** ${data.borger_foedsel}` : null,
          data.borger_kon     ? `**Køn** ${data.borger_kon}`             : null,
          data.borger_adresse ? `**Adresse** ${data.borger_adresse}`     : null,
        ].filter(Boolean).join('\n'),
        inline: false
      },
      {
        name: '━━━━━━━━━━━━━━━\nUDSTEDENDE BETJENT',
        value: [
          `**Navn** ${data.betjent_navn}`,
          data.betjent_rang   ? `**Rang** ${data.betjent_rang}`          : null,
          data.betjent_badge  ? `**Badge nr.** ${data.betjent_badge}`    : null,
          data.betjent_signal ? `**Kaldesignal** ${data.betjent_signal}` : null,
          `**Myndighed** ${data.betjent_myndighed || 'Københavns Politi'}`,
        ].filter(Boolean).join('\n'),
        inline: false
      },
      {
        name: '━━━━━━━━━━━━━━━\nTIDSPUNKT OG LOKATION',
        value: [
          `**Dato** ${datoStr}  ·  ${tidStr}`,
          data.lokation   ? `**Lokation** ${data.lokation}`   : null,
          data.postnummer ? `**Postnummer** ${data.postnummer}` : null,
        ].filter(Boolean).join('\n'),
        inline: false
      },
      {
        name: `━━━━━━━━━━━━━━━\nOVERTRÆDELSER  (${overtraedelser.length})`,
        value: trunc(overtraedelsesTekst, 1024),
        inline: false
      },
      {
        name: '━━━━━━━━━━━━━━━\nBØDE',
        value: [
          `**Bøde nr.** ${data.bode_nr}`,
          `**Samlet beløb** kr. ${totalBeloeb.toLocaleString('da-DK')}`,
          `**Betalingsfrist** ${fristStr}`,
          `**Status** Ubetalt`,
        ].join('\n'),
        inline: false
      }
    );

  if (data.koeretoej_plade || data.koeretoej_model) {
    embed.addFields({
      name: '━━━━━━━━━━━━━━━\nKØRETØJ',
      value: [
        data.koeretoej_plade ? `**Nummerplade** ${data.koeretoej_plade}` : null,
        data.koeretoej_model ? `**Køretøj** ${data.koeretoej_model}`     : null,
        data.koeretoej_farve ? `**Farve** ${data.koeretoej_farve}`       : null,
      ].filter(Boolean).join('\n'),
      inline: false
    });
  }

  if (data.noter && data.noter.trim()) {
    embed.addFields({ name: '━━━━━━━━━━━━━━━\nBEMÆRKNINGER', value: trunc(data.noter, 512), inline: false });
  }

  embed
    .setFooter({ text: `${data.betjent_navn}  ·  ${data.bode_nr}  ·  Frist: ${fristStr}` })
    .setTimestamp();

  const trådNavn    = `Bøde — ${data.borger_navn} — ${data.bode_nr}`;
  const beskedIndhold = {
    content: mention ? `${mention} — Du har modtaget en bøde. Se detaljer nedenfor.` : undefined,
    embeds: [embed]
  };

  return sendTilKanal(kanalId, trådNavn, beskedIndhold);
}

// ── Post / Gensend RAPPORT til Discord ───────────────────────────────────────
async function postRapport(data) {
  const farve    = TYPE_FARVER[data.type] || 0x4a5568;
  const mistankt = parse(data.mistankt,  {});
  const medical  = parse(data.medical,   {});
  const transport= parse(data.transport, {});
  const tiltalepunkter = parse(data.tiltalepunkter, []);
  const citations      = parse(data.citations,      []);
  const betjente       = parse(data.betjente,       []);

  const nu          = new Date();
  const datoStr     = nu.toLocaleDateString('da-DK',  { day:'2-digit', month:'2-digit', year:'numeric' });
  const tidStr      = nu.toLocaleTimeString('da-DK',   { hour:'2-digit', minute:'2-digit' });
  const statusLabel = { kladde:'Kladde', indsendt:'Indsendt', godkendt:'Godkendt' }[data.status] || 'Indsendt';

  // ── Bygger én stor samlet embed ───────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(farve)
    .setTitle(`${typeLabel(data.type).toUpperCase()}`)
    .setTimestamp();

  // ── HEADER: rapport-metadata som description ──────────────────────────────
  const headerLinjer = [
    `**Rapport nr.** ${data.rapport_nr}`,
    `**Status** ${statusLabel}`,
    `**Dato** ${datoStr}  ·  ${tidStr}`,
    `**Oprettet af** ${data.betjent_navn}`,
  ];
  if (data.lokation) headerLinjer.push(`**Lokation** ${data.lokation}`);
  // Sæt titel med mistænktens navn hvis relevant
  const mistanktNavn = mistankt?.navn || '';
  const embedTitel = mistanktNavn
    ? `${typeLabel(data.type).toUpperCase()}  —  ${mistanktNavn}  —  ${data.rapport_nr}`
    : `${typeLabel(data.type).toUpperCase()}  —  ${data.rapport_nr}`;
  embed.setTitle(embedTitel);

  embed.setDescription(headerLinjer.join('\n'));

  // ── SEKTION: Rapporterende betjent ────────────────────────────────────────
  const betjentLinjer = [
    `**Navn** ${data.betjent_rn || data.betjent_navn || '—'}`,
    data.betjent_rang   ? `**Rang** ${data.betjent_rang}`   : null,
    data.betjent_badge  ? `**Badge nr.** ${data.betjent_badge}` : null,
    data.betjent_signal ? `**Kaldesignal** ${data.betjent_signal}` : null,
    data.betjent_afdeling ? `**Afdeling** ${data.betjent_afdeling}` : null,
    `**Myndighed** ${data.betjent_myndighed || 'Københavns Politi'}`,
  ].filter(Boolean);

  // Ekstra enheder
  if (betjente.length) {
    betjentLinjer.push(`**Ekstra enheder** ${betjente.join('  ·  ')}`);
  }
  embed.addFields({ name: '━━━━━━━━━━━━━━━\nRAPPORTERENDE BETJENT', value: betjentLinjer.join('\n'), inline: false });

  // ── SEKTION: Tidspunkt & Lokation ─────────────────────────────────────────
  const lokLinjer = [
    `**Dato** ${datoStr}`,
    `**Tidspunkt** ${tidStr}`,
    `**Rapport nr.** ${data.rapport_nr}`,
    data.lokation   ? `**Gade / Område** ${data.lokation}` : null,
    data.postnummer ? `**Postnummer** ${data.postnummer}`  : null,
  ].filter(Boolean);
  embed.addFields({ name: '━━━━━━━━━━━━━━━\nTIDSPUNKT OG LOKATION', value: lokLinjer.join('\n'), inline: false });

  // ── SEKTION: Mistænkt / Involverede ──────────────────────────────────────
  const mist = [
    mistankt.navn        ? `**Navn** ${mistankt.navn}`               : null,
    mistankt.cpr         ? `**CPR-Nummer** ${mistankt.cpr}`         : null,
    mistankt.foedsel     ? `**Fødselsdato** ${mistankt.foedsel}`     : null,
    mistankt.kon         ? `**Køn** ${mistankt.kon}`                 : null,
    mistankt.adresse     ? `**Adresse** ${mistankt.adresse}`         : null,
    mistankt.beskrivelse ? `**Signalement** ${mistankt.beskrivelse}` : null,
    mistankt.info        ? `**Øvrige info** ${mistankt.info}`        : null,
  ].filter(Boolean);
  if (mist.length) {
    embed.addFields({ name: '━━━━━━━━━━━━━━━\nMISTÆNKT / INVOLVEREDE', value: trunc(mist.join('\n')), inline: false });
  }

  // ── SEKTION: Medicinske detaljer ─────────────────────────────────────────
  const med = [
    medical.magtanvendelse   ? '**Magtanvendelse** Ja'                          : '**Magtanvendelse** Nej',
    medical.vaaben           ? `**Anvendte våben** ${medical.vaaben}`           : null,
    medical.skadestype       ? `**Skadestype** ${medical.skadestype}`           : null,
    medical.skadesdetaljer   ? `**Skadesdetaljer** ${medical.skadesdetaljer}`   : null,
    medical.afslogBehandling ? '**Afslog behandling** Ja'                       : null,
    medical.emsTransport     ? '**EMS transport** Ja'                           : null,
    medical.transportDetaljer? `**Transport** ${medical.transportDetaljer}`     : null,
    medical.andet            ? `**Andet** ${medical.andet}`                     : null,
  ].filter(Boolean);
  // Vis kun sektionen hvis noget er udfyldt ud over "Magtanvendelse Nej"
  const medRelevant = med.filter(l => l !== '**Magtanvendelse** Nej');
  if (medRelevant.length) {
    embed.addFields({ name: '━━━━━━━━━━━━━━━\nMEDICINSKE DETALJER', value: trunc(med.join('\n')), inline: false });
  }

  // ── SEKTION: Arrest Details (kun anholdelse) ──────────────────────────────
  if (data.type === 'anholdelse' && tiltalepunkter.length) {
    const punktTekst = tiltalepunkter.map((p, i) => `${i + 1}.  ${p}`).join('\n');
    embed.addFields({ name: `━━━━━━━━━━━━━━━\nARREST DETAILS  (${tiltalepunkter.length} tiltalepunkter)`, value: trunc(punktTekst), inline: false });
  }

  // ── SEKTION: Transport (kun anholdelse) ───────────────────────────────────
  if (data.type === 'anholdelse') {
    const transLinjer = [
      `**Selvtransporteret** ${transport.selfTransport ? 'Ja' : 'Nej'}`,
      transport.betjent ? `**Transporterende betjent** ${transport.betjent}` : null,
    ].filter(Boolean);
    embed.addFields({ name: '━━━━━━━━━━━━━━━\nTRANSPORT', value: transLinjer.join('\n'), inline: false });
  }

  // ── SEKTION: Citation / Bøde (kun bøde-type) ──────────────────────────────
  if (data.type === 'bøde' && citations.length) {
    const total   = citations.reduce((s, c) => s + (c.b || c.bøde || 0), 0);
    const citLinjer = citations.map(c => {
      const beloeb = (c.b || c.bøde || 0);
      const arrest = c.a ? '  [KAN ANHOLDES]' : '';
      return `${c.n || c.navn}  —  kr. ${beloeb.toLocaleString('da-DK')}${arrest}`;
    });
    embed.addFields({
      name: `━━━━━━━━━━━━━━━\nBØDE / CITATIONS  ·  Total: kr. ${total.toLocaleString('da-DK')}`,
      value: trunc(citLinjer.join('\n')),
      inline: false
    });
  }

  // ── SEKTION: Hændelsesforløb (alle typer undtagen anholdelse+bøde) ─────────
  if (!['anholdelse','bøde'].includes(data.type) && data.beskrivelse && data.beskrivelse.trim()) {
    embed.addFields({ name: '━━━━━━━━━━━━━━━\nHÆNDELSESFORLØB', value: trunc(data.beskrivelse), inline: false });
  }
  // Hændelsesforløb for anholdelse/bøde hvis der alligevel er noget
  if (['anholdelse','bøde'].includes(data.type) && data.beskrivelse && data.beskrivelse.trim()) {
    embed.addFields({ name: '━━━━━━━━━━━━━━━\nBEMÆRKNINGER', value: trunc(data.beskrivelse), inline: false });
  }

  // ── SEKTION: Noter ────────────────────────────────────────────────────────
  if (data.noter && data.noter.trim()) {
    embed.addFields({ name: '━━━━━━━━━━━━━━━\nNOTER', value: trunc(data.noter, 512), inline: false });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  embed.setFooter({ text: `${data.betjent_navn}  ·  ${data.rapport_nr}  ·  ${statusLabel}` });

  // Byg forum-trådens titel: "Anholdelse — Navn — R-nummer"
  const mistanktNavn2 = mistankt?.navn || '';
  const trådTitel = mistanktNavn2
    ? `${typeLabel(data.type)} — ${mistanktNavn2} — ${data.rapport_nr}`
    : `${typeLabel(data.type)} — ${data.rapport_nr}`;

  // Slet ALLE eksisterende tråde med samme rapport-nummer
  await sletTrådemedRapportNr(process.env.DISCORD_RAPPORT_KANAL_ID, data.rapport_nr);

  return sendTilKanal(
    process.env.DISCORD_RAPPORT_KANAL_ID,
    trådTitel,
    { embeds: [embed] }
  );
}

// ── Post EFTERLYST til Discord ─────────────────────────────────────────────────
async function postEfterlyst(data) {
  const embed = new EmbedBuilder()
    .setTitle(`EFTERLYST — ${data.navn}`)
    .setColor(0xc0392b)
    .setDescription([
      `**Navn:** ${data.navn}`,
      `**Toej:** ${data.toej || '—'}`,
      `**Sigtet for:** ${data.sigtet_for || '—'}`,
      `**Vaaben:** ${data.vaaben || 'Ingen oplysninger'}`,
      `**Andet:** ${data.andet || '—'}`,
    ].join('\n'))
    .setFooter({ text: `Oprettet af: ${data.betjent_navn}` })
    .setTimestamp();
  return sendTilKanal(process.env.DISCORD_EFTERLYST_KANAL_ID, data.navn, { embeds: [embed] });
}

// ── Post ANHOLDELSE til Discord ───────────────────────────────────────────────
async function postAnholdelse(data, betjent) {
  const embed = new EmbedBuilder()
    .setTitle(`ANHOLDELSE — ${data.anholdt_navn}`)
    .setColor(0x1e8449)
    .addFields(
      { name: 'NAVN PAA SIGTEDE', value: data.anholdt_navn, inline: true },
      { name: 'DATO',             value: new Date().toLocaleDateString('da-DK'), inline: true },
      { name: 'ANKLAGEPUNKTER',   value: trunc(JSON.parse(data.anklage_punkter||'[]').join('\n') || '—'), inline: false },
      { name: 'HAENDELSESFORLOEB',value: trunc(data.beskrivelse || '—'), inline: false },
      { name: 'LOKATION',         value: data.lokation || '—', inline: true },
      { name: 'VAABEN FUNDET',    value: data.vaaben_fundet  ? 'Ja' : 'Nej', inline: true },
      { name: 'STOFFER FUNDET',   value: data.stoffer_fundet ? 'Ja' : 'Nej', inline: true },
      { name: 'FAENGSELSSTRAF',   value: data.faengsel_tid || 'Ingen', inline: true },
      { name: 'BOEDE',            value: data.boede_beloeb > 0 ? `kr. ${data.boede_beloeb.toLocaleString('da-DK')}` : 'Ingen', inline: true },
    )
    .setFooter({ text: `${betjent.rang} ${betjent.fornavn} ${betjent.efternavn} [${betjent.badge_nummer}]  ·  ${data.rapport_nr}` })
    .setTimestamp();
  return sendTilKanal(process.env.DISCORD_ANHOLDELSE_KANAL_ID,
    `${data.anholdt_navn} — ${data.rapport_nr}`, { embeds: [embed] });
}

async function soegIdentifikationCPR4(sidst4) {
  const alle = await hentAlleIdKort();
  return alle.filter(k => k.cpr && k.cpr.replace(/[-\s]/g, '').slice(-4) === sidst4);
}

module.exports = { init, hentBeskeder, soegIdentifikation, soegIdentifikationCPR, soegIdentifikationCPR4, hentAlleIdKort, opdaterIdKort, postBode, postEboks, postRapport, postEfterlyst, postAnholdelse, sletGammelBesked };
