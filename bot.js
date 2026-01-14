require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

/* =========================
   AUTO DICTIONARY
========================= */
let dictionary = new Set();
async function loadDictionary() {
  try {
    const res = await fetch('https://raw.githubusercontent.com/dwyl/english-words/master/words.txt');
    const text = await res.text();
    dictionary = new Set(text.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean));
    console.log(`📚 Dictionary loaded: ${dictionary.size} words`);
  } catch (err) {
    console.error('❌ Failed to load dictionary:', err);
  }
}
loadDictionary();

function isValidWord(word) { return dictionary.has(word.toLowerCase()); }
function uname(user) { return user.username ? `@${user.username}` : user.first_name; }

/* =========================
   GLOBAL STORAGE
========================= */
const games = {}; // chatId → current game
const wcgLeaderboard = {};

/* =========================
   HELPERS
========================= */
function randomLetter() { return String.fromCharCode(65 + Math.floor(Math.random() * 26)); }
function getSettings(difficulty) {
  if (difficulty === 'easy') return { startLen: 3, inc: 1, time: 30000 };
  if (difficulty === 'hard') return { startLen: 5, inc: 2, time: 10000 };
  return { startLen: 4, inc: 1, time: 20000 }; // medium
}

/* =========================
   STARTUP MENU
========================= */
bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id;
  const menu = `👋 Hello ${uname(msg.from)}!\n\n` +
               `🎮 *Available Games & Commands:*\n\n` +
               `🟢 /wcg — Word Challenge Game\n` +
               `🟢 /xo — Tic-Tac-Toe (X & O)\n` +
               `🟢 join — Join a game lobby\n` +
               `🔄 /reset — Reset current game\n` +
               `🏆 /wcgleaderboard — Show WCG leaderboard`;

  bot.sendMessage(chatId, menu, { parse_mode: 'Markdown' });
});

/* =========================
   MESSAGE HANDLER
========================= */
bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  /* ===== RESET COMMAND ===== */
  if (text === '/reset' && games[chatId]) {
    clearTimeout(games[chatId].timer);
    clearTimeout(games[chatId].lobbyTimer);
    delete games[chatId];
    return bot.sendMessage(chatId, '🔄 Game reset.');
  }

  /* ===== JOIN ===== */
  if (text.toLowerCase() === 'join' && games[chatId] && !games[chatId].started) {
    const game = games[chatId];
    if (!game.players.includes(userId)) {
      game.players.push(userId);
      return bot.sendMessage(chatId, `✅ ${uname(msg.from)} joined`);
    }
    return;
  }

  /* ===== WCG START ===== */
  if (text === '/wcg') {
    if (games[chatId]) return bot.sendMessage(chatId, '⚠️ A game is already running.');
    const difficulty = 'medium';
    const settings = getSettings(difficulty);

    games[chatId] = {
      type: 'wcg',
      players: [],
      started: false,
      currentTurn: 0,
      usedWords: [],
      letter: '',
      minLength: settings.startLen,
      difficulty,
      timer: null,
      lobbyTimer: null
    };

    bot.sendMessage(chatId,
      `🧩 *Word Challenge Game*\n👥 Type *join* to play\n🎚 Difficulty: *${difficulty}*\n⏳ Game starts in 20 seconds`,
      { parse_mode: 'Markdown' }
    );

    games[chatId].lobbyTimer = setTimeout(() => {
      const game = games[chatId];
      if (!game || game.players.length < 2) {
        delete games[chatId];
        return bot.sendMessage(chatId, '❌ Not enough players. Game cancelled.');
      }
      startWCG(chatId);
    }, 20000);

    return;
  }

  /* ===== XO START ===== */
  if (text === '/xo') {
    if (games[chatId]) return bot.sendMessage(chatId, '⚠️ A game is already running.');
    games[chatId] = {
      type: 'xo',
      players: [],
      board: Array(9).fill('⬜'),
      currentTurn: 0,
      started: false,
      timer: null,
      lobbyTimer: null
    };
    bot.sendMessage(chatId, `❎⭕ Tic-Tac-Toe\n👥 Type *join* to play\n⏳ Game starts in 20 seconds`, { parse_mode: 'Markdown' });
    games[chatId].lobbyTimer = setTimeout(() => {
      const game = games[chatId];
      if (!game || game.players.length < 2) {
        delete games[chatId];
        return bot.sendMessage(chatId, '❌ Not enough players. Game cancelled.');
      }
      startXO(chatId);
    }, 20000);
    return;
  }

  /* ===== WCG GAMEPLAY ===== */
  if (games[chatId]?.started && games[chatId].type === 'wcg') {
    const game = games[chatId];
    const currentPlayer = game.players[game.currentTurn];
    if (userId !== currentPlayer) return;

    const word = text.toLowerCase();
    if (!word.startsWith(game.letter.toLowerCase()))
      return bot.sendMessage(chatId, '❌ Wrong starting letter');
    if (word.length < game.minLength)
      return bot.sendMessage(chatId, `❌ Word must be at least *${game.minLength} letters*`, { parse_mode: 'Markdown' });
    if (game.usedWords.includes(word))
      return bot.sendMessage(chatId, '❌ Word already used');
    if (!isValidWord(word))
      return bot.sendMessage(chatId, '📚 Invalid English word ❌');

    game.usedWords.push(word);
    clearTimeout(game.timer);
    game.minLength += getSettings(game.difficulty).inc;
    game.currentTurn = (game.currentTurn + 1) % game.players.length;
    nextWCGRound(chatId);
  }

  /* ===== XO GAMEPLAY ===== */
  if (games[chatId]?.started && games[chatId].type === 'xo') {
    const game = games[chatId];
    const currentPlayer = game.players[game.currentTurn];
    if (userId !== currentPlayer) return;

    const pos = parseInt(text) - 1;
    if (isNaN(pos) || pos < 0 || pos > 8) return;
    if (game.board[pos] !== '⬜') return;

    game.board[pos] = game.currentTurn === 0 ? '❌' : '⭕';
    if (checkWin(game.board)) {
      bot.sendMessage(chatId, renderBoard(game.board) + `\n🏆 ${uname(msg.from)} wins!`);
      delete games[chatId];
      return;
    } else if (!game.board.includes('⬜')) {
      bot.sendMessage(chatId, renderBoard(game.board) + '\n🤝 Draw!');
      delete games[chatId];
      return;
    }

    game.currentTurn = 1 - game.currentTurn;
    const nextPlayer = game.players[game.currentTurn];
    bot.sendMessage(chatId, renderBoard(game.board) + `\n🎯 ${uname({ id: nextPlayer })}'s turn. Type position 1-9`);
  }
});

/* =========================
   WCG FUNCTIONS
========================= */
function startWCG(chatId) {
  const game = games[chatId];
  game.started = true;
  game.currentTurn = 0;
  nextWCGRound(chatId);
}

function nextWCGRound(chatId) {
  const game = games[chatId];
  clearTimeout(game.timer);

  game.letter = randomLetter();
  const playerId = game.players[game.currentTurn];
  const settings = getSettings(game.difficulty);

  bot.sendMessage(chatId,
    `🔤 *New Round*\n👤 Player: ${uname({ id: playerId })}\n🅰️ Letter: *${game.letter}*\n📏 Min Length: *${game.minLength}*\n⏰ Time: ${settings.time / 1000}s`,
    { parse_mode: 'Markdown' }
  );

  game.timer = setTimeout(() => {
    const loser = game.players[game.currentTurn];
    bot.sendMessage(chatId, `⏰ ${uname({ id: loser })} eliminated ❌`);
    game.players.splice(game.currentTurn, 1);

    if (game.players.length === 1) {
      const winner = game.players[0];
      wcgLeaderboard[winner] = (wcgLeaderboard[winner] || 0) + 1;
      bot.sendMessage(chatId, `🏆 ${uname({ id: winner })} wins!\n🔥 Wins: ${wcgLeaderboard[winner]}`);
      delete games[chatId];
      return;
    }

    if (game.currentTurn >= game.players.length) game.currentTurn = 0;
    nextWCGRound(chatId);
  }, getSettings(game.difficulty).time);
}

/* =========================
   XO FUNCTIONS
========================= */
function startXO(chatId) {
  const game = games[chatId];
  game.started = true;
  game.currentTurn = 0;
  bot.sendMessage(chatId, renderBoard(game.board) + `\n🎯 ${uname({ id: game.players[game.currentTurn] })}'s turn. Type position 1-9`);
}

function renderBoard(board) {
  return `${board[0]}${board[1]}${board[2]}\n${board[3]}${board[4]}${board[5]}\n${board[6]}${board[7]}${board[8]}`;
}

function checkWin(b) {
  const wins = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  return wins.some(a => b[a[0]] === b[a[1]] && b[a[1]] === b[a[2]] && b[a[0]] !== '⬜');
}
