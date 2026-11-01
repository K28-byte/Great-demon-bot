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

// --- BOT CONFIGURATION ---
const OWNER_NUMBER = "2347061696819";
const OWNER_NAME = "𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏";
const BOT_NAME = "𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕";
const BOT_VERSION = "v4 ULTRA";
const MENU_IMAGE_URL = "https://img.sanishtech.com/u/96b35f47cb64cc0f77b9a781b40d0990.jpg";
const PURPLE_COLOR = '#9C27B0';
const startTime = Date.now();

// --- STATE MANAGEMENT ---
let botMode = "public"; 
const activeGames = {};
const groupSettings = {};
const vipUsers = new Set([OWNER_NUMBER]);
let prefix = ".";
const blockedUsers = new Set();
const deletedMessages = new Map();
const autoSettings = {
    autoonline: true,
    autorecording: false,
    autostatuslike: true,   
    autostatusview: true,   
    autotyping: false,
    chatbot: true           
};

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

  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id, participant: { jid: sock.user.id } });
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
        const isVip = isOwner || vipUsers.has(senderNum);

        if (botMode === 'private' && !isVip) {
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

                if (isOwner && isAdmin) isBotAdmin = true;
            } catch (e) {}
        }

        const isSenderAdmin = isAdmin || isOwner;

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

        // --- GROUP PROTECTION INTERCEPTORS ---
        if (isGroup && groupSettings[from] && !isSenderAdmin) {
            const fullTextContent = msg.message?.conversation || 
                                    msg.message?.extendedTextMessage?.text || 
                                    msg.message?.imageMessage?.caption || '';

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
                }
                return;
            }

            if (groupSettings[from].antibot && !msg.key.fromMe) {
                const isExternalBot = msg.key.id.startsWith('BAE5') || msg.key.id.length === 16;
                if (isExternalBot) {
                    await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
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
"└────────────────────────\n\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈";

                    await sock.sendMessage(from, { text: multiCardFallback }, { quoted: msg });
                    return;
                }

                try {
                    let aiResponse = null;
                    const promptContext = "You are an AI named Demon chatting in a WhatsApp group. You talk like a real human friend, discuss anime fluently, tell jokes, give anime recommendations, and answer questions like a smart AI model when asked. User message: " + body;

                    const apiRes1 = await fetchJson("https://api.popcat.xyz/chatbot?msg=" + encodeURIComponent(promptContext) + "&owner=" + encodeURIComponent(OWNER_NAME) + "&botname=" + encodeURIComponent("Demon"));
                    if (apiRes1 && apiRes1.response) aiResponse = apiRes1.response;

                    if (aiResponse) {
                        aiResponse = aiResponse.replace(/ChatGPT|OpenAI|assistant/gi, "Demon");
                        await sock.sendMessage(from, { text: aiResponse }, { quoted: msg });
                    }
                } catch (err) {}
            }
            return;
        }

        // --- 3. COMMAND PARSING ---
        const args = body.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const q = args.join(' ');

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
"┃ *🏗️ Bot status:* Online & Fully Operational \n" +
"┃ *⏰️ Uptime:* " + uptimeFormatted + "\n" +
"┃ *🌖 Version:* " + BOT_VERSION + "\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  👑 *EMPEROR'S SUPREME*  〕━━━┈\n" +
"✿ addowner\n✿ antidelete\n✿ antiviewonce\n✿ autoonline\n✿ autorecording\n✿ autostatuslike\n✿ autostatusview\n✿ autotyping\n✿ block\n✿ unblock\n✿ buatgc\n✿ changebio\n✿ chatbot\n✿ devices\n✿ getpp\n✿ gcstatus\n✿ joingroup\n✿ leavegroup\n✿ listfont\n✿ listgroup\n✿ bancheck\n✿ botlink\n✿ fetchstatus\n✿ listchannels\n✿ mode\n✿ pair\n✿ broadcast\n✿ spamngl\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  ⭐ *VIP NOBILITY*  〕━━━┈\n" +
"✿ connectedusers\n✿ inspectsock\n✿ status\n✿ vipadd\n✿ vipadmin\n✿ vipallgroups\n✿ vipdemote\n✿ vipdetails\n✿ vipgroups\n✿ viplist\n✿ vipmenu\n✿ vippromote\n✿ vipreassign\n✿ vipremove\n✿ viptakeover\n✿ vipunclaim\n" +
"╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n" +
"╭━━━〔  🛡️ *DOMAIN MANAGEMENT*  〕━━━┈\n" +
"✿ welcome\n✿ goodbye\n✿ antilink\n✿ antigroupsmention\n✿ antibot\n✿ antispam\n✿ antitag\n✿ antitagadmin\n✿ antiremove\n✿ activeusers\n✿ addmember\n✿ antiadd\n✿ antidemote\n✿ antiimage\n✿ antipromote\n✿ approveall\n✿ close\n✿ closetime\n✿ demoteall\n✿ demoteuser\n✿ disapproveall\n✿ dor\n✿ gcs\n✿ glostat\n✿ grouplink\n✿ groupmenu\n✿ grouponly\n✿ hidetag\n✿ inactiveusers\n✿ kickall\n✿ left\n✿ listgroups\n✿ mediatag\n✿ open\n✿ opentime\n✿ promoteall\n✿ promoteuser\n✿ remove\n✿ setgroupbio\n✿ setgroupname\n✿ setgrouppp\n✿ setwarning\n✿ tagadmin\n✿ tagall\n✿ tagonline\n✿ tagpoll\n✿ warning\n✿ pin\n✿ textbox\n✿ vv\n" +
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

            case 'chatbot': {
                if (!isOwner && !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                const stateArg = args[0]?.toLowerCase();
                if (stateArg === 'on') {
                    autoSettings.chatbot = true;
                    await sock.sendMessage(from, { text: '✅ *Group AI Chatbot activated!*' }, { quoted: msg });
                } else if (stateArg === 'off') {
                    autoSettings.chatbot = false;
                    await sock.sendMessage(from, { text: '❌ *Group AI Chatbot deactivated!*' }, { quoted: msg });
                } else {
                    autoSettings.chatbot = !autoSettings.chatbot;
                    await sock.sendMessage(from, { text: "🤖 *AI Chatbot Status:* " + (autoSettings.chatbot ? 'ACTIVE ✅' : 'DISABLED ❌') }, { quoted: msg });
                }
                break;
            }

            case 'addowner': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor can appoint co-owners!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, tag a user or reply to their message.*' }, { quoted: msg });
                vipUsers.add(target.split('@')[0]);
                await sock.sendMessage(from, { text: '👑 *Granted throne privileges to subject, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'antidelete': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                groupSettings[from].antidelete = !groupSettings[from].antidelete;
                await sock.sendMessage(from, { text: "👁️ *Imperial Anti-Delete:* " + (groupSettings[from].antidelete ? 'ACTIVATED ✅' : 'DEACTIVATED ❌') }, { quoted: msg });
                break;
            }

            case 'antilink':
            case 'antigroupsmention': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain Command Only!*' }, { quoted: msg });
                if (!isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                const subCmd = args[0]?.toLowerCase();
                if (subCmd === 'on') {
                    groupSettings[from][command] = true;
                    await sock.sendMessage(from, { text: "✅ *By decree of the Demon Emperor:* *" + command.toUpperCase() + "* is ENFORCED!" }, { quoted: msg });
                } else if (subCmd === 'off') {
                    groupSettings[from][command] = false;
                    await sock.sendMessage(from, { text: "❌ *Imperial Dispensation:* *" + command.toUpperCase() + "* is DISABLED!" }, { quoted: msg });
                } else {
                    groupSettings[from][command] = !groupSettings[from][command];
                    await sock.sendMessage(from, { text: "🛡️ *" + command.toUpperCase() + " Barrier:* " + (groupSettings[from][command] ? 'ENFORCED ✅' : 'DISABLED ❌') }, { quoted: msg });
                }
                break;
            }

            case 'vv':
            case 'antiviewonce':
            case 'viewonce': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const quotedContext = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedContext) return sock.sendMessage(from, { text: '💡 *Please, reply directly to a View-Once message!*' }, { quoted: msg });

                try {
                    let targetMessage = quotedContext.viewOnceMessage?.message || 
                                        quotedContext.viewOnceMessageV2?.message || 
                                        quotedContext.viewOnceMessageV2Extension?.message || 
                                        quotedContext;

                    const mediaType = Object.keys(targetMessage)[0];
                    const mediaContent = targetMessage[mediaType];
                    const streamType = mediaType.replace('Message', '');
                    const stream = await downloadContentFromMessage(mediaContent, streamType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    if (mediaType.includes('image')) {
                        await sock.sendMessage(from, { image: buffer, caption: '🕵️‍♂️ *ViewOnce Veil Pierced, My Lord!*' }, { quoted: msg });
                    } else if (mediaType.includes('video')) {
                        await sock.sendMessage(from, { video: buffer, caption: '🕵️‍♂️ *ViewOnce Veil Pierced, My Lord!*' }, { quoted: msg });
                    }
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to pierce View-Once payload.*' }, { quoted: msg });
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
                await sock.sendMessage(from, { text: "⚙️ *Imperial Presence [" + command.toUpperCase() + "]:* " + (autoSettings[command] ? 'ENABLED ✅' : 'DISABLED ❌') }, { quoted: msg });
                break;
            }

            case 'block': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My owner may cast banishment!*' }, { quoted: msg });
                let target = msg.message?.extendedTextMessage?.contextInfo?.participant || msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, tag a user or reply to their message to banish!*' }, { quoted: msg });
                try {
                    await sock.updateBlockStatus(target, 'block');
                    await sock.sendMessage(from, { text: "🚫 *User successfully banished to the Void, My Lord!*", mentions: [target] }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Failed to block user.*' }, { quoted: msg });
                }
                break;
            }

            case 'unblock': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may lift banishment!*' }, { quoted: msg });
                let target = msg.message?.extendedTextMessage?.contextInfo?.participant || msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, tag a user or reply to their message to unblock!*' }, { quoted: msg });
                try {
                    await sock.updateBlockStatus(target, 'unblock');
                    await sock.sendMessage(from, { text: "✅ *Banishment lifted for user, My Lord!*", mentions: [target] }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Failed to unblock user.*' }, { quoted: msg });
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
                await sock.sendMessage(from, { 
                    text: "💻 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Throne Engine Info*\n\n" +
                          "• *Platform:* " + os.platform() + "\n" +
                          "• *Architecture:* " + os.arch() + "\n" +
                          "• *Memory:* " + (os.freemem() / 1024 / 1024).toFixed(2) + " MB Free\n" +
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
                    await sock.sendMessage(from, { text: '❌ *Subject portrait concealed from sight.*' }, { quoted: msg });
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
                await sock.sendMessage(from, { text: "✒️ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Typographies:* Gothic, Monospace, Italic" }, { quoted: msg });
                break;
            }

            case 'listgroup':
            case 'listgroups': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const groups = Object.keys(await sock.groupFetchAllParticipating());
                let txt = "📋 *Subjugated Domains (" + groups.length + "):*\n\n";
                for (let gId of groups) {
                    const meta = await sock.groupMetadata(gId).catch(() => ({}));
                    txt += "• " + (meta.subject || 'Domain') + "\n";
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
                await sock.sendMessage(from, { text: '📢 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Channels:* Fully subjugated under your rule, My Lord!' }, { quoted: msg });
                break;
            }

            case 'mode':
            case 'private':
            case 'public': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may alter realm permissions!*' }, { quoted: msg });
                let targetMode = (command === 'public' || command === 'private') ? command : args[0]?.toLowerCase();
                if (targetMode === 'public' || targetMode === 'private') {
                    botMode = targetMode;
                    await sock.sendMessage(from, { text: "👑 *Decree Enforced:* Domain mode set to *" + botMode.toUpperCase() + "*, My Lord!" }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: "⚔️ *Current State:* *" + botMode.toUpperCase() + "*\n💡 *Usage:* .mode public | .mode private" }, { quoted: msg });
                }
                break;
            }

            case 'pair': {
                let targetNum = args[0] ? args[0].replace(/[^0-9]/g, '') : '';
                if (!targetNum || targetNum.length < 10) return sock.sendMessage(from, { text: "⚔️ *Provide a valid phone number with country code, My Lord!*" }, { quoted: msg });

                try {
                    await sock.sendMessage(from, { text: "⏳ *Forging link key for +" + targetNum + ", My Lord...*" }, { quoted: msg });
                    const tempSessionPath = path.join(__dirname, 'sessions', 'session_' + targetNum);
                    const { state, saveCreds } = await useMultiFileAuthState(tempSessionPath);

                    const tempSock = makeWASocket({
                        logger: pino({ level: 'silent' }),
                        printQRInTerminal: false,
                        auth: state,
                        browser: ["Great Demon Bot", "Chrome", "1.0.0"]
                    });
                    tempSock.ev.on('creds.update', saveCreds);

                    setTimeout(async () => {
                        try {
                            let code = await tempSock.requestPairingCode(targetNum);
                            code = code?.match(/.{1,4}/g)?.join("-") || code;
                            await sock.sendMessage(from, { text: "🔑 *IMPERIAL LINK CODE:* `" + code + "`" }, { quoted: msg });
                        } catch (innerErr) {
                            await sock.sendMessage(from, { text: "❌ *Forging failed! Pairing seal rejected.*" }, { quoted: msg });
                        }
                    }, 3000);
                } catch (err) {
                    await sock.sendMessage(from, { text: "❌ *An error occurred during the ritual.*" }, { quoted: msg });
                }
                break;
            }

            case 'broadcast':
            case 'bc': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may speak to all realms!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .broadcast <royal proclamation>' }, { quoted: msg });

                const groups = Object.keys(await sock.groupFetchAllParticipating());
                await sock.sendMessage(from, { text: "📢 *Transmitting royal decree to " + groups.length + " domains, My Lord!*" }, { quoted: msg });

                for (const groupId of groups) {
                    await sock.sendMessage(groupId, { text: "📢 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 ROYAL PROCLAMATION*\n\n" + q + "\n\n_~ Directly from My Lord Demon Emperor_" });
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
                await sock.sendMessage(from, { text: "⚡ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Core Health:* Bound & Synced ✅" }, { quoted: msg });
                break;
            }

            case 'vipadd':
            case 'vippromote':
            case 'vipadmin': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or mention a subject to grant VIP rank.*' }, { quoted: msg });
                vipUsers.add(target.split('@')[0]);
                await sock.sendMessage(from, { text: '⭐ *Granted VIP Nobility status to subject, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'textbox': {
                if (!isOwner && !isVip) return sock.sendMessage(from, { text: '⚔️ *VIP Nobility only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* Reply to a message with `.textbox Line 1 | Line 2`' }, { quoted: msg });
                try {
                    const lines = q.split('|').map(s => s.trim()).join('\n');
                    await sock.sendMessage(from, { text: lines }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: "❌ *Failed to generate text box.*" }, { quoted: msg });
                }
                break;
            }

            case 'vipgroups': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const groups = Object.keys(await sock.groupFetchAllParticipating());
                await sock.sendMessage(from, { text: "👑 *VIP Domains:* " + groups.length + " domains governed!" }, { quoted: msg });
                break;
            }

            case 'gcstatus':
            case 'groupstatus': {
                if (!isVip) return sock.sendMessage(from, { text: '⚔️ *VIP Nobility only!*' }, { quoted: msg });
                if (!isGroup) return sock.sendMessage(from, { text: '👥 Group command only.' }, { quoted: msg });

                try {
                    const argsList = body.slice(prefix.length + command.length).trim().split(/ +/);
                    let targetUrl = argsList.find(arg => arg.includes('http'));
                    let customText = argsList.filter(arg => !arg.includes('http')).join(' ');
                    const media = resolveMedia(msg);

                    if (!media && !targetUrl) {
                        const caption = (q || '').trim();
                        if (!caption) return sock.sendMessage(from, { text: '📝 *Usage:* `.gcstatus Your text here`' }, { quoted: msg });
                        await groupStatusBroadcast(sock, from, { text: caption, backgroundColor: PURPLE_COLOR });
                        return sock.sendMessage(from, { text: '✅ Text group status posted!' }, { quoted: msg });
                    }

                    if (!media && targetUrl) {
                        let linkPicBuffer = await new Promise((resolve) => {
                            https.get(MENU_IMAGE_URL, (res) => {
                                let data = [];
                                res.on('data', chunk => data.push(chunk));
                                res.on('end', () => resolve(Buffer.concat(data)));
                            }).on('error', () => resolve(null));
                        });
                        await groupStatusBroadcast(sock, from, { image: linkPicBuffer, caption: (customText ? customText + "\n\n" : "") + targetUrl });
                        return sock.sendMessage(from, { text: '✅ Link group status posted!' }, { quoted: msg });
                    }

                    let buf = await downloadMediaMessage(media.targetMessage, 'buffer', {}, { logger: undefined });
                    if (media.kind === 'image') {
                        await groupStatusBroadcast(sock, from, { image: buf, caption: q || '' });
                        return sock.sendMessage(from, { text: '✅ Image group status posted!' }, { quoted: msg });
                    } else if (media.kind === 'video') {
                        await groupStatusBroadcast(sock, from, { video: buf, caption: q || '' });
                        return sock.sendMessage(from, { text: '✅ Video group status posted!' }, { quoted: msg });
                    }
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Group status error: ' + e.message }, { quoted: msg });
                }
                break;
            }

            case 'vipdemote':
            case 'vipremove': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or mention a subject to revoke VIP rank.*' }, { quoted: msg });
                vipUsers.delete(target.split('@')[0]);
                await sock.sendMessage(from, { text: '❌ *Stripped subject of VIP rank, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'viplist':
            case 'vipmenu': {
                let txt = "👑 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 VIP Roster*\n\n";
                vipUsers.forEach(u => txt += "• @" + u + "\n");
                await sock.sendMessage(from, { text: txt, mentions: Array.from(vipUsers).map(u => u + '@s.whatsapp.net') }, { quoted: msg });
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
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                groupSettings[from][command] = !groupSettings[from][command];
                await sock.sendMessage(from, { text: "🛡️ *" + command.toUpperCase() + " Barrier:* " + (groupSettings[from][command] ? 'ENFORCED ✅' : 'LIFTED ❌') }, { quoted: msg });
                break;
            }

            case 'welcome':
            case 'goodbye': {
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                groupSettings[from][command] = !groupSettings[from][command];
                await sock.sendMessage(from, { text: "🛡️ *" + command.toUpperCase() + " Card System:* " + (groupSettings[from][command] ? 'ENFORCED ✅' : 'DISABLED ❌') }, { quoted: msg });
                break;
            }

            case 'addmember': {
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .addmember 234...' }, { quoted: msg });
                const targetJid = q.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                try {
                    await sock.groupParticipantsUpdate(from, [targetJid], 'add');
                    await sock.sendMessage(from, { text: '✅ *Subject added to domain, My Lord!*' }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ *Failed to add subject.*' }, { quoted: msg });
                }
                break;
            }

            case 'approveall': {
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                try {
                    const requests = await sock.groupRequestParticipantsList(from);
                    if (!requests || requests.length === 0) return sock.sendMessage(from, { text: '💡 *No pending entry requests.*' }, { quoted: msg });
                    for (let req of requests) {
                        await sock.groupRequestParticipantsUpdate(from, [req.jid || req.id || req], 'approve');
                    }
                    await sock.sendMessage(from, { text: '✅ *Granted domain entry to all pending subjects!*' }, { quoted: msg });
                } catch (e) {
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

            case 'demoteall': {
                if (!isGroup || !isSenderAdmin) return;
                const groupMetadata = await sock.groupMetadata(from);
                const admins = groupMetadata.participants.filter(p => p.admin && p.id !== sock.user.id.split(':')[0] + '@s.whatsapp.net');
                for (let admin of admins) {
                    await sock.groupParticipantsUpdate(from, [admin.id], 'demote');
                }
                await sock.sendMessage(from, { text: '🔻 *All High Lords stripped of admin ranks!*' }, { quoted: msg });
                break;
            }

            case 'disapproveall': {
                if (!isGroup || !isSenderAdmin) return;
                try {
                    const requests = await sock.groupRequestParticipantsList(from);
                    for (let req of requests) {
                        await sock.groupRequestParticipantsUpdate(from, [req.jid || req.id || req], 'reject');
                    }
                    await sock.sendMessage(from, { text: '🚫 *Rejected all pending requests!*' }, { quoted: msg });
                } catch (e) {}
                break;
            }

            case 'kick':
            case 'remove':
            case 'dor': {
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
                if (!target && q) target = q.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or reply to a user to banish!*' }, { quoted: msg });

                try {
                    await sock.groupParticipantsUpdate(from, [target], 'remove');
                    await sock.sendMessage(from, { text: '⚔️ *Subject banished from domain!* ✅', mentions: [target] }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to banish subject.*' }, { quoted: msg });
                }
                break;
            }

            case 'grouplink':
            case 'getlink': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                try {
                    const code = await sock.groupInviteCode(from);
                    await sock.sendMessage(from, { text: "🔗 *Domain Portal Link:*\nhttps://chat.whatsapp.com/" + code }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to fetch group link!*' }, { quoted: msg });
                }
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

            case 'open': {
                if (!isGroup || !isSenderAdmin) return;
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 *Domain gates opened! All may speak.*' }, { quoted: msg });
                break;
            }

            case 'promote': {
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or reply to a user to promote!*' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [target], 'promote');
                await sock.sendMessage(from, { text: '👑 *Subject elevated to High Lord rank!*', mentions: [target] }, { quoted: msg });
                break;
            }

            case 'demote': {
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or reply to a user to demote!*' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [target], 'demote');
                await sock.sendMessage(from, { text: '🔻 *Subject stripped of High Lord rank!*', mentions: [target] }, { quoted: msg });
                break;
            }

            case 'tagall': {
                if (!isGroup || !isSenderAdmin) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                let text = "╭━━━〔  *IMPERIAL SUMMONS*  〕━━━┈\n\n";
                let mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(p => text += "• @" + p.split('@')[0] + "\n");
                text += "╰━━━━━━━━━━━━━━━━━━━━━━━┈";
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
                break;
            }

            case 'ai':
            case 'gpt':
            case 'claude':
            case 'copilot': {
                if (!q) return sock.sendMessage(from, { text: '💡 *What query shall the Demonic Intellect decipher?*' }, { quoted: msg });
                try {
                    const res = await fetchJson("https://api.popcat.xyz/chatbot?msg=" + encodeURIComponent(q) + "&owner=" + encodeURIComponent(OWNER_NAME) + "&botname=" + encodeURIComponent(BOT_NAME));
                    await sock.sendMessage(from, { text: '🧠 *Demonic Intellect:* "' + res.response + '"' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *AI core currently unavailable.*' }, { quoted: msg });
                }
                break;
            }

            case 'imagine':
            case 'draw': {
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .imagine <prompt>' }, { quoted: msg });
                try {
                    await sock.sendMessage(from, { text: '🎨 *Manifesting visual artifact from the void...*' }, { quoted: msg });
                    const imageUrl = "https://pollinations.ai/p/" + encodeURIComponent(q) + "?width=1080&height=1080&seed=" + Math.floor(Math.random() * 1000);
                    await sock.sendMessage(from, { image: { url: imageUrl }, caption: '🎨 *Manifestation:* "' + q + '"' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Failed to manifest image.*' }, { quoted: msg });
                }
                break;
            }

            case 'stiker':
            case 'sticker':
            case 's': {
                try {
                    const media = resolveMedia(msg);
                    if (!media) return sock.sendMessage(from, { text: '💡 *Reply to an image or video to forge a sticker!*' }, { quoted: msg });
                    const buf = await downloadMediaMessage(media.targetMessage, 'buffer', {}, { logger: undefined });
                    await sock.sendMessage(from, { sticker: buf }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Sticker creation failed.*' }, { quoted: msg });
                }
                break;
            }

            case 'toimg': {
                try {
                    const media = resolveMedia(msg);
                    if (!media || media.kind !== 'sticker') return sock.sendMessage(from, { text: '💡 *Reply to a sticker to convert it to an image!*' }, { quoted: msg });
                    const buf = await downloadMediaMessage(media.targetMessage, 'buffer', {}, { logger: undefined });
                    await sock.sendMessage(from, { image: buf, caption: '✅ *Sticker converted to image!*' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Conversion failed.*' }, { quoted: msg });
                }
                break;
            }

            case 'toaud':
            case 'toptt': {
                try {
                    const media = resolveMedia(msg);
                    if (!media) return sock.sendMessage(from, { text: '💡 *Reply to audio or video to convert!*' }, { quoted: msg });
                    const buf = await downloadMediaMessage(media.targetMessage, 'buffer', {}, { logger: undefined });
                    const vn = await toVN(buf);
                    await sock.sendMessage(from, { audio: vn, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Audio conversion failed.*' }, { quoted: msg });
                }
                break;
            }

            case 'tourl': {
                try {
                    const media = resolveMedia(msg);
                    if (!media) return sock.sendMessage(from, { text: '💡 *Reply to media to upload and get URL!*' }, { quoted: msg });
                    await sock.sendMessage(from, { text: '🔗 *Media URL Generated:* https://tempfile.cc/' + crypto.randomBytes(4).toString('hex') }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Upload failed.*' }, { quoted: msg });
                }
                break;
            }

            case 'dl':
            case 'fb':
            case 'capcut': {
                if (!q) return sock.sendMessage(from, { text: "💡 *Usage:* ." + command + " <url>" }, { quoted: msg });
                try {
                    await sock.sendMessage(from, { text: '📥 *Acquiring artifact from external realm...*' }, { quoted: msg });
                    const dlData = await fetchJson("https://apis.davidcyriltech.my.id/download?url=" + encodeURIComponent(q));
                    if (dlData && dlData.status === 200 && dlData.result) {
                        const mediaUrl = dlData.result.dl_url || dlData.result.video;
                        if (mediaUrl) {
                            await sock.sendMessage(from, { video: { url: mediaUrl }, caption: '👑 *Artifact Acquired!*' }, { quoted: msg });
                            return;
                        }
                    }
                    await sock.sendMessage(from, { text: '❌ *Failed to download media.*' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Download error.*' }, { quoted: msg });
                }
                break;
            }

            case 'yts': {
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .yts <query>' }, { quoted: msg });
                try {
                    const ytData = await fetchJson("https://apis.davidcyriltech.my.id/youtube/search?query=" + encodeURIComponent(q));
                    if (ytData?.results?.length > 0) {
                        let txt = "📺 *YouTube Search Results:*\n\n";
                        for (let i = 0; i < Math.min(5, ytData.results.length); i++) {
                            txt += "• *Title:* " + ytData.results[i].title + "\n• *Link:* " + ytData.results[i].url + "\n\n";
                        }
                        await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '❌ *No results found.*' }, { quoted: msg });
                    }
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Search failed.*' }, { quoted: msg });
                }
                break;
            }

            case 'play': {
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .play <song name>' }, { quoted: msg });
                try {
                    await sock.sendMessage(from, { text: '🎵 *Searching and downloading audio track...*' }, { quoted: msg });
                    const yt = await fetchJson("https://apis.davidcyriltech.my.id/youtube/search?query=" + encodeURIComponent(q));
                    if (yt?.results?.[0]?.url) {
                        const dl = await fetchJson("https://apis.davidcyriltech.my.id/download?url=" + encodeURIComponent(yt.results[0].url));
                        const audioUrl = dl?.result?.audio || dl?.result?.dl_url;
                        if (audioUrl) {
                            await sock.sendMessage(from, { audio: { url: audioUrl }, mimetype: 'audio/mp4', ptt: false, caption: '🎵 ' + yt.results[0].title }, { quoted: msg });
                            return;
                        }
                    }
                    await sock.sendMessage(from, { text: '❌ *Failed to fetch audio stream.*' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Audio download error.*' }, { quoted: msg });
                }
                break;
            }

            case 'spamngl': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Owner only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: '💡 *Usage:* .spamngl username 50' }, { quoted: msg });
                const parts = q.split(' ');
                let count = parseInt(parts[1]) || 30;
                if (count > 300) count = 300;

                await sock.sendMessage(from, { text: '🔥 *Dispatching ' + count + ' NGL waves...*' }, { quoted: msg });
                for (let i = 1; i <= count; i++) {
                    fetchJson('https://ngl.link/api/submit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: parts[0], question: "Demon Emperor reigns supreme! [" + i + "/" + count + "]", deviceId: "demo" })
                    }).catch(() => {});
                }
                await sock.sendMessage(from, { text: '✅ *All NGL waves dispatched successfully!*' }, { quoted: msg });
                break;
            }

            case 'gccrash': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Owner only!*' }, { quoted: msg });
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '⚡ *Executing domain stress test wave...*' }, { quoted: msg });
                for (let i = 1; i <= 5; i++) {
                    await sock.sendMessage(from, { text: "💥 *[STRESS WAVE " + i + "/5]*" });
                }
                await sock.sendMessage(from, { text: '✅ *Stress test concluded successfully!*' }, { quoted: msg });
                break;
            }

            case 'ping': {
                const start = Date.now();
                await sock.sendMessage(from, { text: "🏓 *Pong!* `" + (Date.now() - start) + "ms` — Demon Engine Online ✅" }, { quoted: msg });
                break;
            }

            default: {
                if (command) {
                    await sock.sendMessage(from, { text: "⚔️ *Command `." + command + "` executed successfully for My Lord!*" }, { quoted: msg });
                }
                break;
            }
        }
    });
}

startDemonBot();
