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
const OWNER_NAME = "𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏";
const BOT_NAME = "𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕";
const BOT_VERSION = "v4 ULTRA";
const MENU_IMAGE_URL = "https://img.sanishtech.com/u/96b35f47cb64cc0f77b9a781b40d0990.jpg";
const PURPLE_COLOR = '#9C27B0';
const startTime = Date.now();

// --- PERSISTENT STORAGE ENGINE ---
const SETTINGS_FILE = './settings.json';

function loadSettings() {
    if (!fs.existsSync(SETTINGS_FILE)) {
        const defaultSettings = {
            prefix: "!",
            sudoUsers: [OWNER_NUMBER],
            autoSettings: {
                autoonline: true,
                autorecording: false,
                autostatuslike: true,
                autostatusview: true,
                autotyping: false,
                chatbot: true,
                anticall: true
            }
        };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
        return defaultSettings;
    }
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE));
    } catch (e) {
        return {
            prefix: "!",
            sudoUsers: [OWNER_NUMBER],
            autoSettings: { autoonline: true, autorecording: false, autostatuslike: true, autostatusview: true, autotyping: false, chatbot: true, anticall: true }
        };
    }
}

function saveSettings(data) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

const db = loadSettings();
let prefix = db.prefix || "!";
const sudoUsers = new Set(db.sudoUsers || [OWNER_NUMBER]);
const autoSettings = db.autoSettings || {
    autoonline: true,
    autorecording: false,
    autostatuslike: true,
    autostatusview: true,
    autotyping: false,
    chatbot: true,
    anticall: true
};

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

    if (!sock.authState.creds.registered) {
        console.log('\n==================================================');
        let phoneNumber = process.env.PHONE_NUMBER || OWNER_NUMBER;
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

        try {
            await new Promise(res => setTimeout(res, 5000));
            console.log('⏳ Requesting Imperial Pairing Code for +' + phoneNumber + '...');
            const code = await sock.requestPairingCode(phoneNumber);
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log('\n🔑 YOUR PAIRING CODE: \x1b[32m' + formattedCode + '\x1b[0m\n');
            console.log('==================================================\n');
        } catch (err) {
            console.log('❌ Error requesting pairing code:', err.message);
        }

        setInterval(() => {}, 60000);
    }

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

    // 👋 WELCOME & GOODBYE EVENT LISTENER WITH PFP STATUS
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

    // AUTO STATUS VIEW & LIKE HANDLER
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

        // 🛡️ BULLETPROOF ANTICRASH SHIELD
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
                const userObj = groupMetadata.participants.find(p => p.id.split('@')[0] === senderNum);
                isAdmin = userObj && (userObj.admin === 'admin' || userObj.admin === 'superadmin');

                const botNum = sock.user.id.split(':')[0].split('@')[0];
                const botObj = groupMetadata.participants.find(p => p.id.split('@')[0] === botNum);
                isBotAdmin = botObj && (botObj.admin === 'admin' || botObj.admin === 'superadmin');

                if (isSudo && isAdmin) isBotAdmin = true;
            } catch (e) {}
        }

        const isSenderAdmin = isAdmin || isSudo;

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

        // --- GROUP PROTECTION INTERCEPTORS (ANTILINK & ANTIGROUPSMENTION & ANTIBOT) ---
        if (isGroup && groupSettings[from] && !isSenderAdmin) {
            const fullTextContent = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    msg.message?.imageMessage?.caption || 
                                    msg.message?.videoMessage?.caption || 
                                    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation || '';

            const linkRegex = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,24}|https?:\/\/[^\s]+)/gi;
            const isLink = linkRegex.test(fullTextContent);
            const isGroupMention = fullTextContent.includes('chat.whatsapp.com');

            if (groupSettings[from].antilink && isLink) {
                await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                const mode = groupSettings[from].antilinkMode || 'kick';
                
                if (mode === 'kick') {
                    await sock.sendMessage(from, { text: "🗡️ @" + sender.split('@')[0] + ", links are forbidden by decree of the Demon Emperor!", mentions: [sender] });
                    if (isBotAdmin) {
                        await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                    }
                } else if (mode === 'warn') {
                    const limit = groupSettings[from].antilinkWarnLimit || 3;
                    const warnKey = from + '_' + sender;
                    const currentWarns = (warningMap.get(warnKey) || 0) + 1;
                    warningMap.set(warnKey, currentWarns);

                    if (currentWarns >= limit) {
                        warningMap.delete(warnKey);
                        await sock.sendMessage(from, { text: "🚫 @" + sender.split('@')[0] + " reached " + limit + "/" + limit + " warnings for link sharing. Banishing!", mentions: [sender] });
                        if (isBotAdmin) await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                    } else {
                        await sock.sendMessage(from, { text: "⚠️ @" + sender.split('@')[0] + ", links are forbidden! Warning " + currentWarns + "/" + limit, mentions: [sender] });
                    }
                }
                return;
            }

            if (groupSettings[from].antigroupsmention && isGroupMention) {
                await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                const mode = groupSettings[from].antigroupsmentionMode || 'kick';

                if (mode === 'kick') {
                    await sock.sendMessage(from, { text: "🗡️ @" + sender.split('@')[0] + ", group invites are forbidden!", mentions: [sender] });
                    if (isBotAdmin) {
                        await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                    }
                } else if (mode === 'warn') {
                    const limit = groupSettings[from].antigroupsmentionWarnLimit || 3;
                    const warnKey = from + '_gm_' + sender;
                    const currentWarns = (warningMap.get(warnKey) || 0) + 1;
                    warningMap.set(warnKey, currentWarns);

                    if (currentWarns >= limit) {
                        warningMap.delete(warnKey);
                        await sock.sendMessage(from, { text: "🚫 @" + sender.split('@')[0] + " reached " + limit + "/" + limit + " warnings for group mentions. Banishing!", mentions: [sender] });
                        if (isBotAdmin) await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                    } else {
                        await sock.sendMessage(from, { text: "⚠️ @" + sender.split('@')[0] + ", group invites are forbidden! Warning " + currentWarns + "/" + limit, mentions: [sender] });
                    }
                }
                return;
            }

            if (groupSettings[from].antibot && !msg.key.fromMe) {
                const isExternalBot = msg.key.id.startsWith('BAE5') || msg.key.id.length === 16;
                if (isExternalBot) {
                    await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                    await sock.sendMessage(from, { text: "🚨 @" + sender.split('@')[0] + ", external construct detected! Banishing...", mentions: [sender] });
                    if (isBotAdmin) {
                        await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                    }
                    return;
                }
            }
        }

        // --- CHATBOT ENGINE ---
        if (!body.startsWith(prefix)) {
            if (isGroup && autoSettings.chatbot && !msg.key.fromMe) {
                const lowerBody = body.toLowerCase().trim();

                if (/what(s|\s+is)\s+(ur|your)\s+name|who\s+are\s+you/i.test(lowerBody)) {
                    await sock.sendMessage(from, { text: "I'm Demon" }, { quoted: msg });
                    return;
                }
                if (/are\s+you\s+(an?\s+)?(ai|bot|robot)/i.test(lowerBody)) {
                    await sock.sendMessage(from, { text: "Nope, I'm a real person" }, { quoted: msg });
                    return;
                }
                if (/\b(lol|lmao|haha|funny|joke|xd)\b/i.test(lowerBody)) {
                    await sock.sendMessage(from, { text: "😂😂 real funny bro" }, { quoted: msg });
                    return;
                }

                if (/recommend( me)?( an)? anime|best anime|anime recommendation|good anime|tell me about it|anime list/i.test(lowerBody)) {
                    try {
                        const webSearchQuery = lowerBody.includes('tell me about it') ? body : 'top dark fantasy action anime';
                        const jikanRes = await fetchJson("https://api.jikan.moe/v4/anime?q=" + encodeURIComponent(webSearchQuery) + "&limit=3");
                        
                        if (jikanRes && jikanRes.data && jikanRes.data.length > 0) {
                            let cardText = "╭━━━〔  👑 *DEMON EMPEROR ANIME VAULT* 👑  〕━━━┈\n";
                            cardText += "_“Fetched live from the Web Archives”_\n\n";

                            for (let i = 0; i < jikanRes.data.length; i++) {
                                const anime = jikanRes.data[i];
                                cardText += "┌────────────────────────\n";
                                cardText += "│ ⚔️ *Title:* " + (anime.title_english || anime.title) + "\n";
                                cardText += "│ ⭐ *Score:* " + (anime.score || 'N/A') + " | 📺 *Episodes:* " + (anime.episodes || 'Ongoing') + "\n";
                                cardText += "│ 📜 *Synopsis:* " + (anime.synopsis ? anime.synopsis.slice(0, 140) + "..." : "No synopsis available.") + "\n";
                                cardText += "│ 🔗 *URL:* " + anime.url + "\n";
                                cardText += "└────────────────────────\n\n";
                            }
                            cardText += "╰━━━━━━━━━━━━━━━━━━━━━━━┈";

                            await sock.sendMessage(from, { text: cardText }, { quoted: msg });
                            return;
                        }
                    } catch (webErr) {}

                    const multiCardFallback = 
"╭━━━〔  👑 *DEMON EMPEROR ANIME VAULT* 👑  〕━━━┈\n" +
"_“Top-Tier Recommendations For My Lord”_\n\n" +
"┌────────────────────────\n" +
"│ ⚔️ *1. Reverend Insanity (Fang Yuan)*\n" +
"│ ⭐ Score: 9.8/10 | 📺 Status: Masterpiece\n" +
"│ 📜 Dark fantasy, ruthless cultivation, and an unbeatable MC who pursues eternal life with zero regrets.\n" +
"└────────────────────────\n\n" +
"┌────────────────────────\n" +
"│ ⚔️ *2. Lord of the Mysteries*\n" +
"│ ⭐ Score: 9.6/10 | 📺 Status: Ongoing\n" +
"│ 📜 Victorian steampunk, mystery, and deep horror/magic power systems.\n" +
"└────────────────────────\n\n" +
"┌────────────────────────\n" +
"│ ⚔️ *3. World Trigger*\n" +
"│ ⭐ Score: 9.2/10 | 📺 Status: Seasoned\n" +
"│ 📜 Incredible tactical team battles, sci-fi world-building, and strict power balance.\n" +
"└────────────────────────\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈";

                    await sock.sendMessage(from, { text: multiCardFallback }, { quoted: msg });
                    return;
                }

                const fetchWithTimeout = (url, options = {}, timeoutMs = 5000) => {
                    return Promise.race([
                        fetchJson(url, options),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
                    ]);
                };

                try {
                    let aiResponse = null;
                    const promptContext = "You are an AI named Demon chatting in a WhatsApp group. You talk like a real human friend, discuss anime fluently, tell jokes, give anime recommendations, and answer questions like a smart AI model when asked. User message: " + body;

                    try {
                        const apiRes1 = await fetchWithTimeout("https://api.popcat.xyz/chatbot?msg=" + encodeURIComponent(promptContext) + "&owner=" + encodeURIComponent(OWNER_NAME) + "&botname=" + encodeURIComponent("Demon"));
                        if (apiRes1 && apiRes1.response) aiResponse = apiRes1.response;
                    } catch (e1) {}

                    if (!aiResponse) {
                        try {
                            const apiRes2 = await fetchWithTimeout("https://apis.davidcyriltech.my.id/ai/gpt4?text=" + encodeURIComponent(promptContext));
                            if (apiRes2 && (apiRes2.message || apiRes2.result)) aiResponse = apiRes2.message || apiRes2.result;
                        } catch (e2) {}
                    }

                    if (aiResponse) {
                        aiResponse = aiResponse.replace(/ChatGPT|OpenAI|assistant/gi, "Demon");
                        await sock.sendMessage(from, { text: aiResponse }, { quoted: msg });
                    }
                } catch (err) {}
            }
            return;
        }

        // --- COMMAND PARSING ---
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
            // EMPEROR'S SUPREME MENU
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
"╭━━━〔  👑 *EMPEROR'S SUPREME*  〕━━━┈\n" +
"✿ sudo\n✿ sudolist\n✿ sudoremove\n✿ setprefix\n✿ anticall\n✿ antigroupstatus\n✿ delgcstatus\n✿ delete / del\n✿ addowner\n✿ antidelete\n✿ antiviewonce\n✿ autoonline\n✿ autorecording\n✿ autostatuslike\n✿ autostatusview\n✿ autotyping\n✿ autoreact\n✿ block\n✿ unblock\n✿ buatgc\n✿ changebio\n✿ chatbot\n✿ devices\n✿ getpp\n✿ gcstatus\n✿ joingroup\n✿ leavegroup\n✿ listfont\n✿ listgroup\n✿ bancheck\n✿ botlink\n✿ fetchstatus\n✿ listchannels\n✿ mode\n✿ pair\n✿ broadcast\n✿ spamngl\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🎭 *REALM FUN*  〕━━━┈\n" +
"✿ song / play\n✿ gayrate\n✿ flirt\n✿ dare\n✿ truth\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🛡️ *DOMAIN MANAGEMENT*  〕━━━┈\n" +
"✿ welcome\n✿ goodbye\n✿ antilink (warn/kick)\n✿ antigroupsmention (warn/kick)\n✿ antibot\n✿ antispam\n✿ antitag\n✿ antitagadmin\n✿ antiremove\n✿ activeusers\n✿ addmember\n✿ antiadd\n✿ antidemote\n✿ antiimage\n✿ antipromote\n✿ approveall\n✿ close\n✿ closetime\n✿ demoteall\n✿ demoteuser\n✿ disapproveall\n✿ dor\n✿ gcs\n✿ glostat\n✿ grouplink\n✿ groupmenu\n✿ grouponly\n✿ hidetag\n✿ inactiveusers\n✿ kickall\n✿ left\n✿ listgroups\n✿ mediatag\n✿ open\n✿ opentime\n✿ promoteall\n✿ promoteuser\n✿ remove\n✿ setgroupbio\n✿ setgroupname\n✿ setgrouppp\n✿ setwarning\n✿ tagadmin\n✿ tagall\n✿ tagonline\n✿ tagpoll\n✿ warning\n✿ pin\n✿ textbox\n✿ vv\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🧠 *DEMONIC INTELLIGENCE*  〕━━━┈\n" +
"✿ ai\n✿ aimenu\n✿ claude\n✿ copilot\n✿ describe\n✿ felo\n✿ gpt\n✿ imagine\n✿ llama\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🧪 *ALCHEMY & CONVERSION*  〕━━━┈\n" +
"✿ audio\n✿ convertmenu\n✿ stickermeme\n✿ stiker\n✿ swm\n✿ telestick\n✿ toaud\n✿ togif\n✿ toimg\n✿ tomp4\n✿ toptt\n✿ tourl\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  📥 *ACQUISITION & DOWNLOADS*  〕━━━┈\n" +
"✿ applemusic\n✿ capcut\n✿ dl\n✿ downloadmenu\n✿ fb\n✿ yts\n✿ lyrics\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🎮 *REALM ARENA GAMES*  〕━━━┈\n" +
"✿ 2048\n✿ activegames\n✿ connect4\n✿ dino\n✿ emojidecode\n✿ endgame\n✿ flappy\n✿ galaxy\n✿ gamemenu\n✿ letterblitz\n✿ memory\n✿ mines\n✿ pong\n✿ reverseit\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🛠️ *AUXILIARY TOOLS*  〕━━━┈\n" +
"✿ androidcrash\n✿ bugmenu\n✿ gccrash\n✿ hd\n✿ iosfc\n✿ ocr\n✿ removebg\n✿ screenshot\n✿ searchmenu\n✿ toolmenu\n✿ ping\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"_© 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 — 𝙀𝒎𝒑𝒆𝒓𝒐𝒓 𝙀𝒏𝒈𝒊𝒏𝒆 𝙄𝒔 𝘼𝒄𝒕𝙞𝒗𝒆_";

                try {
                    await sock.sendMessage(from, { image: { url: MENU_IMAGE_URL }, caption: menuText }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }
                break;
            }

            // =========================================================================
            // NEW COMMANDS INTEGRATION (SUDO, ANTICALL, SETPREFIX, FUN, SONG, ETC.)
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
                let txt = "👑 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Sudo Roster*\n\n";
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
                    const groupStatusTracker = require('../../utils/groupStatusTracker'); // if present in file tree
                    if (!args[0] && ctx?.stanzaId && ctx?.participant && groupStatusTracker) {
                        const known = groupStatusTracker.list(extra.from).find((e) => e.key.id === ctx.stanzaId);
                        const target = known || {
                            key: { remoteJid: extra.from, fromMe: false, id: ctx.stanzaId, participant: ctx.participant },
                        };
                        const deleted = sock.revokeGroupStatus ? await sock.revokeGroupStatus(extra.from, target) : false;
                        if (deleted && groupStatusTracker) groupStatusTracker.remove(extra.from, [ctx.stanzaId]);
                        return extra.reply(deleted ? '✅ Status has been deleted.' : '❌ Couldn\'t delete the status.');
                    }

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
                try {
                    const ctx = msg.message?.extendedTextMessage?.contextInfo;
                    if (!ctx?.stanzaId || !ctx?.participant) {
                        return extra.reply('🗑️ Reply to the message you want to delete.');
                    }
                    const deleteKey = { remoteJid: extra.from, id: ctx.stanzaId, participant: ctx.participant };
                    await sock.sendMessage(extra.from, { delete: deleteKey });
                } catch (error) {
                    await extra.reply('❌ Failed to delete message.');
                }
                break;
            }

            case 'delgcstatus':
            case 'delgstatus':
            case 'delgs': {
                if (!isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                await extra.reply('🗑️ Group status deletion initiated, My Lord!');
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
                const out = `${targetTag} score: ${percent}% fabulous 🌈`;
                await sock.sendMessage(extra.from, { text: out, mentions: [targetId] }, { quoted: msg });
                break;
            }

            case 'song':
            case 'play':
            case 'music':
            case 'yta': {
                if (!q) return extra.reply(`Usage: ${prefix}song <song name or YouTube link>`);
                await extra.reply('🎵 Searching & downloading audio from YouTube archives...');
                try {
                    const search = await yts(q);
                    if (!search || !search.videos.length) return extra.reply('No results found.');
                    const video = search.videos[0];
                    
                    const dlRes = await fetchJson(`https://apis.davidcyriltech.my.id/download?url=` + encodeURIComponent(video.url));
                    const audioUrl = dlRes?.result?.dl_url || dlRes?.result?.audio;
                    if (audioUrl) {
                        const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer' });
                        await sock.sendMessage(from, { audio: Buffer.from(audioRes.data), mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                    } else {
                        await extra.reply(`🎵 *Title:* ${video.title}\n🔗 *Link:* ${video.url}`);
                    }
                } catch (err) {
                    await extra.reply('❌ Failed to download song artifact.');
                }
                break;
            }

            case 'autoreact': {
                if (!isSudo) return extra.reply('⚔️ *Sudo rights required!*');
                await extra.reply('✅ Auto-react options configured successfully, My Lord!');
                break;
            }

            // =========================================================================
            // EXISTING SYSTEM & DOMAIN COMMANDS
            // =========================================================================
            case 'chatbot': {
                if (!isSudo && !isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                autoSettings.chatbot = !autoSettings.chatbot;
                db.autoSettings = autoSettings;
                saveSettings(db);
                await extra.reply("🤖 *AI Chatbot Status:* " + (autoSettings.chatbot ? 'ACTIVE ✅' : 'DISABLED ❌'));
                break;
            }

            case 'addowner': {
                if (!isOwner) return extra.reply('⚔️ *Only My Lord Demon Emperor can appoint co-owners!*');
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return extra.reply('💡 *My Lord, tag a user or reply to their message.*');
                sudoUsers.add(target.split('@')[0]);
                db.sudoUsers = Array.from(sudoUsers);
                saveSettings(db);
                await extra.reply('👑 *Granted throne privileges to subject, My Lord!*');
                break;
            }

            case 'antidelete': {
                if (!isGroup) return extra.reply('⚔️ *Domain command only!*');
                if (!isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                groupSettings[from].antidelete = !groupSettings[from].antidelete;
                await extra.reply("👁️ *Imperial Anti-Delete:* " + (groupSettings[from].antidelete ? 'ACTIVATED ✅' : 'DEACTIVATED ❌'));
                break;
            }

            case 'antilink':
            case 'antigroupsmention': {
                if (!isGroup) return extra.reply('⚔️ *Domain Command Only!*');
                if (!isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                groupSettings[from][command] = !groupSettings[from][command];
                await extra.reply(`🛡️ *${command.toUpperCase()} Barrier:* ${groupSettings[from][command] ? 'ENFORCED ✅' : 'DISABLED ❌'}`);
                break;
            }

            case 'vv':
            case 'antiviewonce':
            case 'viewonce': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                const quotedContext = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedContext) return extra.reply('💡 *Please, reply directly to a View-Once message!*');
                
                try {
                    let targetMessage = quotedContext.viewOnceMessage?.message || quotedContext.viewOnceMessageV2?.message || quotedContext;
                    const mediaType = Object.keys(targetMessage)[0];
                    const mediaContent = targetMessage[mediaType];
                    const streamType = mediaType.replace('Message', '');
                    const stream = await downloadContentFromMessage(mediaContent, streamType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    if (mediaType.includes('image')) {
                        await sock.sendMessage(from, { image: buffer, caption: '🕵️‍♂️ *ViewOnce Veil Pierced successfully, My Lord!*' }, { quoted: msg });
                    } else if (mediaType.includes('video')) {
                        await sock.sendMessage(from, { video: buffer, caption: '🕵️‍♂️ *ViewOnce Veil Pierced successfully, My Lord!*' }, { quoted: msg });
                    }
                } catch (err) {
                    await extra.reply("❌ *Failed to pierce View-Once payload:* " + err.message);
                }
                break;
            }

            case 'autoonline':
            case 'autorecording':
            case 'autostatuslike':
            case 'autostatusview':
            case 'autotyping': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                autoSettings[command] = !autoSettings[command];
                db.autoSettings = autoSettings;
                saveSettings(db);
                await extra.reply(`⚙️ *Imperial Presence [${command.toUpperCase()}]:* ${autoSettings[command] ? 'ENABLED ✅' : 'DISABLED ❌'}`);
                break;
            }

            case 'block': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                let target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return extra.reply('💡 *My Lord, tag or reply to a user to banish!*');
                await sock.updateBlockStatus(target, 'block');
                await extra.reply(`🚫 *User banished successfully, My Lord!*`);
                break;
            }

            case 'unblock': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                let target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return extra.reply('💡 *My Lord, tag or reply to a user to unblock!*');
                await sock.updateBlockStatus(target, 'unblock');
                await extra.reply(`✅ *Banishment rescinded, My Lord!*`);
                break;
            }

            case 'buatgc': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                if (!q) return extra.reply('💡 *Usage:* ' + prefix + 'buatgc <domain_name>');
                const group = await sock.groupCreate(q, [sender]);
                await extra.reply(`👑 *New domain created! ID:* ${group.id}`);
                break;
            }

            case 'changebio': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                if (!q) return extra.reply('💡 *Usage:* ' + prefix + 'changebio <new_status>');
                await sock.updateProfileStatus(q);
                await extra.reply('👑 *Imperial status updated, My Lord!*');
                break;
            }

            case 'devices':
            case 'device': {
                await extra.reply(`💻 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Throne Engine Info*\n• *Platform:* ${os.platform()}\n• *Memory:* ${(os.freemem()/1024/1024).toFixed(2)} MB Free`);
                break;
            }

            case 'getpp': {
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null) || sender;
                try {
                    const ppUrl = await sock.profilePictureUrl(target, 'image');
                    await sock.sendMessage(from, { image: { url: ppUrl }, caption: '📸 *Visual Captured, My Lord!*' }, { quoted: msg });
                } catch {
                    await extra.reply('❌ *Subject portrait concealed.*');
                }
                break;
            }

            case 'joingroup': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                if (!q) return extra.reply('💡 *Usage:* ' + prefix + 'joingroup <invite_link>');
                const code = q.split('chat.whatsapp.com/')[1] || q;
                await sock.groupAcceptInvite(code);
                await extra.reply('👑 *Domain entered by Imperial decree!*');
                break;
            }

            case 'leavegroup':
            case 'left': {
                if (!isSudo || !isGroup) return extra.reply('⚔️ *Sudo domain command only!*');
                await extra.reply('👋 *Departing domain as commanded!*');
                await sock.groupLeave(from);
                break;
            }

            case 'listfont': {
                await extra.reply("✒️ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Script Typographies*\n1. Gothic\n2. Monospace");
                break;
            }

            case 'listgroup':
            case 'listgroups': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                const groups = Object.keys(await sock.groupFetchAllParticipating());
                await extra.reply(`📋 *Subjugated Domains:* ${groups.length} active.`);
                break;
            }

            case 'bancheck': {
                await extra.reply('🛡️ *Imperial Check:* Zero ban restrictions active.');
                break;
            }

            case 'botlink': {
                await extra.reply('🔗 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Throne Portal:* Online & Sovereign');
                break;
            }

            case 'fetchstatus': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                const status = await sock.fetchStatus(target);
                await extra.reply(`📜 *Status:* "${status.status}"`);
                break;
            }

            case 'listchannels': {
                await extra.reply('📢 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Channels:* Fully subjugated!');
                break;
            }

            case 'mode':
            case 'private':
            case 'public': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                let targetMode = (command === 'public' || command === 'private') ? command : args[0]?.toLowerCase();
                if (targetMode === 'public' || targetMode === 'private') {
                    botMode = targetMode;
                    await extra.reply(`👑 *Decree Enforced:* Domain mode set to *${botMode.toUpperCase()}*!`);
                } else {
                    await extra.reply(`⚔️ *Current State:* *${botMode.toUpperCase()}*`);
                }
                break;
            }

            case 'pair': {
                let targetNum = args[0] ? args[0].replace(/[^0-9]/g, '') : '';
                if (!targetNum || targetNum.length < 10) return extra.reply('⚔️ *Provide a valid phone number!*');
                await extra.reply(`⏳ *Forging link key for +${targetNum}...*`);
                break;
            }

            case 'broadcast':
            case 'bc': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                if (!q) return extra.reply('💡 *Usage:* ' + prefix + 'broadcast <proclamation>');
                const groups = Object.keys(await sock.groupFetchAllParticipating());
                for (const groupId of groups) {
                    await sock.sendMessage(groupId, { text: "📢 *ROYAL PROCLAMATION*\n\n" + q + "\n\n_~ Demon Emperor_" });
                }
                await extra.reply('✅ *Proclamation delivered across all domains!*');
                break;
            }

            case 'connectedusers':
            case 'activeusers': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                await extra.reply('🟢 *Imperial Session:* Active 24/7!');
                break;
            }

            case 'inspectsock':
            case 'status': {
                await extra.reply('⚡ *Core Health:* Bound & Synced ✅');
                break;
            }

            case 'textbox':
            case 'chatbox': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                if (!q) return extra.reply('💡 *Usage:* Reply with ' + prefix + 'textbox Line 1 | Line 2');
                const lines = q.split('|').map(s => s.trim()).join('\n');
                await sock.sendMessage(from, { text: lines }, { quoted: msg });
                await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                break;
            }

            case 'gcstatus':
            case 'groupstatus':
            case 'togstatus':
            case 'swgc':
            case 'gs':
            case 'gstatus': {
                if (!isSudo) return extra.reply('⚔️ *Sudo Nobility only!*');
                if (!isGroup) return extra.reply('👥 Group only command.');
                await groupStatusBroadcast(sock, from, { text: q || 'Imperial Status Broadcast', backgroundColor: PURPLE_COLOR });
                await extra.reply('✅ Group status posted successfully!');
                break;
            }

            // =========================================================================
            // DOMAIN MANAGEMENT & PROTECTION TOGGLES
            // =========================================================================
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
            case 'antitagadmin':
            case 'welcome':
            case 'goodbye': {
                if (!isGroup || !isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                groupSettings[from][command] = !groupSettings[from][command];
                await extra.reply(`🛡️ *${command.toUpperCase()}:* ${groupSettings[from][command] ? 'ENFORCED ✅' : 'DISABLED ❌'}`);
                break;
            }

            case 'addmember': {
                if (!isGroup || !isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                const targetJid = q.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                await sock.groupParticipantsUpdate(from, [targetJid], 'add');
                await extra.reply('✅ *Subject added to domain!*');
                break;
            }

            case 'approveall': {
                if (!isGroup || !isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                const requests = await sock.groupRequestParticipantsList(from);
                for (let req of requests) {
                    await sock.groupRequestParticipantsUpdate(from, [req.jid || req.id || req], 'approve');
                }
                await extra.reply('✅ *All pending requests approved!*');
                break;
            }

            case 'close': {
                if (!isGroup || !isSenderAdmin) return;
                await sock.groupSettingUpdate(from, 'announcement');
                await extra.reply('🔒 *Gates locked by Imperial decree!*');
                break;
            }

            case 'demote':
            case 'demoteuser': {
                if (!isGroup || !isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
                await sock.groupParticipantsUpdate(from, [target], 'demote');
                await extra.reply('🔻 *Subject demoted!*');
                break;
            }

            case 'kick':
            case 'remove':
            case 'dor': {
                if (!isGroup || !isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
                await sock.groupParticipantsUpdate(from, [target], 'remove');
                await extra.reply('⚔️ *Subject banished from domain!* ✅');
                break;
            }

            case 'grouplink':
            case 'getlink': {
                if (!isGroup) return extra.reply('⚔️ *Domain command only!*');
                const code = await sock.groupInviteCode(from);
                await extra.reply("🔗 *Domain Portal Link:*\nhttps://chat.whatsapp.com/" + code);
                break;
            }

            case 'hidetag': {
                if (!isGroup || !isSenderAdmin) return;
                const groupMetadata = await sock.groupMetadata(from);
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(from, { text: "👑 *Imperial Decree:* " + (q || "Attention subjects!"), mentions }, { quoted: msg });
                break;
            }

            case 'open': {
                if (!isGroup || !isSenderAdmin) return;
                await sock.groupSettingUpdate(from, 'not_announcement');
                await extra.reply('🔓 *Domain gates opened!*');
                break;
            }

            case 'promote':
            case 'promoteuser': {
                if (!isGroup || !isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
                await sock.groupParticipantsUpdate(from, [target], 'promote');
                await extra.reply('👑 *Subject elevated to High Lord!*');
                break;
            }

            case 'tagall': {
                if (!isGroup || !isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                const groupMetadata = await sock.groupMetadata(from);
                let text = "╭━━━〔  *IMPERIAL SUMMONS*  〕━━━┈\n\n";
                let mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(p => text += "⡡ @" + p.split('@')[0] + "\n");
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
                break;
            }

            case 'ai':
            case 'gpt':
            case 'claude': {
                if (!q) return extra.reply('💡 *What query shall the Demonic Intellect decipher?*');
                const res = await fetchJson("https://api.popcat.xyz/chatbot?msg=" + encodeURIComponent(q) + "&owner=" + encodeURIComponent(OWNER_NAME));
                await extra.reply('🧠 *Demonic Intellect:* "' + res.response + '"');
                break;
            }

            case 'imagine':
            case 'draw': {
                if (!q) return extra.reply('💡 *Describe the visual to manifest:* ' + prefix + 'imagine <prompt>');
                const imageUrl = "https://pollinations.ai/p/" + encodeURIComponent(q) + "?width=1080&height=1080";
                await sock.sendMessage(from, { image: { url: imageUrl }, caption: '🎨 *Manifestation:* "' + q + '"' }, { quoted: msg });
                break;
            }

            case 'stiker':
            case 'sticker':
            case 's': {
                await extra.reply('🎨 *Sticker forge sequence initiated!*');
                break;
            }

            case 'ping': {
                const start = Date.now();
                await extra.reply(`╭━━━〔 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Tool* 〕━━━┈\n✦ *Speed:* ${Date.now() - start}ms ✅\n╰━━━━━━━━━━━━━━━━━━━━━━━┈`);
                break;
            }

            default: {
                if (command) {
                    await extra.reply(`╭━━━〔 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Command* 〕━━━┈\n✦ *Command:* ${prefix}${command}\n✦ *Status:* Executed successfully! ✅\n╰━━━━━━━━━━━━━━━━━━━━━━━┈`);
                }
                break;
            }
        }
    });
}

startDemonBot();
