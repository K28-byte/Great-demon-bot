const messageCache = new Map();
const warningMap = new Map(); // Tracks warning counts per user per group
const removalEventCache = new Map();
const lastGreetingImages = new Map(); // Prevent duplicate removal announcements
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
const yts = require('yt-search');
const path = require('path');
const pino = require('pino');
const exec = require('child_process').exec;
const os = require('os');
const https = require('https');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
// Use FFmpeg installed on the host (Termux: pkg install ffmpeg).
// Set FFMPEG_PATH in hosted environments if FFmpeg is installed elsewhere.
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || 'ffmpeg');
const crypto = require('crypto');
const axios = require('axios');
const { truth } = require('@bochilteam/scraper');
const { translate } = require('@vitalets/google-translate-api');

// --- BOT CONFIGURATION ---
const OWNER_NUMBER = "2347061696819";
const OWNER_NAME = "𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍";
const BOT_NAME = "𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4";
const BOT_VERSION = "v4 ULTRA";
const MENU_IMAGE_URL = "https://i.postimg.cc/C5nJz4BG/1793460010889.jpg";
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

async function groupStatusBroadcast(sock, jid, content) {
    if (!sock.user?.id) {
        throw new Error("WhatsApp socket is not fully connected.");
    }

    const { backgroundColor } = content;
    const statusContent = { ...content };
    delete statusContent.backgroundColor;

    const inside = await generateWAMessageContent(statusContent, {
        upload: sock.waUploadToServer,
        backgroundColor: backgroundColor || PURPLE_COLOR,
    });

    if (!inside || !Object.keys(inside).length) {
        throw new Error("Failed to generate group status content.");
    }

    const messageSecret = crypto.randomBytes(32);
    const messageType = Object.keys(inside)[0];

    if (
        inside[messageType] &&
        typeof inside[messageType] === "object"
    ) {
        inside[messageType].contextInfo = {
            ...(inside[messageType].contextInfo || {}),
            isGroupStatus: true,
        };
    }

    const msg = generateWAMessageFromContent(
        jid,
        {
            messageContextInfo: {
                messageSecret,
            },
            groupStatusMessageV2: {
                message: {
                    ...inside,
                    messageContextInfo: {
                        messageSecret,
                    },
                },
            },
        },
        {
            userJid: sock.user.id,
        }
    );

    if (!msg?.message || !msg?.key?.id) {
        throw new Error("Failed to create group status message.");
    }

    await sock.relayMessage(
        jid,
        msg.message,
        { messageId: msg.key.id }
    );

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

async function startDemonBot(options = {}) {
    const sessionPath = options.sessionPath || './demon_session';
    const isPrimary = options.isPrimary !== false;

    if (isPrimary && process.env.SESSION_ID && process.env.SESSION_ID.trim().length > 20) {
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
    if (!isPrimary && options.telegramUserId) telegramSockets.set(String(options.telegramUserId), sock);

    if (isPrimary && !sock.authState.creds.registered) {
        console.log('\n==================================================');
        let phoneNumber = process.env.PHONE_NUMBER || OWNER_NUMBER;
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

        try {
            await new Promise(res => setTimeout(res, 5000));
            console.log('⏳ Requesting Imperial Pairing Code for +' + phoneNumber + '...');
            const code = await sock.requestPairingCode(phoneNumber);
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log('\n🔑 YOUR PAIRING CODE: ' + formattedCode + '\n');
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
            if (!isPrimary && telegramDisabledAccounts.has(String(options.telegramUserId))) return;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('⚡ Reconnecting Great Demon Bot...');
                startDemonBot(options).catch(err => console.error('Reconnect failed:', err.message));
            } else {
                console.log('❌ Session logged out from WhatsApp servers. Please clear SESSION_ID to re-pair.');
            }
        } else if (connection === 'open') {
            console.log('\n⚡ 𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 CONNECTED AND ONLINE! ⚡\n');
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
    // 👑 IMPERIAL GROUP PROTECTION SYSTEM
    // =========================================================================

    // Separate protection tracking maps
    const imperialSpamMap = new Map();
    const imperialWarningMap = new Map();

    // =========================================================================
    // 👋 WELCOME, GOODBYE AND GROUP PARTICIPANT PROTECTION
    // =========================================================================
    sock.ev.on('group-participants.update', async (update) => {
        try {
            const { id: from, participants = [], action, author } = update;

            if (!from || !from.endsWith('@g.us')) return;

            if (!groupSettings[from]) {
                groupSettings[from] = {
                    antiadd: false, antibot: false, antidemote: false,
                    antigroupsmention: false, antiimage: false, antilink: false,
                    antipromote: false, antiremove: false, antispam: false,
                    antitag: false, welcome: false, goodbye: false,
                    antidelete: false, antitagadmin: false, grouponly: false,
                    antigcstatus: false,
                    antilinkMode: 'kick', antilinkWarnLimit: 3,
                    antigroupsmentionMode: 'kick', antigroupsmentionWarnLimit: 3
                };
            }

            const settings = groupSettings[from];
            const metadata = await sock.groupMetadata(from);
            const groupName = metadata.subject || 'Our Group';

            const normalize = jid => jid ? jidNormalizedUser(jid) : '';
            const botJid = normalize(sock.user?.id);
            const actorJid = normalize(author);

            const botParticipant = metadata.participants.find(
                p => normalize(p.id) === botJid
            );

            const isBotAdmin = !!botParticipant &&
                ['admin', 'superadmin'].includes(botParticipant.admin);

            const actorParticipant = metadata.participants.find(
                p => normalize(p.id) === actorJid
            );

            const actorNum = actorJid.split('@')[0];
            const actorIsAdmin = !!actorParticipant &&
                ['admin', 'superadmin'].includes(actorParticipant.admin);

            const trustedActor = !actorJid ||
                actorJid === botJid ||
                actorIsAdmin ||
                sudoUsers.has(actorNum);

            for (const participant of participants) {
                const userJid = normalize(participant);
                if (!userJid) continue;

                // Resolve LID to a phone JID when Baileys has a mapping.
                const resolvePhoneJid = async (jid) => {
                    if (!jid) return '';
                    if (jid.endsWith('@s.whatsapp.net')) return jid;
                    if (jid.endsWith('@lid')) {
                        try {
                            const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
                            if (mapped) return normalize(mapped);
                        } catch (err) {
                            console.error('[REMOVAL LID LOOKUP]', err.message);
                        }
                    }
                    return '';
                };

                const userPhoneJid = await resolvePhoneJid(userJid);
                const actorPhoneJid = await resolvePhoneJid(actorJid);
                const userMentionJid = userPhoneJid || userJid;
                const actorMentionJid = actorPhoneJid || actorJid;

                const formatNumber = jid => {
                    if (!jid || !jid.endsWith('@s.whatsapp.net')) return '';
                    return '+' + jid.split('@')[0];
                };

                const userNumber = formatNumber(userPhoneJid || userJid);
                const actorNumber = formatNumber(actorPhoneJid || actorJid);
                const userLabel = userNumber || 'Member';
                const actorLabel = actorNumber || 'Admin';
                const userTag = userPhoneJid ? '@' + userPhoneJid.split('@')[0] : 'Member';


                // ANTIADD
                if (action === 'add' && settings.antiadd && !trustedActor) {
                    if (isBotAdmin) {
                        await sock.sendMessage(from, {
                            text: '🚫 Unauthorized member addition detected. Removing ' + userTag + '.',
                            mentions: [userJid]
                        });

                        await sock.groupParticipantsUpdate(
                            from, [userJid], 'remove'
                        ).catch(err => console.error('[ANTIADD]', err.message));
                    }
                    continue;
                }

                // ANTIREMOVE
                if (action === 'remove' && settings.antiremove && !trustedActor) {
                    if (isBotAdmin) {
                        await sock.sendMessage(from, {
                            text: '🛡️ Unauthorized removal detected without Emperor uninformed,Attempting to restore ' + userTag + '.',
                            mentions: [userJid]
                        });

                        await sock.groupParticipantsUpdate(
                            from, [userJid], 'add'
                        ).catch(err => console.error('[ANTIREMOVE]', err.message));
                    }
                    continue;
                }

                // ANTIPROMOTE
                if (action === 'promote' && settings.antipromote && !trustedActor) {
                    if (isBotAdmin) {
                        await sock.sendMessage(from, {
                            text: '🛡️ Unauthorized promotion detected. Reversing promotion of ' + userTag + '.',
                            mentions: [userJid]
                        });

                        await sock.groupParticipantsUpdate(
                            from, [userJid], 'demote'
                        ).catch(err => console.error('[ANTIPROMOTE]', err.message));
                    }
                    continue;
                }

                // ANTIDEMOTE
                if (action === 'demote' && settings.antidemote && !trustedActor) {
                    if (isBotAdmin) {
                        await sock.sendMessage(from, {
                            text: '🛡️ Unauthorized demotion detected withoutEmperor uninformed. Attempting to restore ' + userTag + '.',
                            mentions: [userJid]
                        });

                        await sock.groupParticipantsUpdate(
                            from, [userJid], 'promote'
                        ).catch(err => console.error('[ANTIDEMOTE]', err.message));
                    }
                    continue;
                }

                // PROFILE PICTURE
                let ppUrl;
                try {
                    ppUrl = await sock.profilePictureUrl(userJid, 'image');
                } catch {
                    ppUrl = MENU_IMAGE_URL;
                }

                // WELCOME
                if (action === 'add' && settings.welcome) {
                    await sock.sendMessage(from, {
                        image: { url: ppUrl },
                        caption:
                            '👑 *IMPERIAL WELCOME* 👑\n\n' +
                            'Welcome to *' + groupName + '*, ' + userTag + '! ⚔️\n' +
                            'We hope you enjoy your time here. If you need help, ask the group. Enjoy your stay under the rule of the Emperor!',
                        mentions: [userJid]
                    }).catch(err => console.error('[WELCOME]', err.message));
                }

                // GOODBYE
                if (action === 'remove' && settings.goodbye) {
                    await sock.sendMessage(from, {
                        image: { url: ppUrl },
                        caption:
                            '👋 *IMPERIAL FAREWELL* 👋\n\n' +
                            userTag + ' has departed from *' + groupName + '*.\n' +
                            'We hope you enjoyed your time here. Farewell! ⚔️',
                        mentions: [userJid]
                    }).catch(err => console.error('[GOODBYE]', err.message));
                }
            }
        } catch (err) {
            console.error('[GROUP PROTECTION EVENT]', err.message);
        }
    });

    // =========================================================================
    // 📱 MESSAGE HANDLER, STATUS VIEW AND LIKE
    // =========================================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            const statusMsg = messages?.[0];

            if (statusMsg?.key?.remoteJid === 'status@broadcast') {
                const statusJid = statusMsg.key.participant;

                if (autoSettings.autostatusview) {
                    await sock.readMessages([statusMsg.key]).catch(() => {});
                }

                if (autoSettings.autostatuslike && statusJid) {
                    await sock.sendMessage('status@broadcast', {
                        react: { text: '🖤', key: statusMsg.key }
                    }, { statusJid }).catch(() => {});
                }
                return;
            }
        } catch (err) {
            console.error('[STATUS HANDLER]', err.message);
        }

        // =========================================================================
        // 🛡️ IMPERIAL ADVANCED ANTICRASH SHIELD
        // =========================================================================
        try {
            if (!Array.isArray(messages) || messages.length === 0) return;

            const check = messages[0];

            if (!check || typeof check !== 'object' ||
                !check.key || !check.key.remoteJid) {
                console.warn('[ANTICRASH] Invalid message structure blocked.');
                return;
            }

            if (!check.message || typeof check.message !== 'object') return;

            let raw;

            try {
                raw = JSON.stringify(check.message);
            } catch (err) {
                console.warn('[ANTICRASH] Invalid message payload blocked.');
                return;
            }

            if (typeof raw !== 'string') return;

            // Reject unusually large payloads, without blocking ordinary long messages.
            if (raw.length > 65536) {
                console.warn('[ANTICRASH] Oversized payload blocked:', check.key.remoteJid);
                return;
            }

            const controlChars =
                (raw.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length;

            if (controlChars > 100) {
                console.warn('[ANTICRASH] Excessive control characters blocked.');
                return;
            }

            const bidiCount =
                (raw.match(/[\u202A-\u202E\u2066-\u2069]/g) || []).length;

            if (bidiCount > 50) {
                console.warn('[ANTICRASH] Excessive directional characters blocked.');
                return;
            }

            const keys = Object.keys(check.message);

            if (keys.length === 0 || keys.length > 40) {
                console.warn('[ANTICRASH] Abnormal message structure blocked.');
                return;
            }

        } catch (err) {
            console.error('[ANTICRASH ERROR]', err.message);
            return;
        }

        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg?.message || !msg.key?.remoteJid) return;

        // =========================================================================
        // 💾 MESSAGE CACHE FOR ANTIDELETE
        // =========================================================================
        if (!msg.key.fromMe) {
            messageCache.set(msg.key.id, msg);

            if (messageCache.size > 500) {
                const oldestKey = messageCache.keys().next().value;
                messageCache.delete(oldestKey);
            }
        }

        const from = msg.key.remoteJid;

        // Show the configured WhatsApp presence for incoming messages.
        // Recording takes priority if both options are enabled.
        if (!msg.key.fromMe && from !== 'status@broadcast') {
            const presence = autoSettings.autorecording
                ? 'recording'
                : (autoSettings.autotyping ? 'composing' : null);
            if (presence) {
                await sock.sendPresenceUpdate(presence, from).catch(err =>
                    console.error('[AUTO PRESENCE]', err.message)
                );
            }
        }

        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || from;
        const senderNum = sender.split('@')[0];

        if (isGroup && !msg.key.fromMe) {
            incrementMessageCount(from, sender);
        }

        const body =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            msg.message.documentMessage?.caption ||
            '';

        if (!groupSettings[from]) {
            groupSettings[from] = {
                antiadd: false, antibot: false, antidemote: false,
                antigroupsmention: false, antiimage: false, antilink: false,
                antipromote: false, antiremove: false, antispam: false,
                antitag: false, welcome: false, goodbye: false,
                antidelete: false, antitagadmin: false, grouponly: false,
                antigcstatus: false,
                antilinkMode: 'kick', antilinkWarnLimit: 3,
                antigroupsmentionMode: 'kick', antigroupsmentionWarnLimit: 3
            };
        }

        const isOwner = msg.key.fromMe ||
            (isPrimary && (sender.includes(OWNER_NUMBER) || senderNum === OWNER_NUMBER));

        const isSudo = isOwner || sudoUsers.has(senderNum);

        if (botMode === 'private' && !isSudo) return;

        // =========================================================================
        // 👑 ADMIN DETECTION — match Baileys phone JIDs and LIDs
        // =========================================================================
        let isAdmin = false;
        let isBotAdmin = false;

        if (isGroup) {
            try {
                const metadata = await sock.groupMetadata(from);
                const normalize = jid => jid ? jidNormalizedUser(jid) : '';
                const aliasesFor = async (...jids) => {
                    const aliases = new Set(jids.map(normalize).filter(Boolean));
                    for (const jid of [...aliases]) {
                        if (jid.endsWith('@lid')) {
                            try {
                                const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
                                if (pn) aliases.add(normalize(pn));
                            } catch (err) {
                                console.error('[ADMIN LID LOOKUP]', err.message);
                            }
                        }
                    }
                    return aliases;
                };
                const matches = async (participant, aliases) => {
                    const ids = await aliasesFor(participant?.id, participant?.phoneNumber);
                    return [...ids].some(id => aliases.has(id));
                };

                const senderAliases = await aliasesFor(sender, msg.key.participantAlt);
                const botAliases = await aliasesFor(sock.user?.id, sock.user?.lid);

                for (const participant of metadata.participants) {
                    if (await matches(participant, senderAliases)) {
                        isAdmin = ['admin', 'superadmin'].includes(participant.admin);
                    }
                    if (await matches(participant, botAliases)) {
                        isBotAdmin = ['admin', 'superadmin'].includes(participant.admin);
                    }
                }
            } catch (err) {
                console.error('[ADMIN CHECK]', err.message);
            }
        }

        const isSenderAdmin = isAdmin || isSudo;

        // =========================================================================
        // 🔥 GLOBAL AUTO-REACT
        // =========================================================================
        if (autoSettings.autoreact && !msg.key.fromMe) {
            try {
                const emojis = ['🔥', '⚡', '💀', '👑', '🖤', '⚔️', '⭐'];
                const emoji = emojis[Math.floor(Math.random() * emojis.length)];

                await sock.sendMessage(from, {
                    react: { text: emoji, key: msg.key }
                });
            } catch (err) {}
        }

        // =========================================================================
        // 😂 QUOTE-REPLY MEME DETECTOR
        // =========================================================================
        const quotedMsgInfo = msg.message?.extendedTextMessage?.contextInfo;

        if (quotedMsgInfo?.stanzaId) {
            const replyText = body.trim().toLowerCase();

            if (['nope', 'no', 'yeah', 'yes', 'nah'].includes(replyText)) {
                const originalSender = quotedMsgInfo.participant;

                if (sender && originalSender) {
                    const memeCaption =
                        '🙋‍♂️ @' + sender.split('@')[0] +
                        ' said ' + body.trim() +
                        ' to @' + originalSender.split('@')[0] + '!';

                    await sock.sendMessage(from, {
                        image: { url: 'https://i.imgur.com/2wzGhpF.jpeg' },
                        caption: memeCaption,
                        mentions: [sender, originalSender]
                    }, { quoted: msg }).catch(() => {});
                }
            }
        }


        // =========================================================================
        // 🚫 IMPERIAL ANTISPAM
        // =========================================================================
        if (isGroup && groupSettings[from].antispam && !isSenderAdmin) {
            const spamKey = from + '_' + sender;
            const now = Date.now();

            const data = imperialSpamMap.get(spamKey) || {
                times: [],
                cooldownUntil: 0
            };

            if (now < data.cooldownUntil) {
                await sock.sendMessage(from, {
                    delete: msg.key
                }).catch(() => {});
                return;
            }

            data.times = data.times.filter(time => now - time < 10000);
            data.times.push(now);

            if (data.times.length >= 6) {
                data.cooldownUntil = now + 15000;
                data.times = [];

                imperialSpamMap.set(spamKey, data);

                await sock.sendMessage(from, {
                    delete: msg.key
                }).catch(() => {});

                await sock.sendMessage(from, {
                    text: '🚫 @' + senderNum +
                        ', stop flooding the group! You are on a 15-second cooldown.',
                    mentions: [sender]
                }).catch(() => {});

                return;
            }

            imperialSpamMap.set(spamKey, data);
        }

        // =========================================================================
        // 🛡️ IMPERIAL GROUP MESSAGE PROTECTIONS
        // =========================================================================
        if (isGroup && groupSettings[from] && !isSenderAdmin) {
            const fullTextContent =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                msg.message?.documentMessage?.caption ||
                '';

            const cleanSenderJid = jidNormalizedUser(sender);

            // ANTILINK
            const linkRegex =
                /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,24}|https?:\/\/[^\s]+)/i;

            if (groupSettings[from].antilink && linkRegex.test(fullTextContent)) {
                await sock.sendMessage(from, {
                    delete: msg.key
                }).catch(() => {});

                const mode = groupSettings[from].antilinkMode || 'kick';

                if (mode === 'kick') {
                    await sock.sendMessage(from, {
                        text: '🗡️ @' + senderNum + ', links are forbidden!',
                        mentions: [cleanSenderJid]
                    }).catch(() => {});

                    if (isBotAdmin) {
                        await sock.groupParticipantsUpdate(
                            from, [cleanSenderJid], 'remove'
                        ).catch(() => {});
                    }
                } else {
                    const limit = groupSettings[from].antilinkWarnLimit || 3;
                    const warnKey = from + '_' + cleanSenderJid;
                    const warns = (imperialWarningMap.get(warnKey) || 0) + 1;

                    imperialWarningMap.set(warnKey, warns);

                    if (warns >= limit) {
                        imperialWarningMap.delete(warnKey);

                        await sock.sendMessage(from, {
                            text: '🚫 @' + senderNum +
                                ' reached the warning limit. Removing!',
                            mentions: [cleanSenderJid]
                        }).catch(() => {});

                        if (isBotAdmin) {
                            await sock.groupParticipantsUpdate(
                                from, [cleanSenderJid], 'remove'
                            ).catch(() => {});
                        }
                    } else {
                        await sock.sendMessage(from, {
                            text: '⚠️ @' + senderNum +
                                ', link warning ' + warns + '/' + limit,
                            mentions: [cleanSenderJid]
                        }).catch(() => {});
                    }
                }
                return;
            }

            // ANTIGROUP INVITE
            if (groupSettings[from].antigroupsmention &&
                /chat\.whatsapp\.com\/[A-Za-z0-9]{20,24}/i.test(fullTextContent)) {

                await sock.sendMessage(from, {
                    delete: msg.key
                }).catch(() => {});

                await sock.sendMessage(from, {
                    text: '🗡️ @' + senderNum +
                        ', group invitations are forbidden!',
                    mentions: [cleanSenderJid]
                }).catch(() => {});

                if ((groupSettings[from].antigroupsmentionMode || 'kick') === 'kick' &&
                    isBotAdmin) {
                    await sock.groupParticipantsUpdate(
                        from, [cleanSenderJid], 'remove'
                    ).catch(() => {});
                }
                return;
            }

            // ANTIIMAGE
            if (groupSettings[from].antiimage && msg.message?.imageMessage) {
                await sock.sendMessage(from, {
                    delete: msg.key
                }).catch(() => {});

                await sock.sendMessage(from, {
                    text: '🖼️ @' + senderNum +
                        ', image sharing is disabled in this group.',
                    mentions: [cleanSenderJid]
                }).catch(() => {});
                return;
            }

            // ANTITAG: BLOCK MASS MENTIONS
            if (groupSettings[from].antitag) {
                const mentioned =
                    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

                if (mentioned.length >= 5) {
                    await sock.sendMessage(from, {
                        delete: msg.key
                    }).catch(() => {});

                    await sock.sendMessage(from, {
                        text: '🚫 @' + senderNum + ', mass tagging is forbidden!',
                        mentions: [cleanSenderJid]
                    }).catch(() => {});
                    return;
                }
            }

            // ANTITAGADMIN
            if (groupSettings[from].antitagadmin) {
                const mentioned =
                    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

                if (mentioned.length > 0) {
                    try {
                        const metadata = await sock.groupMetadata(from);

                        const adminJids = metadata.participants
                            .filter(p => ['admin', 'superadmin'].includes(p.admin))
                            .map(p => jidNormalizedUser(p.id));

                        const taggedAdmins = mentioned.filter(jid =>
                            adminJids.includes(jidNormalizedUser(jid))
                        );

                        if (taggedAdmins.length > 0) {
                            await sock.sendMessage(from, {
                                delete: msg.key
                            }).catch(() => {});

                            await sock.sendMessage(from, {
                                text: '🛡️ @' + senderNum +
                                    ', tagging group administrators is restricted!',
                                mentions: [cleanSenderJid]
                            }).catch(() => {});
                            return;
                        }
                    } catch (err) {
                        console.error('[ANTITAGADMIN]', err.message);
                    }
                }
            }

            // ANTIBOT
            // WhatsApp has no reliable universal bot-account identifier.
            // Suspicious automated messages are logged, not automatically kicked.
            if (groupSettings[from].antibot && !msg.key.fromMe) {
                if (/(?:powered by|bot commands|automated message|i am a bot)/i.test(fullTextContent)) {
                    console.log('[ANTIBOT] Suspicious automated-style message:', sender);
                }
            }
        }


        // Duplicate protection handlers removed: the primary protection block above handles these once.

        // Allow a command after a leading mention, e.g. "@badboy .kick".
        // WhatsApp's actual mentionedJid is read below; this only normalizes command text.
        const commandBody = body.replace(/^\s*(?:@\S+\s*)+(?=\.)/u, '').trim();
        if (!commandBody.startsWith(prefix)) return;

        // --- 3. COMMAND PARSING ---
        const args = commandBody.slice(prefix.length).trim().split(/ +/);
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
"✿ sudo\n✿ sudolist\n✿ sudoremove\n✿ setprefix\n✿ anticall\n✿\delgcstatus\n✿ delete / del\n✿ addowner\n✿ antidelete\n✿ antiviewonce\n✿ autoonline\n✿ autorecording\n✿ autostatuslike\n✿ autostatusview\n✿ autotyping\n✿ autoreact\n✿ block\n✿ unblock\n✿ buatgc\n✿ changebio\n✿ devices\n✿ getpp\n✿ joingroup\n✿ leavegroup\n✿ listfont\n✿ listgroup\n✿ bancheck\n✿ botlink\n✿ fetchstatus\n✿ listchannels\n✿ mode\n✿ pair\n✿ broadcast\n✿ spamngl\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🎭 *𝐇𝐚𝐯𝐞 𝐅𝐮𝐧 𝐰𝐢𝐭𝐡 𝐄𝐦𝐩*  〕━━━┈\n" +
"✿ gm / goodmorning\n✿ ga / goodafternoon\n✿ gn / goodnight\n✿ konachan / konachansfw\n✿ wasted\n✿ top / activeusers\n✿ gayrate\n✿ flirt\n✿ dare\n✿ truth\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🛡️ *𝘿𝒐𝒎𝒂𝒊𝒏 𝙈𝒂𝒏𝒂𝒈𝒆𝒎𝒆𝒏𝒕*  〕━━━┈\n" +
"✿ welcome\n✿ goodbye\n✿ antilink (warn/kick)\n✿ antigroupsmention (warn/kick)\n✿ antibot\n✿ antispam\n✿ antitag\n✿ antitagadmin\n✿ antiremove\n✿ addmember\n✿ antiadd\n✿ antidemote\n✿ antiimage\n✿ antipromote\n✿ approveall\n✿ close\n✿ closetime\n✿ demoteall\n✿ demoteuser\n✿ disapproveall\n✿ dor\n✿ gcs\n✿ glostat\n✿ grouplink\n✿ groupmenu\n✿ grouponly\n✿ hidetag\n✿ kickall\n✿ left\n✿ listgroups\n✿ mediatag\n✿ open\n✿ opentime\n✿ promoteall\n✿ promoteuser\n✿ remove\n✿ setgroupbio\n✿ setgroupname\n✿ setgrouppp\n✿ setwarning\n✿ tagadmin\n✿ tagall\n✿ tagonline\n✿ tagpoll\n✿ warning\n✿ pin\n✿ vv\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🧠 *𝐃𝐞𝐦𝐨𝐧𝐢𝐜 𝐈𝐧𝐭𝐞𝐥𝐥𝐢𝐠𝐞𝐧𝐜𝐞*  〕━━━┈\n" +
"✿ ai\n✿ aimenu\n✿ claude\n✿ copilot\n✿ describe\n✿ felo\n✿ gpt\n✿ imagine\n✿ llama\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🧪 *𝐈𝐦𝐩𝐞𝐫𝐢𝐚𝐥  𝐂𝐨𝐧𝐯𝐞𝐫𝐬𝐢𝐨𝐧*  〕━━━┈\n" +
"✿ audio\n✿ convertmenu\n✿ stickermeme\n✿ stiker\n✿ swm\n✿ telestick\n✿ toaud\n✿ togif\n✿ toimg\n✿ tomp4\n✿ toptt\n✿ tourl\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  📥 *𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝 𝐓𝐨𝐨𝐥𝐬*  〕━━━┈\n" +
"✿ applemusic\n✿ capcut\n✿ play\n✿ \ndl\n✿ downloadmenu\n✿ fb\n✿ yts\n✿ lyrics\n" +
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
                        "https://i.postimg.cc/g0KFgQ3z/c77a97e3d147412e46277e04aad9ec2d.jpg",
                       "https://i.postimg.cc/vBmj3BQ9/a0dabd85c67ccddad4c21fb230b8e77b.jpg",
                        "https://i.postimg.cc/tgmQ0PvF/fad9e7a371f4fb4325dfd484effcff9f.jpg",
"https://i.postimg.cc/5ys2Djvd/daba42e86ad0aca92686fb9487d71caf.jpg"
                    ];

                    const morningCaptions = [
                        "╭━━━〔  🌄 *𝑮𝑶𝑶𝑫 𝑴𝑶𝑹𝑵𝑰𝑵𝑮*  〕━━━┈\n┃ ⚡ Sending a cute morning to y'all.\n┃ 👁️ here is another to grind , sharpen your focus, and stay ahead.\n┃ ⚔️ Remember perseverance is the best even if you fail .\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Time waits for no one.”_",
                        "╭━━━〔  ⚔️ *𝐎𝐇𝐀𝐘𝐎-𝐆𝐎𝐎𝐃 𝐌𝐎𝐑𝐍𝐈𝐍𝐆*  〕━━━┈\n┃ 🌅 Ohayo Gozaimasta ☺️❣️.\n┃ 😝 hope everyone slept good .\n┃ ⚡ just greeting y'all tho you can choose not to answer😌.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“and all the fra members too .”_",
                        "╭━━━〔  🤍 *𝐑𝐈𝐒𝐄 𝐀𝐍𝐃 𝐒𝐇𝐈𝐍𝐄*  〕━━━┈\n┃ 👑 Sun’s up, time to move.\n┃ 🔥 Don’t waste the morning slacking off.\n┃ 🖤 Stay focused, handle your goals, and dominate the day.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“chai speechless.”_"
                    ];

                    const previousImage = lastGreetingImages.get('morning');
                    const imageChoices = morningArtworks.filter(url => url !== previousImage);
                    const randomImg = (imageChoices.length ? imageChoices : morningArtworks)[Math.floor(Math.random() * (imageChoices.length ? imageChoices : morningArtworks).length)];
                    lastGreetingImages.set('morning', randomImg);
                    const randomCaption = morningCaptions[Math.floor(Math.random() * morningCaptions.length)];

                    await sock.sendMessage(from, { react: { text: '🌅', key: msg.key } });
                    try {
                        const imageResponse = await axios.get(randomImg, {
                            responseType: 'arraybuffer',
                            timeout: 15000,
                            maxContentLength: 8 * 1024 * 1024
                        });
                        await sock.sendMessage(from, {
                            image: Buffer.from(imageResponse.data),
                            caption: randomCaption,
                            mentions
                        }, { quoted: msg });
                    } catch (imageError) {
                        console.error('[GREETING IMAGE]', imageError.message);
                        await sock.sendMessage(from, {
                            image: { url: randomImg },
                            caption: randomCaption,
                            mentions
                        }, { quoted: msg }).catch(async () => {
                            await sock.sendMessage(from, { text: randomCaption, mentions }, { quoted: msg });
                        });
                    }
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
                        "https://i.postimg.cc/rsVSS0My/b266fc100e5037b5d2cb522fe98136ad.jpg",
                        "https://i.postimg.cc/rsVSS0My/b266fc100e5037b5d2cb522fe98136ad.jpg",

"https://i.postimg.cc/FH8g2HgV/58f71607457c7721df93dcdedd2dafb6.jpg",

"https://i.postimg.cc/2yrx29Ff/40ac6ca16fedc707b7d13fa0bf4c7125.jpg"

                    ];

                    const afternoonCaptions = [
                        "╭━━━〔  🔥 *𝑨𝑭𝑻𝑬𝑹𝑵𝑶𝑶𝑵 𝒀'𝑨𝑳𝑳*  〕━━━┈\n┃ ☀️ Peak of the day right here.\n┃ ⚡ Take a quick breather if you need to, then back to work.\n┃ ⚔️ Make the rest of the day count.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Stay locked in.”_",
                        "╭━━━〔  👑 *𝑲𝑶𝑵𝑵𝑰𝑪𝑯𝑰𝑾𝑨* 😊 〕━━━┈\n┃ 🌤️ The sun is high, keep pushing through.\n┃ 🩸 No room for laziness halfway through the grind.\n┃ 🖤 Stay sharp until the sun sets.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“I dey motivate una keh 😂 omo no grind oo lol.”_"
                    ];
                   
                    const previousImage = lastGreetingImages.get('afternoon');
                    const imageChoices = afternoonArtworks.filter(url => url !== previousImage);
                    const randomImg = (imageChoices.length ? imageChoices : afternoonArtworks)[Math.floor(Math.random() * (imageChoices.length ? imageChoices : afternoonArtworks).length)];
                    lastGreetingImages.set('afternoon', randomImg);
                    const randomCaption = afternoonCaptions[Math.floor(Math.random() * afternoonCaptions.length)];

                    await sock.sendMessage(from, { react: { text: '🔥', key: msg.key } });
                    try {
                        const imageResponse = await axios.get(randomImg, {
                            responseType: 'arraybuffer',
                            timeout: 15000,
                            maxContentLength: 8 * 1024 * 1024
                        });
                        await sock.sendMessage(from, {
                            image: Buffer.from(imageResponse.data),
                            caption: randomCaption,
                            mentions
                        }, { quoted: msg });
                    } catch (imageError) {
                        console.error('[GREETING IMAGE]', imageError.message);
                        await sock.sendMessage(from, {
                            image: { url: randomImg },
                            caption: randomCaption,
                            mentions
                        }, { quoted: msg }).catch(async () => {
                            await sock.sendMessage(from, { text: randomCaption, mentions }, { quoted: msg });
                        });
                    }
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
                        "https://i.postimg.cc/bv2chr7K/1d25bcfea04a4ee14159252cb97b4efc.jpg",
                        "https://i.postimg.cc/GpZR8GPv/14d51d4b546eefcb70052d84c37952da.jpg",
                        "https://i.postimg.cc/jj9xHGT2/aa8fdc8aa04dcc3e2e82b4f094e7e1d9.jpg"
                    ];

                    const nightCaptions = [
                        "╭━━━〔  🌙 *NIGHTTIME CALL*  〕━━━┈\n┃ 🌌 Day’s over. Time to call it a night.\n┃ 🕷️ Get some rest and recharge for tomorrow.\n┃ 🖤 Catch you all when the sun comes up.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Rest up for the next run.”_",
                        "╭━━━〔  🖤 *𝙊𝙔𝘼𝙎𝙐𝙈𝙄 𝙉𝘼𝙎𝘼𝙄*  〕━━━┈\n┃ 🌙 Sun’s down, quiet hours.\n┃ 😢 man we are so exhausted aren't we .\n┃ 🌌 Hope yall sleep well, tomorrow will be good for us .\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“YARE YARE ☺️.”_",
                        "╭━━━〔  🗡️ *𝐄𝐍𝐃 𝐎𝐅 𝐓𝐇𝐄 𝐃𝐀𝐘*  〕━━━┈\n┃ 🌑 Wrap it up for the day.\n┃ ⚡ Rest your mind, you earned it.\n┃ 🖤 Goodnight everyone, see you tomorrow.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n_“Until next dawn.”_"
                    ];

                    const previousImage = lastGreetingImages.get('night');
                    const imageChoices = nightArtworks.filter(url => url !== previousImage);
                    const randomImg = (imageChoices.length ? imageChoices : nightArtworks)[Math.floor(Math.random() * (imageChoices.length ? imageChoices : nightArtworks).length)];
                    lastGreetingImages.set('night', randomImg);
                    const randomCaption = nightCaptions[Math.floor(Math.random() * nightCaptions.length)];

                    await sock.sendMessage(from, { react: { text: '🖤', key: msg.key } });
                    try {
                        const imageResponse = await axios.get(randomImg, {
                            responseType: 'arraybuffer',
                            timeout: 15000,
                            maxContentLength: 8 * 1024 * 1024
                        });
                        await sock.sendMessage(from, {
                            image: Buffer.from(imageResponse.data),
                            caption: randomCaption,
                            mentions
                        }, { quoted: msg });
                    } catch (imageError) {
                        console.error('[GREETING IMAGE]', imageError.message);
                        await sock.sendMessage(from, {
                            image: { url: randomImg },
                            caption: randomCaption,
                            mentions
                        }, { quoted: msg }).catch(async () => {
                            await sock.sendMessage(from, { text: randomCaption, mentions }, { quoted: msg });
                        });
                    }
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

case 'konachan':
case 'konachansfw': {
    try {
        await extra.reply('✦ *SUMMONING A SAFE ANIME IMAGE...*');
        let imageUrl = null;

        // Konachan safe-rated endpoints first. Never accept non-safe ratings.
        const konachanEndpoints = [
            'https://konachan.net/post.json',
            'https://konachan.com/post.json'
        ];
        for (const endpoint of konachanEndpoints) {
            try {
                const result = await axios.get(endpoint, {
                    params: { limit: 30, tags: 'rating:safe' },
                    timeout: 15000,
                    headers: { 'User-Agent': 'GREAT-DEMON-V4/4.0 (safe anime image command)' }
                });
                const posts = Array.isArray(result.data) ? result.data.filter(post =>
                    post.rating === 's' && typeof post.file_url === 'string' &&
                    /^https:\/\//i.test(post.file_url)
                ) : [];
                if (posts.length) {
                    imageUrl = posts[Math.floor(Math.random() * posts.length)].file_url;
                    break;
                }
            } catch (providerError) {
                console.warn('[KONACHAN PROVIDER]', endpoint, providerError.message);
            }
        }

        // Safe anime fallback if Konachan is unavailable.
        if (!imageUrl) {
            try {
                const fallback = await axios.get('https://api.waifu.pics/sfw/waifu', { timeout: 15000 });
                if (typeof fallback.data?.url === 'string' && /^https:\/\//i.test(fallback.data.url)) {
                    imageUrl = fallback.data.url;
                }
            } catch (providerError) {
                console.warn('[WAIFU.PICS FALLBACK]', providerError.message);
            }
        }

        if (!imageUrl) {
            return extra.reply('❌ *No safe anime image is available right now.* Please try again later.');
        }

        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer', timeout: 25000,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024,
            headers: { 'User-Agent': 'GREAT-DEMON-V4/4.0' }
        });
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        const imageBuffer = Buffer.from(response.data);
        if (!contentType.startsWith('image/') || imageBuffer.length < 1024) {
            throw new Error('Image provider returned an invalid image file.');
        }

        await sock.sendMessage(from, {
            image: imageBuffer,
            caption: '╭━━〔 ✦ GREAT DEMON V4 ✦ 〕━━╮\n' +
                '┃ 🎴 *ANIME ARCHIVE*\n' +
                '╰━━━━━━━━━━━━━━━━━━━━━━╯\n' +
                '_A safe anime image has been summoned._'
        }, { quoted: msg });
    } catch (error) {
        console.error('[KONACHAN ERROR]', error?.response?.status, error.message);
        await extra.reply('❌ *Konachan could not fetch an image.* The image providers may be temporarily unavailable.').catch(() => {});
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
                let txt = "👑 *𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 Sudo Roster*\n\n";
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
                await extra.reply(`❌ *Stripped Sudo rank from +${cleanNum}, that means you don't worth it !*`);
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


            case 'del':
            case 'delete': {
                if (!isSenderAdmin) return extra.reply('⚔️ *Admin rights required!*');
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                if (!ctx?.stanzaId) {
                    return extra.reply('🗑️ *Reply directly to the message you wish to delete, My Lord.*');
                }

                try {
                    const quotedFromMe = Boolean(ctx.fromMe);
                    const quotedParticipant = isGroup
                        ? jidNormalizedUser(ctx.participant || (quotedFromMe ? sock.user.id : sender))
                        : undefined;
                    const deleteKey = {
                        remoteJid: from,
                        fromMe: quotedFromMe,
                        id: ctx.stanzaId,
                        ...(quotedParticipant ? { participant: quotedParticipant } : {})
                    };
                    await sock.sendMessage(from, { delete: deleteKey });
                    await extra.react('🗑️');
                } catch (error) {
                    await extra.reply('❌ *Failed to delete message. Ensure bot is group admin!*');
                }
                break;
            }

            case 'gcstatus': {
                // Owner-only Group Status V2 publisher. It posts one story into
                // each participating group; it does not send invite links as chat messages.
                if (!isOwner) return extra.reply('⚔️ *Only My Lord Demon Emperor can publish group status stories!*');
                const inviteUrl = String(q || '').trim();
                const inviteMatch = inviteUrl.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
                if (!inviteMatch) {
                    return extra.reply('💡 *Usage:* .gcstatus https://chat.whatsapp.com/INVITECODE');
                }

                let groupName = 'WhatsApp Group';
                try {
                    const inviteInfo = await sock.groupGetInviteInfo(inviteMatch[1]);
                    if (inviteInfo?.subject) groupName = inviteInfo.subject;
                } catch (inviteError) {
                    console.warn('[GCSTATUS INVITE LOOKUP]', inviteError.message);
                }

                let participatingGroups;
                try {
                    participatingGroups = await sock.groupFetchAllParticipating();
                } catch (fetchError) {
                    console.error('[GCSTATUS GROUP LIST]', fetchError);
                    return extra.reply('❌ Could not load the groups this WhatsApp account belongs to.');
                }

                const groupJids = Object.keys(participatingGroups || {}).filter(jid => jid.endsWith('@g.us'));
                if (!groupJids.length) return extra.reply('ℹ️ This WhatsApp account is not currently in any groups.');

                await extra.reply('📣 *Publishing Group Status V2...*\nGroups found: ' + groupJids.length + '\nThe invite will be posted as a status story, not as a normal group message.');

                const storyText = '🔥 NEW GROUP INVITATION!\n\n' +
                    '👑 ' + groupName + '\n\n' +
                    inviteUrl + '\n\n' +
                    '💀 Everyone is welcome!';
                let posted = 0;
                const failed = [];

                for (const groupJid of groupJids) {
                    try {
                        await groupStatusBroadcast(sock, groupJid, {
                            text: storyText,
                            backgroundColor: PURPLE_COLOR
                        });
                        posted++;
                    } catch (postError) {
                        failed.push(groupJid.split('@')[0] + ': ' + String(postError.message || 'send failed').slice(0, 90));
                        console.warn('[GCSTATUS POST FAILED]', groupJid, postError.message);
                    }
                    await new Promise(resolve => setTimeout(resolve, 1200));
                }

                const report = '✅ *Group Status V2 attempt finished*\n\n' +
                    '📤 Submitted: ' + posted + '/' + groupJids.length + '\n' +
                    '⚠️ Failed: ' + failed.length + '\n\n' +
                    (failed.length ? 'Failed groups:\n' + failed.slice(0, 10).join('\n') : 'All groups accepted the relay request.');
                await extra.reply(report);
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
                const out = `${targetTag} score: ${percent}% omo u be bast confirm gay guy 😂 🌈`;
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
                await sock.sendMessage(from, { text: "👁️ *Imperial Anti-Delete DON'T RU TO DELETE SHIT :* " + (groupSettings[from].antidelete ? 'ACTIVATED ✅' : 'DEACTIVATED ❌') }, { quoted: msg });
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
                    await sock.sendMessage(from, { text: "✅ *By decree of the Emperor:* *" + command.toUpperCase() + "* is ENFORCED!" }, { quoted: msg });
                } else if (subCmd === 'off') {
                    groupSettings[from][command] = false;
                    await sock.sendMessage(from, { text: "❌ *Imperial Dispensation:* *" + command.toUpperCase() + "* is DISABLED!" }, { quoted: msg });
                } else if (subCmd === 'kick') {
                    groupSettings[from][command] = true;
                    groupSettings[from][command + 'Mode'] = 'kick';
                    await sock.sendMessage(from, { text: "✅ *" + command.toUpperCase() + "* set to **DIRECT KICK** mode do shit you will be removed asap !" }, { quoted: msg });
                } else if (subCmd === 'warn') {
                    groupSettings[from][command] = true;
                    groupSettings[from][command + 'Mode'] = 'warn';
                    if (subVal && !isNaN(subVal)) {
                        groupSettings[from][command + 'WarnLimit'] = parseInt(subVal);
                    }
                    const limit = groupSettings[from][command + 'WarnLimit'] || 3;
                    await sock.sendMessage(from, { text: "✅ *" + command.toUpperCase() + "* set to **IMPERIAL WARN** mode (Limit: " + limit + " warnings)!" }, { quoted: msg });
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

                if (command === 'autoonline') {
                    await sock.sendPresenceUpdate(autoSettings.autoonline ? 'available' : 'unavailable')
                        .catch(err => console.error('[AUTO ONLINE]', err.message));
                }

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
                    await sock.sendMessage(from, { text: "👑 *New domain created for My Lord! ID:* " + group.id }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Failed to forge domain, My Lord.*' }, { quoted: msg });
                }
                break;
            }

            case 'changebio': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .changebio <new_status>' }, { quoted: msg });
                await sock.updateProfileStatus(q);
                await sock.sendMessage(from, { text: '👑 *Imperial status updated, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'devices':
            case 'device': {
                const commandMessage = unwrapMessage(msg.message) || {};
                const ctx = 
                    commandMessage.extendedTextMessage?.contextInfo ||
                    commandMessage.imageMessage?.contextInfo ||
                    commandMessage.videoMessage?.contextInfo ||
                    commandMessage.documentMessage?.contextInfo || {};

                let target = ctx.mentionedJid?.[0] || null;

                if (!target && ctx.stanzaId && ctx.participant) {
                    target = ctx.participant;
                }

                if (!target && q) {
                    const digits = q.replace(/[^0-9]/g, '');
                    if (digits.length >= 7) target = digits + '@s.whatsapp.net';
                }

                if (!target) target = sender;

                const normalizedTarget = jidNormalizedUser(target);
                const phone = normalizedTarget.split('@')[0].split(':')[0];

                let linkedDevices = [];
                try {
                    if (typeof sock.getUSyncDevices === 'function') {
                        linkedDevices = await sock.getUSyncDevices([normalizedTarget], true, true) || [];
                    }
                } catch (err) {
                    console.error('[DEVICES LOOKUP]', err.message);
                }

                // Detect actual session platform (Android / iOS / Web / Desktop)
                const parsePlatform = (item) => {
                    const rawJid = typeof item === 'string' ? item : (item.jid || item.id || item.user || '');
                    const str = String(rawJid);
                    if (str.includes(':0') || str.endsWith('@s.whatsapp.net')) return 'Mobile App (Android/iOS)';
                    if (str.includes(':1') || str.includes('web')) return 'WhatsApp Web';
                    if (str.includes(':2') || str.includes('desktop')) return 'WhatsApp Desktop';
                    if (str.includes(':3')) return 'Multi-Device Companion';
                    return 'Mobile Client';
                };

                const deviceLines = linkedDevices.length
                    ? linkedDevices.map((item, index) => `${index + 1}. Platform: *${parsePlatform(item)}*`).join('\n')
                    : '1. Platform: *Mobile Client (Active)*';

                // Clean layout without Admin references (Works anywhere/anytime)
                const responseText = 
                    `📱 *WHATSAPP DEVICE REPORT*\n\n` +
                    `|⚔️ Target: @${phone}\n` +
                    `|\n` +
                    `|📲 Status: Active\n\n` +
                    `*Detected Sessions:*\n${deviceLines}`;

                await sock.sendMessage(from, {
                    text: responseText,
                    mentions: [normalizedTarget]
                }, { quoted: msg });
                
                break;
            }

            case 'getpp': {
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null) || sender;
                try {
                    const ppUrl = await sock.profilePictureUrl(target, 'image');
                    await sock.sendMessage(from, { image: { url: ppUrl }, caption: '📸 *Imperial Sight: Visual Captured, My Lord!*' }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ *User portrait concealed from sight.*' }, { quoted: msg });
                }
                break;
            }

            case 'joingroup': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .joingroup <invite_link>' }, { quoted: msg });
                try {
                    const code = q.split('chat.whatsapp.com/')[1] || q;
                    await sock.groupAcceptInvite(code);
                    await sock.sendMessage(from, { text: '👑 *Domain entered by your decree, My Lord!*' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Invalid domain invite link.*' }, { quoted: msg });
                }
                break;
            }

            case 'leavegroup':
            case 'left': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '👋 *Departing ya ass, as commanded by My Lord Demon Emperor!*' }, { quoted: msg });
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
                let txt = "📋 *Subjugated Group (" + groups.length + "):*\n\n";
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
                    await sock.sendMessage(from, { text: "👑 *Decree Enforced:* Domain mode set to *" + botMode.toUpperCase() + "*, My Lord!" }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: "⚔️ *Current State:* *" + botMode.toUpperCase() + "*\n\n💡 *Usage:* .mode public | .mode private | .public | .private" }, { quoted: msg });
                }
                break;
            }

            case 'pair': {
                return sock.sendMessage(from, { text: "🔐 *Secure account linking is managed through the Telegram bot.*\nOpen your Telegram bot in a private chat and send /pair." }, { quoted: msg });
            }

            case 'broadcast':
            case 'bc': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may speak to all realms!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .broadcast <royal proclamation>' }, { quoted: msg });

                const groups = Object.keys(await sock.groupFetchAllParticipating());
                await sock.sendMessage(from, { text: "📢 *Transmitting royal decree to " + groups.length + " domains, My Lord!*" }, { quoted: msg });

                for (const groupId of groups) {
                    await sock.sendMessage(groupId, {
                        text: "📢 *𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 ROYAL PROCLAMATION*\n\n" + q + "\n\n_~ Directly from My Lord Demon Emperor_"
                    });
                }
                await sock.sendMessage(from, { text: '✅ *Proclamation delivered, My Lord!*' }, { quoted: msg });
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
 

case 'antiadd':
case 'antibot':
case 'antidemote':
case 'antiimage':
case 'antipromote':
case 'antiremove':
case 'antispam':
case 'antitag':
case 'antitagadmin': {
    if (!isGroup) {
        return sock.sendMessage(from, {
            text: '⚔️ *Domain Command Only!*'
        }, { quoted: msg });
    }

    if (!isSenderAdmin) {
        return sock.sendMessage(from, {
            text: '⚔️ *Admin rights required!*'
        }, { quoted: msg });
    }

    const setting = command;
    const stateArg = args[0]?.toLowerCase();

    if (!['on', 'off'].includes(stateArg)) {
        return sock.sendMessage(from, {
            text: `⚙️ *${setting.toUpperCase()} SETTINGS*\n\n` +
                `Use:\n` +
                `${prefix}${setting} on - Enable protection\n` +
                `${prefix}${setting} off - Disable protection`
        }, { quoted: msg });
    }

    groupSettings[from][setting] = stateArg === 'on';

    await sock.sendMessage(from, {
        text: stateArg === 'on'
            ? `✅ *${setting.toUpperCase()} is now ON!*`
            : `❌ *${setting.toUpperCase()} is now OFF!*`
    }, { quoted: msg });

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
                    await sock.sendMessage(from, { text: "✅ *By decree of the Emperor:* *" + setting.toUpperCase() + "* WELCOME is now ACTIVATED!" }, { quoted: msg });
                } else if (stateArg === 'off') {
                    groupSettings[from][setting] = false;
                    await sock.sendMessage(from, { text: "❌ *Imperial Dispensation:* *" + setting.toUpperCase() + "* WELCOME is now DISABLED!" }, { quoted: msg });
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
                    await sock.sendMessage(from, { text: '✅ *User added to domain, My Lord!*' }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ *Failed to add User.*' }, { quoted: msg });
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
                    await sock.sendMessage(from, { text: "✅ *Granted Group entry to " + approvedCount + " subject(s), My Lord!*" }, { quoted: msg });
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
                    await sock.sendMessage(from, { text: "🔒 *Domain gates are now " + actionText + "!*" });
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
                await sock.sendMessage(from, { text: '🔻 *Subject stripped of High Lord rank, My Lord!*' }, { quoted: msg });
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
                
                // Allow Owner, Sudo users, or regular group admins to execute
                if (!isSenderAdmin && !isSudo && !isOwner) {
                    return sock.sendMessage(from, { text: '⚔️ *Admin or Sudo rights required!*' }, { quoted: msg });
                }

                const commandMessage = unwrapMessage(msg.message) || {};
                const contextInfo =
                    commandMessage.extendedTextMessage?.contextInfo ||
                    commandMessage.imageMessage?.contextInfo ||
                    commandMessage.videoMessage?.contextInfo ||
                    commandMessage.documentMessage?.contextInfo || {};
                const mentioned = Array.isArray(contextInfo.mentionedJid)
                    ? contextInfo.mentionedJid : [];
                let target = mentioned[0] || null;

                if (!target && contextInfo.stanzaId && contextInfo.participant) {
                    target = contextInfo.participant;
                }

                if (!target && q) {
                    const cleanNum = q.replace(/[^0-9]/g, '');
                    if (cleanNum.length >= 7) target = cleanNum + '@s.whatsapp.net';
                }

                if (!target) {
                    return sock.sendMessage(from, {
                        text: '⚔️ Tag the member, reply to their message, or enter their number.'
                    }, { quoted: msg });
                }

                const normalizeKickJid = jid => jid ? jidNormalizedUser(jid) : '';
                let targetJid = normalizeKickJid(target);
                const adminJid = normalizeKickJid(sender);

                const toPhoneJid = async jid => {
                    if (!jid) return '';
                    if (jid.endsWith('@s.whatsapp.net')) return jid;
                    if (jid.endsWith('@lid')) {
                        try {
                            const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
                            if (mapped) return normalizeKickJid(mapped);
                        } catch (err) {}
                    }
                    return '';
                };

                try {
                    const before = await sock.groupMetadata(from);
                    const targetParticipant = before.participants.find(p =>
                        normalizeKickJid(p.id) === targetJid ||
                        normalizeKickJid(p.phoneNumber) === targetJid
                    );
                    if (targetParticipant?.id) {
                        targetJid = normalizeKickJid(targetParticipant.id);
                    } else if (!targetParticipant) {
                        const mapped = await toPhoneJid(targetJid);
                        if (mapped) targetJid = mapped;
                    }

                    const targetInGroup = before.participants.some(p =>
                        normalizeKickJid(p.id) === targetJid ||
                        normalizeKickJid(p.phoneNumber) === targetJid
                    );
                    if (!targetInGroup) {
                        return sock.sendMessage(from, { text: '❌ That member is not in this group.' }, { quoted: msg });
                    }

                    const result = await sock.groupParticipantsUpdate(from, [targetJid], 'remove');
                    const failed = Array.isArray(result) && result.some(item =>
                        item?.status && !['200', 200].includes(item.status)
                    );
                    if (failed) throw new Error('WhatsApp rejected the removal request');

                    // Styled with your requested design layout
                    const responseText = 
                        `|⚔️ User: @${targetJid.split('@')[0]}\n` +
                        `|\n` +
                        `|🛡️ Admin: @${adminJid.split('@')[0]}`;

                    await sock.sendMessage(from, { 
                        text: responseText,
                        mentions: [adminJid, targetJid]
                    }, { quoted: msg });

                } catch (err) {
                    console.error('[KICK COMMAND]', err);
                    await sock.sendMessage(from, {
                        text: '❌ *Kick failed.* Ensure the bot account is a group admin and the target is not an admin.'
                    }, { quoted: msg });
                }
                break;
            }

            case 'add':
            case 'addmember': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                
                if (!isSenderAdmin && !isSudo && !isOwner) {
                    return sock.sendMessage(from, { text: '⚔️ *Admin or Sudo rights required!*' }, { quoted: msg });
                }

                const commandMessage = unwrapMessage(msg.message) || {};
                const contextInfo =
                    commandMessage.extendedTextMessage?.contextInfo ||
                    commandMessage.imageMessage?.contextInfo ||
                    commandMessage.videoMessage?.contextInfo ||
                    commandMessage.documentMessage?.contextInfo || {};

                const mentioned = Array.isArray(contextInfo.mentionedJid) ? contextInfo.mentionedJid : [];
                let target = mentioned[0] || null;

                if (!target && contextInfo.stanzaId && contextInfo.participant) {
                    target = contextInfo.participant;
                }

                if (!target && q) {
                    const cleanNum = q.replace(/[^0-9]/g, '');
                    if (cleanNum.length >= 7) target = cleanNum + '@s.whatsapp.net';
                }

                if (!target) {
                    return sock.sendMessage(from, {
                        text: '💡 *Usage:* Tag a contact, reply to a user, or type `.add 234xxxxxxxxxx`'
                    }, { quoted: msg });
                }

                const normalizeAddJid = jid => jid ? jidNormalizedUser(jid) : '';
                let targetJid = normalizeAddJid(target);
                const adminJid = normalizeAddJid(sender);

                try {
                    const groupMeta = await sock.groupMetadata(from);
                    
                    const isAlreadyMember = groupMeta.participants.some(p => 
                        normalizeAddJid(p.id) === targetJid || normalizeAddJid(p.phoneNumber) === targetJid
                    );

                    if (isAlreadyMember) {
                        return sock.sendMessage(from, { 
                            text: `⚠️ *@${targetJid.split('@')[0]}* is already a member of this domain.`,
                            mentions: [targetJid] 
                        }, { quoted: msg });
                    }

                    const result = await sock.groupParticipantsUpdate(from, [targetJid], 'add');
                    const responseStatus = result?.[0]?.status;

                    if (responseStatus === '403') {
                        await sock.sendMessage(from, { 
                            text: `⚠️ Could not add *@${targetJid.split('@')[0]}* directly due to privacy settings.`,
                            mentions: [targetJid]
                        }, { quoted: msg });
                    } else if (responseStatus === '408' || responseStatus === '409') {
                        await sock.sendMessage(from, { text: '❌ User recently left or is already in the group.' }, { quoted: msg });
                    } else {
                        // Styled with your requested design layout
                        const responseText = 
                            `|⚔️ User: @${targetJid.split('@')[0]}\n` +
                            `|\n` +
                            `|🛡️ Admin: @${adminJid.split('@')[0]}`;

                        await sock.sendMessage(from, { 
                            text: responseText,
                            mentions: [adminJid, targetJid]
                        }, { quoted: msg });
                    }

                } catch (err) {
                    console.error('[ADD COMMAND]', err);
                    await sock.sendMessage(from, {
                        text: '❌ *Failed to add member.* Ensure the bot is a group admin.'
                    }, { quoted: msg });
                }
                break;
            }

            
            case 'gcs':
            case 'groupmenu': {
                await sock.sendMessage(from, { 
                    text: '👑 *𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 𝐕4 Domain Menu*\n\n' +
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
                    await sock.sendMessage(from, { text: "🔗 *Group Link:*\nhttps://chat.whatsapp.com/" + code }, { quoted: msg });
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
                await sock.sendMessage(from, { text: '⚔️ *Domain purged!*' }, { quoted: msg });
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
                await sock.sendMessage(from, { text: '🔓 *Domain gates opened! All may speak.*' }, { quoted: msg });
                break;
            }

            case 'promoteall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                const groupMetadata = await sock.groupMetadata(from);
                const nonAdmins = groupMetadata.participants.filter(p => !p.admin);
                
                for (let p of nonAdmins) {
                    await sock.groupParticipantsUpdate(from, [p.id], 'promote');
                }
                await sock.sendMessage(from, { text: '👑 *All subjects elevated to High Lord rank, My Lord!*' }, { quoted: msg });
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
                await sock.sendMessage(from, { text: '👑 *user Are elevated to High Lord rank, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'setgroupbio':
            case 'setgroupname':
            case 'setgrouppp': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                if (command === 'setgroupbio') {
                    if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .setgroupbio <desc>' }, { quoted: msg });
                    await sock.groupUpdateDescription(from, q);
                    await sock.sendMessage(from, { text: '✅ *Group description updated!*' }, { quoted: msg });
                } else if (command === 'setgroupname') {
                    if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .setgroupname <title>' }, { quoted: msg });
                    await sock.groupUpdateSubject(from, q);
                    await sock.sendMessage(from, { text: '✅ *Group title updated!*' }, { quoted: msg });
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
                let txt = "🛡️ *𝐆𝐑𝐄𝐀𝐓_𝐃𝐄𝐌𝐎𝐍 High Lords*\n\n";
                admins.forEach(a => txt += "• @" + a.split('@')[0] + "\n");
                await sock.sendMessage(from, { text: txt, mentions: admins }, { quoted: msg });
                break;
            }

            case 'tagall': {
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Only High Lords may summon the populace!*' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                let text = "╭━━━〔  *IMPERIAL SUMMONS — DEMON EMPEROR*  〕━━━┈\n_“All MEMBERS, COME ONLINE OO !”_\n\n";
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
                await sock.sendMessage(from, { text: '🟢 *Summoning Online User!*', mentions }, { quoted: msg });
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
    const quotedContext =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
        msg.message?.imageMessage?.contextInfo?.quotedMessage ||
        msg.message?.videoMessage?.contextInfo?.quotedMessage;

    const getMedia = (message) => {
        if (!message) return null;

        if (message.ephemeralMessage?.message)
            return getMedia(message.ephemeralMessage.message);

        if (message.viewOnceMessage?.message)
            return getMedia(message.viewOnceMessage.message);

        if (message.viewOnceMessageV2?.message)
            return getMedia(message.viewOnceMessageV2.message);

        if (message.imageMessage)
            return { data: message.imageMessage, type: 'image' };

        if (message.videoMessage)
            return { data: message.videoMessage, type: 'video' };

        return null;
    };

    const media =
        getMedia(msg.message) ||
        getMedia(quotedContext);

    if (!media) {
        return sock.sendMessage(from, {
            text: '📌 Reply to an image or video, or send one with .sticker'
        }, { quoted: msg });
    }

    let tempIn;
    let tempOut;

    try {
        await sock.sendMessage(from, {
            text: '🎨 Creating your sticker...'
        }, { quoted: msg });

        const stream = await downloadContentFromMessage(
            media.data,
            media.type
        );

        const chunks = [];

        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);

        if (!buffer.length) {
            throw new Error('Media download was empty.');
        }

        const id = Date.now() + '_' + Math.floor(Math.random() * 10000);

        tempIn = `./temp_sticker_${id}.${media.type === 'image' ? 'img' : 'mp4'}`;
        tempOut = `./temp_sticker_${id}.webp`;

        fs.writeFileSync(tempIn, buffer);

        const ffmpegArgs = [
            '-y',
            '-i', tempIn,
            '-vf',
            'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15',
            '-vcodec', 'libwebp',
            '-lossless', '0',
            '-q:v', '60',
            '-compression_level', '6',
            '-preset', 'default',
            '-an'
        ];

        if (media.type === 'video') {
            ffmpegArgs.push(
                '-t', '6',
                '-loop', '0',
                '-vsync', '0',
                '-pix_fmt', 'yuva420p'
            );
        } else {
            ffmpegArgs.push(
                '-frames:v', '1',
                '-pix_fmt', 'yuva420p'
            );
        }

        ffmpegArgs.push(tempOut);

        await execFileAsync('ffmpeg', ffmpegArgs);

        if (!fs.existsSync(tempOut)) {
            throw new Error('Sticker file was not created.');
        }

        const stickerBuffer = fs.readFileSync(tempOut);

        await sock.sendMessage(from, {
            sticker: stickerBuffer
        }, { quoted: msg });

    } catch (err) {
        console.error('Sticker Error:', err);

        await sock.sendMessage(from, {
            text: '❌ Sticker conversion failed. Make sure FFmpeg is installed and working on your server.'
        }, { quoted: msg });

    } finally {
        try {
            if (tempIn && fs.existsSync(tempIn))
                fs.unlinkSync(tempIn);

            if (tempOut && fs.existsSync(tempOut))
                fs.unlinkSync(tempOut);
        } catch (cleanupError) {
            console.error('Sticker cleanup error:', cleanupError);
        }
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


        case 'play': {
    const query = args.join(' ').trim();
    if (!query) {
        return sock.sendMessage(from, { text: '🎵 Enter a song name.\n\nExample: .play Calm Down' }, { quoted: msg });
    }

    let filePath = null;
    const normalizePlayText = value => String(value || '').toLowerCase()
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
    const extractAudioUrl = (value, depth = 0) => {
        if (!value || depth > 6) return null;
        if (typeof value === 'string') {
            const candidate = value.trim();
            if (/^https?:\/\//i.test(candidate) && !/\.(jpg|jpeg|png|webp)(\?|$)/i.test(candidate)) return candidate;
            return null;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = extractAudioUrl(item, depth + 1);
                if (found) return found;
            }
            return null;
        }
        if (typeof value === 'object') {
            const preferred = ['download_url', 'downloadUrl', 'dl_url', 'dl', 'audio_url', 'audioUrl', 'mp3', 'download', 'url', 'link', 'file', 'result', 'data'];
            for (const key of preferred) {
                if (value[key] !== undefined) {
                    const found = extractAudioUrl(value[key], depth + 1);
                    if (found) return found;
                }
            }
            for (const [key, item] of Object.entries(value)) {
                if (/thumb|image|poster|avatar/i.test(key)) continue;
                const found = extractAudioUrl(item, depth + 1);
                if (found) return found;
            }
        }
        return null;
    };

    try {
        await sock.sendMessage(from, { text: '🔎 Searching for your song...' }, { quoted: msg });
        const search = await yts(query);
        const video = search.videos?.[0];
        if (!video) {
            return sock.sendMessage(from, { text: '❌ Song not found. Try another title.' }, { quoted: msg });
        }

        const title = video.title || query;
        const author = video.author?.name || video.author || 'Unknown artist';
        const caption = '╔══〔 GREAT_DEMON V4 〕══╗\n║  ♫ AUDIO DOWNLOADER\n╚══════════════════╝\n\n◆ TITLE: ' + title +
            '\n◆ DURATION: ' + (video.timestamp || 'Unknown') + '\n◆ AUTHOR: ' + author;
        if (video.thumbnail) {
            try {
                await sock.sendMessage(from, { image: { url: video.thumbnail }, caption }, { quoted: msg });
            } catch (_) {
                await sock.sendMessage(from, { text: caption }, { quoted: msg });
            }
        } else {
            await sock.sendMessage(from, { text: caption }, { quoted: msg });
        }

        await sock.sendMessage(from, { text: '⬇️ Checking audio sources...' }, { quoted: msg });
        let audioUrl = null;
        let sourceName = '';
        let licenseNote = '';

        // First choice: Jamendo, but only tracks whose API explicitly allows downloads.
        const jamendoClientId = process.env.JAMENDO_CLIENT_ID;
        if (jamendoClientId) {
            try {
                const jr = await axios.get('https://api.jamendo.com/v3.0/tracks/', {
                    params: { client_id: jamendoClientId, format: 'json', limit: 20, search: query, audiodlformat: 'mp32', include: 'licenses' },
                    timeout: 18000
                });
                const tokens = normalizePlayText(query).split(/\s+/).filter(Boolean);
                const tracks = jr.data?.results || [];
                const ranked = tracks.map(track => {
                    const text = normalizePlayText((track.name || '') + ' ' + (track.artist_name || ''));
                    const words = new Set(text.split(/\s+/));
                    const score = tokens.length ? tokens.filter(t => words.has(t)).length / tokens.length : 0;
                    return { track, score };
                }).filter(x => x.track.audiodownload_allowed === true &&
                    typeof x.track.audiodownload === 'string' && /^https:\/\//i.test(x.track.audiodownload) && x.score >= 0.5)
                  .sort((a, b) => b.score - a.score);
                if (ranked.length) {
                    audioUrl = ranked[0].track.audiodownload;
                    sourceName = 'Jamendo';
                    licenseNote = 'Jamendo reported download permission for this track.';
                }
            } catch (e) {
                console.warn('[PLAY JAMENDO FALLBACK]', e.message);
            }
        }

        // Fallback providers copied as clean HTTP integrations from the supplied play.js.
        // No code from the obfuscated file is executed or imported.
        if (!audioUrl) {
            const encoded = encodeURIComponent(video.url);
            const providers = [
                { name: 'DavidCyril', url: 'https://api.davidcyriltech.my.id/youtube/mp3?url=' + encoded },
                { name: 'Ryzen', url: 'https://api.ryzendesu.vip/api/downloader/ytmp3?url=' + encoded },
                { name: 'Gifted', url: 'https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=' + encoded }
            ];
            for (const provider of providers) {
                try {
                    const response = await axios.get(provider.url, {
                        timeout: 25000,
                        maxContentLength: 2 * 1024 * 1024,
                        headers: { accept: 'application/json' }
                    });
                    const found = extractAudioUrl(response.data);
                    if (found) {
                        audioUrl = found;
                        sourceName = provider.name;
                        break;
                    }
                } catch (providerError) {
                    console.warn('[PLAY PROVIDER FAILED]', provider.name, providerError.message);
                }
            }
        }

        if (!audioUrl) {
            throw new Error('All configured audio sources failed or returned no download link. Check JAMENDO_CLIENT_ID and provider availability.');
        }

        filePath = path.join(os.tmpdir(), 'greatdemon_play_' + Date.now() + '.mp3');
        const audioResponse = await axios.get(audioUrl, {
            responseType: 'stream', timeout: 60000, maxRedirects: 5,
            maxContentLength: 40 * 1024 * 1024,
            validateStatus: status => status >= 200 && status < 300
        });
        const contentType = String(audioResponse.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('text/html') || contentType.includes('application/json')) {
            audioResponse.data.destroy();
            throw new Error('The provider returned a webpage or JSON instead of an audio file.');
        }
        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(filePath);
            audioResponse.data.on('error', reject);
            output.on('error', reject);
            output.on('finish', resolve);
            audioResponse.data.pipe(output);
        });
        const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
        if (size < 2048 || size > 40 * 1024 * 1024) throw new Error('Audio file was empty or exceeded the 40 MB limit.');

        const safeTitle = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 100) || 'audio';
        await sock.sendMessage(from, {
            audio: fs.readFileSync(filePath),
            mimetype: 'audio/mpeg',
            fileName: safeTitle + '.mp3',
            ptt: false
        }, { quoted: msg });
        await sock.sendMessage(from, {
            text: '🎵 Audio sent successfully.\nSource: ' + sourceName + (licenseNote ? '\n' + licenseNote : '')
        }, { quoted: msg });
    } catch (error) {
        console.error('[PLAY AUDIO ERROR]', error);
        await sock.sendMessage(from, {
            text: '❌ Could not send this audio.\n\n' + (error.message || 'Unknown provider error') +
                '\n\nTry another song title or check the audio-provider status and credentials.'
        }, { quoted: msg });
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) { console.warn('[PLAY CLEANUP]', e.message); }
        }
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
    if (!isOwner) {
        return sock.sendMessage(from, {
            text: '⚔️ My Lord Demon Emperor only!'
        }, { quoted: msg });
    }

    if (!isGroup) {
        return sock.sendMessage(from, {
            text: '❌ Use this command in an authorized test group.'
        }, { quoted: msg });
    }

    const input = q.trim();
    const match = input.match(/^(\d+)\s+([\s\S]+)$/);

    if (!match) {
        return sock.sendMessage(from, {
            text: 'Usage:\n.spamngl 10 Your message\n.spamngl 5 https://example.com'
        }, { quoted: msg });
    }

    const count = Number(match[1]);
    const content = match[2].trim();

    if (count < 1 || count > 20 || !content) {
        return sock.sendMessage(from, {
            text: '❌ Count must be between 1 and 20.'
        }, { quoted: msg });
    }

    await sock.sendMessage(from, {
        text: `⚡ Test started: ${count} messages.`
    }, { quoted: msg });

    let sent = 0;

    try {
        for (let i = 1; i <= count; i++) {
            await sock.sendMessage(from, {
                text: `${content}\n[${i}/${count}]`
            });

            sent++;

            await new Promise(resolve =>
                setTimeout(resolve, 3000)
            );
        }

        await sock.sendMessage(from, {
            text: `✅ Test completed: ${sent}/${count}`
        }, { quoted: msg });

    } catch (err) {
        console.error('SpamNG L Error:', err);

        await sock.sendMessage(from, {
            text: `❌ Stopped. Sent: ${sent}/${count}`
        }, { quoted: msg });
    }

    break;
}

            case 'androidcrash':
            case 'bugmenu':
            case 'iosfc': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor possesses access to war payloads!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '🛡️ *Shield V10 ULTRA:* Defense matrix active. Bug testing commands locked.' }, { quoted: msg });
                break;
            }

             
case 'gccrash': {
    if (!isOwner) {
        return sock.sendMessage(from, {
            text: '⚔️ Only My Lord can activate this command!'
        }, { quoted: msg });
    }

    if (!isGroup) {
        return sock.sendMessage(from, {
            text: '⚔️ This command only works in groups!'
        }, { quoted: msg });
    }

    await sock.sendMessage(from, {
        text: '⚡ *[GC TEST] Starting controlled group stress test...*'
    }, { quoted: msg });

    let sent = 0;

    try {
        for (let i = 1; i <= 5; i++) {
            await sock.sendMessage(from, {
                text: `⚡ *[GROUP TEST ${i}/5]*\nImperial transmission check.`
            });

            sent++;
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        await sock.sendMessage(from, {
            text: `✅ *GROUP TEST COMPLETED*\n\nMessages delivered: ${sent}/5\nStatus: Successful`
        }, { quoted: msg });

    } catch (err) {
        console.error('GC Test Error:', err);

        await sock.sendMessage(from, {
            text: `❌ *GROUP TEST FAILED*\nMessages sent: ${sent}/5`
        }, { quoted: msg });
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
                              "✦ *Status:* once you see this ur ass is bad at commanding it doesn't work ngga\n" +
                              "╰━━━━━━━━━━━━━━━━━━━━━━━┈" 
                    }, { quoted: msg });
                }
                break;
            }
        }
    });
    return { sock, state };
}

// --- TELEGRAM MULTI-ACCOUNT LINK MANAGER ---
// Set TELEGRAM_BOT_TOKEN in your hosting provider's environment variables.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_SESSIONS_FILE = path.join(__dirname, 'telegram_sessions.json');
const telegramSockets = new Map();
const telegramPairRequests = new Map();
const telegramPairCooldowns = new Map();
const telegramDisabledAccounts = new Set();
const TELEGRAM_PAIR_COOLDOWN_MS = 60 * 1000;

function loadTelegramSessions() {
    try {
        const value = JSON.parse(fs.readFileSync(TELEGRAM_SESSIONS_FILE, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
}
function saveTelegramSessions(value) {
    fs.writeFileSync(TELEGRAM_SESSIONS_FILE, JSON.stringify(value, null, 2), { mode: 0o600 });
}

async function startTelegramAccount(telegramUserId, requestPairing = false, phoneNumber = '') {
    const uid = String(telegramUserId);
    const sessionPath = path.join(__dirname, 'sessions', 'telegram_' + uid);
    fs.mkdirSync(sessionPath, { recursive: true });
    telegramDisabledAccounts.delete(uid);

    const existing = telegramSockets.get(uid);
    if (existing && existing.user && !requestPairing) return { sock: existing, state: null };

    // Never erase an existing session: reconnect it instead.
    const result = await startDemonBot({
        sessionPath,
        isPrimary: false,
        telegramUserId: uid
    });
    const { sock, state } = result;
    telegramSockets.set(uid, sock);

    if (requestPairing) {
        if (state.creds.registered) {
            return { sock, code: null, alreadyRegistered: true };
        }
        await new Promise(resolve => setTimeout(resolve, 4000));
        const code = await sock.requestPairingCode(phoneNumber);
        return { sock, code, alreadyRegistered: false };
    }
    return { sock, state };
}

async function startTelegramManager() {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log('ℹ️ Telegram linking is disabled. Set TELEGRAM_BOT_TOKEN in hosting environment variables to enable it.');
        return;
    }

    let TelegramBot;
    try { TelegramBot = require('node-telegram-bot-api'); }
    catch (_) {
        console.error('❌ Telegram token is set but node-telegram-bot-api is missing. Install it with: npm install node-telegram-bot-api');
        return;
    }

    const telegram = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    const linkedSessions = loadTelegramSessions();

    // --- REQUIRED TELEGRAM CHANNELS ---
    // Keep six spare configuration slots. Empty slots are hidden from Telegram users.
    // The bot must be an administrator in every configured channel to verify members.
    const REQUIRED_CHANNELS = [
        { id: '-1004432064802', link: 'https://t.me/+ZQ-j94DPg5NlOTA0' },
        { id: '', link: '' }, // Future channel/group 2
        { id: '', link: '' }, // Future channel/group 3
        { id: '', link: '' }, // Future channel/group 4
        { id: '', link: '' }, // Future channel/group 5
        { id: '', link: '' }, // Future channel/group 6
        { id: '', link: '' }  // Future channel/group 7
    ];

    const configuredRequiredChannels = REQUIRED_CHANNELS.filter(channel =>
        channel.id.trim() && channel.link.trim()
    );

    async function isRequiredChannelMember(userId) {
        if (!configuredRequiredChannels.length) return false;
        try {
            const memberships = await Promise.all(
                configuredRequiredChannels.map(async channel => {
                    const member = await telegram.getChatMember(channel.id, userId);
                    return ['creator', 'administrator', 'member'].includes(member.status) ||
                        (member.status === 'restricted' && member.is_member === true);
                })
            );
            return memberships.every(Boolean);
        } catch (err) {
            console.error('[TELEGRAM FORCE JOIN CHECK]', err.message);
            return false;
        }
    }

    async function sendJoinPrompt(chatId, userId) {
        const lines = [
            '╭━━━〔 🔐 𝐃𝐄𝐌𝐎𝐍 𝐀𝐂𝐂𝐄𝐒𝐒 〕━━━╮',
            '┃',
            '┃  ✦ *GREAT DEMON V4* ✦',
            '┃  𝐕𝐄𝐑𝐈𝐅𝐈𝐂𝐀𝐓𝐈𝐎𝐍 𝐑𝐄𝐐𝐔𝐈𝐑𝐄𝐃',
            '┃',
            '┃  Join every community below to unlock',
            '┃  the bot. Membership is checked live.',
            '┃',
            '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯',
            ''
        ];
        const inline_keyboard = [];

        // Only configured entries are rendered. Spare slots remain in the array
        // for future use but are never shown to Telegram users.
        for (let i = 0; i < configuredRequiredChannels.length; i++) {
            const channel = configuredRequiredChannels[i];
            let displayName = channel.name || '';
            let chatType = channel.type || 'channel';
            let status = '🔴 PENDING';

            try {
                const [chat, member] = await Promise.all([
                    telegram.getChat(channel.id),
                    userId ? telegram.getChatMember(channel.id, userId) : Promise.resolve(null)
                ]);
                displayName = chat.title || chat.username || displayName;
                chatType = chat.type || chatType;
                if (member && (['creator', 'administrator', 'member'].includes(member.status) ||
                    (member.status === 'restricted' && member.is_member === true))) {
                    status = '🟢 JOINED';
                }
            } catch (err) {
                console.warn('[FORCE JOIN CHAT INFO]', channel.id, err.message);
                status = '🟡 VERIFY AFTER JOIN';
            }

            const kind = ['group', 'supergroup'].includes(chatType) ? 'GROUP' : 'CHANNEL';
            const name = (displayName || (kind === 'GROUP' ? 'Required group' : 'Required channel'))
                .replace(/[*_\[\]`]/g, '');
            lines.push('╭─ ' + (i + 1) + '. *' + name + '*');
            lines.push('│  ' + status);
            lines.push('╰────────────────────────');
            inline_keyboard.push([{ text: '🔴 JOIN ' + kind + ' ' + (i + 1), url: channel.link }]);
        }

        lines.push(
            '',
            '✦ Join all listed communities, then return here.',
            '✦ Press the button below to verify your membership.',
            '',
            '⚡ *Access unlocks after successful verification.*'
        );
        inline_keyboard.push([{ text: '🟢 I HAVE JOINED ALL', callback_data: 'gd_check_join' }]);

        await telegram.sendMessage(chatId, lines.join('\n'), {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard }
        });
    }

    async function requireChannelMembership(msg) {
        const userId = msg?.from?.id;
        if (!userId || !(await isRequiredChannelMember(userId))) {
            await sendJoinPrompt(msg.chat.id, userId);
            return false;
        }
        return true;
    }
    
const TELEGRAM_WELCOME_IMAGE = "https://img.sanishtech.com/u/58210e1bf8b93988aa95289701c31b48.png";
const bannerUrl = TELEGRAM_WELCOME_IMAGE;

    const menuCaption =
        '✦ † ━━━━━━━━━━━━━ † ✦\n' +
        '       👑 *𝐆𝐑𝐄𝐀𝐓𝐃𝐄𝐌𝐎𝐍 𝐕4* 👑\n' +
        '✦ † ━━━━━━━━━━━━━ † ✦\n\n' +
        '╔════════════════════╗\n' +
        '       💀 *WELCOME, DEMON* 💀\n' +
        '╚════════════════════╝\n\n' +
        '⚔️ Connect and manage your own WhatsApp account.\n\n' +
        '✠ /connect — Link WhatsApp account\n' +
        '✠ /delpair — Disconnect your account\n' +
        '✠ /listdevices — View linked account status\n\n' +
        '_GREAT DEMON V4 • Imperial Link System_';

    async function sendStartMenu(chatId, userId) {
        if (!(await isRequiredChannelMember(userId))) {
            return sendJoinPrompt(chatId, userId);
        }
        const options = {
            caption: menuCaption,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔗 CONNECT WHATSAPP', callback_data: 'gd_connect' }],
                    [{ text: '📱 MY LINKED DEVICE', callback_data: 'gd_devices' },
                     { text: '🗑️ DELETE PAIR', callback_data: 'gd_delpair' }]
                ]
            }
        };
        try {
            await telegram.sendPhoto(chatId, bannerUrl, options);
        } catch (err) {
            // Keep the control panel usable if the banner URL is unavailable.
            await telegram.sendMessage(chatId, menuCaption, {
                parse_mode: 'Markdown',
                reply_markup: options.reply_markup
            });
        }
    }

    telegram.onText(/^\/start(?:@\w+)?$/, async msg => {
        if (msg.chat.type !== 'private') return;
        await sendStartMenu(msg.chat.id, msg.from.id);
    });

    telegram.onText(/^\/(?:connect|pair)(?:@\w+)?(?:\s+(.+))?$/, async (msg, match) => {
        if (msg.chat.type !== 'private') return;
        if (!(await requireChannelMembership(msg))) return;
        const uid = String(msg.from.id);
        const supplied = match[1] ? match[1].replace(/[^0-9]/g, '') : '';
        if (supplied) {
            const last = telegramPairCooldowns.get(uid) || 0;
            if (Date.now() - last < TELEGRAM_PAIR_COOLDOWN_MS) {
                return telegram.sendMessage(msg.chat.id, '⏳ Please wait one minute before requesting another pairing code.');
            }
            telegramPairCooldowns.set(uid, Date.now());
            telegramPairRequests.set(uid, msg.chat.id);
            telegramPairRequests.set(uid + ':number', supplied);
            return handleTelegramPairNumber(msg.chat.id, uid, supplied);
        }
        const last = telegramPairCooldowns.get(uid) || 0;
        if (Date.now() - last < TELEGRAM_PAIR_COOLDOWN_MS) {
            return telegram.sendMessage(msg.chat.id, '⏳ Please wait one minute before requesting another pairing code.');
        }
        telegramPairCooldowns.set(uid, Date.now());
        telegramPairRequests.set(uid, msg.chat.id);
        await telegram.sendMessage(msg.chat.id,
            '⚔️ *IMPERIAL LINK REQUEST*\n\nSend your WhatsApp number with country code, digits only.\nExample: `2348012345678`\n\nYour pairing code will be sent only to this private chat.',
            { parse_mode: 'Markdown' });
    });

    async function handleTelegramPairNumber(chatId, uid, number) {
        if (number.length < 10 || number.length > 15) {
            return telegram.sendMessage(chatId, '❌ Invalid number. Send 10–15 digits including your country code.');
        }
        telegramPairRequests.delete(uid);
        telegramPairRequests.delete(uid + ':number');
        await telegram.sendMessage(chatId, '⏳ Forging your GREAT DEMON V4 pairing code...');
        try {
            const result = await startTelegramAccount(uid, true, number);
            if (result.alreadyRegistered) {
                linkedSessions[uid] = { createdAt: linkedSessions[uid]?.createdAt || new Date().toISOString() };
                saveTelegramSessions(linkedSessions);
                return telegram.sendMessage(chatId, '✅ This Telegram account already has a registered WhatsApp session. Use /listdevices to check it or /delpair to unlink it.');
            }
            linkedSessions[uid] = { createdAt: new Date().toISOString() };
            saveTelegramSessions(linkedSessions);
            const code = result.code?.match(/.{1,4}/g)?.join('-') || result.code;
            await telegram.sendMessage(chatId,
                '🔑 *GREAT DEMON V4 — PAIRING CODE*\n\n`' + code + '`\n\nOpen WhatsApp → Linked Devices → Link a Device → Link with phone number instead.\n\n⚠️ Keep this code private.',
                { parse_mode: 'Markdown' });
        } catch (err) {
            telegramSockets.delete(uid);
            await telegram.sendMessage(chatId, '❌ Pairing failed: ' + String(err.message || 'unknown error').slice(0, 180));
        }
    }

    telegram.onText(/^\/(?:delpair|disconnect)(?:@\w+)?$/, async msg => {
        if (msg.chat.type !== 'private') return;
        const uid = String(msg.from.id);
        telegramDisabledAccounts.add(uid);
        const sock = telegramSockets.get(uid);
        if (sock) {
            try { sock.end(undefined); } catch (_) {}
            telegramSockets.delete(uid);
        }
        const sessionPath = path.join(__dirname, 'sessions', 'telegram_' + uid);
        try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (_) {}
        delete linkedSessions[uid];
        saveTelegramSessions(linkedSessions);
        await telegram.sendMessage(msg.chat.id, '🗑️ Your WhatsApp account has been unlinked and its saved session removed.');
    });

    telegram.onText(/^\/(?:listdevices|status)(?:@\w+)?$/, async msg => {
        if (msg.chat.type !== 'private') return;
        if (!(await requireChannelMembership(msg))) return;
        const uid = String(msg.from.id);
        const sessionPath = path.join(__dirname, 'sessions', 'telegram_' + uid);
        const hasSession = !!linkedSessions[uid] && fs.existsSync(path.join(sessionPath, 'creds.json'));
        const sock = telegramSockets.get(uid);
        const status = hasSession
            ? (sock?.user ? '🟢 Connected' : '🟡 Session saved; connecting or reconnecting')
            : '🔴 No WhatsApp account linked';
        await telegram.sendMessage(msg.chat.id,
            '╭━━〔 👑 *GREAT DEMON V4* 〕━━╮\n' +
            '┃ *Your linked device:* ' + status + '\n' +
            '╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n' +
            (hasSession ? 'Use /delpair to unlink this account.' : 'Use /connect to link your WhatsApp account.'),
            { parse_mode: 'Markdown' });
    });

    telegram.on('callback_query', async query => {
        const msg = query.message;
        if (!msg || msg.chat.type !== 'private') {
            return telegram.answerCallbackQuery(query.id);
        }
        const uid = String(query.from.id);
        if (query.data === 'gd_check_join') {
            const joined = await isRequiredChannelMember(query.from.id);
            if (joined) {
                await telegram.answerCallbackQuery(query.id, { text: 'Membership verified!' });
                return sendStartMenu(msg.chat.id, query.from.id);
            }
            await telegram.answerCallbackQuery(query.id, {
                text: configuredRequiredChannels.length ? 'I cannot verify your membership yet. Join every required channel/group first.' : 'The bot owner still needs to configure the required channels.',
                show_alert: true
            });
            return sendJoinPrompt(msg.chat.id, query.from.id);
        }
        if (query.data !== 'gd_delpair' && !(await isRequiredChannelMember(query.from.id))) {
            await telegram.answerCallbackQuery(query.id);
            return sendJoinPrompt(msg.chat.id, query.from.id);
        }
        if (query.data === 'gd_connect') {
            await telegram.answerCallbackQuery(query.id);
            const last = telegramPairCooldowns.get(uid) || 0;
            if (Date.now() - last < TELEGRAM_PAIR_COOLDOWN_MS) {
                return telegram.sendMessage(msg.chat.id, '⏳ Please wait before requesting another pairing code.');
            }
            telegramPairCooldowns.set(uid, Date.now());
            telegramPairRequests.set(uid, msg.chat.id);
            return telegram.sendMessage(msg.chat.id,
                '⚔️ Send your WhatsApp number with country code, digits only.\nExample: 2348012345678');
        }
        if (query.data === 'gd_devices') {
            await telegram.answerCallbackQuery(query.id);
            const sessionPath = path.join(__dirname, 'sessions', 'telegram_' + uid);
            const exists = !!linkedSessions[uid] && fs.existsSync(path.join(sessionPath, 'creds.json'));
            const sock = telegramSockets.get(uid);
            return telegram.sendMessage(msg.chat.id, exists
                ? (sock?.user ? '🟢 Your WhatsApp is connected.' : '🟡 Your WhatsApp session is saved and reconnecting.')
                : '🔴 No account linked. Press CONNECT WHATSAPP or send /connect.');
        }
        if (query.data === 'gd_delpair') {
            await telegram.answerCallbackQuery(query.id);
            return telegram.sendMessage(msg.chat.id, 'To remove your linked WhatsApp account, send /delpair.');
        }
        await telegram.answerCallbackQuery(query.id);
    });

    telegram.on('message', async msg => {
        if (msg.chat.type !== 'private' || !msg.text) return;
        const uid = String(msg.from.id);
        if (!telegramPairRequests.has(uid) || /^\//.test(msg.text.trim())) return;
        if (!(await requireChannelMembership(msg))) return;
        const number = msg.text.replace(/[^0-9]/g, '');
        await handleTelegramPairNumber(msg.chat.id, uid, number);
    });

    // Restore previously linked accounts on process restart.
    for (const uid of Object.keys(linkedSessions)) {
        const sessionPath = path.join(__dirname, 'sessions', 'telegram_' + uid);
        if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
            startTelegramAccount(uid).catch(err => console.error('Telegram account reconnect failed:', err.message));
        }
    }
    console.log('🤖 GREAT DEMON V4 Telegram control panel is running.');
}

startDemonBot().catch(err => console.error('Primary bot startup failed:', err.message));
startTelegramManager().catch(err => console.error('Telegram manager startup failed:', err.message));
