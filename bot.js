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
  return { startLen: 4, inc: 1, time: 20000 }; // medium
}

/* =========================
   START MENU
========================= */
bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id;

  const menu =
`👋 Hello ${uname(msg.from)}

🎮 *Games Available*
🟢 /wcg — Word Challenge Game
🟢 /xo — X & O (Tic Tac Toe)

📌 *How to play WCG*
• Type /wcg
• Players type *join*
• Game starts automatically
• Each player has limited time ⏱

🏆 /wcgleaderboard — WCG leaderboard
🔄 /reset — Reset current game`;

  bot.sendMessage(chatId, menu, { parse_mode: 'Markdown' });
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
    if (games[chatId]) {
      return bot.sendMessage(chatId, '⚠️ A game is already running.');
    }

    const difficulty = 'medium';
    const settings = getSettings(difficulty);

    games[chatId] = {
      type: 'wcg',
      players: [],
      playerMap: {},      // id → username
      started: false,
      currentTurn: 0,
      usedWords: [],
      letter: '',
      minLength: settings.startLen,
      difficulty,
      timer: null,
      lobbyTimer: null
    };

    bot.sendMessage(
      chatId,
      `🧩 *Word Challenge Game*

👥 Type *join* to play
🎚 Difficulty: *${difficulty}*
⏳ Game starts in 30 seconds`,
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

  /* ===== JOIN ===== */
  if (text.toLowerCase() === 'join' && games[chatId] && !games[chatId].started) {
    const game = games[chatId];
    if (game.players.includes(userId)) return;

    game.players.push(userId);
    game.playerMap[userId] = uname(msg.from);

    return bot.sendMessage(chatId, `✅ ${uname(msg.from)} joined`);
  }

  /* =========================
     WCG GAMEPLAY
  ========================= */
  if (games[chatId]?.started && games[chatId].type === 'wcg') {
    const game = games[chatId];
    const currentPlayer = game.players[game.currentTurn];

    if (userId !== currentPlayer) return;

    const word = text.toLowerCase();

    if (!word.startsWith(game.letter.toLowerCase())) {
      return bot.sendMessage(chatId, '❌ Word must start with the given letter.');
    }

    if (word.length < game.minLength) {
      return bot.sendMessage(
        chatId,
        `❌ Word must be at least *${game.minLength} letters*`,
        { parse_mode: 'Markdown' }
      );
    }

    if (game.usedWords.includes(word)) {
      return bot.sendMessage(chatId, '❌ Word already used.');
    }

    game.usedWords.push(word);
    clearTimeout(game.timer);

    game.minLength += getSettings(game.difficulty).inc;
    game.currentTurn = (game.currentTurn + 1) % game.players.length;

    nextWCGRound(chatId);
  }

  /* =========================
     LEADERBOARD
  ========================= */
  if (text === '/wcgleaderboard') {
    if (!Object.keys(wcgLeaderboard).length) {
      return bot.sendMessage(chatId, '📭 No WCG games played yet.');
    }

    let msg = '🏆 *WCG Leaderboard*\n\n';
    Object.entries(wcgLeaderboard)
      .sort((a, b) => b[1] - a[1])
      .forEach(([id, wins], i) => {
        msg += `${i + 1}. ${wins} wins — ${id}\n`;
      });

    return bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  }
});

/* =========================
   WCG FLOW
========================= */
function startWCG(chatId) {
  const game = games[chatId];
  game.started = true;
  game.currentTurn = 0;
  game.usedWords = [];
  nextWCGRound(chatId);
}

function nextWCGRound(chatId) {
  const game = games[chatId];
  if (!game) return;

  clearTimeout(game.timer);

  // WIN CHECK
  if (game.players.length === 1) {
    const winnerId = game.players[0];
    wcgLeaderboard[winnerId] = (wcgLeaderboard[winnerId] || 0) + 1;

    bot.sendMessage(
      chatId,
      `🏆 *Winner!*
🎉 ${game.playerMap[winnerId]}
🔥 Wins: ${wcgLeaderboard[winnerId]}`,
      { parse_mode: 'Markdown' }
    );

    delete games[chatId];
    return;
  }

  const settings = getSettings(game.difficulty);
  game.letter = randomLetter();

  const playerId = game.players[game.currentTurn];
  const username = game.playerMap[playerId];

  bot.sendMessage(
    chatId,
    `🔤 *New Round*

👤 Player: *${username}*
🅰️ Letter: *${game.letter}*
📏 Min length: *${game.minLength}+*
⏱ Time: *${settings.time / 1000}s*`,
    { parse_mode: 'Markdown' }
  );

  // ⏱ TIMER (ONLY WCG)
  game.timer = setTimeout(() => {
    bot.sendMessage(
      chatId,
      `⏰ *Time up!*
❌ ${username} eliminated`,
      { parse_mode: 'Markdown' }
    );

    game.players.splice(game.currentTurn, 1);
    if (game.currentTurn >= game.players.length) {
      game.currentTurn = 0;
    }

    nextWCGRound(chatId);
  }, settings.time);
}
