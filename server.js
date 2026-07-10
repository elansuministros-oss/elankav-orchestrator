const http = require('node:http');

const HOST = '172.19.0.1';
const PORT = 4100;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      service: 'ELANKAV Orchestrator',
      status: 'OK',
      version: '0.1.0',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>ELANKAV Orchestrator</title>
      </head>
      <body style="font-family:Arial;background:#111827;color:#fff;padding:40px">
        <h1>ELANKAV ORCHESTRATOR</h1>
        <p>Centro de Control del Ecosistema ELANKAV</p>
        <p>Estado: <strong style="color:#22c55e">OPERATIVO</strong></p>
        <p>Versión: 0.1.0</p>
      </body>
    </html>
  `);
});

server.listen(PORT, HOST, () => {
  console.log(`ELANKAV Orchestrator activo en http://${HOST}:${PORT}`);
});
