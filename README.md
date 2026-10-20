# 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 ⚡

A feature-rich WhatsApp bot featuring an advanced anime card collection system (`.spawncard`, `.catch`, `.mycards`, `.leaderboard`), group management, AI chat, media tools, and games.

---

## 🚀 Features

- **🃏 Anime Card Gacha System:** Spawn random cards with unique rarities (Common to Mythic God) and power levels, catch them, and compete on the leaderboard.
- **🛡️ Group Management:** Anti-link, kick, tagall, hidetag, group open/close controls, and more.
- **🤖 AI Integration:** Smart chatbot commands.
- **🛠️ Media Converters:** Image-to-sticker tools.
- **⚡ 24/7 Railway Worker Ready:** Optimized for uninterrupted background execution without container timeouts (`SIGTERM`).

---

## 🛠️ Quick Deployment Guide (Railway)

### 1. Fork or Clone the Repository
Upload your bot files (`index.js`, `package.json`, `railway.json`) to your GitHub repository.

### 2. Deploy on Railway
1. Go to [Railway](https://railway.app) and create a new project from your GitHub repo.
2. Ensure the service type is set as a **Worker** (or use the included `railway.json` configuration).

### 3. Set Environment Variables
Go to your Railway service **Variables** tab and add your phone number:
- **`PHONE_NUMBER`**: `YourCountryCodeAndNumber` *(e.g., 2347061696819)*

### 4. Link WhatsApp via Pairing Code
- Check your Railway deployment logs.
- The bot will generate an 8-character pairing code in the logs.
- Open **WhatsApp** on your phone > Go to **Linked Devices** > **Link a Device** > **Link with phone number instead**, and enter the code.

---

## 📜 Core Commands

- **`.menu`** - Display the main command center.
- **`.spawncard`** - Spawn a wild anime card with image and stats.
- **`.catch`** - Claim a spawned anime card.
- **`.mycards`** - View your personal card inventory and total power.
- **`.leaderboard`** - View top card collectors.
- **`.ai [query]`** - Chat with the bot's AI assistant.
- **`.sticker`** - Reply to an image to convert it into a WhatsApp sticker.
- **`.tagall`** - Tag all group members (Admin only).

---

## 📄 License
Released under the MIT License. Built for high performance and clean automation.
