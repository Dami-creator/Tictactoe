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
const games = {}; 
const wcgLeaderboard = {};
const premiumUsers = new Set([]); // Add premium Telegram IDs if needed

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
               `🟢 /hangman — Hangman Game\n` +
               `🟢 /trivia — Trivia Game\n` +
               `🟢 join — Join a game lobby\n` +
               `🔄 /reset — Reset current game (players only)\n` +
               `🏆 /wcgleaderboard — Show WCG leaderboard\n` +
               `🔞 /porn — Premium only content\n` +
               `🔁 /redeploy — Restart the bot\n\n` +
               `💡 Tip: Only current players can reset a game.\n` +
               `💬 Premium content unlock: message [TyburnUK](https://t.me/TyburnUK)`;

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

  /* ===== PREMIUM COMMAND ===== */
  if (text === '/porn') {
    if (!premiumUsers.has(userId)) {
      return bot.sendMessage(chatId,
        `🚫 Access Denied! ⚠️\n` +
        `This command is ONLY available to Premium users. 💰\n` +
        `To unlock, message [TyburnUK](https://t.me/TyburnUK) on Telegram.\n` +
        `❌ Until then, you cannot use this command.`,
        { parse_mode: 'Markdown' }
      );
    }
    return bot.sendMessage(chatId, '✅ Welcome, Premium user! Here is your content.');
  }

  /* ===== REDEPLOY COMMAND ===== */
  if (text === '/redeploy') {
    // Only owner can redeploy, for security you can check ID
    if (userId !== YOUR_TELEGRAM_ID) return;

    const renderApiKey = process.env.RENDER_API_KEY;
    const serviceId = process.env.RENDER_SERVICE_ID;

    if (!renderApiKey || !serviceId)
      return bot.sendMessage(chatId, '❌ Render variables missing.');

    const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${renderApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ })
    });
    if (res.ok) {
      bot.sendMessage(chatId, '🔁 Redeploy triggered successfully!');
    } else {
      bot.sendMessage(chatId, '❌ Failed to trigger redeploy.');
    }
    return;
  }

  /* ===== RESET COMMAND ===== */
  if (text === '/reset' && games[chatId]) {
    const game = games[chatId];
    if (!game.players.includes(userId)) return;
    clearTimeout(game.timer);
    clearTimeout(game.lobbyTimer);
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

  /* ===== HANGMAN & TRIVIA START ===== */
  // Implement similarly with dictionary & proper checks...
});

/* =========================
   WCG GAME FLOW
========================= */
function startWCG(chatId) {
  const game = games[chatId];
  game.started = true;
  game.currentTurn = 0;
  game.usedWords = [];
  nextRound(chatId);
}

function nextRound(chatId) {
  const game = games[chatId];
  clearTimeout(game.timer);

  game.letter = randomLetter();
  const playerId = game.players[game.currentTurn];
  const settings = getSettings(game.difficulty);

  bot.sendMessage(chatId,
    `🔤 *New Round*\n\n` +
    `👤 Player: ${uname({ id: playerId })}\n` +
    `🅰️ Letter: *${game.letter}*\n` +
    `⏰ Time: ${settings.time / 1000}s`,
    { parse_mode: 'Markdown' }
  );

  game.timer = setTimeout(() => {
    const loser = game.players[game.currentTurn];
    game.players.splice(game.currentTurn, 1);

    bot.sendMessage(chatId, `⏰ ${uname({ id: loser })} eliminated ❌`, { parse_mode: 'Markdown' });

    if (game.players.length === 1) {
      const winner = game.players[0];
      wcgLeaderboard[winner] = (wcgLeaderboard[winner] || 0) + 1;
      bot.sendMessage(chatId,
        `🏆 *Winner!*\n🎉 ${uname({ id: winner })} wins!\n🔥 Wins: ${wcgLeaderboard[winner]}`,
        { parse_mode: 'Markdown' }
      );
      delete games[chatId];
      return;
    }

    if (game.currentTurn >= game.players.length) game.currentTurn = 0;
    nextRound(chatId);
  }, settings.time);
}

/* =========================
   BACKGROUND WORKER LOG
========================= */
console.log('🤖 Bot started as background worker ✅');
