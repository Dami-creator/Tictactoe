import TelegramBot from 'node-telegram-bot-api';

const TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

/* =========================
   GLOBAL STATE
========================= */
const games = {};
const leaderboard = {};
const WCG_TIME = 30_000; // 30 seconds

/* =========================
   HELPERS
========================= */
function getName(user) {
  return user.username ? `@${user.username}` : user.first_name;
}

function addWin(username) {
  leaderboard[username] = (leaderboard[username] || 0) + 1;
}

/* =========================
   /wcg COMMAND
========================= */
bot.onText(/\/wcg/, msg => {
  const chatId = msg.chat.id;

  if (games[chatId]) {
    return bot.sendMessage(chatId, '⚠️ A game is already running.');
  }

  games[chatId] = {
    type: 'wcg',
    players: [],
    usedWords: new Set(),
    turn: 0,
    letter: String.fromCharCode(97 + Math.floor(Math.random() * 26)),
    minLength: Math.floor(Math.random() * 4) + 4,
    timer: null
  };

  bot.sendMessage(
    chatId,
    `🧠 *WORD CHAIN GAME*\n\nType *join* to enter`,
    { parse_mode: 'Markdown' }
  );
});

/* =========================
   /xo COMMAND (FIXED)
========================= */
bot.onText(/\/xo/, msg => {
  const chatId = msg.chat.id;

  if (games[chatId]) {
    return bot.sendMessage(chatId, '⚠️ A game is already running.');
  }

  games[chatId] = {
    type: 'xo',
    players: [],
    board: Array(9).fill(null),
    turn: 0,
    symbols: ['❌', '⭕']
  };

  bot.sendMessage(
    chatId,
    '❌⭕ *X & O*\n\nType *join* to play (2 players)',
    { parse_mode: 'Markdown' }
  );
});

/* =========================
   MESSAGE HANDLER
========================= */
bot.on('message', msg => {
  const chatId = msg.chat.id;
  const text = msg.text?.toLowerCase();
  const game = games[chatId];
  if (!game) return;

  const username = getName(msg.from);

  /* ===== JOIN ===== */
  if (text === 'join') {
    if (game.players.includes(username)) return;

    game.players.push(username);

    bot.sendMessage(chatId, `✅ ${username} joined`);

    /* START WCG */
    if (game.type === 'wcg' && game.players.length >= 2) {
      startWCG(chatId);
    }

    /* START XO */
    if (game.type === 'xo' && game.players.length === 2) {
      showBoard(chatId);
    }
    return;
  }

  /* ===== WCG WORD ===== */
  if (game.type === 'wcg') {
    const current = game.players[game.turn];
    if (username !== current) return;

    if (
      text.length < game.minLength ||
      !text.startsWith(game.letter) ||
      game.usedWords.has(text)
    ) {
      bot.sendMessage(chatId, `❌ Invalid word`);
      return;
    }

    clearTimeout(game.timer);
    game.usedWords.add(text);
    game.turn = (game.turn + 1) % game.players.length;

    askNextWCG(chatId);
  }

  /* ===== XO MOVE ===== */
  if (game.type === 'xo' && /^[1-9]$/.test(text)) {
    const idx = Number(text) - 1;
    const current = game.players[game.turn];
    if (username !== current || game.board[idx]) return;

    game.board[idx] = game.symbols[game.turn];

    if (checkWin(game.board)) {
      bot.sendMessage(chatId, `🎉 ${username} wins!`);
      addWin(username);
      delete games[chatId];
      return;
    }

    game.turn = 1 - game.turn;
    showBoard(chatId);
  }
});

/* =========================
   WCG FUNCTIONS
========================= */
function startWCG(chatId) {
  const game = games[chatId];
  bot.sendMessage(
    chatId,
    `🎮 Game Start!\nLetter: *${game.letter}*\nMin length: *${game.minLength}*`,
    { parse_mode: 'Markdown' }
  );
  askNextWCG(chatId);
}

function askNextWCG(chatId) {
  const game = games[chatId];
  const player = game.players[game.turn];

  bot.sendMessage(
    chatId,
    `👉 ${player}, your turn\nWord must start with *${game.letter}*`,
    { parse_mode: 'Markdown' }
  );

  game.timer = setTimeout(() => {
    bot.sendMessage(chatId, `⏱ ${player} removed (timeout)`);

    game.players.splice(game.turn, 1);

    if (game.players.length === 1) {
      const winner = game.players[0];
      bot.sendMessage(chatId, `🏆 ${winner} wins!`);
      addWin(winner);
      delete games[chatId];
      return;
    }

    game.turn %= game.players.length;
    askNextWCG(chatId);
  }, WCG_TIME);
}

/* =========================
   XO FUNCTIONS
========================= */
function showBoard(chatId) {
  const game = games[chatId];
  const b = game.board.map(v => v || '⬜');

  bot.sendMessage(
    chatId,
    `${b[0]} ${b[1]} ${b[2]}\n${b[3]} ${b[4]} ${b[5]}\n${b[6]} ${b[7]} ${b[8]}\n\n${game.players[game.turn]}'s turn`
  );
}

function checkWin(b) {
  const w = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  return w.some(([a,b1,c]) => b[a] && b[a] === b[b1] && b[a] === b[c]);
}

/* =========================
   /leaderboard
========================= */
bot.onText(/\/leaderboard/, msg => {
  const list = Object.entries(leaderboard)
    .map(([u,s],i)=>`${i+1}. ${u} — ${s}`)
    .join('\n') || 'No scores yet';

  bot.sendMessage(msg.chat.id, `🏆 *Leaderboard*\n\n${list}`, {
    parse_mode: 'Markdown'
  });
});

console.log('🤖 Bot running...');
