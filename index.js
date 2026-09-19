const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// Default Settings
const defaultSettings = {
    botPresence: 'available',    // Online ('available' / 'unavailable')
    currentPrefix: '.',          // Prefix
    workMode: 'public',          // Work Mode ('public', 'private', 'group', 'inbox')
    autoReactEnabled: true,       // Auto React (true / false)
    ownerReactEmoji: '👑'        // Owner React Emoji
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

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
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
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('සම්බන්ධතාවය බිඳ වැටුණි, නැවත සම්බන්ධ වෙමින්...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ GM GAIYA - MD සාර්ථකව සම්බන්ධ විය!');

            await sock.sendPresenceUpdate(currentSettings.botPresence);

            try {
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const connectedMessage = `✅ *BOT CONNECTING SUCCESSFUL*\n\n` +
                                         `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                         `• *Status:* ${currentSettings.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                         `• *Prefix:* [ ${currentSettings.currentPrefix} ]\n` +
                                         `• *Work Mode:* ${currentSettings.workMode.toUpperCase()}\n` +
                                         `• *Auto React:* ${currentSettings.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${currentSettings.ownerReactEmoji})\n` +
                                         `• *Auto Restart:* Every 6 Hours ⏰\n` +
                                         `• *Commands:* ${currentSettings.currentPrefix}menu , ${currentSettings.currentPrefix}ping , ${currentSettings.currentPrefix}setting , ${currentSettings.currentPrefix}update , ${currentSettings.currentPrefix}vv2 , ${currentSettings.currentPrefix}customreset\n\n` +
                                         `_GM GAIYA - MD Bot is now ready to use!_`;

                await sock.sendMessage(botJid, { text: connectedMessage });

                // Auto Restart Every 6 Hours
                const SIX_HOURS = 6 * 60 * 60 * 1000;
                setTimeout(async () => {
                    try {
                        console.log("⏰ පැය 6 සම්පූර්ණයි! Bot එක Auto Restart වෙමින් පවතී...");
                        await sock.sendMessage(botJid, { text: `⏰ *Auto Restarting Bot...* (Scheduled 6-hour restart)` });
                    } catch (e) {
                        console.error("Auto restart message error:", e);
                    }
                    setTimeout(() => {
                        process.exit(0);
                    }, 5000);
                }, SIX_HOURS);

            } catch (err) {
                console.error("Connected message යැවීමට නොහැකි විය:", err);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg || !msg.message) return;

            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);

            setTimeout(() => processedMessages.delete(msgId), 60000);

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];
            const isOwner = senderNumber === ownerNumber || msg.key.fromMe;

            await sock.sendPresenceUpdate(currentSettings.botPresence);

            // Owner Auto React
            if (isOwner && currentSettings.autoReactEnabled && currentSettings.ownerReactEmoji) {
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

            const textMessage = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                ''
            ).trim();

            if (!textMessage) return;

            // Work Mode Control
            if (!isOwner) {
                if (currentSettings.workMode === 'private') return; 
                if (currentSettings.workMode === 'group' && !isGroup) return; 
                if (currentSettings.workMode === 'inbox' && isGroup) return;  
            }

            const currentState = userState.get(from);

            // ----------------- INTERACTIVE SETTINGS RESPONSES ----------------- //

            // 1. Online Status Choice
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '1') {
                userState.set(from, 'AWAITING_ONLINE_CHOICE');
                const onlineMenu = `⚙️ *ONLINE STATUS SETTINGS*\n\n` +
                                   `Reply with the option number:\n` +
                                   `*1.1* - Turn ON Online Status 🟢\n` +
                                   `*1.2* - Turn OFF Online Status (Offline) 🔴\n\n` +
                                   `_GM GAIYA - MD_`;
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
                    return await sock.sendMessage(from, { text: `🔴 *Online Status is now OFF (Offline)!*` }, { quoted: msg });
                }
            }

            // 2. Prefix Choice
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '2') {
                userState.set(from, 'AWAITING_PREFIX_CHOICE');
                const prefixMenu = `⚙️ *CHANGE BOT PREFIX*\n\n` +
                                   `Current Prefix: [ *${currentSettings.currentPrefix}* ]\n\n` +
                                   `Reply with the symbol you want to set as Prefix:\n` +
                                   `Supported: *.*  *,*  ***  *&*  *#*  *@*  */*  *?*  *'*  *;*  *!*\n\n` +
                                   `_Type and send the symbol directly (e.g., #)_`;
                return await sock.sendMessage(from, { text: prefixMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_PREFIX_CHOICE') {
                const allowedPrefixes = ['.', ',', '*', '&', '#', '@', '/', '?', "'", ';', '!'];
                if (allowedPrefixes.includes(textMessage)) {
                    currentSettings.currentPrefix = textMessage;
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *Prefix successfully changed to:* [ *${currentSettings.currentPrefix}* ]` }, { quoted: msg });
                } else {
                    return await sock.sendMessage(from, { text: `⚠️ Invalid prefix! Please choose from: . , * & # @ / ? ' ; !` }, { quoted: msg });
                }
            }

            // 3. Work Mode Choice
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '3') {
                userState.set(from, 'AWAITING_MODE_CHOICE');
                const modeMenu = `⚙️ *WORK MODE SETTINGS*\n\n` +
                                 `Reply with the option number:\n` +
                                 `*3.1* - Private Mode 🔒 (Only Owner)\n` +
                                 `*3.2* - Group Only Mode 👥 (Groups Only)\n` +
                                 `*3.3* - Inbox Only Mode 📥 (Inbox Only)\n` +
                                 `*3.4* - Public Mode 🌐 (All - Group & Inbox)\n\n` +
                                 `_Current Mode: ${currentSettings.workMode.toUpperCase()}_`;
                return await sock.sendMessage(from, { text: modeMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_MODE_CHOICE') {
                if (textMessage === '3.1') {
                    currentSettings.workMode = 'private';
                } else if (textMessage === '3.2') {
                    currentSettings.workMode = 'group';
                } else if (textMessage === '3.3') {
                    currentSettings.workMode = 'inbox';
                } else if (textMessage === '3.4') {
                    currentSettings.workMode = 'public';
                } else {
                    return;
                }
                saveSettings(currentSettings);
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Work Mode set to ${currentSettings.workMode.toUpperCase()}!*` }, { quoted: msg });
            }

            // 4. Auto React Settings
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '4') {
                userState.set(from, 'AWAITING_REACT_SETTINGS_CHOICE');
                const reactMenu = `⚙️ *OWNER AUTO REACT SETTINGS*\n\n` +
                                  `Reply with the option number:\n` +
                                  `*4.1* - Turn ON Auto React 🟢\n` +
                                  `*4.2* - Turn OFF Auto React 🔴\n` +
                                  `*4.3* - Change React Emoji 👑\n\n` +
                                  `_Current Status: ${currentSettings.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'}_ (${currentSettings.ownerReactEmoji})`;
                return await sock.sendMessage(from, { text: reactMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_REACT_SETTINGS_CHOICE') {
                if (textMessage === '4.1') {
                    currentSettings.autoReactEnabled = true;
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🟢 *Owner Auto React is now turned ON!* (${currentSettings.ownerReactEmoji})` }, { quoted: msg });
                } else if (textMessage === '4.2') {
                    currentSettings.autoReactEnabled = false;
                    saveSettings(currentSettings);
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔴 *Owner Auto React is now turned OFF!*` }, { quoted: msg });
                } else if (textMessage === '4.3') {
                    userState.set(from, 'AWAITING_EMOJI_CHOICE');
                    const emojiMenu = `⚙️ *CHANGE OWNER AUTO REACT EMOJI*\n\n` +
                                      `Current React Emoji: ${currentSettings.ownerReactEmoji}\n\n` +
                                      `_Please send the new Emoji you want to set as Auto React (e.g., 👑, ❤️, 🔥, ⚡)_`;
                    return await sock.sendMessage(from, { text: emojiMenu }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_EMOJI_CHOICE') {
                currentSettings.ownerReactEmoji = textMessage.trim();
                saveSettings(currentSettings);
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Auto React Emoji changed to:* ${currentSettings.ownerReactEmoji}` }, { quoted: msg });
            }

            // ----------------- MAIN COMMANDS ----------------- //

            if (!textMessage.startsWith(currentSettings.currentPrefix)) return;

            const args = textMessage.slice(currentSettings.currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // 1. Menu Command
            if (command === 'menu' || command === 'help') {
                const menuText = `✨ *GM GAIYA - MD MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                 `📌 *Prefix:* [ ${currentSettings.currentPrefix} ]\n` +
                                 `🟢 *Status:* ${currentSettings.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                 `⚙️ *Mode:* ${currentSettings.workMode.toUpperCase()}\n` +
                                 `👑 *Auto React:* ${currentSettings.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${currentSettings.ownerReactEmoji})\n` +
                                 `⏰ *Auto Restart:* Every 6 Hours\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${currentSettings.currentPrefix}menu* - Display Menu\n` +
                                 `│ 🏓 *${currentSettings.currentPrefix}ping* - Check Bot Speed\n` +
                                 `│ ⚙️ *${currentSettings.currentPrefix}setting* - Bot Settings\n` +
                                 `│ 🔄 *${currentSettings.currentPrefix}update* - Update Bot from GitHub\n` +
                                 `│ 👁️ *${currentSettings.currentPrefix}vv2* - Download View Once Media\n` +
                                 `│ 🔄 *${currentSettings.currentPrefix}customreset* - Reset All Bot Settings\n` +
                                 `└──────────────\n\n` +
                                 `_POWERED BY GM GAIYA - MD_`;

                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }

            // 2. Ping Command
            else if (command === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
                const end = Date.now();
                const latency = end - start;
                
                await sock.sendMessage(from, { text: `🏓 *Pong!*\nSpeed: *${latency}ms*\n\n_GM GAIYA - MD_` }, { quoted: msg });
            }

            // 3. Setting Command (Main Menu)
            else if (command === 'setting' || command === 'settings') {
                userState.set(from, 'AWAITING_SETTING_CHOICE');
                
                const settingsText = `⚙️ *GM GAIYA - MD SETTINGS*\n\n` +
                                     `Reply with the option number:\n\n` +
                                     `*1* - Online Status Settings\n` +
                                     `*2* - Change Prefix\n` +
                                     `*3* - Work Mode Settings\n` +
                                     `*4* - Owner Auto React Settings\n\n` +
                                     `_Current Status: ${currentSettings.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}_\n` +
                                     `_Current Prefix: [ ${currentSettings.currentPrefix} ]_\n` +
                                     `_Current Mode: ${currentSettings.workMode.toUpperCase()}_\n` +
                                     `_Current Auto React: ${currentSettings.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${currentSettings.ownerReactEmoji})_`;
                
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

            // 4. Update Command (Git Pull & Restart)
            else if (command === 'update') {
                if (!isOwner) {
                    return await sock.sendMessage(from, { text: `⚠️ *This command is restricted to the Owner only!*` }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `🔄 *Checking for updates from GitHub...*` }, { quoted: msg });

                exec('git pull', async (error, stdout, stderr) => {
                    if (error) {
                        return await sock.sendMessage(from, { text: `❌ *Update Failed:* ${error.message}` }, { quoted: msg });
                    }
                    if (stdout.includes('Already up to date')) {
                        return await sock.sendMessage(from, { text: `✅ *Bot is already up to date!*` }, { quoted: msg });
                    }

                    await sock.sendMessage(from, { text: `✅ *Update Successful!*\n\n\`\`\`${stdout}\`\`\`\n\n🔄 *Restarting bot now...*` }, { quoted: msg });
                    
                    setTimeout(() => {
                        process.exit(0);
                    }, 2000);
                });
            }

            // 5. View Once Downloader Command (.vv2)
            else if (command === 'vv2' || command === 'vv') {
                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;

                if (!quotedMsg) {
                    return await sock.sendMessage(from, { text: `⚠️ කරුණාකර View Once (One Time) ලෙස ලැබුණු Photo එකකට හෝ Video එකකට Reply කර මේ කමාන්ඩ් එක යවන්න!` }, { quoted: msg });
                }

                const viewOnceMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg;
                const imageMsg = viewOnceMsg.imageMessage;
                const videoMsg = viewOnceMsg.videoMessage;

                if (!imageMsg && !videoMsg) {
                    return await sock.sendMessage(from, { text: `⚠️ ඔබ Reply කළ Message එක View Once Photo එකක් හෝ Video එකක් නොවේ!` }, { quoted: msg });
                }

                const botOwnerJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                await sock.sendMessage(from, { text: `📥 *Downloading View Once Media...*` }, { quoted: msg });

                if (imageMsg) {
                    const stream = await downloadContentFromMessage(imageMsg, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const captionText = imageMsg.caption || 'Downloaded View Once Photo';
                    await sock.sendMessage(botOwnerJid, { image: buffer, caption: `👁️ *VIEW ONCE PHOTO DOWNLOADED*\n\n📝 *Caption:* ${captionText}` });
                    await sock.sendMessage(from, { text: `✅ View Once Photo එක Bot ගේ Inbox එකට සාර්ථකව යවන ලදී!` }, { quoted: msg });
                } 
                else if (videoMsg) {
                    const stream = await downloadContentFromMessage(videoMsg, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const captionText = videoMsg.caption || 'Downloaded View Once Video';
                    await sock.sendMessage(botOwnerJid, { video: buffer, caption: `👁️ *VIEW ONCE VIDEO DOWNLOADED*\n\n📝 *Caption:* ${captionText}` });
                    await sock.sendMessage(from, { text: `✅ View Once Video එක Bot ගේ Inbox එකට සාර්ථකව යවන ලදී!` }, { quoted: msg });
                }
            }

            // 6. Custom Reset Command (.customreset)
            else if (command === 'customreset' || command === 'reset') {
                if (!isOwner) {
                    return await sock.sendMessage(from, { text: `⚠️ *This command is restricted to the Owner only!*` }, { quoted: msg });
                }

                currentSettings = { ...defaultSettings };
                saveSettings(currentSettings);
                userState.clear();

                await sock.sendPresenceUpdate(currentSettings.botPresence);

                const resetText = `🔄 *BOT SETTINGS RESET SUCCESSFUL!*\n\n` +
                                  `All settings have been restored to default values:\n` +
                                  `• *Prefix:* [ ${currentSettings.currentPrefix} ]\n` +
                                  `• *Status:* Online 🟢\n` +
                                  `• *Work Mode:* PUBLIC 🌐\n` +
                                  `• *Auto React:* ON 🟢 (${currentSettings.ownerReactEmoji})\n\n` +
                                  `_GM GAIYA - MD_`;

                await sock.sendMessage(from, { text: resetText }, { quoted: msg });
            }

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
