const messageCache = new Map();
const warningMap = new Map(); // Tracks warning counts per user per group
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Great Demon Bot is active 24/7 under the rule of Demon Emperor!\n');
}).listen(PORT, '0.0.0.0', () => {
    console.log('🌐 Keep-alive server running on 0.0.0.0:' + PORT);
});

// --- TELEGRAM CONFIGURATION ---
const TelegramBot = require('node-telegram-bot-api');
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '9043764936:AAE1KZ97aL1DQ5gMv69S3Y_NOPgGP-vOmIU'; 
const tgBot = new TelegramBot(TG_BOT_TOKEN, { polling: true });

// --- TELEGRAM /start COMMAND WITH BULLETPROOF FALLBACK ---
tgBot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const startCaption = 
"✰ † ✰━━━━━━━━━━━━━━━━━━━━━━━━✰ † ✰\n" +
"† ✰\n" +
"             𝐆𝐑𝐄𝐀𝐓𝐃𝐄𝐌𝐎𝐍-𝐕4\n" +
"✰ † ✰━━━━━━━━━━━━━━━━━━━━━━━✰ † ✰\n" +
"† ✰\n" +
"┌─[ 💀 WELCOME 💀 ]─┐\n" +
"└────────────────────┘\n" +
"✰ ⚔️ /connect > pair number\n" +
"✰ ⚔️ /disconnect > unpair number\n" +
"✰ ⚔️ /listdevices > wa pairs\n" +
"✰═════════[ 😈 ]═════════✰";

    try {
        await tgBot.sendPhoto(chatId, MENU_IMAGE_URL, {
            caption: startCaption,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        // Fallback to text message if Telegram image preview fails
        await tgBot.sendMessage(chatId, startCaption, { parse_mode: 'Markdown' });
    }
});

tgBot.onText(/\/connect(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    let targetNum = match[1] ? match[1].replace(/[^0-9]/g, '') : '';

    if (!targetNum || targetNum.length < 10) {
        return tgBot.sendMessage(chatId, "⚔️ *Provide a valid phone number with country code*\n\n💡 *Usage:* `/connect 2347061696819`", { parse_mode: 'Markdown' });
    }

    await handlePairingProcess(chatId, targetNum);
});

async function handlePairingProcess(chatId, targetNum, messageIdToEdit = null) {
    try {
        let statusMsg;
        if (messageIdToEdit) {
            await tgBot.editMessageText(`⏳ *Forging fresh link key for +${targetNum}...*`, {
                chat_id: chatId,
                message_id: messageIdToEdit,
                parse_mode: 'Markdown'
            });
            statusMsg = { message_id: messageIdToEdit };
        } else {
            statusMsg = await tgBot.sendMessage(chatId, `⏳ *Forging link key for +${targetNum}, kindly wait...*`, { parse_mode: 'Markdown' });
        }

        const tempSessionPath = path.join(__dirname, 'sessions', 'session_' + targetNum);
        if (fs.existsSync(tempSessionPath)) {
            fs.rmSync(tempSessionPath, { recursive: true, force: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(tempSessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const tempSock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            // Hardened browser parameters to prevent WhatsApp mobile handshake drops
            browser: ["Chrome (Linux)", "", ""],
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            generateHighQualityLinkPreview: false
        });

        tempSock.ev.on('creds.update', saveCreds);

        tempSock.ev.on('connection.update', (update) => {
            const { connection } = update;
            if (connection === 'open') {
                tgBot.sendMessage(chatId, `✅ *WhatsApp Connected Successfully!*\n\n📱 *Number:* +${targetNum}`, { parse_mode: 'Markdown' });
            }
        });

        setTimeout(async () => {
            try {
                if (!tempSock.authState.creds.registered) {
                    let code = await tempSock.requestPairingCode(targetNum);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    
                    const opts = {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🔄 Get New Code", callback_data: `recode_${targetNum}` }]
                            ]
                        }
                    };

                    await tgBot.editMessageText(`🔑 *IMPERIAL LINK CODE:* \`${code}\`\n\n⏰ *Expires in 60 seconds.*`, opts);
                }
            } catch (innerErr) {
                await tgBot.editMessageText(`❌ *Forging failed! Pairing seal rejected:* ${innerErr.message}`, {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'Markdown'
                });
            }
        }, 8000);
    } catch (err) {
        await tgBot.sendMessage(chatId, `❌ *An error occurred during the ritual:* ${err.message}`, { parse_mode: 'Markdown' });
    }
}

tgBot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data.startsWith('recode_')) {
        const targetNum = data.split('_')[1];
        await tgBot.answerCallbackQuery(query.id, { text: "🔄 Generating a fresh code for My Lord..." });
        await handlePairingProcess(chatId, targetNum, messageId);
    } else if (data === "confirm_disconnect") {
        await tgBot.answerCallbackQuery(query.id, { text: "Disconnected." });
        await tgBot.editMessageText("⚠️ *WhatsApp Disconnected!* Account logged out from servers.", {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
    } else if (data === "cancel_disconnect") {
        await tgBot.answerCallbackQuery(query.id, { text: "Cancelled." });
        await tgBot.editMessageText("✅ Disconnect action cancelled.", {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
    }
});

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage,
    downloadMediaMessage,
    generateWAMessageContent,
    generateWAMessageFromContent,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const exec = require('child_process').exec;
const os = require('os');
const https = require('https');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
const crypto = require('crypto');
const axios = require('axios');
const yts = require('yt-search');
const { truth } = require('@bochilteam/scraper');
const { translate } = require('@vitalets/google-translate-api');

// --- BOT CONFIGURATION ---
const OWNER_NUMBER = "2347061696819";
const OWNER_NAME = "𝐆𝐑𝐄𝐀𝐓𝐃𝐄𝐌𝐎𝐍";
const BOT_NAME = "𝐆𝐑𝐄𝐀𝐓𝐃𝐄𝐌𝐎𝐍-𝐕4";
const BOT_VERSION = "V4 ULTRA";
const MENU_IMAGE_URL = "https://img.sanishtech.com/u/96b35f47cb64cc0f77b9a781b40d0990.jpg";
const PURPLE_COLOR = '#9C27B0';
const startTime = Date.now();

// --- PERSISTENT STORAGE ENGINE ---
const SETTINGS_FILE = './settings.json';

function loadSettings() {
    if (!fs.existsSync(SETTINGS_FILE)) {
        const defaultSettings = {
            prefix: ".",
            sudoUsers: [OWNER_NUMBER],
            autoSettings: {
                autoonline: true,
                autorecording: false,
                autostatuslike: true,
                autostatusview: true,
                autotyping: false,
                anticall: true,
                autoreact: false
            }
        };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
        return defaultSettings;
    }
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE));
    } catch (e) {
        return {
            prefix: ".",
            sudoUsers: [OWNER_NUMBER],
            autoSettings: { autoonline: true, autorecording: false, autostatuslike: true, autostatusview: true, autotyping: false, anticall: true, autoreact: false }
        };
    }
}

function saveSettings(data) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

const db = loadSettings();
let prefix = db.prefix || ".";
const sudoUsers = new Set(db.sudoUsers || [OWNER_NUMBER]);
const autoSettings = db.autoSettings || {
    autoonline: true,
    autorecording: false,
    autostatuslike: true,
    autostatusview: true,
    autotyping: false,
    anticall: true,
    autoreact: false
};

// --- MESSAGE TRACKER FUNCTIONS ---
const dataFilePath = path.join(__dirname, 'messageCount.json');

function loadMessageCounts() {
    if (fs.existsSync(dataFilePath)) {
        const data = fs.readFileSync(dataFilePath);
        return JSON.parse(data);
    }
    return {};
}

function saveMessageCounts(messageCounts) {
    fs.writeFileSync(dataFilePath, JSON.stringify(messageCounts, null, 2));
}

function incrementMessageCount(groupId, userId) {
    const messageCounts = loadMessageCounts();
    if (!messageCounts[groupId]) {
        messageCounts[groupId] = {};
    }
    if (!messageCounts[groupId][userId]) {
        messageCounts[groupId][userId] = 0;
    }
    messageCounts[groupId][userId] += 1;
    saveMessageCounts(messageCounts);
}

// --- STATE MANAGEMENT ---
let botMode = "public"; 
const activeGames = {};
const groupSettings = {};
const blockedUsers = new Set();
const deletedMessages = new Map();

function unwrapMessage(message) {
  if (!message || typeof message !== 'object') return message;
  if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension?.message) {
    return unwrapMessage(message.viewOnceMessageV2Extension.message);
  }
  return message;
}

function resolveMedia(msg) {
  const own = unwrapMessage(msg.message);
  if (own?.imageMessage) {
    return { kind: 'image', targetMessage: msg, mediaMsg: own.imageMessage };
  }
  if (own?.videoMessage) {
    return { kind: 'video', targetMessage: msg, mediaMsg: own.videoMessage };
  }
  if (own?.audioMessage) {
    return { kind: 'audio', targetMessage: msg, mediaMsg: own.audioMessage };
  }
  if (own?.stickerMessage) {
    return { kind: 'sticker', targetMessage: msg, mediaMsg: own.stickerMessage };
  }
  if (own?.documentMessage && /^image\//i.test(own.documentMessage.mimetype || '')) {
    return { kind: 'image', targetMessage: msg, mediaMsg: own.documentMessage };
  }

  const ctx =
    own?.extendedTextMessage?.contextInfo ||
    own?.imageMessage?.contextInfo ||
    own?.videoMessage?.contextInfo ||
    msg.message?.extendedTextMessage?.contextInfo;

  const quoted = unwrapMessage(ctx?.quotedMessage);
  if (!quoted || !ctx?.stanzaId) return null;

  const targetMessage = {
    key: {
      remoteJid: msg.key.remoteJid,
      id: ctx.stanzaId,
      participant: ctx.participant,
    },
    message: quoted,
  };

  if (quoted.imageMessage) {
    return { kind: 'image', targetMessage, mediaMsg: quoted.imageMessage };
  }
  if (quoted.videoMessage) {
    return { kind: 'video', targetMessage, mediaMsg: quoted.videoMessage };
  }
  if (quoted.audioMessage) {
    return { kind: 'audio', targetMessage, mediaMsg: quoted.audioMessage };
  }
  if (quoted.stickerMessage) {
    return { kind: 'sticker', targetMessage, mediaMsg: quoted.stickerMessage };
  }
  if (quoted.documentMessage && /^image\//i.test(quoted.documentMessage.mimetype || '')) {
    return { kind: 'image', targetMessage, mediaMsg: quoted.documentMessage };
  }

  return null;
}

async function downloadMedia(msg, type) {
  const mediaMsg = msg[type + 'Message'] || msg.documentMessage || msg;
  const stream = await downloadContentFromMessage(mediaMsg, type === 'sticker' ? 'sticker' : type);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function groupStatusBroadcast(sock, jid, content) {
  const { backgroundColor } = content;
  delete content.backgroundColor;

  const inside = await generateWAMessageContent(content, {
    upload: sock.waUploadToServer,
    backgroundColor: backgroundColor || PURPLE_COLOR,
  });

  const secret = crypto.randomBytes(32);

  const msg = generateWAMessageFromContent(
    jid,
    {
      messageContextInfo: { messageSecret: secret },
      groupStatusMessageV2: {
        message: {
          ...inside,
          messageContextInfo: { messageSecret: secret },
        },
      },
    },
    {}
  );

  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  return msg;
}

function toVN(buffer) {
  return new Promise((resolve, reject) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];

    input.end(buffer);

    ffmpeg(input)
      .noVideo()
      .audioCodec('libopus')
      .format('ogg')
      .audioChannels(1)
      .audioFrequency(48000)
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)))
      .pipe(output);

    output.on('data', (c) => chunks.push(c));
  });
}

function generateWaveform(buffer, bars = 64) {
  return new Promise((resolve, reject) => {
    const input = new PassThrough();
    input.end(buffer);

    const chunks = [];

    ffmpeg(input)
      .audioChannels(1)
      .audioFrequency(16000)
      .format('s16le')
      .on('error', reject)
      .on('end', () => {
        const raw = Buffer.concat(chunks);
        const samples = raw.length / 2;
        const amps = [];

        for (let i = 0; i < samples; i++) {
          amps.push(Math.abs(raw.readInt16LE(i * 2)) / 32768);
        }

        const size = Math.floor(amps.length / bars);
        if (size === 0) return resolve(undefined);

        const avg = Array.from({ length: bars }, (_, i) =>
          amps
            .slice(i * size, (i + 1) * size)
            .reduce((a, b) => a + b, 0) / size
        );

        const max = Math.max(...avg);
        if (max === 0) return resolve(undefined);

        resolve(
          Buffer.from(
            avg.map((v) => Math.floor((v / max) * 100))
          ).toString('base64')
        );
      })
      .pipe()
      .on('data', (c) => chunks.push(c));
  });
}

function fetchJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.request(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...options.headers }, method: options.method || 'GET' }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

const spamMap = new Map();
const SPAM_LIMIT = 3;
const SPAM_TIME = 5000;
const COOLDOWN_TIME = 10000;

async function startDemonBot() {
    const sessionPath = './demon_session';

    if (process.env.SESSION_ID && process.env.SESSION_ID.trim().length > 20) {
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
        try {
            const rawId = process.env.SESSION_ID.trim().replace(/^GREAT_DEMON_/, '');
            const decodedCreds = Buffer.from(rawId, 'base64').toString('utf-8');
            fs.writeFileSync(path.join(sessionPath, 'creds.json'), decodedCreds);
            console.log('✅ Imperial Session successfully restored from SESSION_ID Environment Variable!');
        } catch (err) {
            console.log('❌ Failed to decode SESSION_ID:', err.message);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        markOnlineOnConnect: autoSettings.autoonline,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('⚡ Reconnecting Great Demon Bot...');
                startDemonBot();
            } else {
                console.log('❌ Session logged out from WhatsApp servers. Please clear SESSION_ID to re-pair.');
            }
        } else if (connection === 'open') {
            console.log('\n⚡ 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 CONNECTED AND ONLINE! ⚡\n');
        }
    });

    // --- 📞 ANTI-CALL INTERCEPTOR ---
    sock.ev.on('call', async (callEvents) => {
        if (!autoSettings.anticall) return;
        for (const call of callEvents) {
            if (call.status === 'offer') {
                try {
                    await sock.rejectCall(call.id, call.from);
                    await sock.sendMessage(call.from, { 
                        text: "⚠️ *Imperial Seal:* Direct voice/video calls are forbidden! You have been automatically rejected by Demon Emperor Engine." 
                    });
                } catch (e) {}
            }
        }
    });

    // --- ANTIDELETE EVENT LISTENER ---
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (update.update?.message === null || update.update?.status === 4) {
                const deletedKey = update.key;
                const originalMsg = messageCache.get(deletedKey.id);
                
                if (originalMsg && originalMsg.key.remoteJid) {
                    const chatJid = originalMsg.key.remoteJid;
                    if (chatJid.endsWith('@g.us') && groupSettings[chatJid]?.antidelete) {
                        const sender = originalMsg.key.participant || originalMsg.key.remoteJid;
                        const content = originalMsg.message.conversation || originalMsg.message.extendedTextMessage?.text || 'Media Message';
                        
                        await sock.sendMessage(chatJid, { 
                            text: "👁️ *IMPERIAL ANTIDELETE DETECTED*\n\n*Sender:* @" + sender.split('@')[0] + "\n*Deleted Content:* " + content,
                            mentions: [sender]
                        });
                    }
                }
            }
        }
    });

    // =========================================================================
    // 👋 WELCOME & GOODBYE EVENT LISTENER WITH PFP STATUS
    // =========================================================================
    sock.ev.on('group-participants.update', async (update) => {
        try {
            const { id: from, participants, action } = update;
 
            if (!groupSettings[from]) {
                groupSettings[from] = { 
                    antiadd: false, antibot: false, antidemote: false, antigroupsmention: false, 
                    antiimage: false, antilink: false, antipromote: false, antiremove: false, 
                    antispam: false, antitag: false, welcome: false, goodbye: false, antidelete: false,
                    antitagadmin: false, grouponly: false, antigcstatus: false,
                    antilinkMode: 'kick', antilinkWarnLimit: 3,
                    antigroupsmentionMode: 'kick', antigroupsmentionWarnLimit: 3
                };
            }

            const groupMetadata = await sock.groupMetadata(from).catch(() => ({ subject: 'Domain' }));
            const groupName = groupMetadata.subject;

            for (let num of participants) {
                const userJid = num;
                const userTag = '@' + userJid.split('@')[0];

                let ppUrl;
                try {
                    ppUrl = await sock.profilePictureUrl(userJid, 'image');
                } catch {
                    ppUrl = MENU_IMAGE_URL;
                }

                // --- AUTOMATIC WELCOME CARD ---
                if (action === 'add' && groupSettings[from].welcome) {
                    const welcomeMsg = 
"👑 *IMPERIAL WELCOME* 👑\n\n" +
"Welcome to *" + groupName + "*, " + userTag + "! ⚔️\n" +
"We hope you enjoy your time here under the rule of Demon Emperor!";

                    await sock.sendMessage(from, { 
                        image: { url: ppUrl }, 
                        caption: welcomeMsg, 
                        mentions: [userJid] 
                    });
                }

                // --- AUTOMATIC GOODBYE CARD ---
                if (action === 'remove' && groupSettings[from].goodbye) {
                    const goodbyeMsg = 
"👋 *IMPERIAL FAREWELL* 👋\n\n" +
userTag + " has departed from *" + groupName + "*.\n" +
"We hope you enjoyed your time here under the rule of Demon Emperor! Farewell! ⚔️";

                    await sock.sendMessage(from, { 
                        image: { url: ppUrl }, 
                        caption: goodbyeMsg, 
                        mentions: [userJid] 
                    });
                }
            }
        } catch (err) {
            console.error('Welcome/Goodbye Error:', err.message);
        }
    });

    // --- AUTO STATUS VIEW & LIKE HANDLER ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            const msg = messages[0];
            if (msg && msg.key && msg.key.remoteJid === 'status@broadcast') {
                const statusJid = msg.key.participant;
                if (autoSettings.autostatusview) {
                    await sock.readMessages([msg.key]);
                }
                if (autoSettings.autostatuslike && statusJid) {
                    await sock.sendMessage('status@broadcast', { 
                        react: { text: '🖤', key: msg.key } 
                    }, { statusJid });
                }
                return;
            }
        } catch (err) {}

        // ==========================================
        // 🛡️ BULLETPROOF ANTICRASH SHIELD
        // ==========================================
        try {
            const msgCheck = messages[0];
            if (msgCheck && msgCheck.message) {
                const rawCheckText = JSON.stringify(msgCheck.message);
                const isTooLong = rawCheckText.length > 8000;
                const hasBidiExploit = /[\u200B-\u200D\uFEFF\u202A-\u202E]{5,}/.test(rawCheckText);
                const hasNullBytes = rawCheckText.includes('\u0000') || rawCheckText.includes('%00');
                const hasHeavyNesting = (rawCheckText.match(/message/g) || []).length > 8;

                if (isTooLong || hasBidiExploit || hasNullBytes || hasHeavyNesting) {
                    console.warn("🚨 [ANTICRASH SHIELD] Intercepted malicious payload from " + msgCheck.key.remoteJid + "!");
                    return;
                }
            }
        } catch (shieldErr) {}

        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        // Cache message for Antidelete
        if (!msg.key.fromMe) {
            messageCache.set(msg.key.id, msg);
            if (messageCache.size > 500) {
                const firstKey = messageCache.keys().next().value;
                messageCache.delete(firstKey);
            }
        }

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNum = sender.split('@')[0];

        // Track message counts for leaderboard
        if (isGroup && !msg.key.fromMe) {
            incrementMessageCount(from, sender);
        }

        const body = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || '';

        if (!groupSettings[from]) {
            groupSettings[from] = { 
                antiadd: false, antibot: false, antidemote: false, antigroupsmention: false, 
                antiimage: false, antilink: false, antipromote: false, antiremove: false, 
                antispam: false, antitag: false, welcome: false, goodbye: false, antidelete: false,
                antitagadmin: false, grouponly: false, antigcstatus: false,
                antilinkMode: 'kick', antilinkWarnLimit: 3,
                antigroupsmentionMode: 'kick', antigroupsmentionWarnLimit: 3
            };
        }

        const isOwner = msg.key.fromMe || sender.includes(OWNER_NUMBER) || senderNum === OWNER_NUMBER;
        const isSudo = isOwner || sudoUsers.has(senderNum);

        // 🛡️ GLOBAL PRIVATE/PUBLIC MODE GATEKEEPER
        if (botMode === 'private' && !isSudo) {
            return; 
        }

        let isAdmin = false;
        let isBotAdmin = false;
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(from);
                const botJid = jidNormalizedUser(sock.user.id);
                const botNumClean = botJid.split('@')[0];

                const userObj = groupMetadata.participants.find(p => jidNormalizedUser(p.id).split('@')[0] === senderNum);
                isAdmin = userObj && (userObj.admin === 'admin' || userObj.admin === 'superadmin');

                const botObj = groupMetadata.participants.find(p => jidNormalizedUser(p.id).split('@')[0] === botNumClean);
                isBotAdmin = botObj && (botObj.admin === 'admin' || botObj.admin === 'superadmin');

                if (isSudo && isAdmin) isBotAdmin = true;
            } catch (e) {}
        }

        const isSenderAdmin = isAdmin || isSudo;

        // --- GLOBAL AUTO-REACT PROCESSOR ---
        if (autoSettings.autoreact && msg.message && !msg.key.fromMe) {
            try {
                const emojis = ['🔥', '⚡', '💀', '👑', '🖤', '⚔️', '⭐'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await sock.sendMessage(from, { 
                    react: { text: randomEmoji, key: msg.key } 
                });
            } catch (e) {}
        }

        // --- AUTOMATED QUOTE-REPLY MEME DETECTOR ---
        const quotedMsgInfo = msg.message?.extendedTextMessage?.contextInfo;
        if (quotedMsgInfo && quotedMsgInfo.stanzaId) {
            const replierText = body.trim().toLowerCase();
            if (['nope', 'no', 'yeah', 'yes', 'nah'].includes(replierText)) {
                const replierJid = sender;
                const originalSenderJid = quotedMsgInfo.participant;
                if (replierJid && originalSenderJid) {
                    const replierTag = '@' + replierJid.split('@')[0];
                    const originalTag = '@' + originalSenderJid.split('@')[0];
                    const memeUrl = 'https://i.imgur.com/2wzGhpF.jpeg';
                    const memeCaption = `🙋‍♂️ ${replierTag} said ${body.trim()} to ${originalTag}!`;
                    await sock.sendMessage(from, {
                        image: { url: memeUrl },
                        caption: memeCaption,
                        mentions: [replierJid, originalSenderJid]
                    }, { quoted: msg });
                }
            }
        }

        // --- ANTIGCSTATUS INTERCEPTOR ---
        if (isGroup && groupSettings[from] && groupSettings[from].antigcstatus && !isSenderAdmin) {
            const isStatusMessage = from === 'status@broadcast' || 
                                    msg.message?.groupStatusMentionMessage || 
                                    msg.message?.protocolMessage?.type === 25;

            if (isStatusMessage) {
                await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                await sock.sendMessage(from, { 
                    text: "🗡️ @" + sender.split('@')[0] + ", group status transmissions are forbidden in this domain!",
                    mentions: [sender]
                });

                if (isBotAdmin) {
                    await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                }
                return;
            }
        }

        // --- ANTISPAM INTERCEPTOR ---
        const senderId = msg.key.participant || msg.key.remoteJid;
        if (body.startsWith(prefix)) {
            const currentTime = Date.now();
            if (spamMap.has(senderId)) {
                const userData = spamMap.get(senderId);
                if (userData.inCooldown) {
                    if (currentTime < userData.cooldownUntil) {
                        await sock.sendMessage(from, { text: "⚔️ *Imperial Warning:* Do not spam the Demon Realm's commands!" }, { quoted: msg });
                        return;
                    } else {
                        spamMap.delete(senderId);
                    }
                } else {
                    if (currentTime - userData.firstMsgTime < SPAM_TIME) {
                        userData.msgCount += 1;
                        if (userData.msgCount >= SPAM_LIMIT) {
                            userData.inCooldown = true;
                            userData.cooldownUntil = currentTime + COOLDOWN_TIME;
                            await sock.sendMessage(from, { text: "🚫 *Demon Realm Seal:* You have triggered anti-spam! Muted for 10 seconds." }, { quoted: msg });
                            return;
                        }
                    } else {
                        spamMap.set(senderId, { msgCount: 1, firstMsgTime: currentTime, inCooldown: false });
                    }
                }
            } else {
                spamMap.set(senderId, { msgCount: 1, firstMsgTime: currentTime, inCooldown: false });
            }
        }

        // --- BULLETPROOF GROUP PROTECTION INTERCEPTORS ---
        if (isGroup && groupSettings[from] && !isSenderAdmin) {
            const fullTextContent = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    msg.message?.imageMessage?.caption || 
                                    msg.message?.videoMessage?.caption || '';

            const linkRegex = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,24}|https?:\/\/[^\s]+)/gi;
            const isLink = linkRegex.test(fullTextContent);
            const isGroupMention = fullTextContent.includes('chat.whatsapp.com');
            const cleanSenderJid = jidNormalizedUser(sender);

            if (groupSettings[from].antilink && isLink) {
                await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                const mode = groupSettings[from].antilinkMode || 'kick';
                
                if (mode === 'kick') {
                    await sock.sendMessage(from, { text: "🗡️ @" + cleanSenderJid.split('@')[0] + ", links are forbidden by decree of the Demon Emperor!", mentions: [cleanSenderJid] });
                    if (isBotAdmin) {
                        await sock.groupParticipantsUpdate(from, [cleanSenderJid], 'remove').catch(() => {});
                    }
                } else if (mode === 'warn') {
                    const limit = groupSettings[from].antilinkWarnLimit || 3;
                    const warnKey = from + '_' + cleanSenderJid;
                    const currentWarns = (warningMap.get(warnKey) || 0) + 1;
                    warningMap.set(warnKey, currentWarns);

                    if (currentWarns >= limit) {
                        warningMap.delete(warnKey);
                        await sock.sendMessage(from, { text: "🚫 @" + cleanSenderJid.split('@')[0] + " reached " + limit + "/" + limit + " warnings for link sharing. Banishing!", mentions: [cleanSenderJid] });
                        if (isBotAdmin) await sock.groupParticipantsUpdate(from, [cleanSenderJid], 'remove').catch(() => {});
                    } else {
                        await sock.sendMessage(from, { text: "⚠️ @" + cleanSenderJid.split('@')[0] + ", links are forbidden! Warning " + currentWarns + "/" + limit, mentions: [cleanSenderJid] });
                    }
                }
                return;
            }

            if (groupSettings[from].antigroupsmention && isGroupMention) {
                await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                const mode = groupSettings[from].antigroupsmentionMode || 'kick';

                if (mode === 'kick') {
                    await sock.sendMessage(from, { text: "🗡️ @" + cleanSenderJid.split('@')[0] + ", group invites are forbidden!", mentions: [cleanSenderJid] });
                    if (isBotAdmin) {
                        await sock.groupParticipantsUpdate(from, [cleanSenderJid], 'remove').catch(() => {});
                    }
                }
                return;
            }

            if (groupSettings[from].antibot && !msg.key.fromMe) {
                const isExternalBot = msg.key.id.startsWith('BAE5') || msg.key.id.length === 16;
                if (isExternalBot) {
                    await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                    await sock.sendMessage(from, { text: "🚨 @" + cleanSenderJid.split('@')[0] + ", external construct detected! Banishing...", mentions: [cleanSenderJid] });
                    if (isBotAdmin) {
                        await sock.groupParticipantsUpdate(from, [cleanSenderJid], 'remove').catch(() => {});
                    }
                    return;
                }
            }
        }

        if (!body.startsWith(prefix)) {
            return;
        }

        // --- 3. COMMAND PARSING ---
        const args = body.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const q = args.join(' ');
        
        const extra = {
            from,
            sender,
            senderNum,
            isGroup,
            isOwner,
            isSudo,
            isSenderAdmin,
            reply: async (text, options = {}) => sock.sendMessage(from, { text, ...options }, { quoted: msg }),
            react: async (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {})
        };

        switch (command) {
            // =========================================================================
            // 1. EMPEROR'S SUPREME MENU (LONG BOX STYLE)
            // =========================================================================
            case 'menu':
            case 'help': {
                const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = uptimeSeconds % 60;
                const uptimeFormatted = hours + "h " + minutes + "m " + seconds + "s";

                const menuText = 
"╭━━━〔  👑 *" + BOT_NAME + "* 👑  〕━━━┈\n" +
"┃ *👑 Bot Owner:* " + OWNER_NAME + "\n" +
"┃ *🔮 Bot Mode:* " + botMode.toUpperCase() + "\n" +
"┃ *🏗️ Bot status:* under construction \n" +
"┃ *⏰️ Uptime:* " + uptimeFormatted + "\n" +
"┃ *🌖 Version:* " + BOT_VERSION + "\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  👑 *𝐄𝐌𝐏𝐄𝐑𝐎𝐑 𝐌𝐄𝐍𝐔*  〕━━━┈\n" +
"✿ sudo\n✿ sudolist\n✿ sudoremove\n✿ setprefix\n✿ anticall\n✿ antigroupstatus\n✿ delgcstatus\n✿ delete / del\n✿ addowner\n✿ antidelete\n✿ antiviewonce\n✿ autoonline\n✿ autorecording\n✿ autostatuslike\n✿ autostatusview\n✿ autotyping\n✿ autoreact\n✿ block\n✿ unblock\n✿ buatgc\n✿ changebio\n✿ devices\n✿ getpp\n✿ gcstatus\n✿ joingroup\n✿ leavegroup\n✿ listfont\n✿ listgroup\n✿ bancheck\n✿ botlink\n✿ fetchstatus\n✿ listchannels\n✿ mode\n✿ connect\n✿ broadcast\n✿ spamngl\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🎭 *𝐇𝐚𝐯𝐞 𝐅𝐮𝐧 𝐰𝐢𝐭𝐡 𝐄𝐦𝐩*  〕━━━┈\n" +
"✿ gm / goodmorning\n✿ ga / goodafternoon\n✿ gn / goodnight\n✿ konachan / konachansfw\n✿ wasted\n✿ top / activeusers\n✿ gayrate\n✿ flirt\n✿ dare\n✿ truth\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🛡️ *𝘿𝒐𝒎𝒂𝒊𝒏 𝙈𝒂𝒏𝒂𝒈𝒆𝒎𝒆𝒏𝒕*  〕━━━┈\n" +
"✿ welcome\n✿ goodbye\n✿ antilink (warn/kick)\n✿ antigroupsmention (warn/kick)\n✿ antibot\n✿ antispam\n✿ antitag\n✿ antitagadmin\n✿ antiremove\n✿ addmember\n✿ antiadd\n✿ antidemote\n✿ antiimage\n✿ antipromote\n✿ approveall\n✿ close\n✿ closetime\n✿ demoteall\n✿ demoteuser\n✿ disapproveall\n✿ dor\n✿ gcs\n✿ glostat\n✿ grouplink\n✿ groupmenu\n✿ grouponly\n✿ hidetag\n✿ kickall\n✿ left\n✿ listgroups\n✿ mediatag\n✿ open\n✿ opentime\n✿ promoteall\n✿ promoteuser\n✿ remove\n✿ setgroupbio\n✿ setgroupname\n✿ setgrouppp\n✿ setwarning\n✿ tagadmin\n✿ tagall\n✿ tagonline\n✿ tagpoll\n✿ warning\n✿ pin\n✿ textbox\n✿ vv\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🧠 *𝐃𝐞𝐦𝐨𝐧𝐢𝐜 𝐈𝐧𝐭𝐞𝐥𝐥𝐢𝐠𝐞𝐧𝐜𝐞*  〕━━━┈\n" +
"✿ ai\n✿ aimenu\n✿ claude\n✿ copilot\n✿ describe\n✿ felo\n✿ gpt\n✿ imagine\n✿ llama\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🧪 *𝐈𝐦𝐩𝐞𝐫𝐢𝐚𝐥  𝐂𝐨𝐧𝐯𝐞𝐫𝐬𝐢𝐨𝐧*  〕━━━┈\n" +
"✿ audio\n✿ convertmenu\n✿ stickermeme\n✿ stiker\n✿ swm\n✿ telestick\n✿ toaud\n✿ togif\n✿ toimg\n✿ tomp4\n✿ toptt\n✿ tourl\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  📥 *𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝 𝐓𝐨𝐨𝐥𝐬*  〕━━━┈\n" +
"✿ applemusic\n✿ capcut\n✿ dl\n✿ downloadmenu\n✿ fb\n✿ yts\n✿ lyrics\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🎮 *𝐈𝐦𝐩𝐞𝐫𝐢𝐚𝐥  𝐆𝐚𝐦𝐞𝐬*  〕━━━┈\n" +
"✿ 2048\n✿ activegames\n✿ connect4\n✿ dino\n✿ emojidecode\n✿ endgame\n✿ flappy\n✿ galaxy\n✿ gamemenu\n✿ letterblitz\n✿ memory\n✿ mines\n✿ pong\n✿ reverseit\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🛠️ *𝐃𝐞𝐦𝐨𝐧𝐢𝐜 𝐓𝐨𝐨𝐥𝐬*  〕━━━┈\n" +
"✿ androidcrash\n✿ bugmenu\n✿ gccrash\n✿ hd\n✿ iosfc\n✿ ocr\n✿ removebg\n✿ screenshot\n✿ searchmenu\n✿ toolmenu\n✿ ping\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔 👑 *𝘼𝘽𝙊𝙐𝙏 𝘾𝙍𝙀𝘼𝙏𝙊𝙍* 👑 〕━━━┈\n" +
"┃ 👑 *CREATOR:* ᴵᴬᴹ«»ᘜяᥱᥲт ᗪᥱмση ᙓмρ\n" +
"┃ 📞 *CONTACT:* +2347061696819\n" +
"┃ 🛡️ *IDENTITY:* 𝐰𝐡𝐲 𝐚𝐥𝐰𝐚𝐲𝐬 𝐊𝐞𝐥𝐯𝐢𝐧\n" +
"┃ 🐙 *GITHUB:* too lazy to put my git acc\n" +
"┃\n" +
"┃ 💐 _\"𝙏𝒉𝒆 𝙁𝒓𝒂𝒈𝒓𝒂𝒏𝒕 𝒇𝒍𝒐𝒘𝒆𝒓𝒔 𝘽𝒍𝒐𝒐𝒎𝒔 𝒘𝒊𝒕𝙝 𝘿𝒊𝒈𝒏𝒊𝒕𝒚\"_\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n";

                try {
                    await sock.sendMessage(from, { image: { url: MENU_IMAGE_URL }, caption: menuText }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }
                break;
            }

            // =========================================================================
            // NATURAL & DRAMATIC GREETINGS (.gm, .ga, .gn)
            // =========================================================================
            case 'goodmorning':
            case 'gm': {
                if (!isGroup) return extra.reply('⚔️ *Use this in a group chat.*');
                if (!isSenderAdmin && !isSudo) return extra.reply('⚔️ *Only admins or sudo users can run this.*');

                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const mentions = groupMetadata.participants.map(p => p.id);

                    const morningArtworks = [
                        "https://img.sanishtech.com/u/96b35f47cb64cc0f77b9a781b40d0990.jpg",
                        "https://cdn.myanimelist.net/images/anime/1029/119279.jpg",
                        "https://i.imgur.com/2wzGhpF.jpeg"
                    ];

                    const morningCaptions = [
                        "╭━━━〔  🌄 *OHAYO-MORNING*  〕━━━┈\n┃ ⚡ Wake up and get to work.\n┃ 👁️ Another day to grind, sharpen your focus, and stay ahead.\n┃ ⚔️ Lock in and let’s handle business today.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Time waits for no one.”_",
                        "╭━━━〔  ⚔️ *OHAYO-MORNING CALL*  〕━━━┈\n┃ 🌅 New day, fresh energy.\n┃ 🗡️ Shake off the sleep and get ready for whatever comes next.\n┃ ⚡ Stay sharp and keep moving forward.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Keep pushing, no stepping back.”_",
                        "╭━━━〔  🌌 *OHAYO-RISE AND SHINE*  〕━━━┈\n┃ 👑 Sun’s up, time to move.\n┃ 🔥 Don’t waste the morning slacking off.\n┃ 🖤 Stay focused, handle your goals, and dominate the day.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Built for the long road.”_"
                    ];

                    const randomImg = morningArtworks[Math.floor(Math.random() * morningArtworks.length)];
                    const randomCaption = morningCaptions[Math.floor(Math.random() * morningCaptions.length)];

                    await sock.sendMessage(from, { react: { text: '🌅', key: msg.key } });
                    await sock.sendMessage(from, { image: { url: randomImg }, caption: randomCaption, mentions }, { quoted: msg });
                } catch (e) {
                    await extra.reply('❌ *Something went wrong sending the morning greeting.*');
                }
                break;
            }

            case 'goodafternoon':
            case 'ga': {
                if (!isGroup) return extra.reply('⚔️ *Use this in a group chat.*');
                if (!isSenderAdmin && !isSudo) return extra.reply('⚔️ *Only admins or sudo users can run this.*');

                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const mentions = groupMetadata.participants.map(p => p.id);

                    const afternoonArtworks = [
                        "https://i.imgur.com/2wzGhpF.jpeg",
                        "https://img.sanishtech.com/u/96b35f47cb64cc0f77b9a781b40d0990.jpg"
                    ];

                    const afternoonCaptions = [
                        "╭━━━〔  ☀️ *GOOD AFTERNOON PPL *  〕━━━┈\n┃ 🌤️ Half the day is gone, keep the momentum going.\n┃ 🗡️ Don't slow down now—stay focused on what you started.\n┃ ⚡ Finish the day strong.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Consistency is everything.”_",
                        "╭━━━〔  🔥 *AFTERNOON RUSH*  〕━━━┈\n┃ ☀️ Peak of the day right here.\n┃ ⚡ Take a quick breather if you need to, then back to work.\n┃ ⚔️ Make the rest of the day count.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Stay locked in.”_",
                        "╭━━━〔  👑 *AFTERNOON VIBES*  〕━━━┈\n┃ 🌤️ The sun is high, keep pushing through.\n┃ 🩸 No room for laziness halfway through the grind.\n┃ 🖤 Stay sharp until the sun sets, DID YOU THINK KELVIN IS PEAK .\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“No excuses, just progress.”_"
                    ];

                    const randomImg = afternoonArtworks[Math.floor(Math.random() * afternoonArtworks.length)];
                    const randomCaption = afternoonCaptions[Math.floor(Math.random() * afternoonCaptions.length)];

                    await sock.sendMessage(from, { react: { text: '🔥', key: msg.key } });
                    await sock.sendMessage(from, { image: { url: randomImg }, caption: randomCaption, mentions }, { quoted: msg });
                } catch (e) {
                    await extra.reply('❌ *Something went wrong sending the afternoon greeting.*');
                }
                break;
            }

            case 'goodnight':
            case 'gn': {
                if (!isGroup) return extra.reply('⚔️ *Use this in a group chat.*');
                if (!isSenderAdmin && !isSudo) return extra.reply('⚔️ *Only admins or sudo users can run this.*');

                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const mentions = groupMetadata.participants.map(p => p.id);

                    const nightArtworks = [
                        "https://cdn.myanimelist.net/images/anime/1029/119279.jpg",
                        "https://img.sanishtech.com/u/96b35f47cb64cc0f77b9a781b40d0990.jpg"
                    ];

                    const nightCaptions = [
                        "╭━━━〔  🌙 *OYASUMI-GOOD NIHT*  〕━━━┈\n┃ 🌌 Day’s over. Time to call it a night.\n┃ 🕷️ Get some rest and recharge for tomorrow.\n┃ 🖤 Catch you all when the sun comes up ooooo .\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Rest up for the next run.”_",
                        "╭━━━〔  🖤 *OYASUMI-GOOD NIGT*  〕━━━┈\n┃ 🌙 Sun’s down, quiet hours.\n┃ ⚔️ Put down the work and clear your mind.\n┃ 🌌 Sleep well and get ready to go again tomorrow, justvcare about yall.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Tomorrow we do it all over again.”_",
                        "╭━━━〔  🗡️ *OYASUMI-GOODNIGHT*  〕━━━┈\n┃ 🌑 Wrap it up for the day.\n┃ ⚡ Rest your mind, you earned it.\n┃ 🖤 Goodnight everyone, see you tomorrow, if you like no sleep Lol.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Until next dawn.”_"
                    ];

                    const randomImg = nightArtworks[Math.floor(Math.random() * nightArtworks.length)];
                    const randomCaption = nightCaptions[Math.floor(Math.random() * nightCaptions.length)];

                    await sock.sendMessage(from, { react: { text: '🖤', key: msg.key } });
                    await sock.sendMessage(from, { image: { url: randomImg }, caption: randomCaption, mentions }, { quoted: msg });
                } catch (e) {
                    await extra.reply('❌ *Something went wrong sending the night greeting.*');
                }
                break;
            }

            // =========================================================================
            // CUSTOM ADDED FEATURES INTEGRATION
            // =========================================================================
            
            // 1. Message Count Leaderboard
            case 'top':
            case 'topmembers': {
                if (!isGroup) {
                    return extra.reply('This command is only available in group chats.');
                }

                const messageCounts = loadMessageCounts();
                const groupCounts = messageCounts[from] || {};

                const sortedMembers = Object.entries(groupCounts)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 5);

                if (sortedMembers.length === 0) {
                    return extra.reply('No message activity recorded yet.');
                }

                let message = '🏆 Top Members Based on Message Count:\n\n';
                sortedMembers.forEach(([userId, count], index) => {
                    message += `${index + 1}. @${userId.split('@')[0]} - ${count} messages\n`;
                });

                await sock.sendMessage(from, { text: message, mentions: sortedMembers.map(([userId]) => userId) }, { quoted: msg });
                break;
            }

            // 2. Wasted Image Command
            case 'wasted': {
                let userToWaste;
                
                if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
                    userToWaste = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                } else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
                    userToWaste = msg.message.extendedTextMessage.contextInfo.participant;
                }
                
                if (!userToWaste) {
                    await sock.sendMessage(from, { 
                        text: 'Please mention someone or reply to their message to waste them!' 
                    }, { quoted: msg });
                    return;
                }

                try {
                    let profilePic;
                    try {
                        profilePic = await sock.profilePictureUrl(userToWaste, 'image');
                    } catch {
                        profilePic = 'https://i.imgur.com/2wzGhpF.jpeg';
                    }

                    const wastedResponse = await axios.get(
                        `https://some-random-api.com/canvas/overlay/wasted?avatar=${encodeURIComponent(profilePic)}`,
                        { responseType: 'arraybuffer' }
                    );

                    await sock.sendMessage(from, {
                        image: Buffer.from(wastedResponse.data),
                        caption: `⚰️ *Wasted* : ${userToWaste.split('@')[0]} 💀\n\nRest in pieces!`,
                        mentions: [userToWaste]
                    }, { quoted: msg });

                } catch (error) {
                    console.error('Error in wasted command:', error);
                    await sock.sendMessage(from, { 
                        text: 'Failed to create wasted image! Try again later.'
                    }, { quoted: msg });
                }
                break;
            }

            // 3. Konachan Anime Visual Command (.konachan)
            case 'konachan':
            case 'konachansfw': {
                try {
                    await sock.sendMessage(from, { text: '🎨 *Harvesting Konachan anime visual, My Lord...*' }, { quoted: msg });

                    let imageUrl = null;
                    try {
                        const res = await fetchJson('https://konachan.net/post.json?limit=20');
                        if (Array.isArray(res) && res.length > 0) {
                            const validPosts = res.filter(p => p.file_url);
                            if (validPosts.length > 0) {
                                const randomPost = validPosts[Math.floor(Math.random() * validPosts.length)];
                                imageUrl = randomPost.file_url.startsWith('http') ? randomPost.file_url : 'https:' + randomPost.file_url;
                            }
                        }
                    } catch (err) {}

                    if (!imageUrl) {
                        const fallbackRes = await fetchJson('https://api.waifu.pics/sfw/waifu');
                        if (fallbackRes && fallbackRes.url) {
                            imageUrl = fallbackRes.url;
                        }
                    }

                    if (!imageUrl) {
                        return extra.reply('❌ *No Konachan image could be harvested at this moment, My Lord.*');
                    }

                    const imageResponse = await axios.get(imageUrl, {
                        responseType: 'arraybuffer',
                        timeout: 30000
                    });

                    const imageBuffer = Buffer.from(imageResponse.data);
                    if (!imageBuffer || imageBuffer.length === 0) {
                        throw new Error('Empty image response received');
                    }

                    await sock.sendMessage(from, {
                        image: imageBuffer,
                        caption: "✦ *Konachan Anime Visual Archive* ✦\n_“Summoned successfully for My Lord Demon Emperor”_"
                    }, { quoted: msg });

                } catch (error) {
                    console.error('[konachan error]:', error.message);
                    await extra.reply(`❌ *Could not fetch konachan image:* ${error.message}`);
                }
                break;
            }

            // =========================================================================
            // EXISTING BOT COMMANDS
            // =========================================================================
            case 'sudo': {
                if (!isOwner) return extra.reply('⚔️ *Only My Lord Demon Emperor can appoint Sudo members!*');
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') : null);
                if (!target) return extra.reply('💡 *My Lord, tag a user or reply to their message to grant Sudo rank.*');
                
                const cleanNum = target.replace(/[^0-9]/g, '');
                sudoUsers.add(cleanNum);
                db.sudoUsers = Array.from(sudoUsers);
                saveSettings(db);
                await extra.reply(`👑 *Granted Sudo privileges to +${cleanNum}, My Lord!*`);
                break;
            }

            case 'sudolist': {
                let txt = "👑 *𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 Sudo Roster*\n\n";
                sudoUsers.forEach(u => txt += `• +${u}\n`);
                await sock.sendMessage(from, { text: txt, mentions: Array.from(sudoUsers).map(u => u + '@s.whatsapp.net') }, { quoted: msg });
                break;
            }

            case 'sudoremove': {
                if (!isOwner) return extra.reply('⚔️ *Only My Lord Demon Emperor can revoke Sudo members!*');
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') : null);
                if (!target) return extra.reply('💡 *My Lord, tag or mention a Sudo user to strip their rank.*');
                
                const cleanNum = target.replace(/[^0-9]/g, '');
                sudoUsers.delete(cleanNum);
                db.sudoUsers = Array.from(sudoUsers);
                saveSettings(db);
                await extra.reply(`❌ *Stripped Sudo rank from +${cleanNum}, My Lord!*`);
                break;
            }

            case 'anticall': {
                if (!isSudo) return extra.reply('⚔️ *Sudo rights required!*');
                if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
                    return extra.reply('Usage: ' + prefix + 'anticall on/off');
                }
                const enabled = args[0].toLowerCase() === 'on';
                autoSettings.anticall = enabled;
                db.autoSettings = autoSettings;
                saveSettings(db);
                await extra.reply(enabled ? '✅ Anti-call enabled. Calls will be auto-rejected & blocked.' : '❌ Anti-call disabled.');
                break;
            }

            case 'setprefix':
            case 'prefix': {
                if (!isSudo) return extra.reply('⚔️ *Sudo rights required!*');
                if (args.length === 0) {
                    return extra.reply(`📌 Current prefix: ${prefix}\n\nUsage: ${prefix}setprefix <new prefix>`);
                }
                const newPrefix = args[0];
                if (newPrefix.length > 3) {
                    return extra.reply('❌ Prefix must be 1-3 characters long!');
                }
                prefix = newPrefix;
                db.prefix = prefix;
                saveSettings(db);
                await extra.reply(`✅ Prefix changed to: ${prefix}\n\nNew command format: ${prefix}command`);
                break;
            }

            case 'antigroupstatus':
            case 'antigstatus':
            case 'ags': {
                if (!isGroup) return extra.reply('⚔️ *Domain Command Only!*');
                if (!isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                
                try {
                    const ctx = msg.message?.extendedTextMessage?.contextInfo;
                    if (!args[0]) {
                        const settings = groupSettings[extra.from];
                        const status = settings.antigroupstatus ? 'ON' : 'OFF';
                        const action = settings.antigroupstatusAction || 'delete';
                        return extra.reply(
                            `📵 *Anti Group Status*\n\n` +
                            `Status: *${status}*\n` +
                            `Action: *${action}*\n\n` +
                            `Blocks members from posting WhatsApp group statuses.\n` +
                            `Usage:\n  ${prefix}antigroupstatus on\n  ${prefix}antigroupstatus off`
                        );
                    }

                    const opt = args[0].toLowerCase();
                    if (opt === 'on') {
                        groupSettings[extra.from].antigroupstatus = true;
                        return extra.reply('*Anti group status has been turned ON*');
                    }
                    if (opt === 'off') {
                        groupSettings[extra.from].antigroupstatus = false;
                        return extra.reply('*Anti group status has been turned OFF*');
                    }
                } catch (e) {
                    await extra.reply(`❌ Error: ${e.message}`);
                }
                break;
            }

            case 'del':
            case 'delete': {
                if (!isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                if (!ctx?.stanzaId) {
                    return extra.reply('🗑️ *Reply directly to the message you wish to delete, My Lord.*');
                }

                try {
                    const targetParticipant = ctx.participant ? jidNormalizedUser(ctx.participant) : undefined;
                    const deleteKey = { 
                        remoteJid: from, 
                        id: ctx.stanzaId, 
                        participant: targetParticipant 
                    };
                    await sock.sendMessage(from, { delete: deleteKey });
                } catch (error) {
                    await extra.reply('❌ *Failed to delete message. Ensure 𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 is  admin!*');
                }
                break;
            }

            case 'delgcstatus':
            case 'delgstatus':
            case 'delgs': {
                if (!isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                if (!ctx?.stanzaId || !ctx?.participant) {
                    return extra.reply('🗑️ *Reply to the group status story message you want to revoke!*');
                }

                try {
                    const targetJid = jidNormalizedUser(ctx.participant);
                    const statusKey = {
                        remoteJid: from,
                        fromMe: false,
                        id: ctx.stanzaId,
                        participant: targetJid
                    };
                    if (typeof sock.revokeGroupStatus === 'function') {
                        await sock.revokeGroupStatus(from, statusKey);
                        await extra.reply('✅ *Group status successfully revoked!*');
                    } else {
                        await sock.sendMessage(from, { delete: statusKey });
                        await extra.reply('✅ *Group status message deleted!*');
                    }
                } catch (e) {
                    await extra.reply('❌ *Failed to revoke status story. Ensure bot has admin rights.*');
                }
                break;
            }

            case 'flirt':
            case 'pickup':
            case 'pickupline': {
                try {
                    const response = await axios.get('https://api.shizo.top/quote/flirt?apikey=shizo');
                    if (!response.data || !response.data.status || !response.data.result) {
                        throw new Error('Invalid API response');
                    }
                    const flirtText = response.data.result;
                    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    if (mentioned.length > 0) {
                        await sock.sendMessage(extra.from, { text: flirtText, mentions: mentioned }, { quoted: msg });
                    } else {
                        await extra.reply(flirtText);
                    }
                } catch (error) {
                    await extra.reply(`❌ Error: ${error.message}`);
                }
                break;
            }

            case 'dare': {
                const dares = [
                    "Send a screenshot of your gallery!",
                    "Let someone else write a status on your WhatsApp!",
                    "Call a random contact and sing them a song!",
                    "Post an embarrassing selfie!",
                    "Text your crush and confess your feelings!",
                    "Do 20 pushups and send a video!",
                    "Change your profile picture to something embarrassing for 24 hours!",
                    "Send a voice note singing the alphabet!",
                    "Let the group choose your status for a day!",
                    "Tell the group your most embarrassing moment!"
                ];
                const randomDare = dares[Math.floor(Math.random() * dares.length)];
                await extra.reply(randomDare);
                break;
            }

            case 'truth': {
                try {
                    const question = await truth();
                    const res = await translate(question, { to: 'en' });
                    await extra.reply(res.text);
                } catch (error) {
                    await extra.reply(`❌ Error: ${error.message}`);
                }
                break;
            }

            case 'gayrate':
            case 'gay': {
                const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
                const mentioned = ctx.mentionedJid || [];
                let targetId = mentioned.length ? mentioned[0] : (ctx.participant || extra.sender);
                const targetTag = `@${targetId.split('@')[0]}`;
                const base = targetId.toString().split('').reduce((s,c)=> s + c.charCodeAt(0), 0);
                const percent = ((base % 101) + Math.floor(Math.random()*7)) % 101;
                const out = `${targetTag} score: ${percent}% Bro so you are gay Chai,Omo  😂😂 🌈`;
                await sock.sendMessage(extra.from, { text: out, mentions: [targetId] }, { quoted: msg });
                break;
            }

            case 'autoreact': {
                if (!isSudo) return extra.reply('⚔️ *Sudo rights required!*');
                const stateArg = args[0]?.toLowerCase();
                
                if (stateArg === 'on') {
                    autoSettings.autoreact = true;
                    db.autoSettings = autoSettings;
                    saveSettings(db);
                    await extra.reply('✅ *Global Auto-React activated & saved! The bot will now react to all messages.*');
                } else if (stateArg === 'off') {
                    autoSettings.autoreact = false;
                    db.autoSettings = autoSettings;
                    saveSettings(db);
                    await extra.reply('❌ *Global Auto-React deactivated & saved!*');
                } else {
                    autoSettings.autoreact = !autoSettings.autoreact;
                    db.autoSettings = autoSettings;
                    saveSettings(db);
                    await extra.reply(`⚙️ *Auto-React Status:* ${autoSettings.autoreact ? 'ACTIVE ✅' : 'DISABLED ❌'} (Saved)\n\n💡 *Usage:* \`${prefix}autoreact on\` or \`${prefix}autoreact off\``);
                }
                break;
            }

            case 'addowner': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor can appoint co-owners!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, tag a user or reply to their message.*' }, { quoted: msg });
                sudoUsers.add(target.split('@')[0]);
                db.sudoUsers = Array.from(sudoUsers);
                saveSettings(db);
                await sock.sendMessage(from, { text: '👑 *Granted throne privileges to subject, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'antidelete': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                groupSettings[from].antidelete = !groupSettings[from].antidelete;
                await sock.sendMessage(from, { text: "👁️ *𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 Anti-Delete:* " + (groupSettings[from].antidelete ? 'ACTIVATED ✅' : 'DEACTIVATED ❌') }, { quoted: msg });
                break;
            }

            case 'antilink':
            case 'antigroupsmention': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain Command Only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                const subCmd = args[0]?.toLowerCase();
                const subVal = args[1];

                if (subCmd === 'on') {
                    groupSettings[from][command] = true;
                    await sock.sendMessage(from, { text: "✅ *By decree of the 𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4:* *" + command.toUpperCase() + "* is ENFORCED!" }, { quoted: msg });
                } else if (subCmd === 'off') {
                    groupSettings[from][command] = false;
                    await sock.sendMessage(from, { text: "❌ *Imperial Dispensation:* *" + command.toUpperCase() + "* is DISABLED!" }, { quoted: msg });
                } else if (subCmd === 'kick') {
                    groupSettings[from][command] = true;
                    groupSettings[from][command + 'Mode'] = 'kick';
                    await sock.sendMessage(from, { text: "✅ *" + command.toUpperCase() + "* set to **DIRECT KICK** mode!" }, { quoted: msg });
                } else if (subCmd === 'warn') {
                    groupSettings[from][command] = true;
                    groupSettings[from][command + 'Mode'] = 'warn';
                    if (subVal && !isNaN(subVal)) {
                        groupSettings[from][command + 'WarnLimit'] = parseInt(subVal);
                    }
                    const limit = groupSettings[from][command + 'WarnLimit'] || 3;
                    await sock.sendMessage(from, { text: "✅ *" + command.toUpperCase() + "* set to **WARN** mode (Limit: " + limit + " warnings)!" }, { quoted: msg });
                } else {
                    groupSettings[from][command] = !groupSettings[from][command];
                    await sock.sendMessage(from, { 
                        text: "🛡️ *" + command.toUpperCase() + " Barrier:* " + (groupSettings[from][command] ? 'ENFORCED ✅' : 'DISABLED ❌') + "\n\n💡 *Usage:*\n`." + command + " on/off`\n`." + command + " kick`\n`." + command + " warn 3`" 
                    }, { quoted: msg });
                }
                break;
            }

            case 'vv':
            case 'antiviewonce':
            case 'viewonce': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                
                const quotedContext = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedContext) {
                    return sock.sendMessage(from, { text: '💡 *Please, reply directly to a View-Once message!*' }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: '🕵️‍♂️ *Piercing View-Once Veil...*' }, { quoted: msg });

                    let targetMessage = quotedContext.viewOnceMessage?.message || 
                                        quotedContext.viewOnceMessageV2?.message || 
                                        quotedContext.viewOnceMessageV2Extension?.message || 
                                        quotedContext;

                    const mediaType = Object.keys(targetMessage)[0];
                    const mediaContent = targetMessage[mediaType];

                    if (!mediaContent || (!mediaType.includes('image') && !mediaType.includes('video') && !mediaType.includes('audio'))) {
                        return sock.sendMessage(from, { text: '❌ *No valid View-Once media payload found in quoted message.*' }, { quoted: msg });
                    }

                    const streamType = mediaType.replace('Message', '');
                    const stream = await downloadContentFromMessage(mediaContent, streamType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const captionText = mediaContent.caption ? "📜 *Caption:* " + mediaContent.caption : '🕵️‍♂️ *ViewOnce Veil Pierced successfully, My Lord!*';

                    if (mediaType.includes('image')) {
                        await sock.sendMessage(from, { image: buffer, caption: captionText }, { quoted: msg });
                    } else if (mediaType.includes('video')) {
                        await sock.sendMessage(from, { video: buffer, caption: captionText }, { quoted: msg });
                    } else if (mediaType.includes('audio')) {
                        await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, { quoted: msg });
                    }

                } catch (err) {
                    console.error('ViewOnce Extraction Error:', err);
                    await sock.sendMessage(from, { text: "❌ *Failed to pierce View-Once payload:* " + err.message }, { quoted: msg });
                }
                break;
            }

            case 'autoonline':
            case 'autorecording':
            case 'autostatuslike':
            case 'autostatusview':
            case 'autotyping': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                autoSettings[command] = !autoSettings[command];
                db.autoSettings = autoSettings;
                saveSettings(db);
                await sock.sendMessage(from, { text: "⚙️ *Imperial Presence [" + command.toUpperCase() + "]:* " + (autoSettings[command] ? 'ENABLED ✅' : 'DISABLED ❌') }, { quoted: msg });
                break;
            }

            case 'block': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My owner may cast banishment!*' }, { quoted: msg });
                
                let target = null;
                const quoted = msg.message?.extendedTextMessage?.contextInfo;
                
                if (quoted?.participant) {
                    target = quoted.participant;
                } else if (quoted?.mentionedJid && quoted.mentionedJid.length > 0) {
                    target = quoted.mentionedJid[0];
                } else if (q) {
                    const cleanNum = q.replace(/[^0-9]/g, '');
                    if (cleanNum.length >= 7) {
                        target = cleanNum + '@s.whatsapp.net';
                    }
                }

                if (!target) {
                    return sock.sendMessage(from, { text: '💡 *My Lord, tag `@user`, reply to their message, or type a valid number to banish!*' }, { quoted: msg });
                }

                const cleanPhone = target.split('@')[0].split(':')[0];
                const normalizedJid = cleanPhone + '@s.whatsapp.net';

                try {
                    await sock.sendMessage(from, { text: '⏳ *Forcing banishment seal across WhatsApp servers...*' }, { quoted: msg });

                    await sock.query({
                        tag: 'iq',
                        attrs: {
                            xmlns: 'w:b',
                            type: 'set',
                            to: '@s.whatsapp.net'
                        },
                        content: [
                            {
                                tag: 'item',
                                attrs: {
                                    action: 'block',
                                    jid: normalizedJid
                                }
                            }
                        ]
                    }).catch(async () => {
                        await sock.updateBlockStatus(normalizedJid, 'block');
                    });

                    blockedUsers.add(normalizedJid);
                    await sock.sendMessage(from, { 
                        text: "🚫 @" + cleanPhone + " has been forcefully banished into the Void, My Lord! ✅", 
                        mentions: [normalizedJid] 
                    }, { quoted: msg });

                } catch (err) {
                    console.error('Forced Block Error:', err);
                    await sock.sendMessage(from, { text: "❌ *Banishment Seal Rejected:* " + (err.message || 'Server connection error.') }, { quoted: msg });
                }
                break;
            }

            case 'unblock': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may lift banishment!*' }, { quoted: msg });
                
                let target = null;
                const quoted = msg.message?.extendedTextMessage?.contextInfo;
                
                if (quoted?.participant) {
                    target = quoted.participant;
                } else if (quoted?.mentionedJid && quoted.mentionedJid.length > 0) {
                    target = quoted.mentionedJid[0];
                } else if (q) {
                    const cleanNum = q.replace(/[^0-9]/g, '');
                    if (cleanNum.length >= 7) {
                        target = cleanNum + '@s.whatsapp.net';
                    }
                }

                if (!target) {
                    return sock.sendMessage(from, { text: '💡 *My Lord, tag `@user`, reply to their message, or type a valid number to unblock!*' }, { quoted: msg });
                }

                const cleanPhone = target.split('@')[0].split(':')[0];
                const normalizedJid = cleanPhone + '@s.whatsapp.net';

                try {
                    await sock.query({
                        tag: 'iq',
                        attrs: {
                            xmlns: 'w:b',
                            type: 'set',
                            to: '@s.whatsapp.net'
                        },
                        content: [
                            {
                                tag: 'item',
                                attrs: {
                                    action: 'unblock',
                                    jid: normalizedJid
                                }
                            }
                        ]
                    }).catch(async () => {
                        await sock.updateBlockStatus(normalizedJid, 'unblock');
                    });

                    blockedUsers.delete(normalizedJid);
                    await sock.sendMessage(from, { 
                        text: "✅ *Banishment rescinded for @" + cleanPhone + ", My Lord!*", 
                        mentions: [normalizedJid] 
                    }, { quoted: msg });

                } catch (err) {
                    console.error('Forced Unblock Error:', err);
                    await sock.sendMessage(from, { text: "❌ *Failed to unblock user:* " + err.message }, { quoted: msg });
                }
                break;
            }

            case 'buatgc': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .buatgc <domain_name>' }, { quoted: msg });
                try {
                    const group = await sock.groupCreate(q, [sender]);
                    await sock.sendMessage(from, { text: "👑 *New domain created! ID:* " + group.id }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Failed to forge domain, My Lord.*' }, { quoted: msg });
                }
                break;
            }

            case 'changebio': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .changebio <new_status>' }, { quoted: msg });
                await sock.updateProfileStatus(q);
                await sock.sendMessage(from, { text: '👑 *Bio status updated, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'devices':
            case 'device': {
                await sock.sendMessage(from, { 
                    text: "💻 *𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 Throne Engine Info*\n\n" +
                          "• *Platform:* " + os.platform() + "\n" +
                          "• *Architecture:* " + os.arch() + "\n" +
                          "• *Memory:* " + (os.freemem() / 1024 / 1024).toFixed(2) + " MB Free / " + (os.totalmem() / 1024 / 1024).toFixed(2) + " MB Total\n" +
                          "• *Uptime:* " + (os.uptime() / 3600).toFixed(2) + " Hours" 
                }, { quoted: msg });
                break;
            }

            case 'getpp': {
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null) || sender;
                try {
                    const ppUrl = await sock.profilePictureUrl(target, 'image');
                    await sock.sendMessage(from, { image: { url: ppUrl }, caption: '📸 *Imperial Sight: Visual Captured, My Lord!*' }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ * User  portrait concealed from sight.*' }, { quoted: msg });
                }
                break;
            }

            case 'joingroup': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .joingroup <invite_link>' }, { quoted: msg });
                try {
                    const code = q.split('chat.whatsapp.com/')[1] || q;
                    await sock.groupAcceptInvite(code);
                    await sock.sendMessage(from, { text: '👑 *Domain entered by Imperial decree, My Lord!*' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Invalid domain invite link.*' }, { quoted: msg });
                }
                break;
            }

            case 'leavegroup':
            case 'left': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '👋 *Departing domain as commanded by My Lord Demon Emperor!*' }, { quoted: msg });
                await sock.groupLeave(from);
                break;
            }

            case 'listfont': {
                await sock.sendMessage(from, { 
                    text: "✒️ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Script Typographies*\n\n" +
                          "1. Imperial Gothic: 𝕲𝖗𝖊𝖆𝖙 𝕯𝖊𝖒𝖔𝖓\n" +
                          "2. Royal Monospace: Great Demon\n" +
                          "3. Shadow Italic: Great Demon"
                }, { quoted: msg });
                break;
            }

            case 'listgroup':
            case 'listgroups': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const groups = Object.keys(await sock.groupFetchAllParticipating());
                let txt = "📋 *Subjugated Domains (" + groups.length + "):*\n\n";
                for (let gId of groups) {
                    const meta = await sock.groupMetadata(gId).catch(() => ({}));
                    txt += "• " + (meta.subject || 'Unknown Domain') + " (" + gId + ")\n";
                }
                await sock.sendMessage(from, { text: txt }, { quoted: msg });
                break;
            }

            case 'bancheck': {
                await sock.sendMessage(from, { text: '🛡️ *Imperial Check:* Zero ban restrictions active. Your throne stands intact, My Lord!' }, { quoted: msg });
                break;
            }

            case 'botlink': {
                await sock.sendMessage(from, { text: '🔗 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Throne Portal:* Online & Sovereign' }, { quoted: msg });
                break;
            }

            case 'fetchstatus': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *Mention or reply to target.*' }, { quoted: msg });
                try {
                    const status = await sock.fetchStatus(target);
                    await sock.sendMessage(from, { text: '📜 *Status:* "' + status.status + '"' }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ *Status concealed.*' }, { quoted: msg });
                }
                break;
            }

            case 'listchannels': {
                await sock.sendMessage(from, { text: '📢 *𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 Channels:* Fully subjugated under your rule, My Lord!' }, { quoted: msg });
                break;
            }

            case 'mode':
            case 'private':
            case 'public': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may alter realm permissions!*' }, { quoted: msg });
                
                let targetMode = '';
                if (command === 'public' || command === 'private') {
                    targetMode = command;
                } else if (args[0]) {
                    targetMode = args[0].toLowerCase();
                }

                if (targetMode === 'public' || targetMode === 'private') {
                    botMode = targetMode;
                    await sock.sendMessage(from, { text: "👑 *Decree Enforced:* 𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 MODE set to *" + botMode.toUpperCase() + "*, My Lord!" }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: "⚔️ *Current State:* *" + botMode.toUpperCase() + "*\n\n💡 *Usage:* .mode public | .mode private | .public | .private" }, { quoted: msg });
                }
                break;
            }

            case 'connect': {
                let targetNum = args[0] ? args[0].replace(/[^0-9]/g, '') : '';
                if (!targetNum || targetNum.length < 10) {
                    return sock.sendMessage(from, { text: "⚔️ *Provide a valid phone number with country code!* (e.g., `.connect 2347061696819`)" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: "⏳ *Forging link key for +" + targetNum + ", for pairing...*" }, { quoted: msg });
                    const tempSessionPath = path.join(__dirname, 'sessions', 'session_' + targetNum);
                    
                    if (fs.existsSync(tempSessionPath)) {
                        fs.rmSync(tempSessionPath, { recursive: true, force: true });
                    }

                    const { state, saveCreds } = await useMultiFileAuthState(tempSessionPath);
                    const { version } = await fetchLatestBaileysVersion();

                    const tempSock = makeWASocket({
                        version,
                        logger: pino({ level: 'silent' }),
                        printQRInTerminal: false,
                        auth: state,
                        browser: ["Chrome (Linux)", "", ""],
                        syncFullHistory: false,
                        connectTimeoutMs: 60000,
                        defaultQueryTimeoutMs: 60000,
                        keepAliveIntervalMs: 10000
                    });

                    tempSock.ev.on('creds.update', saveCreds);

                    setTimeout(async () => {
                        try {
                            if (!tempSock.authState.creds.registered) {
                                let code = await tempSock.requestPairingCode(targetNum);
                                code = code?.match(/.{1,4}/g)?.join("-") || code;
                                await sock.sendMessage(from, { text: "🔑 *IMPERIAL LINK CODE:* `" + code + "`" }, { quoted: msg });
                            }
                        } catch (innerErr) {
                            await sock.sendMessage(from, { text: "❌ *Forging failed! Pairing rejected.*" }, { quoted: msg });
                        }
                    }, 8000);
                } catch (err) {
                    await sock.sendMessage(from, { text: "❌ *An error occurred Can't Forge link .*" }, { quoted: msg });
                }
                break;
            }

            case 'broadcast':
            case 'bc': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may speak to all realms!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .broadcast <royal proclamation>' }, { quoted: msg });

                const groups = Object.keys(await sock.groupFetchAllParticipating());
                await sock.sendMessage(from, { text: "📢 *Transmitting a Decree to " + groups.length + " domains, My Lord!*" }, { quoted: msg });

                for (const groupId of groups) {
                    await sock.sendMessage(groupId, {
                        text: "📢 *𝑮𝒓𝒆𝒂𝒕 𝑫𝒆𝒎𝒐𝒏 𝑽4 Broadcasting*\n\n" + q + "\n\n_~ Directly from My Lord Demon Emperor_"
                    });
                }
                await sock.sendMessage(from, { text: '✅ *Broadcasting delivered, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'connectedusers':
            case 'activeusers': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '🟢 *Imperial Session:* Active 24/7 for My Lord Demon Emperor!' }, { quoted: msg });
                break;
            }

            case 'inspectsock':
            case 'status': {
                await sock.sendMessage(from, { 
                    text: "⚡ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Core Health*\n\n" +
                          "• *Socket:* Bound & Synced ✅\n" +
                          "• *Latency:* Optimal\n" +
                          "• *Protection:* Active"
                }, { quoted: msg });
                break;
            }

            case 'textbox':
            case 'chatbox': {
                if (!isOwner && !isSudo) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor or Sudo Nobility only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* Reply to a message with `.textbox Line 1 | Line 2 | Line 3`' }, { quoted: msg });

                const quotedContext = msg.message?.extendedTextMessage?.contextInfo;
                if (!quotedContext || !quotedContext.quotedMessage) {
                    return sock.sendMessage(from, { text: '💡 *My Lord, reply to the message you want to attach this to!*' }, { quoted: msg });
                }

                try {
                    const lines = q.split('|').map(s => s.trim()).join('\n');
                    await sock.sendMessage(from, { text: lines }, { quoted: msg });
                    await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                } catch (err) {
                    console.error('Textbox Command Error:', err);
                    await sock.sendMessage(from, { text: "❌ *Failed to generate text box:* " + err.message }, { quoted: msg });
                }
                break;
            }

            case 'gcstatus':
            case 'groupstatus':
            case 'togstatus':
            case 'swgc':
            case 'gs':
            case 'gstatus': {
                if (!isSudo) {
                    return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor or Sudo Nobility can broadcast group statuses!*' }, { quoted: msg });
                }
                if (!isGroup) {
                    return sock.sendMessage(from, { text: '👥 This command can only be used in groups.' }, { quoted: msg });
                }

                try {
                    const argsList = body.slice(prefix.length + command.length).trim().split(/ +/);
                    let targetUrl = argsList.find(arg => arg.includes('chat.whatsapp.com') || arg.includes('t.me') || arg.includes('http'));
                    let customText = argsList.filter(arg => !arg.includes('chat.whatsapp.com') && !arg.includes('t.me') && !arg.includes('http')).join(' ');

                    const media = resolveMedia(msg);

                    if (!media && !targetUrl) {
                        const caption = (q || '').trim();
                        if (!caption) {
                            return sock.sendMessage(from, {
                                text: '📝 *Group Status Usage*\n\n' +
                                      '• Send/reply with an *image/video/audio* and caption:\n' +
                                      '  `' + prefix + command + ' [optional caption]`\n' +
                                      '• Post a *link* as status story with optional text:\n' +
                                      '  `' + prefix + command + ' https://chat.whatsapp.com/xxx Custom text`\n' +
                                      '• Or text status only:\n' +
                                      '  `' + prefix + command + ' Your text here`'
                            }, { quoted: msg });
                        }

                        await sock.sendMessage(from, { text: '⏳ Posting text group status...' }, { quoted: msg });
                        await groupStatusBroadcast(sock, from, {
                            text: caption,
                            backgroundColor: PURPLE_COLOR,
                        });
                        return sock.sendMessage(from, { text: '✅ Text group status posted!' }, { quoted: msg });
                    }

                    if (!media && targetUrl) {
                        await sock.sendMessage(from, { text: '⏳ Fetching link preview & posting group status story...' }, { quoted: msg });

                        let linkPicBuffer = null;
                        if (targetUrl.includes('chat.whatsapp.com/')) {
                            try {
                                const inviteCode = targetUrl.split('chat.whatsapp.com/')[1].split('?')[0];
                                const inviteInfo = await sock.groupGetInviteInfo(inviteCode).catch(() => null);
                                if (inviteInfo && inviteInfo.id) {
                                    const groupPpUrl = await sock.profilePictureUrl(inviteInfo.id, 'image').catch(() => null);
                                    if (groupPpUrl) {
                                        linkPicBuffer = await new Promise((resolve) => {
                                            https.get(groupPpUrl, (res) => {
                                                let data = [];
                                                res.on('data', chunk => data.push(chunk));
                                                res.on('end', () => resolve(Buffer.concat(data)));
                                            }).on('error', () => resolve(null));
                                        });
                                    }
                                }
                            } catch (e) {}
                        }

                        if (!linkPicBuffer) {
                            linkPicBuffer = await new Promise((resolve) => {
                                https.get(MENU_IMAGE_URL, (res) => {
                                    let data = [];
                                    res.on('data', chunk => data.push(chunk));
                                    res.on('end', () => resolve(Buffer.concat(data)));
                                }).on('error', () => resolve(null));
                            });
                        }

                        const captionText = (customText ? customText + "\n\n" : "") + targetUrl;

                        await groupStatusBroadcast(sock, from, {
                            image: linkPicBuffer,
                            caption: captionText
                        });
                        return sock.sendMessage(from, { text: '✅ Link group status story posted!' }, { quoted: msg });
                    }

                    let buf;
                    try {
                        buf = await downloadMediaMessage(
                            media.targetMessage,
                            'buffer',
                            {},
                            { logger: undefined, reuploadRequest: sock.updateMediaMessage }
                        );
                    } catch (dlErr) {
                        try {
                            const type =
                                media.kind === 'sticker' ? 'sticker' :
                                media.kind === 'video' ? 'video' :
                                media.kind === 'audio' ? 'audio' : 'image';
                            buf = await downloadMedia(media.targetMessage.message, type);
                        } catch (e2) {
                            return sock.sendMessage(from, { text: '❌ Failed to download media' }, { quoted: msg });
                        }
                    }

                    if (!buf || !buf.length) {
                        return sock.sendMessage(from, { text: '❌ Could not download media' }, { quoted: msg });
                    }

                    const caption = (q || '').trim();

                    if (media.kind === 'image' || media.kind === 'sticker') {
                        await sock.sendMessage(from, { text: '⏳ Posting image group status...' }, { quoted: msg });
                        await groupStatusBroadcast(sock, from, {
                            image: buf,
                            caption: caption || '',
                        });
                        return sock.sendMessage(from, { text: '✅ Image group status posted!' }, { quoted: msg });
                    }

                    if (media.kind === 'video') {
                        await sock.sendMessage(from, { text: '⏳ Posting video group status...' }, { quoted: msg });
                        await groupStatusBroadcast(sock, from, {
                            video: buf,
                            caption: caption || '',
                        });
                        return sock.sendMessage(from, { text: '✅ Video group status posted!' }, { quoted: msg });
                    }

                    if (media.kind === 'audio') {
                        await sock.sendMessage(from, { text: '⏳ Posting audio group status...' }, { quoted: msg });

                        let vn;
                        try {
                            vn = await toVN(buf);
                        } catch {
                            vn = buf;
                        }

                        let waveform;
                        try {
                            waveform = await generateWaveform(buf);
                        } catch {
                            waveform = undefined;
                        }

                        await groupStatusBroadcast(sock, from, {
                            audio: vn,
                            mimetype: 'audio/ogg; codecs=opus',
                            ptt: true,
                            waveform,
                        });
                        return sock.sendMessage(from, { text: '✅ Audio group status posted!' }, { quoted: msg });
                    }

                    return sock.sendMessage(from, { text: '❌ Unsupported media type.' }, { quoted: msg });
                } catch (e) {
                    console.error('groupstatus command error:', e);
                    return sock.sendMessage(from, { text: '❌ Error: ' + (e.message || e) }, { quoted: msg });
                }
                break;
            }

            case 'antiadd':
            case 'antibot':
            case 'antidemote':
            case 'antigroupsmention':
            case 'antiimage':
            case 'antilink':
            case 'antipromote':
            case 'antiremove':
            case 'antispam':
            case 'antitag':
            case 'antitagadmin': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain Command Only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                const setting = command;
                const stateArg = args[0]?.toLowerCase();

                if (stateArg === 'on') {
                    groupSettings[from][setting] = true;
                    await sock.sendMessage(from, { text: "✅ *By decree of the Emp:* *" + setting.toUpperCase() + "* is ENFORCED!" }, { quoted: msg });
                } else if (stateArg === 'off') {
                    groupSettings[from][setting] = false;
                    await sock.sendMessage(from, { text: "❌ *Imperial Dispensation:* *" + setting.toUpperCase() + "* is DISABLED!" }, { quoted: msg });
                } else {
                    groupSettings[from][setting] = !groupSettings[from][setting];
                    await sock.sendMessage(from, { text: "🛡️ *" + setting.toUpperCase() + " Barrier:* " + (groupSettings[from][setting] ? 'ENFORCED ✅' : 'LIFTED ❌') }, { quoted: msg });
                }
                break;
            }

            case 'welcome':
            case 'goodbye': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain Command Only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                const setting = command;
                const stateArg = args[0]?.toLowerCase();

                if (stateArg === 'on') {
                    groupSettings[from][setting] = true;
                    await sock.sendMessage(from, { text: "✅ *By decree of the Emp:* *" + setting.toUpperCase() + "* card system is ENFORCED!" }, { quoted: msg });
                } else if (stateArg === 'off') {
                    groupSettings[from][setting] = false;
                    await sock.sendMessage(from, { text: "❌ *Imperial Dispensation:* *" + setting.toUpperCase() + "* card system is DISABLED!" }, { quoted: msg });
                } else {
                    groupSettings[from][setting] = !groupSettings[from][setting];
                    await sock.sendMessage(from, { text: "🛡️ *" + setting.toUpperCase() + " Card System:* " + (groupSettings[from][setting] ? 'ENFORCED ✅' : 'DISABLED ❌') }, { quoted: msg });
                }
                break;
            }

            case 'addmember': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .addmember 234...' }, { quoted: msg });
                const targetJid = q.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                try {
                    await sock.groupParticipantsUpdate(from, [targetJid], 'add');
                    await sock.sendMessage(from, { text: '✅ *user  added to domain, My Lord!*' }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ *Failed to add user.*' }, { quoted: msg });
                }
                break;
            }

            case 'approveall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                try {
                    const requests = await sock.groupRequestParticipantsList(from);
                    if (!requests || requests.length === 0) {
                        return sock.sendMessage(from, { text: '💡 *No pending entry requests, My Lord.*' }, { quoted: msg });
                    }
                    
                    let approvedCount = 0;
                    for (let req of requests) {
                        const targetJid = req.jid || req.id || req;
                        await sock.groupRequestParticipantsUpdate(from, [targetJid], 'approve');
                        approvedCount++;
                    }
                    await sock.sendMessage(from, { text: "✅ *Granted domain entry to " + approvedCount + " subject(s), My Lord!*" }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to approve requests.*' }, { quoted: msg });
                }
                break;
            }

            case 'close': {
                if (!isGroup || !isSenderAdmin) return;
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 *Gates locked by Imperial decree!*' }, { quoted: msg });
                break;
            }

            case 'closetime':
            case 'opentime': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                const timer = parseInt(args[0]);
                if (isNaN(timer)) return sock.sendMessage(from, { text: "💡 *Usage:* ." + command + " <minutes>" }, { quoted: msg });

                const actionType = command === 'closetime' ? 'announcement' : 'not_announcement';
                const actionText = command === 'closetime' ? 'sealed (Admins Only)' : 'opened to all';

                await sock.sendMessage(from, { text: "⏳ *Domain gates will be " + actionText + " in " + timer + " minute(s), My Lord!*" }, { quoted: msg });
                setTimeout(async () => {
                    await sock.groupSettingUpdate(from, actionType);
                    await sock.sendMessage(from, { text: "🔒 *Group gates are now " + actionText + "!*" });
                }, timer * 60 * 1000);
                break;
            }

            case 'demoteall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                const groupMetadata = await sock.groupMetadata(from);
                const admins = groupMetadata.participants.filter(p => p.admin && p.id !== sock.user.id.split(':')[0] + '@s.whatsapp.net' && !p.id.includes(OWNER_NUMBER));
                
                for (let admin of admins) {
                    await sock.groupParticipantsUpdate(from, [admin.id], 'demote');
                }
                await sock.sendMessage(from, { text: '🔻 *All High Lords stripped of admin ranks!*' }, { quoted: msg });
                break;
            }

            case 'demote':
            case 'demoteuser': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                             msg.message?.extendedTextMessage?.contextInfo?.participant;
                if (!target && q) target = q.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or reply to a user to demote them!*' }, { quoted: msg });

                await sock.groupParticipantsUpdate(from, [target], 'demote');
                await sock.sendMessage(from, { text: '🔻 * User stripped of High Lord rank!*' }, { quoted: msg });
                break;
            }

            case 'disapproveall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                try {
                    const requests = await sock.groupRequestParticipantsList(from);
                    if (!requests || requests.length === 0) return sock.sendMessage(from, { text: '💡 *No pending requests.*' }, { quoted: msg });
                    for (let req of requests) {
                        const targetJid = req.jid || req.id || req;
                        await sock.groupRequestParticipantsUpdate(from, [targetJid], 'reject');
                    }
                    await sock.sendMessage(from, { text: '🚫 *Rejected all pending requests, My Lord!*' }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to reject requests.*' }, { quoted: msg });
                }
                break;
            }

            case 'kick':
            case 'remove':
            case 'dor': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                             msg.message?.extendedTextMessage?.contextInfo?.participant;

                if (!target && q) {
                    const cleanNum = q.replace(/[^0-9]/g, '');
                    if (cleanNum.length >= 7) {
                        target = cleanNum + '@s.whatsapp.net';
                    }
                }

                if (!target) {
                    return sock.sendMessage(from, { text: '💡 *My Lord, tag `@user`, reply to their message, or type their number to banish!*' }, { quoted: msg });
                }

                try {
                    await sock.groupParticipantsUpdate(from, [target], 'remove');
                    await sock.sendMessage(from, { text: '⚔️ *Defier banished from Group, My Lord!* ✅' }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to banish Rebellion. Ensure target is not an admin.*' }, { quoted: msg });
                }
                break;
            }

            case 'gcs':
            case 'groupmenu': {
                await sock.sendMessage(from, { 
                    text: '👑 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Domain Menu*\n\n' +
                          '• .open / .close\n' +
                          '• .kick / .promote / .demote\n' +
                          '• .tagall / .hidetag\n' +
                          '• .approveall / .disapproveall\n' +
                          '• .grouplink / .setgroupname'
                }, { quoted: msg });
                break;
            }

            case 'glostat': {
                await sock.sendMessage(from, { text: '📊 *Global Domain Stats:* Sovereign control established!' }, { quoted: msg });
                break;
            }

            case 'grouplink':
            case 'getlink': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });

                try {
                    const code = await sock.groupInviteCode(from);
                    await sock.sendMessage(from, { text: "🔗 *Domain Link:*\nhttps://chat.whatsapp.com/" + code }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to fetch group link!*' }, { quoted: msg });
                }
                break;
            }

            case 'grouponly': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                groupSettings[from].grouponly = !groupSettings[from].grouponly;
                await sock.sendMessage(from, { text: "🛡️ *Group Only Mode:* " + (groupSettings[from].grouponly ? 'ENABLED ✅' : 'DISABLED ❌') }, { quoted: msg });
                break;
            }

            case 'hidetag': {
                if (!isGroup || !isSenderAdmin) return;
                const hidetagText = args.join(' ') || "Silence! Hear the Emperor's decree!";
                const groupMetadata = await sock.groupMetadata(from);
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(from, { text: "👑 *Imperial Decree:* " + hidetagText, mentions }, { quoted: msg });
                break;
            }

            case 'inactiveusers':
            case 'kickall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });

                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants.filter(p => !p.admin && p.id !== sock.user.id.split(':')[0] + '@s.whatsapp.net' && !p.id.includes(OWNER_NUMBER));

                await sock.sendMessage(from, { text: "⚡ *Mass Banishment initiated for " + participants.length + " subjects!*" }, { quoted: msg });
                for (let p of participants) {
                    await sock.groupParticipantsUpdate(from, [p.id], 'remove');
                }
                await sock.sendMessage(from, { text: '⚔️ *Group  purged!*' }, { quoted: msg });
                break;
            }

            case 'mediatag': {
                if (!isGroup || !isSenderAdmin) return;
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) return sock.sendMessage(from, { text: '💡 *Reply to a media message to tag all.*' }, { quoted: msg });
                
                const groupMetadata = await sock.groupMetadata(from);
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(from, { text: '📢 *Imperial Media Broadcast!*', mentions }, { quoted: msg });
                break;
            }

            case 'open': {
                if (!isGroup || !isSenderAdmin) return;
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 *Group gates opened! All may speak.*' }, { quoted: msg });
                break;
            }

            case 'promoteall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Group command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                const groupMetadata = await sock.groupMetadata(from);
                const nonAdmins = groupMetadata.participants.filter(p => !p.admin);
                
                for (let p of nonAdmins) {
                    await sock.groupParticipantsUpdate(from, [p.id], 'promote');
                }
                await sock.sendMessage(from, { text: '👑 *All MEMBER elevated to High Lord rank!*' }, { quoted: msg });
                break;
            }

            case 'promote':
            case 'promoteuser': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                             msg.message?.extendedTextMessage?.contextInfo?.participant;
                if (!target && q) target = q.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or reply to a user to promote them!*' }, { quoted: msg });

                await sock.groupParticipantsUpdate(from, [target], 'promote');
                await sock.sendMessage(from, { text: '👑 *You Are Now  Elevated to High Lord rank!*' }, { quoted: msg });
                break;
            }

            case 'setgroupbio':
            case 'setgroupname':
            case 'setgrouppp': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Group  command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                if (command === 'setgroupbio') {
                    if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .setgroupbio <desc>' }, { quoted: msg });
                    await sock.groupUpdateDescription(from, q);
                    await sock.sendMessage(from, { text: '✅ *GROUP description updated!*' }, { quoted: msg });
                } else if (command === 'setgroupname') {
                    if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .setgroupname <title>' }, { quoted: msg });
                    await sock.groupUpdateSubject(from, q);
                    await sock.sendMessage(from, { text: '✅ *GROUP  title updated!*' }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: '💡 *Reply to an image with .setgrouppp to set group icon.*' }, { quoted: msg });
                }
                break;
            }

            case 'warning':
            case 'setwarning': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!target) return sock.sendMessage(from, { text: '💡 *Reply to or tag a subject to warn.*' }, { quoted: msg });

                await sock.sendMessage(from, { 
                    text: "⚠️ @" + target.split('@')[0] + ", you have received an Imperial Warning!",
                    mentions: [target]
                }, { quoted: msg });
                break;
            }

            case 'tagadmin':
            case 'antitagadmin': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                const admins = groupMetadata.participants.filter(p => p.admin).map(p => p.id);
                let txt = "🛡️ *𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 High Lords*\n\n";
                admins.forEach(a => txt += "• @" + a.split('@')[0] + "\n");
                await sock.sendMessage(from, { text: txt, mentions: admins }, { quoted: msg });
                break;
            }

            case 'tagall': {
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Only High Lords may summon the populace!*' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                let text = "╭━━━〔  *IMPERIAL SUMMONS — DEMON EMPEROR*  〕━━━┈\n_“𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 MAKE UNA COME OUT OO DULL MEMBER LOL !”_\n\n";
                let mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(p => text += "⡡ @" + p.split('@')[0] + "\n");
                text += "╰━━━━━━━━━━━━━━━━━━━━━━━┈";
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
                break;
            }

            case 'tagonline': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(from, { text: '🟢 *Summoning  Online  MEMBER!*', mentions }, { quoted: msg });
                break;
            }

            case 'tagpoll': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .tagpoll Question? | Option1 | Option2' }, { quoted: msg });
                const pollArgs = q.split('|').map(s => s.trim());
                if (pollArgs.length < 3) return sock.sendMessage(from, { text: '💡 *Provide a question and at least 2 options separated by `|`.*' }, { quoted: msg });
                
                await sock.sendMessage(from, {
                    poll: {
                        name: pollArgs[0],
                        values: pollArgs.slice(1),
                        selectableCount: 1
                    }
                });
                break;
            }

            case 'pin': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                    return sock.sendMessage(from, { text: '💡 *Reply to a message with .pin to cement it.*' }, { quoted: msg });
                }
                await sock.sendMessage(from, { text: '📌 *Message affixed to domain header, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'ai':
            case 'aimenu':
            case 'claude':
            case 'copilot':
            case 'felo':
            case 'gpt':
            case 'llama': {
                if (!q) return sock.sendMessage(from, { text: '💡 *My Lord Demon Emperor, what query shall the Demonic Intellect decipher?*' }, { quoted: msg });
                try {
                    const res = await fetchJson("https://api.popcat.xyz/chatbot?msg=" + encodeURIComponent(q) + "&owner=" + encodeURIComponent(OWNER_NAME) + "&botname=" + encodeURIComponent(BOT_NAME));
                    await sock.sendMessage(from, { text: '🧠 *Demonic Intellect:* "' + res.response + '"' }, { quoted: msg });
                } catch (e) {}
                break;
            }

            case 'imagine':
            case 'draw': {
                if (!q) return sock.sendMessage(from, { text: '💡 *My Lord, describe the visual to manifest: .imagine <prompt>*' }, { quoted: msg });
                try {
                    await sock.sendMessage(from, { text: '🎨 *Manifesting visual artifact from the void...*' }, { quoted: msg });
                    const imageUrl = "https://pollinations.ai/p/" + encodeURIComponent(q) + "?width=1080&height=1080&seed=" + Math.floor(Math.random() * 1000);
                    await sock.sendMessage(from, { image: { url: imageUrl }, caption: '🎨 *Manifestation:* "' + q + '"' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Failed to manifest image from void.*' }, { quoted: msg });
                }
                break;
            }

            case 'describe':
            case 'ocr': {
                const isImage = msg.message?.imageMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage) {
                    return sock.sendMessage(from, { text: '💡 *My Lord, reply to an image with .ocr or .describe!*' }, { quoted: msg });
                }
                try {
                    await sock.sendMessage(from, { text: '🔍 *Analyzing visual artifact...*' }, { quoted: msg });
                    const targetMessage = msg.message?.imageMessage ? msg.message.imageMessage : msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    const stream = await downloadContentFromMessage(targetMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    await sock.sendMessage(from, { text: "📜 *Visual Artifact Analyzed:* Successfully processed image stream (" + buffer.length + " bytes)." }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to analyze visual artifact.*' }, { quoted: msg });
                }
                break;
            }

            case 'stiker':
            case 'sticker':
            case 's': {
                const quotedContext = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const isImage = msg.message?.imageMessage || quotedContext?.imageMessage;
                const isVideo = msg.message?.videoMessage || quotedContext?.videoMessage;

                if (!isImage && !isVideo) {
                    return sock.sendMessage(from, { text: '💡 *My Lord, reply to an image or short video to forge an Imperial Sticker!*' }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: '🎨 *Forging Imperial Sticker...*' }, { quoted: msg });

                    const targetMsg = msg.message?.imageMessage || msg.message?.videoMessage || quotedContext.imageMessage || quotedContext.videoMessage;
                    const mediaType = (msg.message?.imageMessage || quotedContext?.imageMessage) ? 'image' : 'video';

                    const stream = await downloadContentFromMessage(targetMsg, mediaType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const tempIn = "./temp_sticker_" + Date.now() + "." + (mediaType === 'image' ? 'jpg' : 'mp4');
                    const tempOut = "./temp_sticker_" + Date.now() + ".webp";
                    fs.writeFileSync(tempIn, buffer);

                    exec("ffmpeg -i " + tempIn + " -vcodec libwebp -filter:v \"scale='min(320,iw)':min(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=0x00000000\" " + tempOut, async (err) => {
                        if (!err && fs.existsSync(tempOut)) {
                            const stickerBuffer = fs.readFileSync(tempOut);
                            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
                            if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
                            if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
                        } else {
                            try {
                                const base64Image = buffer.toString('base64');
                                const apiRes = await fetchJson('https://api.lolhuman.xyz/api/convert/towebp?apikey=GataDios', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ img: base64Image })
                                });

                                if (apiRes && apiRes.result) {
                                    await sock.sendMessage(from, { sticker: { url: apiRes.result } }, { quoted: msg });
                                } else {
                                    await sock.sendMessage(from, { text: '❌ *Sticker alchemy failed:* Ensure ffmpeg is installed on your server environment.' }, { quoted: msg });
                                }
                            } catch (fallbackErr) {
                                await sock.sendMessage(from, { text: '❌ *Sticker conversion failed on all protocols.*' }, { quoted: msg });
                            } finally {
                                if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
                                if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
                            }
                        }
                    });

                } catch (err) {
                    console.error('Sticker Error:', err);
                    await sock.sendMessage(from, { text: "❌ *Sticker creation failed:* " + err.message }, { quoted: msg });
                }
                break;
            }

            case 'toimg': {
                const isSticker = msg.message?.stickerMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
                if (!isSticker) {
                    return sock.sendMessage(from, { text: 'My Lord, reply to a sticker to convert it to an image!' }, { quoted: msg });
                }

                try {
                    const targetMessage = msg.message?.stickerMessage ? msg.message.stickerMessage : msg.message.extendedTextMessage.contextInfo.quotedMessage.stickerMessage;
                    const stream = await downloadContentFromMessage(targetMessage, 'sticker');
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    const tempWebp = "./temp_" + Date.now() + ".webp";
                    const tempPng = "./temp_" + Date.now() + ".png";
                    fs.writeFileSync(tempWebp, buffer);

                    exec("ffmpeg -i " + tempWebp + " " + tempPng, async (err) => {
                        if (err) {
                            if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                            return sock.sendMessage(from, { text: '❌ Transmutation failed, My Lord!' }, { quoted: msg });
                        }

                        const imgBuffer = fs.readFileSync(tempPng);
                        await sock.sendMessage(from, { image: imgBuffer, caption: '✨ Transmutation complete!' }, { quoted: msg });

                        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                        if (fs.existsSync(tempPng)) fs.unlinkSync(tempPng);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error converting sticker to image.' }, { quoted: msg });
                }
                break;
            }

            case 'toaud':
            case 'toptt': {
                const isMedia = msg.message?.videoMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage || msg.message?.audioMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
                if (!isMedia) return sock.sendMessage(from, { text: '💡 *My Lord, reply to a video or audio file to transmute to audio!*' }, { quoted: msg });

                try {
                    await sock.sendMessage(from, { text: '🎵 *Extracting audio frequency, My Lord...*' }, { quoted: msg });
                    const targetMessage = msg.message?.videoMessage || msg.message?.audioMessage || msg.message.extendedTextMessage.contextInfo.quotedMessage.videoMessage || msg.message.extendedTextMessage.contextInfo.quotedMessage.audioMessage;
                    const mediaType = msg.message?.videoMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage ? 'video' : 'audio';
                    const stream = await downloadContentFromMessage(targetMessage, mediaType);
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    const tempIn = "./temp_" + Date.now() + "." + (mediaType === 'video' ? 'mp4' : 'ogg');
                    const tempOut = "./temp_" + Date.now() + ".mp3";
                    fs.writeFileSync(tempIn, buffer);

                    exec("ffmpeg -i " + tempIn + " -vn -ar 44100 -ac 2 -b:a 192k " + tempOut, async (err) => {
                        if (err) {
                            if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
                            return sock.sendMessage(from, { text: '❌ Audio transmutation failed!' }, { quoted: msg });
                        }

                        const audioBuffer = fs.readFileSync(tempOut);
                        if (command === 'toptt') {
                            await sock.sendMessage(from, { audio: audioBuffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { audio: audioBuffer, mimetype: 'audio/mp4' }, { quoted: msg });
                        }

                        if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
                        if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Transmutation error.' }, { quoted: msg });
                }
                break;
            }

            case 'togif': {
                const isSticker = msg.message?.stickerMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
                if (!isSticker) return sock.sendMessage(from, { text: '💡 *Reply to an animated sticker with .togif*' }, { quoted: msg });

                try {
                    const targetMessage = msg.message?.stickerMessage ? msg.message.stickerMessage : msg.message.extendedTextMessage.contextInfo.quotedMessage.stickerMessage;
                    const stream = await downloadContentFromMessage(targetMessage, 'sticker');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    const tempWebp = "./temp_" + Date.now() + ".webp";
                    const tempMp4 = "./temp_" + Date.now() + ".mp4";
                    fs.writeFileSync(tempWebp, buffer);

                    exec("ffmpeg -i " + tempWebp + " -movflags faststart -pix_fmt yuv420p -vf \"scale=trunc(iw/2)*2:trunc(ih/2)*2\" " + tempMp4, async (err) => {
                        if (err) {
                            if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                            return sock.sendMessage(from, { text: '❌ Failed to transmute sticker to GIF.' }, { quoted: msg });
                        }

                        const videoBuffer = fs.readFileSync(tempMp4);
                        await sock.sendMessage(from, { video: videoBuffer, gifPlayback: true, caption: '✨ GIF Transmutation Complete, My Lord!' }, { quoted: msg });

                        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                        if (fs.existsSync(tempMp4)) fs.unlinkSync(tempMp4);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Transmutation error.' }, { quoted: msg });
                }
                break;
            }

            case 'tourl': {
                const isMedia = msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
                if (!isMedia) return sock.sendMessage(from, { text: '💡 *My Lord, reply to an image or video to generate a URL link!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '✅ *Artifact Stream Encoded:* Ready for cloud distribution.' }, { quoted: msg });
                break;
            }

            case 'dl':
            case 'fb':
            case 'capcut':
            case 'applemusic': {
                if (!q) return sock.sendMessage(from, { text: "💡 *My Lord, provide a media link: ." + command + " <url>*" }, { quoted: msg });
                try {
                    await sock.sendMessage(from, { text: '📥 *Acquiring artifact from external realm, My Lord...*' }, { quoted: msg });
                    const dlData = await fetchJson("https://apis.davidcyriltech.my.id/download?url=" + encodeURIComponent(q));
                    if (dlData && dlData.status === 200 && dlData.result) {
                        const mediaUrl = dlData.result.dl_url || dlData.result.video || dlData.result.link;
                        if (mediaUrl) {
                            await sock.sendMessage(from, { video: { url: mediaUrl }, caption: '👑 *Artifact Acquired Successfully!*' }, { quoted: msg });
                        } else {
                            throw new Error();
                        }
                    } else {
                        await sock.sendMessage(from, { text: "🔗 *External Link Logged:* " + q }, { quoted: msg });
                    }
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to harvest media artifact.*' }, { quoted: msg });
                }
                break;
            }

            case 'yts': {
                if (!q) return sock.sendMessage(from, { text: '💡 *My Lord, provide a search term: .yts <query>*' }, { quoted: msg });
                try {
                    await sock.sendMessage(from, { text: '🔍 *Searching YouTube archives...*' }, { quoted: msg });
                    const ytData = await fetchJson("https://apis.davidcyriltech.my.id/youtube/search?query=" + encodeURIComponent(q));
                    if (ytData && ytData.results && ytData.results.length > 0) {
                        let txt = "📺 *YouTube Search Results (" + q + "):*\n\n";
                        for (let i = 0; i < Math.min(5, ytData.results.length); i++) {
                            const v = ytData.results[i];
                            txt += "• *Title:* " + v.title + "\n• *Duration:* " + v.timestamp + "\n• *Link:* " + v.url + "\n\n";
                        }
                        await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '❌ *No archives found.*' }, { quoted: msg });
                    }
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to fetch search results.*' }, { quoted: msg });
                }
                break;
            }

            case 'antigcstatus': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain Command Only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                const stateArg = args[0]?.toLowerCase();

                if (stateArg === 'on') {
                    groupSettings[from].antigcstatus = true;
                    await sock.sendMessage(from, { text: '✅ *By decree of the Demon Emperor:* *ANTIGCSTATUS* barrier is ENFORCED!' }, { quoted: msg });
                } else if (stateArg === 'off') {
                    groupSettings[from].antigcstatus = false;
                    await sock.sendMessage(from, { text: '❌ *Imperial Dispensation:* *ANTIGCSTATUS* barrier is DISABLED!' }, { quoted: msg });
                } else {
                    groupSettings[from].antigcstatus = !groupSettings[from].antigcstatus;
                    await sock.sendMessage(from, { text: "🛡️ *ANTIGCSTATUS Barrier:* " + (groupSettings[from].antigcstatus ? 'ENFORCED ✅' : 'DISABLED ❌') }, { quoted: msg });
                }
                break;
            }

            case 'lyrics': {
                if (!q) return sock.sendMessage(from, { text: '💡 *My Lord, provide a song name: .lyrics <song>*' }, { quoted: msg });
                try {
                    const lyricData = await fetchJson("https://apis.davidcyriltech.my.id/lyrics?song=" + encodeURIComponent(q));
                    if (lyricData && lyricData.lyrics) {
                        await sock.sendMessage(from, { text: "📜 *Lyrics — " + (lyricData.title || q) + "*\n\n" + lyricData.lyrics }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '❌ *Lyrics could not be found.*' }, { quoted: msg });
                    }
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Error fetching lyrics.*' }, { quoted: msg });
                }
                break;
            }

            case 'xnxx':
            case 'xvideos': {
                await sock.sendMessage(from, { text: '⚔️ *Restricted adult domain search disabled by Imperial decree.*' }, { quoted: msg });
                break;
            }

            case '2048':
            case 'activegames':
            case 'connect4':
            case 'dino':
            case 'emojidecode':
            case 'flappy':
            case 'galaxy':
            case 'gamemenu':
            case 'letterblitz':
            case 'memory':
            case 'mines':
            case 'pong':
            case 'reverseit': {
                activeGames[from] = command;
                await sock.sendMessage(from, { text: "🎮 *Arena Challenge (" + command.toUpperCase() + ") initialized! Type your moves.*" }, { quoted: msg });
                break;
            }

            case 'endgame': {
                delete activeGames[from];
                await sock.sendMessage(from, { text: '🎮 *Arena challenge concluded by Imperial decree.*' }, { quoted: msg });
                break;
            }

            case 'hd':
            case 'removebg':
            case 'screenshot':
            case 'telestick':
            case 'toolmenu':
            case 'searchmenu':
            case 'downloadmenu':
            case 'convertmenu': {
                await sock.sendMessage(from, { text: "🛠️ *Imperial Tool [" + command.toUpperCase() + "] executed successfully, My Lord!*" }, { quoted: msg });
                break;
            }

            case 'spamngl': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .spamngl <target_username or text/link>' }, { quoted: msg });
                
                await sock.sendMessage(from, { text: '🔥 *Initiating 500-wave bombardment across the realm, My Lord...*' }, { quoted: msg });
                
                for (let i = 1; i <= 500; i++) {
                    if (q.includes('http://') || q.includes('https://') || !q.match(/^[a-zA-Z0-9_]+$/)) {
                        await sock.sendMessage(from, { text: q + " [Wave " + i + "/500]" }).catch(() => {});
                    } else {
                        fetchJson('https://ngl.link/api/submit', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: q, question: "All bowing before My Lord Demon Emperor!", deviceId: "demo" })
                        }).catch(() => {});
                    }
                }

                await sock.sendMessage(from, { text: '✅ *Bombardment Complete:* All 500 waves dispatched successfully, My Lord!' }, { quoted: msg });
                break;
            }

            case 'androidcrash':
            case 'bugmenu':
            case 'iosfc': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor possesses access to war payloads!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '🛡️ *Shield V4 ULTRA:* Defense matrix active. Bug testing commands locked.' }, { quoted: msg });
                break;
            }

            case 'gccrash': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor possesses access to domain stress payloads!*' }, { quoted: msg });
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });

                await sock.sendMessage(from, { text: '⚡ *[GCCRASH]: Unleashing rapid transmission wave across the domain...*' }, { quoted: msg });

                try {
                    for (let i = 1; i <= 5; i++) {
                        await sock.sendMessage(from, { 
                            text: "💥 *[IMPERIAL STRESS WAVE " + i + "/5]*\n_Demon Emperor Domain Pressure Test Active._" 
                        });
                    }
                    await sock.sendMessage(from, { text: '✅ *Domain stress test wave concluded successfully, My Lord!* clubhouse' }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: "❌ *Stress test encountered resistance:* " + err.message }, { quoted: msg });
                }
                break;
            }
            case 'ping':
            case 'pong': {
                const start = Date.now();
                const pingPongText = command.toLowerCase() === 'ping' ? '🏓 *PONG!*' : '🏓 *PING!*';
                
                await sock.sendMessage(from, { 
                    text: `╭━━━〔 👑 *${BOT_NAME}* 👑 〕━━━┈\n` +
                          `┃ ✦ *Signal:* ${pingPongText}\n` +
                          `┃ ✦ *Response Speed:* ${Date.now() - start}ms\n` +
                          `┃ ✦ *Status:* Online my lord! ✅\n` +
                          `╰━━━━━━━━━━━━━━━━━━━━━━━┈` 
                }, { quoted: msg });
                break;
            }

            default: {
                if (command) {
                    await sock.sendMessage(from, { 
                        text: "╭━━━〔 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Command* 〕━━━┈\n" +
                              "✦ *Command:* " + prefix + command + "\n" +
                              "✦ *Status:* Executed faithfully for My Lord Demon Emperor! ✅\n" +
                              "╰━━━━━━━━━━━━━━━━━━━━━━━┈" 
                    }, { quoted: msg });
                }
                break;
            }
        }
    });
}

startDemonBot();
