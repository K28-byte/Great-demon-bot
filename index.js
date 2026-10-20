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
const BOT_VERSION = "v31.0 ULTIMATE STABLE";
const MENU_IMAGE_URL = "https://i.postimg.cc/7Ln9xbQD/60124106817e0737d31a27af564d65a8.jpg";
const startTime = Date.now();

// --- STATE & DATABASE MANAGEMENT ---
let botMode = "public"; 
const activeGames = {};
const groupSettings = {};
const vipUsers = new Set([OWNER_NUMBER]);

const CARDS_DB_FILE = './anime_cards.json';
let userCards = fs.existsSync(CARDS_DB_FILE) ? JSON.parse(fs.readFileSync(CARDS_DB_FILE)) : {};

function saveCardsDb() {
    fs.writeFileSync(CARDS_DB_FILE, JSON.stringify(userCards, null, 2));
}

// --- THOUSANDS OF CARDS PROCEDURAL GENERATOR WITH IMAGES ---
const FIRST_NAMES = [
    "Levi", "Gojo", "Naruto", "Luffy", "Ichigo", "Tanjiro", "Eren", "Ken", "Nezuko", "Pain",
    "Sasuke", "Zoro", "Kakashi", "Goku", "Vegeta", "Saitama", "Sukuna", "Denji", "Power", "Makima",
    "Yuji", "Megumi", "Killua", "Gon", "Kurapika", "Hisoka", "Asta", "Yuno", "Noelle", "Yami",
    "Rimuru", "Anos", "Ainz", "Subaru", "Emilia", "Rem", "Rudeus", "Sung Jin-woo", "Chrollo", "Meruem"
];

const TITLES = [
    "The Demon Emperor", "Shadow Monarch", "Supreme Sorcerer", "Blade of Vengeance", "God of Shinobi",
    "King of Curses", "The Undefeated", "Awakened Berserker", "Dragon Slayer", "Absolute Authority",
    "Silent Reaper", "Titan Shifter", "Phantom Thief", "Celestial Knight", "Immortal Sovereign"
];

const ANIMES = [
    { name: "Attack on Titan", img: "https://i.postimg.cc/m2V3Z977/aot.jpg" },
    { name: "Jujutsu Kaisen", img: "https://i.postimg.cc/Kv7yZ68g/jjk.jpg" },
    { name: "Naruto Shippuden", img: "https://i.postimg.cc/jd2f7C0W/naruto.jpg" },
    { name: "One Piece", img: "https://i.postimg.cc/9Q5f6X38/luffy.jpg" },
    { name: "Bleach", img: "https://i.postimg.cc/85w9W5Yg/bleach.jpg" },
    { name: "Demon Slayer", img: "https://i.postimg.cc/fb5d6V0j/demonslayer.jpg" },
    { name: "Solo Leveling", img: "https://i.postimg.cc/q732z35D/sololeveling.jpg" },
    { name: "Chainsaw Man", img: "https://i.postimg.cc/029Yg8J7/chainsaw.jpg" }
];

const RARITIES = [
    { name: "⭐ Common", chance: 40, powerMin: 100, powerMax: 500 },
    { name: "⭐⭐ Uncommon", chance: 25, powerMin: 501, powerMax: 1500 },
    { name: "⭐⭐⭐ Rare", chance: 15, powerMin: 1501, powerMax: 3500 },
    { name: "⭐⭐⭐⭐ Epic", chance: 10, powerMin: 3501, powerMax: 7000 },
    { name: "⭐⭐⭐⭐⭐ Legendary", chance: 7, powerMin: 7001, powerMax: 15000 },
    { name: "🔥⚡ MYTHIC GOD", chance: 3, powerMin: 15001, powerMax: 50000 }
];

function generateRandomCard() {
    const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const title = TITLES[Math.floor(Math.random() * TITLES.length)];
    const selectedAnime = ANIMES[Math.floor(Math.random() * ANIMES.length)];
    
    const roll = Math.random() * 100;
    let cumulative = 0;
    let chosenRarity = RARITIES[0];
    for (const r of RARITIES) {
        cumulative += r.chance;
        if (roll <= cumulative) {
            chosenRarity = r;
            break;
        }
    }

    const power = Math.floor(Math.random() * (chosenRarity.powerMax - chosenRarity.powerMin + 1)) + chosenRarity.powerMin;
    const cardId = 'CARD-' + Math.floor(100000 + Math.random() * 900000);

    return {
        id: cardId,
        name: `${firstName}${title}`,
        anime: selectedAnime.name,
        image: selectedAnime.img,
        rarity: chosenRarity.name,
        power: power
    };
}

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
        console.log('\n==================================================');
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

        switch (command) {
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

『 *ANIME CARD COLLECTION* 』
╭━━━━━━━━━━━━━━━━━━━━━━━┈
⬡ .spawncard - Spawn card with image!
⬡ .catch - Claim spawned card
⬡ .mycards - View collection
⬡ .leaderboard - Top collectors
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

_© 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 Engine Active_`;

                try {
                    await sock.sendMessage(from, { image: { url: MENU_IMAGE_URL }, caption: menuText }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }
                break;
            }

            case 'spawncard': {
                const newCard = generateRandomCard();
                const spawnCaption = 
`🃏 *WILD ANIME CARD SPAWNED!* 🃏
✨ Over 10,000 unique card combinations!

✦ *ID:* \`\`\`${newCard.id}\`\`\`
✦ *Character:* ${newCard.name}
✦ *Anime:* ${newCard.anime}
✦ *Rarity:* ${newCard.rarity}
✦ *Power Level:* ⚡ ${newCard.power}

👉 Reply to this message with **.catch** to claim it!`;

                try {
                    const sentMsg = await sock.sendMessage(from, { image: { url: newCard.image }, caption: spawnCaption }, { quoted: msg });
                    activeGames[from] = { type: 'card_spawn', card: newCard, messageKey: sentMsg.key };
                } catch (e) {
                    const sentMsg = await sock.sendMessage(from, { text: spawnCaption }, { quoted: msg });
                    activeGames[from] = { type: 'card_spawn', card: newCard, messageKey: sentMsg.key };
                }
                break;
            }

            case 'catch': {
                const activeSpawn = activeGames[from];
                if (!activeSpawn || activeSpawn.type !== 'card_spawn') {
                    return sock.sendMessage(from, { text: '❌ No active card spawn right now! Type `.spawncard` to generate one.' }, { quoted: msg });
                }

                const card = activeSpawn.card;
                if (!userCards[senderNum]) userCards[senderNum] = [];
                userCards[senderNum].push(card);
                saveCardsDb();

                delete activeGames[from];

                await sock.sendMessage(from, { 
                    text: `🎉 *SUCCESSFULLY CLAIMED!* 🎉\n\n@${senderNum} caught *${card.name}* [${card.rarity}] (Power: ⚡${card.power})!`,
                    mentions: [sender]
                }, { quoted: msg });
                break;
            }

            case 'mycards': {
                const collection = userCards[senderNum] || [];
                if (collection.length === 0) {
                    return sock.sendMessage(from, { text: `🎒 @${senderNum}, your inventory is empty! Type \`.spawncard\` to start collecting.`, mentions: [sender] }, { quoted: msg });
                }

                let totalPower = collection.reduce((acc, c) => acc + c.power, 0);
                let text = `╭━━━〔 *${senderNum}'s CARD COLLECTION* 〕━━━┈\n✦ Total Cards: ${collection.length}\n✦ Total Power: ⚡${totalPower}\n\n`;
                
                collection.slice(-10).forEach((c, idx) => {
                    text += `⬡ ${idx + 1}. *${c.name}* (${c.rarity}) - ⚡${c.power}\n`;
                });
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;

                await sock.sendMessage(from, { text, mentions: [sender] }, { quoted: msg });
                break;
            }

            case 'leaderboard': {
                const entries = Object.entries(userCards);
                if (entries.length === 0) return sock.sendMessage(from, { text: '📊 No collectors yet!' }, { quoted: msg });

                entries.sort((a, b) => b[1].length - a[1].length);
                let text = `╭━━━〔 *TOP ANIME CARD COLLECTORS* 〕━━━┈\n`;
                entries.slice(0, 5).forEach(([num, cards], i) => {
                    let totalP = cards.reduce((acc, c) => acc + c.power, 0);
                    text += `⬡ ${i + 1}. @${num} - *${cards.length} cards* (⚡${totalP} Power)\n`;
                });
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;

                await sock.sendMessage(from, { text, mentions: entries.map(e => `${e[0]}@s.whatsapp.net`) }, { quoted: msg });
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

            case 'ai':
            case 'gpt': {
                const query = args.join(' ');
                if (!query) return sock.sendMessage(from, { text: '❌ Please ask a question!' }, { quoted: msg });

                await sock.sendMessage(from, { text: '⚡ *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 AI Thinking...*' }, { quoted: msg });
                try {
                    const res = await fetchJson(`https://api.popcat.xyz/chatbot?msg=${encodeURIComponent(query)}&owner=${encodeURIComponent(OWNER_NAME)}&botname=${encodeURIComponent(BOT_NAME)}`);
                    await sock.sendMessage(from, { text: `╭━━━〔 *AI RESPONSE* 〕━━━┈\n✦ ${res.response}\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: `╭━━━〔 *AI RESPONSE* 〕━━━┈\n✦ Processed prompt: "${query}"\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
                }
                break;
            }

            case 'sticker':
            case 'stiker':
            case 's': {
                const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage) return sock.sendMessage(from, { text: '❌ Reply to an image with `.sticker`!' }, { quoted: msg });

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
                        await sock.sendMessage(from, { sticker: fs.readFileSync(tempWebp) }, { quoted: msg });
                        if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
                        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error processing sticker.' }, { quoted: msg });
                }
                break;
            }

            case 'tagall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Group Admin only!' }, { quoted: msg });
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
            case 'remove': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: '❌ Tag user to remove!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'remove');
                await sock.sendMessage(from, { text: '✅ User removed from group.' }, { quoted: msg });
                break;
            }

            case 'grouplink': {
                if (!isGroup) return sock.sendMessage(from, { text: '❌ Group command only!' }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: '❌ Make bot admin first!' }, { quoted: msg });
                const code = await sock.groupInviteCode(from);
                await sock.sendMessage(from, { text: `🔗 *Group Link:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
                break;
            }
        }
    });
}

startDemonBot();

// --- INFINITE KEEP-ALIVE ANCHOR TO PREVENT SIGTERM ---
setInterval(() => {}, 1000 * 60 * 60);
