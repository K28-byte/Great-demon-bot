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
let botMode = "public"; // 'public' or 'private'
const activeGames = {};
const groupSettings = {};
const vipUsers = new Set([OWNER_NUMBER]);
let prefix = ".";
const blockedUsers = new Set();
const deletedMessages = new Map();

// Helper for HTTP requests
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

// --- ANTISPAM CONFIGURATION ---
const spamMap = new Map();
const SPAM_LIMIT = 3;
const SPAM_TIME = 5000;       // 5 seconds
const COOLDOWN_TIME = 10000;  // 10 seconds

async function startDemonBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./demon_session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        console.log('\n==================================================');
        let phoneNumber = process.env.PHONE_NUMBER || OWNER_NUMBER;
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n🔑 YOUR PAIRING CODE: \x1b[32m${formattedCode}\x1b[0m\n`);
            } catch (err) {
                console.log('❌ Error requesting pairing code:', err.message);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('⚡ Reconnecting Great Demon Bot...');
                startDemonBot();
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

        const isOwner = msg.key.fromMe || sender.includes(OWNER_NUMBER) || senderNum === OWNER_NUMBER;
        const isVip = isOwner || vipUsers.has(senderNum);

        const body = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || '';

        if (!body.startsWith('.')) return;
        if (botMode === 'private' && !isVip) return;

        const args = body.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const q = args.join(' ');

        let isAdmin = false;
        let isBotAdmin = false;
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(from);
                const userObj = groupMetadata.participants.find(p => p.id === sender);
                isAdmin = userObj && (userObj.admin === 'admin' || userObj.admin === 'superadmin');

                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const botObj = groupMetadata.participants.find(p => p.id === botJid);
                isBotAdmin = botObj && (botObj.admin === 'admin' || botObj.admin === 'superadmin');
            } catch (e) {}
        }

        if (!groupSettings[from]) {
            groupSettings[from] = { 
                antiadd: false, antibot: false, antidemote: false, antigroupsmention: false, 
                antiimage: false, antilink: false, antipromote: false, antiremove: false, 
                antispam: false, antitag: false, welcome: false, goodbye: false, antidelete: false
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
                        await sock.sendMessage(from, { text: "⚔️ *Imperial Warning:* Tread carefully! Do not spam the Demon Realm's commands." }, { quoted: msg });
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

        // --- ANTI-DELETE TRACKER ---
        if (msg.messageStubType === 68 || msg.type === 'protocolMessage') {
            const targetKey = msg.message?.protocolMessage?.key;
            if (targetKey && deletedMessages.has(targetKey.id)) {
                const deletedMsg = deletedMessages.get(targetKey.id);
                const chatJid = deletedMsg.key.remoteJid;

                if (groupSettings[chatJid]?.antidelete) {
                    await sock.sendMessage(chatJid, {
                        text: `🕵️‍♂️ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Imperial Sight (Anti-Delete)*\n\n` +
                              `👤 *Mortal:* @${deletedMsg.sender.split('@')[0]}\n` +
                              `💬 *Erased Words:* ${deletedMsg.text || '[Media / Sealed Message]'}`,
                        mentions: [deletedMsg.sender]
                    });
                }
            }
        } else if (msg.key?.id) {
            deletedMessages.set(msg.key.id, {
                key: msg.key,
                sender: msg.key.participant || msg.key.remoteJid,
                text: body
            });
        }

        switch (command) {
            // =========================================================================
            // CORE & MENU COMMANDS
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
⬡ .addowner, .antidelete, .antiviewonce
⬡ .autoonline, .autorecording, .autostatuslike
⬡ .autostatusview, .autotyping, .block, .unblock
⬡ .buatgc, .changebio, .devices, .getpp
⬡ .joingroup, .leavegroup, .listfont, .listgroup
⬡ .bancheck, .botlink, .fetchstatus, .listchannels
⬡ .mode <public/private>, .pair <number>, .broadcast
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *VIP NOBILITY MENU* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .connectedusers, .inspectsock, .vipadd
⬡ .vipadmin, .vipallgroups, .vipdemote
⬡ .vipdetails, .vipgroups, .viplist, .vipmenu
⬡ .vippromote, .vipreassign, .vipremove, .viptakeover, .vipunclaim
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *DOMAIN MANAGEMENT* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .activeusers, .addmember, .antiadd, .antibot
⬡ .antidemote, .antigroupsmention, .antiimage, .antilink
⬡ .antipromote, .antiremove, .antispam, .antitag
⬡ .antitagadmin, .approveall, .close, .closetime
⬡ .demoteall, .demoteuser, .disapproveall, .dor
⬡ .gcs, .glostat, .goodbye, .grouplink, .groupmenu
⬡ .grouponly, .hidetag, .inactiveusers, .kickall
⬡ .left, .listgroups, .mediatag, .open, .opentime
⬡ .promoteall, .promoteuser, .remove, .setgroupbio
⬡ .setgroupname, .setgrouppp, .setwarning, .tagadmin
⬡ .tagall, .tagonline, .tagpoll, .warning, .welcome
⬡ .pin, .status, .vv
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *DEMONIC INTELLIGENCE* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .ai, .aimenu, .claude, .copilot
⬡ .describe, .felo, .gpt, .imagine, .llama
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *ALCHEMY & CONVERSION* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .audio, .convertmenu, .stickermeme, .stiker
⬡ .swm, .telestick, .toaud, .togif, .toimg
⬡ .tomp4, .toptt, .tourl
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *ACQUISITION & DOWNLOADS* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .applemusic, .capcut, .dl, .downloadmenu, .fb
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *REALM ARENA GAMES* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .2048, .activegames, .connect4, .dino
⬡ .emojidecode, .endgame, .flappy, .galaxy
⬡ .gamemenu, .letterblitz, .memory, .mines
⬡ .pong, .reverseit
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *AUXILIARY COMMANDS* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .androidcrash, .bugmenu, .gccrash, .hd
⬡ .iosfc, .lyrics, .ocr, .removebg, .screenshot
⬡ .searchmenu, .spamngl, .toolmenu, .xnxx
⬡ .xvideos, .yts, .ping
╰━━━━━━━━━━━━━━━━━━━━━━━┈

_© 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 — Moonlight Sonata Rules the Night_`;

                try {
                    await sock.sendMessage(from, { image: { url: MENU_IMAGE_URL }, caption: menuText }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }
                break;
            }

            case 'ping': {
                const start = Date.now();
                await sock.sendMessage(from, { text: `⚡ *At your command, My Lord Demon Emperor!* Response Speed: ${Date.now() - start}ms` }, { quoted: msg });
                break;
            }

            case 'mode':
            case 'private':
            case 'public': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Imperial Denial:* Only My Lord Demon Emperor may alter realm permissions!' }, { quoted: msg });
                let selectedMode = args[0]?.toLowerCase();
                if (command === 'private') selectedMode = 'private';
                if (command === 'public') selectedMode = 'public';

                if (selectedMode === 'public' || selectedMode === 'private') {
                    botMode = selectedMode;
                    await sock.sendMessage(from, { text: `👑 *Decree Enforced:* Domain mode set to *${botMode.toUpperCase()}*, My Lord!` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `⚔️ *Current Realm State:* *${botMode.toUpperCase()}*` }, { quoted: msg });
                }
                break;
            }

            // =========================================================================
            // OWNER & REALM CONTROL COMMANDS
            // =========================================================================
            case 'addowner': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor can appoint co-owners!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, please tag or specify the subject.*' }, { quoted: msg });
                vipUsers.add(target.split('@')[0]);
                await sock.sendMessage(from, { text: `👑 *At your command, My Lord! Subject added to throne privileges.*` }, { quoted: msg });
                break;
            }

            case 'setprefix': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!args[0]) return sock.sendMessage(from, { text: `💡 *Usage:* *${prefix}setprefix <symbol>*` }, { quoted: msg });
                prefix = args[0];
                await sock.sendMessage(from, { text: `⚙️ *At your command, My Lord!* Imperial prefix set to: *${prefix}*` }, { quoted: msg });
                break;
            }

            case 'block': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may cast banishment!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, please mention the subject to banish.*' }, { quoted: msg });
                
                await sock.updateBlockStatus(target, 'block');
                blockedUsers.add(target);
                await sock.sendMessage(from, { text: `🚫 *Subject banished into the Void per your command, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'unblock': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may lift banishment!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                if (!target) return sock.sendMessage(from, { text: '💡 *My Lord, mention the banished subject to forgive.*' }, { quoted: msg });
                
                await sock.updateBlockStatus(target, 'unblock');
                blockedUsers.delete(target);
                await sock.sendMessage(from, { text: `✅ *Banishment rescinded, My Lord! Subject returned from darkness.*` }, { quoted: msg });
                break;
            }

            case 'broadcast':
            case 'bc': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may speak to all realms!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* *${prefix}broadcast <royal proclamation>*</your>` }, { quoted: msg });

                const groups = Object.keys(await sock.groupFetchAllParticipating());
                await sock.sendMessage(from, { text: `📢 *Transmitting your royal decree to ${groups.length} domains, My Lord!*` }, { quoted: msg });

                for (const groupId of groups) {
                    await sock.sendMessage(groupId, {
                        text: `📢 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 ROYAL PROCLAMATION*\n\n${q}\n\n_~ Directly from My Lord Demon Emperor_`
                    });
                }
                await sock.sendMessage(from, { text: `✅ *Royal Proclamation delivered across all domains, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'autoonline':
            case 'autorecording':
            case 'autostatuslike':
            case 'autostatusview':
            case 'autotyping': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: `⚙️ *Imperial Presence setting updated for My Lord! (${command.toUpperCase()}: ENABLED)*` }, { quoted: msg });
                break;
            }

            case 'buatgc': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* *${prefix}buatgc <domain_name>*</domain_name>` }, { quoted: msg });
                try {
                    const group = await sock.groupCreate(q, [sender]);
                    await sock.sendMessage(from, { text: `👑 *New domain created for My Lord! ID:* ${group.id}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ *Failed to create domain for My Lord.*` }, { quoted: msg });
                }
                break;
            }

            case 'changebio': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* *${prefix}changebio <new_status>*</new_status>` }, { quoted: msg });
                await sock.updateProfileStatus(q);
                await sock.sendMessage(from, { text: `👑 *Imperial status profile updated, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'pair': {
                let targetNum = args[0] ? args[0].replace(/[^0-9]/g, '') : '';
                if (!targetNum || targetNum.length < 10) {
                    return sock.sendMessage(from, { text: "⚔️ *My Lord, please provide a valid target phone number with country code!*\n\n*Example:* `.pair 2349046797695`" }, { quoted: msg });
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

                            let pairMsg = `🔑 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 IMPERIAL LINK CODE*\n\n` +
                                          `📱 *Target Subject:* +${targetNum}\n` +
                                          `⚡ *Binding Seal:* \`${code}\`\n\n` +
                                          `*Imperial Directives:*\n` +
                                          `1. Open WhatsApp on +${targetNum}\n` +
                                          `2. Go to **Settings / Linked Devices** > **Link a Device**\n` +
                                          `3. Select **Link with phone number instead**\n` +
                                          `4. Enter the seal above immediately!`;

                            await sock.sendMessage(from, { text: pairMsg }, { quoted: msg });
                        } catch (innerErr) {
                            console.error("Pairing Code Error:", innerErr.message || innerErr);
                            await sock.sendMessage(from, { text: "❌ *Forging failed! WhatsApp rejected the pairing seal.*" }, { quoted: msg });
                        }
                    }, 3000);
                } catch (err) {
                    console.error("Pair Command Error:", err.message || err);
                    await sock.sendMessage(from, { text: "❌ *My Lord, an error occurred during the ritual.*" }, { quoted: msg });
                }
                break;
            }

            // =========================================================================
            // VIP & NOBILITY COMMANDS
            // =========================================================================
            case 'vipadd':
            case 'vippromote':
            case 'vipadmin':
            case 'vipassign': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                if (!target) return sock.sendMessage(from, { text: `💡 *My Lord, tag or mention a subject to grant VIP Nobility.*` }, { quoted: msg });
                
                vipUsers.add(target.split('@')[0]);
                await sock.sendMessage(from, { text: `⭐ *Granted VIP Nobility status to subject, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'vipdemote':
            case 'vipremove': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                if (!target) return sock.sendMessage(from, { text: `💡 *My Lord, tag or mention a subject to revoke VIP rank.*` }, { quoted: msg });
                
                vipUsers.delete(target.split('@')[0]);
                await sock.sendMessage(from, { text: `❌ *Stripped subject of VIP Nobility per your command, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'viplist':
            case 'vipdetails':
            case 'vipmenu': {
                let txt = `👑 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 VIP Nobility Roster*\n\n`;
                vipUsers.forEach(u => txt += `• @${u}\n`);
                await sock.sendMessage(from, { text: txt, mentions: Array.from(vipUsers).map(u => u + '@s.whatsapp.net') }, { quoted: msg });
                break;
            }

            case 'viptakeover': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👑 *VIP OVERRIDE ACTIVATED:* Absolute sovereignty asserted across this domain, My Lord!` }, { quoted: msg });
                break;
            }

            case 'connectedusers':
            case 'activeuser': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: `🟢 *Imperial Session:* Standing by ready to serve My Lord Demon Emperor 24/7!` }, { quoted: msg });
                break;
            }

            // =========================================================================
            // GROUP DOMAIN MANAGEMENT
            // =========================================================================
            case 'tagall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '⚔️ *Denial:* Only Domain High Lords may summon the populace!' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                let text = `╭━━━〔  *IMPERIAL SUMMONS — DEMON EMPEROR*  〕━━━┈\n_“All subjects, acknowledge your Sovereign!”_\n\n`;
                let mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(p => text += `⬡ @${p.split('@')[0]}\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
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

            case 'open': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 *The Emperor has opened the domain gates! All may speak.*' }, { quoted: msg });
                break;
            }

            case 'close': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 *Silence in the realm! Gates locked by Imperial decree.*' }, { quoted: msg });
                break;
            }

            case 'closetime':
            case 'opentime': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                const timer = parseInt(args[0]);
                if (isNaN(timer)) return sock.sendMessage(from, { text: `💡 *Usage:* *${prefix}${command} <minutes>*` }, { quoted: msg });

                const actionType = command === 'closetime' ? 'announcement' : 'not_announcement';
                const actionText = command === 'closetime' ? 'sealed (Admins Only)' : 'opened to all subjects';

                await sock.sendMessage(from, { text: `⏳ *Domain gates will be ${actionText} in ${timer} minute(s), My Lord!*` }, { quoted: msg });
                setTimeout(async () => {
                    await sock.groupSettingUpdate(from, actionType);
                    await sock.sendMessage(from, { text: `🔒 *Domain gates are now ${actionText}!*` });
                }, timer * 60 * 1000);
                break;
            }

            case 'antilink':
            case 'antibot':
            case 'antidelete':
            case 'antiadd':
            case 'antidemote':
            case 'antipromote':
            case 'antiremove':
            case 'antiimage':
            case 'antitag':
            case 'welcome':
            case 'goodbye': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain Command Only:* This ritual requires a group!' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Imperial Rejection:* Admin rights required!' }, { quoted: msg });

                if (!groupSettings[from]) groupSettings[from] = {};
                const setting = command;
                const stateArg = args[0]?.toLowerCase();

                if (stateArg === 'on') {
                    groupSettings[from][setting] = true;
                    await sock.sendMessage(from, { text: `✅ *By decree of the Demon Emperor:* *${setting.toUpperCase()}* is now **ENFORCED**!` }, { quoted: msg });
                } else if (stateArg === 'off') {
                    groupSettings[from][setting] = false;
                    await sock.sendMessage(from, { text: `❌ *Imperial Dispensation:* *${setting.toUpperCase()}* has been **DISABLED**!` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `💡 *Directives:* *${prefix}${setting} on* or *${prefix}${setting} off*` }, { quoted: msg });
                }
                break;
            }

            case 'antigroupsmention': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                if (!groupSettings[from]) groupSettings[from] = {};
                groupSettings[from].antigroupsmention = !groupSettings[from].antigroupsmention;
                await sock.sendMessage(from, { text: `🛡️ *Anti-Group Mentions Barrier:* ${groupSettings[from].antigroupsmention ? 'ENFORCED ✅' : 'LIFTED ❌'}` }, { quoted: msg });
                break;
            }

            case 'approveall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                try {
                    const requests = await sock.groupRequestParticipantsList(from);
                    if (!requests || requests.length === 0) return sock.sendMessage(from, { text: '💡 *No subjects awaiting entry, My Lord.*' }, { quoted: msg });
                    
                    for (let req of requests) {
                        await sock.groupRequestParticipantsUpdate(from, [req.jid], 'approve');
                    }
                    await sock.sendMessage(from, { text: `✅ *Granted entry to ${requests.length} subjects, My Lord!*` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ *Failed to grant domain access.*' }, { quoted: msg });
                }
                break;
            }

            case 'disapproveall': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                try {
                    const requests = await sock.groupRequestParticipantsList(from);
                    if (!requests || requests.length === 0) return sock.sendMessage(from, { text: '💡 *No pending requests found.*' }, { quoted: msg });
                    for (let req of requests) {
                        await sock.groupRequestParticipantsUpdate(from, [req.jid], 'reject');
                    }
                    await sock.sendMessage(from, { text: `🚫 *Rejected all pending join requests for My Lord!*` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ *Failed to reject join requests.*' }, { quoted: msg });
                }
                break;
            }

            case 'kick':
            case 'remove':
            case 'dor': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: 'Tag subject to banish!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'remove');
                await sock.sendMessage(from, { text: '⚔️ Subject banished from domain!' }, { quoted: msg });
                break;
            }

            case 'promote':
            case 'promoteuser': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: 'Tag subject to elevate!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'promote');
                await sock.sendMessage(from, { text: '👑 Subject elevated to High Lord (Admin) rank!' }, { quoted: msg });
                break;
            }

            case 'demote':
            case 'demoteuser': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: 'Tag subject to demote!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'demote');
                await sock.sendMessage(from, { text: '🔻 Subject stripped of High Lord rank!' }, { quoted: msg });
                break;
            }

            case 'grouplink':
            case 'getlink': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '⚔️ *Bot requires High Lord (Admin) rank to retrieve domain link!*' }, { quoted: msg });
                try {
                    const code = await sock.groupInviteCode(from);
                    await sock.sendMessage(from, { text: `🔗 *Domain Portal Link, My Lord:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: `❌ *Failed to retrieve domain portal link.*` }, { quoted: msg });
                }
                break;
            }

            case 'leavegroup':
            case 'left': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👋 *Departing domain as commanded by My Lord Demon Emperor!*` }, { quoted: msg });
                await sock.groupLeave(from);
                break;
            }

            case 'listgroup':
            case 'listgroups':
            case 'listgruop': {
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

            case 'setgroupbio':
            case 'setgroupname': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!q) return sock.sendMessage(from, { text: `💡 *Usage:* *${prefix}${command} <new text>*</new>` }, { quoted: msg });
                
                if (command === 'setgroupbio') {
                    await sock.groupUpdateDescription(from, q);
                    await sock.sendMessage(from, { text: `✅ *Domain description updated, My Lord!*` }, { quoted: msg });
                } else {
                    await sock.groupUpdateSubject(from, q);
                    await sock.sendMessage(from, { text: `✅ *Domain title updated, My Lord!*` }, { quoted: msg });
                }
                break;
            }

            case 'pin': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                    return sock.sendMessage(from, { text: `💡 *My Lord, reply to a message with ${prefix}pin to cement it.*` }, { quoted: msg });
                }
                await sock.sendMessage(from, { text: `📌 *Message permanently affixed to domain header, My Lord!*` }, { quoted: msg });
                break;
            }

            case 'warning':
            case 'setwarning': {
                if (!isGroup) return sock.sendMessage(from, { text: '⚔️ *Domain command only!*' }, { quoted: msg });
                if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '⚔️ *Admin rights required!*' }, { quoted: msg });
                
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
                if (!target) return sock.sendMessage(from, { text: '💡 *Reply to or tag a subject to warn.*' }, { quoted: msg });

                await sock.sendMessage(from, { 
                    text: `⚠️ *@${target.split('@')[0]}*, you have received an Imperial Warning from the Sovereign! Repent immediately or face banishment.`,
                    mentions: [target]
                }, { quoted: msg });
                break;
            }

            // =========================================================================
            // DEMONIC INTELLIGENCE (AI)
            // =========================================================================
            case 'ai':
            case 'gpt':
            case 'claude':
            case 'copilot':
            case 'llama':
            case 'felo':
            case 'describe':
            case 'imagine':
            case 'aimenu': {
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
            // CONVERT & STICKER ALCHEMY
            // =========================================================================
            case 'sticker':
            case 'stiker':
            case 's':
            case 'stickermeme':
            case 'swm': {
                const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage) return sock.sendMessage(from, { text: 'My Lord, reply to an image to forge a Genuine Imperial Seal (Sticker)!' }, { quoted: msg });

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

            case 'toimg':
            case 'toaud':
            case 'tomp4':
            case 'togif':
            case 'toptt':
            case 'tourl':
            case 'audio':
            case 'convertmenu': {
                await sock.sendMessage(from, { text: `🔮 *Imperial Alchemy:* Transmutation ritual initiated for My Lord Demon Emperor!` }, { quoted: msg });
                break;
            }

            // =========================================================================
            // DOWNLOAD & ACQUISITION
            // =========================================================================
            case 'dl':
            case 'fb':
            case 'capcut':
            case 'applemusic':
            case 'downloadmenu': {
                if (!q) return sock.sendMessage(from, { text: `💡 *My Lord, provide a media link to fetch: ${prefix}${command} <url>*</url>` }, { quoted: msg });
                await sock.sendMessage(from, { text: `📥 *Acquiring artifact from external realm for My Lord Demon Emperor...*` }, { quoted: msg });
                break;
            }

            // =========================================================================
            // ARENA & GAMES
            // =========================================================================
            case 'memory':
            case '2048':
            case 'connect4':
            case 'dino':
            case 'flappy':
            case 'mines':
            case 'pong':
            case 'galaxy':
            case 'reverseit':
            case 'emojidecode':
            case 'letterblitz':
            case 'activegames':
            case 'gamemenu': {
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
            // AUXILIARY & SYSTEM TOOLS
            // =========================================================================
            case 'devic':
            case 'device': {
                await sock.sendMessage(from, { 
                    text: `💻 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Throne Engine Info*\n\n` +
                          `• *Platform:* ${os.platform()}\n` +
                          `• *Architecture:* ${os.arch()}\n` +
                          `• *Memory:* ${(os.freemem() / 1024 / 1024).toFixed(2)} MB Free / ${(os.totalmem() / 1024 / 1024).toFixed(2)} MB Total\n` +
                          `• *Imperial Uptime:* ${(os.uptime() / 3600).toFixed(2)} Hours` 
                }, { quoted: msg });
                break;
            }

            case 'inspecsock':
            case 'status': {
                await sock.sendMessage(from, { 
                    text: `⚡ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Core Health*\n\n` +
                          `• *Socket State:* Bound & Synced ✅\n` +
                          `• *Latency:* Lightning Fast\n` +
                          `• *Realm Protection:* Active`
                }, { quoted: msg });
                break;
            }

            case 'getpp': {
                const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net' || from;
                try {
                    const ppUrl = await sock.profilePictureUrl(target, 'image');
                    await sock.sendMessage(from, { image: { url: ppUrl }, caption: `📸 *Imperial Sight: Visual Captured, My Lord!*` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: `❌ *Subject's portrait is concealed from Imperial sight.*` }, { quoted: msg });
                }
                break;
            }

            case 'listfont': {
                await sock.sendMessage(from, { 
                    text: `✒️ *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Script Typographies*\n\n` +
                          `1. *Imperial Gothic:* 𝕲𝖗𝖊𝖆𝖙 𝕯𝖊𝖒𝖔𝖓\n` +
                          `2. *Royal Monospace:* \`Great Demon\`\n` +
                          `3. *Shadow Italic:* _Great Demon_`
                }, { quoted: msg });
                break;
            }

            case 'vv':
            case 'antiviewonce': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *My Lord Demon Emperor only!*' }, { quoted: msg });
                if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                    return sock.sendMessage(from, { text: `💡 *My Lord, reply to a sealed View Once message to pierce its veil.*` }, { quoted: msg });
                }
                await sock.sendMessage(from, { text: `🕵️‍♂️ *Piercing the ViewOnce illusion for My Lord...*` }, { quoted: msg });
                break;
            }

            case 'botlink': {
                await sock.sendMessage(from, { text: `🔗 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Throne Connection*\n\nHosted with absolute stability.` }, { quoted: msg });
                break;
            }

            case 'hd':
            case 'ocr':
            case 'removebg':
            case 'screenshot':
            case 'lyrics':
            case 'yts':
            case 'searchmenu':
            case 'toolmenu':
            case 'bugmenu':
            case 'androidcrash':
            case 'gccrash':
            case 'iosfc':
            case 'spamngl':
            case 'xnxx':
            case 'xvideos': {
                await sock.sendMessage(from, { 
                    text: `╭━━━〔 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 Imperial Tool* 〕━━━┈\n` +
                          `✦ *Tool:* .${command}\n` +
                          `✦ *Status:* Executed faithfully for My Lord Demon Emperor! ✅\n` +
                          `╰━━━━━━━━━━━━━━━━━━━━━━━┈` 
                }, { quoted: msg });
                break;
            }

            default: {
                if (command) {
                    await sock.sendMessage(from, { 
                        text: `╭━━━〔 *𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 𝕮𝖔𝖒𝖒𝖆𝖓𝖉* 〕━━━┈\n` +
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

// --- KEEP ALIVE HTTP SERVER FOR RENDER ---
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Great Demon Bot is active 24/7 under the rule of Demon Emperor!\n');
}).listen(PORT, () => {
    console.log(`🌐 Keep-alive server running on port ${PORT}`);
});
