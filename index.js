const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage,
    makeInMemoryStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PHONE_NUMBER = process.env.PHONE_NUMBER || "94764802314";
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const startTime = Math.floor(Date.now() / 1000);

// InMemoryStore Safe Handling
let store;
try {
    store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
    store.readFromFile('./baileys_store_multi.json');
    setInterval(() => {
        try {
            store.writeToFile('./baileys_store_multi.json');
        } catch (e) {}
    }, 10000);
} catch (e) {
    console.log("Store initialization skipped or failed.");
}

// Default Configurations
let config = {
    botName: 'GM GAIYA - MD',
    botPresence: 'available',
    currentPrefix: '!',
    workMode: 'private', 
    autoReactEnabled: true,
    ownerReactEmoji: '👑',
    viewOnceDownload: true,
    githubToken: process.env.GITHUB_TOKEN || "NOT SET",
    githubRepo: process.env.GITHUB_REPO || "Gm-gaiya"
};

function loadSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            config = { ...config, ...JSON.parse(data) };
        } catch (e) {
            console.error("Settings load error:", e);
        }
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error("Settings save error:", e);
    }
}

loadSettings();

const processedMessages = new Set();
const userState = new Map();

// Pairing Code Request Flag
let isPairingRequested = false;
let pairingTimeout = null;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return undefined;
        }
    });

    if (store) store.bind(sock.ev);

    // Single Pairing Code System
    if (!sock.authState.creds.registered && !isPairingRequested) {
        isPairingRequested = true;
        if (pairingTimeout) clearTimeout(pairingTimeout);

        pairingTimeout = setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n=================================\n🔑 YOUR NEW PAIRING CODE: ${code}\n=================================\n`);
            } catch (error) {
                console.log("Pairing code error:", error?.message || error);
                isPairingRequested = false;
            }
        }, 10000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            
            if (statusCode === DisconnectReason.loggedOut) {
                console.log("Session Logged Out. Clearing auth folder...");
                isPairingRequested = false;
                if (fs.existsSync(AUTH_DIR)) {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                }
                setTimeout(() => connectToWhatsApp(), 5000);
            } else if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                setTimeout(() => connectToWhatsApp(), 5000);
            } else {
                setTimeout(() => {
                    isPairingRequested = false;
                    connectToWhatsApp();
                }, 5000);
            }
        } else if (connection === 'open') {
            console.log(`✅ ${config.botName} - සාර්ථකව සම්බන්ධ විය!`);
            isPairingRequested = false;

            await sock.sendPresenceUpdate(config.botPresence);

            try {
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const tokenStatus = config.githubToken !== "NOT SET" ? "SET 🟢" : "NOT SET 🔴";
                
                const connectedMessage = `✅ *BOT CONNECTING SUCCESSFUL*\n\n` +
                                         `🤖 *Bot Name:* ${config.botName}\n` +
                                         `⚙️ *Work Mode:* ${config.workMode.toUpperCase()}\n` +
                                         `• *Status:* Active 🟢\n` +
                                         `• *Prefix:* [ ${config.currentPrefix} ]\n` +
                                         `• *Auto React:* ${config.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.ownerReactEmoji})\n` +
                                         `• *View Once Download:* ${config.viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                         `• *GitHub Token:* ${tokenStatus}\n` +
                                         `• *GitHub Repo:* ${config.githubRepo}\n\n` +
                                         `_${config.botName} is now ready to use!_`;

                await sock.sendMessage(botJid, { text: connectedMessage });
            } catch (err) {
                console.error("Connected message error:", err);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg || !msg.message) return;

            const msgTime = msg.messageTimestamp ? (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : msg.messageTimestamp.low) : 0;
            if (msgTime < startTime) return; 

            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);
            setTimeout(() => processedMessages.delete(msgId), 60000);

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];
            const isOwner = senderNumber === PHONE_NUMBER || msg.key.fromMe;

            await sock.sendPresenceUpdate(config.botPresence);

            // Auto React (Owner ට පමණි)
            if (isOwner && config.autoReactEnabled && config.ownerReactEmoji) {
                try {
                    await sock.sendMessage(from, { react: { text: config.ownerReactEmoji, key: msg.key } });
                } catch (e) {}
            }

            const textMessage = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                ''
            ).trim();

            if (!textMessage) return;

            // Mode Settings පාලනය
            if (!isOwner) {
                if (config.workMode === 'private') return; 
                if (config.workMode === 'inbox' && isGroup) return; 
                if (config.workMode === 'group' && !isGroup) return; 
            }

            const currentState = userState.get(from);

            // Interactive Confirmations (Owner ට පමණි)
            if (isOwner && currentState && currentState.type === 'CONFIRM_TOKEN') {
                if (textMessage === '1') {
                    config.githubToken = currentState.data;
                    saveSettings();
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *GitHub Token successfully updated & saved!* 🟢` }, { quoted: msg });
                } else if (textMessage === '2') {
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `❌ *GitHub Token update cancelled!*` }, { quoted: msg });
                }
            }

            if (isOwner && currentState && currentState.type === 'CONFIRM_REPO') {
                if (textMessage === '1') {
                    config.githubRepo = currentState.data;
                    saveSettings();
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *GitHub Repo Name updated to:* [ *${config.githubRepo}* ] 🟢` }, { quoted: msg });
                } else if (textMessage === '2') {
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `❌ *GitHub Repo update cancelled!*` }, { quoted: msg });
                }
            }

            // Interactive Settings Logic (Owner ට පමණි)
            if (isOwner && currentState === 'AWAITING_SETTING_CHOICE') {
                if (textMessage === '1') {
                    userState.set(from, 'AWAITING_ONLINE_CHOICE');
                    return await sock.sendMessage(from, { 
                        text: `⚙️ *ONLINE STATUS SETTINGS*\n\nReply with option:\n*1.1* - Turn ON Online Status 🟢\n*1.2* - Turn OFF Online Status 🔴` 
                    }, { quoted: msg });
                } 
                else if (textMessage === '2') {
                    userState.set(from, 'AWAITING_PREFIX_CHOICE');
                    return await sock.sendMessage(from, { 
                        text: `⚙️ *CHANGE PREFIX*\n\nCurrent: [ *${config.currentPrefix}* ]\nSend desired prefix symbol (e.g., # , . , !)` 
                    }, { quoted: msg });
                }
                else if (textMessage === '3') {
                    userState.set(from, 'AWAITING_MODE_CHOICE');
                    return await sock.sendMessage(from, { 
                        text: `⚙️ *WORK MODE SETTINGS*\n\nReply with option:\n*3.1* - Private Mode 🔒\n*3.2* - Group Mode 👥\n*3.3* - Inbox Mode 📥\n*3.4* - Public Mode 🌐` 
                    }, { quoted: msg });
                }
                else if (textMessage === '4') {
                    userState.set(from, 'AWAITING_REACT_CHOICE');
                    return await sock.sendMessage(from, { 
                        text: `⚙️ *AUTO REACT SETTINGS*\n\nReply with option:\n*4.1* - Turn ON Auto React 🟢\n*4.2* - Turn OFF Auto React 🔴\n*4.3* - Change Emoji 👑` 
                    }, { quoted: msg });
                }
                else if (textMessage === '5') {
                    config.viewOnceDownload = !config.viewOnceDownload;
                    saveSettings();
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `👁️ *View Once Downloader is now:* ${config.viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}` }, { quoted: msg });
                }
            }

            if (isOwner && currentState === 'AWAITING_ONLINE_CHOICE') {
                if (textMessage === '1.1') config.botPresence = 'available';
                if (textMessage === '1.2') config.botPresence = 'unavailable';
                saveSettings();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Online Status Updated!*` }, { quoted: msg });
            }

            if (isOwner && currentState === 'AWAITING_PREFIX_CHOICE') {
                config.currentPrefix = textMessage.trim()[0] || config.currentPrefix;
                saveSettings();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Prefix set to:* [ *${config.currentPrefix}* ]` }, { quoted: msg });
            }

            if (isOwner && currentState === 'AWAITING_MODE_CHOICE') {
                if (textMessage === '3.1') config.workMode = 'private';
                if (textMessage === '3.2') config.workMode = 'group';
                if (textMessage === '3.3') config.workMode = 'inbox';
                if (textMessage === '3.4') config.workMode = 'public';
                saveSettings();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Work Mode set to:* ${config.workMode.toUpperCase()}` }, { quoted: msg });
            }

            if (isOwner && currentState === 'AWAITING_REACT_CHOICE') {
                if (textMessage === '4.1') config.autoReactEnabled = true;
                if (textMessage === '4.2') config.autoReactEnabled = false;
                if (textMessage === '4.3') {
                    userState.set(from, 'AWAITING_EMOJI');
                    return await sock.sendMessage(from, { text: `Send the new Emoji:` }, { quoted: msg });
                }
                saveSettings();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Auto React Updated!*` }, { quoted: msg });
            }

            if (isOwner && currentState === 'AWAITING_EMOJI') {
                config.ownerReactEmoji = textMessage.trim();
                saveSettings();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Emoji updated to:* ${config.ownerReactEmoji}` }, { quoted: msg });
            }

            // Commands List
            if (!textMessage.startsWith(config.currentPrefix)) return;

            const args = textMessage.slice(config.currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // .bot Command (Owner Only) - New Command Added
            if (command === 'bot') {
                if (!isOwner) return await sock.sendMessage(from, { text: `⚠️ මෙම කමාන්ඩ් එක භාවිතා කිරීමට හිමිකම් ඇත්තේ Bot Owner ට පමණි!` }, { quoted: msg });

                const subCommand = args.shift()?.toLowerCase();
                if (subCommand === 'name') {
                    const newName = args.join(' ').trim();
                    if (!newName) {
                        return await sock.sendMessage(from, { text: `⚠️ කරුණාකර නව බොට්ගේ නම ඇතුළත් කරන්න!\nඋදාහරණ: *${config.currentPrefix}bot name MyBot-MD*` }, { quoted: msg });
                    }
                    config.botName = newName;
                    saveSettings();
                    return await sock.sendMessage(from, { text: `✅ *Bot Name successfully updated to:* [ *${config.botName}* ] 🟢` }, { quoted: msg });
                } else {
                    return await sock.sendMessage(from, { text: `⚠️ කරුණාකර නිවැරදි කමාන්ඩ් එක යවන්න: *${config.currentPrefix}bot name <New Name>*` }, { quoted: msg });
                }
            }

            // .apply Command (Owner Only)
            if (command === 'apply') {
                if (!isOwner) return await sock.sendMessage(from, { text: `⚠️ මෙම කමාන්ඩ් එක භාවිතා කිරීමට හිමිකම් ඇත්තේ Bot Owner ට පමණි!` }, { quoted: msg });

                const inputData = args.join(' ').trim();
                if (!inputData) {
                    const helpText = `⚠️ කරුණාකර ${config.currentPrefix}apply <GitHub Token / Link / Repo Name> ලෙස යවන්න!`;
                    return await sock.sendMessage(from, { text: helpText }, { quoted: msg });
                }

                if (inputData.startsWith('ghp_') || inputData.includes('github.com')) {
                    const tokenValue = inputData;
                    userState.set(from, { type: 'CONFIRM_TOKEN', data: tokenValue });

                    const menuMsg = `⚙️ *GITHUB TOKEN SETTINGS*\n\n` +
                                    `Do you want to save this Token?\n` +
                                    `🔑 *Token/Link:* ${tokenValue.substring(0, 12)}...\n\n` +
                                    `Reply with option:\n` +
                                    `*1* - Save GitHub Token 🟢\n` +
                                    `*2* - Cancel 🔴`;
                    return await sock.sendMessage(from, { text: menuMsg }, { quoted: msg });
                } else {
                    userState.set(from, { type: 'CONFIRM_REPO', data: inputData });

                    const menuMsg = `⚙️ *GITHUB REPO SETTINGS*\n\n` +
                                    `Do you want to set Repository Name?\n` +
                                    `📁 *Repo Name:* ${inputData}\n\n` +
                                    `Reply with option:\n` +
                                    `*1* - Save Repo Name 🟢\n` +
                                    `*2* - Cancel 🔴`;
                    return await sock.sendMessage(from, { text: menuMsg }, { quoted: msg });
                }
            }

            // Setting Command (Owner ට පමණි)
            if (command === 'setting' || command === 'settings') {
                if (!isOwner) {
                    return await sock.sendMessage(from, { text: `⚠️ Settings වෙනස් කිරීමට හිමිකම් ඇත්තේ Bot Owner ට පමණි!` }, { quoted: msg });
                }

                userState.set(from, 'AWAITING_SETTING_CHOICE');

                const settingsText = `⚙️ *${config.botName} SETTINGS MENU*\n\n` +
                                     `Reply with option number:\n\n` +
                                     `*1* - Online Status Settings\n` +
                                     `*2* - Change Bot Prefix\n` +
                                     `*3* - Work Mode Settings\n` +
                                     `*4* - Auto React Settings\n` +
                                     `*5* - Toggle View Once Downloader\n\n` +
                                     `📌 *CURRENT CONFIGURATION*\n` +
                                     `• *Bot Name:* ${config.botName}\n` +
                                     `• *Prefix:* [ ${config.currentPrefix} ]\n` +
                                     `• *Work Mode:* ${config.workMode.toUpperCase()}\n` +
                                     `• *Online Status:* ${config.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                     `• *Auto React:* ${config.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.ownerReactEmoji})\n` +
                                     `• *View Once:* ${config.viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                     `• *GitHub Token:* ${config.githubToken !== "NOT SET" ? "SET 🟢" : "NOT SET 🔴"}\n` +
                                     `• *GitHub Repo:* ${config.githubRepo}`;

                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

            // Menu Command
            else if (command === 'menu' || command === 'help') {
                const menuText = `✨ *${config.botName} MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* ${config.botName}\n` +
                                 `⚙️ *Mode:* ${config.workMode.toUpperCase()}\n` +
                                 `📌 *Prefix:* [ ${config.currentPrefix} ]\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${config.currentPrefix}menu* - Display Menu\n` +
                                 `│ 🏓 *${config.currentPrefix}ping* - Speed Test\n` +
                                 `│ ⚙️ *${config.currentPrefix}setting* - Bot Settings (Owner Only)\n` +
                                 `│ 🤖 *${config.currentPrefix}bot name <name>* - Change Bot Name\n` +
                                 `│ 🔑 *${config.currentPrefix}apply <token/repo>* - Set GitHub Config\n` +
                                 `│ 🔄 *${config.currentPrefix}update* - Git Update\n` +
                                 `│ 👁️ *${config.currentPrefix}vv2* - View Once Downloader\n` +
                                 `└──────────────`;

                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }

            // Ping Command
            else if (command === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
                const end = Date.now();
                await sock.sendMessage(from, { text: `🏓 *Pong!* Speed: *${end - start}ms*` }, { quoted: msg });
            }

            // Update Command
            else if (command === 'update') {
                if (!isOwner) return;
                await sock.sendMessage(from, { text: `🔄 Updating from GitHub...` }, { quoted: msg });
                exec('git pull', async (error, stdout) => {
                    if (error) return await sock.sendMessage(from, { text: `❌ Update Failed: ${error.message}` }, { quoted: msg });
                    await sock.sendMessage(from, { text: `✅ Updated:\n\`\`\`${stdout}\`\`\`\nRestarting...` }, { quoted: msg });
                    setTimeout(() => process.exit(0), 2000);
                });
            }

            // View Once Command
            else if (command === 'vv2' || command === 'vv') {
                if (!config.viewOnceDownload) return await sock.sendMessage(from, { text: `⚠️ View Once Downloader is disabled in Settings!` }, { quoted: msg });

                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) return await sock.sendMessage(from, { text: `⚠️ View Once Message එකකට Reply කරන්න!` }, { quoted: msg });

                const viewOnceMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg;
                const imageMsg = viewOnceMsg.imageMessage;
                const videoMsg = viewOnceMsg.videoMessage;

                const botOwnerJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                if (imageMsg) {
                    const stream = await downloadContentFromMessage(imageMsg, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    await sock.sendMessage(botOwnerJid, { image: buffer, caption: `👁️ *VIEW ONCE PHOTO DOWNLOADED*` });
                    await sock.sendMessage(from, { text: `✅ Inbox එකට යවන ලදී!` }, { quoted: msg });
                } else if (videoMsg) {
                    const stream = await downloadContentFromMessage(videoMsg, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    await sock.sendMessage(botOwnerJid, { video: buffer, caption: `👁️ *VIEW ONCE VIDEO DOWNLOADED*` });
                    await sock.sendMessage(from, { text: `✅ Inbox එකට යවන ලදී!` }, { quoted: msg });
                }
            }

        } catch (error) {
            console.error("Error:", error);
        }
    });
}

connectToWhatsApp();
