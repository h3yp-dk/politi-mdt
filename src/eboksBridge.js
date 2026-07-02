// Bro til erlc-borgerservice's e-Boks — leverer formelle boede/anholdelse/rapport-beskeder.
// Samme moenster som Bilregisterets interne opslags-API (X-Internal-Key, delt hemmelighed).

async function sendEboks({ discord_id, afsender, type, titel, linjer, til_navn, ref, betaling }) {
  const url = process.env.ERLC_BORGERSERVICE_URL;
  const key = process.env.INTERNAL_API_KEY;
  if (!url || !key || !discord_id) return false;

  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch(`${url.replace(/\/$/, '')}/api/eboks/internt/besked`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': key },
      body: JSON.stringify({
        discord_id: String(discord_id), afsender, type, titel, linjer, til_navn, ref, betaling,
      }),
    });
    if (!r.ok) console.warn(`[eBoks] Levering afvist: HTTP ${r.status}`);
    return r.ok;
  } catch (e) {
    console.error('[eBoks] Kunne ikke levere besked:', e.message);
    return false;
  }
}

module.exports = { sendEboks };
