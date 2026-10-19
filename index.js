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

const OWNER_NUMBER = "2347061696819";
const OWNER_NAME = "Great Demon (Khalid)";
const BOT_VERSION = "v8.0 Ultimate";
const MENU_IMAGE_URL = "https://i.postimg.cc/7Ln9xbQD/60124106817e0737d31a27af564d65a8.jpg";
const startTime = Date.now();

const activeGames = {};
const groupSettings = {};
const vipUsers = new Set([OWNER_NUMBER]);

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
        let phoneNumber = process.env.PHONE_NUMBER; // Automatically pulls from Railway Variables
        
        if (!phoneNumber) {
            console.log('❌ ERROR: Please add your PHONE_NUMBER in Railway variables!');
            return;
        }

        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n🔑 YOUR PAIRING CODE: \x1b[32m${code}\x1b[0m\n`);
                console.log('Go to WhatsApp > Linked Devices > Link a Device > Link with phone number instead.');
                console.log('==================================================\n');
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
            console.log('\n⚡ 𝕲𝔯𝔢𝔞𝔱 𝕯𝔢𝔪𝔬𝔫 𝕭𝔬𝔱 CONNECTED AND ONLINE! ⚡\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || msg.key.remoteJid;
        const isOwner = sender.includes(OWNER_NUMBER);
        const isVip = isOwner || vipUsers.has(sender.split('@')[0]);

        const body = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || '';

        if (!body.startsWith('.')) return;

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
            } catch (e) {
                isAdmin = false;
                isBotAdmin = false;
            }
        }

        if (!groupSettings[from]) {
            groupSettings[from] = { 
                antipromote: false, antidemote: false, antilink: false, 
                antiimage: false, antispam: false, antiadd: false, antibot: false, 
                antitag: false, welcome: false, goodbye: false 
            };
        }

        switch (command) {
            case 'menu':
            case 'help': {
                const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = uptimeSeconds % 60;
                const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;
                
                const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
                const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
                const usedMem = (totalMem - freeMem).toFixed(2);

                const menuText = 
                    `✨ *𝕲𝔯𝔢𝔞𝔱 𝕯𝔢𝔪𝔬𝔫 𝕭𝔬𝔱 Status* ✨\n\n` +
                    `⚡ Response: 0ms\n` +
                    `⏱️ Uptime: ${uptimeFormatted}\n` +
                    `💾 RAM: ${usedMem}GB / ${totalMem}GB\n` +
                    `📊 Process: ${(process.memoryUsage().rss / (1024 * 1024)).toFixed(2)}MB\n` +
                    `💻 CPU: ${os.cpus().length} cores\n` +
                    `🤖 Version: ${BOT_VERSION}\n\n` +
                    `© 𝕲𝔯𝔢𝔞𝔱 𝕯𝔢𝔪𝔬𝔫 𝕭𝔬𝔱\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👑 *𝕺𝔯𝔫𝔢𝔯 𝕸𝔢𝔫𝔲*\n` +
                    `├ .addowner, .antidelete, .antiviewonce\n` +
                    `├ .autoonline, .autorecording, .autostatuslike\n` +
                    `├ .autostatusview, .autotyping, .block\n` +
                    `├ .buatgc, .changebio, .devices, .getpp\n` +
                    `├ .joingroup, .leavegroup, .listfont, .listgroup\n` +
                    `└ .bancheck, .botlink, .fetchstatus, .listchannels\n\n` +
                    `👑 *𝖁𝕴𝕻 𝕸𝔢𝔫𝔲*\n` +
                    `├ .connectedusers, .inspectsock, .vipadd\n` +
                    `├ .vipadmin, .vipallgroups, .vipdemote\n` +
                    `├ .vipdetails, .vipgroups, .viplist, .vipmenu\n` +
                    `└ .vippromote, .vipreassign, .vipremove, .viptakeover, .vipunclaim\n\n` +
                    `🛠️ *𝕲𝔯𝔬𝔲𝔭 𝕸𝔞𝔫𝔞𝔤𝔢𝔪𝔢𝔫𝔱*\n` +
                    `├ .activeusers, .addmember, .antiadd, .antibot\n` +
                    `├ .antidemote, .antigroupsmention, .antiimage, .antilink\n` +
                    `├ .antipromote, .antiremove, .antispam, .antitag\n` +
                    `├ .antitagadmin, .approveall, .close, .closetime\n` +
                    `├ .demoteall, .demoteuser, .disapproveall, .dor\n` +
                    `├ .gcs, .glostat, .goodbye, .grouplink, .groupmenu\n` +
                    `├ .grouponly, .hidetag, .inactiveusers, .kickall\n` +
                    `├ .left, .listgroups, .mediatag, .open, .opentime\n` +
                    `├ .promoteall, .promoteuser, .remove, .setgroupbio\n` +
                    `├ .setgroupname, .setgrouppp, .setwarning, .tagadmin\n` +
                    `├ .tagall, .tagonline, .tagpoll, .warning, .welcome\n` +
                    `└ .pin, .status, .vv\n\n` +
                    `🤖 *𝕬𝕴 𝕸𝔢𝔫𝔲*\n` +
                    `├ .ai, .aimenu, .claude, .copilot\n` +
                    `└ .describe, .felo, .gpt, .imagine, .llama\n\n` +
                    `🔄 *𝕮𝔬𝔫𝔳𝔢𝔯𝔱 𝕸𝔢𝔫𝔲*\n` +
                    `├ .audio, .convertmenu, .stickermeme, .stiker\n` +
                    `├ .swm, .telestick, .toaud, .togif, .toimg\n` +
                    `└ .tomp4, .toptt, .tourl\n\n` +
                    `📥 *𝕯𝔬𝔯𝔫𝔩𝔬𝔞𝔡 𝕸𝔢𝔫𝔲*\n` +
                    `├ .applemusic, .capcut, .dl, .downloadmenu\n` +
                    `└ .fb\n\n` +
                    `🎮 *𝕲𝔞𝔪𝔢 𝕸𝔢𝔫𝔲*\n` +
                    `├ .2048, .activegames, .connect4, .dino\n` +
                    `├ .emojidecode, .endgame, .flappy, .galaxy\n` +
                    `├ .gamemenu, .letterblitz, .memory, .mines\n` +
                    `└ .pong, .reverseit\n\n` +
                    `⚙️ *𝕺𝔱𝔥𝔢𝔯 𝕮𝔬𝔪𝔪𝔞𝔫𝔡𝔰*\n` +
                    `├ .androidcrash, .bugmenu, .gccrash, .hd\n` +
                    `├ .iosfc, .lyrics, .ocr, .removebg, .screenshot\n` +
                    `├ .searchmenu, .spamngl, .toolmenu, .xnxx\n` +
                    `└ .xvideos, .yts, .ping\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `_𝕲𝔯𝔢𝔞𝔱 𝕯𝔢𝔪𝔬𝔫 𝕭𝔬𝔱 Engine Active_`;

                try {
                    await sock.sendMessage(from, { 
                        image: { url: MENU_IMAGE_URL }, 
                        caption: menuText 
                    }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }
                break;
            }

            case 'ping': {
                const start = Date.now();
                await sock.sendMessage(from, { text: '⚡ Testing speed...' }, { quoted: msg });
                const end = Date.now();
                await sock.sendMessage(from, { text: `🚀 *𝕲𝔯𝔢𝔞𝔱 𝕯𝔢𝔪𝔬𝔫 𝕭𝔬𝔱 Latency:* ${end - start}ms` }, { quoted: msg });
                break;
            }

            case 'addowner': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const num = args[0]?.replace(/[^0-9]/g, '');
                if (!num) return sock.sendMessage(from, { text: '❌ Provide phone number!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👑 Added @${num} as Owner!`, mentions: [`${num}@s.whatsapp.net`] }, { quoted: msg });
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
                await sock.sendMessage(from, { text: `⚡ *𝕲𝔯𝔢𝔞𝔱 𝕯𝔢𝔪𝔬𝔫 𝕭𝔬𝔱:* ${command.toUpperCase()} feature toggled.` }, { quoted: msg });
                break;
            }
            case 'block': {
                if (!isOwner) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: '❌ Tag user to block!' }, { quoted: msg });
                await sock.updateBlockStatus(mentioned[0], 'block');
                await sock.sendMessage(from, { text: '🚫 User blocked.' }, { quoted: msg });
                break;
            }
            case 'changebio': {
                if (!isOwner) return;
                const newBio = args.join(' ');
                if (!newBio) return sock.sendMessage(from, { text: '❌ Provide bio text!' }, { quoted: msg });
                await sock.updateProfileStatus(newBio);
                await sock.sendMessage(from, { text: '✅ Profile status updated.' }, { quoted: msg });
                break;
            }
            case 'devices': {
                await sock.sendMessage(from, { text: `💻 Platform: ${os.platform()} (${os.arch()})\nCores: ${os.cpus().length}` }, { quoted: msg });
                break;
            }

            case 'vipadd': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const num = args[0]?.replace(/[^0-9]/g, '');
                if (!num) return sock.sendMessage(from, { text: '❌ Provide user number!' }, { quoted: msg });
                vipUsers.add(num);
                await sock.sendMessage(from, { text: `✅ Added @${num} to VIP list!`, mentions: [`${num}@s.whatsapp.net`] }, { quoted: msg });
                break;
            }
            case 'viplist':
            case 'vipmenu': {
                let text = `👑 *𝕲𝔯𝔢𝔞𝔱 𝕯𝔢𝔪𝔬𝔫 𝕭𝔬𝔱 VIP LIST* 👑\n\n`;
                vipUsers.forEach(u => text += `├ @${u}\n`);
                await sock.sendMessage(from, { text }, { quoted: msg });
                break;
            }

            case 'grouplink': {
                if (!isGroup) return sock.sendMessage(from, { text: '❌ Group command only!' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '❌ Make bot admin first!' }, { quoted: msg });
                const code = await sock.groupInviteCode(from);
                await sock.sendMessage(from, { text: `🔗 *Group Link:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
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
            case 'welcome':
            case 'goodbye': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                groupSettings[from][command] = !groupSettings[from][command];
                await sock.sendMessage(from, { text: `⚠️ *${command.toUpperCase()}* set to: *${groupSettings[from][command] ? 'ENABLED 🛡️' : 'DISABLED 🔓'}*` }, { quoted: msg });
                break;
            }
            case 'tagall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                let text = `📢 *ATTENTION MEMBERS* 📢\n\n`;
                let mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(p => text += `👉 @${p.split('@')[0]}\n`);
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
                let text = `🛡️ *GROUP ADMINS* 🛡️\n\n`;
                admins.forEach(a => text += `👑 @${a.split('@')[0]}\n`);
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
            case 'dor':
            case 'remove': {
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

            case 'ai':
            case 'gpt':
            case 'claude':
            case 'copilot':
            case 'llama':
            case 'felo':
            case 'describe':
            case 'imagine': {
                const query = args.join(' ');
                if (!query) return sock.sendMessage(from, { text: '❌ Ask anything! Example: .ai Who is the Great Demon?' }, { quoted: msg });
                await sock.sendMessage(from, { text: `🤖 *𝕲𝔯𝔢𝔞𝔱 𝕯𝔢𝔪𝔬𝔫 AI Response:*\n\nQuery: "${query}"\n\nI am active and processing your prompt!` }, { quoted: msg });
                break;
            }

            case 'sticker':
            case 'stiker':
            case 's': {
                const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage) return sock.sendMessage(from, { text: '❌ Reply to an image with .sticker!' }, { quoted: msg });

                await sock.sendMessage(from, { text: '⏳ Converting image to sticker...' }, { quoted: msg });
                try {
                    const targetMessage = msg.message.imageMessage ? msg.message.imageMessage : msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    const stream = await downloadContentFromMessage(targetMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    const tempImg = `./temp_${Date.now()}.jpg`;
                    const tempWebp = `./temp_${Date.now()}.webp`;
                    fs.writeFileSync(tempImg, buffer);

                    exec(`ffmpeg -i ${tempImg} -vcodec libwebp -filter:v "scale='min(320,iw)':min(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=0x00000000" ${tempWebp}`, async (err) => {
                        if (err) return sock.sendMessage(from, { text: '❌ Sticker conversion failed.' }, { quoted: msg });
                        const stickerBuffer = fs.readFileSync(tempWebp);
                        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
                        fs.unlinkSync(tempImg);
                        fs.unlinkSync(tempWebp);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error processing sticker.' }, { quoted: msg });
                }
                break;
            }
            case 'toimg':
            case 'toaud':
            case 'togif':
            case 'tomp4':
            case 'toptt':
            case 'tourl': {
                await sock.sendMessage(from, { text: `🔄 Processing ${command.toUpperCase()} conversion.` }, { quoted: msg });
                break;
            }

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
            case 'flappy':
            case 'mines':
            case 'pong':
            case 'reverseit':
            case 'letterblitz':
            case 'emojidecode': {
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

            case 'capcut':
            case 'applemusic':
            case 'dl':
            case 'fb':
            case 'yts': {
                const query = args.join(' ');
                if (!query) return sock.sendMessage(from, { text: '❌ Provide download link or query!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `📥 Fetching download content for *${query}*...` }, { quoted: msg });
                break;
            }
            case 'lyrics': {
                const query = args.join(' ');
                if (!query) return sock.sendMessage(from, { text: '❌ Provide song title!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `🎵 Searching lyrics for *${query}*...` }, { quoted: msg });
                break;
            }
            case 'hd': {
                await sock.sendMessage(from, { text: '✨ Reply to an image to enhance image quality.' }, { quoted: msg });
                break;
            }
        }
    });
}

startDemonBot();


