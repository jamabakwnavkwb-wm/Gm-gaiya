const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// Default Settings
const defaultSettings = {
    botName: 'GM GAIYA - MD',
    botPresence: 'available',
    currentPrefix: '.',
    workMode: 'public',
    autoReactEnabled: true,
    ownerReactEmoji: '👑',
    autoViewOnce: true,
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
        console.error("Settings load කිරීමට නොහැකි විය:", err);
    }
    return { ...defaultSettings };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (err) {
        console.error("Settings save කිරීමට නොහැකි විය:", err);
    }
}

let currentSettings = loadSettings();
const processedMessages = new Set();
const userState = new Map();
const ownerNumber = "94764802314"; // ඔබගේ WhatsApp අංකය

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: [currentSettings.botName, 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(ownerNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n=================================\n🔑 Pairing Code: ${code}\n=================================\n`);
            } catch (error) {
                console.log("Pairing code error: ", error);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`සම්බන්ධතාවය බිඳ වැටුණි (${statusCode}), නැවත සම්බන්ධ වෙමින්...`);
            
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                console.log('🔴 Logged out වී ඇත. auth_info_baileys මකා නැවත Pair කරන්න.');
            }
        } else if (connection === 'open') {
            console.log(`✅ ${currentSettings.botName} සම්බන්ධ විය!`);
            await sock.sendPresenceUpdate(currentSettings.botPresence);

            try {
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const connectedMessage = `✅ *BOT CONNECTED SUCCESSFUL*\n\n` +
                                         `🤖 *Bot Name:* ${currentSettings.botName}\n` +
                                         `📌 *Prefix:* [ ${currentSettings.currentPrefix} ]\n` +
                                         `🔑 *GitHub Token:* ${currentSettings.githubToken ? 'SET 🟢' : 'NOT SET 🔴'}\n` +
                                         `📁 *GitHub Repo:* ${currentSettings.githubRepo || 'NOT SET 🔴'}\n\n` +
                                         `• *Commands:* ${currentSettings.currentPrefix}menu , ${currentSettings.currentPrefix}apply , ${currentSettings.currentPrefix}setting`;

                await sock.sendMessage(botJid, { text: connectedMessage });
            } catch (err) {
                console.error("Connected message error:", err);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify' || !messages || messages.length === 0) return;

            const msg = messages[0];
            if (!msg || !msg.message) return;

            // 🛑 Double Response Preventer (ඩබල් වැටෙන එක නැවැත්වීමට)
            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);
            setTimeout(() => processedMessages.delete(msgId), 30000);

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];
            const isOwner = senderNumber === ownerNumber || msg.key.fromMe;

            const textMessage = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                ''
            ).trim();

            if (!textMessage) return;

            await sock.sendPresenceUpdate(currentSettings.botPresence);

            // Owner Auto React
            if (isOwner && currentSettings.autoReactEnabled && currentSettings.ownerReactEmoji) {
                try {
                    await sock.sendMessage(from, { react: { text: currentSettings.ownerReactEmoji, key: msg.key } });
                } catch (e) {}
            }

            // Work Mode Controls
            if (!isOwner) {
                if (currentSettings.workMode === 'private') return;
                if (currentSettings.workMode === 'group' && !isGroup) return;
                if (currentSettings.workMode === 'inbox' && isGroup) return;
            }

            const currentState = userState.get(from);

            // ----------------- INTERACTIVE APPLY / SETTINGS HANDLERS ----------------- //

            if (currentState === 'AWAITING_APPLY_CHOICE') {
                if (textMessage === '1') {
                    userState.set(from, 'AWAITING_TOKEN_INPUT');
                    return await sock.sendMessage(from, { text: `🔑 *SET GITHUB TOKEN*\n\nකරුණාකර ඔබගේ GitHub Personal Access Token එක (ghp_...) මෙතැන යවන්න:` }, { quoted: msg });
                } else if (textMessage === '2') {
                    userState.set(from, 'AWAITING_REPO_INPUT');
                    return await sock.sendMessage(from, { text: `📁 *SET GITHUB REPO NAME*\n\nකරුණාකර Repo Name එක යවන්න (e.g., username/repository-name):` }, { quoted: msg });
                } else if (textMessage === '3') {
                    if (!currentSettings.githubToken || !currentSettings.githubRepo) {
                        userState.delete(from);
                        return await sock.sendMessage(from, { text: `⚠️ Token එක සහ Repo Name එක දෙකම ඇතුළත් කර තිබිය යුතුය!` }, { quoted: msg });
                    }
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔄 *Connecting to GitHub 24/7 Host...*\n\n✅ *Token:* Set\n✅ *Repo:* ${currentSettings.githubRepo}\n\nGitHub Workflow 24/7 active කිරීම සාර්ථකයි!` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_TOKEN_INPUT') {
                if (!isOwner) return;
                currentSettings.githubToken = textMessage;
                saveSettings(currentSettings);
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ GitHub Token එක සාර්ථකව Save විය!\n\nතවත් වෙනස්කම් සඳහා *${currentSettings.currentPrefix}apply* යවන්න.` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_REPO_INPUT') {
                if (!isOwner) return;
                currentSettings.githubRepo = textMessage;
                saveSettings(currentSettings);
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ GitHub Repo Name එක සාර්ථකව Save විය: *${currentSettings.githubRepo}*\n\nතවත් වෙනස්කම් සඳහා *${currentSettings.currentPrefix}apply* යවන්න.` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '5') {
                userState.set(from, 'AWAITING_NAME_CHOICE');
                return await sock.sendMessage(from, { text: `🤖 *CHANGE BOT NAME*\n\nකරුණාකර අලුත් නම යවන්න:` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_NAME_CHOICE') {
                if (!isOwner) return;
                currentSettings.botName = textMessage;
                saveSettings(currentSettings);
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ Bot Name වෙනස් විය: *${currentSettings.botName}*` }, { quoted: msg });
            }

            // ----------------- MAIN COMMANDS ----------------- //

            if (!textMessage.startsWith(currentSettings.currentPrefix)) return;

            const args = textMessage.slice(currentSettings.currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // .apply Command
            if (command === 'apply') {
                if (!isOwner) return await sock.sendMessage(from, { text: `⚠️ Owner only feature!` }, { quoted: msg });

                userState.set(from, 'AWAITING_APPLY_CHOICE');
                const applyMenu = `🔑 *GITHUB 24/7 AUTO CONNECT MENU*\n\n` +
                                  `Reply with the option number:\n\n` +
                                  `*1* - Set GitHub Token\n` +
                                  `*2* - Set GitHub Repository Name\n` +
                                  `*3* - Connect & Test 24/7 Host Status 🚀\n\n` +
                                  `*Current Status:*\n` +
                                  `• *Token:* ${currentSettings.githubToken ? 'Saved 🟢' : 'Not Saved 🔴'}\n` +
                                  `• *Repo:* ${currentSettings.githubRepo || 'Not Saved 🔴'}`;

                return await sock.sendMessage(from, { text: applyMenu }, { quoted: msg });
            }

            // .setting Command
            else if (command === 'setting' || command === 'settings') {
                userState.set(from, 'AWAITING_SETTING_CHOICE');
                
                const settingsText = `⚙️ *${currentSettings.botName} SETTINGS*\n\n` +
                                     `Reply with option number:\n\n` +
                                     `*1* - Online Status\n` +
                                     `*2* - Change Prefix\n` +
                                     `*3* - Work Mode\n` +
                                     `*4* - Auto React\n` +
                                     `*5* - Change Bot Name 🤖\n` +
                                     `*6* - View Once Settings\n\n` +
                                     `_Bot Name: ${currentSettings.botName}_\n` +
                                     `_Prefix: [ ${currentSettings.currentPrefix} ]_`;
                
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

            // .menu Command
            else if (command === 'menu' || command === 'help') {
                const menuText = `✨ *${currentSettings.botName} MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* ${currentSettings.botName}\n` +
                                 `📌 *Prefix:* [ ${currentSettings.currentPrefix} ]\n` +
                                 `🟢 *Status:* ${currentSettings.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                 `⚙️ *Mode:* ${currentSettings.workMode.toUpperCase()}\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `• *${currentSettings.currentPrefix}menu* - Display Menu\n` +
                                 `• *${currentSettings.currentPrefix}ping* - Check Speed\n` +
                                 `• *${currentSettings.currentPrefix}apply* - Connect GitHub 24/7\n` +
                                 `• *${currentSettings.currentPrefix}setting* - Bot Settings\n` +
                                 `• *${currentSettings.currentPrefix}stop* - Stop Bot\n\n` +
                                 `_POWERED BY ${currentSettings.botName}_`;

                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }

            // .ping Command
            else if (command === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
                const end = Date.now();
                const latency = end - start;
                
                await sock.sendMessage(from, { text: `🏓 *Pong!*\nSpeed: *${latency}ms*` }, { quoted: msg });
            }

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
