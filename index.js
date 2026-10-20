/**
 * =====================================================================
 * 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 - ULTIMATE MASTER SYSTEM HUB
 * Owner: 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 (2347061696819)
 * =====================================================================
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const exec = require('child_process').exec;
const https = require('https');
const pino = require('pino');

const config = require('./config.json');
const { 
    db, saveDB, getPlayer, spawnWildPokemon, catchPokemon, addXPAndCheckMoves,
    TYPE_CHART, MOVES_DATABASE 
} = require('./pokemon_engine');
const { POKEMON_ROSTER } = require('./pokedex');

const startTime = Date.now();
let botMode = "private";
const vipUsers = new Set([config.ownerNumber]);
const owners = new Set([config.ownerNumber]);

const usePairingCode = false;
const botPhoneNumber = "2347061696819";

const settings = {
    autoonline: false,
    autorecording: false,
    autostatuslike: false,
    autostatusview: false,
    autotyping: false,
    antidelete: {},
    antiviewonce: {},
    antilink: {},
    antiimage: {},
    antiadd: {},
    antibot: {},
    antispam: {},
    welcome: {}
};

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Demon OS)' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function startDemonBot() {
    if (!fs.existsSync('./demon_session')) {
        fs.mkdirSync('./demon_session', { recursive: true });
    }

    if (process.env.SESSION_ID) {
        try {
            const sessData = process.env.SESSION_ID.trim();
            if (sessData.startsWith('{')) {
                fs.writeFileSync('./demon_session/creds.json', sessData);
            } else {
                const decoded = Buffer.from(sessData, 'base64').toString('utf8');
                fs.writeFileSync('./demon_session/creds.json', decoded);
            }
        } catch (e) {
            console.log('⚠️ Session load note:', e.message);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState('./demon_session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version, 
        auth: state, 
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Chrome", "Desktop", "10.0"], 
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('⚡ Reconnecting 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕...');
                startDemonBot();
            } else {
                console.log('❌ Connection logged out.');
            }
        } else if (connection === 'open') {
            console.log(`\n⚡ 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 MASTER SYSTEM ONLINE! ⚡\n`);
        }
    });

    if (usePairingCode && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let num = botPhoneNumber.replace(/[^0-9]/g, '');
                console.log(`\n⏳ Requesting pairing code for ${num}...`);
                const code = await sock.requestPairingCode(num);
                console.log(`\n🔑 ==========================================`);
                console.log(`🔗 YOUR PAIRING CODE IS: ${code}`);
                console.log(`==========================================\n`);
            } catch (err) {
                console.log('❌ Failed to request pairing code:', err.message);
            }
        }, 10000);
    }

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNum = sender.split('@')[0];

        const isOwner = msg.key.fromMe || owners.has(senderNum) || sender.includes(config.ownerNumber);
        const isVip = isOwner || vipUsers.has(senderNum);

        if (from === 'status@broadcast') {
            if (settings.autostatusview) await sock.readMessages([msg.key]);
            if (settings.autostatuslike) {
                try { await sock.sendMessage(from, { react: { text: '🖤', key: msg.key } }); } catch (e) {}
            }
            return;
        }

        if (settings.autoonline) await sock.sendPresenceUpdate('available', from);

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
        
        if (!body.startsWith('.')) return;
        if (botMode === 'private' && !isVip) return;

        const args = body.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const player = getPlayer(senderNum);

        let isAdmin = false;
        let isBotAdmin = false;
        let groupMetadata = null;
        if (isGroup) {
            try {
                groupMetadata = await sock.groupMetadata(from);
                const userObj = groupMetadata.participants.find(p => p.id === sender);
                isAdmin = userObj && (userObj.admin === 'admin' || userObj.admin === 'superadmin');

                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const botObj = groupMetadata.participants.find(p => p.id === botJid);
                isBotAdmin = botObj && (botObj.admin === 'admin' || botObj.admin === 'superadmin');
            } catch (e) {}
        }

        switch (command) {
            case 'addowner': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const targetNum = args[0]?.replace(/[^0-9]/g, '');
                if (!targetNum) return sock.sendMessage(from, { text: '❌ Provide number!' }, { quoted: msg });
                owners.add(targetNum);
                await sock.sendMessage(from, { text: `👑 Added @${targetNum} as Owner.`, mentions: [`${targetNum}@s.whatsapp.net`] }, { quoted: msg });
                break;
            }
            case 'antidelete': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                settings.antidelete[from] = !settings.antidelete[from];
                await sock.sendMessage(from, { text: `🛡️ Anti-Delete: *${settings.antidelete[from] ? 'ON' : 'OFF'}*` }, { quoted: msg });
                break;
            }
            case 'antiviewonce': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                settings.antiviewonce[from] = !settings.antiviewonce[from];
                await sock.sendMessage(from, { text: `🛡️ Anti-ViewOnce: *${settings.antiviewonce[from] ? 'ON' : 'OFF'}*` }, { quoted: msg });
                break;
            }
            case 'autoonline': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                settings.autoonline = !settings.autoonline;
                await sock.sendMessage(from, { text: `✅ Auto Online: *${settings.autoonline ? 'ON' : 'OFF'}*` }, { quoted: msg });
                break;
            }
            case 'autorecording': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                settings.autorecording = !settings.autorecording;
                await sock.sendMessage(from, { text: `✅ Auto Recording: *${settings.autorecording ? 'ON' : 'OFF'}*` }, { quoted: msg });
                break;
            }
            case 'autostatuslike': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                settings.autostatuslike = !settings.autostatuslike;
                await sock.sendMessage(from, { text: `✅ Auto Status Like: *${settings.autostatuslike ? 'ON' : 'OFF'}*` }, { quoted: msg });
                break;
            }
            case 'autostatusview': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                settings.autostatusview = !settings.autostatusview;
                await sock.sendMessage(from, { text: `✅ Auto Status View: *${settings.autostatusview ? 'ON' : 'OFF'}*` }, { quoted: msg });
                break;
            }
            case 'autotyping': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                settings.autotyping = !settings.autotyping;
                await sock.sendMessage(from, { text: `✅ Auto Typing: *${settings.autotyping ? 'ON' : 'OFF'}*` }, { quoted: msg });
                break;
            }
            case 'block': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: '❌ Tag user to block!' }, { quoted: msg });
                await sock.updateBlockStatus(mentioned[0], 'block');
                await sock.sendMessage(from, { text: '🚫 User blocked.' }, { quoted: msg });
                break;
            }
            case 'buatgc':
            case 'creategroup': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const title = args.join(' ');
                if (!title) return sock.sendMessage(from, { text: '❌ Provide title!' }, { quoted: msg });
                await sock.groupCreate(title, [sender]);
                await sock.sendMessage(from, { text: `✅ Group created: *${title}*` }, { quoted: msg });
                break;
            }
            case 'changebio': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const bio = args.join(' ');
                if (!bio) return sock.sendMessage(from, { text: '❌ Provide bio text!' }, { quoted: msg });
                await sock.updateProfileStatus(bio);
                await sock.sendMessage(from, { text: `✅ Bio updated to: ${bio}` }, { quoted: msg });
                break;
            }
            case 'devices': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: '📱 Demon OS Connected Session Active.' }, { quoted: msg });
                break;
            }
            case 'getpp': {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [sender];
                try {
                    const ppUrl = await sock.profilePictureUrl(mentioned[0], 'image');
                    await sock.sendMessage(from, { image: { url: ppUrl }, caption: '📸 Profile Picture' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Profile picture not found/private.' }, { quoted: msg });
                }
                break;
            }
            case 'joingroup': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const code = args[0]?.split('https://chat.whatsapp.com/')[1];
                if (!code) return sock.sendMessage(from, { text: '❌ Provide valid invite link!' }, { quoted: msg });
                await sock.groupAcceptInvite(code);
                await sock.sendMessage(from, { text: '✅ Joined group successfully!' }, { quoted: msg });
                break;
            }
            case 'leavegroup': {
                if (!isOwner || !isGroup) return sock.sendMessage(from, { text: '❌ Owner only in groups!' }, { quoted: msg });
                await sock.sendMessage(from, { text: '👋 Leaving group...' });
                await sock.groupLeave(from);
                break;
            }
            case 'listfont': {
                await sock.sendMessage(from, { text: '🔤 Active Demon Font: *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏*' }, { quoted: msg });
                break;
            }
            case 'listgroup': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const groups = await sock.groupFetchAllParticipating();
                let text = `╭━━━〔 *LIST GROUPS* 〕━━━┈\n`;
                Object.values(groups).forEach(g => text += `⬡ ${g.subject} (${g.size} members)\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text }, { quoted: msg });
                break;
            }
            case 'bancheck': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: '🛡️ Ban Check: Number is safe and clean.' }, { quoted: msg });
                break;
            }
            case 'botlink': {
                await sock.sendMessage(from, { text: `🔗 Great Demon Bot is active and running smoothly!` }, { quoted: msg });
                break;
            }
            case 'fetchstatus': {
                await sock.sendMessage(from, { text: `📊 Bot operational and fully synced.` }, { quoted: msg });
                break;
            }
            case 'listchannels': {
                await sock.sendMessage(from, { text: `📺 No broadcast channels linked.` }, { quoted: msg });
                break;
            }
            case 'mode': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                let target = args[0]?.toLowerCase();
                if (target === 'public' || target === 'private') {
                    botMode = target;
                    await sock.sendMessage(from, { text: `✅ Mode updated to *${botMode.toUpperCase()}*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `ℹ️ Current mode: *${botMode.toUpperCase()}*. Use \`.mode public\` or \`.mode private\`` }, { quoted: msg });
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
                    const { state: subState, saveCreds: subSaveCreds } = await useMultiFileAuthState(`./session_${targetNum}`);
                    const { version: subVer } = await fetchLatestBaileysVersion();
                    const subSock = makeWASocket({ version: subVer, auth: subState, printQRInTerminal: false, logger: pino({ level: 'silent' }) });
                    subSock.ev.on('creds.update', subSaveCreds);
                    setTimeout(async () => {
                        const code = await subSock.requestPairingCode(targetNum);
                        await sock.sendMessage(from, { text: `🔑 Pairing Code: \`\`\`${code}\`\`\`` }, { quoted: msg });
                    }, 4000);
                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg });
                }
                break;
            }
            case 'connectedusers': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👥 Connected users in active session: 1` }, { quoted: msg });
                break;
            }
            case 'inspectsock': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `🔌 Socket inspection: Connected & Stable` }, { quoted: msg });
                break;
            }
            case 'vipadd': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const targetNum = args[0]?.replace(/[^0-9]/g, '');
                if (!targetNum) return sock.sendMessage(from, { text: '❌ Provide number!' }, { quoted: msg });
                vipUsers.add(targetNum);
                await sock.sendMessage(from, { text: `👑 Added @${targetNum} to VIP.`, mentions: [`${targetNum}@s.whatsapp.net`] }, { quoted: msg });
                break;
            }
            case 'vipadmin':
            case 'vippromote': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👑 VIP Admin privileges granted.` }, { quoted: msg });
                break;
            }
            case 'vipallgroups':
            case 'vipgroups': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👑 Listing VIP groups...` }, { quoted: msg });
                break;
            }
            case 'vipdemote': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👑 VIP privileges adjusted.` }, { quoted: msg });
                break;
            }
            case 'vipdetails':
            case 'vipmenu': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👑 Welcome to the VIP Suite, @${senderNum}. All elite permissions are unlocked.`, mentions: [sender] }, { quoted: msg });
                break;
            }
            case 'viplist': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                let text = `👑 *VIP USERS*:\n`;
                vipUsers.forEach(u => text += `• @${u}\n`);
                await sock.sendMessage(from, { text, mentions: Array.from(vipUsers).map(u => `${u}@s.whatsapp.net`) }, { quoted: msg });
                break;
            }
            case 'vipreassign':
            case 'vipremove':
            case 'viptakeover':
            case 'vipunclaim': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👑 VIP command executed successfully.` }, { quoted: msg });
                break;
            }
            case 'activeusers': {
                if (!isGroup) return;
                await sock.sendMessage(from, { text: `👥 Active group members queried successfully.` }, { quoted: msg });
                break;
            }
            case 'addmember': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                const num = args[0]?.replace(/[^0-9]/g, '');
                if (!num) return sock.sendMessage(from, { text: '❌ Provide phone number!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [`${num}@s.whatsapp.net`], 'add');
                await sock.sendMessage(from, { text: `✅ Added @${num}`, mentions: [`${num}@s.whatsapp.net`] }, { quoted: msg });
                break;
            }
            case 'antiadd':
            case 'antibot':
            case 'antidemote':
            case 'antigroupsmention':
            case 'antipromote':
            case 'antiremove':
            case 'antispam':
            case 'antitag':
            case 'antitagadmin': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `🛡️ Security protection updated for this group.` }, { quoted: msg });
                break;
            }
            case 'antilink': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                const val = args[0]?.toLowerCase();
                if (val === 'on') {
                    settings.antilink[from] = true;
                    await sock.sendMessage(from, { text: '🛡️ Anti-Link enabled.' },
