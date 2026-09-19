const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Bot ගේ මූලික සැකසුම් (Default Settings)
let botSettings = {
    botName: 'GM gaiya md', // ඔබ ලබාදුන් නම මෙහි සටහන් කර ඇත
    prefix: '.'            // Default prefix එක . වේ
};

async function startBot() {
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
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(`${botSettings.botName} සාර්ථකව සම්බන්ධ විය!`);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        // Prefix එකෙන් පටන් ගන්නේ නැත්නම් Ignore කරන්න
        if (!body.startsWith(botSettings.prefix)) return;

        // Command එක සහ Argument වෙන් කර ගැනීම
        const args = body.slice(botSettings.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // 1. .ping Command
        if (command === 'ping') {
            const start = Date.now();
            await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
            const end = Date.now();
            await sock.sendMessage(from, { text: ` Pong! Speed: ${end - start}ms` }, { quoted: msg });
        }

        // 2. .apply Command (Bot Name හෝ Prefix වෙනස් කිරීම)
        else if (command === 'apply') {
            const type = args[0]?.toLowerCase();
            const value = args.slice(1).join(' ');

            if (type === 'prefix' && value) {
                botSettings.prefix = value;
                await sock.sendMessage(from, { text: ` Prefix එක සාර්ථකව \`${value}\` ලෙස වෙනස් කරන ලදී!` }, { quoted: msg });
            } else if (type === 'name' && value) {
                botSettings.botName = value;
                await sock.sendMessage(from, { text: ` Bot ගේ නම සාර්ථකව *${value}* ලෙස වෙනස් කරන ලදී!` }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { 
                    text: ` අසාර්ථකයි! නිවැරදි භාවිතය:\n\n*Prefix වෙනස් කිරීමට:* ${botSettings.prefix}apply prefix [නව Prefix එක]\n*නම වෙනස් කිරීමට:* ${botSettings.prefix}apply name [නව නම]` 
                }, { quoted: msg });
            }
        }

        // 3. .setting Command (වත්මන් සැකසුම් පෙන්වීම)
        else if (command === 'setting' || command === 'settings') {
            const settingsText = `⚙️ *${botSettings.botName} - SETTINGS*

🤖 *Bot Name:* ${botSettings.botName}
🔣 *Current Prefix:* ${botSettings.prefix}

*Prefix/Name වෙනස් කරන්නේ කෙසේද?*
• Prefix වෙනස් කිරීමට: \`${botSettings.prefix}apply prefix #\`
• නම වෙනස් කිරීමට: \`${botSettings.prefix}apply name GM gaiya md\``;

            await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
        }
    });
}

startBot();
