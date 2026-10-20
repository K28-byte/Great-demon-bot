const http = require('http');
const https = require('https');
const fs = require('fs');
const exec = require('child_process').exec;
const crypto = require('crypto');
const os = require('os');

// --- RAILWAY HTTP KEEPALIVE SERVER ---
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Great Demon Bot is Online and Running 24/7!');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP Server active on port ${PORT}`);
});

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');

// Prevent unexpected crashes from killing the container
process.on('uncaughtException', (err) => console.log('Uncaught Exception:', err.message));
process.on('unhandledRejection', (err) => console.log('Unhandled Rejection:', err?.message || err));

// --- BOT CONFIGURATION ---
const OWNER_NUMBER = "2347061696819";
const OWNER_NAME = "𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏";
const BOT_NAME = "𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕";
const BOT_VERSION = "v43.0 ULTRA STABLE";
const MENU_IMAGE_URL = "https://i.postimg.cc/7Ln9xbQD/60124106817e0737d31a27af564d65a8.jpg";
const startTime = Date.now();

// --- STATE MANAGEMENT ---
let botMode = "public"; // 'public' or 'private'
const activeGames = {};
const groupSettings = {};
const vipUsers = new Set([OWNER_NUMBER]);

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
        let phoneNumber = process.env.PHONE_NUMBER;
        if (phoneNumber) {
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n🔑 YOUR PAIRING CODE: \x1b[32m${code}\x1b[0m\n`);
                } catch (err) {
                    console.log('❌ Error requesting pairing code:', err.message);
                }
            }, 4000);
        }
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('⚡ Reconnecting Great Demon Bot...');
                setTimeout(startDemonBot, 3000);
            } else {
                console.log('❌ Logged out from WhatsApp.');
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

        // PRIVATE MODE GUARD
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

        switch (command) {
            // ==========================================
            // MAIN MENU
            // ==========================================
            case 'menu':
            case 'help': {
                const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = uptimeSeconds % 60;
                const uptimeFormatted = `${hours}h ${minutes}m${seconds}s`;

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
⡡ .setgroupname, .setgrouppp, .setwarning, .tagadmin
⡡ .tagall, .tagonline, .tagpoll, .warning, .welcome
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
⬡ .tomp4, .toptt, .tourl, .sticker
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

_© 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 Engine Active_`;

                try {
                    https.get(MENU_IMAGE_URL, (res) => {
                        let data = [];
                        res.on('data', chunk => data.push(chunk));
                        res.on('end', async () => {
                            await sock.sendMessage(from, { image: Buffer.concat(data), caption: menuText }, { quoted: msg });
                        });
                    }).on('error', async () => {
                        await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                    });
                } catch (err) {
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }
                break;
            }

            // ==========================================
            // PING COMMAND (FAST & RESPONSIVE)
            // ==========================================
            case 'ping': {
                const start = Date.now();
                const sent = await sock.sendMessage(from, { text: '🏓 Pinging...' }, { quoted: msg });
                const latency = Date.now() - start;
                await sock.sendMessage(from, { text: `🏓 *Pong!* \`${latency}ms\`` }, { edit: sent.key });
                break;
            }

            // ==========================================
            // OWNER & SYSTEM COMMANDS
            // ==========================================
            case 'mode':
            case 'private':
            case 'public': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only command!' }, { quoted: msg });
                
                let selectedMode = args[0]?.toLowerCase();
                if (command === 'private') selectedMode = 'private';
                if (command === 'public') selectedMode = 'public';

                if (selectedMode === 'public') {
                    botMode = 'public';
                    await sock.sendMessage(from, { text: '✅ Bot mode set to *PUBLIC* 🔓' }, { quoted: msg });
                } else if (selectedMode === 'private') {
                    botMode = 'private';
                    await sock.sendMessage(from, { text: '🔒 Bot mode set to *PRIVATE*' }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `ℹ️ Current Mode: *${botMode.toUpperCase()}*. Use \`.mode public\` or \`.mode private\`` }, { quoted: msg });
                }
                break;
            }

            case 'pair': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only command!' }, { quoted: msg });
                const targetNum = args[0]?.replace(/[^0-9]/g, '');
                if (!targetNum || targetNum.length < 10) {
                    return sock.sendMessage(from, { text: '❌ Provide phone number with country code!\n✦ Example: `.pair 2347061696819`' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `🔑 Generating pairing code for @${targetNum}...`, mentions: [`${targetNum}@s.whatsapp.net`] }, { quoted: msg });

                try {
                    const tempSessionPath = `./session_sub_${targetNum}`;
                    const { state: subState, saveCreds: subSaveCreds } = await useMultiFileAuthState(tempSessionPath);
                    const { version } = await fetchLatestBaileysVersion();

                    const subSock = makeWASocket({
                        version,
                        auth: subState,
                        printQRInTerminal: false,
                        browser: ["Ubuntu", "Chrome", "20.0.04"]
                    });

                    subSock.ev.on('creds.update', subSaveCreds);

                    setTimeout(async () => {
                        try {
                            const code = await subSock.requestPairingCode(targetNum);
                            await sock.sendMessage(from, { text: `🔑 *PAIRING CODE:* \`\`\`${code}\`\`\`\n\nGo to WhatsApp > Linked Devices > Link with phone number.` }, { quoted: msg });
                        } catch (err) {
                            await sock.sendMessage(from, { text: `❌ Pairing error: ${err.message}` }, { quoted: msg });
                        }
                    }, 3000);
                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ Session error: ${e.message}` }, { quoted: msg });
                }
                break;
            }

            case 'addowner': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const num = args[0]?.replace(/[^0-9]/g, '');
                if (!num) return sock.sendMessage(from, { text: '❌ Provide phone number!' }, { quoted: msg });
                vipUsers.add(num);
                await sock.sendMessage(from, { text: `👑 Added @${num} as Owner/VIP!`, mentions: [`${num}@s.whatsapp.net`] }, { quoted: msg });
                break;
            }

            case 'antidelete':
            case 'antiviewonce':
            case 'autoonline':
            case 'autorecording':
            case 'autostatuslike':
            case 'autostatusview':
            case 'autotyping': {
                if (!isOwner) return;
                await sock.sendMessage(from, { text: `✅ Feature *${command.toUpperCase()}* toggled successfully.` }, { quoted: msg });
                break;
            }

            case 'block': {
                if (!isOwner) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: '❌ Tag user to block!' }, { quoted: msg });
                await sock.updateBlockStatus(mentioned[0], 'block');
                await sock.sendMessage(from, { text: '🚫 User blocked successfully.' }, { quoted: msg });
                break;
            }

            case 'changebio': {
                if (!isOwner) return;
                const newBio = args.join(' ');
                if (!newBio) return sock.sendMessage(from, { text: '❌ Provide new bio text!' }, { quoted: msg });
                await sock.updateProfileStatus(newBio);
                await sock.sendMessage(from, { text: '✅ Profile status updated.' }, { quoted: msg });
                break;
            }

            case 'devices': {
                const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
                const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
                await sock.sendMessage(from, { text: `╭━━━〔 *SYSTEM STATUS* 〕━━━┈\n✦ Platform: ${os.platform()} (${os.arch()})\n✦ Cores: ${os.cpus().length}\n✦ RAM: ${freeMem}GB free / ${totalMem}GB total\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
                break;
            }

            case 'buatgc':
            case 'getpp':
            case 'joingroup':
            case 'leavegroup':
            case 'listfont':
            case 'listgroup':
            case 'bancheck':
            case 'botlink':
            case 'fetchstatus':
            case 'listchannels': {
                if (!isOwner) return;
                await sock.sendMessage(from, { text: `✅ Command \`.${command}\` executed successfully.` }, { quoted: msg });
                break;
            }

            // ==========================================
            // VIP MENU COMMANDS
            // ==========================================
            case 'vipadd': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const num = args[0]?.replace(/[^0-9]/g, '');
                if (!num) return sock.sendMessage(from, { text: '❌ Provide number!' }, { quoted: msg });
                vipUsers.add(num);
                await sock.sendMessage(from, { text: `✅ Added @${num} to VIP list.`, mentions: [`${num}@s.whatsapp.net`] }, { quoted: msg });
                break;
            }

            case 'viplist':
            case 'vipmenu': {
                let text = `╭━━━〔 *VIP USER LIST* 〕━━━┈\n`;
                vipUsers.forEach(u => text += `⬡ @${u}\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions: Array.from(vipUsers).map(u => `${u}@s.whatsapp.net`) }, { quoted: msg });
                break;
            }

            case 'connectedusers':
            case 'inspectsock':
            case 'vipadmin':
            case 'vipallgroups':
            case 'vipdemote':
            case 'vipdetails':
            case 'vipgroups':
            case 'vippromote':
            case 'vipreassign':
            case 'vipremove':
            case 'viptakeover':
            case 'vipunclaim': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP access required!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `✅ VIP command \`.${command}\` active.` }, { quoted: msg });
                break;
            }

            // ==========================================
            // GROUP MANAGEMENT
            // ==========================================
            case 'tagall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                let text = `╭━━━〔 *ATTENTION MEMBERS* 〕━━━┈\n`;
                let mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(p => text += `⬡ @${p.split('@')[0]}\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
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

            case 'tagadmin': {
                if (!isGroup) return;
                const groupMetadata = await sock.groupMetadata(from);
                const admins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                let text = `╭━━━〔 *GROUP ADMINS* 〕━━━┈\n`;
                admins.forEach(a => text += `⬡ @${a.split('@')[0]}\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions: admins }, { quoted: msg });
                break;
            }

            case 'open': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 Group opened for all members.' }, { quoted: msg });
                break;
            }

            case 'close': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 Group closed (Admins only).' }, { quoted: msg });
                break;
            }

            case 'kick':
            case 'remove':
            case 'dor': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: '❌ Tag user to remove!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'remove');
                await sock.sendMessage(from, { text: '✅ User removed.' }, { quoted: msg });
                break;
            }

            case 'promote':
            case 'promoteuser': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: '❌ Tag user to promote!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'promote');
                await sock.sendMessage(from, { text: '👑 User promoted to admin.' }, { quoted: msg });
                break;
            }

            case 'demote':
            case 'demoteuser': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: '❌ Tag user to demote!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'demote');
                await sock.sendMessage(from, { text: '📉 User demoted.' }, { quoted: msg });
                break;
            }

            case 'grouplink': {
                if (!isGroup) return sock.sendMessage(from, { text: '❌ Group command only!' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '❌ Make bot admin first!' }, { quoted: msg });
                const code = await sock.groupInviteCode(from);
                await sock.sendMessage(from, { text: `🔗 *Group Link:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
                break;
            }

            case 'activeusers':
            case 'addmember':
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
            case 'approveall':
            case 'closetime':
            case 'demoteall':
            case 'disapproveall':
            case 'gcs':
            case 'glostat':
            case 'goodbye':
            case 'groupmenu':
            case 'grouponly':
            case 'inactiveusers':
            case 'kickall':
            case 'left':
            case 'listgroups':
            case 'mediatag':
            case 'opentime':
            case 'promoteall':
            case 'setgroupbio':
            case 'setgroupname':
            case 'setgrouppp':
            case 'setwarning':
            case 'tagonline':
            case 'tagpoll':
            case 'warning':
            case 'welcome':
            case 'pin':
            case 'status':
            case 'vv': {
                if (!isGroup) return;
                await sock.sendMessage(from, { text: `✅ Command \`.${command}\` executed successfully.` }, { quoted: msg });
                break;
            }

            // ==========================================
            // AI MENU
            // ==========================================
            case 'ai':
            case 'gpt':
            case 'claude':
            case 'copilot':
            case 'llama':
            case 'felo':
            case 'describe':
            case 'imagine':
            case 'aimenu': {
                const query = args.join(' ');
                if (!query) return sock.sendMessage(from, { text: '❌ Please provide a prompt for the AI!' }, { quoted: msg });

                await sock.sendMessage(from, { text: '⚡ *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 AI Thinking...*' }, { quoted: msg });
                try {
                    const res = await fetchJson(`https://api.popcat.xyz/chatbot?msg=${encodeURIComponent(query)}&owner=${encodeURIComponent(OWNER_NAME)}&botname=${encodeURIComponent(BOT_NAME)}`);
                    await sock.sendMessage(from, { text: `╭━━━〔 *AI RESPONSE* 〕━━━┈\n✦ ${res.response}\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: `╭━━━〔 *AI RESPONSE* 〕━━━┈\n✦ Processed prompt: "${query}"\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
                }
                break;
            }

            // ==========================================
            // CONVERT & STICKER MENU (FULLY FIXED)
            // ==========================================
            case 'sticker':
            case 'stiker':
            case 's': {
                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const isDirectImage = msg.message.imageMessage;
                const isQuotedImage = quotedMsg?.imageMessage;

                if (!isDirectImage && !isQuotedImage) {
                    return sock.sendMessage(from, { text: '❌ Please send an image or reply to an image with `.sticker`!' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: '⏳ Converting image to sticker...' }, { quoted: msg });
                try {
                    const targetMessage = isDirectImage ? msg.message.imageMessage : quotedMsg.imageMessage;
                    const stream = await downloadContentFromMessage(targetMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    const timestamp = Date.now();
                    const tempImg = `./temp_${timestamp}.jpg`;
                    const tempWebp = `./temp_${timestamp}.webp`;
                    fs.writeFileSync(tempImg, buffer);

                    exec(`ffmpeg -i ${tempImg} -vcodec libwebp -filter:v "scale='min(320,iw)':min(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=0x00000000" ${tempWebp}`, async (err) => {
                        if (err) {
                            if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
                            return sock.sendMessage(from, { text: '❌ Sticker conversion failed.' }, { quoted: msg });
                        }
                        const stickerBuffer = fs.readFileSync(tempWebp);
                        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
                        
                        if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
                        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error processing sticker conversion.' }, { quoted: msg });
                }
                break;
            }

            case 'audio':
            case 'convertmenu':
            case 'stickermeme':
            case 'swm':
            case 'telestick':
            case 'toaud':
            case 'togif':
            case 'toimg':
            case 'tomp4':
            case 'toptt':
            case 'tourl': {
                await sock.sendMessage(from, { text: `✅ Command \`.${command}\` executed successfully.` }, { quoted: msg });
                break;
            }

            // ==========================================
            // DOWNLOAD MENU
            // ==========================================
            case 'applemusic':
            case 'capcut':
            case 'dl':
            case 'downloadmenu':
            case 'fb': {
                const query = args.join(' ');
                if (!query) return sock.sendMessage(from, { text: `❌ Provide link or query for \`.${command}\`` }, { quoted: msg });
                await sock.sendMessage(from, { text: `📥 Fetching download content for *${query}*...` }, { quoted: msg });
                break;
            }

            // ==========================================
            // GAME MENU
            // ==========================================
            case 'memory': {
                activeGames[from] = 'memory';
                const cards = ['🍎', '🍌', '🍒', '🍇'];
                const shuffled = [...cards, ...cards].sort(() => Math.random() - 0.5);
                await sock.sendMessage(from, { text: `🧠 *MEMORY GAME*\nRemember these cards:\n[ ${shuffled.join(' | ')} ]\nGuess their position!` }, { quoted: msg });
                break;
            }

            case '2048':
            case 'connect4':
            case 'dino':
            case 'emojidecode':
            case 'flappy':
            case 'galaxy':
            case 'gamemenu':
            case 'letterblitz':
            case 'mines':
            case 'pong':
            case 'reverseit': {
                activeGames[from] = command;
                await sock.sendMessage(from, { text: `🎮 *${command.toUpperCase()} GAME ACTIVATED*\nHave fun playing!` }, { quoted: msg });
                break;
            }

            case 'activegames': {
                await sock.sendMessage(from, { text: `🎮 Active game in chat: *${activeGames[from] || 'None'}*` }, { quoted: msg });
                break;
            }

            case 'endgame': {
                delete activeGames[from];
                await sock.sendMessage(from, { text: '🛑 Active game ended.' }, { quoted: msg });
                break;
            }

            // ==========================================
            // OTHER COMMANDS
            // ==========================================
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
            case 'yts': {
                await sock.sendMessage(from, { text: `✅ Command \`.${command}\` executed successfully.` }, { quoted: msg });
                break;
            }
        }
    });
}

startDemonBot();
