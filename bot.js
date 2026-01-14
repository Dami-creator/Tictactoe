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
               `🟢 /xo — Tic-Tac-Toe Game\n` +
               `🟢 join — Join a game lobby\n` +
               `🔄 /reset — Reset current game (players only)\n` +
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
    if (!game.players.find(p => p.id === userId)) {
      game.players.push({ id: userId, name: uname(msg.from) });
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
      usedWords: new Set(),
      letter: '',
      minLength: settings.startLen,
      difficulty,
      timer: null,
      lobbyTimer: null
    };

    bot.sendMessage(chatId,
      `🧩 *Word Challenge Game*\n\n` +
      `👥 Type *join* to play\n` +
      `🎚 Difficulty: *${difficulty}*\n` +
      `⏳ Game starts in 30 seconds`,
      { parse_mode: 'Markdown' }
    );

    games[chatId].lobbyTimer = setTimeout(() => {
      const game = games[chatId];
      if (!game || game.players.length < 2) {
        delete games[chatId];
        return bot.sendMessage(chatId, '❌ Not enough players. Game cancelled.');
      }
      startWCG(chatId);
    }, 30000);

    return;
  }

  /* ===== WCG GAMEPLAY ===== */
  if (games[chatId]?.started && games[chatId].type === 'wcg') {
    const game = games[chatId];
    const player = game.players[game.currentTurn];
    if (userId !== player.id) return;

    const word = text.toLowerCase();
    if (!word.startsWith(game.letter.toLowerCase()))
      return bot.sendMessage(chatId, '❌ Word must start with the correct letter');
    if (word.length < game.minLength)
      return bot.sendMessage(chatId, `❌ Word must be at least ${game.minLength} letters`);
    if (game.usedWords.has(word))
      return bot.sendMessage(chatId, '❌ Word already used');
    if (!isValidWord(word))
      return bot.sendMessage(chatId, '📚 Invalid English word ❌');

    game.usedWords.add(word);
    clearTimeout(game.timer);
    game.minLength += getSettings(game.difficulty).inc;
    game.currentTurn = (game.currentTurn + 1) % game.players.length;
    nextRound(chatId);
  }

  /* ===== WCG LEADERBOARD ===== */
  if (text === '/wcgleaderboard') {
    if (!Object.keys(wcgLeaderboard).length) return bot.sendMessage(chatId, '📭 No games yet.');
    let msg = '🏆 *Global WCG Leaderboard*\n\n';
    Object.entries(wcgLeaderboard)
      .sort((a, b) => b[1] - a[1])
      .forEach(([id, wins], i) => msg += `${i + 1}. ${id} — ${wins} wins\n`);
    return bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  }
});

/* =========================
   WCG GAME FLOW
========================= */
function startWCG(chatId) {
  const game = games[chatId];
  game.started = true;
  game.currentTurn = 0;
  game.usedWords = new Set();
  nextRound(chatId);
}

function nextRound(chatId) {
  const game = games[chatId];
  clearTimeout(game.timer);

  if (game.players.length === 1) {
    const winner = game.players[0];
    wcgLeaderboard[winner.name] = (wcgLeaderboard[winner.name] || 0) + 1;
    bot.sendMessage(chatId,
      `🏆 *Winner!*\n🎉 ${winner.name} wins!\n🔥 Wins: ${wcgLeaderboard[winner.name]}`,
      { parse_mode: 'Markdown' }
    );
    delete games[chatId];
    return;
  }

  if (game.currentTurn >= game.players.length) game.currentTurn = 0;
  const player = game.players[game.currentTurn];
  const settings = getSettings(game.difficulty);
  game.letter = randomLetter();

  bot.sendMessage(chatId,
    `🔤 *New Round*\n` +
    `👤 Player: ${player.name}\n` +
    `🅰️ Letter: *${game.letter}*\n` +
    `📏 Minimum Length: *${game.minLength} letters*\n` +
    `⏰ You have ${settings.time / 1000}s to respond`,
    { parse_mode: 'Markdown' }
  );

  game.timer = setTimeout(() => {
    const eliminated = game.players.splice(game.currentTurn, 1)[0];
    bot.sendMessage(chatId, `⏰ ${eliminated.name} failed to respond in time ❌`);
    nextRound(chatId);
  }, settings.time);
}

/* =========================
   XO / Tic-Tac-Toe
   (Simple placeholder logic)
========================= */
bot.onText(/\/xo/, msg => {
  bot.sendMessage(msg.chat.id, '🎮 Tic-Tac-Toe game coming soon!');
});
