const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Great Demon Bot is active 24/7 under the rule of Demon Emperor!\n');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Keep-alive server running on 0.0.0.0:${PORT}`);
});

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

// --- PERSISTENT STATE MANAGEMENT ---
const SETTINGS_FILE = './settings.json';

function loadSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        } catch (e) {
            return { botMode: "public" };
        }
    }
    return { botMode: "public" };
}

function saveSettings(settings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

let currentSettings = loadSettings();
let botMode = currentSettings.botMode || "public"; 

const activeGames = {};
const groupSettings = {};
const vipUsers = new Set([OWNER_NUMBER]);
let prefix = ".";
const blockedUsers = new Set();
const autoSettings = {
    autoonline: true,
    autorecording: false,
    autostatuslike: false,
    autostatusview: false,
    autotyping: false
};

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

const spamMap = new Map();
const SPAM_LIMIT = 3;
const SPAM_TIME = 5000;
const COOLDOWN_TIME = 10000;

async function startDemonBot() {
    const sessionPath = './demon_session';

    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    if (process.env.SESSION_ID && process.env.SESSION_ID.trim().length > 20) {
        try {
            const rawId = process.env.SESSION_ID.trim().replace(/^GREAT_DEMON_/, '');
            const decodedCreds = Buffer.from(rawId, 'base64').toString('utf-8');
            fs.writeFileSync(path.join(sessionPath, 'creds.json'), decodedCreds);
            console.log('✅ Imperial Session successfully restored from SESSION_ID Environment Variable!');
        } catch (err) {
            console.log('❌ Failed to decode SESSION_ID:', err.message);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        markOnlineOnConnect: autoSettings.autoonline,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        console.log('\n==================================================');
        let phoneNumber = process.env.PHONE_NUMBER || OWNER_NUMBER;
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

        setTimeout(async () => {
            try {
                console.log(`⏳ Requesting Imperial Pairing Code for +${phoneNumber}...`);
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n🔑 YOUR PAIRING CODE: \x1b[32m${formattedCode}\x1b[0m\n`);
                console.log('==================================================\n');
            } catch (err) {
                console.log('❌ Error requesting pairing code:', err.message);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('⚡ Reconnecting Great Demon Bot...');
                startDemonBot();
            } else {
                console.log('❌ Session logged out from WhatsApp servers.');
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
        const senderNum = sender.split('@')[0].split(':')[0];

        const body = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || '';

        if (!body.startsWith('.')) return;

        const args = body.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const q = args.join(' ');

        const isOwner = msg.key.fromMe || senderNum === OWNER_NUMBER;
        const isVip = isOwner || vipUsers.has(senderNum);

        // Persistent Private Mode Check
        if (botMode === 'private' && !isVip) return;

        switch (command) {
            case 'menu':
            case 'help': {
                const menuText = `✦ 𝕲𝖗𝖊𝖆𝖙 𝕯𝖊𝖒𝖔𝖓 𝕰𝖒𝖕𝖊𝖗𝖔𝖗 𝕾𝖞𝖘𝖙𝖊𝖒 ✦\n👑 *Realm Mode:* ${botMode.toUpperCase()}\nUse .public or .private to switch modes.`;
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                break;
            }

            case 'mode':
            case 'private':
            case 'public': {
                if (!isOwner) return sock.sendMessage(from, { text: '⚔️ *Only My Lord Demon Emperor may alter realm permissions!*' }, { quoted: msg });
                
                let selectedMode = command;
                if (command === 'mode') {
                    selectedMode = args[0]?.toLowerCase();
                }

                if (selectedMode === 'public' || selectedMode === 'private') {
                    botMode = selectedMode;
                    saveSettings({ botMode });
                    await sock.sendMessage(from, { text: `👑 *Decree Enforced:* Domain mode set to *${botMode.toUpperCase()}*, My Lord!` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `⚔️ *Current State:* *${botMode.toUpperCase()}*` }, { quoted: msg });
                }
                break;
            }

            default: {
                if (command) {
                    await sock.sendMessage(from, { text: `✅ Command .${command} executed successfully, My Lord!` }, { quoted: msg });
                }
                break;
            }
        }
    });
}

startDemonBot();
