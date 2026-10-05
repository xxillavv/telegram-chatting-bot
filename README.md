<div align="center">

# 💬 Telegram Chatting Bot

**A personal AI texting assistant for Telegram.**
Forward her messages and get a reply in the tone you pick, written in **your** own texting style.
With Telegram Business, the bot sees the chat directly and can reply on your behalf.

![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Telegraf](https://img.shields.io/badge/Telegraf-4-26A5E4?logo=telegram&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-8-47A248?logo=mongodb&logoColor=white)
![Groq](https://img.shields.io/badge/LLM-Groq_(free)-F55036)

</div>

---

## Table of contents

- [Features](#-features)
- [How it works](#-how-it-works)
- [Quick start](#-quick-start)
- [Environment variables](#-environment-variables)
- [Connecting via Telegram Business](#-connecting-via-telegram-business)
- [Commands and menu](#-commands-and-menu)
- [Tones](#-tones)
- [Project structure](#-project-structure)
- [Development](#-development)
- [Deployment](#-deployment)
- [Roadmap](#-roadmap)

---

## ✨ Features

| | Feature | What it does |
|---|---|---|
| 🎭 | **Tones** | 8 presets (flirty, friendly, romantic, funny…) or your own custom tone description |
| ✍️ | **Your texting style** | Replies come as short messages, lowercase, with your pet phrases. The bot learns from your edits to its drafts |
| 🧠 | **Long-term memory** | The LLM extracts facts about her and about you from the chat and feeds them into the prompt |
| 🎤 | **Voice and video notes** | Transcribed with Whisper and handled like regular text |
| 🖼️ | **Photos, stickers, GIFs, videos** | A vision model describes them so the bot can reply to what's actually there |
| 📦 | **Message bursts** | Several short messages in a row are treated as one thought. The bot waits for her to finish and answers everything at once |
| 🔗 | **Telegram Business** | Sees her chat directly, tracks edits, deletions and quotes, sends replies with one tap |
| ⏱️ | **Auto-send** | The reply goes out by itself after 10 s unless you hit "Stop", with a "typing…" indicator and pauses between messages |
| 💬 | **Conversation starters** | Generates topics to break an awkward silence |
| 📊 | **Stats** | A "who texts more" chart plus an AI estimate of her interest, with positive and warning signals and a piece of advice |
| 🔒 | **Private** | Only Telegram IDs from an allowlist can use it |
| 🆓 | **Free** | Free-tier LLMs only (Groq); the provider is swappable via `.env` |

---

## 🧩 How it works

```mermaid
flowchart LR
    A[Her message<br/>text / voice / media] -->|forward<br/>or Business| B[Batching<br/>wait until she's done]
    V[Whisper] -.voice.-> B
    I[Vision] -.media.-> B
    B --> C[Prompt:<br/>tone + your style<br/>+ facts + history]
    C --> D[LLM · Groq]
    D --> E[Draft reply]
    E -->|✏️ edit| S[Style learning]
    E -->|🔄 / ✂️| D
    E -->|📤 button or timer| F[Sent to her chat<br/>with "typing…"]
```

1. **Input.** You forward her messages to the bot, or they arrive on their own via Telegram Business. Voice messages are transcribed, and media is described by a vision model.
2. **Batching.** The bot looks at how the last message ends. A trailing comma, "and" or "so" means it waits longer; "?" or ")" means it answers sooner. It never waits more than 25 s.
3. **Generation.** The prompt combines the chosen tone, your style profile, your past edits, facts about her and you, and the chat history with timestamps and reply quotes.
4. **Draft.** The reply comes with buttons to send, regenerate, shorten or edit it.
5. **Sending.** It goes out on your behalf, with "typing…" pauses sized to each message's length.

---

## 🚀 Quick start

### Requirements

- **Node.js** 20+ and **pnpm**
- **Docker** (for a local MongoDB)
- A bot token from [@BotFather](https://t.me/BotFather)
- A free [Groq](https://console.groq.com/keys) API key

### Installation

```bash
git clone git@github.com:xxillavv/telegram-chatting-bot.git
cd telegram-chatting-bot

pnpm install
cp .env.example .env      # fill in TG_API_TOKEN and LLM_API_KEY

docker compose up -d      # MongoDB on 127.0.0.1:27017
pnpm start:dev
```

### First run

By default the bot is **closed to everyone**. Send it `/start` and it replies with your Telegram ID. Add that ID to `.env`:

```env
ALLOWED_USER_IDS=123456789
```

Then restart the bot. Done 🎉

---

## ⚙️ Environment variables

| Variable | Default | Description |
|---|---|---|
| `TG_API_TOKEN` | — | Bot token from BotFather |
| `LLM_API_KEY` | — | Groq key (or any other OpenAI-compatible provider) |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-compatible API endpoint |
| `LLM_MODEL` | `openai/gpt-oss-120b` | Model used for replies |
| `STT_MODEL` | `whisper-large-v3` | Speech-to-text model |
| `STT_LANGUAGE` | `uk` | Voice message language (ISO-639-1); empty means auto-detect |
| `VISION_MODEL` | `qwen/qwen3.8-27b` | Model that describes photos and stickers |
| `ALLOWED_USER_IDS` | — | Comma-separated Telegram IDs allowed to use the bot |
| `MONGO_URL` | `mongodb://127.0.0.1:27017` | MongoDB connection string |
| `MONGO_DB` | `telegram-chatting-bot` | Database name |
| `BOT_TIMEZONE` | `Europe/Kyiv` | Time zone the model sees message times in |

> [!TIP]
> Switching providers is easy. Any OpenAI-compatible API works (OpenRouter `:free` models, Gemini through its OpenAI endpoint, etc.); just change `LLM_BASE_URL` and `LLM_MODEL`.

> [!NOTE]
> Groq's free tier is limited to roughly 8,000 tokens per minute, so the bot keeps its requests compact.

---

## 🔗 Connecting via Telegram Business

Without Business, the bot works in "forward me her messages" mode. With Business, it sees her chat on its own and replies as you.

1. In [@BotFather](https://t.me/BotFather): your bot → **Bot Settings → Business Mode → Turn on**.
2. In Telegram: **Settings → Telegram Business → Chatbots** → pick your bot, give it access to the chats you want and permission to reply.
3. In the bot, tap **🔗 Чат** (`/chat`) and choose her chat or enter her `@username`.
4. Optionally turn on **auto-send**: the reply goes out by itself after 10 s unless you tap "Stop", and only once she has been quiet for 15 s.

> [!WARNING]
> Telegram Business requires Telegram Premium.

---

## 🕹️ Commands and menu

The bot's interface is in Ukrainian. Menu buttons and their commands:

| Button | Command | Action |
|---|---|---|
| 💬 Питання | `/questions` | Conversation starters for an awkward pause |
| 📊 Статистика | `/stats` | Who texts more and how interested she is |
| 🎭 Тон | `/tone` | Pick a tone or describe your own |
| 🔗 Чат | `/chat` | Connect her chat via Business |
| 👩 Про неї | `/about` | Her name, how you met, what she likes, plus saved facts |
| 😀 Емодзі | — | Toggle emoji in replies |
| ⚙️ Налаштування | `/settings` | Current settings, reset learned style |
| 🧹 Нова переписка | `/reset` | Clear the chat history (your style and facts about you are kept) |
| ❓ Допомога | `/help` | How to use the bot |

**Tips:**
- Text you type to the bot yourself is treated as her message. To add your own line, start it with `я:` or forward your own message.
- You can forward several messages at once, including voice and video notes.
- The **✏️ Edit** button under a reply is the best way to teach the bot to write like you.

---

## 🎭 Tones

| Tone | Character |
|---|---|
| 😏 Flirty | Light, playful, keeps some intrigue |
| 🔥 Spicy | Bold innuendo, but backs off if she's cold |
| 🤬 Aggro | Cocky and full of swearing, aimed at situations, never at her |
| 🙂 Friendly | Warm and casual, no pickup lines |
| ❤️ Romantic | Tender and sincere, no greeting-card clichés |
| 😂 Funny | Irony, self-irony, picks up on her jokes |
| 😎 Confident | Short, calm, makes the plans himself |
| 🤗 Caring | Supportive, listens more than talks |

The tone sets the **mood**, while the style profile (`src/ai/prompts/my-style.prompt.ts`) sets the **form**: length, casing, pet phrases. The style profile always applies.

---

## 🗂️ Project structure

```
src/
├── ai/                         # everything LLM-related
│   ├── ai.service.ts           # replies, questions, interest analysis, facts
│   ├── llm.client.ts           # OpenAI-compatible client (Groq)
│   ├── speech.service.ts       # Whisper: voice → text
│   ├── vision.service.ts       # describes photos/stickers/GIFs/videos
│   └── prompts/                # base prompt, style, facts, interest analysis
├── bot/
│   ├── bot.update.ts           # commands, buttons, incoming messages
│   ├── business.handler.ts     # Telegram Business: her chat, edits, deletions
│   ├── conversation.service.ts # drafts, auto-send, "typing…"
│   ├── batching.ts             # how long to wait for her to finish
│   ├── auto-send.ts            # auto-send timings
│   └── access.ts               # Telegram ID allowlist
├── session/                    # sessions stored in MongoDB
├── stats/                      # chart (canvas) and stats text
├── tones/                      # tone presets
└── database/                   # MongoDB connection
```

---

## 🛠️ Development

```bash
pnpm start:dev     # run with hot reload
pnpm build         # build into dist/
pnpm start:prod    # run the built version
pnpm lint          # ESLint with autofix
pnpm format        # Prettier
pnpm test          # unit tests
```

Sessions are stored in MongoDB and flushed on shutdown (`Ctrl+C`), so history and settings survive restarts.

---

## ☁️ Deployment

The bot ships with a `Dockerfile`, and `docker-compose.yml` runs it next to MongoDB on any VM. A step-by-step guide for a free Oracle Cloud ARM instance is in [docs/DEPLOY.md](docs/DEPLOY.md).

```bash
# on the server, with COMPOSE_PROFILES=bot in .env
docker compose up -d --build
```

---

## 🗺️ Roadmap

- [x] Long-term memory: facts about her and about you
- [x] Photos, stickers, GIFs and videos via a vision model
- [x] "Typing…" and realistic pauses during auto-send
- [ ] 2–3 reply options to choose from (the choice is a style signal)
- [ ] Stop signals: turn off auto-send when the chat gets serious or she asks "is this you writing?"
- [ ] Reminders: you haven't replied in a while / the conversation went quiet
- [ ] Multiple chats at once

---

<div align="center">

Made with ☕ and NestJS · AI powered by free [Groq](https://groq.com)

</div>
