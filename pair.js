const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const pino = require("pino");

async function startPair() {
    const { state, saveCreds } = await useMultiFileAuthState("./temp_auth");
    const sock = makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state
    });

    if (!sock.authState.creds.registered) {
        // Put your exact phone number here with country code (no '+' sign)
        const phoneNumber = "2347061696819"; 
        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`\n=========================\nYOUR PAIRING CODE: ${code}\n=========================\n`);
        }, 3000);
    }

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (update) => {
        if (update.connection === "open") {
            console.log("Connected successfully!");
            process.exit(0);
        }
    });
}
startPair();
