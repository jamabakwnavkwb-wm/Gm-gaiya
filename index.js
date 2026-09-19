const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// Default Settings
const defaultSettings = {
    botName: 'GM GAIYA - MD',     // Bot Name
    botPresence: 'available',    // Online Status ('available' / 'unavailable')
    currentPrefix: '.',          // Prefix
    workMode: 'public',          // Work Mode ('public', 'private', 'group', 'inbox')
    autoReactEnabled: true,       // Auto React
    ownerReactEmoji: '👑',       // Owner React Emoji
    autoViewOnce: true           // View Once On/Off Status
};

// Local JSON File එකෙන් Settings Load කිරීම
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return { ...defaultSettings, ...JSON.parse(data) };
        }
    } catch (err) {
        console.error("Settings load කිරීමට නොහැකි විය, default භාවිත කෙරේ:", err);
    }
    return { ...defaultSettings };
}

// Settings JSON File එකට Save කිරීම
function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (err) {
        console.error("Settings save කිරීමට නොහැකි විය:", err);
    }
}

// Global Settings variables
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
                console.log(`\n=================================\n🔑 ඔබගේ Pairing Code එක: ${code}\n=================================\n`);
            } catch (error) {
                console.log("Pairing code ලබා ගැනීමට නොහැකි විය: ", error);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`සම්බන්ධතාවය බිඳ වැටුණි (Reason Code: ${statusCode}), නැවත සම්බන්ධ වෙමින්...`, shouldReconnect);
            
            if (shouldReconnect) {
                setTimeout(() => {
                    connectToWhatsApp();
                }, 3000);
            } else {
                console.log('🔴 Logged out වී ඇත. කරුණාකර auth_info_baileys folder එක delete කර නැවත Pair කරන්න.');
            }
        } else if (connection === 'open') {
            console.log(`✅ ${currentSettings.botName} සාර්ථකව සම්බන්ධ විය!`);

            await sock.sendPresenceUpdate(currentSettings.botPresence);

            try {
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const connectedMessage = `✅ *BOT CONNECTING SUCCESSFUL*\n\n` +
                                         `🤖 *Bot Name:* ${currentSettings.botName}\n` +
                                         `• *Status:* ${currentSettings.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                         `• *Prefix:* [ ${currentSettings.currentPrefix} ]\n` +
                                         `• *Work Mode:* ${currentSettings.workMode.toUpperCase()}\n` +
                                         `• *View Once Download:* ${currentSettings.autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                         `• *Auto React:* ${currentSettings.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${currentSettings.ownerReactEmoji})\n` +
                                         `• *Commands:* ${currentSettings.currentPrefix}menu , ${currentSettings.currentPrefix}ping , ${currentSettings.currentPrefix}setting\n\n` +
                                         `_${currentSettings.botName} is now active and ready!_`;

                await sock.sendMessage(botJid, { text: connectedMessage });
            } catch (err) {
                console.error("Connected message යැවීමට නොහැකි විය:", err);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (!messages || messages.length === 0) return;

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

            await sock.sendPresenceUpdate(currentSettings.botPresence);

            // Owner Auto React
            if (isOwner && currentSettings.autoReactEnabled && currentSettings.ownerReactEmoji && textMessage) {
                try {
                    await sock.sendMessage(from, {
                        react: {
                            text: currentSettings.ownerReactEmoji,
                            key: msg.key
                        }
                    });
                } catch (reactErr) {
                    console.error("Auto react error:", reactErr);
                }
            }

            // Work Mode Control
            if (!isOwner) {
                if (currentSettings.workMode === 'private') return; 
                if (currentSettings.workMode === 'group' && !isGroup) return; 
                if (currentSettings.workMode === 'inbox' && isGroup) return;  
            }

            const currentState = userState.get(from);

            // ----------------- INTERACTIVE SETTINGS RESPONSES ----------------- //

            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '1') {
                userState.set(from, 'AWAITING_ONLINE_CHOICE');
                const onlineMenu = `⚙️ *ONLINE STATUS SETTINGS*\n\n` +
                                   `Reply with option number:\n` +
                                   `*1.1* - Turn ON Online Status 🟢\n` +
                                   `*1.2* - Turn OFF Online Status 🔴\n\n` +
                                   `_${currentSettings.botName}_`;
                return await sock.sendMessage(from, { text: onlineMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_ONLINE_CHOICE') {
                if (textMessage === '1.1') {
                    currentSettings.botPresence = 'available';
                    saveSettings(currentSettings);
                    await sock.sendPresenceUpdate('available');
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *Online Status is now ON!* 🟢` }, { quoted: msg });
                } else if (textMessage === '1.2') {
                    currentSettings.botPresence = 'unavailable';
                    saveSettings(currentSettings);
                    await sock.sendPresenceUpdate('unavailable');
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔴 *Online Status is now OFF!*` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '2') {
                userState.set(from, 'AWAITING_PREFIX_CHOICE');
                const prefixMenu = `⚙️ *CHANGE BOT PREFIX*\n\n` +
                                   `Current Prefix: [ *${currentSettings.currentPrefix}* ]\n\n` +
                                   `Reply with symbol: *.*  *,*  ***  *&*  *#*  *@*  */*  *?*  *'*  *;*  *!*`;
                return await sock.sendMessage(from, { text: prefixMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_PREFIX_CHOICE') {
                const allowedPrefixes = ['.', ',', '*', '&', '#', '@', '/', '?', "'", ';', '!'];
                if (allowedPrefixes.includes(textMessage)) {
                    currentSettings.currentPrefix = textMessage;
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *Prefix changed to:* [ *${currentSettings.currentPrefix}* ]` }, { quoted: msg });
                } else {
                    return await sock.sendMessage(from, { text: `⚠️ Invalid prefix! Choose from: . , * & # @ / ? ' ; !` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '3') {
                userState.set(from, 'AWAITING_MODE_CHOICE');
                const modeMenu = `⚙️ *WORK MODE SETTINGS*\n\n` +
                                 `Reply with option number:\n` +
                                 `*3.1* - Private Mode 🔒\n` +
                                 `*3.2* - Group Only Mode 👥\n` +
                                 `*3.3* - Inbox Only Mode 📥\n` +
                                 `*3.4* - Public Mode 🌐\n\n` +
                                 `_Current Mode: ${currentSettings.workMode.toUpperCase()}_`;
                return await sock.sendMessage(from, { text: modeMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_MODE_CHOICE') {
                if (textMessage === '3.1') currentSettings.workMode = 'private';
                else if (textMessage === '3.2') currentSettings.workMode = 'group';
                else if (textMessage === '3.3') currentSettings.workMode = 'inbox';
                else if (textMessage === '3.4') currentSettings.workMode = 'public';
                else return;

                saveSettings(currentSettings);
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Work Mode set to ${currentSettings.workMode.toUpperCase()}!*` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '4') {
                userState.set(from, 'AWAITING_REACT_SETTINGS_CHOICE');
                const reactMenu = `⚙️ *AUTO REACT SETTINGS*\n\n` +
                                  `Reply with option number:\n` +
                                  `*4.1* - Turn ON Auto React 🟢\n` +
                                  `*4.2* - Turn OFF Auto React 🔴\n` +
                                  `*4.3* - Change React Emoji 👑`;
                return await sock.sendMessage(from, { text: reactMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_REACT_SETTINGS_CHOICE') {
                if (textMessage === '4.1') {
                    currentSettings.autoReactEnabled = true;
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🟢 *Auto React ON!* (${currentSettings.ownerReactEmoji})` }, { quoted: msg });
                } else if (textMessage === '4.2') {
                    currentSettings.autoReactEnabled = false;
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔴 *Auto React OFF!*` }, { quoted: msg });
                } else if (textMessage === '4.3') {
                    userState.set(from, 'AWAITING_EMOJI_CHOICE');
                    return await sock.sendMessage(from, { text: `_Please send the new Emoji (e.g., 👑, ❤️, 🔥)_` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_EMOJI_CHOICE') {
                currentSettings.ownerReactEmoji = textMessage.trim();
                saveSettings(currentSettings);
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Auto React Emoji changed to:* ${currentSettings.ownerReactEmoji}` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '5') {
                userState.set(from, 'AWAITING_NAME_CHOICE');
                return await sock.sendMessage(from, { text: `🤖 *CHANGE BOT NAME*\n\nCurrent Name: *${currentSettings.botName}*\n\n_කරුණාකර Bot ට තැබීමට අවශ්‍ය අලුත් නම ටයිප් කර යවන්න:_` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_NAME_CHOICE') {
                if (!isOwner) return await sock.sendMessage(from, { text: `⚠️ Owner only feature!` }, { quoted: msg });

                const newName = textMessage.trim();
                currentSettings.botName = newName;
                saveSettings(currentSettings);
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Bot Name successfully changed to:* *${currentSettings.botName}*` }, { quoted: msg });
            }

            // 6. View Once Settings Menu Choice
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '6') {
                userState.set(from, 'AWAITING_VO_CHOICE');
                const voMenu = `👁️ *VIEW ONCE DOWNLOAD SETTINGS*\n\n` +
                               `Reply with option number:\n` +
                               `*6.1* - Turn ON View Once Command 🟢\n` +
                               `*6.2* - Turn OFF View Once Command 🔴\n\n` +
                               `_Current Status: ${currentSettings.autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}_`;
                return await sock.sendMessage(from, { text: voMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_VO_CHOICE') {
                if (textMessage === '6.1') {
                    currentSettings.autoViewOnce = true;
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🟢 *View Once Command Enabled!*` }, { quoted: msg });
                } else if (textMessage === '6.2') {
                    currentSettings.autoViewOnce = false;
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔴 *View Once Command Disabled!*` }, { quoted: msg });
                }
            }

            // ----------------- MAIN COMMANDS ----------------- //

            if (!textMessage.startsWith(currentSettings.currentPrefix)) return;

            const args = textMessage.slice(currentSettings.currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // 1. Menu Command
            if (command === 'menu' || command === 'help') {
                const menuText = `✨ *${currentSettings.botName} MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* ${currentSettings.botName}\n` +
                                 `📌 *Prefix:* [ ${currentSettings.currentPrefix} ]\n` +
                                 `🟢 *Status:* ${currentSettings.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                 `⚙️ *Mode:* ${currentSettings.workMode.toUpperCase()}\n` +
                                 `👁️ *View Once Feature:* ${currentSettings.autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                 `👑 *Auto React:* ${currentSettings.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'}\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${currentSettings.currentPrefix}menu* - Display Menu\n` +
                                 `│ 🏓 *${currentSettings.currentPrefix}ping* - Check Bot Speed\n` +
                                 `│ ⚙️ *${currentSettings.currentPrefix}setting* - Bot Settings\n` +
                                 `│ 🤖 *${currentSettings.currentPrefix}setbotname <Name>* - Direct Name Change\n` +
                                 `│ 🔄 *${currentSettings.currentPrefix}update* - Git Update\n` +
                                 `│ 👁️ *${currentSettings.currentPrefix}vv2* - View Once Download\n` +
                                 `│ 🔄 *${currentSettings.currentPrefix}customreset* - Reset Settings\n` +
                                 `│ 🛑 *${currentSettings.currentPrefix}stop* - Stop Bot Process\n` +
                                 `└──────────────\n\n` +
                                 `_POWERED BY ${currentSettings.botName}_`;

                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }

            // 2. Ping Command
            else if (command === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
                const end = Date.now();
                const latency = end - start;
                
                await sock.sendMessage(from, { text: `🏓 *Pong!*\nSpeed: *${latency}ms*\n\n_${currentSettings.botName}_` }, { quoted: msg });
            }

            // 3. Setting Command
            else if (command === 'setting' || command === 'settings') {
                userState.set(from, 'AWAITING_SETTING_CHOICE');
                
                const settingsText = `⚙️ *${currentSettings.botName} SETTINGS*\n\n` +
                                     `Reply with option number:\n\n` +
                                     `*1* - Online Status Settings\n` +
                                     `*2* - Change Prefix\n` +
                                     `*3* - Work Mode Settings\n` +
                                     `*4* - Auto React Settings\n` +
                                     `*5* - Change Bot Name 🤖\n` +
                                     `*6* - View Once Settings 👁️\n\n` +
                                     `_Current Bot Name: ${currentSettings.botName}_\n` +
                                     `_Current Prefix: [ ${currentSettings.currentPrefix} ]_\n` +
                                     `_Current Mode: ${currentSettings.workMode.toUpperCase()}_\n` +
                                     `_View Once Feature: ${currentSettings.autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}_`;
                
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

            // 4. Direct Set Bot Name Command
            else if (command === 'setbotname' || command === 'setname') {
                if (!isOwner) return await sock.sendMessage(from, { text: `⚠️ Owner only command!` }, { quoted: msg });

                const newName = args.join(" ");
                if (!newName) return await sock.sendMessage(from, { text: `⚠️ කරුණාකර අලුත් නම ලබාදෙන්න!\nExample: *${currentSettings.currentPrefix}setbotname GM GAIYA - MD*` }, { quoted: msg });

                currentSettings.botName = newName;
                saveSettings(currentSettings);
                await sock.sendMessage(from, { text: `✅ *Bot Name changed to:* *${currentSettings.botName}*` }, { quoted: msg });
            }

            // 5. Update Command
            else if (command === 'update') {
                if (!isOwner) return await sock.sendMessage(from, { text: `⚠️ Owner only command!` }, { quoted: msg });

                await sock.sendMessage(from, { text: `🔄 *Checking for GitHub updates...*` }, { quoted: msg });

                exec('git pull', async (error, stdout) => {
                    if (error) return await sock.sendMessage(from, { text: `❌ *Update Failed:* ${error.message}` }, { quoted: msg });
                    if (stdout.includes('Already up to date')) return await sock.sendMessage(from, { text: `✅ *Bot is up to date!*` }, { quoted: msg });

                    await sock.sendMessage(from, { text: `✅ *Updated successfully! Restarting...*` }, { quoted: msg });
                    setTimeout(() => process.exit(0), 2000);
                });
            }

            // 6. View Once Download Command (`.vv2` හෝ `.vv`)
            else if (command === 'vv2' || command === 'vv') {
                if (!currentSettings.autoViewOnce) {
                    return await sock.sendMessage(from, { text: `⚠️ View Once feature එක මේ වන විට Settings වලින් OFF කර ඇත!` }, { quoted: msg });
                }

                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) return await sock.sendMessage(from, { text: `⚠️ View Once photo/video එකකට reply කරන්න!` }, { quoted: msg });

                const viewOnceMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg;
                const imageMsg = viewOnceMsg.imageMessage;
                const videoMsg = viewOnceMsg.videoMessage;

                if (!imageMsg && !videoMsg) return await sock.sendMessage(from, { text: `⚠️ මෙය View Once media එකක් නොවේ!` }, { quoted: msg });

                const botOwnerJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                if (imageMsg) {
                    const stream = await downloadContentFromMessage(imageMsg, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    
                    // Owner ගේ Inbox එකට යවීම
                    await sock.sendMessage(botOwnerJid, { image: buffer, caption: `👁️ *VIEW ONCE PHOTO DOWNLOADED*\n\n_From: ${from}_` });
                    await sock.sendMessage(from, { text: `✅ View Once Photo එක සාර්ථකව Download කර Inbox එකට යවන ලදී!` }, { quoted: msg });
                } else if (videoMsg) {
                    const stream = await downloadContentFromMessage(videoMsg, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    // Owner ගේ Inbox එකට යවීම
                    await sock.sendMessage(botOwnerJid, { video: buffer, caption: `👁️ *VIEW ONCE VIDEO DOWNLOADED*\n\n_From: ${from}_` });
                    await sock.sendMessage(from, { text: `✅ View Once Video එක සාර්ථකව Download කර Inbox එකට යවන ලදී!` }, { quoted: msg });
                }
            }

            // 7. Custom Reset
            else if (command === 'customreset' || command === 'reset') {
                if (!isOwner) return await sock.sendMessage(from, { text: `⚠️ Owner only command!` }, { quoted: msg });

                currentSettings = { ...defaultSettings };
                saveSettings(currentSettings);
                userState.clear();

                await sock.sendPresenceUpdate(currentSettings.botPresence);
                await sock.sendMessage(from, { text: `🔄 *All Settings Reset to Default Successfully!*` }, { quoted: msg });
            }

            // 8. Stop Command
            else if (command === 'stop' || command === 'shutdown') {
                if (!isOwner) return await sock.sendMessage(from, { text: `⚠️ Owner only command!` }, { quoted: msg });

                await sock.sendMessage(from, { text: `🛑 *Shutting down ${currentSettings.botName}...*` }, { quoted: msg });
                setTimeout(() => process.exit(0), 2000);
            }

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
