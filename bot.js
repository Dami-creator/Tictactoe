require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });

// --- Global game states and scores ---
const games = {};
const scores = {};
const WIN_COMBOS = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

// --- Helper functions ---
function checkWinner(board) {
  for (const [a,b,c] of WIN_COMBOS) {
    if (board[a] === board[b] && board[b] === board[c] && board[a] !== ' ') return board[a];
  }
  if (!board.includes(' ')) return 'Draw';
  return null;
}

function buildBoardMessage(board) {
  let str = '';
  for (let i = 0; i < board.length; i++) {
    str += board[i] === ' ' ? '➖' : board[i];
    if ((i+1)%3 === 0) str += '\n';
  }
  return str;
}

// --- Bot Commands ---

bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id,
`🎮 Mini-Game Hub
/play - Tic-Tac-Toe vs friend
/ai - Tic-Tac-Toe vs AI
/hangman - Play Hangman
/trivia - Play Trivia
/wcg - Word Chain Game
/score - Your score
/leaderboard - Global leaderboard
/reset - Reset any ongoing game`);
});

// --- Reset command ---
bot.onText(/\/reset/, msg => {
  const chatId = msg.chat.id;
  if (games[chatId]) {
    delete games[chatId];
    bot.sendMessage(chatId, "✅ All ongoing games have been reset.");
  } else {
    bot.sendMessage(chatId, "ℹ️ No ongoing games to reset.");
  }
});

// --- Tic-Tac-Toe ---
bot.onText(/\/play/, msg => {
  const chatId = msg.chat.id;
  const user = msg.from.first_name;

  games[chatId] = { type: "tictactoe", board: Array(9).fill(' '), turn: '❌', ai: false, names: { '❌': user, '⭕': 'Opponent' } };
  bot.sendMessage(chatId, `🎮 Tic-Tac-Toe started!\n❌ ${user}'s turn\n\n${buildBoardMessage(games[chatId].board)}`);
});

bot.onText(/\/ai/, msg => {
  const chatId = msg.chat.id;
  const user = msg.from.first_name;

  games[chatId] = { type: "tictactoe", board: Array(9).fill(' '), turn: '❌', ai: true, names: { '❌': user, '⭕': '🤖 AI' } };
  bot.sendMessage(chatId, `🎮 Tic-Tac-Toe vs AI started!\n❌ ${user}'s turn\n\n${buildBoardMessage(games[chatId].board)}`);
});

// --- Hangman ---
const words = ["javascript", "telegram", "nodejs", "render", "bot"];
bot.onText(/\/hangman/, msg => {
  const chatId = msg.chat.id;
  const word = words[Math.floor(Math.random() * words.length)];
  games[chatId] = { type: "hangman", state: { word, display: "_".repeat(word.length).split(''), attempts: 6, guessed: [] } };
  bot.sendMessage(chatId, `🎯 Hangman started!\n${games[chatId].state.display.join(' ')}\nAttempts left: 6\nGuess a letter by sending it.`);
});

// --- Trivia ---
const triviaQs = [
  { q: "Capital of France?", a: "paris" },
  { q: "2 + 2 * 2 = ?", a: "6" },
  { q: "Largest planet?", a: "jupiter" }
];

bot.onText(/\/trivia/, msg => {
  const chatId = msg.chat.id;
  const question = triviaQs[Math.floor(Math.random() * triviaQs.length)];
  games[chatId] = { type: "trivia", state: { question } };
  bot.sendMessage(chatId, `❓ Trivia: ${question.q}\nReply with the answer.`);
});

// --- Word Chain Game ---
bot.onText(/\/wcg/, msg => {
  const chatId = msg.chat.id;
  games[chatId] = { type: "wcg", state: { lastWord: "", used: [] } };
  bot.sendMessage(chatId, "🔗 Word Chain Game started! Send the first word.");
});

// --- Score & Leaderboard ---
bot.onText(/\/score/, msg => {
  const user = msg.from.first_name;
  const sc = scores[user] || 0;
  bot.sendMessage(msg.chat.id, `🏆 ${user}, your score: ${sc}`);
});

bot.onText(/\/leaderboard/, msg => {
  const chatId = msg.chat.id;
  if (Object.keys(scores).length === 0) {
    bot.sendMessage(chatId, "📉 No games played yet.");
    return;
  }
  const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]);
  let text = "🏆 Global Leaderboard\n\n";
  sorted.slice(0,10).forEach(([name, sc], i) => {
    const medal = i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : '🔹';
    text += `${medal} ${i+1}. ${name} — ${sc} wins\n`;
  });
  bot.sendMessage(chatId, text);
});

// --- Handle Messages for All Games ---
bot.on('message', msg => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const game = games[chatId];
  if (!game) return;
  if (text.startsWith("/")) return; // Ignore commands

  // --- Tic-Tac-Toe Moves ---
  if (game.type === "tictactoe") {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx > 8 || game.board[idx] !== ' ') return;
    game.board[idx] = game.turn;
    let winner = checkWinner(game.board);
    if (winner) {
      if (winner !== 'Draw') {
        const name = game.names[winner];
        scores[name] = (scores[name] || 0) + 1;
        bot.sendMessage(chatId, `🏆 ${name} wins!\n\n${buildBoardMessage(game.board)}`);
      } else {
        bot.sendMessage(chatId, `🤝 It's a draw!\n\n${buildBoardMessage(game.board)}`);
      }
      delete games[chatId];
      return;
    }
    game.turn = game.turn === '❌' ? '⭕' : '❌';

    if (game.ai && game.turn === '⭕') {
      const empty = game.board.map((v,i) => v===' '?i:null).filter(v=>v!==null);
      const move = empty[Math.floor(Math.random()*empty.length)];
      game.board[move] = '⭕';
      winner = checkWinner(game.board);
      if (winner) {
        if (winner !== 'Draw') {
          scores['🤖 AI'] = (scores['🤖 AI']||0)+1;
          bot.sendMessage(chatId, `🤖 AI wins!\n\n${buildBoardMessage(game.board)}`);
        } else {
          bot.sendMessage(chatId, `🤝 It's a draw!\n\n${buildBoardMessage(game.board)}`);
        }
        delete games[chatId];
        return;
      }
      game.turn = '❌';
    }
    bot.sendMessage(chatId, `Turn: ${game.turn} (${game.names[game.turn]})\n\n${buildBoardMessage(game.board)}`);
    return;
  }

  // --- Hangman ---
  if (game.type === "hangman") {
    const state = game.state;
    const letter = text.toLowerCase();
    if (!/^[a-z]$/.test(letter)) return;
    if (state.guessed.includes(letter)) return;
    state.guessed.push(letter);
    let found = false;
    for (let i = 0; i < state.word.length; i++) {
      if (state.word[i] === letter) state.display[i] = letter, found = true;
    }
    if (!found) state.attempts--;
    if (!state.display.includes("_")) { bot.sendMessage(chatId, `🎉 You won! The word was: ${state.word}`); delete games[chatId]; return; }
    if (state.attempts <= 0) { bot.sendMessage(chatId, `💀 Game over! The word was: ${state.word}`); delete games[chatId]; return; }
    bot.sendMessage(chatId, `${state.display.join(' ')}\nAttempts left: ${state.attempts}`);
    return;
  }

  // --- Trivia ---
  if (game.type === "trivia") {
    const answer = game.state.question.a.toLowerCase();
    if (text.toLowerCase() === answer) { bot.sendMessage(chatId, `✅ Correct!`); delete games[chatId]; }
    else bot.sendMessage(chatId, `❌ Incorrect, try again!`);
    return;
  }

  // --- Word Chain Game ---
  if (game.type === "wcg") {
    const state = game.state;
    const word = text.toLowerCase();
    if (state.used.includes(word)) { bot.sendMessage(chatId, "❌ Word already used, try a different one."); return; }
    if (state.lastWord && state.lastWord.slice(-1) !== word[0]) { bot.sendMessage(chatId, `❌ Word must start with '${state.lastWord.slice(-1)}'`); return; }
    state.used.push(word);
    state.lastWord = word;
    bot.sendMessage(chatId, `✅ Accepted! Next word must start with '${word.slice(-1)}'`);
    return;
  }
});
