// server.js
const dgram = require("dgram");
const fs = require("fs");
const path = require("path");
const https = require("https");
const net = require("net");

// =============================
// ======= RANKING SYSTEM ======
// =============================

const rankingFolder = path.join(__dirname, "ranking_data");
if (!fs.existsSync(rankingFolder)) fs.mkdirSync(rankingFolder);

function getCurrentMonthYear() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getRankingFilePath(monthYear) {
  return path.join(rankingFolder, `ranking_${monthYear}.json`);
}

function loadHistoricalStats(monthYear) {
  const file = getRankingFilePath(monthYear);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.error("⚠️ Erro ao ler arquivo de ranking:", err);
      return {};
    }
  }
  return {};
}

function saveHistoricalStats(currentMonthYear, historicalStats) {
  try {
    fs.writeFileSync(
      getRankingFilePath(currentMonthYear),
      JSON.stringify(historicalStats, null, 2)
    );
    console.log("💾 Ranking salvo com sucesso.");
  } catch (err) {
    console.error("❌ Erro ao salvar ranking:", err);
  }
}

function updateMonthlyRanking(browser) {
  if (!browser || !browser.gameservers) return;

  const monthYear = getCurrentMonthYear();
  if (monthYear !== browser.currentMonthYear) {
    console.log("📅 Novo mês detectado:", monthYear);
    browser.currentMonthYear = monthYear;
    browser.historicalStats = loadHistoricalStats(monthYear);
  }

  let houveMudanca = false;

  for (const server of Object.values(browser.gameservers)) {
    if (!server.cache?.players) continue;

    server.countedStats = server.countedStats || {};

    for (const p of server.cache.players) {
      if (!p.name) continue;

      if (!browser.historicalStats[p.name]) {
        browser.historicalStats[p.name] = { kills: 0, deaths: 0, points: 0 };
      }

      if (!server.countedStats[p.name]) {
        server.countedStats[p.name] = { kills: 0, deaths: 0, points: 0 };
      }

      const counted = server.countedStats[p.name];

      const toAddKills = Math.max(0, (p.kills || 0) - (counted.kills || 0));
      const toAddDeaths = Math.max(0, (p.deaths || 0) - (counted.deaths || 0));
      const toAddPoints = Math.max(0, (p.points || 0) - (counted.points || 0));

      browser.historicalStats[p.name].kills += toAddKills;
      browser.historicalStats[p.name].deaths += toAddDeaths;
      browser.historicalStats[p.name].points += toAddPoints;

      server.countedStats[p.name] = {
        kills: p.kills || 0,
        deaths: p.deaths || 0,
        points: p.points || 0,
      };

      if (toAddKills > 0 || toAddDeaths > 0 || toAddPoints > 0)
        houveMudanca = true;
    }
  }

  if (houveMudanca) saveHistoricalStats(browser.currentMonthYear, browser.historicalStats);
}

function generateRankingHTML(browser, search = "", page = 1, perPage = 20) {
  const stats = browser.historicalStats || {};
  const filtered = Object.entries(stats)
    .map(([name, s]) => ({ name, ...s }))
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort(
      (a, b) => b.kills - a.kills || a.deaths - b.deaths || b.points - a.points
    );

  const totalPlayers = filtered.length;
  const totalPages = Math.ceil(totalPlayers / perPage);
  page = Math.min(Math.max(1, page), totalPages);

  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  let html = `<html><head><title>Ranking Mensal</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${browser.getCSS()}</style></head><body>`;
  html += `<h1>Ranking Mensal - ${browser.currentMonthYear}</h1>`;
  html += `<form method="GET">
              <input type="text" name="search" placeholder="Buscar jogador" value="${search}">
              <button type="submit">Buscar</button>
           </form>`;

  html +=
    '<table class="ranking-table"><tr><th>Rank</th><th>Jogador</th><th>Kills</th><th>Deaths</th><th>Points</th></tr>';
  paginated.forEach((p, idx) => {
    const rank = start + idx + 1;
    html += `<tr><td>${rank}</td><td>${p.name}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.points}</td></tr>`;
  });
  html += "</table><div style='margin-top:15px;'>";

  for (let i = 1; i <= totalPages; i++) {
    if (i === page) html += `<strong>${i}</strong> `;
    else
      html += `<a href="/ranking?page=${i}&search=${encodeURIComponent(
        search
      )}">${i}</a> `;
  }

  html += "</div></body></html>";
  return html;
}

// =============================
// ======= SERVER BROWSER ======
// =============================

class GamesNetPanzerBrowser {
  constructor() {
    this.masterservers = [{ host: "netpanzer.io", port: 28900 }];
    this.visitedmasters = {};
    this.mastersstack = [...this.masterservers];
    this.gameservers = {};
    this.refreshInterval = 15000;

    this.currentMonthYear = getCurrentMonthYear();
    this.historicalStats = loadHistoricalStats(this.currentMonthYear);

    this.startServerRefresh();
    this.startHTTPSServer();
  }

  start() {
    this.browseMasters();
  }

  browseMasters() {
    if (this.mastersstack.length === 0) {
      this.getGameServersStatus();
      return;
    }

    const master = this.mastersstack.pop();
    console.log(`🌐 Conectando ao master ${master.host}:${master.port}`);

    const client = new net.Socket();
    client.connect(master.port, master.host, () =>
      client.write("\\list\\gamename\\netpanzer\\final\\")
    );

    client.on("data", (data) => {
      this.addGameServers(this.parseServerList(data.toString(), master));
      client.destroy();
      this.browseMasters();
    });

    client.on("error", (err) => {
      console.error("❌ Erro ao conectar ao master:", err.message);
      this.browseMasters();
    });
  }

  parseServerList(data, master) {
    const servers = [];
    const tokens = data.split("\\");
    for (let i = 1; i < tokens.length - 1; i += 2) {
      if (tokens[i] === "ip" && tokens[i + 2] === "port") {
        servers.push({
          ip: tokens[i + 1],
          port: parseInt(tokens[i + 3], 10),
          masterserver: master,
          cache: { players: [] },
        });
      }
    }
    return servers;
  }

  addGameServers(serverList) {
    serverList.forEach((s) => {
      const key = `${s.ip}:${s.port}`;
      if (!this.gameservers[key]) {
        console.log("🆕 Servidor adicionado:", key);
        this.gameservers[key] = s;
      }
    });
  }

  getGameServersStatus() {
    Object.values(this.gameservers).forEach((s) => this.queryServerStatus(s));
  }

  queryServerStatus(server) {
    try {
      const udpClient = dgram.createSocket("udp4");
      udpClient.send(Buffer.from("\\status\\final\\"), server.port, server.ip);

      udpClient.on("message", (data) => {
        try {
          const info = this.parseServerStatus(data.toString());
          server.cache.players = (info.players || []).map((p) => ({
            name: p.name || "Unknown",
            kills: Number(p.kills || 0),
            deaths: Number(p.deaths || 0),
            points: Number(p.points || 0),
          }));
          server.cache.hostname = info.hostname || "N/A";
          server.cache.mapname = info.mapname || "N/A";
          server.cache.gamestyle = info.gamestyle || "N/A";
          server.cache.numplayers = info.players ? info.players.length : 0;

          updateMonthlyRanking(this);
        } catch (err) {
          console.error("⚠️ Erro ao processar resposta UDP:", err);
        } finally {
          udpClient.close();
        }
      });

      udpClient.on("error", (err) => {
        console.error("⚠️ Erro UDP:", err.message);
        udpClient.close();
      });
    } catch (err) {
      console.error("❌ Falha geral no queryServerStatus:", err);
    }
  }

  parseServerStatus(data) {
    const info = { players: [] };
    const tokens = data.split("\\");
    for (let i = 0; i < tokens.length - 1; i += 2) {
      const key = tokens[i],
        val = tokens[i + 1];
      if (key.startsWith("player_")) {
        const idx = parseInt(key.split("_")[1], 10);
        info.players[idx] = info.players[idx] || {};
        info.players[idx].name = val;
      } else if (key.startsWith("kills_")) {
        const idx = parseInt(key.split("_")[1], 10);
        info.players[idx] = info.players[idx] || {};
        info.players[idx].kills = Number(val);
      } else if (key.startsWith("deaths_")) {
        const idx = parseInt(key.split("_")[1], 10);
        info.players[idx] = info.players[idx] || {};
        info.players[idx].deaths = Number(val);
      } else if (key.startsWith("points_")) {
        const idx = parseInt(key.split("_")[1], 10);
        info.players[idx] = info.players[idx] || {};
        info.players[idx].points = Number(val);
      } else info[key] = val;
    }
    return info;
  }

  createHTMLTable() {
    let html = `<html><head><title>NetPanzer Servers</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${this.getCSS()}</style></head><body><h1>NetPanzer Servers</h1><table class="servers-table"><thead><tr><th>Porta</th><th>Servidor</th><th>Mapa</th><th>Estilo</th><th>Players</th><th>Detalhes</th></tr></thead><tbody>`;
    Object.values(this.gameservers).forEach((s) => {
      const c = s.cache || { players: [] };
      html += `<tr><td>${s.port}</td><td>${c.hostname || "N/A"}</td><td>${c.mapname || "N/A"}</td><td>${c.gamestyle || "N/A"}</td><td>${c.numplayers || 0}</td><td>${
        c.players
          .map(
            (p) =>
              `${p.name} (Kills:${p.kills}, Deaths:${p.deaths}, Points:${p.points})`
          )
          .join("<br>") || "Sem jogadores"
      }</td></tr>`;
    });
    html += "</tbody></table></body></html>";
    return html;
  }

  getCSS() {
    return `
    body{font-family:Segoe UI,Tahoma,Verdana,sans-serif;background:#f4f4f4;color:#333;margin:0;padding:20px;}
    table{width:100%;border-collapse:collapse;margin-top:10px;}
    th,td{padding:10px;border:1px solid #ddd;text-align:left;}
    th{background-color:#000;color:white;}
    `;
  }

  startHTTPSServer() {
const sslOptions = {
  key: fs.readFileSync("/etc/letsencrypt/live/server-browser.netpanzer.com.br/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/server-browser.netpanzer.com.br/fullchain.pem"),
};

    const httpsServer = https.createServer(sslOptions, (req, res) => {
      try {
        const host = req.headers.host || "localhost";
        const urlObj = new URL(req.url, `https://${host}`);

        if (urlObj.pathname === "/ranking") {
          const search = urlObj.searchParams.get("search") || "";
          const page = parseInt(urlObj.searchParams.get("page") || "1", 10);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(generateRankingHTML(this, search, page));
        } else {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.createHTMLTable());
        }
      } catch (err) {
        console.error("❌ Erro na requisição HTTPS:", err);
        res.writeHead(500);
        res.end("Erro interno no servidor.");
      }
    });

    httpsServer.listen(443, () =>
      console.log("✅ HTTPS server running on port 443")
    );
  }

  startServerRefresh() {
    setInterval(() => {
      try {
        Object.values(this.gameservers).forEach((s) => this.queryServerStatus(s));
        updateMonthlyRanking(this);
      } catch (err) {
        console.error("⚠️ Erro no loop de atualização:", err);
      }
    }, this.refreshInterval);
  }
}

// =============================
// ======= EXECUÇÃO GLOBAL =====
// =============================

process.on("uncaughtException", (err) => {
  console.error("🔥 Erro não capturado:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("⚡ Promessa rejeitada sem tratamento:", reason);
});

const browser = new GamesNetPanzerBrowser();
browser.start();
