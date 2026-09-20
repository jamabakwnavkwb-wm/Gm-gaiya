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

// Settings Variables
let botPresence = 'available';  // Default Online
let currentPrefix = '!';        // Current Prefix
let workMode = 'private';       // Work Mode
let autoReactEnabled = true;     // Auto React
let ownerReactEmoji = '👑';      // React Emoji
let viewOnceDownload = true;    // View Once Download Status

// GitHub Settings Variables
let githubToken = process.env.GITHUB_TOKEN || "NOT SET";
let githubRepo = process.env.GITHUB_REPO || "Gm-gaiya";

const ownerNumber = process.env.PHONE_NUMBER || "94764802314";

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
        logger: pino({ level: 'fatal' }),
        browser: Browsers.macOS('Desktop'),
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(ownerNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n=================================\n🔑 PAIRING CODE: ${code}\n=================================\n`);
            } catch (error) {
                console.log("Pairing code error:", error?.message || error);
            }
        }, 8000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                setTimeout(() => connectToWhatsApp(), 5000);
            } else if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ GM GAIYA - MD සාර්ථකව සම්බන්ධ විය!');

            await sock.sendPresenceUpdate(botPresence);

            try {
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const tokenStatus = githubToken !== "NOT SET" ? "SET 🟢" : "NOT SET 🔴";
                
                const connectedMessage = `✅ *BOT CONNECTING SUCCESSFUL*\n\n` +
                                         `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                         `⚙️ *Work Mode:* ${workMode.toUpperCase()}\n` +
                                         `• *Status:* Active 🟢\n` +
                                         `• *Prefix:* [ ${currentPrefix} ]\n` +
                                         `• *Auto React:* ${autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${ownerReactEmoji})\n` +
                                         `• *View Once Download:* ${viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                         `• *GitHub Token:* ${tokenStatus}\n` +
                                         `• *GitHub Repo:* ${githubRepo}\n\n` +
                                         `_GM GAIYA - MD is now ready to use!_`;

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

            await sock.sendPresenceUpdate(botPresence);

            // Auto React
            if (isOwner && autoReactEnabled && ownerReactEmoji) {
                try {
                    await sock.sendMessage(from, { react: { text: ownerReactEmoji, key: msg.key } });
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

            if (!isOwner) {
                if (workMode === 'private') return; 
                if (workMode === 'group' && !isGroup) return; 
                if (workMode === 'inbox' && isGroup) return;  
            }

            const currentState = userState.get(from);

            // ----------------- INTERACTIVE MENU RESPONSES ----------------- //

            if (currentState && currentState.type === 'CONFIRM_TOKEN') {
                if (textMessage === '1') {
                    githubToken = currentState.data;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *GitHub Token successfully updated & saved!* 🟢` }, { quoted: msg });
                } else if (textMessage === '2') {
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `❌ *GitHub Token update cancelled!*` }, { quoted: msg });
                }
            }

            if (currentState && currentState.type === 'CONFIRM_REPO') {
                if (textMessage === '1') {
                    githubRepo = currentState.data;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `✅ *GitHub Repo Name updated to:* [ *${githubRepo}* ] 🟢` }, { quoted: msg });
                } else if (textMessage === '2') {
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `❌ *GitHub Repo update cancelled!*` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_SETTING_CHOICE') {
                if (textMessage === '1') {
                    userState.set(from, 'AWAITING_ONLINE_CHOICE');
                    return await sock.sendMessage(from, { 
                        text: `⚙️ *ONLINE STATUS SETTINGS*\n\nReply with option:\n*1.1* - Turn ON Online Status 🟢\n*1.2* - Turn OFF Online Status 🔴` 
                    }, { quoted: msg });
                } 
                else if (textMessage === '2') {
                    userState.set(from, 'AWAITING_PREFIX_CHOICE');
                    return await sock.sendMessage(from, { 
                        text: `⚙️ *CHANGE PREFIX*\n\nCurrent: [ *${currentPrefix}* ]\nSend desired prefix symbol (e.g., # , . , !)` 
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
                    viewOnceDownload = !viewOnceDownload;
                    userState.delete(from);
                    return await sock.sendMessage(from, { text: `👁️ *View Once Downloader is now:* ${viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}` }, { quoted: msg });
                }
            }

            if (currentState === 'AWAITING_ONLINE_CHOICE') {
                if (textMessage === '1.1') botPresence = 'available';
                if (textMessage === '1.2') botPresence = 'unavailable';
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Online Status Updated!*` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_PREFIX_CHOICE') {
                currentPrefix = textMessage.trim()[0] || currentPrefix;
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Prefix set to:* [ *${currentPrefix}* ]` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_MODE_CHOICE') {
                if (textMessage === '3.1') workMode = 'private';
                if (textMessage === '3.2') workMode = 'group';
                if (textMessage === '3.3') workMode = 'inbox';
                if (textMessage === '3.4') workMode = 'public';
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Work Mode set to:* ${workMode.toUpperCase()}` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_REACT_CHOICE') {
                if (textMessage === '4.1') autoReactEnabled = true;
                if (textMessage === '4.2') autoReactEnabled = false;
                if (textMessage === '4.3') {
                    userState.set(from, 'AWAITING_EMOJI');
                    return await sock.sendMessage(from, { text: `Send the new Emoji:` }, { quoted: msg });
                }
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Auto React Updated!*` }, { quoted: msg });
            }

            if (currentState === 'AWAITING_EMOJI') {
                ownerReactEmoji = textMessage.trim();
                userState.delete(from);
                return await sock.sendMessage(from, { text: `✅ *Emoji updated to:* ${ownerReactEmoji}` }, { quoted: msg });
            }

            // ----------------- COMMANDS ----------------- //

            if (!textMessage.startsWith(currentPrefix)) return;

            const args = textMessage.slice(currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // .apply Command (For Token or Repo link)
            if (command === 'apply') {
                if (!isOwner) return;

                const inputData = args.join(' ').trim();
                if (!inputData) {
                    return await sock.sendMessage(from, { text: `⚠️ කරුණාකර `.apply <GitHub Token / Link / Repo Name>` ලෙස ලබා දෙන්න!` }, { quoted: msg });
                }

                // Check if input is GitHub Token or Link
                if (inputData.startsWith('ghp_') || inputData.includes('github.com')) {
                    const tokenValue = inputData.includes('github.com') ? inputData : inputData;
                    userState.set(from, { type: 'CONFIRM_TOKEN', data: tokenValue });

                    const menuMsg = `⚙️ *GITHUB TOKEN SETTINGS*\n\n` +
                                    `Do you want to save this Token?\n` +
                                    `🔑 *Token/Link:* \`${tokenValue.substring(0, 10)}...\`\n\n` +
                                    `Reply with option:\n` +
                                    `*1* - Save GitHub Token 🟢\n` +
                                    `*2* - Cancel 🔴`;
                    return await sock.sendMessage(from, { text: menuMsg }, { quoted: msg });
                } else {
                    // Treat as Repo Name
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

            // Setting Command
            if (command === 'setting' || command === 'settings') {
                userState.set(from, 'AWAITING_SETTING_CHOICE');

                const settingsText = `⚙️ *GM GAIYA - MD SETTINGS MENU*\n\n` +
                                     `Reply with option number:\n\n` +
                                     `*1* - Online Status Settings\n` +
                                     `*2* - Change Bot Prefix\n` +
                                     `*3* - Work Mode Settings\n` +
                                     `*4* - Auto React Settings\n` +
                                     `*5* - Toggle View Once Downloader\n\n` +
                                     `📌 *CURRENT CONFIGURATION*\n` +
                                     `• *Prefix:* [ ${currentPrefix} ]\n` +
                                     `• *Work Mode:* ${workMode.toUpperCase()}\n` +
                                     `• *Online Status:* ${botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                                     `• *Auto React:* ${autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${ownerReactEmoji})\n` +
                                     `• *View Once:* ${viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                     `• *GitHub Token:* ${githubToken !== "NOT SET" ? "SET 🟢" : "NOT SET 🔴"}\n` +
                                     `• *GitHub Repo:* ${githubRepo}`;

                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

            // Menu Command
            else if (command === 'menu' || command === 'help') {
                const menuText = `✨ *GM GAIYA - MD MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                 `⚙️ *Mode:* ${workMode.toUpperCase()}\n` +
                                 `📌 *Prefix:* [ ${currentPrefix} ]\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${currentPrefix}menu* - Display Menu\n` +
                                 `│ 🏓 *${currentPrefix}ping* - Speed Test\n` +
                                 `│ ⚙️ *${currentPrefix}setting* - Bot Settings\n` +
                                 `│ 🔑 *${currentPrefix}apply <token/repo>* - Set GitHub Config\n` +
                                 `│ 🔄 *${currentPrefix}update* - Git Update\n` +
                                 `│ 👁️ *${currentPrefix}vv2* - View Once Downloader\n` +
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
                if (!viewOnceDownload) return await sock.sendMessage(from, { text: `⚠️ View Once Downloader is disabled in Settings!` }, { quoted: msg });

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
