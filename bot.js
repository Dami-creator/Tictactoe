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
function buildBoardMessage(board){ 
  return board.map((v,i)=>v===' '?"➖":v).reduce((str,v,i)=>str+v+((i+1)%3===0?'\n':' '),''); 
}
function nextPlayer(game){ 
  game.turnIndex=(game.turnIndex+1)%game.players.length; 
  return game.players[game.turnIndex]; 
}
function startTurnTimer(chatId, seconds=15){
  const game = games[chatId];
  if(!game || !game.ready) return;
  if(game.state.timer) clearTimeout(game.state.timer);

  game.state.timer = setTimeout(()=>{
    if(!games[chatId]) return;

    const player = game.players[game.turnIndex];
    bot.sendMessage(chatId, `⏳ Time's up for ${player.first_name}! Passing turn ➡️`);
    game.turnIndex = (game.turnIndex + 1) % game.players.length;
    startTurnTimer(chatId, seconds);
  }, seconds*1000);
}

// --- Reset Command ---
bot.onText(/\/reset/, msg=>{
  const chatId = msg.chat.id;
  const game = games[chatId];
  if(!game) return bot.sendMessage(chatId,"ℹ️ No game to reset.");
  if(!game.players.some(p => p.id === msg.from.id)) return bot.sendMessage(chatId,"⚠️ Only current players can reset this game.");

  if(game.state.timer) clearTimeout(game.state.timer);
  if(game.state.joinTimer) clearTimeout(game.state.joinTimer);
  
  delete games[chatId];
  bot.sendMessage(chatId,"✅ Game has been reset. All timers stopped!");
});

// --- Startup Menu ---
bot.onText(/\/start/, msg=>{
  bot.sendMessage(msg.chat.id,
`🎮 *Mini-Game Hub* 🕹️

🤝 /play - Tic-Tac-Toe vs friend
🤖 /ai [easy|medium|hard] - Tic-Tac-Toe vs AI
✋ /join - Join current game
🪄 /hangman - Hangman
❓ /trivia - Trivia
🔗 /wcg [easy|medium|hard] - Word Chain Game
🏆 /score - Your score
🌐 /leaderboard - Global leaderboard
🔄 /reset - Reset current game (players only)
🔞 /porn - Premium command 🔒 (message owner to unlock)

💡 Only the /porn command requires Premium. All other games are free!`);
});

// --- Tic-Tac-Toe ---
bot.onText(/\/play/, msg=>{
  const chatId = msg.chat.id, user = msg.from;
  if(games[chatId]) return bot.sendMessage(chatId,"⚠️ Finish current game or /reset.");

  games[chatId] = {
    type:"tictactoe",
    board:Array(9).fill(' '),
    players:[user],
    turnIndex:0,
    ai:false,
    state:{timer:null, joinTimer:null},
    ready:false
  };

  bot.sendMessage(chatId, `${user.first_name} started Tic-Tac-Toe! Waiting for another player to /join. Game will start in 30s.`);

  games[chatId].state.joinTimer = setTimeout(()=>{
    const game = games[chatId];
    if(game.players.length >= 2){
      game.ready = true;
      bot.sendMessage(chatId, `🎲 Game started with 2 players!\n🕹️ ${game.players[game.turnIndex].first_name}'s turn.\n${buildBoardMessage(game.board)}`);
      startTurnTimer(chatId, 30);
    } else {
      delete games[chatId];
      bot.sendMessage(chatId, "❌ Not enough players joined. Game canceled.");
    }
  }, 30000);
});

bot.onText(/\/join/, msg=>{
  const chatId = msg.chat.id, user = msg.from;
  const game = games[chatId];
  if(!game) return;
  if(game.players.find(p=>p.id===user.id)) return bot.sendMessage(chatId,"⚠️ You already joined this game.");
  game.players.push(user);
  bot.sendMessage(chatId, `✅ ${user.first_name} joined! (${game.players.length} players)`);
});

// --- Tic-Tac-Toe vs AI ---
bot.onText(/\/ai(?:\s+(\w+))?/, msg=>{
  const chatId = msg.chat.id;
  if(games[chatId]) return bot.sendMessage(chatId, "⚠️ Finish current game or /reset.");

  const level = (msg.text.split(" ")[1] || "medium").toLowerCase();
  if(!["easy","medium","hard"].includes(level)) return bot.sendMessage(chatId,"⚠️ Difficulty must be easy, medium, or hard.");

  games[chatId] = {
    type:"tictactoe",
    board:Array(9).fill(' '),
    players:[msg.from],
    turnIndex:0,
    ai:true,
    aiLevel:level,
    state:{timer:null},
    ready:true
  };

  bot.sendMessage(chatId, `🤖 Tic-Tac-Toe vs AI started! Difficulty: ${level.toUpperCase()}\n🕹️ ${msg.from.first_name}'s turn.\n${buildBoardMessage(games[chatId].board)}`);
  startTurnTimer(chatId, 30);
});

// --- Hangman ---
const words=["javascript","telegram","nodejs","render","bot"];
bot.onText(/\/hangman/, msg=>{
  const chatId=msg.chat.id;
  if(games[chatId]) return bot.sendMessage(chatId,"⚠️ Finish current game or /reset.");

  const word = words[Math.floor(Math.random()*words.length)];
  const state = {word, display:"_".repeat(word.length).split(''), attempts:6, guessed:[]};
  games[chatId] = {type:"hangman", state, players:[msg.from], turnIndex:0, ready:true};
  bot.sendMessage(chatId, `🪄 Hangman started!\n🕹️ ${msg.from.first_name}'s turn.\n${state.display.join(' ')}\n❤️ Attempts left:6`);
  startTurnTimer(chatId, 30);
});

// --- Trivia ---
const triviaQs=[{q:"Capital of France?",a:"paris"},{q:"2+2*2=?",a:"6"},{q:"Largest planet?",a:"jupiter"}];
bot.onText(/\/trivia/, msg=>{
  const chatId = msg.chat.id;
  if(games[chatId]) return bot.sendMessage(chatId,"⚠️ Finish current game or /reset.");

  const question = triviaQs[Math.floor(Math.random()*triviaQs.length)];
  games[chatId]={type:"trivia", state:{question}, players:[msg.from], turnIndex:0, ready:true};
  bot.sendMessage(chatId, `❓ Trivia: ${question.q}\n📝 ${msg.from.first_name}'s turn. Reply with your answer.`);
  startTurnTimer(chatId, 20);
});

// --- Word Chain Game (WCG) ---
bot.onText(/\/wcg(?:\s+(\w+))?/, msg=>{
  const chatId = msg.chat.id;
  const user = msg.from;
  if(games[chatId]) return bot.sendMessage(chatId,"⚠️ Finish current game or /reset.");

  const level = (msg.text.split(" ")[1] || "easy").toLowerCase();
  const minLen = {easy:3, medium:4, hard:6}[level];
  if(!minLen) return bot.sendMessage(chatId,"⚠️ Difficulty must be easy, medium, or hard.");

  games[chatId] = {
    type:"wcg",
    state:{lastWord:"", used:[], difficulty:level, timer:null, joinTimer:null},
    players:[user],
    turnIndex:0,
    ready:false
  };

  bot.sendMessage(chatId, `🔗 Word Chain Game created! Difficulty: ${level.toUpperCase()}\n✋ Players type /join to participate. Waiting 30s for more players...`);

  games[chatId].state.joinTimer = setTimeout(()=>{
    const game = games[chatId];
    if(game.players.length >= 2){
      game.ready = true;
      bot.sendMessage(chatId, `🎮 WCG starting now with ${game.players.length} players!\n🕹️ ${game.players[game.turnIndex].first_name}'s turn. Send your word in 15 seconds ⏱️.`);
      startTurnTimer(chatId, 15);
    } else {
      delete games[chatId];
      bot.sendMessage(chatId, "❌ Not enough players joined. Game canceled.");
    }
  }, 30000);
});

// --- Scores & Leaderboard ---
bot.onText(/\/score/, msg=>{ 
  const sc=scores[msg.from.first_name]||0; 
  bot.sendMessage(msg.chat.id,`🏆 ${msg.from.first_name}, your score: ${sc}`); 
});
bot.onText(/\/leaderboard/, msg=>{
  if(Object.keys(scores).length===0) return bot.sendMessage(msg.chat.id,"📉 No games played yet.");
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  let text="🏆 Global Leaderboard\n\n";
  sorted.slice(0,10).forEach(([name,sc],i)=>{ 
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'🔹'; 
    text+=`${medal} ${i+1}. ${name} — ${sc} wins\n`; 
  });
  bot.sendMessage(msg.chat.id,text);
});

// --- Premium /porn Command ---
bot.onText(/\/porn/, msg=>{
  const chatId = msg.chat.id;
  if (games[chatId] && games[chatId].state?.timer) 
      return bot.sendMessage(chatId,"⏳ A game is currently ongoing. Wait or /reset.");
  
  bot.sendMessage(chatId,
`🚫 Access Denied!
🔒 This command is ONLY available to Premium users.

💰 To unlock, message [Owner](https://t.me/TyburnUK) on Telegram.

❌ Until then, you cannot use this command.`
  , {parse_mode:'Markdown'});
});
