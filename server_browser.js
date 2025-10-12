const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const https = require('https');
const net = require('net');

class GamesNetPanzerBrowser {
  constructor() {
    this.masterservers = [{ host: 'netpanzer.io', port: 28900 }];
    this.visitedmasters = {};
    this.mastersstack = [...this.masterservers];
    this.gameservers = {};
    this.refreshInterval = 15000;

    this.startServerRefresh();
    this.startHTTPSServer();
  }

  start() {
    this.browseMasters();
  }

  browseMasters() {
    if (this.mastersstack.length === 0) {
      console.log('✅ Finished browsing masters.');
      this.getGameServersStatus();
      return;
    }

    const master = this.mastersstack.pop();
    this.visitedmasters[`${master.host}:${master.port}`] = master;

    const client = new net.Socket();
    client.connect(master.port, master.host, () => {
      console.log(`🔗 Connected to ${master.host}:${master.port}`);
      client.write('\\list\\gamename\\netpanzer\\final\\');
    });

    client.on('data', (data) => {
      console.log(`📥 Received from ${master.host}:${master.port}`);
      const serverList = this.parseServerList(data.toString(), master);
      this.addGameServers(serverList);
      client.destroy();
      this.browseMasters();
    });

    client.on('close', () => console.log(`🔌 Connection closed to ${master.host}:${master.port}`));
    client.on('error', (err) => {
      console.error(`❌ Error connecting to ${master.host}:${master.port}: ${err.message}`);
      this.browseMasters();
    });
  }

  parseServerList(data, master) {
    const servers = [];
    const tokens = data.split('\\');
    for (let i = 1; i < tokens.length - 1; i += 2) {
      if (tokens[i] === 'ip' && tokens[i + 2] === 'port') {
        servers.push({
          ip: tokens[i + 1],
          port: tokens[i + 3],
          masterserver: master,
          numplayers: 0
        });
      }
    }
    return servers;
  }

  addGameServers(serverList) {
    serverList.forEach((server) => {
      const key = `${server.ip}:${server.port}`;
      if (!this.gameservers[key]) this.gameservers[key] = server;
    });
  }

  getGameServersStatus() {
    console.log('🔍 Getting game servers status...');
    Object.values(this.gameservers).forEach((server) => this.queryServerStatus(server));
  }

  queryServerStatus(server) {
    const udpClient = dgram.createSocket('udp4');
    udpClient.send(Buffer.from('\\status\\final\\'), server.port, server.ip, (err) => {
      if (err) {
        console.error(`❌ Error sending UDP to ${server.ip}:${server.port}: ${err.message}`);
        udpClient.close();
      }
    });

    udpClient.on('message', (data) => {
      const info = this.parseServerStatus(data.toString());
      this.updateServerInfo(server, info);
      udpClient.close();
    });

    udpClient.on('error', (err) => {
      console.error(`UDP error ${server.ip}:${server.port}: ${err.message}`);
      udpClient.close();
    });
  }

  parseServerStatus(data) {
    const info = { players: [] };
    const tokens = data.split('\\');
    for (let i = 0; i < tokens.length - 1; i += 2) {
      const key = tokens[i];
      const val = tokens[i + 1];
      if (key.startsWith('player_')) {
        const idx = parseInt(key.split('_')[1], 10);
        info.players[idx] = info.players[idx] || {};
        info.players[idx].name = val;
      } else if (key.startsWith('kills_') || key.startsWith('deaths_')) {
        const idx = parseInt(key.split('_')[1], 10);
        const type = key.split('_')[0];
        info.players[idx] = info.players[idx] || {};
        info.players[idx][type] = val;
      } else {
        info[key] = val;
      }
    }
    return info;
  }

  updateServerInfo(server, info) {
    server.cache = info;
  }

  startHTTPSServer() {
    const sslOptions = {
      key: fs.readFileSync(path.join(__dirname, 'key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
    };

    const httpsServer = https.createServer(sslOptions, async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.createHTMLTable());
    });

    httpsServer.listen(443, () => {
      console.log('✅ HTTPS server running at https://<SEU_IP_OU_DOMINIO>');
    });
  }

  createHTMLTable() {
    let html = `
      <html>
      <head>
        <title>NetPanzer Servers</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${this.getCSS()}</style>
      </head>
      <body>
        <h1>NetPanzer Servers</h1>
        <table>
          <thead>
            <tr>
              <th>Porta</th>
              <th>Servidor</th>
              <th>Mapa</th>
              <th>Estilo</th>
              <th>Players</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>`;

    Object.values(this.gameservers).forEach((s) => {
      const c = s.cache || { players: [] };
      html += `<tr>
        <td>${s.port}</td>
        <td>${c.hostname || 'N/A'}</td>
        <td>${c.mapname || 'N/A'}</td>
        <td>${c.gamestyle || 'N/A'}</td>
        <td>${c.numplayers || 0}</td>
        <td>${
          c.players.map(p =>
            `${p.name || 'Unknown'} (Kills: ${p.kills || 0}, Deaths: ${p.deaths || 0})`
          ).join('<br>') || 'Sem jogadores'
        }</td>
      </tr>`;
    });

    html += `</tbody></table></body></html>`;
    return html;
  }

  getCSS() {
    return `
      * {
        box-sizing: border-box;
      }
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: #f4f4f4;
        color: #333;
        margin: 0;
        padding: 20px;
      }
      h1 {
        color: #000000ff;
        text-align: center;
        margin-bottom: 20px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }
      th, td {
        padding: 12px;
        border: 1px solid #ddd;
        text-align: left;
      }
      th {
        background-color: #000000ff;
        color: white;
      }
      tr:nth-child(even) {
        background-color: #f9f9f9;
      }

      /* Layout responsivo para celular */
      @media (max-width: 600px) {
        table, thead, tbody, th, td, tr {
          display: block;
        }
        tr {
          margin-bottom: 15px;
        }
        th {
          display: none;
        }
        td {
          position: relative;
          padding-left: 50%;
        }
        td::before {
          position: absolute;
          top: 12px;
          left: 12px;
          width: 45%;
          padding-right: 10px;
          white-space: nowrap;
          font-weight: bold;
          color: #555;
        }
        td:nth-of-type(1)::before { content: "Porta"; }
        td:nth-of-type(2)::before { content: "Servidor"; }
        td:nth-of-type(3)::before { content: "Mapa"; }
        td:nth-of-type(4)::before { content: "Estilo"; }
        td:nth-of-type(5)::before { content: "Players"; }
        td:nth-of-type(6)::before { content: "Detalhes"; }
      }
    `;
  }

  startServerRefresh() {
    setInterval(() => {
      Object.values(this.gameservers).forEach((server) => this.queryServerStatus(server));
    }, this.refreshInterval);
  }
}

const browser = new GamesNetPanzerBrowser();
browser.start();
