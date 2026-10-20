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
const http = require('http');
const pino = require('pino');

// Prevent unhandled crashes from killing the container
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Railway keep-alive web server bound strictly to 0.0.0.0
const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 is online and running 24/7!\n');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Keep-alive HTTP server running on port ${PORT}`);
});

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
    try {
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
                    setTimeout(() => startDemonBot(), 3000);
                } else {
                    console.log('❌ Connection logged out.');
                }
            } else if (connection === 'open') {
                console.log(`\n⚡ 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 MASTER SYSTEM ONLINE! ⚡\n`);
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
                case 'menu':
                case 'help': {
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const menuText = `╭━━━〔  *${config.botName}*  〕━━━┈\n✦ *Owner:* ${config.ownerName}\n✦ *Prefix:* .\n✦ *Mode:* ${botMode.toUpperCase()}\n✦ *Uptime:* ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s\n✦ *Version:* v10.0 ULTRA\n╰━━━━━━━━━━━━━━━━━━━━━━━┈\n\n『 *SYSTEM* 』\n• .ping, .menu`;
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                    break;
                }
                case 'ping': {
                    const start = Date.now();
                    await sock.sendMessage(from, { text: `⚡ Latency: ${Date.now() - start}ms` }, { quoted: msg });
                    break;
                }
            }
        });
    } catch (err) {
        console.error('❌ Error in startDemonBot:', err);
    }
}

startDemonBot();
