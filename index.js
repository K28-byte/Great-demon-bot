const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const P = require("pino");

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

    const sock = makeWASocket({
        logger: P({ level: "fatal" }),
        printQRInTerminal: false,
        auth: state,
    });

    // If not registered, generate a pairing code automatically
    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER; // Pulls your number from Railway variables
        if (phoneNumber) {
            setTimeout(async () => {
                let code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n========================================`);
                console.log(` YOUR WHATSAPP PAIRING CODE IS: ${code} `);
                console.log(`========================================\n`);
            }, 3000);
        } else {
            console.log("Please add your PHONE_NUMBER in Railway variables to get a pairing code!");
        }
    }

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection closed due to ", lastDisconnect?.error, ", reconnecting:", shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === "open") {
            console.log("Opened connection successfully, bot is online!");
        }
    });

    sock.ev.on("creds.update", saveCreds);
}

startBot();

