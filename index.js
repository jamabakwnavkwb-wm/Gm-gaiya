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

// InMemoryStore Safe Handling
let store;
try {
    store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
    if (fs.existsSync('./baileys_store_multi.json')) {
        store.readFromFile('./baileys_store_multi.json');
    }
    setInterval(() => {
        try {
            store.writeToFile('./baileys_store_multi.json');
        } catch (e) {}
    }, 10000);
} catch (e) {
    console.log("Store Init Warning:", e.message);
}

// Default Settings
const defaultSettings = {
    botName: 'GM GAIYA - MD',
    botPresence: 'available',
    currentPrefix: '.',
    autoReactEnabled: true,
    ownerReactEmoji: '👑',
    autoViewOnce: true,
    workMode: 'public', // Modes: 'public', 'private', 'group'
    githubToken: '',
    githubRepo: ''
};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return { ...defaultSettings, ...JSON.parse(data) };
        }
    } catch (err) {
        console.error("Settings load error:", err);
    }
    return { ...defaultSettings };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (err) {
        console.error("Settings save error:", err);
    }
}

let currentSettings = loadSettings();
const processedMessages = new Set();
const userState = new Map();

let pairingRequested = false;
let isConnectedMessageSent = false;

// Bot Start වූ තප්පරය (තප්පර 15ක Grace Period එකක් ලබා දී ඇත)
let botStartTime = Math.floor(Date.now() / 1000) - 15;

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            syncFullHistory: false,
            emitOwnEvents: true,
            getMessage: async (key) => {
                if (store) {
                    try {
                        const msg = await store.loadMessage(key.remoteJid, key.id);
                        return msg?.message || undefined;
                    } catch (e) {}
                }
                return { conversation: 'Hello' };
            }
        });

        if (store) store.bind(sock.ev);

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (!sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true;
                setTimeout(async () => {
                    try {
                        let code = await sock.requestPairingCode(PHONE_NUMBER);
                        code = code?.match(/.{1,4}/g)?.join("-") || code;
                        console.log(`\n=================================\n🔑 PAIRING CODE: ${code}\n=================================\n`);
                    } catch (error) {
                        console.log("Pairing code error:", error?.message || error);
                        pairingRequested = false;
                    }
                }, 6000);
            }

            if (connection === 'close') {
                isConnectedMessageSent = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`සම්බන්ධතාවය බිඳ වැටුණි (Reason: ${statusCode})`);

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log("🔴 Session Expired. Clearing Auth...");
                    pairingRequested = false;
                    if (fs.existsSync('auth_info_baileys')) {
                        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                    }
                }
                setTimeout(() => connectToWhatsApp(), 3000);
            } else if (connection === 'open') {
                console.log(`✅ ${currentSettings.botName} සාර්ථකව සම්බන්ධ විය!`);
                pairingRequested = false;
                
                // Reconnect වූ පසු botStartTime නැවත Update කර ගනී
                botStartTime = Math.floor(Date.now() / 1000) - 10;

                await sock.sendPresenceUpdate(currentSettings.botPresence).catch(() => {});

                if (!isConnectedMessageSent) {
                    isConnectedMessageSent = true;
                    try {
                        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                        const connectedMessage = `✅ *BOT CONNECTING SUCCESSFUL*\n\n` +
                                                 `🤖 *Bot Name:* ${currentSettings.botName}\n` +
                                                 `🌐 *Work Mode:* ${currentSettings.workMode.toUpperCase()}\n` +
                                                 `• *Status:* Active 🟢\n` +
                                                 `• *Prefix:* [ ${currentSettings.currentPrefix} ]\n` +
                                                 `• *Auto React:* ${currentSettings.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${currentSettings.ownerReactEmoji})\n` +
                                                 `• *View Once Download:* ${currentSettings.autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                                 `• *GitHub Token:* ${currentSettings.githubToken ? 'SET 🟢' : 'NOT SET 🔴'}\n` +
                                                 `• *GitHub Repo:* ${currentSettings.githubRepo ? currentSettings.githubRepo : 'NOT SET 🔴'}\n\n` +
                                                 `_${currentSettings.botName} is now ready to use!_`;

                        await sock.sendMessage(botJid, { text: connectedMessage });
                    } catch (err) {
                        console.error("Connected message error:", err.message);
                    }
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            try {
                if (type !== 'notify') return;

                const msg = messages[0];
                if (!msg || !msg.message) return;

                // 1. Bot off වී තිබියදී ආ ඉතා පැරණි මැසේජ් වැළැක්වීම (ග්‍රේස් පීරියඩ් එකක් සමඟ)
                const msgTimestamp = typeof msg.messageTimestamp === 'number' 
                    ? msg.messageTimestamp 
                    : msg.messageTimestamp?.low || 0;

                if (msgTimestamp && msgTimestamp < botStartTime) return;

                // 2. Double Message Processing Fix
                const msgId = msg.key.id;
                const msgKey = `${msg.key.remoteJid}_${msgId}`;
                if (processedMessages.has(msgKey)) return;
                processedMessages.add(msgKey);
                setTimeout(() => processedMessages.delete(msgKey), 60000);

                const from = msg.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const senderNumber = senderJid.split('@')[0].split(':')[0];
                const isOwner = senderNumber === PHONE_NUMBER || msg.key.fromMe;

                // Auto React Functionality
                if (isOwner && currentSettings.autoReactEnabled && currentSettings.ownerReactEmoji) {
                    try {
                        await sock.sendMessage(from, {
                            react: { text: currentSettings.ownerReactEmoji, key: msg.key }
                        });
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

                const currentState = userState.get(from);

                // Settings Interactive Steps
                if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '1') {
                    userState.set(from, 'AWAITING_BOTNAME_INPUT');
                    return await sock.sendMessage(from, { text: `🤖 *CHANGE BOT NAME*\n\nCurrent Name: *${currentSettings.botName}*\n\nPlease reply with the new Bot Name:` }, { quoted: msg });
                }

                if (currentState === 'AWAITING_BOTNAME_INPUT') {
                    currentSettings.botName = textMessage.trim();
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *Bot Name Updated To:* ${currentSettings.botName}` }, { quoted: msg });
                }

                if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '2') {
                    userState.set(from, 'AWAITING_ONLINE_CHOICE');
                    return await sock.sendMessage(from, { text: `⚙️ *ONLINE STATUS*\n\n2.1 - Online 🟢\n2.2 - Offline 🔴` }, { quoted: msg });
                }

                if (currentState === 'AWAITING_ONLINE_CHOICE') {
                    if (textMessage === '2.1') {
                        currentSettings.botPresence = 'available';
                        saveSettings(currentSettings);
                        await sock.sendPresenceUpdate('available');
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `✅ *Online Status:* ON 🟢` }, { quoted: msg });
                    } else if (textMessage === '2.2') {
                        currentSettings.botPresence = 'unavailable';
                        saveSettings(currentSettings);
                        await sock.sendPresenceUpdate('unavailable');
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `🔴 *Online Status:* OFF 🔴` }, { quoted: msg });
                    }
                }

                if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '3') {
                    userState.set(from, 'AWAITING_PREFIX_CHOICE');
                    return await sock.sendMessage(from, { text: `⚙️ *CHANGE PREFIX*\n\nCurrent: [ *${currentSettings.currentPrefix}* ]\nReply with new symbol: . , * & # @ / ? ' ; !` }, { quoted: msg });
                }

                if (currentState === 'AWAITING_PREFIX_CHOICE') {
                    const allowedPrefixes = ['.', ',', '*', '&', '#', '@', '/', '?', "'", ';', '!'];
                    if (allowedPrefixes.includes(textMessage)) {
                        currentSettings.currentPrefix = textMessage;
                        saveSettings(currentSettings);
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `✅ *Prefix Changed To:* [ *${currentSettings.currentPrefix}* ]` }, { quoted: msg });
                    }
                }

                if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '4') {
                    userState.set(from, 'AWAITING_REACT_CHOICE');
                    return await sock.sendMessage(from, { text: `⚙️ *AUTO REACT*\n\n4.1 - Enable 🟢\n4.2 - Disable 🔴\n4.3 - Change Emoji` }, { quoted: msg });
                }

                if (currentState === 'AWAITING_REACT_CHOICE') {
                    if (textMessage === '4.1') {
                        currentSettings.autoReactEnabled = true;
                        saveSettings(currentSettings);
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `🟢 *Auto React:* Enabled (${currentSettings.ownerReactEmoji})` }, { quoted: msg });
                    } else if (textMessage === '4.2') {
                        currentSettings.autoReactEnabled = false;
                        saveSettings(currentSettings);
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `🔴 *Auto React:* Disabled` }, { quoted: msg });
                    } else if (textMessage === '4.3') {
                        userState.set(from, 'AWAITING_EMOJI_INPUT');
                        return await sock.sendMessage(from, { text: `Send new Emoji:` }, { quoted: msg });
                    }
                }

                if (currentState === 'AWAITING_EMOJI_INPUT') {
                    currentSettings.ownerReactEmoji = textMessage.trim();
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *Emoji Changed To:* ${currentSettings.ownerReactEmoji}` }, { quoted: msg });
                }

                if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '5') {
                    userState.set(from, 'AWAITING_VO_CHOICE');
                    return await sock.sendMessage(from, { text: `👁️ *VIEW ONCE*\n\n5.1 - Enable 🟢\n5.2 - Disable 🔴` }, { quoted: msg });
                }

                if (currentState === 'AWAITING_VO_CHOICE') {
                    if (textMessage === '5.1') {
                        currentSettings.autoViewOnce = true;
                        saveSettings(currentSettings);
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `🟢 *View Once:* Enabled` }, { quoted: msg });
                    } else if (textMessage === '5.2') {
                        currentSettings.autoViewOnce = false;
                        saveSettings(currentSettings);
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `🔴 *View Once:* Disabled` }, { quoted: msg });
                    }
                }

                if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '6') {
                    userState.set(from, 'AWAITING_APPLY_INPUT');
                    return await sock.sendMessage(from, { text: `🔑 *GITHUB CONFIGURATION*\n\nPlease reply with your GitHub Token and Repo Name:\n\n*Format:* \`<token> <reponame>\`\n*Example:* \`ghp_xxxxxx my-bot-repo\`` }, { quoted: msg });
                }

                if (currentState === 'AWAITING_APPLY_INPUT') {
                    const parts = textMessage.trim().split(/ +/);
                    if (parts.length >= 2) {
                        currentSettings.githubToken = parts[0];
                        currentSettings.githubRepo = parts[1];
                        saveSettings(currentSettings);
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `✅ *GitHub Config Saved!*\nToken: Saved 🟢\nRepo: ${currentSettings.githubRepo}` }, { quoted: msg });
                    } else {
                        return await sock.sendMessage(from, { text: `⚠️ Invalid Format! Usage: \`<token> <reponame>\`` }, { quoted: msg });
                    }
                }

                if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '7') {
                    userState.set(from, 'AWAITING_MODE_CHOICE');
                    return await sock.sendMessage(from, { text: `🌐 *WORK MODE SETTINGS*\n\nCurrent Mode: *${currentSettings.workMode.toUpperCase()}*\n\n7.1 - Public Mode 🌐\n7.2 - Private / Inbox Mode 🔒\n7.3 - Group Mode 👥` }, { quoted: msg });
                }

                if (currentState === 'AWAITING_MODE_CHOICE') {
                    if (textMessage === '7.1') {
                        currentSettings.workMode = 'public';
                        saveSettings(currentSettings);
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `🌐 *Work Mode Changed To:* PUBLIC (Works Everywhere)` }, { quoted: msg });
                    } else if (textMessage === '7.2') {
                        currentSettings.workMode = 'private';
                        saveSettings(currentSettings);
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `🔒 *Work Mode Changed To:* PRIVATE / INBOX (Inbox Only)` }, { quoted: msg });
                    } else if (textMessage === '7.3') {
                        currentSettings.workMode = 'group';
                        saveSettings(currentSettings);
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `👥 *Work Mode Changed To:* GROUP (Groups Only)` }, { quoted: msg });
                    }
                }

                // Check Command Prefix
                if (!textMessage.startsWith(currentSettings.currentPrefix)) return;

                const args = textMessage.slice(currentSettings.currentPrefix.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                // Work Mode Filter Check (Applies to Non-Owner)
                if (!isOwner) {
                    if (currentSettings.workMode === 'private' && isGroup) return;
                    if (currentSettings.workMode === 'group' && !isGroup) return;
                }

                // .mode Command
                if (command === 'mode') {
                    if (!isOwner) return;
                    const newMode = args[0]?.toLowerCase();
                    if (!newMode || !['public', 'private', 'inbox', 'group'].includes(newMode)) {
                        return await sock.sendMessage(from, { text: `⚠️ *Usage:* ${currentSettings.currentPrefix}mode <public | private/inbox | group>\n\n*Current Mode:* ${currentSettings.workMode.toUpperCase()}` }, { quoted: msg });
                    }
                    
                    const setMode = (newMode === 'inbox') ? 'private' : newMode;
                    currentSettings.workMode = setMode;
                    saveSettings(currentSettings);
                    return await sock.sendMessage(from, { text: `✅ *Bot Work Mode Updated To:* ${setMode.toUpperCase()}` }, { quoted: msg });
                }

                // .botname Command
                if (command === 'botname') {
                    if (!isOwner) return;
                    const newName = args.join(' ');
                    if (!newName) {
                        return await sock.sendMessage(from, { text: `⚠️ Usage: *${currentSettings.currentPrefix}botname <New Bot Name>*` }, { quoted: msg });
                    }
                    currentSettings.botName = newName;
                    saveSettings(currentSettings);
                    return await sock.sendMessage(from, { text: `✅ *Bot Name Changed Successfully To:* ${newName}` }, { quoted: msg });
                }

                // .apply Command
                if (command === 'apply') {
                    if (!isOwner) return;
                    const token = args[0];
                    const repo = args[1];

                    if (!token || !repo) {
                        return await sock.sendMessage(from, { text: `⚠️ Usage: *${currentSettings.currentPrefix}apply <github_token> <repo_name>*` }, { quoted: msg });
                    }

                    currentSettings.githubToken = token;
                    currentSettings.githubRepo = repo;
                    saveSettings(currentSettings);
                    return await sock.sendMessage(from, { text: `✅ *GitHub Details Connected Successfully!*\n\n• *Token:* Saved 🟢\n• *Repo:* ${repo}` }, { quoted: msg });
                }

                // .customreset Command
                if (command === 'customreset') {
                    if (!isOwner) return;
                    currentSettings = { ...defaultSettings };
                    saveSettings(currentSettings);
                    userState.clear();
                    return await sock.sendMessage(from, { text: `🔄 *All Settings Reset to Default Values Successfully!*` }, { quoted: msg });
                }

                // .update Command
                if (command === 'update') {
                    if (!isOwner) return;
                    await sock.sendMessage(from, { text: `🔄 *Checking for updates and pulling from GitHub...*` }, { quoted: msg });

                    exec('git pull', async (error, stdout) => {
                        if (error) {
                            return await sock.sendMessage(from, { text: `❌ *Update Failed:* ${error.message}` }, { quoted: msg });
                        }
                        await sock.sendMessage(from, { text: `✅ *Update Result:*\n\`\`\`${stdout}\`\`\`\n*Restarting Bot...*` }, { quoted: msg });
                        setTimeout(() => process.exit(0), 2000);
                    });
                }

                // Menu Command
                else if (command === 'menu' || command === 'help') {
                    const menuText = `✨ *${currentSettings.botName} MAIN MENU* ✨\n\n` +
                                     `🤖 *Bot Name:* ${currentSettings.botName}\n` +
                                     `🌐 *Work Mode:* ${currentSettings.workMode.toUpperCase()}\n` +
                                     `📌 *Prefix:* [ ${currentSettings.currentPrefix} ]\n` +
                                     `🟢 *Status:* ${currentSettings.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                     `👑 *Auto React:* ${currentSettings.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${currentSettings.ownerReactEmoji})\n` +
                                     `👁️ *View Once:* ${currentSettings.autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                     `🔑 *GitHub:* ${currentSettings.githubToken ? 'Connected 🟢' : 'Not Connected 🔴'}\n\n` +
                                     `*AVAILABLE COMMANDS:*\n` +
                                     `┌──────────────\n` +
                                     `│ 📜 *${currentSettings.currentPrefix}menu* - Display Menu\n` +
                                     `│ 🏓 *${currentSettings.currentPrefix}ping* - Speed Test\n` +
                                     `│ ⚙️ *${currentSettings.currentPrefix}setting* - Bot Settings\n` +
                                     `│ 🌐 *${currentSettings.currentPrefix}mode* - Change Work Mode\n` +
                                     `│ 🤖 *${currentSettings.currentPrefix}botname* - Change Bot Name\n` +
                                     `│ 👁️ *${currentSettings.currentPrefix}vv2* - View Once Downloader\n` +
                                     `│ 🔑 *${currentSettings.currentPrefix}apply* - Connect GitHub\n` +
                                     `│ 🔄 *${currentSettings.currentPrefix}update* - Pull Updates\n` +
                                     `│ ⚙️ *${currentSettings.currentPrefix}customreset* - Reset Settings\n` +
                                     `└──────────────\n\n` +
                                     `_POWERED BY ${currentSettings.botName}_`;

                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }

                // Ping Command
                else if (command === 'ping') {
                    const start = Date.now();
                    await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
                    const end = Date.now();
                    await sock.sendMessage(from, { text: `🏓 *Pong!*\nSpeed: *${end - start}ms*\n\n_${currentSettings.botName}_` }, { quoted: msg });
                }

                // Setting Command
                else if (command === 'setting' || command === 'settings') {
                    userState.set(from, 'AWAITING_SETTING_CHOICE');
                    const settingsText = `⚙️ *${currentSettings.botName} SETTINGS*\n\n` +
                                         `Reply with option number:\n\n` +
                                         `*1* - Change Bot Name 🤖\n` +
                                         `*2* - Online Status Settings 🟢\n` +
                                         `*3* - Change Prefix 📌\n` +
                                         `*4* - Auto React Settings 👑\n` +
                                         `*5* - View Once Settings 👁️\n` +
                                         `*6* - GitHub Config (.apply) 🔑\n` +
                                         `*7* - Change Work Mode (Public/Private/Group) 🌐\n\n` +
                                         `_Bot Name: ${currentSettings.botName}_\n` +
                                         `_Mode: ${currentSettings.workMode.toUpperCase()}_\n` +
                                         `_Status: ${currentSettings.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}_\n` +
                                         `_Prefix: [ ${currentSettings.currentPrefix} ]_\n` +
                                         `_Auto React: ${currentSettings.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${currentSettings.ownerReactEmoji})_\n` +
                                         `_GitHub: ${currentSettings.githubToken ? 'Connected 🟢' : 'Not Connected 🔴'}_`;
                    await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
                }

                // View Once Command (.vv2)
                else if (command === 'vv2' || command === 'vv') {
                    if (!currentSettings.autoViewOnce) {
                        return await sock.sendMessage(from, { text: `⚠️ View Once Feature is OFF!` }, { quoted: msg });
                    }

                    const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!quotedMsg) return await sock.sendMessage(from, { text: `⚠️ Reply to a view once media!` }, { quoted: msg });

                    const viewOnceMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg;
                    const imageMsg = viewOnceMsg.imageMessage;
                    const videoMsg = viewOnceMsg.videoMessage;

                    if (!imageMsg && !videoMsg) return await sock.sendMessage(from, { text: `⚠️ Not a view once message!` }, { quoted: msg });

                    const botOwnerJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                    if (imageMsg) {
                        const stream = await downloadContentFromMessage(imageMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                        await sock.sendMessage(botOwnerJid, { image: buffer, caption: `👁️ *VIEW ONCE DOWNLOADED*` });
                        await sock.sendMessage(from, { text: `✅ Photo sent to Inbox!` }, { quoted: msg });
                    } else if (videoMsg) {
                        const stream = await downloadContentFromMessage(videoMsg, 'video');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                        await sock.sendMessage(botOwnerJid, { video: buffer, caption: `👁️ *VIEW ONCE DOWNLOADED*` });
                        await sock.sendMessage(from, { text: `✅ Video sent to Inbox!` }, { quoted: msg });
                    }
                }

            } catch (error) {
                console.error("Message Processing Error:", error);
            }
        });

    } catch (botErr) {
        console.error("Bot Connection Error:", botErr.message);
        setTimeout(() => connectToWhatsApp(), 5000);
    }
}

connectToWhatsApp();
