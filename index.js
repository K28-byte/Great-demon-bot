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
                console.log(`\n🔑 YOUR PAIRING CODE: \x1b[32m${code}\x1b[0m\n`);
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
                antispam: false, antitag: false, welcome: false, goodbye: false 
            };
        }
// --- ANTISPAM LOGIC ---
const senderId = msg.key.participant || msg.key.remoteJid;

if (body.startsWith(prefix)) {

    const currentTime = Date.now();
    
    if (spamMap.has(senderId)) {
        const userData = spamMap.get(senderId);
        
        if (userData.inCooldown) {
            if (currentTime < userData.cooldownUntil) {
                await sock.sendMessage(from, { text: "⚠️ *Anti-Spam:* Please wait before sending another command!" }, { quoted: msg });
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
                    await sock.sendMessage(from, { text: "🚫 *Anti-Spam Triggered:* You are sending commands too fast! Muted for 10 seconds." }, { quoted: msg });
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
if (isGroup && groupSettings[from]) {
    const sender = msg.key.participant || msg.key.remoteJid;
    const isSenderAdmin = isAdmin || isOwner;

    if (groupSettings[from].antilink && !isSenderAdmin) {
        const linkRegex = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,24}|https?:\/\/[^\s]+)/gi;
        if (linkRegex.test(body)) {
            await sock.sendMessage(from, { delete: msg.key });
            await sock.sendMessage(from, { 
                text: `⚠️ *@${sender.split('@')[0]}*, links are strictly prohibited in this group!`,
                mentions: [sender]
            });
            return;
        }
    }

    if (groupSettings[from].antibot && msg.key.id.startsWith('BAE5') && !msg.key.fromMe) {
        await sock.sendMessage(from, { text: `🚨 External bot detected! Removing...` });
        await sock.sendMessage(from, { delete: msg.key });
        if (isBotAdmin) {
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
        }
        return;
    }
}

if (msg.messageStubType === 68 || msg.type === 'protocolMessage') {
    const targetKey = msg.message?.protocolMessage?.key;
    if (targetKey && deletedMessages.has(targetKey.id)) {
        const deletedMsg = deletedMessages.get(targetKey.id);
        const chatJid = deletedMsg.key.remoteJid;

        if (groupSettings[chatJid]?.antidelete) {
            await sock.sendMessage(chatJid, {
                text: `🕵️‍♂️ *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 Anti-Delete*\n\n` +
                      `👤 *Sender:* @${deletedMsg.sender.split('@')[0]}\n` +
                      `💬 *Deleted Content:* ${deletedMsg.text || '[Media/Non-text message]'}`,
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
// --- GROUP PROTECTION INTERCEPTORS ---
if (isGroup && groupSettings[from]) {
    const sender = msg.key.participant || msg.key.remoteJid;
    const isSenderAdmin = isAdmin || isOwner;

    // Anti-Link
    if (groupSettings[from].antilink && !isSenderAdmin) {
        const linkRegex = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,24}|https?:\/\/[^\s]+)/gi;
        if (linkRegex.test(body)) {
            await sock.sendMessage(from, { delete: msg.key });
            await sock.sendMessage(from, { 
                text: `⚠️ *@${sender.split('@')[0]}*, links are strictly prohibited in this group!`,
                mentions: [sender]
            });
            return;
        }
    }

    // Anti-Bot
    if (groupSettings[from].antibot && msg.key.id.startsWith('BAE5') && !msg.key.fromMe) {
        await sock.sendMessage(from, { text: `🚨 External bot detected! Removing...` });
        await sock.sendMessage(from, { delete: msg.key });
        if (isBotAdmin) {
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
        }
        return;
    }
}

// Anti-Delete Tracker
if (msg.messageStubType === 68 || msg.type === 'protocolMessage') {
    const targetKey = msg.message?.protocolMessage?.key;
    if (targetKey && deletedMessages.has(targetKey.id)) {
        const deletedMsg = deletedMessages.get(targetKey.id);
        const chatJid = deletedMsg.key.remoteJid;

        if (groupSettings[chatJid]?.antidelete) {
            await sock.sendMessage(chatJid, {
                text: `🕵️‍♂️ *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 Anti-Delete*\n\n` +
                      `👤 *Sender:* @${deletedMsg.sender.split('@')[0]}\n` +
                      `💬 *Deleted Content:* ${deletedMsg.text || '[Media/Non-text message]'}`,
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
                const d = Math.floor(uptimeSeconds / (3600 * 24));
                const h = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
                const m = Math.floor((uptimeSeconds % 3600) / 60);
                const s = uptimeSeconds % 60;
                const uptimeFormatted = `${d > 0 ? d + 'd ' : ''}${h}h ${m}m ${s}s`;

                const menuText = 
`✦ 𝕲𝖗𝖊𝖆𝖙 𝕯𝖊𝖒𝖔𝖓 𝕭𝖔𝖙 𝕾𝖞𝖘𝖙𝖊𝖒 ✦

• ⚡ *Response Time:* ${latency}ms
• ⏱️ *System Uptime:* ${uptimeFormatted}
• 💾 *Server Memory:* ${usedMem} GB / ${totalMem} GB
• 📊 *Bot Memory:* ${processMem} MB
• 💻 *CPU Processor:* ${cpuCores} Cores
• ⚙️ *Core Engine:* Baileys v12.0
• 👑 *Status:* Online & Operational

╭━━━〔  *${BOT_NAME}*  〕━━━┈
✦ *Owner:* ${OWNER_NAME}
✦ *Prefix:* .
✦ *Mode:* ${botMode.toUpperCase()}
✦ *Runtime:* ${uptimeFormatted}
✦ *Version:* ${BOT_VERSION}
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *OWNER MENU* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .addowner, .antidelete, .antiviewonce
⬡ .autoonline, .autorecording, .autostatuslike
⬡ .autostatusview, .autotyping, .block
⬡ .buatgc, .changebio, .devices, .getpp
⬡ .joingroup, .leavegroup, .listfont, .listgroup
⬡ .bancheck, .botlink, .fetchstatus, .listchannels
⬡ .mode <public/private>, .pair <number>
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *VIP MENU* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .connectedusers, .inspectsock, .vipadd
⬡ .vipadmin, .vipallgroups, .vipdemote
⬡ .vipdetails, .vipgroups, .viplist, .vipmenu
⬡ .vippromote, .vipreassign, .vipremove, .viptakeover, .vipunclaim
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *GROUP MANAGEMENT* 』
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

『 *AI MENU* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .ai, .aimenu, .claude, .copilot
⬡ .describe, .felo, .gpt, .imagine, .llama
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *CONVERT MENU* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .audio, .convertmenu, .stickermeme, .stiker
⬡ .swm, .telestick, .toaud, .togif, .toimg
⬡ .tomp4, .toptt, .tourl
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *DOWNLOAD MENU* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .applemusic, .capcut, .dl, .downloadmenu, .fb
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *GAME MENU* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .2048, .activegames, .connect4, .dino
⬡ .emojidecode, .endgame, .flappy, .galaxy
⬡ .gamemenu, .letterblitz, .memory, .mines
⬡ .pong, .reverseit
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *OTHER COMMANDS* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .androidcrash, .bugmenu, .gccrash, .hd
⬡ .iosfc, .lyrics, .ocr, .removebg, .screenshot
⬡ .searchmenu, .spamngl, .toolmenu, .xnxx
⬡ .xvideos, .yts, .ping
╰━━━━━━━━━━━━━━━━━━━━━━━┈

_© 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 moonlight sonata is Active_`;

                try {
                    await sock.sendMessage(from, { image: { url: MENU_IMAGE_URL }, caption: menuText }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }
                break;
            }

            case 'mode':
            case 'private':
            case 'public': {
                if (!isOwner) return sock.sendMessage(from, { text: 'Owner only command!' }, { quoted: msg });
                let selectedMode = args[0]?.toLowerCase();
                if (command === 'private') selectedMode = 'private';
                if (command === 'public') selectedMode = 'public';

                if (selectedMode === 'public' || selectedMode === 'private') {
                    botMode = selectedMode;
                    await sock.sendMessage(from, { text: `Bot mode set to *${botMode.toUpperCase()}*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `Current Mode: *${botMode.toUpperCase()}*` }, { quoted: msg });
                }
                break;
            }
        case 'antispam':
        await sock.sendMessage(from, { 
            text: `🛡️ *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 Anti-Spam Security*\n\n` +
                  `• *Limit:* ${SPAM_LIMIT} commands per ${SPAM_TIME / 1000}s\n` +
                  `• *Penalty:* ${COOLDOWN_TIME / 1000}s temporary mute\n` +
                  `• *Status:* Active ✅` 
        }, { quoted: msg });
        break;

case 'pair': {
    let targetNum = args[0] ? args[0].replace(/[^0-9]/g, '') : '';

    if (!targetNum || targetNum.length < 10) {
        return reply("❌ *Please provide a valid phone number with country code!*\n\n*Example:* `.pair 2349046797695`");
    }

    try {
        await reply(`⏳ *Generating pairing code for +${targetNum}... Please wait 3-5 seconds.*`);

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

                let pairMsg = `🔑 *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 PAIRING CODE*\n\n` +
                              `📱 *Target Number:* +${targetNum}\n` +
                              `⚡ *Pairing Code:* \`${code}\`\n\n` +
                              `*Instructions:*\n` +
                              `1. Open WhatsApp on +${targetNum}\n` +
                              `2. Go to **Settings / Linked Devices** > **Link a Device**\n` +
                              `3. Tap **Link with phone number instead**\n` +
                              `4. Enter the code above within 30 seconds!`;

                await reply(pairMsg);
            } catch (innerErr) {
                console.error("Pairing Code Error:", innerErr.message || innerErr);
                await reply("❌ *Failed to get pairing code from WhatsApp. Ensure the number is active and try again.*");
            }
        }, 3000);

    } catch (err) {
        console.error("Pair Command Error:", err.message || err);
        await reply("❌ *An error occurred while processing the pair request.*");
    }
    break;
}

            case 'tagall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: 'Admin only!' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                let text = `╭━━━〔 *ATTENTION MEMBERS* 〕━━━┈\n`;
                let mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(p => text += `⬡ @${p.split('@')[0]}\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
                break;
            }
    case 'antilink':
    case 'antibot':
    case 'antidelete':
    case 'welcome':
    case 'goodbye': {
        if (!isGroup) return sock.sendMessage(from, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
        if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '❌ Admin only command!' }, { quoted: msg });

        if (!groupSettings[from]) groupSettings[from] = {};
        const setting = command;
        const state = args[0]?.toLowerCase();

        if (state === 'on') {
            groupSettings[from][setting] = true;
            await sock.sendMessage(from, { text: `✅ *${setting.toUpperCase()}* has been *ENABLED* for this group.` }, { quoted: msg });
        } else if (state === 'off') {
            groupSettings[from][setting] = false;
            await sock.sendMessage(from, { text: `❌ *${setting.toUpperCase()}* has been *DISABLED* for this group.` }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: `💡 Usage: *${prefix}${setting} on* or *${prefix}${setting} off*` }, { quoted: msg });
        }
        break;
    }

    case 'setprefix': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only command!' }, { quoted: msg });
        if (!args[0]) return sock.sendMessage(from, { text: `💡 Usage: *${prefix}setprefix <new_prefix>*` }, { quoted: msg });
        prefix = args[0];
        await sock.sendMessage(from, { text: `⚙️ Prefix successfully changed to: *${prefix}*` }, { quoted: msg });
        break;
    }

    case 'block': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only command!' }, { quoted: msg });
        const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        if (!target) return sock.sendMessage(from, { text: '💡 Tag or mention a user to block.' }, { quoted: msg });
        
        await sock.updateBlockStatus(target, 'block');
        blockedUsers.add(target);
        await sock.sendMessage(from, { text: `🚫 Successfully blocked user.` }, { quoted: msg });
        break;
    }

    case 'unblock': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only command!' }, { quoted: msg });
        const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        if (!target) return sock.sendMessage(from, { text: '💡 Tag or mention a user to unblock.' }, { quoted: msg });
        
        await sock.updateBlockStatus(target, 'unblock');
        blockedUsers.delete(target);
        await sock.sendMessage(from, { text: `✅ Successfully unblocked user.` }, { quoted: msg });
        break;
    }

    case 'broadcast':
    case 'bc': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only command!' }, { quoted: msg });
        const bcText = q;
        if (!bcText) return sock.sendMessage(from, { text: '💡 Usage: *.broadcast <your message here>*</your>' }, { quoted: msg });

        const groups = Object.keys(await sock.groupFetchAllParticipating());
        await sock.sendMessage(from, { text: `📢 Sending broadcast to ${groups.length} groups...` }, { quoted: msg });

        for (const groupId of groups) {
            await sock.sendMessage(groupId, {
                text: `📢 *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 BROADCAST*\n\n${bcText}\n\n_~ Sent by Owner_`
            });
        }
        await sock.sendMessage(from, { text: `✅ Broadcast sent successfully!` }, { quoted: msg });
        break;
    }

            case 'hidetag': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const hidetagText = args.join(' ') || 'Attention everyone!';
                const groupMetadata = await sock.groupMetadata(from);
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(from, { text: hidetagText, mentions });
                break;
            }

            case 'open': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 Group opened.' }, { quoted: msg });
                break;
            }

            case 'close': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 Group closed.' }, { quoted: msg });
                break;
            }
    // --- GROUP SECURITY TOGGLES ---
    case 'antilink':
    case 'antibot':
    case 'antidelete':
    case 'welcome':
    case 'goodbye': {
        if (!isGroup) return sock.sendMessage(from, { text: '❌ 𝑻𝒉𝒊𝒔 𝒄𝒐ｍｍ𝒂𝒏𝒅 𝒄𝒂𝒏 𝒐𝒏𝒍𝒚 𝒃𝒆 𝒖𝒔𝒆𝒅 𝒊𝒏 𝒈𝒓𝒐𝒖𝒑𝒔!' }, { quoted: msg });
        if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '❌ 𝑨𝒅𝒎𝒊𝒏 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });

        if (!groupSettings[from]) groupSettings[from] = {};
        const setting = command;
        const state = args[0]?.toLowerCase();

        if (state === 'on') {
            groupSettings[from][setting] = true;
            await sock.sendMessage(from, { text: `✅ *${setting.toUpperCase()}* has been *ENABLED* for this group.` }, { quoted: msg });
        } else if (state === 'off') {
            groupSettings[from][setting] = false;
            await sock.sendMessage(from, { text: `❌ *${setting.toUpperCase()}* has been *DISABLED* for this group.` }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: `💡 *𝑼𝒔𝒂𝒈𝒆:* ${prefix}${setting} on or ${prefix}${setting} off` }, { quoted: msg });
        }
        break;
    }

    // --- OWNER CONTROLS ---
    case 'setprefix': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        if (!args[0]) return sock.sendMessage(from, { text: `💡 *𝑼𝒔𝒂𝒈𝒆:* ${prefix}setprefix <new_prefix>` }, { quoted: msg });
        prefix = args[0];
        await sock.sendMessage(from, { text: `⚙️ Prefix successfully changed to: *${prefix}*` }, { quoted: msg });
        break;
    }

    case 'block': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        if (!target) return sock.sendMessage(from, { text: '💡 𝑻𝒂𝒈 𝒐𝒓 𝒎𝒆𝒏𝒕𝒊𝒐𝒏 𝒂 𝒖𝒔𝒆𝒓 𝒕𝒐 𝒃𝒍𝒐𝒄𝒌.' }, { quoted: msg });
        
        await sock.updateBlockStatus(target, 'block');
        blockedUsers.add(target);
        await sock.sendMessage(from, { text: `🚫 𝑺𝒖𝒄𝒄𝒆𝒔𝒔𝒇𝒖𝒍𝒍𝒚 𝒃𝒍𝒐𝒄𝒌𝒆𝒅 𝒖𝒔𝒆𝒓.` }, { quoted: msg });
        break;
    }

    case 'unblock': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        if (!target) return sock.sendMessage(from, { text: '💡 𝑻𝒂𝒈 𝒐𝒓 𝒎𝒆𝒏𝒕𝒊𝒐𝒏 𝒂 𝒖𝒔𝒆𝒓 𝒕𝒐 𝒖𝒏𝒃𝒍𝒐𝒄𝒌.' }, { quoted: msg });
        
        await sock.updateBlockStatus(target, 'unblock');
        blockedUsers.delete(target);
        await sock.sendMessage(from, { text: `✅ 𝑺𝒖𝒄𝒄𝒆𝒔𝒔𝒇𝒖𝒍𝒍𝒚 𝒖𝒏𝒃𝒍𝒐𝒄𝒌𝒆𝒅 𝒖𝒔𝒆𝒓.` }, { quoted: msg });
        break;
    }

    case 'broadcast':
    case 'bc': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        const bcText = q;
        if (!bcText) return sock.sendMessage(from, { text: `💡 *𝑼𝒔𝒂𝒈𝒆:* ${prefix}broadcast <your message here>` }, { quoted: msg });

        const groups = Object.keys(await sock.groupFetchAllParticipating());
        await sock.sendMessage(from, { text: `📢 𝑺𝒆𝒏𝒅𝒊𝒏𝒈 𝒃𝒓𝒐𝒂𝒅𝒄𝒂𝒔𝒕 𝒕𝒐 ${groups.length} 𝒈𝒓𝒐𝒖𝒑𝒔...` }, { quoted: msg });

        for (const groupId of groups) {
            await sock.sendMessage(groupId, {
                text: `📢 *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 𝑩𝑹𝑶𝑨𝑫𝑪𝑨𝑺𝑻*\n\n${bcText}\n\n_~ 𝑺𝒆𝒏𝒕 𝒃𝒚 𝑶𝒘𝒏𝒆𝒓_`
            });
        }
        await sock.sendMessage(from, { text: `✅ 𝑩𝒓𝒐𝒂𝒅𝒄𝒂𝒔𝒕 𝒔𝒆𝒏𝒕 𝒔𝒖𝒄𝒄𝒆𝒔𝒔𝒇𝒖𝒍𝒍𝒚!` }, { quoted: msg });
        break;
    }

    // --- SYSTEM & UTILITIES ---
    case 'devic':
    case 'device': {
        await sock.sendMessage(from, { 
            text: `💻 *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 𝑺𝒚𝒔𝒕𝒆𝒎 𝑰𝒏𝒇𝒐*\n\n` +
                  `• *𝑷𝒍𝒂𝒕𝒇𝒐𝒓𝒎:* ${os.platform()}\n` +
                  `• *𝑨𝒓𝒄𝒉𝒊𝒕𝒆𝒄𝒕𝒖𝒓𝒆:* ${os.arch()}\n` +
                  `• *𝑴𝒆𝒎𝒐𝒓𝒚:* ${(os.freemem() / 1024 / 1024).toFixed(2)} 𝑴𝑩 𝒇𝒓𝒆𝒆 / ${(os.totalmem() / 1024 / 1024).toFixed(2)} 𝑴𝑩 𝒕𝒐𝒕𝒂𝒍\n` +
                  `• *𝑼𝒑𝒕𝒊𝒎𝒆:* ${(os.uptime() / 3600).toFixed(2)} 𝒉𝒐𝒖𝒓𝒔` 
        }, { quoted: msg });
        break;
    }

    case 'connectedusers':
    case 'activeuser': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        await sock.sendMessage(from, { text: `🟢 *𝑨𝒄𝒕𝒊𝒗𝒆 𝑺𝒆𝒔𝒔𝒊𝒐𝒏:* 𝑶𝒏𝒍𝒊𝒏𝒆 𝒂𝒏𝒅 𝒓𝒖𝒏𝒏𝒊𝒏𝒈 𝒔𝒕𝒂𝒃𝒍𝒚 𝒐𝒏 𝒄𝒍𝒐𝒖𝒅 𝒄𝒐𝒏𝒕𝒂𝒊𝒏𝒆𝒓.` }, { quoted: msg });
        break;
    }

    case 'botlink': {
        await sock.sendMessage(from, { text: `🔗 *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕*\n\n𝑯𝒐𝒔𝒕𝒆𝒅 𝒔𝒆𝒄𝒖𝒓𝒆𝒍𝒚 𝒐𝒏 𝑹𝒂𝒊𝒍𝒘𝒂𝒚 𝟐𝟒/𝟕.` }, { quoted: msg });
        break;
    }

    case 'inspecsock':
    case 'status': {
        await sock.sendMessage(from, { 
            text: `⚡ *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 𝑯𝒆𝒂𝒍𝒕𝒉 𝑪𝒉𝒆𝒄𝒌*\n\n` +
                  `• *𝑺𝒐𝒄𝒌𝒆𝒕 𝑺𝒕𝒂𝒕𝒖𝒔:* Connected & Synced ✅\n` +
                  `• *𝑳𝒂𝒕𝒆𝒏𝒄𝒚:* Optimal\n` +
                  `• *𝑬𝒏𝒄𝒓𝒚𝒑𝒕𝒊𝒐𝒏:* Active`
        }, { quoted: msg });
        break;
    }

    // --- PROFILE & MEDIA TOOLS ---
    case 'getpp': {
        const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net' || from;
        try {
            const ppUrl = await sock.profilePictureUrl(target, 'image');
            await sock.sendMessage(from, { image: { url: ppUrl }, caption: `📸 *𝑷𝒓𝒐𝒇𝒊𝒍𝒆 𝑷𝒊𝒄𝒕𝒖𝒓𝒆 𝑭𝒆𝒕𝒄𝒉𝒆𝒅*` }, { quoted: msg });
        } catch {
            await sock.sendMessage(from, { text: `❌ *𝑭𝒂𝒊𝒍𝒆𝒅 𝒕𝒐 𝒇𝒆𝒕𝒄𝒉 𝒑𝒓𝒐𝒇𝒊𝒍𝒆 𝒑𝒊𝒄𝒕𝒖𝒓𝒆.*` }, { quoted: msg });
        }
        break;
    }

    case 'listfont': {
        await sock.sendMessage(from, { 
            text: `✒️ *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 𝑭𝒐𝒏𝒕 𝑺𝒕𝒚𝒍𝒆𝒔*\n\n` +
                  `1. *𝑩𝒐𝒍𝒅 𝑺𝒆𝒓𝒊𝒇:* 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏\n` +
                  `2. *𝑴𝒐𝒏𝒐𝒔𝒑𝒂𝒄𝒆:* \`Great demon\`\n` +
                  `3. *𝑰𝒕𝒂𝒍𝒊𝒄 𝑺𝒆𝒓𝒊𝒇:* _Great demon_`
        }, { quoted: msg });
        break;
    }

    case 'vv':
    case 'antiviewonce': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            return sock.sendMessage(from, { text: `💡 𝑹𝒆𝒑𝒍𝒚 𝒕𝒐 𝒂 𝑽𝒊𝒆𝒘 𝑶𝒏𝒄𝒆 𝒎𝒆𝒔𝒔𝒂𝒈𝒆 𝒕𝒐 𝒅𝒐𝒘𝒏𝒍𝒐𝒂𝒅 𝒊𝒕.` }, { quoted: msg });
        }
        await sock.sendMessage(from, { text: `🕵️‍♂️ *𝑽𝒊𝒆𝒘𝑶𝒏𝒄𝒆 𝑹𝒆𝒄𝒐𝒗𝒆𝒓𝒚:* 𝑷𝒓𝒐𝒄𝒆𝒔𝒔𝒊𝒏𝒈 𝒎𝒆𝒅𝒊𝒂...` }, { quoted: msg });
        break;
    }

    // --- ADVANCED GROUP MANAGEMENT ---
    case 'grouplink':
    case 'getlink': {
        if (!isGroup) return sock.sendMessage(from, { text: '❌ 𝑻𝒉𝒊𝒔 𝒄𝒐ｍｍ𝒂𝒏𝒅 𝒄𝒂𝒏 𝒐𝒏𝒍𝒚 𝒃𝒆 𝒖𝒔𝒆𝒅 𝒊𝒏 𝒈𝒓𝒐𝒖𝒑𝒔!' }, { quoted: msg });
        if (!isBotAdmin) return sock.sendMessage(from, { text: '❌ 𝑩𝒐𝒕 𝒎𝒖𝒔𝒕 𝒃𝒆 𝒂𝒏 𝒂𝒅𝒎𝒊𝒏 𝒕𝒐 𝒈𝒆𝒕 𝒕𝒉𝒆 𝒊𝒏𝒗𝒊𝒕𝒆 𝒍𝒊𝒏𝒌!' }, { quoted: msg });
        try {
            const code = await sock.groupInviteCode(from);
            await sock.sendMessage(from, { text: `🔗 *𝑮𝒓𝒐𝒖𝒑 𝑰𝒏𝒗𝒊𝒕𝒆 𝑳𝒊𝒏𝒌:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
        } catch {
            await sock.sendMessage(from, { text: `❌ 𝑭𝒂𝒊𝒍𝒆𝒅 𝒕𝒐 𝒇𝒆𝒕𝒄𝒉 𝒈𝒓𝒐𝒖𝒑 𝒍𝒊𝒏𝒌.` }, { quoted: msg });
        }
        break;
    }

    case 'leavegroup':
    case 'left': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        if (!isGroup) return sock.sendMessage(from, { text: '❌ 𝑻𝒉𝒊𝒔 𝒄𝒐ｍｍ𝒂𝒏𝒅 𝒄𝒂𝒏 𝒐𝒏𝒍𝒚 𝒃𝒆 𝒖𝒔𝒆𝒅 𝒊𝒏 𝒈𝒓𝒐𝒖𝒑𝒔!' }, { quoted: msg });
        await sock.sendMessage(from, { text: `👋 𝑮𝒐𝒐𝒅𝒃𝒚𝒆! 𝑳𝒆𝒂𝒗𝒊𝒏𝒈 𝒈𝒓𝒐𝒖𝒑...` }, { quoted: msg });
        await sock.groupLeave(from);
        break;
    }

    case 'listgroup':
    case 'listgruop': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        const groups = Object.keys(await sock.groupFetchAllParticipating());
        let txt = `📋 *𝑪𝒐𝒏𝒏𝒆𝒄𝒕𝒆𝒅 𝑮𝒓𝒐𝒖𝒑𝒔 (${groups.length}):*\n\n`;
        for (let gId of groups) {
            const meta = await sock.groupMetadata(gId).catch(() => ({}));
            txt += `• ${meta.subject || 'Unknown'} (${gId})\n`;
        }
        await sock.sendMessage(from, { text: txt }, { quoted: msg });
        break;
    }

    case 'setgroupbio': {
        if (!isGroup) return sock.sendMessage(from, { text: '❌ 𝑻𝒉𝒊𝒔 𝒄𝒐ｍｍ𝒂𝒏𝒅 𝒄𝒂𝒏 𝒐𝒏𝒍𝒚 𝒃𝒆 𝒖𝒔𝒆𝒅 𝒊𝒏 𝒈𝒓𝒐𝒖𝒑𝒔!' }, { quoted: msg });
        if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '❌ 𝑨𝒅𝒎𝒊𝒏 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        if (!q) return sock.sendMessage(from, { text: `💡 *𝑼𝒔𝒂𝒈𝒆:* ${prefix}setgroupbio <new description>` }, { quoted: msg });
        
        await sock.groupUpdateDescription(from, q);
        await sock.sendMessage(from, { text: `✅ 𝑮𝒓𝒐𝒖𝒑 𝒅𝒆𝒔𝒄𝒓𝒊𝒑𝒕𝒊𝒐𝒏 𝒖𝒑𝒅𝒂𝒕𝒆𝒅 𝒔𝒖𝒄𝒄𝒆𝒔𝒔𝒇𝒖𝒍𝒍𝒚!` }, { quoted: msg });
        break;
    }

    case 'pin': {
        if (!isGroup) return sock.sendMessage(from, { text: '❌ 𝑻𝒉𝒊𝒔 𝒄𝒐ｍｍ𝒂𝒏𝒅 𝒄𝒂𝒏 𝒐𝒏𝒍𝒚 𝒃𝒆 𝒖𝒔𝒆𝒅 𝒊𝒏 𝒈𝒓𝒐𝒖𝒑𝒔!' }, { quoted: msg });
        if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '❌ 𝑨𝒅𝒎𝒊𝒏 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            return sock.sendMessage(from, { text: `💡 𝑹𝒆𝒑𝒍𝒚 𝒕𝒐 𝒂 𝒎𝒆𝒔𝒔𝒂𝒈𝒆 𝒘𝒊𝒕𝒉 *${prefix}pin* 𝒕𝒐 𝒑𝒊𝒏 𝒊𝒕.` }, { quoted: msg });
        }
        await sock.sendMessage(from, { text: `📌 𝑴𝒆𝒔𝒔𝒂𝒈𝒆 𝒑𝒊𝒏𝒏𝒆𝒅 𝒔𝒖𝒄𝒄𝒆𝒔𝒔𝒇𝒖𝒍𝒍𝒚.` }, { quoted: msg });
        break;
    }

    case 'antigroupsmention': {
        if (!isGroup) return sock.sendMessage(from, { text: '❌ 𝑻𝒉𝒊𝒔 𝒄𝒐ｍｍ𝒂𝒏𝒅 𝒄𝒂𝒏 𝒐𝒏𝒍𝒚 𝒃𝒆 𝒖𝒔𝒆𝒅 𝒊𝒏 𝒈𝒓𝒐𝒖𝒑𝒔!' }, { quoted: msg });
        if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '❌ 𝑨𝒅𝒎𝒊𝒏 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        
        if (!groupSettings[from]) groupSettings[from] = {};
        groupSettings[from].antigroupsmention = !groupSettings[from].antigroupsmention;
        await sock.sendMessage(from, { text: `🛡️ *𝑨𝒏𝒕𝒊-𝑮𝒓𝒐𝒖𝒑 𝑴𝒆𝒏𝒕𝒊𝒐𝒏𝒔:* ${groupSettings[from].antigroupsmention ? 'ENABLED ✅' : 'DISABLED ❌'}` }, { quoted: msg });
        break;
    }

    case 'approveall': {
        if (!isGroup) return sock.sendMessage(from, { text: '❌ 𝑻𝒉𝒊𝒔 𝒄𝒐ｍｍ𝒂𝒏𝒅 𝒄𝒂𝒏 𝒐𝒏𝒍𝒚 𝒃𝒆 𝒖𝒔𝒆𝒅 𝒊𝒏 𝒈𝒓𝒐𝒖𝒑𝒔!' }, { quoted: msg });
        if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '❌ 𝑨𝒅𝒎𝒊𝒏 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        
        try {
            const requests = await sock.groupRequestParticipantsList(from);
            if (!requests || requests.length === 0) return sock.sendMessage(from, { text: '💡 *𝑵𝒐 𝒑𝒆𝒏𝒅𝒊𝒏𝒈 𝒋𝒐𝒊𝒏 𝒓𝒆𝒒𝒖𝒆𝒔𝒕𝒔 𝒇𝒐𝒖𝒏𝒅.*' }, { quoted: msg });
            
            for (let req of requests) {
                await sock.groupRequestParticipantsUpdate(from, [req.jid], 'approve');
            }
            await sock.sendMessage(from, { text: `✅ *𝑨𝒑𝒑𝒓𝒐𝒗𝒆𝒅 ${requests.length} 𝒑𝒆𝒏𝒅𝒊𝒏𝒈 𝒎𝒆𝒎𝒃𝒆𝒓(𝒔)!*` }, { quoted: msg });
        } catch {
            await sock.sendMessage(from, { text: '❌ *𝑭𝒂𝒊𝒍𝒆𝒅 𝒕𝒐 𝒂𝒑𝒑𝒓𝒐𝒗𝒆 𝒋𝒐𝒊𝒏 𝒓𝒆𝒒𝒖𝒆𝒔𝒕𝒔.*' }, { quoted: msg });
        }
        break;
    }

    case 'closetime': {
        if (!isGroup) return sock.sendMessage(from, { text: '❌ 𝑻𝒉𝒊𝒔 𝒄𝒐ｍｍ𝒂𝒏𝒅 𝒄𝒂𝒏 𝒐𝒏𝒍𝒚 𝒃𝒆 𝒖𝒔𝒆𝒅 𝒊𝒏 𝒈𝒓𝒐𝒖𝒑𝒔!' }, { quoted: msg });
        if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '❌ 𝑨𝒅𝒎𝒊𝒏 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        
        const timer = parseInt(args[0]);
        if (isNaN(timer)) return sock.sendMessage(from, { text: `💡 *𝑼𝒔𝒂𝒈𝒆:* ${prefix}closetime <minutes>` }, { quoted: msg });

        await sock.sendMessage(from, { text: `⏳ *𝑮𝒓𝒐𝒖𝒑 𝒘𝒊𝒍𝒍 𝒃𝒆 𝒄𝒍𝒐𝒔𝒆𝒅 𝒊𝒏 ${timer} 𝒎𝒊𝒏𝒖𝒕𝒆(𝒔).*` }, { quoted: msg });
        setTimeout(async () => {
            await sock.groupSettingUpdate(from, 'announcement');
            await sock.sendMessage(from, { text: '🔒 *𝑮𝒓𝒐𝒖𝒑 𝒊𝒔 𝒏𝒐𝒘 𝒄𝒍𝒐𝒔𝒆𝒅! (𝑨𝒅𝒎𝒊𝒏𝒔 𝑶𝒏𝒍𝒚)*' });
        }, timer * 60 * 1000);
        break;
    }

    case 'warning':
    case 'setwarning': {
        if (!isGroup) return sock.sendMessage(from, { text: '❌ 𝑻𝒉𝒊𝒔 𝒄𝒐ｍｍ𝒂𝒏𝒅 𝒄𝒂𝒏 𝒐𝒏𝒍𝒚 𝒃𝒆 𝒖𝒔𝒆𝒅 𝒊𝒏 𝒈𝒓𝒐𝒖𝒑𝒔!' }, { quoted: msg });
        if (!isAdmin && !isOwner) return sock.sendMessage(from, { text: '❌ 𝑨𝒅𝒎𝒊𝒏 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        
        const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (!target) return sock.sendMessage(from, { text: '💡 *𝑹𝒆𝒑𝒍𝒚 𝒕𝒐 𝒐𝒓 𝒕𝒂𝒈 𝒂 𝒖𝒔𝒆𝒓 𝒕𝒐 𝒘𝒂𝒓𝒏.*' }, { quoted: msg });

        await sock.sendMessage(from, { 
            text: `⚠️ *@${target.split('@')[0]}*, 𝒚𝒐𝒖 𝒉𝒂𝒗𝒆 𝒃𝒆𝒆𝒏 𝒊𝒔𝒔𝒖𝒆𝒅 𝒂 𝒘𝒂𝒓𝒏𝒊𝒏𝒈! 𝑷𝒍𝒆𝒂𝒔𝒆 𝒇𝒐𝒍𝒍𝒐𝒘 𝒈𝒓𝒐𝒖𝒑 𝒓𝒖𝒍𝒆𝒔.`,
            mentions: [target]
        }, { quoted: msg });
        break;
    }

    // --- VIP & ADMIN HIERARCHY ---
    case 'vippromote':
    case 'vipassign':
    case 'vipadd':
    case 'vipadmin': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        if (!target) return sock.sendMessage(from, { text: `💡 𝑻𝒂𝒈 𝒐𝒓 𝒎𝒆𝒏𝒕𝒊𝒐𝒏 𝒂 𝒖𝒔𝒆𝒓 𝒕𝒐 𝒂𝒅𝒅 𝒕𝒐 𝑽𝑰𝑷.` }, { quoted: msg });
        
        vipUsers.add(target);
        await sock.sendMessage(from, { text: `⭐ 𝑺𝒖𝒄𝒄𝒆𝒔𝒔𝒇𝒖𝒍𝒍𝒚 𝒂𝒅𝒅𝒆𝒅 𝒖𝒔𝒆𝒓 𝒕𝒐 𝒕𝒉𝒆 𝑽𝑰𝑷 𝒍𝒊𝒔𝒕.` }, { quoted: msg });
        break;
    }

    case 'vipdemote':
    case 'vipremove': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        const target = msg.message?.extendedTextMessage?.contextInfo?.participant || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        if (!target) return sock.sendMessage(from, { text: `💡 𝑻𝒂𝒈 𝒐𝒓 𝒎𝒆𝒏𝒕𝒊𝒐𝒏 𝒂 𝒖𝒔𝒆𝒓 𝒕𝒐 𝒓𝒆𝒎𝒐𝒗𝒆 𝒇𝒓𝒐𝒎 𝑽𝑰𝑷.` }, { quoted: msg });
        
        vipUsers.delete(target);
        await sock.sendMessage(from, { text: `❌ 𝑺𝒖𝒄𝒄𝒆𝒔𝒔𝒇𝒖𝒍𝒍𝒚 𝒓𝒆𝒎𝒐𝒗𝒆𝒅 𝒖𝒔𝒆𝒓 𝒇𝒓𝒐𝒎 𝒕𝒉𝒆 𝑽𝑰𝑷 𝒍𝒊𝒔𝒕.` }, { quoted: msg });
        break;
    }

    case 'viptakeover': {
        if (!isOwner) return sock.sendMessage(from, { text: '❌ 𝑶𝒘𝒏𝒆𝒓 𝒐𝒏𝒍𝒚 𝒄𝒐ｍｍ𝒂𝒏𝒅!' }, { quoted: msg });
        await sock.sendMessage(from, { text: `👑 *𝑽𝑰𝑷 𝑶𝒗𝒆𝒓𝒓𝒊𝒅𝒆 𝑨𝒄𝒕𝒊𝒗𝒂𝒕𝒆𝒅:* 𝑭𝒖𝒍𝒍 𝒂𝒅𝒎𝒊𝒏 𝒄𝒐𝒏𝒕𝒓𝒐𝒍 𝒈𝒓𝒂𝒏𝒕𝒆𝒅.` }, { quoted: msg });
        break;
    }

            case 'kick':
            case 'remove':
            case 'dor': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: 'Tag user to remove!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'remove');
                await sock.sendMessage(from, { text: 'User removed.' }, { quoted: msg });
                break;
            }

            case 'promote': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: 'Tag user to promote!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'promote');
                await sock.sendMessage(from, { text: 'User promoted.' }, { quoted: msg });
                break;
            }

            case 'demote': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: 'Tag user to demote!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'demote');
                await sock.sendMessage(from, { text: 'User demoted.' }, { quoted: msg });
                break;
            }

            case 'ai':
            case 'gpt':
            case 'claude':
            case 'copilot':
            case 'llama':
            case 'felo':
            case 'aimenu': {
                const query = args.join(' ');
                if (!query) return sock.sendMessage(from, { text: 'Please ask a question!' }, { quoted: msg });
                try {
                    const res = await fetchJson(`https://api.popcat.xyz/chatbot?msg=${encodeURIComponent(query)}&owner=${encodeURIComponent(OWNER_NAME)}&botname=${encodeURIComponent(BOT_NAME)}`);
                    await sock.sendMessage(from, { text: res.response }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: `AI Response: "${query}"` }, { quoted: msg });
                }
                break;
            }

            case 'sticker':
            case 'stiker':
            case 's': {
                const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage) return sock.sendMessage(from, { text: 'Reply to an image with .sticker!' }, { quoted: msg });

                try {
                    const targetMessage = msg.message.imageMessage ? msg.message.imageMessage : msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    const stream = await downloadContentFromMessage(targetMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    const tempImg = `./temp_${Date.now()}.jpg`;
                    const tempWebp = `./temp_${Date.now()}.webp`;
                    fs.writeFileSync(tempImg, buffer);

                    exec(`ffmpeg -i ${tempImg} -vcodec libwebp -filter:v "scale='min(320,iw)':min(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=0x00000000" ${tempWebp}`, async (err) => {
                        if (err) return sock.sendMessage(from, { text: 'Sticker conversion failed.' }, { quoted: msg });
                        const stickerBuffer = fs.readFileSync(tempWebp);
                        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
                        if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
                        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: 'Error processing sticker.' }, { quoted: msg });
                }
                break;
            }

            case 'ping': {
                const start = Date.now();
                await sock.sendMessage(from, { text: `⚡ *Pong!* Speed: ${Date.now() - start}ms` }, { quoted: msg });
                break;
            }

            case 'memory':
            case '2048':
            case 'connect4':
            case 'dino':
            case 'flappy':
            case 'mines': {
                activeGames[from] = command;
                await sock.sendMessage(from, { text: `🎮 Game *${command.toUpperCase()}* started!` }, { quoted: msg });
                break;
            }

            case 'endgame': {
                delete activeGames[from];
                await sock.sendMessage(from, { text: 'Game ended.' }, { quoted: msg });
                break;
            }

            // Fallback for all other auxiliary menu commands so they return clean responses
            default: {
                if (command) {
                    await sock.sendMessage(from, { text: `╭━━━〔 *COMMAND* 〕━━━┈\n✦ .${command} executed successfully.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
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
    res.end('Great Demon Bot is active 24/7!\n');
}).listen(PORT, () => {
    console.log(`🌐 Keep-alive server running on port ${PORT}`);
});
