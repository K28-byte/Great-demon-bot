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

// --- TELEGRAM CONFIGURATION & HANDLERS ---
const TelegramBot = require('node-telegram-bot-api');
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || ''; 
const tgBot = new TelegramBot(TG_BOT_TOKEN, { 
    polling: {
        interval: 2000,
        autoStart: true,
        params: { timeout: 10 }
    }
});

tgBot.on('polling_error', (error) => {
    if (error.code !== 'ETELEGRAM' || !error.message.includes('409 Conflict')) {
        console.error('Telegram Polling Error:', error.code);
    }
});

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

// --- RENDER-OPTIMIZED STABLE TELEGRAM PAIRING HANDLER ---
async function handlePairingProcess(chatId, targetNum, messageIdToEdit = null) {
    try {
        let statusMsg;
        if (messageIdToEdit) {
            await tgBot.editMessageText(`⏳ *Opening secure tunnel for +${targetNum}...*`, {
                chat_id: chatId,
                message_id: messageIdToEdit,
                parse_mode: 'Markdown'
            });
            statusMsg = { message_id: messageIdToEdit };
        } else {
            statusMsg = await tgBot.sendMessage(chatId, `⏳ *Opening secure tunnel for +${targetNum}, please wait...*`, { parse_mode: 'Markdown' });
        }

        const tempSessionPath = path.join(__dirname, 'demon_session');
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
            browser: ["Ubuntu", "Chrome", "20.0.00"],
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 15000,
            generateHighQualityLinkPreview: false
        });

        tempSock.ev.on('creds.update', saveCreds);

        let codeRequested = false;

        tempSock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                await tgBot.editMessageText(`✅ *WhatsApp Connected Successfully via Telegram!*\n\n📱 *Number:* +${targetNum}`, {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'Markdown'
                });
                setTimeout(() => {
                    startDemonBot(); 
                }, 2000);
            }
        });

        // 🛡️ RENDER FIX: Wait a stable 4 seconds for the cloud WebSocket tunnel to fully open before pulling pairing code
        setTimeout(async () => {
            if (!tempSock.authState.creds.registered && !codeRequested) {
                codeRequested = true;
                try {
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

                    await tgBot.editMessageText(`🔑 *IMPERIAL LINK CODE:* \`${code}\`\n\n⏰ *Ready on Render. Enter this code into WhatsApp now.*`, opts);
                } catch (innerErr) {
                    await tgBot.editMessageText(`❌ *Pairing seal rejected:* ${innerErr.message}`, {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'Markdown'
                    });
                }
            }
        }, 4000);

    } catch (err) {
        await tgBot.sendMessage(chatId, `❌ *An error occurred during setup:* ${err.message}`, { parse_mode: 'Markdown' });
    }
}

tgBot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data.startsWith('recode_')) {
        const targetNum = data.split('_')[1];
        await tgBot.answerCallbackQuery(query.id, { text: "🔄 Generating a fresh code..." });
        await handlePairingProcess(chatId, targetNum, messageId);
    }
});

async function startDemonBot() {
    const sessionPath = './demon_session';

    if (process.env.SESSION_ID && process.env.SESSION_ID.trim().length > 20) {
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
        try {
            const rawId = process.env.SESSION_ID.trim().replace(/^GREAT_DEMON_/, '');
            const decodedCreds = Buffer.from(rawId, 'base64').toString('utf-8');
            fs.writeFileSync(path.join(sessionPath, 'creds.json'), decodedCreds);
            console.log('✅ Imperial Session successfully restored from SESSION_ID!');
        } catch (err) {
            console.log('❌ Failed to decode SESSION_ID:', err.message);
        }
    }

    if (!fs.existsSync(path.join(sessionPath, 'creds.json'))) {
        console.log('⏳ Waiting for pairing... Use Telegram /connect command to generate session credentials.');
        return;
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.00"],
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
                console.log('❌ Session logged out from WhatsApp servers. Please re-pair via Telegram.');
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

    // --- WELCOME & GOODBYE EVENT LISTENER ---
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

        if (autoSettings.autoreact && msg.message && !msg.key.fromMe) {
            try {
                const emojis = ['🔥', '⚡', '💀', '👑', '🖤', '⚔️', '⭐'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await sock.sendMessage(from, { 
                    react: { text: randomEmoji, key: msg.key } 
                });
            } catch (e) {}
        }

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
"┃ 🛡️ *IDENTITY:* 𝐰𝐡𝐲 𝐚𝐥w𝐚𝐲𝐬 𝐊𝐞𝐥𝐯𝐢𝐧\n" +
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
                        text: "╭━━━〔 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝕻𝖊𝖗𝖔𝖗 Command* 〕━━━┈\n" +
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
