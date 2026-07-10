require("dotenv").config({ path: "/etc/elankav-orchestrator.env" });
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { getDockerStatus } = require('./adapters/dockerAdapter');
const { getEcosystemStatus } = require('./adapters/ecosystemAdapter');
const { getGithubStatus } = require('./adapters/githubAdapter');
const { getDashboardStatus } = require('./adapters/dashboardAdapter');

const HOST = '172.19.0.1';
const PORT = 4100;
const VERSION = '0.4.0';

const PUBLIC_DIR = path.join(__dirname, 'public');

function sendFile(res, filename, contentType) {
  const filePath = path.join(PUBLIC_DIR, filename);

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 500, {
        error: 'No fue posible cargar el recurso'
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });

    res.end(content);
  });
}

const projects = [
  {
    name: 'ELANVISUAL',
    service: 'elanvisual-platform',
    url: 'https://visual.elankav.com',
    branch: 'ESM-19-REBUILD-ELANVISUAL-CLEAN',
    status: 'Operativo',
    type: 'Producción'
  },
  {
    name: 'ELANKAV CORE',
    service: 'elankav-core',
    url: 'https://elankav-core.vercel.app',
    branch: 'WAI-07-ELAN-AI-COMMERCIAL-TRAINING',
    status: 'Operativo',
    type: 'Core / IA'
  },
  {
    name: 'ELANKAV PLATFORM',
    service: 'elankav-platform',
    url: 'https://elankav-platform.vercel.app',
    branch: 'main',
    status: 'Operativo',
    type: 'Plataforma'
  },
  {
    name: 'ELANPET',
    service: 'elanpet-platform',
    url: 'https://pet.elankav.com',
    branch: 'principal',
    status: 'Operativo',
    type: 'Producción'
  },
  {
    name: 'WAHA',
    service: 'WhatsApp HTTP API',
    url: 'https://waha.elankav.com',
    branch: 'Docker',
    status: 'Operativo',
    type: 'Integración'
  },
  {
    name: 'ORCHESTRATOR',
    service: 'elankav-orchestrator',
    url: 'https://orchestrator.elankav.com',
    branch: 'main',
    status: 'Operativo',
    type: 'Centro de Control'
  }
];

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data, null, 2));
}

function renderProjectCards() {
  return projects.map((project) => `
    <article class="card">
      <div class="card-top">
        <div>
          <span class="type">${project.type}</span>
          <h2>${project.name}</h2>
        </div>
        <span class="status"><i></i>${project.status}</span>
      </div>

      <dl>
        <div>
          <dt>Servicio</dt>
          <dd>${project.service}</dd>
        </div>
        <div>
          <dt>Rama</dt>
          <dd>${project.branch}</dd>
        </div>
      </dl>

      <a href="${project.url}" target="_blank" rel="noreferrer">
        Abrir servicio
      </a>
    </article>
  `).join('');
}

function renderDashboard() {
  const memoryUsage = Math.round(
    ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
  );

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0f172a">
  <title>ELANKAV Orchestrator</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #08111f;
      --panel: #101b2e;
      --panel-2: #152238;
      --line: #26364f;
      --text: #f8fafc;
      --muted: #94a3b8;
      --green: #22c55e;
      --gold: #c9a227;
      --blue: #38bdf8;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, Arial, sans-serif;
      background:
        radial-gradient(circle at top right, #172554 0, transparent 32%),
        var(--bg);
      color: var(--text);
    }

    header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
      padding: 18px 28px;
      border-bottom: 1px solid var(--line);
      background: rgba(8, 17, 31, 0.92);
      backdrop-filter: blur(12px);
    }

    .brand strong {
      display: block;
      font-size: 18px;
      letter-spacing: 0.08em;
    }

    .brand span,
    .updated {
      color: var(--muted);
      font-size: 12px;
    }

    main {
      width: min(1400px, 100%);
      margin: auto;
      padding: 32px 28px 60px;
    }

    .hero {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      align-items: end;
      margin-bottom: 28px;
    }

    h1 {
      margin: 0 0 10px;
      font-size: clamp(31px, 6vw, 58px);
      line-height: 0.98;
    }

    .hero p {
      max-width: 650px;
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
    }

    .global-status {
      padding: 14px 18px;
      border: 1px solid rgba(34, 197, 94, 0.35);
      border-radius: 14px;
      background: rgba(34, 197, 94, 0.08);
      color: #86efac;
      font-weight: 700;
      white-space: nowrap;
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 28px;
    }

    .metric {
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(16, 27, 46, 0.86);
    }

    .metric span {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .metric strong {
      font-size: 23px;
    }

    .section-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 32px 0 14px;
    }

    .section-title h2 {
      margin: 0;
      font-size: 20px;
    }

    .section-title span {
      color: var(--muted);
      font-size: 13px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }

    .card {
      display: flex;
      flex-direction: column;
      min-height: 245px;
      padding: 21px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background:
        linear-gradient(145deg, rgba(21, 34, 56, 0.98), rgba(12, 23, 40, 0.98));
      box-shadow: 0 18px 50px rgba(0,0,0,0.16);
    }

    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }

    .card h2 {
      margin: 7px 0 0;
      font-size: 21px;
    }

    .type {
      color: var(--blue);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: #86efac;
      font-size: 12px;
      font-weight: 700;
    }

    .status i {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 0 12px var(--green);
    }

    dl {
      display: grid;
      gap: 12px;
      margin: 25px 0;
    }

    dl div {
      display: grid;
      grid-template-columns: 80px 1fr;
      gap: 12px;
    }

    dt {
      color: var(--muted);
      font-size: 12px;
    }

    dd {
      margin: 0;
      overflow-wrap: anywhere;
      font-size: 13px;
    }

    .card a {
      margin-top: auto;
      padding: 12px 15px;
      border: 1px solid var(--line);
      border-radius: 12px;
      color: var(--text);
      text-decoration: none;
      text-align: center;
      font-weight: 700;
      transition: 0.2s ease;
    }

    .card a:hover {
      border-color: var(--gold);
      background: rgba(201, 162, 39, 0.1);
    }

    footer {
      padding-top: 34px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    @media (max-width: 980px) {
      .grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      header,
      main {
        padding-left: 18px;
        padding-right: 18px;
      }

      .hero {
        grid-template-columns: 1fr;
        align-items: start;
      }

      .metrics,
      .grid {
        grid-template-columns: 1fr;
      }

      .updated {
        display: none;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <strong>ELANKAV ORCHESTRATOR</strong>
      <span>Centro de Control Técnico</span>
    </div>
    <div class="updated">Versión ${VERSION}</div>
  </header>

  <main>
    <section class="hero">
      <div>
        <h1>Control total.<br>Desde cualquier lugar.</h1>
        <p>
          Vista central del ecosistema ELANKAV. Esta versión establece la base
          ejecutiva para proyectos, infraestructura, memoria y operadores.
        </p>
      </div>
      <div class="global-status">● SISTEMA OPERATIVO</div>
    </section>

    <section class="metrics">
      <div class="metric">
        <span>Servicios registrados</span>
        <strong>${projects.length}</strong>
      </div>
      <div class="metric">
        <span>Node.js</span>
        <strong>${process.version}</strong>
      </div>
      <div class="metric">
        <span>Memoria VPS</span>
        <strong>${memoryUsage}%</strong>
      </div>
      <div class="metric">
        <span>Uptime Orchestrator</span>
        <strong>${Math.floor(process.uptime() / 60)} min</strong>
      </div>
    </section>

    <div class="section-title">
      <h2>Ecosistema</h2>
      <span>Información inicial registrada</span>
    </div>

    <section class="grid">
      ${renderProjectCards()}
    </section>

    <footer>
      ELANKAV Orchestrator ${VERSION} · VPS ELANKAV · Memoria Maestra Viva
    </footer>
  </main>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/dashboard') {
    try {
      const dashboardStatus = await getDashboardStatus();

      sendJson(res, 200, {
        service: 'ELANKAV Orchestrator',
        version: VERSION,
        ...dashboardStatus
      });
    } catch (error) {
      sendJson(res, 503, {
        available: false,
        service: 'ELANKAV Orchestrator',
        status: 'ERROR',
        error: 'No fue posible consultar el dashboard ejecutivo',
        detail: error.message,
        checked_at: new Date().toISOString()
      });
    }

    return;
  }

  if (req.url === '/api/ecosystem') {
    try {
      const ecosystemStatus = await getEcosystemStatus();
      sendJson(res, 200, ecosystemStatus);
    } catch (error) {
      sendJson(res, 503, {
        available: false,
        error: 'No fue posible consultar el ecosistema',
        detail: error.message,
        checked_at: new Date().toISOString()
      });
    }
    return;
  }

if (req.url === '/api/github') {
  try {
    const githubStatus = await getGithubStatus();

    sendJson(res, 200, githubStatus);

  } catch (error) {

    sendJson(res, 503, {
      available: false,
      error: 'No fue posible consultar GitHub',
      detail: error.message,
      checked_at: new Date().toISOString()
    });

  }

  return;
}

  if (req.url === '/api/docker') {
    try {
      const dockerStatus = await getDockerStatus();
      sendJson(res, 200, dockerStatus);
    } catch (error) {
      sendJson(res, 503, {
        available: false,
        error: 'No fue posible consultar Docker',
        detail: error.message,
        checked_at: new Date().toISOString()
      });
    }
    return;
  }

  if (req.url === '/health' || req.url === '/api/health') {
    sendJson(res, 200, {
      service: 'ELANKAV Orchestrator',
      status: 'OK',
      version: VERSION,
      uptime_seconds: Math.floor(process.uptime()),
      node: process.version,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (req.url === '/api/projects') {
    sendJson(res, 200, {
      count: projects.length,
      projects
    });
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    sendFile(res, 'index.html', 'text/html; charset=utf-8');
    return;
  }

  if (req.url === '/styles.css') {
    sendFile(res, 'styles.css', 'text/css; charset=utf-8');
    return;
  }

  if (req.url === '/app.js') {
    sendFile(res, 'app.js', 'application/javascript; charset=utf-8');
    return;
  }

  sendJson(res, 404, {
    error: 'Ruta no encontrada'
  });
});

server.listen(PORT, HOST, () => {
  console.log(`ELANKAV Orchestrator ${VERSION} activo en http://${HOST}:${PORT}`);
});
