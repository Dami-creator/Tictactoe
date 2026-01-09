import os
import random
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, ContextTypes

TOKEN = os.getenv("TOKEN")

games = {}
scores = {}

WIN_COMBOS = [
    (0,1,2),(3,4,5),(6,7,8),
    (0,3,6),(1,4,7),(2,5,8),
    (0,4,8),(2,4,6)
]

def check_winner(board):
    for a,b,c in WIN_COMBOS:
        if board[a] == board[b] == board[c] != " ":
            return board[a]
    if " " not in board:
        return "Draw"
    return None

def build_board(board):
    buttons = []
    for i in range(9):
        text = board[i] if board[i] != " " else "➖"
        buttons.append(InlineKeyboardButton(text, callback_data=str(i)))
    return InlineKeyboardMarkup([buttons[i:i+3] for i in range(0,9,3)])

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🎮 *Tic Tac Toe Bot*\n\n"
        "/play – Play with a friend\n"
        "/ai – Play vs AI\n"
        "/score – Your score\n"
        "/leaderboard – Global rankings",
        parse_mode="Markdown"
    )

async def play(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    user = update.effective_user.first_name

    games[chat_id] = {
        "board": [" "] * 9,
        "turn": "❌",
        "names": {
            "❌": user,
            "⭕": "Opponent"
        },
        "ai": False
    }

    await update.message.reply_text(
        f"Game started!\n❌ {user}'s turn",
        reply_markup=build_board(games[chat_id]["board"])
    )

async def ai(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    user = update.effective_user.first_name

    games[chat_id] = {
        "board": [" "] * 9,
        "turn": "❌",
        "names": {
            "❌": user,
            "⭕": "🤖 AI"
        },
        "ai": True
    }

    await update.message.reply_text(
        f"🤖 AI Game Started!\n❌ {user}'s turn",
        reply_markup=build_board(games[chat_id]["board"])
    )

async def score(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user.first_name
    sc = scores.get(user, 0)
    await update.message.reply_text(
        f"🏆 *{user}*, your score: *{sc}*",
        parse_mode="Markdown"
    )

async def leaderboard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not scores:
        await update.message.reply_text("📉 No games played yet.")
        return

    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)

    text = "🏆 *Global Leaderboard*\n\n"
    for i, (name, sc) in enumerate(sorted_scores[:10], start=1):
        medal = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else "🔹"
        text += f"{medal} {i}. {name} — {sc} wins\n"

    await update.message.reply_text(text, parse_mode="Markdown")

async def move(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    chat_id = query.message.chat.id
    if chat_id not in games:
        return

    game = games[chat_id]
    board = game["board"]
    index = int(query.data)

    if board[index] != " ":
        return

    board[index] = game["turn"]
    winner = check_winner(board)

    if winner:
        if winner != "Draw":
            name = game["names"][winner]
            scores[name] = scores.get(name, 0) + 1
            text = f"🏆 {name} wins!"
        else:
            text = "🤝 It's a draw!"

        await query.edit_message_text(text, reply_markup=build_board(board))
        del games[chat_id]
        return

    game["turn"] = "⭕" if game["turn"] == "❌" else "❌"

    if game["ai"] and game["turn"] == "⭕":
        empty = [i for i, v in enumerate(board) if v == " "]
        board[random.choice(empty)] = "⭕"
        winner = check_winner(board)

        if winner:
            if winner != "Draw":
                scores["🤖 AI"] = scores.get("🤖 AI", 0) + 1
                text = "🤖 AI wins!"
            else:
                text = "🤝 It's a draw!"

            await query.edit_message_text(text, reply_markup=build_board(board))
            del games[chat_id]
            return

        game["turn"] = "❌"

    await query.edit_message_text(
        f"Turn: {game['turn']} ({game['names'][game['turn']]})",
        reply_markup=build_board(board)
    )

app = ApplicationBuilder().token(TOKEN).build()

app.add_handler(CommandHandler("start", start))
app.add_handler(CommandHandler("play", play))
app.add_handler(CommandHandler("ai", ai))
app.add_handler(CommandHandler("score", score))
app.add_handler(CommandHandler("leaderboard", leaderboard))
app.add_handler(CallbackQueryHandler(move))

print("Bot running...")
app.run_polling()
