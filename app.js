// app.js

const { Client } = require('pg');
const pgp = require('pg-promise')();
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const express = require('express');
const RankingManager = require('./ranking'); // Atualize o caminho conforme necessário
const Hall = require('./hall'); // Importe a classe Hall

class GamesNetPanzerBrowser {
  constructor() {
    this.masterservers = [
      { host: 'netpanzer.io', port: 28900 },
      // Adicione outros servidores mestres, se necessário
    ];
    this.visitedmasters = {};
    this.mastersstack = [...this.masterservers];
    this.gameservers = {};
    this.timeout = 2000; // Tempo limite em milissegundos
    this.refreshInterval = 15000; // Intervalo de atualização em milissegundos (15 segundos)
    this.monthlyStats = {}; // Armazenar estatísticas mensais
    this.currentMonth = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

    // Configurações do banco de dados PostgreSQL
    this.dbConfig = {
      host: 'localhost',
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: '1234'
    };

    // Conecta ao banco de dados
    this.db = pgp(this.dbConfig);

    // Cria uma instância do RankingManager, passando a conexão db
    this.rankingManager = new RankingManager(this.monthlyStats, this.db);
    // Crie uma instância da classe Hall e passe a conexão do banco de dados
    this.hall = new Hall(this.db);
    this.app = express();
    // Configure the route to handle requests for the top 10 players
    this.app.get('/top-players', async (req, res) => {
      const { month, year } = req.query;

      try {
        const topPlayers = await this.hall.getTopPlayers(month, year);
        res.json(topPlayers);
      } catch (error) {
        console.error(`Error fetching top players: ${error.message}`);
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    // Inicia o processo de atualização dos servidores
    this.startServerRefresh();

    // Inicia o servidor HTTP para exibir informações dos servidores e o ranking
    this.startHTTPServer();

  }

  start() {
    this.browseMasters();
  }

  browseMasters() {
    if (this.mastersstack.length === 0) {
      console.log('Finished browsing masters.');
      this.getGameServersStatus();
      return;
    }

    const master = this.mastersstack.pop();
    this.visitedmasters[`${master.host}:${master.port}`] = master;

    const client = new net.Socket();
    client.connect(master.port, master.host, () => {
      console.log(`Connected to ${master.host}:${master.port}`);
      client.write('\\list\\gamename\\netpanzer\\final\\');
    });

    client.on('data', (data) => {
      console.log(`Received from ${master.host}:${master.port}: ${data}`);
      const serverList = this.parseServerList(data.toString(), master);
      this.addGameServers(serverList);
      client.destroy();
      this.browseMasters(); // Continue com o próximo servidor mestre
    });

    client.on('close', () => {
      console.log(`Connection closed to ${master.host}:${master.port}`);
    });

    client.on('error', (err) => {
      console.error(`Error connecting to ${master.host}:${master.port}: ${err}`);
      this.browseMasters(); // Continue com o próximo servidor mestre em caso de erro
    });
  }

  parseServerList(data, master) {
    const servers = [];
    const tokens = data.split('\\');
    for (let i = 1; i < tokens.length - 1; i += 2) {
      if (tokens[i] === 'ip' && tokens[i + 2] === 'port') {
        const serverInfo = {
          ip: tokens[i + 1],
          port: tokens[i + 3],
          masterserver: master,
          numplayers: 0, // Inicialmente, define o número de jogadores como 0
        };
        servers.push(serverInfo);
      }
    }
    return servers;
  }

  addGameServers(serverList) {
    serverList.forEach((server) => {
      const serverKey = `${server.ip}:${server.port}`;
      if (!this.gameservers[serverKey]) {
        this.gameservers[serverKey] = server;
      }
    });
  }

  getGameServersStatus() {
    console.log('Getting game servers status...');

    Object.values(this.gameservers).forEach((server) => {
      this.queryServerStatus(server);
    });
  }

  queryServerStatus(server) {
    const udpClient = dgram.createSocket('udp4');
    udpClient.send(Buffer.from('\\status\\final\\'), server.port, server.ip, (err) => {
      if (err) {
        console.error(`Error sending UDP request to ${server.ip}:${server.port}: ${err}`);
        udpClient.close();
      }
    });

    udpClient.on('message', (data, remote) => {
      console.log(`Received status from ${server.ip}:${server.port}: ${data}`);
      const serverInfo = this.parseServerStatus(data.toString());
      this.updateServerInfo(server, serverInfo);
      udpClient.close();
    });

    udpClient.on('error', (err) => {
      console.error(`Error receiving UDP response from ${server.ip}:${server.port}: ${err}`);
      udpClient.close();
    });
  }

  parseServerStatus(data) {
    const serverInfo = {};
    const tokens = data.split('\\');
    serverInfo.players = [];

    for (let i = 0; i < tokens.length - 1; i += 2) {
      const key = tokens[i];
      const value = tokens[i + 1];

      if (key.startsWith('player_')) {
        const playerIndex = parseInt(key.split('_')[1], 10);
        serverInfo.players[playerIndex] = serverInfo.players[playerIndex] || {};
        serverInfo.players[playerIndex].name = value;
      } else if (key.startsWith('kills_') || key.startsWith('deaths_')) {
        const playerIndex = parseInt(key.split('_')[1], 10);
        const statType = key.split('_')[0]; // 'kills' ou 'deaths'
        serverInfo.players[playerIndex][statType] = value;
      } else {
        serverInfo[key] = value;
      }
    }

    return serverInfo;
  }

  updateServerInfo(server, serverInfo) {
    server.cache = serverInfo;

    const currentMonth = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

    if (currentMonth !== this.currentMonth) {
      this.currentMonth = currentMonth;
      this.monthlyStats = {};
    }

    serverInfo.players.forEach((player) => {
      const playerName = player.name || 'Unknown';

      if (!this.monthlyStats[playerName]) {
        this.monthlyStats[playerName] = { player_name: playerName, kills: 0, deaths: 0, lastSessionKills: 0, lastSessionDeaths: 0 };
      }

      const newKills = parseInt(player.kills || 0, 10);
      const newDeaths = parseInt(player.deaths || 0, 10);

      if (newKills === 0 && newDeaths === 0) {
        if (this.monthlyStats[playerName].kills > 0 || this.monthlyStats[playerName].deaths > 0) {
          this.monthlyStats[playerName].lastSessionKills = 0;
          this.monthlyStats[playerName].lastSessionDeaths = 0;
        }
      } else {
        this.monthlyStats[playerName].kills += newKills - this.monthlyStats[playerName].lastSessionKills;
        this.monthlyStats[playerName].deaths += newDeaths - this.monthlyStats[playerName].lastSessionDeaths;
        this.monthlyStats[playerName].lastSessionKills = newKills;
        this.monthlyStats[playerName].lastSessionDeaths = newDeaths;
      }
    });

    // Verifica se há jogadores no servidor antes de salvar no banco de dados
    if (serverInfo.players.length > 0) {
      this.saveDataToDatabase(server, serverInfo);
    }

    this.rankingManager.updateRanking();
  }

  saveDataToDatabase(server, serverInfo) {
    console.log('Saving data to ranking database for server:', server.ip, server.port);

    const currentMonthYear = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
    });

    serverInfo.players.forEach((player) => {
      const playerName = player.name || 'Unknown';
  
      const playerData = {
          player_name: playerName,
          kills: parseInt(player.kills || 0, 10),
          deaths: parseInt(player.deaths || 0, 10),
          month_year: currentMonthYear,
      };
  
      console.log('Player data to save to ranking:', playerData);
  
      // Salva os dados do jogador na tabela ranking com a coluna month_year
      this.db.none(
          `
      INSERT INTO ranking(player_name, kills, deaths, month_year)
      VALUES($/player_name/, $/kills/, $/deaths/, $/month_year/)
      ON CONFLICT ON CONSTRAINT unique_player_month
      DO UPDATE SET
        kills = ranking.kills + $/kills/,
        deaths = ranking.deaths + $/deaths/
      `,
          playerData
      )
          .then(() => {
              console.log(`Player data saved to ranking database for ${playerData.player_name}`);
          })
          .catch((error) => {
              console.error(`Error saving player data to ranking database for ${playerData.player_name} in ${playerData.month_year}: ${error}`);
          });
  });
  
  // Atualiza o ranking após salvar os dados
  this.rankingManager.updateRanking();
}
  
  startHTTPServer() {
    const server = http.createServer(async (req, res) => {
      if (req.url === '/ranking') {
        const rankingHTMLFilePath = path.join(__dirname, 'ranking', 'ranking.html');
        const rankingHTML = fs.readFileSync(rankingHTMLFilePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(rankingHTML);
      } else if (req.url === '/hall') {
        const hall = new Hall(this.db);
        const hallHtml = await hall.getTopPlayersHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(hallHtml);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.createHTMLTable());
      }
    });

    server.listen(8080, () => {
      console.log('HTTP server is running on port 8080');
    });
  }

  createHTMLTable() {
    let html = `
      <html>
        <head>
          <title>Game Servers</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>${this.getCSS()}</style>
        </head>
        <body>
          <table>
            <tr>
              <th>Porta</th>
              <th>Servidor</th>
              <th>Map</th>
              <th>Estilo de Jogo</th>
              <th>Players</th>
              <th>Info Players</th>
            </tr>`;

    Object.values(this.gameservers).forEach(server => {
      const cache = server.cache || {};
      let playersData = '<ul>';
      cache.players.forEach((player, index) => {
        playersData += `
          <li>
            ${player.name || 'Unknown'}: Kills: ${player.kills || '0'}, Deaths: ${player.deaths || '0'}
          </li>`;
      });
      playersData += '</ul>';

      html += `
        <tr>
          <td data-label="Porta">${server.port}</td>
          <td data-label="Servidor">${cache.hostname || 'N/A'}</td>
          <td data-label="Map">${cache.mapname || 'N/A'}</td>
          <td data-label="Estilo de Jogo">${cache.gamestyle || 'N/A'}</td>
          <td data-label="Players">${cache.numplayers || '0'}</td>
          <td data-label="Info Players">${playersData}</td>
        </tr>`;
    });

    html += `
          </table>
        </body>
      </html>`;
    return html;
  }

  getCSS() {
    // Implemente a lógica de obtenção do CSS conforme estava no código original
    return `
    body {
        background-color: #f4f4f4;
        color: #333;
        font-family: 'Arial', sans-serif;
        margin: 0;
        padding: 0;
      }
      
      h1 {
        border-bottom: 2px solid #3498db;
        padding-bottom: 10px;
        color: #3498db;
      }
      
      table {
        border-collapse: collapse;
        width: 100%;
        margin-top: 20px;
      }
      
      th, td {
        border: 1px solid #ddd;
        padding: 12px;
        text-align: left;
      }
      
      th {
        background-color: #3498db;
        color: #fff;
      }
      
      tr:nth-child(even) {
        background-color: #f2f2f2;
      }
      
      a {
        color: #3498db;
        text-decoration: none;
      }
      
      a:hover {
        text-decoration: underline;
      }
      
      /* Estilo para telas pequenas */
      @media screen and (max-width: 768px) {
        body {
          font-size: 14px;
        }
      
        td:not(:last-child)::before {
          display: block;
          content: attr(data-label) ":";
          font-weight: bold;
          margin-bottom: 5px;
        }
      
        td {
          border: none;
          position: relative;
          padding-top: 5px;
          padding-bottom: 5px;
          white-space: normal;
          text-align: left;
        }
      }
  `;
  }


  startServerRefresh() {
    setInterval(() => {
      Object.values(this.gameservers).forEach((server) => {
        this.queryServerStatus(server);
      });
    }, this.refreshInterval);
  }
}


// Criar uma instância da classe e iniciar o processo
const browser = new GamesNetPanzerBrowser();
browser.start();
