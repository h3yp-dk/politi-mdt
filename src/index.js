require('dotenv').config();
const express  = require('express');
const http     = require('http');
const cors     = require('cors');
const path     = require('path');

const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve statiske filer (web frontend)
const PUBLIC = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC));

// Web ruter
app.get('/',          (_, res) => res.redirect('/login'));
app.get('/login',     (_, res) => res.sendFile(path.join(PUBLIC, 'login.html')));
app.get('/registrer', (_, res) => res.sendFile(path.join(PUBLIC, 'registrer.html')));
app.get('/app',       (_, res) => res.sendFile(path.join(PUBLIC, 'app.html')));

// Sub-sider til iframes
const SIDER = ['dashboard','kort','opslag','boeder','anholdelser','rapporter','retssager','profil','admin','identifikation'];
SIDER.forEach(s => {
  app.get(`/sider/${s}`, (_, res) => res.sendFile(path.join(PUBLIC, 'sider', `${s}.html`)));
});

app.get('/status', (_, res) => res.json({
  ok: true, tid: new Date().toISOString(), version: '1.0.0'
}));

const PORT = process.env.PORT || 3001;

const { init: initDB } = require('./db/database');
const { init: initWS } = require('./websocket');
const { init: initBot } = require('./routes/discord');

initDB().then(() => {
  // Registrer API-ruter EFTER database er klar
  app.use('/auth',    require('./routes/auth'));
  app.use('/cab',     require('./routes/cab'));
  app.use('/erlc',    require('./routes/erlc'));
  app.use('/data',    require('./routes/data'));
  app.use('/discord', require('./routes/discord_api'));

  initWS(server);
  initBot();

  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║     🚔  DANSK POLITI MDT  🚔          ║
║     Backend kører på port ${PORT}        ║
╚═══════════════════════════════════════╝
    `);
  });
}).catch(err => {
  console.error('Kunne ikke starte:', err.message);
  process.exit(1);
});
