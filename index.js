const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');

// 1. ඔබගේ WhatsApp දුරකථන අංකය මෙතැනට ඇතුළත් කරන්න (Country code එක සමඟ, + ලකුණ නැතිව)
const phoneNumber = "94764802314"; // උදා: 94771234567

let botSettings = {
    botName: 'GM gaiya md',
    prefix: '.'
};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Pair Code භාවිතා කරන බැවින් QR code එක off කර ඇත
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"] // Pair code ලබා ගැනීමට browser info අවශ්‍ය වේ
    });

    // Pair Code එක ලබා ගැනීමේ කොටස
    if (!sock.authState.creds.registered) {
        console.log(`\n සූදානම් වෙමින් පවතී... (${phoneNumber})`);
        await delay(3000); // Connection එක setup වන තෙක් තත්පර 3ක් රැඳී සිටී
        
        try {
            const code = await sock.requestPairingCode(phoneNumber.trim());
            console.log(`\n====================================`);
            console.log(` OBA GE PAIRING CODE EKA:  ${code} `);
            console.log(`====================================\n`);
            console.log(`1. WhatsApp ඇප් එක open කරන්න.`);
            console.log(`2. Settings -> Linked Devices -> Link a Device වෙත යන්න.`);
            console.log(`3. "Link with phone number instead" ක්ලික් කර ඉහත Code එක ඇතුළත් කරන්න.\n`);
        } catch (error) {
            console.error(" Pair Code එක ලබා ගැනීමට නොහැකි විය:", error);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(`\n ${botSettings.botName} සාර්ථකව සම්බන්ධ විය!`);
        }
    });

    // Commands Handling
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        if (!body.startsWith(botSettings.prefix)) return;

        const args = body.slice(botSettings.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // 1. .ping Command
        if (command === 'ping') {
            const start = Date.now();
            await sock.sendMessage(from, { text: 'Testing speed...' }, { quoted: msg });
            const end = Date.now();
            await sock.sendMessage(from, { text: ` Pong! Speed: ${end - start}ms` }, { quoted: msg });
        }

        // 2. .apply Command
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
                    text: ` අසාර්ථකයි! නිවැරදි භාවිතය:\n\n*Prefix:* ${botSettings.prefix}apply prefix [නව Prefix]\n*නම:* ${botSettings.prefix}apply name [නව නම]` 
                }, { quoted: msg });
            }
        }

        // 3. .setting Command
        else if (command === 'setting' || command === 'settings') {
            const settingsText = `⚙️ *${botSettings.botName} - SETTINGS*

🤖 *Bot Name:* ${botSettings.botName}
🔣 *Current Prefix:* ${botSettings.prefix}`;

            await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
        }
    });
}

startBot();
