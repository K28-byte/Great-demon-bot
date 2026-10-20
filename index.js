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

const usePairingCode = true;
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

        const from = msg.key
