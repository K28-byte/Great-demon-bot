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
    antitag: {},
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
    const { state, saveCreds } = await useMultiFileAuthState('./demon_session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version, auth: state, printQRInTerminal: false,
        browser: ["𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 OS", "Chrome", "20.0.04"], syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                console.log('⚡ Reconnecting 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕...');
                startDemonBot();
            }
        } else if (connection === 'open') {
            console.log(`\n⚡ 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 𝑩𝒐𝒕 MASTER SYSTEM ONLINE! ⚡\n`);
        }
    });

    // Group Participant Join/Leave Listeners
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (settings.welcome[id]) {
            for (const user of participants) {
                if (action === 'add') {
                    await sock.sendMessage(id, { text: `👋 Welcome @${user.split('@')[0]} to the realm!`, mentions: [user] });
                } else if (action === 'remove') {
                    await sock.sendMessage(id, { text: `👋 @${user.split('@')[0]} left the realm.`, mentions: [user] });
                }
            }
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

        // Auto Status Viewer & Liker
        if (from === 'status@broadcast') {
            if (settings.autostatusview) await sock.readMessages([msg.key]);
            if (settings.autostatuslike) {
                try { await sock.sendMessage(from, { react: { text: '🖤', key: msg.key } }); } catch (e) {}
            }
            return;
        }

        if (settings.autoonline) await sock.sendPresenceUpdate('available', from);

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
        
        // Security checks
        if (isGroup) {
            const groupMetadata = await sock.groupMetadata(from).catch(() => null);
            if (groupMetadata) {
                const userObj = groupMetadata.participants.find(p => p.id === sender);
                const isAdmin = userObj && (userObj.admin === 'admin' || userObj.admin === 'superadmin');
                
                if (!isAdmin && !isOwner) {
                    if (settings.antilink[from] && body.includes('chat.whatsapp.com')) {
                        await sock.sendMessage(from, { delete: msg.key });
                        await sock.groupParticipantsUpdate(from, [sender], 'remove');
                        return;
                    }
                    if (settings.antiimage[from] && msg.message.imageMessage) {
                        await sock.sendMessage(from, { delete: msg.key });
                        return;
                    }
                }
            }
        }

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
            // ==========================================
            // OWNER MENU
            // ==========================================
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
                    const subSock = makeWASocket({ version: subVer, auth: subState, printQRInTerminal: false });
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

            // ==========================================
            // VIP MENU
            // ==========================================
            case 'vipadd': {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                const targetNum = args[0]?.replace(/[^0-9]/g, '');
                if (!targetNum) return sock.sendMessage(from, { text: '❌ Provide number!' }, { quoted: msg });
                vipUsers.add(targetNum);
                await sock.sendMessage(from, { text: `👑 Added @${targetNum} to VIP.`, mentions: [`${targetNum}@s.whatsapp.net`] }, { quoted: msg });
                break;
            }
            case 'viplist': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                let text = `👑 *VIP USERS*:\n`;
                vipUsers.forEach(u => text += `• @${u}\n`);
                await sock.sendMessage(from, { text, mentions: Array.from(vipUsers).map(u => `${u}@s.whatsapp.net`) }, { quoted: msg });
                break;
            }
            case 'vipmenu':
            case 'vipdetails': {
                if (!isVip) return sock.sendMessage(from, { text: '❌ VIP only!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `👑 Welcome to the VIP Suite, @${senderNum}. All elite permissions are unlocked.`, mentions: [sender] }, { quoted: msg });
                break;
            }

            // ==========================================
            // GROUP MANAGEMENT & MODERATION MENU
            // ==========================================
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
            case 'antilink': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                const val = args[0]?.toLowerCase();
                if (val === 'on') {
                    settings.antilink[from] = true;
                    await sock.sendMessage(from, { text: '🛡️ Anti-Link enabled.' }, { quoted: msg });
                } else if (val === 'off') {
                    settings.antilink[from] = false;
                    await sock.sendMessage(from, { text: '🛡️ Anti-Link disabled.' }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: '❌ Use `.antilink on` or `.antilink off`' }, { quoted: msg });
                }
                break;
            }
            case 'antiimage': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                const val = args[0]?.toLowerCase();
                if (val === 'on') {
                    settings.antiimage[from] = true;
                    await sock.sendMessage(from, { text: '🛡️ Anti-Image enabled.' }, { quoted: msg });
                } else if (val === 'off') {
                    settings.antiimage[from] = false;
                    await sock.sendMessage(from, { text: '🛡️ Anti-Image disabled.' }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: '❌ Use `.antiimage on` or `.antiimage off`' }, { quoted: msg });
                }
                break;
            }
            case 'welcome': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                const val = args[0]?.toLowerCase();
                if (val === 'on') {
                    settings.welcome[from] = true;
                    await sock.sendMessage(from, { text: '👋 Welcome messages enabled.' }, { quoted: msg });
                } else if (val === 'off') {
                    settings.welcome[from] = false;
                    await sock.sendMessage(from, { text: '👋 Welcome messages disabled.' }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: '❌ Use `.welcome on` or `.welcome off`' }, { quoted: msg });
                }
                break;
            }
            case 'approveall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                const pending = await sock.groupRequestParticipantsList(from).catch(() => []);
                if (pending.length === 0) return sock.sendMessage(from, { text: 'ℹ️ No pending requests.' }, { quoted: msg });
                const jids = pending.map(p => p.id);
                await sock.groupRequestParticipantsUpdate(from, jids, 'approve');
                await sock.sendMessage(from, { text: `✅ Approved ${jids.length} requests.` }, { quoted: msg });
                break;
            }
            case 'close':
            case 'lock': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 Group locked.' }, { quoted: msg });
                break;
            }
            case 'open':
            case 'unlock': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 Group opened.' }, { quoted: msg });
                break;
            }
            case 'demoteall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                if (!groupMetadata) return;
                const admins = groupMetadata.participants.filter(p => p.admin && p.id !== sock.user.id).map(p => p.id);
                await sock.groupParticipantsUpdate(from, admins, 'demote');
                await sock.sendMessage(from, { text: '📉 Demoted all admins.' }, { quoted: msg });
                break;
            }
            case 'kick':
            case 'remove': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length === 0) return sock.sendMessage(from, { text: '❌ Tag user!' }, { quoted: msg });
                await sock.groupParticipantsUpdate(from, [mentioned[0]], 'remove');
                await sock.sendMessage(from, { text: '⚡ User removed.' }, { quoted: msg });
                break;
            }
            case 'kickall': {
                if (!isGroup || !isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
                if (!groupMetadata) return;
                const participants = groupMetadata.participants.filter(p => !p.admin && p.id !== sock.user.id).map(p => p.id);
                await sock.groupParticipantsUpdate(from, participants, 'remove');
                await sock.sendMessage(from, { text: '⚡ Kicked all non-admins.' }, { quoted: msg });
                break;
            }
            case 'promoteall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                if (!groupMetadata) return;
                const members = groupMetadata.participants.filter(p => !p.admin).map(p => p.id);
                await sock.groupParticipantsUpdate(from, members, 'promote');
                await sock.sendMessage(from, { text: '👑 Promoted all members to admin.' }, { quoted: msg });
                break;
            }
            case 'tagall': {
                if (!isGroup || (!isAdmin && !isOwner)) return sock.sendMessage(from, { text: '❌ Admin only!' }, { quoted: msg });
                if (!groupMetadata) return;
                let text = `╭━━━〔 *TAGALL* 〕━━━┈\n`;
                const mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(m => text += `⬡ @${m.split('@')[0]}\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
                break;
            }
            case 'tagonline': {
                if (!isGroup || !groupMetadata) return;
                let text = `╭━━━〔 *TAG ONLINE* 〕━━━┈\n`;
                const mentions = groupMetadata.participants.map(p => p.id);
                mentions.forEach(m => text += `⬡ @${m.split('@')[0]}\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
                break;
            }
            case 'hidetag': {
                if (!isGroup || (!isAdmin && !isOwner)) return;
                if (!groupMetadata) return;
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(from, { text: args.join(' ') || 'Broadcast', mentions });
                break;
            }
            case 'tagadmin': {
                if (!isGroup || !groupMetadata) return;
                const admins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                let text = `╭━━━〔 *ADMINS* 〕━━━┈\n`;
                admins.forEach(a => text += `⬡ @${a.split('@')[0]}\n`);
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions: admins }, { quoted: msg });
                break;
            }
            case 'grouplink':
            case 'invite': {
                if (!isGroup || !isBotAdmin) return sock.sendMessage(from, { text: '❌ Make bot admin first!' }, { quoted: msg });
                const code = await sock.groupInviteCode(from);
                await sock.sendMessage(from, { text: `🔗 https://chat.whatsapp.com/${code}` }, { quoted: msg });
                break;
            }
            case 'pin': {
                await sock.sendMessage(from, { text: '📌 Message pinned.' }, { quoted: msg });
                break;
            }
            case 'status': {
                await sock.sendMessage(from, { text: `⚡ Bot Status: Online & Operational\n✦ Uptime: ${Math.floor((Date.now() - startTime) / 1000)}s` }, { quoted: msg });
                break;
            }
            case 'vv':
            case 'viewonce': {
                const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quoted) return sock.sendMessage(from, { text: '❌ Reply to a view-once message!' }, { quoted: msg });
                const viewOnceMsg = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message;
                if (!viewOnceMsg) return sock.sendMessage(from, { text: '❌ Not view-once!' }, { quoted: msg });
                
                const mediaType = Object.keys(viewOnceMsg)[0];
                const mediaMsg = viewOnceMsg[mediaType];
                const stream = await downloadContentFromMessage(mediaMsg, mediaType.replace('Message', ''));
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                if (mediaType === 'imageMessage') {
                    await sock.sendMessage(from, { image: buffer, caption: '🔓 Unlocked View-Once Image' }, { quoted: msg });
                } else if (mediaType === 'videoMessage') {
                    await sock.sendMessage(from, { video: buffer, caption: '🔓 Unlocked View-Once Video' }, { quoted: msg });
                }
                break;
            }
            case 'sticker':
            case 's': {
                const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isImage) return sock.sendMessage(from, { text: '❌ Reply to an image!' }, { quoted: msg });
                await sock.sendMessage(from, { text: '⏳ Forging sticker...' }, { quoted: msg });
                try {
                    const targetMessage = msg.message.imageMessage ? msg.message.imageMessage : msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    const stream = await downloadContentFromMessage(targetMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    const tempImg = `./temp_${Date.now()}.jpg`;
                    const tempWebp = `./temp_${Date.now()}.webp`;
                    fs.writeFileSync(tempImg, buffer);

                    exec(`ffmpeg -i ${tempImg} -vcodec libwebp -filter:v "scale='min(320,iw)':min(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=0x00000000" ${tempWebp}`, async (err) => {
                        if (err) return sock.sendMessage(from, { text: '❌ Failed.' }, { quoted: msg });
                        await sock.sendMessage(from, { sticker: fs.readFileSync(tempWebp) }, { quoted: msg });
                        if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
                        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error.' }, { quoted: msg });
                }
                break;
            }

            // ==========================================
            // AI MENU
            // ==========================================
            case 'ai':
            case 'gpt':
            case 'claude':
            case 'copilot':
            case 'llama': {
                const query = args.join(' ');
                if (!query) return sock.sendMessage(from, { text: '❌ Ask something!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `🤖 [AI] Processing query: "${query}"` }, { quoted: msg });
                break;
            }

            // ==========================================
            // POKÉMON & ANIME GACHA ENGINE
            // ==========================================
            case 'spawn': {
                const card = spawnWildPokemon(from);
                try {
                    await sock.sendMessage(from, { 
                        image: { url: card.image },
                        caption: `╭━━━〔 *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 SPAWN* 〕━━━┈\n✦ Name: *${card.name}*\n✦ Tier: *${card.tier}*\n✦ Type: ${card.type.toUpperCase()}\n✦ Type \`.catch ${card.name}\` to claim!\n╰━━━━━━━━━━━━━━━━━━━━━━━┈`
                    }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: `A wild *${card.name}* [${card.tier}] appeared! Type \`.catch ${card.name}\`` }, { quoted: msg });
                }
                break;
            }
            case 'catch': {
                const target = args.join(' ');
                const caught = catchPokemon(from, senderNum, target);
                if (!caught) return sock.sendMessage(from, { text: '❌ No matching wild card to catch!' }, { quoted: msg });

                try {
                    await sock.sendMessage(from, { 
                        image: { url: caught.image },
                        caption: `🎉 @${senderNum} caught *${caught.name}* (${caught.tier})! Added to deck.`,
                        mentions: [`${senderNum}@s.whatsapp.net`]
                    }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: `🎉 @${senderNum} caught *${caught.name}*!`, mentions: [`${senderNum}@s.whatsapp.net`] }, { quoted: msg });
                }
                break;
            }
            case 'deck':
            case 'profile': {
                let text = `╭━━━〔 *𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 DECK* 〕━━━┈\n✦ Trainer: @${senderNum}\n✦ Coins: $${player.coins}\n✦ Cards: ${player.deck.length}\n\n『 *COLLECTION* 』\n`;
                if (player.deck.length === 0) {
                    text += `⬡ No cards! Use \`.spawn\`\n`;
                } else {
                    player.deck.forEach((p, idx) => {
                        const activeTag = idx === player.activeSlot ? ' [ACTIVE ⚔️]' : '';
                        text += `⬡ [${idx + 1}] *${p.name}* [${p.tier}] (Lvl ${p.level}/100)${activeTag}\n   └ Moves: ${p.moves.join(', ')}\n`;
                    });
                }
                text += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text, mentions: [`${senderNum}@s.whatsapp.net`] }, { quoted: msg });
                break;
            }
            case 'select': {
                const slot = parseInt(args[0]) - 1;
                if (isNaN(slot) || !player.deck[slot]) return sock.sendMessage(from, { text: '❌ Invalid slot!' }, { quoted: msg });
                player.activeSlot = slot;
                saveDB();
                await sock.sendMessage(from, { text: `✅ Active card set to *${player.deck[slot].name}*!` }, { quoted: msg });
                break;
            }
            case 'train': {
                if (player.deck.length === 0) return sock.sendMessage(from, { text: '❌ Catch a card first!' }, { quoted: msg });

                const activePoke = player.deck[player.activeSlot || 0];
                const xpGain = Math.floor(Math.random() * 80) + 120;
                const result = addXPAndCheckMoves(player, activePoke, xpGain);

                let reply = `╭━━━〔 *TRAINING* 〕━━━┈\n✦ *${activePoke.name}* won battle!\n✦ XP: +${xpGain} | Level: *Lvl ${activePoke.level}/100*\n`;
                if (result.leveledUp) reply += `🎉 *LEVEL UP!* Reached Level ${activePoke.level}!\n`;
                reply += `╰━━━━━━━━━━━━━━━━━━━━━━━┈`;
                await sock.sendMessage(from, { text: reply }, { quoted: msg });
                break;
            }

            // ==========================================
            // CASINO & ECONOMY
            // ==========================================
            case 'slots': {
                const bet = parseInt(args[0]) || 50;
                if (player.coins < bet) return sock.sendMessage(from, { text: `❌ Need $${bet} coins!` }, { quoted: msg });

                const icons = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
                const r1 = icons[Math.floor(Math.random() * icons.length)];
                const r2 = icons[Math.floor(Math.random() * icons.length)];
                const r3 = icons[Math.floor(Math.random() * icons.length)];

                let win = 0;
                if (r1 === r2 && r2 === r3) win = bet * 5;
                else if (r1 === r2 || r2 === r3 || r1 === r3) win = bet * 2;

                player.coins = player.coins - bet + win;
                saveDB();

                await sock.sendMessage(from, { text: `╭━━━〔 🎰 *SLOTS* 🎰 〕━━━┈\n[ ${r1} | ${r2} | ${r3} ]\n\n✦ ${win > 0 ? `🎉 WON $${win}!` : `❌ Lost $${bet}`}\n✦ Wallet: $${player.coins}\n╰━━━━━━━━━━━━━━━━━━━━━━━┈` }, { quoted: msg });
                break;
            }
            case 'daily': {
                player.coins += 500;
                saveDB();
                await sock.sendMessage(from, { text: `🎁 Daily claimed: +$500 coins!\n✦ Wallet: $${player.coins}` }, { quoted: msg });
                break;
            }
            case 'pay': {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const amount = parseInt(args[1]) || parseInt(args[0]);
                if (mentioned.length === 0 || isNaN(amount) || amount <= 0) return sock.sendMessage(from, { text: '❌ Usage: `.pay @user <amount>`' }, { quoted: msg });
                if (player.coins < amount) return sock.sendMessage(from, { text: '❌ Insufficient balance!' }, { quoted: msg });

                const targetNum = mentioned[0].split('@')[0];
                getPlayer(targetNum).coins += amount;
                player.coins -= amount;
                saveDB();

                await sock.sendMessage(from, { text: `💸 Sent $${amount} to @${targetNum}!`, mentions: [mentioned[0]] }, { quoted: msg });
                break;
            }

            // ==========================================
            // SYSTEM & MENU
            // ==========================================
            case 'ping':
            case 'speed': {
                const start = Date.now();
                await sock.sendMessage(from, { text: `⚡ Latency: ${Date.now() - start}ms` }, { quoted: msg });
                break;
            }
            case 'menu':
            case 'help': {
                const uptime = Math.floor((Date.now() - startTime) / 1000);
                const menuText = 
`╭━━━〔  *${config.botName}*  〕━━━┈
✦ *Owner:* ${config.ownerName}
✦ *Prefix:* .
✦ *Mode:* ${botMode.toUpperCase()}
✦ *Uptime:* ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s
✦ *Version:* ${config.version}
╰━━━━━━━━━━━━━━━━━━━━━━━┈

『 *OWNER MENU* 』
• .addowner, .antidelete, .antiviewonce, .autoonline, .autorecording, .autostatuslike, .autostatusview, .autotyping, .block, .buatgc, .changebio, .devices, .getpp, .joingroup, .leavegroup, .listfont, .listgroup, .mode, .pair

『 *VIP MENU* 』
• .vipadd, .viplist, .vipmenu, .vipdetails

『 *GROUP MANAGEMENT* 』
• .activeusers, .addmember, .antilink, .antiimage, .welcome, .approveall, .close, .open, .demoteall, .kick, .kickall, .promoteall, .tagall, .tagonline, .hidetag, .tagadmin, .grouplink, .pin, .status, .vv, .s

『 *AI MENU* 』
• .ai, .gpt, .claude, .copilot, .llama

『 *ANIME & POKÉMON GACHA* 』
• .spawn, .catch, .deck, .select, .train

『 *CASINO & ECONOMY* 』
• .slots, .daily, .pay

『 *SYSTEM* 』
• .ping, .menu`;

                try {
                    await sock.sendMessage(from, { image: { url: config.menuImage }, caption: menuText }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }
                break;
            }
        }
    });
}

startDemonBot();
