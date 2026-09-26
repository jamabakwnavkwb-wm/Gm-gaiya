const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage,
    makeInMemoryStore,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec, spawn } = require('child_process');

// 🌐 KataBump & Cloud Server Keep-Alive HTTP Server
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('GM GAIYA - MD Bot is Running Successfully on KataBump Server!\n');
}).listen(PORT, () => {
    console.log(`🌐 Keep-Alive Server running on port ${PORT}`);
});

// Safe NodeCache Module Requirement & Retry Counter
let NodeCache;
let msgRetryCounterCache;
try {
    NodeCache = require('node-cache');
    msgRetryCounterCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });
} catch (e) {
    msgRetryCounterCache = new Map();
}

// Global Error Handlers (Prevents Bot Crashes/Bugs)
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception Safe-Handled:', err?.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection Safe-Handled:', reason?.message || reason);
});

// Dynamic Phone Number Capture Fix
const rawPhoneNumber = process.env.PHONE_NUMBER || "94764802314";
const PHONE_NUMBER = rawPhoneNumber.replace(/[^0-9]/g, '');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// InMemoryStore setup
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
    console.log("Store initialization skipped.");
}

// Bot Configuration State
let config = {
    botName: 'GM GAIYA - MD',
    botPresence: 'available', 
    currentPrefix: ':',
    workMode: 'private', 
    
    // Owner Auto React Settings
    ownerAutoReactEnabled: true,
    ownerReactEmojis: ['👑', '❤️'],

    // Auto React Configurations for Others
    autoReactEnabled: true,
    autoReactTarget: 'public', 
    
    // Custom React Configurations
    customReactEnabled: false,
    customReactTarget: 'public', 
    customEmojis: ['❤️', '👑', '♥️', '😑', '🤔'],
    
    viewOnceDownload: true,
    githubToken: process.env.GITHUB_TOKEN || "NOT SET",
    githubRepo: process.env.GITHUB_REPO || "Gm-gaiya"
};

function loadSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const loadedData = JSON.parse(data);
            
            if (loadedData.ownerReactEmoji && !loadedData.ownerReactEmojis) {
                loadedData.ownerReactEmojis = loadedData.ownerReactEmoji.split(',').map(e => e.trim());
            }
            
            config = { ...config, ...loadedData };
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
let isPairingRequested = false;
let sock = null;
let ownerEmojiIndex = 0;

// Optimized Direct Fast Processing Queue
const messageQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;
    
    while (messageQueue.length > 0) {
        const task = messageQueue.shift();
        try {
            await task();
        } catch (e) {
            console.error("Queue Task Error:", e?.message || e);
        }
    }
    
    isProcessingQueue = false;
}

function enqueueTask(task) {
    messageQueue.push(task);
    processQueue();
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    let version;
    try {
        const fetched = await fetchLatestBaileysVersion();
        version = fetched.version;
    } catch (e) {
        version = [2, 3000, 1015901307];
    }

    const logger = pino({ level: 'silent' });

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        browser: Browsers.ubuntu("Chrome"),
        generateHighQualityLinkPreview: true,
        
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        emitOwnEvents: false, // Prevents own message duplication/bugs
        markOnlineOnConnect: config.botPresence === 'available',
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 1000,
        msgRetryCounterCache,

        getMessage: async (key) => {
            if (store) {
                try {
                    const msg = await store.loadMessage(key.remoteJid, key.id);
                    return msg?.message || undefined;
                } catch (e) {
                    return undefined;
                }
            }
            return { conversation: "Hello" };
        }
    });

    if (store) store.bind(sock.ev);

    // Auto Restart Mechanism every 6 hours
    setTimeout(() => {
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        setInterval(async () => {
            try {
                const ownerJid = `${PHONE_NUMBER}@s.whatsapp.net`;
                if (sock) {
                    await sock.sendMessage(ownerJid, { 
                        text: `♻️ *${config.botName} Auto-Restarting...*\n\n` +
                              `⏰ පැය 6 කාල රාමුව අනුව බොට් සේවා පවත්වා ගැනීමට Restart වෙමින් පවතී.` 
                    }).catch(() => {});
                }
            } catch (err) {}

            setTimeout(() => {
                const child = spawn(process.argv[0], process.argv.slice(1), {
                    detached: true,
                    stdio: 'inherit'
                });
                child.unref();
                process.exit(0);
            }, 3000);
        }, SIX_HOURS);
    }, 10000);

    // Connection Handler
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (!sock.authState.creds.registered && !isPairingRequested) {
            isPairingRequested = true;
            setTimeout(async () => {
                try {
                    console.log(`\n⏳ Requesting Pairing Code for phone number: +${PHONE_NUMBER}...`);
                    let code = await sock.requestPairingCode(PHONE_NUMBER);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(`\n=================================\n🔑 YOUR PAIRING CODE: ${code}\n=================================\n`);
                } catch (error) {
                    console.log("⚠️ Pairing Code Generation Error. Retrying in 5 seconds...", error?.message || error);
                    isPairingRequested = false;
                }
            }, 5000);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            isPairingRequested = false;
            
            console.log(`⚠️ Connection closed (Status: ${statusCode}). Reconnecting...`);
            
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                console.log("Session Logged Out. Please clear auth folder and pair again.");
            }
        } else if (connection === 'open') {
            console.log(`✅ ${config.botName} - KataBump Server එකේ සාර්ථකව සම්බන්ධ විය!`);
            isPairingRequested = false;

            try {
                await sock.sendPresenceUpdate(config.botPresence);
                const ownerJid = `${PHONE_NUMBER}@s.whatsapp.net`;
                await sock.sendMessage(ownerJid, {
                    text: `🟢 *${config.botName} Connected Successfully!*\n\n` +
                          `🤖 Bot is now Online and active on Server.`
                }).catch(() => {});
            } catch (e) {}
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Safe Reaction Function using Message Queue
    function safeReact(from, emoji, key) {
        if (!emoji || !key || !sock) return;
        enqueueTask(async () => {
            await sock.sendMessage(from, { 
                react: { text: emoji, key: key } 
            }).catch(() => {});
        });
    }

    // Messages Logic
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return; 

            const msg = messages[0];
            if (!msg || !msg.key) return;

            if (!msg.message || Object.keys(msg.message).length === 0 || msg.message.reactionMessage || msg.message.protocolMessage) return;

            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);
            
            if (processedMessages.size > 2000) {
                processedMessages.clear();
            } else {
                setTimeout(() => processedMessages.delete(msgId), 30000);
            }

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;

            const isGroup = from.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];
            const isOwner = senderNumber === PHONE_NUMBER || msg.key.fromMe;

            const textMessage = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                ''
            ).trim();

            const isSelfChat = (from === `${PHONE_NUMBER}@s.whatsapp.net`) || msg.key.fromMe;
            // Safe option for sending reply without triggering encryption bug in Self-Chat
            const sendOptions = isSelfChat ? {} : { quoted: msg };

            // Fixed Owner Auto React Logic
            if (isOwner && config.ownerAutoReactEnabled && config.ownerReactEmojis && config.ownerReactEmojis.length > 0) {
                const isBotGeneratedText = textMessage.includes('MAIN MENU') || 
                                           textMessage.includes('SETTINGS MENU') || 
                                           textMessage.includes('OWNER AUTO REACT SETTINGS') ||
                                           textMessage.includes('Pong!') || 
                                           textMessage.includes('Testing speed') ||
                                           textMessage.includes('Connected Successfully');

                if (!isBotGeneratedText) {
                    const currentOwnerEmoji = config.ownerReactEmojis[ownerEmojiIndex % config.ownerReactEmojis.length];
                    ownerEmojiIndex++;
                    safeReact(from, currentOwnerEmoji, msg.key);
                }
            }

            // Others Auto React Logic
            if (!isOwner) {
                if (config.autoReactEnabled) {
                    const isTargetMatched = 
                        (config.autoReactTarget === 'public') ||
                        (config.autoReactTarget === 'group' && isGroup) ||
                        (config.autoReactTarget === 'inbox' && !isGroup);

                    if (isTargetMatched) {
                        const fallbackEmoji = config.ownerReactEmojis[0] || '👑';
                        safeReact(from, fallbackEmoji, msg.key);
                    }
                }

                if (config.customReactEnabled && config.customEmojis && config.customEmojis.length > 0) {
                    const isCustomTargetMatched = 
                        (config.customReactTarget === 'public') ||
                        (config.customReactTarget === 'group' && isGroup) ||
                        (config.customReactTarget === 'inbox' && !isGroup);

                    if (isCustomTargetMatched) {
                        const randomEmoji = config.customEmojis[Math.floor(Math.random() * config.customEmojis.length)];
                        safeReact(from, randomEmoji, msg.key);
                    }
                }
            }

            if (!textMessage) return;

            if (!isOwner) {
                if (config.workMode === 'private') return; 
                if (config.workMode === 'inbox' && isGroup) return; 
                if (config.workMode === 'group' && !isGroup) return; 
            }

            const currentState = userState.get(from);

            if (isOwner && currentState && typeof currentState === 'object' && currentState.type === 'CONFIRM_TOKEN') {
                if (textMessage === '1') {
                    config.githubToken = currentState.data;
                    saveSettings();
                    userState.delete(from);
                    return enqueueTask(() => sock.sendMessage(from, { text: `✅ *GitHub Token successfully updated & saved!* 🟢` }, sendOptions));
                } else if (textMessage === '2') {
                    userState.delete(from);
                    return enqueueTask(() => sock.sendMessage(from, { text: `❌ *GitHub Token update cancelled!*` }, sendOptions));
                }
            }

            if (isOwner && currentState && typeof currentState === 'object' && currentState.type === 'CONFIRM_REPO') {
                if (textMessage === '1') {
                    config.githubRepo = currentState.data;
                    saveSettings();
                    userState.delete(from);
                    return enqueueTask(() => sock.sendMessage(from, { text: `✅ *GitHub Repo Name updated to:* [ *${config.githubRepo}* ] 🟢` }, sendOptions));
                } else if (textMessage === '2') {
                    userState.delete(from);
                    return enqueueTask(() => sock.sendMessage(from, { text: `❌ *GitHub Repo update cancelled!*` }, sendOptions));
                }
            }

            if (isOwner && currentState === 'AWAITING_SETTING_CHOICE') {
                if (textMessage === '2') {
                    userState.set(from, 'AWAITING_PREFIX_CHOICE');
                    return enqueueTask(() => sock.sendMessage(from, { 
                        text: `⚙️ *CHANGE PREFIX*\n\nCurrent: [ *${config.currentPrefix}* ]\nSend desired prefix symbol (e.g., # , . , !)` 
                    }, sendOptions));
                }
                else if (textMessage === '3') {
                    userState.set(from, 'AWAITING_MODE_CHOICE');
                    return enqueueTask(() => sock.sendMessage(from, { 
                        text: `⚙️ *WORK MODE SETTINGS*\n\nReply with option:\n*3.1* - Private Mode 🔒\n*3.2* - Group Mode 👥\n*3.3* - Inbox Mode 📥\n*3.4* - Public Mode 🌐` 
                    }, sendOptions));
                }
                else if (textMessage === '4') {
                    userState.set(from, 'AWAITING_OWNER_REACT_CHOICE');
                    return enqueueTask(() => sock.sendMessage(from, { 
                        text: `⚙️ *OWNER AUTO REACT SETTINGS*\n\nReply with option:\n*4.1* - Turn ON Owner Auto React 🟢\n*4.2* - Turn OFF Owner Auto React 🔴\n*4.3* - Change Emojis (e.g. 👑,❤️)` 
                    }, sendOptions));
                }
                else if (textMessage === '5') {
                    userState.set(from, 'AWAITING_REACT_CHOICE');
                    return enqueueTask(() => sock.sendMessage(from, { 
                        text: `⚙️ *AUTO REACT SETTINGS*\n\nReply with option:\n*5.1* - Turn ON Auto React 🟢\n*5.2* - Turn OFF Auto React 🔴\n*5.3* - Target: Group Only 👥\n*5.4* - Target: Inbox Only 📥\n*5.5* - Target: Public (All) 🌐\n*5.6* - Change Single Emoji 👑` 
                    }, sendOptions));
                }
                else if (textMessage === '6') {
                    userState.set(from, 'AWAITING_CUSTOM_REACT_CHOICE');
                    return enqueueTask(() => sock.sendMessage(from, { 
                        text: `⚙️ *CUSTOM REACT SETTINGS*\n\nReply with option:\n*6.1* - Turn ON Custom React 🟢\n*6.2* - Turn OFF Custom React 🔴\n*6.3* - Target: Group Only 👥\n*6.4* - Target: Inbox Only 📥\n*6.5* - Target: Public (All) 🌐\n*6.6* - Set Emojis (e.g. ❤️,👑,♥️,😑,🤔)` 
                    }, sendOptions));
                }
                else if (textMessage === '7') {
                    config.viewOnceDownload = !config.viewOnceDownload;
                    saveSettings();
                    userState.delete(from);
                    return enqueueTask(() => sock.sendMessage(from, { text: `👁️ *View Once Downloader is now:* ${config.viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}` }, sendOptions));
                }
            }

            if (isOwner && currentState === 'AWAITING_PREFIX_CHOICE') {
                config.currentPrefix = textMessage.trim()[0] || config.currentPrefix;
                saveSettings();
                userState.delete(from);
                return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Prefix set to:* [ *${config.currentPrefix}* ]` }, sendOptions));
            }

            if (isOwner && currentState === 'AWAITING_MODE_CHOICE') {
                if (textMessage === '3.1') config.workMode = 'private';
                if (textMessage === '3.2') config.workMode = 'group';
                if (textMessage === '3.3') config.workMode = 'inbox';
                if (textMessage === '3.4') config.workMode = 'public';
                saveSettings();
                userState.delete(from);
                return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Work Mode set to:* ${config.workMode.toUpperCase()}` }, sendOptions));
            }

            if (isOwner && currentState === 'AWAITING_OWNER_REACT_CHOICE') {
                if (textMessage === '4.1') {
                    config.ownerAutoReactEnabled = true;
                    saveSettings();
                    userState.delete(from);
                    return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Owner Auto React Enabled!* 🟢` }, sendOptions));
                }
                else if (textMessage === '4.2') {
                    config.ownerAutoReactEnabled = false;
                    saveSettings();
                    userState.delete(from);
                    return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Owner Auto React Disabled!* 🔴` }, sendOptions));
                }
                else if (textMessage === '4.3') {
                    userState.set(from, 'AWAITING_OWNER_EMOJIS');
                    return enqueueTask(() => sock.sendMessage(from, { text: `Send the desired Owner Emojis separated by commas (e.g. 👑,❤️):` }, sendOptions));
                }
            }

            if (isOwner && currentState === 'AWAITING_OWNER_EMOJIS') {
                const emojiList = textMessage.split(',').map(e => e.trim()).filter(e => e.length > 0);
                if (emojiList.length > 0) {
                    config.ownerReactEmojis = emojiList;
                    ownerEmojiIndex = 0;
                    saveSettings();
                    userState.delete(from);
                    return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Owner Emojis updated to:* ${config.ownerReactEmojis.join(' ')}` }, sendOptions));
                } else {
                    return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ Invalid input! Please try again (e.g. 👑,❤️).` }, sendOptions));
                }
            }

            if (isOwner && currentState === 'AWAITING_REACT_CHOICE') {
                if (textMessage === '5.1') config.autoReactEnabled = true;
                else if (textMessage === '5.2') config.autoReactEnabled = false;
                else if (textMessage === '5.3') config.autoReactTarget = 'group';
                else if (textMessage === '5.4') config.autoReactTarget = 'inbox';
                else if (textMessage === '5.5') config.autoReactTarget = 'public';
                else if (textMessage === '5.6') {
                    userState.set(from, 'AWAITING_EMOJI');
                    return enqueueTask(() => sock.sendMessage(from, { text: `Send the new single Emoji:` }, sendOptions));
                }
                saveSettings();
                userState.delete(from);
                return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Auto React Settings Updated!*` }, sendOptions));
            }

            if (isOwner && currentState === 'AWAITING_CUSTOM_REACT_CHOICE') {
                if (textMessage === '6.1') config.customReactEnabled = true;
                else if (textMessage === '6.2') config.customReactEnabled = false;
                else if (textMessage === '6.3') config.customReactTarget = 'group';
                else if (textMessage === '6.4') config.customReactTarget = 'inbox';
                else if (textMessage === '6.5') config.customReactTarget = 'public';
                else if (textMessage === '6.6') {
                    userState.set(from, 'AWAITING_CUSTOM_EMOJIS');
                    return enqueueTask(() => sock.sendMessage(from, { text: `Send emojis separated by commas (e.g. ❤️,👑,♥️,😑,🤔):` }, sendOptions));
                }
                saveSettings();
                userState.delete(from);
                return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Custom React Settings Updated!*` }, sendOptions));
            }

            if (isOwner && currentState === 'AWAITING_EMOJI') {
                config.ownerReactEmojis = [textMessage.trim()];
                saveSettings();
                userState.delete(from);
                return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Emoji updated to:* ${config.ownerReactEmojis.join(' ')}` }, sendOptions));
            }

            if (isOwner && currentState === 'AWAITING_CUSTOM_EMOJIS') {
                const emojiList = textMessage.split(',').map(e => e.trim()).filter(e => e.length > 0);
                if (emojiList.length > 0) {
                    config.customEmojis = emojiList;
                    saveSettings();
                    userState.delete(from);
                    return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Custom Emojis updated to:* ${config.customEmojis.join(' ')}` }, sendOptions));
                } else {
                    return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ Invalid input! Please try again with valid emojis separated by commas.` }, sendOptions));
                }
            }

            if (!textMessage.startsWith(config.currentPrefix)) return;

            const args = textMessage.slice(config.currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // .info Command
            if (command === 'info') {
                if (!isGroup) {
                    return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ මෙම කමාන්ඩ් එක භාවිතා කළ හැක්කේ WhatsApp ගෲප් තුළ පමණි!` }, sendOptions));
                }
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const groupDesc = groupMetadata.desc ? groupMetadata.desc.toString() : 'මෙම ගෲප් එක සඳහා Description එකක් සකසා නැත.';
                    const infoText = `📋 *GROUP DESCRIPTION*\n\n👥 *Group Name:* ${groupMetadata.subject}\n\n📝 *Description:*\n${groupDesc}`;
                    return enqueueTask(() => sock.sendMessage(from, { text: infoText }, sendOptions));
                } catch (e) {
                    return enqueueTask(() => sock.sendMessage(from, { text: `❌ Group Description එක ලබා ගැනීමට නොහැකි විය.` }, sendOptions));
                }
            }

            // .bot Command
            if (command === 'bot') {
                if (!isOwner) return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ මෙම කමාන්ඩ් එක භාවිතා කිරීමට හිමිකම් ඇත්තේ Bot Owner ට පමණි!` }, sendOptions));

                const subCommand = args.shift()?.toLowerCase();
                if (subCommand === 'name') {
                    const newName = args.join(' ').trim();
                    if (!newName) {
                        return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ කරුණාකර නව බොට්ගේ නම ඇතුළත් කරන්න!` }, sendOptions));
                    }
                    config.botName = newName;
                    saveSettings();
                    return enqueueTask(() => sock.sendMessage(from, { text: `✅ *Bot Name successfully updated to:* [ *${config.botName}* ] 🟢` }, sendOptions));
                } else {
                    return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ කරුණාකර නිවැරදි කමාන්ඩ් එක යවන්න: *${config.currentPrefix}bot name <New Name>*` }, sendOptions));
                }
            }

            // .apply Command
            if (command === 'apply') {
                if (!isOwner) return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ මෙම කමාන්ඩ් එක භාවිතා කිරීමට හිමිකම් ඇත්තේ Bot Owner ට පමණි!` }, sendOptions));

                const inputData = args.join(' ').trim();
                if (!inputData) {
                    return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ කරුණාකර ${config.currentPrefix}apply <GitHub Token / Link / Repo Name> ලෙස යවන්න!` }, sendOptions));
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
                    return enqueueTask(() => sock.sendMessage(from, { text: menuMsg }, sendOptions));
                } else {
                    userState.set(from, { type: 'CONFIRM_REPO', data: inputData });

                    const menuMsg = `⚙️ *GITHUB REPO SETTINGS*\n\n` +
                                    `Do you want to set Repository Name?\n` +
                                    `📁 *Repo Name:* ${inputData}\n\n` +
                                    `Reply with option:\n` +
                                    `*1* - Save Repo Name 🟢\n` +
                                    `*2* - Cancel 🔴`;
                    return enqueueTask(() => sock.sendMessage(from, { text: menuMsg }, sendOptions));
                }
            }

            // Setting Command
            if (command === 'setting' || command === 'settings') {
                if (!isOwner) {
                    return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ Settings වෙනස් කිරීමට හිමිකම් ඇත්තේ Bot Owner ට පමණි!` }, sendOptions));
                }

                userState.set(from, 'AWAITING_SETTING_CHOICE');

                const settingsText = `⚙️ *${config.botName} SETTINGS MENU*\n\n` +
                                     `Reply with option number:\n\n` +
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
                                     `• *Owner Auto React:* ${config.ownerAutoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.ownerReactEmojis.join(', ')})\n` +
                                     `• *Auto React:* ${config.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.autoReactTarget.toUpperCase()})\n` +
                                     `• *Custom React:* ${config.customReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.customReactTarget.toUpperCase()}) -> ${config.customEmojis.join(' ')}\n` +
                                     `• *View Once:* ${config.viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                     `• *GitHub Token:* ${config.githubToken !== "NOT SET" ? "SET 🟢" : "NOT SET 🔴"}\n` +
                                     `• *GitHub Repo:* ${config.githubRepo}`;

                enqueueTask(() => sock.sendMessage(from, { text: settingsText }, sendOptions));
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

                enqueueTask(() => sock.sendMessage(from, { text: menuText }, sendOptions));
            }

            // Ping Command
            else if (command === 'ping') {
                const start = Date.now();
                enqueueTask(async () => {
                    await sock.sendMessage(from, { text: 'Testing speed...' }, sendOptions);
                    const end = Date.now();
                    await sock.sendMessage(from, { text: `📿 *Pong!* Speed: *${end - start}ms*` }, sendOptions);
                });
            }

            // Update Command
            else if (command === 'update') {
                if (!isOwner) return;
                enqueueTask(async () => {
                    await sock.sendMessage(from, { text: `🔄 Updating from GitHub...` }, sendOptions);
                    exec('git pull', async (error, stdout) => {
                        if (error) return await sock.sendMessage(from, { text: `❌ Update Failed: ${error.message}` }, sendOptions);
                        await sock.sendMessage(from, { text: `✅ Updated:\n\`\`\`${stdout}\`\`\`\nRestarting Bot Process...` }, sendOptions);
                        
                        setTimeout(() => {
                            const child = spawn(process.argv[0], process.argv.slice(1), {
                                detached: true,
                                stdio: 'inherit'
                            });
                            child.unref();
                            process.exit(0);
                        }, 2000);
                    });
                });
            }

            // View Once Command
            else if (command === 'vv2' || command === 'vv') {
                if (!config.viewOnceDownload) return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ View Once Downloader is disabled in Settings!` }, sendOptions));

                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) return enqueueTask(() => sock.sendMessage(from, { text: `⚠️ View Once Message එකකට Reply කරන්න!` }, sendOptions));

                const viewOnceMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg;
                const imageMsg = viewOnceMsg.imageMessage;
                const videoMsg = viewOnceMsg.videoMessage;

                const botOwnerJid = PHONE_NUMBER.includes('@s.whatsapp.net') ? PHONE_NUMBER : `${PHONE_NUMBER}@s.whatsapp.net`;

                enqueueTask(async () => {
                    if (imageMsg) {
                        const stream = await downloadContentFromMessage(imageMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                        await sock.sendMessage(botOwnerJid, { image: buffer, caption: `👁️ *VIEW ONCE PHOTO DOWNLOADED*` });
                        await sock.sendMessage(from, { text: `✅ Inbox එකට යවන ලදී!` }, sendOptions);
                    } else if (videoMsg) {
                        const stream = await downloadContentFromMessage(videoMsg, 'video');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                        await sock.sendMessage(botOwnerJid, { video: buffer, caption: `👁️ *VIEW ONCE VIDEO DOWNLOADED*` });
                        await sock.sendMessage(from, { text: `✅ Inbox එකට යවන ලදී!` }, sendOptions);
                    }
                });
            }

        } catch (error) {
            console.error("Safe Handled Processing Error:", error?.message || error);
        }
    });
}

connectToWhatsApp();
