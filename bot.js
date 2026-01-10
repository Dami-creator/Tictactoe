import TelegramBot from "node-telegram-bot-api";
import fs from "fs";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

/* -------------------- STORAGE -------------------- */

const games = {}; // per chat
const wcgLeaderboard = {};
const premiumUsers = new Set(); // you can preload IDs here

/* -------------------- DICTIONARY -------------------- */
// lightweight auto dictionary (offline-safe)
const DICTIONARY = new Set([
  "apple", "ant", "angle", "banana", "ball", "bat", "cat", "car",
  "dog", "door", "elephant", "fish", "goat", "house", "ice",
  "jungle", "kite", "lion", "monkey", "night", "orange",
  "people", "queen", "river", "snake", "tiger", "umbrella",
  "violin", "water", "xylophone", "yacht", "zebra"
]);

function isValidWord(word) {
  if (!word) return false;
  if (word.length < 2) return false;
  return /^[a-z]+$/i.test(word);
}

/* -------------------- HELPERS -------------------- */

function usernameOf(msg) {
  return msg.from.username
    ? `@${msg.from.username}`
    : msg.from.first_name || "Player";
}

function resetGame(chatId) {
  delete games[chatId];
}

function ensureGame(chatId) {
  if (!games[chatId]) {
    games[chatId] = {
      started: false,
      type: null,
      difficulty: "easy",
      usedWords: new Set(),
      players: {},
      hangman: null,
      triviaIndex: 0
    };
  }
}

/* -------------------- COMMANDS -------------------- */

bot.onText(/^\/start$/, msg => {
  bot.sendMessage(
    msg.chat.id,
    `🎮 *Welcome!*\n\nCommands:\n` +
    `/wcg – Word Chain Game\n` +
    `/hangman – Hangman\n` +
    `/trivia – Trivia\n` +
    `/stop – Stop game\n` +
    `/wcgleaderboard – Global leaderboard`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/stop$/, msg => {
  resetGame(msg.chat.id);
  bot.sendMessage(msg.chat.id, "🛑 Game stopped.");
});

bot.onText(/^\/wcgleaderboard$/, msg => {
  if (Object.keys(wcgLeaderboard).length === 0) {
    return bot.sendMessage(msg.chat.id, "📊 No scores yet.");
  }

  const sorted = Object.entries(wcgLeaderboard)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  let text = "🌍 *WCG Leaderboard*\n\n";
  sorted.forEach(([user, score], i) => {
    text += `${i + 1}. ${user} — ${score}\n`;
  });

  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

/* -------------------- WCG -------------------- */

bot.onText(/^\/wcg$/, msg => {
  const chatId = msg.chat.id;
  ensureGame(chatId);

  games[chatId] = {
    started: true,
    type: "wcg",
    difficulty: "easy",
    lastLetter: null,
    usedWords: new Set(),
    players: {}
  };

  bot.sendMessage(
    chatId,
    "🔤 *Word Chain Game Started!*\n\n" +
    "Type a word.\n" +
    "Next word must start with the last letter.\n" +
    "No repeats. Longer words allowed.",
    { parse_mode: "Markdown" }
  );
});

/* -------------------- HANGMAN -------------------- */

const HANGMAN_WORDS = {
  easy: ["apple", "cat", "dog"],
  medium: ["banana", "monkey", "orange"],
  hard: ["xylophone", "umbrella", "elephant"]
};

bot.onText(/^\/hangman$/, msg => {
  const chatId = msg.chat.id;
  ensureGame(chatId);

  const difficulty = "easy";
  const words = HANGMAN_WORDS[difficulty];
  const word = words[Math.floor(Math.random() * words.length)];

  games[chatId] = {
    started: true,
    type: "hangman",
    hangman: {
      word,
      guessed: new Set(),
      tries: 6
    }
  };

  bot.sendMessage(
    chatId,
    `🎯 *Hangman Game*\nWord: ${"_ ".repeat(word.length)}\nGuess letters!`,
    { parse_mode: "Markdown" }
  );
});

/* -------------------- TRIVIA -------------------- */

const TRIVIA = [
  { q: "Capital of France?", a: "paris" },
  { q: "2 + 2?", a: "4" },
  { q: "Largest ocean?", a: "pacific" }
];

bot.onText(/^\/trivia$/, msg => {
  const chatId = msg.chat.id;
  ensureGame(chatId);

  games[chatId] = {
    started: true,
    type: "trivia",
    triviaIndex: 0
  };

  bot.sendMessage(
    chatId,
    `🧠 *Trivia*\n\n${TRIVIA[0].q}`,
    { parse_mode: "Markdown" }
  );
});

/* -------------------- MESSAGE HANDLER -------------------- */

bot.on("message", msg => {
  const chatId = msg.chat.id;
  const text = msg.text?.toLowerCase().trim();
  if (!text || text.startsWith("/")) return;

  const game = games[chatId];
  if (!game || !game.started) return;

  /* -------- WCG -------- */
  if (game.type === "wcg") {
    if (!isValidWord(text)) {
      return bot.sendMessage(chatId, "❌ Invalid word.");
    }

    if (game.usedWords.has(text)) {
      return bot.sendMessage(chatId, "♻️ Word already used.");
    }

    if (game.lastLetter && !text.startsWith(game.lastLetter)) {
      return bot.sendMessage(
        chatId,
        `❌ Must start with *${game.lastLetter.toUpperCase()}*`,
        { parse_mode: "Markdown" }
      );
    }

    game.usedWords.add(text);
    game.lastLetter = text.slice(-1);

    const user = usernameOf(msg);
    game.players[user] = (game.players[user] || 0) + 1;
    wcgLeaderboard[user] = (wcgLeaderboard[user] || 0) + 1;

    bot.sendMessage(
      chatId,
      `✅ *${user}*\nNext letter: *${game.lastLetter.toUpperCase()}*`,
      { parse_mode: "Markdown" }
    );
  }

  /* -------- HANGMAN -------- */
  if (game.type === "hangman") {
    const h = game.hangman;
    if (!h || h.word.length === 0) return;

    const letter = text[0];
    if (h.guessed.has(letter)) return;

    h.guessed.add(letter);

    if (!h.word.includes(letter)) {
      h.tries--;
    }

    let display = "";
    for (const c of h.word) {
      display += h.guessed.has(c) ? c + " " : "_ ";
    }

    if (!display.includes("_")) {
      bot.sendMessage(chatId, `🎉 You won!\nWord: *${h.word}*`, {
        parse_mode: "Markdown"
      });
      resetGame(chatId);
      return;
    }

    if (h.tries <= 0) {
      bot.sendMessage(chatId, `💀 Game over!\nWord was *${h.word}*`, {
        parse_mode: "Markdown"
      });
      resetGame(chatId);
      return;
    }

    bot.sendMessage(
      chatId,
      `Word: ${display}\n❤️ Tries left: ${h.tries}`
    );
  }

  /* -------- TRIVIA -------- */
  if (game.type === "trivia") {
    const q = TRIVIA[game.triviaIndex];
    if (!q) {
      resetGame(chatId);
      return;
    }

    if (text === q.a) {
      game.triviaIndex++;
      if (game.triviaIndex >= TRIVIA.length) {
        bot.sendMessage(chatId, "🏆 Trivia completed!");
        resetGame(chatId);
      } else {
        bot.sendMessage(chatId, TRIVIA[game.triviaIndex].q);
      }
    } else {
      bot.sendMessage(chatId, "❌ Wrong answer.");
    }
  }
});

/* -------------------- READY -------------------- */

console.log("✅ Bot is running (Polling mode)");
