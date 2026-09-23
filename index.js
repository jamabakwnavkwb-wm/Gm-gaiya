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
    
    // Owner Auto React Settings
    ownerAutoReactEnabled: true,
    ownerReactEmoji: '👑',

    // Others Auto React Configurations
    autoReactEnabled: true,
    autoReactTarget: 'public', // 'group', 'inbox', 'public'
    
    // Custom React Configurations
    customReactEnabled: false,
    customReactTarget: 'public', // 'group', 'inbox', 'public'
    customEmojis: ['❤️', '👑', '♥️', '😑', '🤔'],
    
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

// Pairing Code Double-Printing Fix
let isPairingRequested = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    let version;
    try {
        const fetched = await fetchLatestBaileysVersion();
        version = fetched.version;
    } catch (e) {
        version = [2, 3000, 1015901307];
    }

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        generateHighQualityLinkPreview: true,
        
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: true,
        
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        getMessage: async (key) => {
            if (store) {
                try {
                    const msg = await store.loadMessage(key.remoteJid, key.id);
                    return msg?.message || undefined;
                } catch (e) {
                    return { conversation: '' };
                }
            }
            return { conversation: '' };
        }
    });

    if (store) store.bind(sock.ev);

    if (!sock.authState.creds.registered && !isPairingRequested) {
        isPairingRequested = true;
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n=================================\n🔑 YOUR PAIRING CODE: ${code}\n=================================\n`);
            } catch (error) {
                console.log("Pairing code error:", error?.message || error);
                isPairingRequested = false;
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    // Continuous Connection Handler (බොට් Off නොවී සදාකාලිකව Reconnect වීම)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            isPairingRequested = false;
            
            console.log(`⚠️ Connection closed with status code: ${statusCode}. Reconnecting...`);

            if (statusCode === DisconnectReason.loggedOut) {
                console.log("Session Logged Out. Clearing auth folder...");
                if (fs.existsSync(AUTH_DIR)) {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                }
                setTimeout(() => connectToWhatsApp(), 5000);
            } else {
                // වෙනත් ඕනෑම Disconnect පැමිණි විට Auto Reconnect වෙයි
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            console.log(`✅ ${config.botName} - සාර්ථකව සම්බන්ධ විය! (Auto Reconnect & Waiting Message Fix Active)`);
            isPairingRequested = false;

            try {
                await sock.sendPresenceUpdate(config.botPresence);
            } catch (e) {}
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg) return;

            // Stub Message හෝ Stub Type ඇති විට (System Messages) Skip කිරීම
            if (msg.messageStubType) return;

            // Waiting Message / Decrypt නොවූ මැසේජ් Filter කර Skip කිරීම (Arrow Error/Crash Fix)
            if (!msg.message || Object.keys(msg.message).length === 0) {
                return; 
            }

            // Reaction messages ignore කිරීම
            if (msg.message.reactionMessage) return;

            // Offline තිඛෙන විට ලැබුණු පැරණි මැසේජ් Skip කිරීම
            const currentTimestamp = Math.floor(Date.now() / 1000);
            const msgTime = msg.messageTimestamp ? (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : msg.messageTimestamp.low) : 0;
            
            if (msgTime && (currentTimestamp - msgTime > 60)) {
                return; 
            }

            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);
            setTimeout(() => processedMessages.delete(msgId), 60000);

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];
            const isOwner = senderNumber === PHONE_NUMBER || msg.key.fromMe;

            try {
                await sock.sendPresenceUpdate(config.botPresence);
            } catch (e) {}

            // ==================== OWNER AUTO REACT (SAFE HANDLING) ====================
            if (isOwner && config.ownerAutoReactEnabled && config.ownerReactEmoji) {
                try {
                    await sock.sendMessage(from, { 
                        react: { 
                            text: config.ownerReactEmoji, 
                            key: msg.key
                        } 
                    });
                } catch (e) {
                    // Waiting message / Permission error ආවොත් Crash නොවී Skip කරයි
                }
            }

            // ==================== OTHERS AUTO REACT & CUSTOM REACT LOGIC (SAFE HANDLING) ====================
            if (!isOwner) {
                // 1. Auto React Handling for Others
                if (config.autoReactEnabled) {
                    const isTargetMatched = 
                        (config.autoReactTarget === 'public') ||
                        (config.autoReactTarget === 'group' && isGroup) ||
                        (config.autoReactTarget === 'inbox' && !isGroup);

                    if (isTargetMatched) {
                        try {
                            await sock.sendMessage(from, { 
                                react: { 
                                    text: config.ownerReactEmoji, 
                                    key: msg.key
                                } 
                            });
                        } catch (e) {}
                    }
                }

                // 2. Custom React Handling for Others
                if (config.customReactEnabled && config.customEmojis && config.customEmojis.length > 0) {
                    const isCustomTargetMatched = 
                        (config.customReactTarget === 'public') ||
                        (config.customReactTarget === 'group' && isGroup) ||
                        (config.customReactTarget === 'inbox' && !isGroup);

                    if (isCustomTargetMatched) {
                        try {
                            const randomEmoji = config.customEmojis[Math.floor(Math.random() * config.customEmojis.length)];
                            await sock.sendMessage(from, { 
                                react: { 
                                    text: randomEmoji, 
                                    key: msg.key
                                } 
                            });
                        } catch (e) {}
                    }
                }
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
                    userState.set(from, 'AWAITING_OWNER_REACT_CHOICE');
                    return await sock.sendMessage(from, { 
                        text: `⚙️ *OWNER AUTO REACT SETTINGS*\n\nReply with option:\n*4.1* - Turn ON Owner Auto React 🟢\n*4.2* - Turn OFF Owner Auto React 🔴\n*4.3* - Change Emoji 👑` 
                    }, { quoted: msg });
                }
                else if (textMessage === '5') {
                    userState.set(from, 'AWAITING_REACT_CHOICE');
                    return await sock.sendMessage(from, { 
                        text: `⚙️ *AUTO REACT SETTINGS*\n\nReply with option:\n*5.1* - Turn ON Auto React 🟢\n*5.2* - Turn OFF Auto React 🔴\n*5.3* - Target: Group Only 👥\n*5.4* - Target: Inbox Only 📥\n*5.5* - Target: Public (All) 🌐\n*5.6* - Change Single Emoji 👑` 
                    }, { quoted: msg });
                }
                else if (textMessage === '6') {
                    userState.set(from, 'AWAITING_CUSTOM_REACT_CHOICE');
                    return await sock.sendMessage(from, { 
                        text: `⚙️ *CUSTOM REACT SETTINGS*\n\nReply with option:\n*6.1* - Turn ON Custom React 🟢\n*6.2* - Turn OFF Custom React 🔴\n*6.3* - Target: Group Only 👥\n*6.4* - Target: Inbox Only 📥\n*6.5* - Target: Public (All) 🌐\n*6.6* - Set Emojis (e.g. ❤️,👑,♥️,😑,🤔)` 
                    }, { quoted: msg });
                }
                else if (textMessage === '7') {
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

            if (isOwner && currentState === 'AWAITING_OWNER_REACT_CHOICE') {
                if (textMessage === '4.1') config.ownerAutoReactEnabled = true;
                else if (textMessage === '4.2') config.ownerAutoReactEnabled = false;
                else if (textMessage === '4.3') {
                    userState.set(from, 'AWAITING_EMOJI');
                    return await sock.sendMessage(from, { text: `Send the new Emoji:` }, { quoted: msg });
                }
                saveSettings();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Owner Auto React Updated!*` }, { quoted: msg });
            }

            if (isOwner && currentState === 'AWAITING_REACT_CHOICE') {
                if (textMessage === '5.1') config.autoReactEnabled = true;
                else if (textMessage === '5.2') config.autoReactEnabled = false;
                else if (textMessage === '5.3') config.autoReactTarget = 'group';
                else if (textMessage === '5.4') config.autoReactTarget = 'inbox';
                else if (textMessage === '5.5') config.autoReactTarget = 'public';
                else if (textMessage === '5.6') {
                    userState.set(from, 'AWAITING_EMOJI');
                    return await sock.sendMessage(from, { text: `Send the new single Emoji:` }, { quoted: msg });
                }
                saveSettings();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Auto React Settings Updated!*` }, { quoted: msg });
            }

            if (isOwner && currentState === 'AWAITING_CUSTOM_REACT_CHOICE') {
                if (textMessage === '6.1') config.customReactEnabled = true;
                else if (textMessage === '6.2') config.customReactEnabled = false;
                else if (textMessage === '6.3') config.customReactTarget = 'group';
                else if (textMessage === '6.4') config.customReactTarget = 'inbox';
                else if (textMessage === '6.5') config.customReactTarget = 'public';
                else if (textMessage === '6.6') {
                    userState.set(from, 'AWAITING_CUSTOM_EMOJIS');
                    return await sock.sendMessage(from, { text: `Send emojis separated by commas (e.g. ❤️,👑,♥️,😑,🤔):` }, { quoted: msg });
                }
                saveSettings();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Custom React Settings Updated!*` }, { quoted: msg });
            }

            if (isOwner && currentState === 'AWAITING_EMOJI') {
                config.ownerReactEmoji = textMessage.trim();
                saveSettings();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Emoji updated to:* ${config.ownerReactEmoji}` }, { quoted: msg });
            }

            if (isOwner && currentState === 'AWAITING_CUSTOM_EMOJIS') {
                const emojiList = textMessage.split(',').map(e => e.trim()).filter(e => e.length > 0);
                if (emojiList.length > 0) {
                    config.customEmojis = emojiList;
                    saveSettings();
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *Custom Emojis updated to:* ${config.customEmojis.join(' ')}` }, { quoted: msg });
                } else {
                    return await sock.sendMessage(from, { text: `⚠️ Invalid input! Please try again with valid emojis separated by commas.` }, { quoted: msg });
                }
            }

            // Commands List
            if (!textMessage.startsWith(config.currentPrefix)) return;

            const args = textMessage.slice(config.currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // .info Command (Group Description)
            if (command === 'info') {
                if (!isGroup) {
                    return await sock.sendMessage(from, { text: `⚠️ මෙම කමාන්ඩ් එක භාවිතා කළ හැක්කේ WhatsApp ගෲප් තුළ පමණි!` }, { quoted: msg });
                }
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const groupDesc = groupMetadata.desc ? groupMetadata.desc.toString() : 'මෙම ගෲප් එක සඳහා Description එකක් සකසා නැත.';
                    const infoText = `📋 *GROUP DESCRIPTION*\n\n👥 *Group Name:* ${groupMetadata.subject}\n\n📝 *Description:*\n${groupDesc}`;
                    return await sock.sendMessage(from, { text: infoText }, { quoted: msg });
                } catch (e) {
                    return await sock.sendMessage(from, { text: `❌ Group Description එක ලබා ගැනීමට නොහැකි විය.` }, { quoted: msg });
                }
            }

            // .bot Command (Owner Only)
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
                                     `*4* - Owner Auto React Settings\n` +
                                     `*5* - Auto React Settings\n` +
                                     `*6* - Custom React Settings\n` +
                                     `*7* - Toggle View Once Downloader\n\n` +
                                     `📌 *CURRENT CONFIGURATION*\n` +
                                     `• *Bot Name:* ${config.botName}\n` +
                                     `• *Prefix:* [ ${config.currentPrefix} ]\n` +
                                     `• *Work Mode:* ${config.workMode.toUpperCase()}\n` +
                                     `• *Online Status:* ${config.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                     `• *Owner Auto React:* ${config.ownerAutoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.ownerReactEmoji})\n` +
                                     `• *Auto React:* ${config.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.autoReactTarget.toUpperCase()})\n` +
                                     `• *Custom React:* ${config.customReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.customReactTarget.toUpperCase()}) -> ${config.customEmojis.join(' ')}\n` +
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
                                 `│ 📋 *${config.currentPrefix}info* - Get Group Description\n` +
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

                const botOwnerJid = PHONE_NUMBER.includes('@s.whatsapp.net') ? PHONE_NUMBER : `${PHONE_NUMBER}@s.whatsapp.net`;

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
            console.error("Non-fatal Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
