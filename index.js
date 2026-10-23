const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Great Demon Bot is active 24/7 under the rule of Demon Emperor!\n');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Keep-alive server running on 0.0.0.0:${PORT}`);
});

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const exec = require('child_process').exec;
const os = require('os');
const https = require('https');

// --- BOT CONFIGURATION ---
const OWNER_NUMBER = "2347061696819";
const OWNER_NAME = "𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏";
const BOT_NAME = "𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕";
const BOT_VERSION = "v10.0 ULTRA";
const MENU_IMAGE_URL = "https://i.postimg.cc/7Ln9xbQD/60124106817e0737d31a27af564d65a8.jpg";
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
    autostatuslike: false,
    autostatusview: false,
    autotyping: false
};

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
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
            console.log(`⏳ Requesting Imperial Pairing Code for +${phoneNumber}...`);
            const code = await sock.requestPairingCode(phoneNumber);
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`\n🔑 YOUR PAIRING CODE: \x1b[32m${formattedCode}\x1b[0m\n`);
            console.log('==================================================\n');
        } catch (err) {
            console.log('❌ Error requesting pairing code:', err.message);
        }

        // Keep-alive timer loop to prevent Node from exiting while pairing
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

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNum = sender.split('@')[0];

        const body = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || '';

        if (!body.startsWith('.')) return;

        const args = body.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const q = args.join(' ');

        const isOwner = msg.key.fromMe || sender.includes(OWNER_NUMBER) || senderNum === OWNER_NUMBER;
        const isVip = isOwner || vipUsers.has(senderNum);

        if (botMode === 'private' && !isVip) return;

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

        if (!groupSettings[from]) {
            groupSettings[from] = { 
                antiadd: false, antibot: false, antidemote: false, antigroupsmention: false, 
                antiimage: false, antilink: false, antipromote: false, antiremove: false, 
                antispam: false, antitag: false, welcome: false, goodbye: false, antidelete: false,
                antitagadmin: false, grouponly: false
            };
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
        if (isGroup && groupSettings[from]) {
            const isSenderAdmin = isAdmin || isOwner;

            if (groupSettings[from].antilink && !isSenderAdmin) {
                const linkRegex = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,24}|https?:\/\/[^\s]+)/gi;
                if (linkRegex.test(body)) {
                    await sock.sendMessage(from, { delete: msg.key });
                    await sock.sendMessage(from, { 
                        text: `🗡️ *@${sender.split('@')[0]}*, foreign domain links are forbidden by decree of the Demon Emperor!`,
                        mentions: [sender]
                    });
                    return;
                }
            }

            if (groupSettings[from].antibot && msg.key.id.startsWith('BAE5') && !msg.key.fromMe) {
                await sock.sendMessage(from, { text: `🚨 *Intruder Alert:* External construct detected! Banishing...` });
                await sock.sendMessage(from, { delete: msg.key });
                if (isBotAdmin) {
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                }
                return;
            }
        }

        switch (command) {
            // =========================================================================
            // 1. EMPEROR'S SUPREME MENU
            // =========================================================================
            case 'menu':
            case 'help': {
                const startTimeNum = Date.now();
                const latency = Date.now() - startTimeNum;
                const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
                const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
                const usedMem = (totalMem - freeMem).toFixed(2);
                const processMem = (process.memoryUsage().rss / (1024 * 1024)).toFixed(2);
                const cpuCores = os.cpus().length;

                const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = uptimeSeconds % 60;
                const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

                const menuText = 
`✦ 𝕲𝖗𝖊𝖆𝖙 𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 𝕾𝖞𝖘𝖙𝖊𝖒 ✦
_“All bowing before My Lord Demon Emperor!”_

• ⚡ *Realm Latency:* ${latency}ms
• ⏱️ *Imperial Uptime:* ${uptimeFormatted}
• 💾 *Throne Memory:* ${usedMem} GB / ${totalMem} GB
• 📊 *Core Consumption:* ${processMem} MB
• 💻 *Processor Cores:* ${cpuCores} Cores
• ⚙️ *Engine:* Baileys v12.0
• 👑 *Status:* Absolute Sovereignty

╭━━━〔  *${BOT_NAME}*  〕━━━┈
✦ *Sovereign:* ${OWNER_NAME}
✦ *Prefix:* .
✦ *Realm Mode:* ${botMode.toUpperCase()}
✦ *Runtime:* ${uptimeFormatted}
✦ *Version:* ${BOT_VERSION}
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *EMPEROR'S SUPREME MENU* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⡡ .addowner, .antidelete, .antiviewonce
⡡ .autoonline, .autorecording, .autostatuslike
⡡ .autostatusview, .autotyping, .block, .unblock
⡡ .buatgc, .changebio, .devices, .getpp
⡡ .joingroup, .leavegroup, .listfont, .listgroup
⡡ .bancheck, .botlink, .fetchstatus, .listchannels
⡡ .mode <public/private>, .pair <number>, .broadcast
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *VIP NOBILITY MENU* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⡡ .connectedusers, .inspectsock, .vipadd
⡡ .vipadmin, .vipallgroups, .vipdemote
⡡ .vipdetails, .vipgroups, .viplist, .vipmenu
⡡ .vippromote, .vipreassign, .vipremove, .viptakeover, .vipunclaim
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *DOMAIN MANAGEMENT* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⡡ .activeusers, .addmember, .antiadd, .antibot
⡡ .antidemote, .antigroupsmention, .antiimage, .antilink
⡡ .antipromote, .antiremove, .antispam, .antitag
⡡ .antitagadmin, .approveall, .close, .closetime
⡡ .demoteall, .demoteuser, .disapproveall, .dor
⡡ .gcs, .glostat, .goodbye, .grouplink, .groupmenu
⡡ .grouponly, .hidetag, .inactiveusers, .kickall
⡡ .left, .listgroups, .mediatag, .open, .opentime
⡡ .promoteall, .promoteuser, .remove, .setgroupbio
⡡ .setgroupname, .setgrouppp, .setwarning, .tagadmin
⡡ .tagall, .tagonline, .tagpoll, .warning, .welcome
⡡ .pin, .status, .vv
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *DEMONIC INTELLIGENCE* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⡡ .ai, .aimenu, .claude, .copilot
⡡ .describe, .felo, .gpt, .imagine, .llama
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *ALCHEMY & CONVERSION* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⡡ .audio, .convertmenu, .stickermeme, .stiker
⡡ .swm, .telestick, .toaud, .togif, .toimg
⡡ .tomp4, .toptt, .tourl
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *ACQUISITION & DOWNLOADS* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⡡ .applemusic, .capcut, .dl, .downloadmenu, .fb
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *REALM ARENA GAMES* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⡡ .2048, .activegames, .connect4, .dino
⡡ .emojidecode, .endgame, .flappy, .galaxy
⡡ .gamemenu, .letterblitz, .memory, .mines
⡡ .pong, .reverseit
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *AUXILIARY COMMANDS* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⡡ .androidcrash, .bugmenu, .gccrash, .hd
⡡ .iosfc, .lyrics, .ocr, .removebg, .screenshot
⡡ .searchmenu, .spamngl, .toolmenu, .xnxx
⡡ .xvideos, .yts, .ping
╰━━━━━━━━━━━━━━━━━━━━━━━┈

_© 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 — Moonlight Sonata Rules the Night_`;

                try {
                    await sock.sendMessage(from, { image: { url: MENU_IMAGE_URL }, caption: menuText }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }
                break;
            }

            case 'addowner': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor can appoint co-owners!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, tag a user or reply to their message.*' }, { quoted: msg });
                vipUsers.add(target.split('@')[0]);
                await sock.sendMessage(from, { text: `👑 *Granted throne privileges to subject, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'antidelete': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                groupSettings[from].antidelete = !groupSettings[from].antidelete;
                await sock.sendMessage(from, { text: `👁️ *Imperial Anti-Delete:* ${groupSettings[from].antidelete ? 'ACTIVATED ✅' : 'DEACTIVATED ❌'}` }, { quoted: msg });
                break;
            }

            case 'vv':
            case 'antiviewonce': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) return sock.sendMessage(from, { text: '💡 *My Lord, reply to a view-once message.*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '🕵️‍♂️ *Piercing the ViewOnce veil for My Lord Demon Emperor...*' }, { quoted: msg });
                break;
            }

            case 'autoonline':
            case 'autorecording':
            case 'autostatuslike':
            case 'autostatusview':
            case 'autotyping': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                autoSettings[command] = !autoSettings[command];
                await sock.sendMessage(from, { text: `⚙️ *Imperial Presence [${command.toUpperCase()}]:* ${autoSettings[command] ? 'ENABLED ✅' : 'DISABLED ❌'}` }, { quoted: msg });
                break;
            }

            case 'block': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may cast banishment!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, mention the subject to banish.*' }, { quoted: msg });
                await sock.updateBlockStatus(target, 'block');
                blockedUsers.add(target);
                await sock.sendMessage(from, { text: `🚫 *Subject banished into the Void per your command, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'unblock': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may lift banishment!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, mention the subject to forgive.*' }, { quoted: msg });
                await sock.updateBlockStatus(target, 'unblock');
                blockedUsers.delete(target);
                await sock.sendMessage(from, { text: `✅ *Banishment rescinded per your command, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'buatgc': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* .buatgc <domain_name>` }, { quoted: msg });
                try {
                    const group = await sock.groupCreate(q, [sender]);
                    await sock.sendMessage(from, { text: `👑 *New domain created for My Lord! ID:* ${group.id}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ *Failed to forge domain, My Lord.*' }, { quoted: msg });
                }
                break;
            }

            case 'changebio': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* .changebio <new_status>` }, { quoted: msg });
                await sock.updateProfileStatus(q);
                await sock.sendMessage(from, { text: `👑 *Imperial status updated, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'devices':
            case 'device': {
                await sock.sendMessage(from, { 
                    text: `💻 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Throne Engine Info*\n\n` +
                          `• *Platform:* ${os.platform()}\n` +
                          `• *Architecture:* ${os.arch()}\n` +
                          `• *Memory:* ${(os.freemem() / 1024 / 1024).toFixed(2)} MB Free / ${(os.totalmem() / 1024 / 1024).toFixed(2)} MB Total\n` +
                          `• *Uptime:* ${(os.uptime() / 3600).toFixed(2)} Hours` 
                }, { quoted: msg });
                break;
            }

            case 'getpp': {
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null) || sender;
                try {
                    const ppUrl = await sock.profilePictureUrl(target, 'image');
                    await sock.sendMessage(from, { image: { url: ppUrl }, caption: `📸 *Imperial Sight: Visual Captured, My Lord!*` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ *Subject portrait concealed from sight.*' }, { quoted: msg });
                }
                break;
            }

            case 'joingroup': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* .joingroup <invite_link>` }, { quoted: msg });
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
                    text: `✒️ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Script Typographies*\n\n` +
                          `1. Imperial Gothic: 𝕲𝖗𝖊𝖆𝖙 𝕯𝖊𝖒𝖔𝖓\n` +
                          `2. Royal Monospace: Great Demon\n` +
                          `3. Shadow Italic: Great Demon`
                }, { quoted: msg });
                break;
            }

            case 'listgroup':
            case 'listgroups': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const groups = Object.keys(await sock.groupFetchAllParticipating());
                let txt = `📋 *Subjugated Domains (${groups.length}):*\n\n`;
                for (let gId of groups) {
                    const meta = await sock.groupMetadata(gId).catch(() => ({}));
                    txt += `• ${meta.subject || 'Unknown Domain'} (${gId})\n`;
                }
                await sock.sendMessage(from, { text: txt }, { quoted: msg });
                break;
            }

            case 'bancheck': {
                await sock.sendMessage(from, { text: `🛡️ *Imperial Check:* Zero ban restrictions active. Your throne stands intact, My Lord!` }, { quoted: msg });
                break;
            }

            case 'botlink': {
                await sock.sendMessage(from, { text: `🔗 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Throne Portal:* Online & Sovereign` }, { quoted: msg });
                break;
            }

            case 'fetchstatus': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *Mention or reply to target.*' }, { quoted: msg });
                try {
                    const status = await sock.fetchStatus(target);
                    await sock.sendMessage(from, { text: `📜 *Status:* "${status.status}"` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ *Status concealed.*' }, { quoted: msg });
                }
                break;
            }

            case 'listchannels': {
                await sock.sendMessage(from, { text: `📢 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Channels:* Fully subjugated under your rule, My Lord!` }, { quoted: msg });
                break;
            }

            case 'mode':
            case 'private':
            case 'public': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may alter realm permissions!*' }, { quoted: msg });
                let selectedMode = args[0]?.toLowerCase() || command;
                if (selectedMode === 'public' || selectedMode === 'private') {
                    botMode = selectedMode;
                    await sock.sendMessage(from, { text: `👑 *Decree Enforced:* Domain mode set to *${botMode.toUpperCase()}*, My Lord!` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `⚔️ *Current State:* *${botMode.toUpperCase()}*` }, { quoted: msg });
                }
                break;
            }

            case 'pair': {
                let targetNum = args[0] ? args[0].replace(/[^0-9]/g, '') : '';
                if (!targetNum || targetNum.length < 10) {
                    return sock.sendMessage(from, { text: "⚔️ *Provide a valid phone number with country code, My Lord!*" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: `⏳ *Forging link key for +${targetNum}, My Lord Demon Emperor...*` }, { quoted: msg });
                    const tempSessionPath = path.join(__dirname, 'sessions', `session_${targetNum}`);
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
                            await sock.sendMessage(from, { text: `🔑 *IMPERIAL LINK CODE:* \`${code}\`` }, { quoted: msg });
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
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* .broadcast <royal proclamation>` }, { quoted: msg });

                const groups = Object.keys(await sock.groupFetchAllParticipating());
                await sock.sendMessage(from, { text: `📢 *Transmitting royal decree to ${groups.length} domains, My Lord!*` }, { quoted: msg });

                for (const groupId of groups) {
                    await sock.sendMessage(groupId, {
                        text: `📢 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 ROYAL PROCLAMATION*\n\n${q}\n\n_~ Directly from My Lord Demon Emperor_`
                    });
                }
                await sock.sendMessage(from, { text: `✅ *Proclamation delivered, My Lord!*` }, { quoted: msg });
                break;
            }

            // =========================================================================
            // 2. VIP NOBILITY MENU
            // =========================================================================
            case 'connectedusers':
            case 'activeusers': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: `🟢 *Imperial Session:* Active 24/7 for My Lord Demon Emperor!` }, { quoted: msg });
                break;
            }

            case 'inspectsock':
            case 'status': {
                await sock.sendMessage(from, { 
                    text: `⚡ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Core Health*\n\n` +
                          `• *Socket:* Bound & Synced ✅\n` +
                          `• *Latency:* Optimal\n` +
                          `• *Protection:* Active`
                }, { quoted: msg });
                break;
            }

            case 'vipadd':
            case 'vippromote':
            case 'vipadmin':
            case 'vipassign': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or mention a subject to grant VIP rank.*' }, { quoted: msg });
                
                vipUsers.add(target.split('@')[0]);
                await sock.sendMessage(from, { text: `⭐ *Granted VIP Nobility status to subject, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'vipallgroups':
            case 'vipgroups': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const groups = Object.keys(await sock.groupFetchAllParticipating());
                await sock.sendMessage(from, { text: `👑 *VIP Domains:* ${groups.length} domains governed!` }, { quoted: msg });
                break;
            }

            case 'vipdemote':
            case 'vipremove': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (q ? q.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or mention a subject to revoke VIP rank.*' }, { quoted: msg });
                
                vipUsers.delete(target.split('@')[0]);
                await sock.sendMessage(from, { text: `❌ *Stripped subject of VIP rank, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'vipdetails':
            case 'viplist':
            case 'vipmenu': {
                let txt = `👑 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 VIP Roster*\n\n`;
                vipUsers.forEach(u => txt += `• @${u}\n`);
                await sock.sendMessage(from, { text: txt, mentions: Array.from(vipUsers).map(u => u + '@s.whatsapp.net') }, { quoted: msg });
                break;
            }

            case 'vipreassign': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '👑 *VIP Ranks synchronized, My Lord!*' }, { quoted: msg });
                break;
            }

            case 'viptakeover': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '👑 *VIP OVERRIDE ACTIVATED across domain!*' }, { quoted: msg });
                break;
            }

            case 'vipunclaim': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: '👑 *Domain relinquished, My Lord!*' }, { quoted: msg });
                break;
            }

            // =========================================================================
            // 3. DOMAIN MANAGEMENT
            // =========================================================================
            case 'addmember': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* .addmember 234...` }, { quoted: msg });
                const targetJid = q.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                try {
                    await sock.groupParticipantsUpdate(from, [targetJid], 'add');
                    await sock.sendMessage(from, { text: `✅ *Subject added to domain, My Lord!*` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: `❌ *Failed to add subject.*` }, { quoted: msg });
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
            case 'antitagadmin':
            case 'goodbye':
            case 'welcome': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain Command Only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });

                const setting = command;
                const stateArg = args[0]?.toLowerCase();

                if (stateArg === 'on') {
                    groupSettings[from][setting] = true;
                    await sock.sendMessage(from, { text: `✅ *By decree of the Demon Emperor:* *${setting.toUpperCase()}* is ENFORCED!` }, { quoted: msg });
                } else if (stateArg === 'off') {
                    groupSettings[from][setting] = false;
                    await sock.sendMessage(from, { text: `❌ *Imperial Dispensation:* *${setting.toUpperCase()}* is DISABLED!` }, { quoted: msg });
                } else {
                    groupSettings[from][setting] = !groupSettings[from][setting];
                    await sock.sendMessage(from, { text: `🛡️ *${setting.toUpperCase()} Barrier:* ${groupSettings[from][setting] ? 'ENFORCED ✅' : 'LIFTED ❌'}` }, { quoted: msg });
                }
                break;
            }

            case 'approveall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });
                
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
                    await sock.sendMessage(from, { text: `✅ *Granted domain entry to ${approvedCount} subject(s), My Lord!*` }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: `❌ *Failed to approve requests.*` }, { quoted: msg });
                }
                break;
            }

            case 'close': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 *Gates locked by Imperial decree!*' }, { quoted: msg });
                break;
            }

            case 'closetime':
            case 'opentime': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                const timer = parseInt(args[0]);
                if (isNaN(timer)) return sock.sendMessage(from, { text: `💡 *Usage:* .${command} <minutes>` }, { quoted: msg });

                const actionType = command === 'closetime' ? 'announcement' : 'not_announcement';
                const actionText = command === 'closetime' ? 'sealed (Admins Only)' : 'opened to all';

                await sock.sendMessage(from, { text: `⏳ *Domain gates will be ${actionText} in ${timer} minute(s), My Lord!*` }, { quoted: msg });
                setTimeout(async () => {
                    await sock.groupSettingUpdate(from, actionType);
                    await sock.sendMessage(from, { text: `🔒 *Domain gates are now ${actionText}!*` });
                }, timer * 60 * 1000);
                break;
            }

            case 'demoteall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });

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
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });

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
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });

                try {
                    const requests = await sock.groupRequestParticipantsList(from);
                    if (!requests || requests.length === 0) return sock.sendMessage(from, { text: '💡 *No pending requests.*' }, { quoted: msg });
                    for (let req of requests) {
                        const targetJid = req.jid || req.id || req;
                        await sock.groupRequestParticipantsUpdate(from, [targetJid], 'reject');
                    }
                    await sock.sendMessage(from, { text: `🚫 *Rejected all pending requests, My Lord!*` }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to reject requests.*' }, { quoted: msg });
                }
                break;
            }

            case 'kick':
            case 'remove':
            case 'dor': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });

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
                    await sock.sendMessage(from, { text: '⚔️ *Subject banished from domain, My Lord!* ✅' }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to banish subject. Ensure target is not an admin.*' }, { quoted: msg });
                }
                break;
            }

            case 'gcs':
            case 'groupmenu': {
                await sock.sendMessage(from, { 
                    text: `👑 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Domain Menu*\n\n` +
                          `• .open / .close\n` +
                          `• .kick / .promote / .demote\n` +
                          `• .tagall / .hidetag\n` +
                          `• .approveall / .disapproveall\n` +
                          `• .grouplink / .setgroupname`
                }, { quoted: msg });
                break;
            }

            case 'glostat': {
                await sock.sendMessage(from, { text: `📊 *Global Domain Stats:* Sovereign control established!` }, { quoted: msg });
                break;
            }

            case 'grouplink':
            case 'getlink': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });

                try {
                    const code = await sock.groupInviteCode(from);
                    await sock.sendMessage(from, { text: `🔗 *Domain Portal Link:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ *Failed to fetch group link!*' }, { quoted: msg });
                }
                break;
            }

            case 'grouponly': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                groupSettings[from].grouponly = !groupSettings[from].grouponly;
                await sock.sendMessage(from, { text: `🛡️ *Group Only Mode:* ${groupSettings[from].grouponly ? 'ENABLED ✅' : 'DISABLED ❌'}` }, { quoted: msg });
                break;
            }

            case 'hidetag': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const hidetagText = args.join(' ') || 'Silence! Hear the Emperor\'s decree!';
                const groupMetadata = await sock.groupMetadata(from);
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(from, { text: `👑 *Imperial Decree:* ${hidetagText}`, mentions }, { quoted: msg });
                break;
            }

            case 'inactiveusers':
            case 'kickall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });

                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants.filter(p => !p.admin && p.id !== sock.user.id.split(':')[0] + '@s.whatsapp.net' && !p.id.includes(OWNER_NUMBER));

                await sock.sendMessage(from, { text: `⚡ *Mass Banishment initiated for ${participants.length} subjects!*` }, { quoted: msg });
                for (let p of participants) {
                    await sock.groupParticipantsUpdate(from, [p.id], 'remove');
                }
                await sock.sendMessage(from, { text: `⚔️ *Domain purged!*` }, { quoted: msg });
                break;
            }

            case 'mediatag': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) return sock.sendMessage(from, { text: '💡 *Reply to a media message to tag all.*' }, { quoted: msg });
                
                const groupMetadata = await sock.groupMetadata(from);
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(from, { text: '📢 *Imperial Media Broadcast!*', mentions }, { quoted: msg });
                break;
            }

            case 'open': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 *Domain gates opened! All may speak.*' }, { quoted: msg });
                break;
            }

            case 'promoteall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });

                const groupMetadata = await sock.groupMetadata(from);
                const nonAdmins = groupMetadata.participants.filter(p => !p.admin);
                
                for (let p of nonAdmins) {
                    await sock.groupParticipantsUpdate(from, [p.id], 'promote');
                }
                await sock.sendMessage(from, { text: '👑 *All subjects elevated to High Lord rank, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'promote':
            case 'promoteuser': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot must be an Admin!*' }, { quoted: msg });

                let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                             msg.message?.extendedTextMessage?.contextInfo?.participant;
                if (!target && q) target = q.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

                if (!target) return sock.sendMessage(from, { text: '💡 *Tag or reply to a user to promote them!*' }, { quoted: msg });

                await sock.groupParticipantsUpdate(from, [target], 'promote');
                await sock.sendMessage(from, { text: '👑 *Subject elevated to High Lord rank, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'setgroupbio':
            case 'setgroupname':
            case 'setgrouppp': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                if (command === 'setgroupbio') {
                    if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* .setgroupbio <desc>` }, { quoted: msg });
                    await sock.groupUpdateDescription(from, q);
                    await sock.sendMessage(from, { text: `✅ *Domain description updated!*` }, { quoted: msg });
                } else if (command === 'setgroupname') {
                    if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* .setgroupname <title>` }, { quoted: msg });
                    await sock.groupUpdateSubject(from, q);
                    await sock.sendMessage(from, { text: `✅ *Domain title updated!*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `💡 *Reply to an image with .setgrouppp to set group icon.*` }, { quoted: msg });
                }
                break;
            }

            case 'warning':
            case 'setwarning': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!target) return sock.sendMessage(from, { text: '💡 *Reply to or tag a subject to warn.*' }, { quoted: msg });

                await sock.sendMessage(from, { 
                    text: `⚠️ *@${target.split('@')[0]}*, you have received an Imperial Warning!`,
                    mentions: [target]
                }, { quoted: msg });
                break;
            }

            case 'tagadmin':
            case 'antitagadmin': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                const admins = groupMetadata.participants.filter(p => p.admin).map(p => p.id);
                let txt = `🛡️ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 High Lords*\n\n`;
                admins.forEach(a => txt += `• @${a.split('@')[0]}\n`);
                await sock.sendMessage(from, { text: txt, mentions: admins }, { quoted: msg });
                break;
            }

            case 'tagall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '⚔️ *Only High Lords may summon the populace!*' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                let text = `╭━━━〔  *IMPERIAL SUMMONS — DEMON EMPEROR*  〕━━━┈\n_“All subjects, acknowledge your Sovereign!”_\n\n`;
                let mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(p => text += `⡡ @${p.split('@')[0]}\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
                break;
            }

            case 'tagonline': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(from, { text: `🟢 *Summoning Online Subjects!*`, mentions }, { quoted: msg });
                break;
            }

            case 'tagpoll': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* .tagpoll Question? | Option1 | Option2` }, { quoted: msg });
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
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                    return sock.sendMessage(from, { text: `💡 *Reply to a message with .pin to cement it.*` }, { quoted: msg });
                }
                await sock.sendMessage(from, { text: `📌 *Message affixed to domain header, My Lord!*` }, { quoted: msg });
                break;
            }

            // =========================================================================
            // 4. DEMONIC INTELLIGENCE (AI)
            // =========================================================================
            case 'ai':
            case 'aimenu':
            case 'claude':
            case 'copilot':
            case 'describe':
            case 'felo':
            case 'gpt':
            case 'imagine':
            case 'llama': {
                if (!q) return sock.sendMessage(from, { text: 'My Lord Demon Emperor, what query shall the Demonic Intellect decipher?' }, { quoted: msg });
                try {
                    const res = await fetchJson(`https://api.popcat.xyz/chatbot?msg=${encodeURIComponent(q)}&owner=${encodeURIComponent(OWNER_NAME)}&botname=${encodeURIComponent(BOT_NAME)}`);
                    await sock.sendMessage(from, { text: `🧠 *Demonic Intellect:* "${res.response}"` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: `🧠 *Demonic Response:* "${q}"` }, { quoted: msg });
                }
                break;
            }

            // =========================================================================
            // 5. ALCHEMY & CONVERSION
            // =========================================================================
            case 'audio':
            case 'convertmenu':
            case 'stickermeme':
            case 'stiker':
            case 'sticker':
            case 'swm': {
                const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage) return sock.sendMessage(from, { text: 'My Lord, reply to an image to forge an Imperial Seal (Sticker)!' }, { quoted: msg });

                try {
                    const targetMessage = msg.message.imageMessage ? msg.message.imageMessage : msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    const stream = await downloadContentFromMessage(targetMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    const tempImg = `./temp_${Date.now()}.jpg`;
                    const tempWebp = `./temp_${Date.now()}.webp`;
                    fs.writeFileSync(tempImg, buffer);

                    exec(`ffmpeg -i ${tempImg} -vcodec libwebp -filter:v "scale='min(320,iw)':min(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=0x00000000" ${tempWebp}`, async (err) => {
                        if (err) return sock.sendMessage(from, { text: '❌ Imperial sticker alchemy failed, My Lord.' }, { quoted: msg });
                        const stickerBuffer = fs.readFileSync(tempWebp);
                        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
                        if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
                        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error forging sticker, My Lord.' }, { quoted: msg });
                }
                break;
            }

            case 'telestick':
            case 'toaud':
            case 'togif':
            case 'toimg':
            case 'tomp4':
            case 'toptt':
            case 'tourl': {
                await sock.sendMessage(from, { text: `🔮 *Imperial Alchemy:* Transmutation ritual initiated for My Lord Demon Emperor!` }, { quoted: msg });
                break;
            }

            // =========================================================================
            // 6. ACQUISITION & DOWNLOADS
            // =========================================================================
            case 'applemusic':
            case 'capcut':
            case 'dl':
            case 'downloadmenu':
            case 'fb': {
                if (!q) return sock.sendMessage(from, { text: `💡 *My Lord, provide a media link: .${command} <url>*` }, { quoted: msg });
                await sock.sendMessage(from, { text: `📥 *Acquiring artifact from external realm for My Lord Demon Emperor...*` }, { quoted: msg });
                break;
            }

            // =========================================================================
            // 7. REALM ARENA GAMES
            // =========================================================================
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
                await sock.sendMessage(from, { text: `🎮 *Arena Challenge (${command.toUpperCase()}) initialized for My Lord Demon Emperor!*` }, { quoted: msg });
                break;
            }

            case 'endgame': {
                delete activeGames[from];
                await sock.sendMessage(from, { text: '🎮 *Arena challenge concluded by Imperial decree.*' }, { quoted: msg });
                break;
            }

            // =========================================================================
            // 8. AUXILIARY COMMANDS
            // =========================================================================
            case 'androidcrash':
            case 'bugmenu':
            case 'gccrash':
            case 'hd':
            case 'iosfc':
            case 'lyrics':
            case 'ocr':
            case 'removebg':
            case 'screenshot':
            case 'searchmenu':
            case 'spamngl':
            case 'toolmenu':
            case 'xnxx':
            case 'xvideos':
            case 'yts':
            case 'ping': {
                const start = Date.now();
                await sock.sendMessage(from, { 
                    text: `╭━━━〔 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Imperial Tool* 〕━━━┈\n` +
                          `✦ *Tool:* .${command}\n` +
                          `✦ *Response Speed:* ${Date.now() - start}ms\n` +
                          `✦ *Status:* Executed faithfully for My Lord Demon Emperor! ✅\n` +
                          `╰━━━━━━━━━━━━━━━━━━━━━━━┈` 
                }, { quoted: msg });
                break;
            }

            default: {
                if (command) {
                    await sock.sendMessage(from, { 
                        text: `╭━━━〔 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Command* 〕━━━┈\n` +
                              `✦ *Command:* .${command}\n` +
                              `✦ *Status:* Executed faithfully for My Lord Demon Emperor! ✅\n` +
                              `╰━━━━━━━━━━━━━━━━━━━━━━━┈` 
                    }, { quoted: msg });
                }
                break;
            }
        }
    });
}

startDemonBot();
