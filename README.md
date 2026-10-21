<div align="center">

# 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 😈⚡

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green?logo=node.js)](https://nodejs.org/)
[![Baileys](https://img.shields.io/badge/Library-WhiskeySockets%2FBaileys-blue)](https://github.com/WhiskeySockets/Baileys)
[![Railway](https://img.shields.io/badge/Deploy-Railway-purple?logo=railway)](https://railway.app/)
[![License](https://img.shields.io/badge/License-MIT-red.svg)](LICENSE)

An elite, high-performance, and multi-functional WhatsApp userbot built with **Baileys**. Designed with robust group protection modules, custom fonts, anti-spam safeguards, and seamless 24/7 cloud container deployment on **Railway**.

---

</div>

## 🚀 Key Features

- **🛡️ Advanced Security & Protection:**
  - **Anti-Link:** Automatically deletes unauthorized links sent by non-admins.
  - **Anti-Bot:** Detects and kicks external automated bots.
  - **Anti-Delete:** Tracks and reposts deleted messages in group chats.
  - **Anti-Spam:** Rate-limits excessive command usage and temporarily mutes spammers.

- **👑 Owner & VIP Hierarchy:**
  - Full owner control suite (`.setprefix`, `.broadcast`, `.block`, `.mode`).
  - Dedicated VIP privilege tier (`.vipadd`, `.vipadmin`, `.vippromote`, `.viptakeover`).

- **👥 Group Management:**
  - One-tap pending join request approvals (`.approveall`).
  - Scheduled chat locks/unlocks (`.closetime`, `.open`, `.close`).
  - Member warnings, group description updates, and message pinning.

- **⚡ Utilities & Fun:**
  - System diagnostics (`.device`, `.status`), profile picture fetcher (`.getpp`), font styles (`.listfont`), sticker creation, AI chat, and mini-games.

---

## 🛠️ Quick Deployment Guide (Railway)

### 1. Fork or Upload to GitHub
Make sure your updated `index.js` and repository files are saved on your GitHub account.

### 2. Deploy on Railway
1. Go to [Railway](https://railway.app) and create a new project from your GitHub repository.
2. Railway will automatically detect your project structure and build it.

### 3. Set Environment Variables
Go to your Railway service **Variables** tab and add your phone number:
- **`PHONE_NUMBER`**: `YourCountryCodeAndNumber` *(e.g., 2347061696819)*

### 4. Link WhatsApp via Pairing Code
- Open your Railway deployment **Logs / Terminal**.
- Look for your unique 8-character pairing code:
  ```text
  🔑 YOUR PAIRING CODE: XXXXXXXX
