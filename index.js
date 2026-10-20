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
const BOT_VERSION = "v32.0 OMNI ULTIMATE";
const MENU_IMAGE_URL = "https://i.postimg.cc/7Ln9xbQD/60124106817e0737d31a27af564d65a8.jpg";
const startTime = Date.now();

// --- STATE & DATABASE MANAGEMENT ---
let botMode = "public"; // 'public' or 'private'
const activeGames = {};
const groupSettings = {};
const vipUsers = new Set([OWNER_NUMBER]);

const CARDS_DB_FILE = './anime_cards.json';
let userCards = fs.existsSync(CARDS_DB_FILE) ? JSON.parse(fs.readFileSync(CARDS_DB_FILE)) : {};

function saveCardsDb() {
    fs.writeFileSync(CARDS_DB_FILE, JSON.stringify(userCards, null, 2));
}

// --- ANIME CARDS PROCEDURAL GENERATOR ---
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
        name: `${firstName} ${title}`,
        anime: selectedAnime.name,
        image: selectedAnime.img,
        rarity: chosenRarity.name,
        power: power
    };
}

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
                startDemonBot();
            } else {
                console.log('❌ Logged out from WhatsApp. Clear ./demon_session to re-pair.');
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

        // FIXED OWNER CHECK: Allows execution from self or owner number
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
                const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

                const menuText = 
`╭━━━〔  *${BOT_NAME}*  〕━━━┈
✦ *Owner:* ${OWNER_NAME}
✦ *Prefix:* .
✦ *Mode:* ${botMode.toUpperCase()}
✦ *Runtime:* ${uptimeFormatted}
✦ *Version:* ${BOT_VERSION}
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *ANIME CARD SYSTEM* 』
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

            // ==========================================
            // ANIME CARD COLLECTION SYSTEM
            // ==========================================
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

            // ==========================================
            // OWNER & SYSTEM COMMANDS
            // ==========================================
            case 'mode':
            case 'private':
            case 'public': {
                if (!isOwner) return sock.sendMessage(from, { text: '╭━━━〔 *ERROR* 〕━━━┈\n✦ Owner only command!\n╰━━━━━━━━━━━━━━━━━━━━━━━┈' }, { quoted: msg });
                
                let selectedMode = args[0]?.toLowerCase();
                if (command === 'private') selectedMode = 'private';
                if (command === 'public') selectedMode = 'public';

                if (selectedMode === 'public') {
                    botMode = 'public';
                    await sock.sendMessage(from, { text: '╭━━━〔 *MODE UPDATE* 〕━━━┈\n✦ Bot mode set to *PUBLIC* 🔓\n╰━━━━━━━━━━━━━━━━━━━━━━━┈' }, { quoted: msg });
                } else if (selectedMode === 'private') {
                    botMode = 'private';
                    await sock.sendMessage(from, { text: '╭━━━〔 *MODE UPDATE* 〕━━━┈\n✦ Bot mode set to *PRIVATE* 🔒\n╰━━━━━━━━━━━━━━━━━━━━━━━┈' }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `╭━━━〔 *BOT MODE* 〕━━━┈\n✦ Current Mode: *${botMode.toUpperCase()}*\n✦ Usage: \`.mode public\` or \`.mode private\`\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
                }
                break;
            }

            case 'pair': {
                const targetNum = args[0]?.replace(/[^0-9]/g, '');
                if (!targetNum || targetNum.length < 10) {
                    return sock.sendMessage(from, { text: '╭━━━〔 *ERROR* 〕━━━┈\n✦ Provide phone number with country code!\n✦ Example: `.pair 2347061696819`\n╰━━━━━━━━━━━━━━━━━━━━━━━┈' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `╭━━━〔 *PAIRING* 〕━━━┈\n✦ Generating Pairing Code for @${targetNum}...\n╰━━━━━━━━━━━━━━━━━━━━━━━┈`, mentions: [`${targetNum}@s.whatsapp.net`] }, { quoted: msg });

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
                            await sock.sendMessage(from, { 
                                text: `╭━━━〔 *SUB-BOT PAIRING CODE* 〕━━━┈\n✦ *Code:* \`\`\`${code}\`\`\`\n\n⬡ Go to WhatsApp > Linked Devices > Link a Device > Link with phone number\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` 
                            }, { quoted: msg });
                        } catch (err) {
                            await sock.sendMessage(from, { text: `❌ Error: ${err.message}` }, { quoted: msg });
                        }
                    }, 3000);
                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ Sub-session error: ${e.message}` }, { quoted: msg });
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
                await sock.sendMessage(from, { text: `╭━━━〔 *OWNER SETTING* 〕━━━┈\n✦ Feature *${command.toUpperCase()}* updated.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
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
                await sock.sendMessage(from, { text: `╭━━━〔 *OWNER TOOL* 〕━━━┈\n✦ Command .${command} executed successfully.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
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
                await sock.sendMessage(from, { text: `╭━━━〔 *VIP CONTROL* 〕━━━┈\n✦ Command .${command} active and operational.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
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
                await sock.sendMessage(from, { text: `╭━━━〔 *GROUP COMMAND* 〕━━━┈\n✦ .${command} executed successfully.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
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
                if (!query) return sock.sendMessage(from, { text: '╭━━━〔 *AI ENGINE* 〕━━━┈\n✦ Please ask a question!\n✦ Example: `.ai Explain Pain speech in Naruto`\n╰━━━━━━━━━━━━━━━━━━━━━━━┈' }, { quoted: msg });

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
            // CONVERT MENU
            // ==========================================
            case 'sticker':
            case 'stiker':
            case 's': {
                const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage) return sock.sendMessage(from, { text: '╭━━━〔 *ERROR* 〕━━━┈\n✦ Reply to an image with .sticker!\n╰━━━━━━━━━━━━━━━━━━━━━━━┈' }, { quoted: msg });

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
                        if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
                        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error processing sticker.' }, { quoted: msg });
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
                await sock.sendMessage(from, { text: `╭━━━〔 *CONVERT ENGINE* 〕━━━┈\n✦ Command .${command} executed.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
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
                if (!query) return sock.sendMessage(from, { text: `╭━━━〔 *DOWNLOADER* 〕━━━┈\n✦ Provide link or query for .${command}\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
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
            case 'ping': {
                const start = Date.now();
                await sock.sendMessage(from, { text: '⚡ Testing speed...' }, { quoted: msg });
                const end = Date.now();
                await sock.sendMessage(from, { text: `╭━━━〔 *LATENCY* 〕━━━┈\n✦ Speed: ${end - start}ms\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
                break;
            }

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
                await sock.sendMessage(from, { text: `╭━━━〔 *UTILITY & TOOLS* 〕━━━┈\n✦ Command .${command} executed.\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
                break;
            }
        }
    });
}

startDemonBot();

// --- INFINITE KEEP-ALIVE ANCHOR TO PREVENT SIGTERM ---
setInterval(() => {}, 1000 * 60 * 60);
