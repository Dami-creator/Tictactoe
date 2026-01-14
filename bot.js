require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

/* =========================
   SIMPLE DICTIONARY
========================= */
const dictionary = new Set([
  "apple","ant","angle","animal","axe","ball","bat","cat","car","dog","door",
  "elephant","fish","frog","goat","hat","ice","ink","jug","kite","lion","monkey",
  "nose","orange","pen","queen","rat","sun","tiger","umbrella","van","wolf","xray",
  "yak","zebra"
]);

/* =========================
   GLOBAL STATE
========================= */
const games = {};
const leaderboard = {}; // { userId: { name, wins } }

/* =========================
   HELPERS
========================= */
function uname(user) {
  return user.username ? `@${user.username}` : user.first_name;
}

function recordWin(user) {
  if (!leaderboard[user.id]) {
    leaderboard[user.id] = {
      name: uname(user),
      wins: 0
    };
  }
  leaderboard[user.id].wins++;
}

function randomLetter() {
  return String.fromCharCode(65 + Math.floor(Math.random() * 26));
}

/* =========================
   COMMANDS
========================= */
bot.onText(/\/start/, msg => {
  bot.sendMessage(
    msg.chat.id,
    `👋 Welcome ${uname(msg.from)}!\n\n` +
    `🧩 /wcg — Word Challenge Game\n` +
    `❎⭕ /xo — Tic Tac Toe\n` +
    `🏆 /leaderboard — Global rankings\n` +
    `🧑‍🤝‍🧑 join — Join lobby\n` +
    `🔄 /reset — Reset game`
  );
});

bot.onText(/\/leaderboard/, msg => {
  if (Object.keys(leaderboard).length === 0) {
    return bot.sendMessage(msg.chat.id, '📭 No games won yet.');
  }

  const sorted = Object.values(leaderboard)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10);

  let text = '🏆 *Global Leaderboard*\n\n';
  sorted.forEach((p, i) => {
    text += `${i + 1}. ${p.name} — *${p.wins}* wins\n`;
  });

  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

/* =========================
   MESSAGE HANDLER
========================= */
bot.on('message', msg => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text) return;

  /* RESET */
  if (text === '/reset' && games[chatId]) {
    clearTimeout(games[chatId].timer);
    delete games[chatId];
    return bot.sendMessage(chatId, '🔄 Game reset.');
  }

  /* JOIN */
  if (text.toLowerCase() === 'join' && games[chatId] && !games[chatId].started) {
    const game = games[chatId];
    if (!game.players.find(p => p.id === msg.from.id)) {
      game.players.push({
        id: msg.from.id,
        username: msg.from.username,
        first_name: msg.from.first_name
      });
      bot.sendMessage(chatId, `✅ ${uname(msg.from)} joined`);
    }
    return;
  }

  /* START WCG */
  if (text === '/wcg') {
    games[chatId] = {
      type: 'wcg',
      players: [],
      started: false,
      turn: 0,
      letter: '',
      minLen: 3,
      used: [],
      timer: null
    };

    bot.sendMessage(chatId, `🧩 *WCG Lobby*\nType *join*\n⏳ Starts in 15s`, { parse_mode: 'Markdown' });

    setTimeout(() => {
      if (games[chatId]?.players.length < 2) {
        delete games[chatId];
        return bot.sendMessage(chatId, '❌ Not enough players.');
      }
      startWCG(chatId);
    }, 15000);
    return;
  }

  /* START XO */
  if (text === '/xo') {
    games[chatId] = {
      type: 'xo',
      players: [],
      board: Array(9).fill('⬜'),
      turn: 0,
      started: false
    };

    bot.sendMessage(chatId, `❎⭕ Tic Tac Toe Lobby\nType *join*\n⏳ Starts in 15s`);

    setTimeout(() => {
      if (games[chatId]?.players.length < 2) {
        delete games[chatId];
        return bot.sendMessage(chatId, '❌ Not enough players.');
      }
      startXO(chatId);
    }, 15000);
    return;
  }

  /* WCG GAMEPLAY */
  if (games[chatId]?.type === 'wcg' && games[chatId].started) {
    const game = games[chatId];
    const player = game.players[game.turn];
    if (msg.from.id !== player.id) return;

    const word = text.toLowerCase();

    if (!word.startsWith(game.letter.toLowerCase()))
      return bot.sendMessage(chatId, '❌ Wrong starting letter');

    if (word.length < game.minLen)
      return bot.sendMessage(chatId, `❌ Minimum ${game.minLen} letters`);

    if (game.used.includes(word))
      return bot.sendMessage(chatId, '❌ Word already used');

    if (!dictionary.has(word))
      return bot.sendMessage(chatId, '❌ Not a valid word');

    game.used.push(word);
    game.minLen++;
    game.turn = (game.turn + 1) % game.players.length;
    nextWCGRound(chatId);
  }

  /* XO GAMEPLAY */
  if (games[chatId]?.type === 'xo' && games[chatId].started) {
    const game = games[chatId];
    const player = game.players[game.turn];
    if (msg.from.id !== player.id) return;

    const pos = parseInt(text) - 1;
    if (isNaN(pos) || pos < 0 || pos > 8) return;
    if (game.board[pos] !== '⬜') return;

    game.board[pos] = game.turn === 0 ? '❌' : '⭕';

    if (checkWin(game.board)) {
      recordWin(player);
      bot.sendMessage(chatId, renderBoard(game.board) + `\n🏆 ${uname(player)} wins!`);
      delete games[chatId];
      return;
    }

    game.turn = 1 - game.turn;
    bot.sendMessage(
      chatId,
      renderBoard(game.board) + `\n🎯 ${uname(game.players[game.turn])}'s turn (1–9)`
    );
  }
});

/* =========================
   WCG FUNCTIONS
========================= */
function startWCG(chatId) {
  const game = games[chatId];
  game.started = true;
  nextWCGRound(chatId);
}

function nextWCGRound(chatId) {
  const game = games[chatId];
  clearTimeout(game.timer);

  game.letter = randomLetter();
  const player = game.players[game.turn];

  bot.sendMessage(
    chatId,
    `🔤 Letter: *${game.letter}*\n👤 Player: *${uname(player)}*\n📏 Min Length: *${game.minLen}*`,
    { parse_mode: 'Markdown' }
  );

  game.timer = setTimeout(() => {
    bot.sendMessage(chatId, `⏰ ${uname(player)} eliminated`);
    game.players.splice(game.turn, 1);

    if (game.players.length === 1) {
      recordWin(game.players[0]);
      bot.sendMessage(chatId, `🏆 ${uname(game.players[0])} wins!`);
      delete games[chatId];
      return;
    }

    if (game.turn >= game.players.length) game.turn = 0;
    nextWCGRound(chatId);
  }, 20000);
}

/* =========================
   XO HELPERS
========================= */
function renderBoard(b) {
  return `${b[0]}${b[1]}${b[2]}\n${b[3]}${b[4]}${b[5]}\n${b[6]}${b[7]}${b[8]}`;
}

function checkWin(b) {
  const w = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  return w.some(a => b[a[0]] === b[a[1]] && b[a[1]] === b[a[2]] && b[a[0]] !== '⬜');
}
