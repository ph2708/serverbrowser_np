# Server Browser NetPanzer

Este projeto implementa um "server browser" e ranking para NetPanzer.
Ele consulta master servers, coleta informações UDP dos servidores de jogo, agrega deltas por jogador e persiste estatísticas mensais em um banco SQLite.

## Requisitos

- Node.js (versão 14+ recomendada)
- npm (ou yarn)
- Windows com WSL funciona bem para abrir portas/usar certificados. O projeto usa `better-sqlite3` que pode precisar de compilação nativa.

## Instalação

1. Clone o repositório:

```bash
# no WSL (ex.: wsl.exe)
cd ~
git clone <repo-url>
cd serverbrowser_np
```

2. Instale dependências:

```bash
npm install
```

> Observação: `better-sqlite3` compila bindings nativos. Se a instalação falhar, certifique-se de ter ferramentas de compilação no WSL (build-essential) ou use o Node.js instalado diretamente no Windows com as toolchains apropriadas.

## Arquivos principais

- `server_browser.js` — Classe principal `GamesNetPanzerBrowser`. Inicia o loop de consulta aos master servers, consulta servidores via UDP e expõe um servidor HTTP (porta 3000) e, opcionalmente, HTTPS (porta 443) com rotas:
  - `/` — Lista de servidores (UI simples em HTML)
  - `/ranking` — Ranking mensal (paginado)
  - `/estatisticas` — Página com estatísticas avançadas

- `ranking.js` — Lógica de persistência e consulta usando SQLite (`ranking_data/ranking.db`). Contém funções como `updatePlayerStats`, `getRanking`, `countPlayers` e helpers para `last_stats`.

- `statistics.js` — Funções que derivam métricas da tabela `rankings` (ex.: `strength`, `efficiencyRate`) e geram dados para a UI de estatísticas.

## Como executar

Executar a aplicação em modo local (HTTP somente):

```bash
# no WSL
npm start || node server_browser.js
```

Observação: Não existe um script `start` definido no `package.json` por padrão — você pode rodar com `node server_browser.js`.

### Executar com HTTPS (produção)

Por padrão a aplicação tenta iniciar um servidor HTTPS usando os caminhos padrão do Let's Encrypt. Para usar HTTPS:

- Defina as variáveis de ambiente `SSL_KEY_PATH` e `SSL_CERT_PATH` para apontar para os arquivos de chave e certificado.
- Execute o processo com permissão para abrir a porta 443 ou utilize um proxy reverso (nginx) para expor HTTPS.

Você também pode desabilitar HTTPS e usar apenas HTTP definindo `DISABLE_HTTPS=1`.

Exemplos (WSL / Linux):

```bash
# iniciar somente HTTP
DISABLE_HTTPS=1 node server_browser.js

# iniciar com HTTPS (supondo que arquivos existem)
SSL_KEY_PATH=/caminho/para/privkey.pem SSL_CERT_PATH=/caminho/para/fullchain.pem node server_browser.js
```

No Windows (cmd/powershell) a sintaxe de variáveis é diferente; em PowerShell:

```powershell
$env:SSL_KEY_PATH = 'C:\caminho\privkey.pem'
$env:SSL_CERT_PATH = 'C:\caminho\fullchain.pem'
node server_browser.js
```

## Banco de dados

O SQLite é criado automaticamente em `ranking_data/ranking.db` na primeira execução. As tabelas usadas são `rankings` e `last_stats`.

## Variáveis de ambiente importantes

- `DISABLE_HTTPS` — se `1` ou `true`, evita tentativa de abrir HTTPS.
- `SSL_KEY_PATH` — caminho para a chave privada (se habilitar HTTPS).
- `SSL_CERT_PATH` — caminho para o certificado (se habilitar HTTPS).

## Observações e dicas

- A aplicação faz consultas UDP aos servidores reportados pelo master server `netpanzer.io:28900`. Se nenhum servidor aparecer, verifique conectividade/porta UDP.
- `better-sqlite3` pode requerer instalação de compiladores nativos no WSL/Windows.
- Se quiser expor a aplicação publicamente em HTTPS, recomendo colocar um proxy (nginx) na frente para gerenciar certificados.

## Contribuição

Sinta-se livre para abrir issues ou PRs. Sugestões:

- Adicionar um script `start` no `package.json`.
- Adicionar testes unitários para `ranking.js`.
- Registrar número de partidas por jogador para métricas por jogo.

## Licença

ISC
