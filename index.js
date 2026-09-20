const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const PHONE_NUMBER = process.env.PHONE_NUMBER || "94764802314";

const processedMessages = new Set();
const userState = new Map();

// Bot Settings Variables
let botPresence = 'available';
let currentPrefix = '.';
let autoReactEnabled = true;       // Owner Auto React Status
let ownerReactEmoji = '👑';        // Auto React Emoji
let autoViewOnce = true;           // View Once Status
let pairingRequested = false;      // Pairing Code එක එක පාරක් පමණක් Request කිරීමට

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        retryRequestOptions: {
            maxRetries: 5
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        // Pairing Code එක හරියටම එක පාරක් පමණක් ලබාදීමට
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
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`සම්බන්ධතාවය බිඳ වැටුණි (Reason: ${statusCode})`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log("🔴 Session Expired වී ඇත. auth_info_baileys Delete කර නැවත ආරම්භ වේ.");
                pairingRequested = false;
                if (fs.existsSync('auth_info_baileys')) {
                    fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                }
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ GM GAIYA - MD සාර්ථකව සම්බන්ධ විය!');
            pairingRequested = false;

            await sock.sendPresenceUpdate(botPresence);

            try {
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const connectedMessage = `✅ *BOT CONNECTING SUCCESSFUL*\n\n` +
                                         `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                         `• *Status:* Active 🟢\n` +
                                         `• *Prefix:* [ ${currentPrefix} ]\n` +
                                         `• *Auto React:* ${autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${ownerReactEmoji})\n` +
                                         `• *View Once Download:* ${autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                         `• *Commands:* ${currentPrefix}menu , ${currentPrefix}ping , ${currentPrefix}setting , ${currentPrefix}vv2\n\n` +
                                         `_GM GAIYA - MD Bot is now ready to use!_`;

                await sock.sendMessage(botJid, { text: connectedMessage });
            } catch (err) {
                console.error("Connected message error:", err);
            }
        }
    });

    // Messages සහ Commands Handle කිරීම
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg || !msg.message) return;

            // Message Duplication Prevention
            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);
            setTimeout(() => processedMessages.delete(msgId), 60000);

            const from = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];
            const isOwner = senderNumber === PHONE_NUMBER || msg.key.fromMe;

            // 👑 Owner Auto React Feature
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

            const currentState = userState.get(from);

            // ----------------- INTERACTIVE SETTINGS RESPONSES ----------------- //

            // 1. Online Status Sub-Menu
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '1') {
                userState.set(from, 'AWAITING_ONLINE_CHOICE');
                const onlineMenu = `⚙️ *ONLINE STATUS SETTINGS*\n\n` +
                                   `Reply with option number:\n` +
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

            // 2. Change Prefix Sub-Menu
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '2') {
                userState.set(from, 'AWAITING_PREFIX_CHOICE');
                const prefixMenu = `⚙️ *CHANGE BOT PREFIX*\n\n` +
                                   `Current Prefix: [ *${currentPrefix}* ]\n\n` +
                                   `Reply with symbol: *.*  *,*  ***  *&*  *#*  *@*  */*  *?*  *'*  *;*  *!*`;
                return await sock.sendMessage(from, { text: prefixMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_PREFIX_CHOICE') {
                const allowedPrefixes = ['.', ',', '*', '&', '#', '@', '/', '?', "'", ';', '!'];
                if (allowedPrefixes.includes(textMessage)) {
                    currentPrefix = textMessage;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *Prefix successfully changed to:* [ *${currentPrefix}* ]` }, { quoted: msg });
                } else {
                    return await sock.sendMessage(from, { text: `⚠️ Invalid prefix! Choose from: . , * & # @ / ? ' ; !` }, { quoted: msg });
                }
            }

            // 3. Auto React Sub-Menu
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '3') {
                userState.set(from, 'AWAITING_REACT_CHOICE');
                const reactMenu = `⚙️ *AUTO REACT SETTINGS*\n\n` +
                                  `Reply with option number:\n` +
                                  `*3.1* - Turn ON Auto React 🟢\n` +
                                  `*3.2* - Turn OFF Auto React 🔴\n` +
                                  `*3.3* - Change React Emoji (Current: ${ownerReactEmoji})`;
                return await sock.sendMessage(from, { text: reactMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_REACT_CHOICE') {
                if (textMessage === '3.1') {
                    autoReactEnabled = true;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🟢 *Auto React is now ON!* (${ownerReactEmoji})` }, { quoted: msg });
                } else if (textMessage === '3.2') {
                    autoReactEnabled = false;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔴 *Auto React is now OFF!*` }, { quoted: msg });
                } else if (textMessage === '3.3') {
                    userState.set(from, 'AWAITING_EMOJI_INPUT');
                    return await sock.sendMessage(from, { text: `_Please send the new Emoji you want for Auto React (e.g. 👑, ❤️, 🔥)_` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_EMOJI_INPUT') {
                ownerReactEmoji = textMessage.trim();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Auto React Emoji changed to:* ${ownerReactEmoji}` }, { quoted: msg });
            }

            // 4. View Once Sub-Menu
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '4') {
                userState.set(from, 'AWAITING_VO_CHOICE');
                const voMenu = `👁️ *VIEW ONCE SETTINGS*\n\n` +
                               `Reply with option number:\n` +
                               `*4.1* - Enable View Once Command 🟢\n` +
                               `*4.2* - Disable View Once Command 🔴\n\n` +
                               `_Current Status: ${autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}_`;
                return await sock.sendMessage(from, { text: voMenu }, { quoted: msg });
            }

            if (currentState === 'AWAITING_VO_CHOICE') {
                if (textMessage === '4.1') {
                    autoViewOnce = true;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🟢 *View Once Command Enabled!*` }, { quoted: msg });
                } else if (textMessage === '4.2') {
                    autoViewOnce = false;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `🔴 *View Once Command Disabled!*` }, { quoted: msg });
                }
            }

            // ----------------- MAIN COMMANDS ----------------- //

            if (!textMessage.startsWith(currentPrefix)) return;

            const args = textMessage.slice(currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // Menu Command
            if (command === 'menu' || command === 'help') {
                const menuText = `✨ *GM GAIYA - MD MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                 `📌 *Prefix:* [ ${currentPrefix} ]\n` +
                                 `🟢 *Status:* ${botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                 `👑 *Auto React:* ${autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${ownerReactEmoji})\n` +
                                 `👁️ *View Once:* ${autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${currentPrefix}menu* - Display Menu\n` +
                                 `│ 🏓 *${currentPrefix}ping* - Check Speed\n` +
                                 `│ ⚙️ *${currentPrefix}setting* - Settings\n` +
                                 `│ 👁️ *${currentPrefix}vv2* - View Once Downloader\n` +
                                 `└──────────────\n\n` +
                                 `_POWERED BY GM GAIYA - MD_`;

                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            } 
            
            // Ping Command
            else if (command === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
                const end = Date.now();
                await sock.sendMessage(from, { text: `🏓 *Pong!*\nSpeed: *${end - start}ms*\n\n_GM GAIYA - MD_` }, { quoted: msg });
            } 
            
            // Setting Command
            else if (command === 'setting' || command === 'settings') {
                userState.set(from, 'AWAITING_SETTING_CHOICE');
                const settingsText = `⚙️ *GM GAIYA - MD SETTINGS*\n\n` +
                                     `Reply with option number:\n\n` +
                                     `*1* - Online Status Settings\n` +
                                     `*2* - Change Prefix\n` +
                                     `*3* - Auto React Settings 👑\n` +
                                     `*4* - View Once Settings 👁️\n\n` +
                                     `_Current Status: ${botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}_\n` +
                                     `_Current Prefix: [ ${currentPrefix} ]_\n` +
                                     `_Auto React: ${autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${ownerReactEmoji})_\n` +
                                     `_View Once: ${autoViewOnce ? 'ON 🟢' : 'OFF 🔴'}_`;
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

            // View Once Downloader Command (`.vv2` හෝ `.vv`)
            else if (command === 'vv2' || command === 'vv') {
                if (!autoViewOnce) {
                    return await sock.sendMessage(from, { text: `⚠️ View Once feature එක Settings වලින් OFF කර ඇත!` }, { quoted: msg });
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
                    
                    await sock.sendMessage(botOwnerJid, { image: buffer, caption: `👁️ *VIEW ONCE PHOTO DOWNLOADED*\n\n_From: ${from}_` });
                    await sock.sendMessage(from, { text: `✅ View Once Photo එක Download කර Inbox එකට යවන ලදී!` }, { quoted: msg });
                } else if (videoMsg) {
                    const stream = await downloadContentFromMessage(videoMsg, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    await sock.sendMessage(botOwnerJid, { video: buffer, caption: `👁️ *VIEW ONCE VIDEO DOWNLOADED*\n\n_From: ${from}_` });
                    await sock.sendMessage(from, { text: `✅ View Once Video එක Download කර Inbox එකට යවන ලදී!` }, { quoted: msg });
                }
            }

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
