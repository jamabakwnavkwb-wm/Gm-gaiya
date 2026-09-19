const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('සම්බන්ධතාවය බිඳ වැටුණි, නැවත සම්බන්ධ වෙමින්...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Bot සාර්ථකව සම්බන්ධ විය!');
        }
    });

    // Messages Handle කිරීම
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const textMessage = msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || '';

        // Prefix එක (. හෝ !)
        const prefix = '.';
        if (!textMessage.startsWith(prefix)) return;

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
        else if (command === 'setting') {
            const settingsText = `⚙️ *Bot Settings Menu*\n\n` +
                                 `• *Prefix:* [ ${prefix} ]\n` +
                                 `• *Status:* Active\n` +
                                 `• *Mode:* Public\n\n` +
                                 `වෙනස්කම් කිරීමට පහත විධානයන් භාවිතා කරන්න.`;
            
            await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
        }

        // 3. නව Command එකක් එකතු කිරීමට (Example)
        /*
        else if (command === 'menu') {
            await sock.sendMessage(from, { text: 'ඔබගේ Menu එක මෙතැනට ඇතුළත් කරන්න' }, { quoted: msg });
        }
        */

    });
}

connectToWhatsApp();
