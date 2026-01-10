require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });

// --- Global State ---
const games = {};
const scores = {};
const WIN_COMBOS = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

// --- Helper Functions ---
function checkWinner(board){
  for(const [a,b,c] of WIN_COMBOS)
    if(board[a]===board[b] && board[b]===board[c] && board[a]!==' ') return board[a];
  if(!board.includes(' ')) return 'Draw';
  return null;
}
function nextPlayer(game){ game.turnIndex=(game.turnIndex+1)%game.players.length; return game.players[game.turnIndex]; }
function buildBoardMessage(board){ return board.map((v,i)=>v===' '?"➖":v).reduce((str,v,i)=>str+v+((i+1)%3===0?'\n':' '),''); }
function buildTicTacToeKeyboard(board){
  return { inline_keyboard: [
    board.slice(0,3).map((v,i)=>({text:v===' '?"➖":v, callback_data:`ttt_${i}`})),
    board.slice(3,6).map((v,i)=>({text:v===' '?"➖":v, callback_data:`ttt_${i+3}`})),
    board.slice(6,9).map((v,i)=>({text:v===' '?"➖":v, callback_data:`ttt_${i+6}`}))
  ]};
}
function randomMove(board){
  const empty = board.map((v,i)=>v===' '?i:null).filter(v=>v!==null);
  return empty[Math.floor(Math.random()*empty.length)];
}
function findWinningMove(board, symbol){
  for(const [a,b,c] of WIN_COMBOS){
    const values = [board[a], board[b], board[c]];
    if(values.filter(v=>v===symbol).length===2 && values.includes(' ')){
      const idx = [a,b,c].find(i=>board[i]===' ');
      return idx;
    }
  }
  return null;
}
function minimax(newBoard, player){
  const avail = newBoard.map((v,i)=>v===' '?i:null).filter(v=>v!==null);
  const human = "X", ai = "O";
  const winner = checkWinner(newBoard);
  if(winner==='X') return {score:-10};
  if(winner==='O') return {score:10};
  if(avail.length===0) return {score:0};

  const moves = [];
  for(const i of avail){
    const move = {};
    move.index = i;
    newBoard[i] = player;
    const result = minimax(newBoard, player===ai?human:ai);
    move.score = result.score;
    newBoard[i] = ' ';
    moves.push(move);
  }

  let bestMove;
  if(player===ai){
    let bestScore=-Infinity;
    for(const m of moves) if(m.score>bestScore){ bestScore=m.score; bestMove=m; }
    return bestMove;
  } else {
    let bestScore=Infinity;
    for(const m of moves) if(m.score<bestScore){ bestScore=m.score; bestMove=m; }
    return bestMove;
  }
}

// --- Startup Menu ---
bot.onText(/\/start/, msg=>{
  bot.sendMessage(msg.chat.id,
`🎮 Mini-Game Hub
/play - Tic-Tac-Toe vs friend
/ai [easy|medium|hard] - Tic-Tac-Toe vs AI
/join - Join Tic-Tac-Toe
/hangman - Hangman
/trivia - Trivia
/wcg [easy|medium|hard] - Word Chain Game
/score - Your score
/leaderboard - Global leaderboard
/reset - Reset current game (players only)
/porn - Premium command 🔒 (message owner to unlock)

💡 Only the /porn command requires Premium. All other games are free!`);
});

// --- Reset Command ---
bot.onText(/\/reset/, msg=>{
  const chatId=msg.chat.id;
  const game=games[chatId];
  if(!game) return bot.sendMessage(chatId,"ℹ️ No game to reset.");
  if(!game.players.some(p=>p.id===msg.from.id)) return bot.sendMessage(chatId,"⚠️ Only current players can reset this game.");
  if(game.state?.timeout) clearInterval(game.state.timeout);
  delete games[chatId];
  bot.sendMessage(chatId,"✅ Game has been reset by a player.");
});

// --- Tic-Tac-Toe vs Friend ---
bot.onText(/\/play/, msg=>{
  const chatId=msg.chat.id, user=msg.from;
  if(games[chatId]) return bot.sendMessage(chatId,"⚠️ Finish current game or /reset.");
  games[chatId]={type:"tictactoe", board:Array(9).fill(' '), players:[user], turnIndex:0, ai:false, messageId:null, state:{}};
  if(msg.chat.type==="private") bot.sendMessage(chatId,"Waiting for friend to /join.");
  else bot.sendMessage(chatId,`${user.first_name} started Tic-Tac-Toe! Another player type /join.`);
});

bot.onText(/\/join/, msg=>{
  const chatId=msg.chat.id, user=msg.from, game=games[chatId];
  if(!game || game.type!=="tictactoe") return;
  if(game.players.length>=2) return bot.sendMessage(chatId,"⚠️ Two players already.");
  if(game.players.find(p=>p.id===user.id)) return;
  game.players.push(user);
  bot.sendMessage(chatId,`${game.players[game.turnIndex].first_name}'s turn!`, {reply_markup: buildTicTacToeKeyboard(game.board)})
     .then(m=>{
         game.messageId=m.message_id; 
         startTttTimer(chatId); 
         startAutoLeaderboard(chatId);
     });
});

// --- Tic-Tac-Toe vs AI ---
bot.onText(/\/ai(?:\s+(\w+))?/, msg => {
  const chatId = msg.chat.id;
  if(games[chatId]) return bot.sendMessage(chatId, "⚠️ Finish current game or /reset.");

  const level = (msg.text.split(" ")[1] || "medium").toLowerCase();
  if(!["easy","medium","hard"].includes(level)) return bot.sendMessage(chatId,"⚠️ Difficulty must be easy, medium, or hard.");

  games[chatId] = {
    type: "tictactoe",
    board: Array(9).fill(' '),
    players: [msg.from],
    turnIndex: 0,
    ai: true,
    aiLevel: level,
    messageId: null,
    state: {}
  };

  bot.sendMessage(chatId, `${msg.from.first_name}'s turn! AI difficulty: ${level.toUpperCase()}`, { reply_markup: buildTicTacToeKeyboard(games[chatId].board) })
     .then(m => { 
         games[chatId].messageId = m.message_id; 
         startTttTimer(chatId); 
         startAutoLeaderboard(chatId);
     });
});

// --- Hangman ---
const words=["javascript","telegram","nodejs","render","bot"];
bot.onText(/\/hangman/, msg=>{
  const chatId=msg.chat.id;
  if(games[chatId]) return bot.sendMessage(chatId,"⚠️ Finish current game or /reset.");
  const word=words[Math.floor(Math.random()*words.length)];
  const state={word, display:"_".repeat(word.length).split(''), attempts:6, guessed:[]};
  games[chatId]={type:"hangman", state, players:[msg.from], turnIndex:0, messageId:null};
  bot.sendMessage(chatId,`${msg.from.first_name}'s turn!\n${state.display.join(' ')}\nAttempts left:6`, {reply_markup:buildHangmanKeyboard(state)})
     .then(m=>{
         games[chatId].messageId=m.message_id; 
         startHangmanTimer(chatId); 
         startAutoLeaderboard(chatId);
     });
});

// --- Trivia ---
const triviaQs=[{q:"Capital of France?",a:"paris"},{q:"2 + 2 * 2 = ?",a:"6"},{q:"Largest planet?",a:"jupiter"}];
bot.onText(/\/trivia/, msg=>{
  const chatId=msg.chat.id;
  if(games[chatId]) return bot.sendMessage(chatId,"⚠️ Finish current game or /reset.");
  const question=triviaQs[Math.floor(Math.random()*triviaQs.length)];
  games[chatId]={type:"trivia", state:{question}, players:[msg.from], turnIndex:0, messageId:null};
  bot.sendMessage(chatId,`❓ Trivia: ${question.q}\n${msg.from.first_name}'s turn. Reply with answer.`)
     .then(m=>{
         games[chatId].messageId=m.message_id; 
         startTriviaTimer(chatId); 
         startAutoLeaderboard(chatId);
     });
});

// --- Word Chain Game ---
bot.onText(/\/wcg(?:\s+(\w+))?/, msg=>{
  const chatId=msg.chat.id, user=msg.from;
  if(games[chatId]) return bot.sendMessage(chatId,"⚠️ Finish current game or /reset.");
  const level=(msg.text.split(" ")[1]||"easy").toLowerCase();
  const minLen={easy:3, medium:4, hard:6}[level];
  if(!minLen) return bot.sendMessage(chatId,"⚠️ Difficulty must be easy, medium, or hard.");
  const state={lastWord:"", used:[], difficulty:level, timeout:null, timerSeconds:15};
  games[chatId]={type:"wcg", state, players:[user], turnIndex:0};
  bot.sendMessage(chatId,`🔗 Word Chain Game started!\nDifficulty: ${level.toUpperCase()}\n${user.first_name}'s turn. Send first word in ${state.timerSeconds} seconds.`);
  startWcgTimer(chatId);
  startAutoLeaderboard(chatId);
});

// --- Scores & Leaderboard ---
bot.onText(/\/score/, msg=>{ const sc=scores[msg.from.first_name]||0; bot.sendMessage(msg.chat.id,`🏆 ${msg.from.first_name}, your score: ${sc}`); });
bot.onText(/\/leaderboard/, msg=>{
  if(Object.keys(scores).length===0) return bot.sendMessage(msg.chat.id,"📉 No games played yet.");
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  let text="🏆 Global Leaderboard\n\n";
  sorted.slice(0,10).forEach(([name,sc],i)=>{ const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'🔹'; text+=`${medal} ${i+1}. ${name} — ${sc} wins\n`; });
  bot.sendMessage(msg.chat.id,text);
});

// --- Premium /porn Command ---
bot.onText(/\/porn/, msg=>{
  const chatId = msg.chat.id;
  const ownerUsername = "@YourTelegramUsername"; // <-- replace with your Telegram username

  if (games[chatId] && games[chatId].state?.timeout) {
    return bot.sendMessage(chatId, "⏳ A game is currently ongoing. Wait for it to finish or /reset.");
  }

  bot.sendMessage(chatId,
`🚫 Access Denied!
⚠️ This command is ONLY available to Premium users.

💰 To unlock this command, message ${ownerUsername} on Telegram to buy Premium access.

❌ Until then, you cannot use this command.`
  ).then(sentMsg => {
    const timeout = setTimeout(() => {
      bot.deleteMessage(chatId, sentMsg.message_id).catch(()=>{});
    }, 10000); // 10s timer

    if(!games[chatId]) games[chatId]={state:{}};
    games[chatId].state.pornTimeout = timeout;
  });
});

// --- Placeholder Timer Functions ---
function startTttTimer(chatId){}
function startHangmanTimer(chatId){}
function startTriviaTimer(chatId){}
function startWcgTimer(chatId){}
function startAutoLeaderboard(chatId){}
function buildHangmanKeyboard(state){ return {inline_keyboard:[]}; } // to implement full keyboard
