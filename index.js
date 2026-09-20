const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const PHONE_NUMBER = "94764802314"; // ඔබගේ WhatsApp අංකය

// Message IDs සහ User States මතකයේ තබා ගැනීමට
const processedMessages = new Set();
const userState = new Map();

let botPresence = 'available'; // Default Online Status
let currentPrefix = '.';       // Default Prefix

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['GM GAIYA - MD', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        // Pairing Code එක Request කිරීම (ලියාපදිංචි වී නොමැති නම් පමණි)
        if (!sock.authState.creds.registered && !sock.authState.creds.me) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(PHONE_NUMBER);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(`\n=================================\n🔑 PAIRING CODE: ${code}\n=================================\n`);
                } catch (error) {
                    console.log("Pairing code error:", error?.message || error);
                }
            }, 6000);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`සම්බන්ධතාවය බිඳ වැටුණි (${statusCode}), නැවත සම්බන්ධ වෙමින්...`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log("🔴 Session Expired වී ඇත. auth_info_baileys Delete කර නැවත ආරම්භ වේ.");
                if (fs.existsSync('auth_info_baileys')) {
                    fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                }
            }

            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
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
                                         `• *Commands:* ${currentPrefix}menu , ${currentPrefix}ping , ${currentPrefix}setting\n\n` +
                                         `_GM GAIYA - MD Bot is now ready to use!_`;

                await sock.sendMessage(botJid, { text: connectedMessage });
            } catch (err) {
                console.error("Connected message යැවීමේ දෝෂයයි:", err);
            }
        }
    });

    // Messages සහ Commands Handle කිරීම
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg || !msg.message) return;

            // ඩූප්‍ලිකේට් Messages වළක්වා ගැනීමට
            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);
            setTimeout(() => processedMessages.delete(msgId), 60000);

            const from = msg.key.remoteJid;
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

            // 1. Online Status Sub-Menu එක තෝරා ගැනීම
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '1') {
                userState.set(from, 'AWAITING_ONLINE_CHOICE');
                const onlineMenu = `⚙️ *ONLINE STATUS SETTINGS*\n\n` +
                                   `Reply with the option number:\n` +
                                   `*1.1* - Turn ON Online Status 🟢\n` +
                                   `*1.2* - Turn OFF Online Status (Offline) 🔴\n\n` +
                                   `_GM GAIYA - MD_`;
                return await sock.sendMessage(from, { text: onlineMenu }, { quoted: msg });
            }

            // 1.1 හෝ 1.2 මගින් Online/Offline සෙට් කිරීම
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

            // 2. Prefix වෙනස් කිරීමේ Sub-Menu එක තෝරා ගැනීම
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '2') {
                userState.set(from, 'AWAITING_PREFIX_CHOICE');
                const prefixMenu = `⚙️ *CHANGE BOT PREFIX*\n\n` +
                                   `Current Prefix: [ *${currentPrefix}* ]\n\n` +
                                   `Reply with the symbol you want to set as Prefix:\n` +
                                   `Supported: *.*  *,*  ***  *&*  *#*  *@*  */*  *?*  *'*  *;*  *!*\n\n` +
                                   `_Type and send the symbol directly (e.g., #)_`;
                return await sock.sendMessage(from, { text: prefixMenu }, { quoted: msg });
            }

            // නව Prefix එක Input කළ විට Update කිරීම
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

            // ----------------- MAIN COMMANDS ----------------- //

            if (!textMessage.startsWith(currentPrefix)) return;

            const args = textMessage.slice(currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // Menu Command
            if (command === 'menu' || command === 'help') {
                const menuText = `✨ *GM GAIYA - MD MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                 `📌 *Prefix:* [ ${currentPrefix} ]\n` +
                                 `🟢 *Status:* ${botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${currentPrefix}menu* - Display Menu\n` +
                                 `│ 🏓 *${currentPrefix}ping* - Check Bot Speed\n` +
                                 `│ ⚙️ *${currentPrefix}setting* - Bot Settings\n` +
                                 `└──────────────\n\n` +
                                 `_POWERED BY GM GAIYA - MD_`;

                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }

            // Ping Command
            else if (command === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
                const end = Date.now();
                const latency = end - start;
                
                await sock.sendMessage(from, { text: `🏓 *Pong!*\nSpeed: *${latency}ms*\n\n_GM GAIYA - MD_` }, { quoted: msg });
            }

            // Setting Command
            else if (command === 'setting' || command === 'settings') {
                userState.set(from, 'AWAITING_SETTING_CHOICE');
                
                const settingsText = `⚙️ *GM GAIYA - MD SETTINGS*\n\n` +
                                     `Reply with the option number:\n\n` +
                                     `*1* - Online Status Settings\n` +
                                     `*2* - Change Prefix\n\n` +
                                     `_Current Status: ${botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}_\n` +
                                     `_Current Prefix: [ ${currentPrefix} ]_`;
                
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
