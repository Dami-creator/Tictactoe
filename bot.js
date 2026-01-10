require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });

const games = {};
const scores = {};

const WIN_COMBOS = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

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

bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id,
    "🎮 Tic Tac Toe Bot\n\n/play - Play with a friend\n/ai - Play vs AI\n/score - Your score\n/leaderboard - Global leaderboard"
  );
});

bot.onText(/\/play/, msg => {
  const chatId = msg.chat.id;
  const user = msg.from.first_name;

  games[chatId] = { board: Array(9).fill(' '), turn: '❌', ai: false, names: { '❌': user, '⭕': 'Opponent' } };
  bot.sendMessage(chatId, `Game started!\n❌ ${user}'s turn\n\n${buildBoardMessage(games[chatId].board)}`);
});

bot.onText(/\/ai/, msg => {
  const chatId = msg.chat.id;
  const user = msg.from.first_name;

  games[chatId] = { board: Array(9).fill(' '), turn: '❌', ai: true, names: { '❌': user, '⭕': '🤖 AI' } };
  bot.sendMessage(chatId, `AI Game started!\n❌ ${user}'s turn\n\n${buildBoardMessage(games[chatId].board)}`);
});

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

// Move handling
bot.on('message', msg => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!games[chatId] || ['/', 'play', 'ai', 'score', 'leaderboard'].some(cmd => text.includes(cmd))) return;

  const game = games[chatId];
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
});
