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
const http = require('http');

// --- RAILWAY KEEP-ALIVE HTTP SERVER (Prevents SIGTERM crashes) ---
const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 is online and running 24/7!\n');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Keep-alive HTTP server running on port ${PORT}`);
});

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
        if (!phoneNumber) {
            console.log('❌ ERROR: Please set PHONE_NUMBER in Railway Environment Variables!');
            return;
        }
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

        switch (command) {
            case 'menu':
            case 'help': {
                const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = uptimeSeconds % 60;
                const uptimeFormatted = `${hours}h ${minutes}m${seconds}s`;

                const menuText = `╭━━━〔  *${BOT_NAME}*  〕━━━┈\n✦ *Owner:* ${OWNER_NAME}\n✦ *Prefix:* .\n✦ *Mode:*${botMode.toUpperCase()}\n✦ *Runtime:* ${uptimeFormatted}\n✦ *Version:*${BOT_VERSION}\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n『 *OWNER MENU* 』\n• .addowner, .antidelete, .antiviewonce, .autoonline, .autorecording, .autostatuslike, .autostatusview, .autotyping, .block, .buatgc, .changebio, .devices, .getpp, .joingroup, .leavegroup, .listfont, .listgroup, .bancheck, .botlink, .fetchstatus, .listchannels, .mode <public/private>, .pair <number>\n\n『 *VIP MENU* 』\n• .connectedusers, .inspectsock, .vipadd, .vipadmin, .vipallgroups, .vipdemote, .vipdetails, .vipgroups, .viplist, .vipmenu, .vippromote, .vipreassign, .vipremove, .viptakeover, .vipunclaim\n\n『 *GROUP MANAGEMENT* 』\n• .activeusers, .addmember, .antiadd, .antibot, .antidemote, .antigroupsmention, .antiimage, .antilink, .antipromote, .antiremove, .antispam, .antitag, .antitagadmin, .approveall, .close, .closetime, .demoteall, .demoteuser, .disapproveall, .dor, .gcs, .glostat, .goodbye, .grouplink, .groupmenu, .grouponly, .hidetag, .inactiveusers, .kickall, .left, .listgroups, .mediatag, .open, .opentime, .promoteall, .promoteuser, .remove, .setgroupbio, .setgroupname, .setgrouppp, .setwarning, .tagadmin, .tagall, .tagonline, .tagpoll, .warning, .welcome, .pin, .status, .vv\n\n『 *AI MENU* 』\n• .ai, .aimenu, .claude, .copilot, .describe, .felo, .gpt, .imagine, .llama\n\n『 *CONVERT MENU* 』\n• .audio, .convertmenu, .stickermeme, .stiker, .swm, .telestick, .toaud, .togif, .toimg, .tomp4, .toptt, .tourl\n\n『 *DOWNLOAD MENU* 』\n• .applemusic, .capcut, .dl, .downloadmenu, .fb\n\n『 *GAME MENU* 』\n• .2048, .activegames, .connect4, .dino, .emojidecode, .endgame, .flappy, .galaxy, .gamemenu, .letterblitz, .memory, .mines, .pong, .reverseit\n\n『 *OTHER* 』\n• .ping, .androidcrash, .bugmenu, .gccrash, .hd, .iosfc, .lyrics, .ocr, .removebg, .screenshot, .searchmenu, .spamngl, .toolmenu, .xnxx, .xvideos, .yts`;

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
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only command!' }, { quoted: msg });
                let selectedMode = args[0]?.toLowerCase();
                if (command === 'private') selectedMode = 'private';
                if (command === 'public') selectedMode = 'public';
                if (selectedMode === 'public' || selectedMode === 'private') {
                    botMode = selectedMode;
                    await sock.sendMessage(from, { text: `✅ Bot mode set to *${botMode.toUpperCase()}*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `ℹ️ Current Mode: *${botMode.toUpperCase()}*. Use \`.mode public\` or \`.mode private\`` }, { quoted: msg });
                }
                break;
            }
            case 'pair': {
                const targetNum = args[0]?.replace(/[^0-9]/g, '');
                if (!targetNum || targetNum.length < 10) {
                    return sock.sendMessage(from, { text: '❌ Usage: `.pair <number>`' }, { quoted: msg });
                }
                await sock.sendMessage(from, { text: `🔑 Requesting pairing code for @${targetNum}...`, mentions: [`${targetNum}@s.whatsapp.net`] }, { quoted: msg });
                try {
                    const tempSessionPath = `./session_sub_${targetNum}`;
                    const { state: subState, saveCreds: subSaveCreds } = await useMultiFileAuthState(tempSessionPath);
                    const { version } = await fetchLatestBaileysVersion();
                    const subSock = makeWASocket({ version, auth: subState, printQRInTerminal: false, browser: ["Ubuntu", "Chrome", "20.0.04"] });
                    subSock.ev.on('creds.update', subSaveCreds);
                    setTimeout(async () => {
                        const code = await subSock.requestPairingCode(targetNum);
                        await sock.sendMessage(from, { text: `🔑 Pairing Code: \`\`\`${code}\`\`\`` }, { quoted: msg });
                    }, 3000);
                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg });
                }
                break;
            }
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
                if (!query) {
                    await sock.sendMessage(from, { text: '❌ Please ask a question! Example: `.ai Explain Pain speech in Naruto`' }, { quoted: msg });
                    return;
                }
                await sock.sendMessage(from, { text: '🤖 Thinking...' }, { quoted: msg });
                try {
                    const res = await fetchJson(`https://api.popcat.xyz/chatbot?msg=${encodeURIComponent(query)}&owner=${encodeURIComponent(OWNER_NAME)}&botname=${encodeURIComponent(BOT_NAME)}`);
                    await sock.sendMessage(from, { text: `🤖 *AI Response*:\n\n${res.response}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: `🤖 Processed query: "${query}"` }, { quoted: msg });
                }
                break;
            }
            case 'sticker':
            case 'stiker':
            case 's': {
                const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage) return sock.sendMessage(from, { text: '❌ Reply to an image with .sticker!' }, { quoted: msg });
                await sock.sendMessage(from, { text: '⏳ Converting sticker...' }, { quoted: msg });
                try {
                    const targetMessage = msg.message.imageMessage ? msg.message.imageMessage : msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    const stream = await downloadContentFromMessage(targetMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    const tempImg = `./temp_${Date.now()}.jpg`;
                    const tempWebp = `./temp_${Date.now()}.webp`;
                    fs.writeFileSync(tempImg, buffer);
                    exec(`ffmpeg -i ${tempImg} -vcodec libwebp -filter:v "scale='min(320,iw)':min(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=0x00000000" ${tempWebp}`, async (err) => {
                        if (err) return sock.sendMessage(from, { text: '❌ Conversion failed.' }, { quoted: msg });
                        await sock.sendMessage(from, { sticker: fs.readFileSync(tempWebp) }, { quoted: msg });
                        if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
                        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error generating sticker.' }, { quoted: msg });
                }
                break;
            }
            case 'ping': {
                const start = Date.now();
                await sock.sendMessage(from, { text: `⚡ Latency: ${Date.now() - start}ms` }, { quoted: msg });
                break;
            }
        }
    });
}

startDemonBot();
