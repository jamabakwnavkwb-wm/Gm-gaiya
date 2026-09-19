const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    // Pairing Code ලබා ගැනීම (පළමු වරට පමණි)
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94764802314"; // ඔබගේ WhatsApp අංකය
        
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n=================================\n🔑 ඔබගේ Pairing Code එක: ${code}\n=================================\n`);
            } catch (error) {
                console.log("Pairing code ලබා ගැනීමට නොහැකි විය: ", error);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    // Connection Status
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('සම්බන්ධතාවය බිඳ වැටුණි, නැවත සම්බන්ධ වෙමින්...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot සාර්ථකව සම්බන්ධ විය!');

            // ----------------- BOT CONNECTED MESSAGE ----------------- //
            try {
                // Bot ගේම WhatsApp ID (JID) එක ලබා ගැනීම
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                
                const connectedMessage = `✅ *WhatsApp Bot Connected Successfully!*\n\n` +
                                         `• *Status:* Active 🟢\n` +
                                         `• *Prefix:* [ . ]\n` +
                                         `• *Commands:* .ping , .setting\n\n` +
                                         `_Bot එක සාර්ථකව සම්බන්ධ විය!_`;

                // තමන්ගේම Inbox එකට Message එක යැවීම
                await sock.sendMessage(botJid, { text: connectedMessage });
            } catch (err) {
                console.error("Connected message යැවීමට නොහැකි විය:", err);
            }
            // --------------------------------------------------------- //
        }
    });

    // Messages සහ Commands Handle කිරීම
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            const msg = messages[0];
            if (!msg || !msg.message) return;

            const from = msg.key.remoteJid;

            // Text Message එක ලබාගැනීම
            const textMessage = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                ''
            ).trim();

            if (!textMessage) return;

            // Prefix එක (. හෝ !)
            const prefix = '.';
            if (!textMessage.startsWith(prefix)) return;

            // Command එක වෙන් කරගැනීම
            const args = textMessage.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // ----------------- COMMANDS ----------------- //

            // 1. Ping Command
            if (command === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
                const end = Date.now();
                const latency = end - start;
                
                await sock.sendMessage(from, { text: `🏓 *Pong!*\nSpeed: *${latency}ms*` }, { quoted: msg });
            }

            // 2. Setting Command
            else if (command === 'setting' || command === 'settings') {
                const settingsText = `⚙️ *BOT SETTINGS MENU*\n\n` +
                                     `• *Bot Name:* WhatsApp Bot\n` +
                                     `• *Prefix:* [ ${prefix} ]\n` +
                                     `• *Status:* Online 🟢\n` +
                                     `• *Mode:* Public / Self\n\n` +
                                     `වෙනස්කම් කිරීමට අදාළ Settings භාවිතා කරන්න.`;
                
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
