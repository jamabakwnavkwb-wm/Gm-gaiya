const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    Browsers, 
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { exec } = require('child_process');

const processedMessages = new Set();
const userState = new Map();

let botPresence = 'available';  // Default Online
let currentPrefix = '.';        // Default Prefix
let workMode = 'public';        // Default Work Mode ('public', 'private', 'group', 'inbox')
let autoReactEnabled = true;     // Default Auto React Status
let ownerReactEmoji = '👑';      // Default Owner React Emoji
const ownerNumber = process.env.PHONE_NUMBER || "94764802314"; // Owner WhatsApp Number

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }), // Log spam වැළැක්වීමට
        browser: Browsers.macOS('Desktop'), // macOS browser එක යොදාගැනීමෙන් Prekey crash වළකී
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });

    // Pairing Code Request - Multi-request වැළැක්වීමට Delay එකක් සහිතව
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(ownerNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n=================================\n🔑 PAIRING CODE: ${code}\n=================================\n`);
            } catch (error) {
                console.log("Pairing code ලබා ගැනීමට නොහැකි විය:", error?.message || error);
            }
        }, 8000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.output?.payload?.message || 'Unknown';
            
            console.log(`සම්බන්ධතාවය බිඳ වැටුණි (Reason Code: ${statusCode} | ${reason})`);

            // 515 හෝ Restart Required වෙන විට Reconnect වීම
            if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                console.log("Prekey/Restart අවශ්‍යයි. තත්පර 5කින් නැවත සම්බන්ධ වේ...");
                setTimeout(() => connectToWhatsApp(), 5000);
            } else if (statusCode !== DisconnectReason.loggedOut) {
                console.log("නැවත සම්බන්ධ වෙමින් පවතී...");
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                console.log("Session එක Logged Out වී ඇත. කරුණාකර re-pair කරන්න.");
            }
        } else if (connection === 'open') {
            console.log('✅ GM GAIYA - MD සාර්ථකව සම්බන්ධ විය!');

            await sock.sendPresenceUpdate(botPresence);

            try {
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const connectedMessage = `✅ *BOT CONNECTING SUCCESSFUL*\n\n` +
                                         `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                         `• *Status:* Active 🟢\n` +
                                         `• *Prefix:* [ ${currentPrefix} ]\n` +
                                         `• *Work Mode:* ${workMode.toUpperCase()}\n` +
                                         `• *Auto React:* ${autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${ownerReactEmoji})\n` +
                                         `• *Commands:* ${currentPrefix}menu , ${currentPrefix}ping , ${currentPrefix}setting , ${currentPrefix}update , ${currentPrefix}vv2\n\n` +
                                         `_GM GAIYA - MD Bot is now ready to use!_`;

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

            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);

            setTimeout(() => processedMessages.delete(msgId), 60000);

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];
            const isOwner = senderNumber === ownerNumber || msg.key.fromMe;

            // Online Presence Status Maintain
            await sock.sendPresenceUpdate(botPresence);

            // ----------------- OWNER AUTO REACT ----------------- //
            if (isOwner && autoReactEnabled && ownerReactEmoji) {
                try {
                    await sock.sendMessage(from, {
                        react: {
                            text: ownerReactEmoji,
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

            // ----------------- WORK MODE CHECK ----------------- //
            if (!isOwner) {
                if (workMode === 'private') return; 
                if (workMode === 'group' && !isGroup) return; 
                if (workMode === 'inbox' && isGroup) return;  
            }

            const currentState = userState.get(from);

            // ----------------- INTERACTIVE SETTINGS RESPONSES ----------------- //

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
                    botPresence = 'available';
                    await sock.sendPresenceUpdate('available');
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *Online Status is now ON!* 🟢` }, { quoted: msg });
                } else if (textMessage === '1.2') {
                    botPresence = 'unavailable';
                    await sock.sendPresenceUpdate('unavailable');
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔴 *Online Status is now OFF (Offline)!*` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '2') {
                userState.set(from, 'AWAITING_PREFIX_CHOICE');
                const prefixMenu = `⚙️ *CHANGE BOT PREFIX*\n\n` +
                                   `Current Prefix: [ *${currentPrefix}* ]\n\n` +
                                   `Reply with the symbol you want to set as Prefix:\n` +
                                   `Supported: *.*  *,*  ***  *&*  *#*  *@*  */*  *?*  *'*  *;*  *!*\n\n` +
                                   `_Type and send the symbol directly (e.g., #)_`;
                return await sock.sendMessage(from, { text: prefixMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_PREFIX_CHOICE') {
                const allowedPrefixes = ['.', ',', '*', '&', '#', '@', '/', '?', "'", ';', '!'];
                if (allowedPrefixes.includes(textMessage)) {
                    currentPrefix = textMessage;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *Prefix successfully changed to:* [ *${currentPrefix}* ]` }, { quoted: msg });
                } else {
                    return await sock.sendMessage(from, { text: `⚠️ Invalid prefix! Please choose from: . , * & # @ / ? ' ; !` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '3') {
                userState.set(from, 'AWAITING_MODE_CHOICE');
                const modeMenu = `⚙️ *WORK MODE SETTINGS*\n\n` +
                                 `Reply with the option number:\n` +
                                 `*3.1* - Private Mode 🔒 (Only Owner)\n` +
                                 `*3.2* - Group Only Mode 👥 (Groups Only)\n` +
                                 `*3.3* - Inbox Only Mode 📥 (Inbox Only)\n` +
                                 `*3.4* - Public Mode 🌐 (All - Group & Inbox)\n\n` +
                                 `_Current Mode: ${workMode.toUpperCase()}_`;
                return await sock.sendMessage(from, { text: modeMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_MODE_CHOICE') {
                if (textMessage === '3.1') {
                    workMode = 'private';
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔒 *Work Mode set to PRIVATE!*` }, { quoted: msg });
                } else if (textMessage === '3.2') {
                    workMode = 'group';
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `👥 *Work Mode set to GROUP ONLY!*` }, { quoted: msg });
                } else if (textMessage === '3.3') {
                    workMode = 'inbox';
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `📥 *Work Mode set to INBOX ONLY!*` }, { quoted: msg });
                } else if (textMessage === '3.4') {
                    workMode = 'public';
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🌐 *Work Mode set to PUBLIC!*` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '4') {
                userState.set(from, 'AWAITING_REACT_SETTINGS_CHOICE');
                const reactMenu = `⚙️ *OWNER AUTO REACT SETTINGS*\n\n` +
                                  `Reply with the option number:\n` +
                                  `*4.1* - Turn ON Auto React 🟢\n` +
                                  `*4.2* - Turn OFF Auto React 🔴\n` +
                                  `*4.3* - Change React Emoji 👑\n\n` +
                                  `_Current Status: ${autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'}_ (${ownerReactEmoji})`;
                return await sock.sendMessage(from, { text: reactMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_REACT_SETTINGS_CHOICE') {
                if (textMessage === '4.1') {
                    autoReactEnabled = true;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🟢 *Owner Auto React is now turned ON!* (${ownerReactEmoji})` }, { quoted: msg });
                } else if (textMessage === '4.2') {
                    autoReactEnabled = false;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔴 *Owner Auto React is now turned OFF!*` }, { quoted: msg });
                } else if (textMessage === '4.3') {
                    userState.set(from, 'AWAITING_EMOJI_CHOICE');
                    const emojiMenu = `⚙️ *CHANGE OWNER AUTO REACT EMOJI*\n\n` +
                                      `Current React Emoji: ${ownerReactEmoji}\n\n` +
                                      `_Please send the new Emoji you want to set as Auto React (e.g., 👑, ❤️, 🔥, ⚡)_`;
                    return await sock.sendMessage(from, { text: emojiMenu }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_EMOJI_CHOICE') {
                ownerReactEmoji = textMessage.trim();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Auto React Emoji changed to:* ${ownerReactEmoji}` }, { quoted: msg });
            }

            // ----------------- MAIN COMMANDS ----------------- //

            if (!textMessage.startsWith(currentPrefix)) return;

            const args = textMessage.slice(currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // 1. Menu Command
            if (command === 'menu' || command === 'help') {
                const menuText = `✨ *GM GAIYA - MD MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                 `📌 *Prefix:* [ ${currentPrefix} ]\n` +
                                 `🟢 *Status:* ${botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                 `⚙️ *Mode:* ${workMode.toUpperCase()}\n` +
                                 `👑 *Auto React:* ${autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${ownerReactEmoji})\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${currentPrefix}menu* - Display Menu\n` +
                                 `│ 🏓 *${currentPrefix}ping* - Check Bot Speed\n` +
                                 `│ ⚙️ *${currentPrefix}setting* - Bot Settings\n` +
                                 `│ 🔄 *${currentPrefix}update* - Update Bot from GitHub\n` +
                                 `│ 👁️ *${currentPrefix}vv2* - Download View Once Media\n` +
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
                                     `_Current Status: ${botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}_\n` +
                                     `_Current Prefix: [ ${currentPrefix} ]_\n` +
                                     `_Current Mode: ${workMode.toUpperCase()}_\n` +
                                     `_Current Auto React: ${autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${ownerReactEmoji})_`;
                
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

            // 4. Update Command (Git Pull)
            else if (command === 'update') {
                if (!isOwner) {
                    return await sock.sendMessage(from, { text: `⚠️ *This command is restricted to the Owner only!*` }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `🔄 *Checking for updates from GitHub...*` }, { quoted: msg });

                exec('git pull', async (error, stdout) => {
                    if (error) {
                        return await sock.sendMessage(from, { text: `❌ *Update Failed:* ${error.message}` }, { quoted: msg });
                    }
                    if (stdout.includes('Already up to date')) {
                        return await sock.sendMessage(from, { text: `✅ *Bot is already up to date!*` }, { quoted: msg });
                    }

                    await sock.sendMessage(from, { text: `✅ *Update Successful!*\n\n\`\`\`${stdout}\`\`\`\n\n🔄 *Restarting bot now...*` }, { quoted: msg });
                    
                    setTimeout(() => process.exit(0), 2000);
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

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
