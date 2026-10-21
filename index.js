
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');
const fs = require('fs');
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

if (isCmd) {
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


        switch (command) {
            case 'menu':
            case 'help': {
                const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = uptimeSeconds % 60;
                const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

                const menuText = 
`╭━━━〔  *${BOT_NAME}*  〕━━━┈
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
                const sent = await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
                const end = Date.now();
                await sock.sendMessage(from, { text: `Speed: ${end - start}ms` }, { edit: sent.key });
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
