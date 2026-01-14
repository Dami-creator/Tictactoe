require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

/* =========================
   GLOBAL STORAGE
========================= */
const games = {};              // chatId → game
const wcgLeaderboard = {};     // userId → wins

/* =========================
   HELPERS
========================= */
function uname(user) {
  return user.username ? `@${user.username}` : user.first_name;
}

function randomLetter() {
  return String.fromCharCode(65 + Math.floor(Math.random() * 26));
}

function getSettings(difficulty) {
  if (difficulty === 'easy') return { startLen: 3, inc: 1, time: 30000 };
  if (difficulty === 'hard') return { startLen: 5, inc: 2, time: 10000 };
  return { startLen: 4, inc: 1, time: 20000 };
}

/* =========================
   START
========================= */
bot.onText(/\/start/, msg => {
  bot.sendMessage(
    msg.chat.id,
`👋 Hello ${uname(msg.from)}

🎮 *Games*
🧩 /wcg — Word Challenge Game
❌⭕ /xo — X & O (Tic Tac Toe)

🏆 /wcgleaderboard
🔄 /reset`,
    { parse_mode: 'Markdown' }
  );
});

/* =========================
   MESSAGE HANDLER
========================= */
bot.on('message', msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  /* ===== RESET ===== */
  if (text === '/reset' && games[chatId]) {
    clearTimeout(games[chatId].timer);
    clearTimeout(games[chatId].lobbyTimer);
    delete games[chatId];
    return bot.sendMessage(chatId, '🔄 Game reset.');
  }

  /* =========================
     WCG START
  ========================= */
  if (text === '/wcg') {
    if (games[chatId]) return bot.sendMessage(chatId, '⚠️ Game already running.');

    const settings = getSettings('medium');

    games[chatId] = {
      type: 'wcg',
      players: [],
      playerMap: {},
      started: false,
      currentTurn: 0,
      usedWords: [],
      letter: '',
      minLength: settings.startLen,
      difficulty: 'medium',
      timer: null,
      lobbyTimer: null
    };

    bot.sendMessage(
      chatId,
      '🧩 *Word Challenge Game*\n\nType *join* to play\nGame starts in 30 seconds',
      { parse_mode: 'Markdown' }
    );

    games[chatId].lobbyTimer = setTimeout(() => {
      if (games[chatId].players.length < 2) {
        delete games[chatId];
        return bot.sendMessage(chatId, '❌ Not enough players.');
      }
      startWCG(chatId);
    }, 30000);

    return;
  }

  /* ===== WCG JOIN ===== */
  if (text.toLowerCase() === 'join' && games[chatId]?.type === 'wcg' && !games[chatId].started) {
    const game = games[chatId];
    if (game.players.includes(userId)) return;

    game.players.push(userId);
    game.playerMap[userId] = uname(msg.from);
    return bot.sendMessage(chatId, `✅ ${uname(msg.from)} joined`);
  }

  /* ===== WCG PLAY ===== */
  if (games[chatId]?.type === 'wcg' && games[chatId].started) {
    const game = games[chatId];
    if (game.players[game.currentTurn] !== userId) return;

    const word = text.toLowerCase();
    if (!word.startsWith(game.letter.toLowerCase()))
      return bot.sendMessage(chatId, '❌ Must start with the letter.');

    if (word.length < game.minLength)
      return bot.sendMessage(chatId, `❌ Min length: ${game.minLength}`);

    if (game.usedWords.includes(word))
      return bot.sendMessage(chatId, '❌ Word already used.');

    clearTimeout(game.timer);
    game.usedWords.push(word);
    game.minLength += getSettings(game.difficulty).inc;
    game.currentTurn = (game.currentTurn + 1) % game.players.length;
    return nextWCGRound(chatId);
  }

  /* =========================
     X & O START
  ========================= */
  if (text === '/xo') {
    if (games[chatId]) return bot.sendMessage(chatId, '⚠️ Game already running.');

    games[chatId] = {
      type: 'xo',
      players: [],
      symbols: ['❌', '⭕'],
      board: Array(9).fill(null),
      turn: 0,
      started: false,
      playerMap: {}
    };

    return bot.sendMessage(chatId, '❌⭕ *X & O*\n\nType *join* to play (2 players)', {
      parse_mode: 'Markdown'
    });
  }

  /* ===== XO JOIN ===== */
  if (text.toLowerCase() === 'join' && games[chatId]?.type === 'xo' && !games[chatId].started) {
    const game = games[chatId];
    if (game.players.includes(userId)) return;

    game.players.push(userId);
    game.playerMap[userId] = uname(msg.from);

    if (game.players.length === 2) {
      game.started = true;
      sendBoard(chatId);
    } else {
      bot.sendMessage(chatId, `✅ ${uname(msg.from)} joined`);
    }
    return;
  }

  /* ===== XO MOVE ===== */
  if (games[chatId]?.type === 'xo' && games[chatId].started) {
    const game = games[chatId];
    if (game.players[game.turn] !== userId) return;

    const pos = parseInt(text);
    if (isNaN(pos) || pos < 1 || pos > 9) return;
    if (game.board[pos - 1]) return bot.sendMessage(chatId, '❌ Spot taken');

    game.board[pos - 1] = game.symbols[game.turn];

    if (checkWin(game.board)) {
      bot.sendMessage(chatId, `🏆 ${uname(msg.from)} wins!`);
      delete games[chatId];
      return;
    }

    if (!game.board.includes(null)) {
      bot.sendMessage(chatId, '🤝 Draw!');
      delete games[chatId];
      return;
    }

    game.turn = 1 - game.turn;
    return sendBoard(chatId);
  }

  /* ===== LEADERBOARD ===== */
  if (text === '/wcgleaderboard') {
    if (!Object.keys(wcgLeaderboard).length)
      return bot.sendMessage(chatId, 'No games yet.');

    let msg = '🏆 *WCG Leaderboard*\n\n';
    Object.entries(wcgLeaderboard).forEach(([id, w], i) => {
      msg += `${i + 1}. ${id} — ${w} wins\n`;
    });

    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  }
});

/* =========================
   WCG FUNCTIONS
========================= */
function startWCG(chatId) {
  games[chatId].started = true;
  nextWCGRound(chatId);
}

function nextWCGRound(chatId) {
  const game = games[chatId];
  if (!game) return;

  if (game.players.length === 1) {
    const winner = game.players[0];
    wcgLeaderboard[winner] = (wcgLeaderboard[winner] || 0) + 1;
    bot.sendMessage(chatId, `🏆 ${game.playerMap[winner]} wins!`);
    delete games[chatId];
    return;
  }

  const settings = getSettings(game.difficulty);
  game.letter = randomLetter();
  const pid = game.players[game.currentTurn];

  bot.sendMessage(
    chatId,
    `🔤 Letter: *${game.letter}*\n👤 ${game.playerMap[pid]}\n📏 Min: ${game.minLength}\n⏱ ${settings.time / 1000}s`,
    { parse_mode: 'Markdown' }
  );

  game.timer = setTimeout(() => {
    bot.sendMessage(chatId, `⏰ ${game.playerMap[pid]} eliminated`);
    game.players.splice(game.currentTurn, 1);
    game.currentTurn = 0;
    nextWCGRound(chatId);
  }, settings.time);
}

/* =========================
   XO FUNCTIONS
========================= */
function sendBoard(chatId) {
  const game = games[chatId];
  const b = game.board.map((v, i) => v || i + 1);
  const board =
`${b[0]} | ${b[1]} | ${b[2]}
---------
${b[3]} | ${b[4]} | ${b[5]}
---------
${b[6]} | ${b[7]} | ${b[8]}

Turn: ${game.playerMap[game.players[game.turn]]}`;

  bot.sendMessage(chatId, board);
}

function checkWin(b) {
  const w = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  return w.some(p => p.every(i => b[i] && b[i] === b[p[0]]));
}
