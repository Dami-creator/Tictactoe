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
               `🔞 /porn — Premium only content\n\n` +
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

  /* ===== HANGMAN START ===== */
  if (text === '/hangman') {
    if (games[chatId]) return bot.sendMessage(chatId, '⚠️ A game is already running.');

    const wordArr = Array.from(dictionary);
    const word = wordArr[Math.floor(Math.random() * wordArr.length)];

    games[chatId] = {
      type: 'hangman',
      word,
      guessed: [],
      tries: 6,
      players: [userId],
      started: true,
      timer: null
    };

    return bot.sendMessage(chatId,
      `🎯 *Hangman Game*\nWord: ${'_ '.repeat(word.length)}\nGuess letters!`,
      { parse_mode: 'Markdown' }
    );
  }

  /* ===== TRIVIA START ===== */
  if (text === '/trivia') {
    if (games[chatId]) return bot.sendMessage(chatId, '⚠️ A game is already running.');

    const wordArr = Array.from(dictionary);
    const answer = wordArr[Math.floor(Math.random() * wordArr.length)];

    games[chatId] = {
      type: 'trivia',
      answer,
      started: true,
      players: [userId],
      timer: null
    };

    return bot.sendMessage(chatId,
      `❓ *Trivia Game*\nGuess the word!`,
      { parse_mode: 'Markdown' }
    );
  }

  /* ===== LEADERBOARD ===== */
  if (text === '/wcgleaderboard') {
    if (!Object.keys(wcgLeaderboard).length) return bot.sendMessage(chatId, '📭 No games yet.');
    let msg = '🏆 *Global WCG Leaderboard*\n\n';
    Object.entries(wcgLeaderboard)
      .sort((a, b) => b[1] - a[1])
      .forEach(([id, wins], i) => msg += `${i + 1}. <@${id}> — ${wins} wins\n`);
    return bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  }

  /* ===== GAMEPLAY ===== */
  if (games[chatId]?.started) {
    const game = games[chatId];

    /* ------ WCG ------ */
    if (game.type === 'wcg') {
      const currentPlayer = game.players[game.currentTurn];
      if (userId !== currentPlayer) return;

      const word = text.toLowerCase();
      if (!word.startsWith(game.letter.toLowerCase()))
        return bot.sendMessage(chatId, '❌ Wrong starting letter');
      if (word.length !== game.minLength)
        return bot.sendMessage(chatId, `❌ Word must be *${game.minLength} letters*`, { parse_mode: 'Markdown' });
      if (game.usedWords.includes(word))
        return bot.sendMessage(chatId, '❌ Word already used');
      if (!isValidWord(word))
        return bot.sendMessage(chatId, '📚 Invalid English word ❌');

      game.usedWords.push(word);
      clearTimeout(game.timer);
      game.minLength += getSettings(game.difficulty).inc;
      game.currentTurn = (game.currentTurn + 1) % game.players.length;
      nextRound(chatId);
    }

    /* ------ Hangman ------ */
    if (game.type === 'hangman') {
      const letter = text.toLowerCase();
      if (letter.length !== 1) return;
      if (game.guessed.includes(letter)) return;
      game.guessed.push(letter);

      if (!game.word.includes(letter)) game.tries--;

      let display = '';
      for (const l of game.word) display += game.guessed.includes(l) ? l : '_';
      bot.sendMessage(chatId, `🎯 ${display}\nTries left: ${game.tries}`);

      if (!display.includes('_')) {
        delete games[chatId];
        bot.sendMessage(chatId, `🏆 *You guessed it!* The word was: ${game.word}`, { parse_mode: 'Markdown' });
      } else if (game.tries <= 0) {
        delete games[chatId];
        bot.sendMessage(chatId, `💀 *Game Over!* The word was: ${game.word}`, { parse_mode: 'Markdown' });
      }
    }

    /* ------ Trivia ------ */
    if (game.type === 'trivia') {
      const word = text.toLowerCase();
      if (word === game.answer) {
        delete games[chatId];
        bot.sendMessage(chatId, `🏆 Correct! The answer was: *${game.answer}*`, { parse_mode: 'Markdown' });
      }
    }
  }
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
    `👤 Player: <@${playerId}>\n` +
    `🅰️ Letter: *${game.letter}*\n` +
    `📏 Length: *${game.minLength} letters*\n` +
    `⏰ Time: ${settings.time / 1000}s`,
    { parse_mode: 'Markdown' }
  );

  game.timer = setTimeout(() => {
    const loser = game.players[game.currentTurn];
    game.players.splice(game.currentTurn, 1);

    bot.sendMessage(chatId, `⏰ <@${loser}> eliminated ❌`, { parse_mode: 'Markdown' });

    if (game.players.length === 1) {
      const winner = game.players[0];
      wcgLeaderboard[winner] = (wcgLeaderboard[winner] || 0) + 1;
      bot.sendMessage(chatId,
        `🏆 *Winner!*\n🎉 <@${winner}> wins!\n🔥 Wins: ${wcgLeaderboard[winner]}`,
        { parse_mode: 'Markdown' }
      );
      delete games[chatId];
      return;
    }

    if (game.currentTurn >= game.players.length) game.currentTurn = 0;
    nextRound(chatId);
  }, settings.time);
}
