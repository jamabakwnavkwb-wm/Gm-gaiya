const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Message IDs සහ User States මතකයේ තබා ගැනීමට
const processedMessages = new Set();
const userState = new Map(); // Setting Menu එකේ අදියර මතක තබා ගැනීමට

let botPresence = 'available'; // Default ලෙස Online ('available' හෝ 'unavailable')

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
            console.log('✅ GM GAIYA - MD සාර්ථකව සම්බන්ධ විය!');

            // Bot Presence (Online/Offline) සකස් කිරීම
            await sock.sendPresenceUpdate(botPresence);

            try {
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const connectedMessage = `✅ *BOT CONNECTING SUCCESSFUL*\n\n` +
                                         `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                         `• *Status:* Active 🟢\n` +
                                         `• *Prefix:* [ . ]\n` +
                                         `• *Commands:* .menu , .ping , .setting\n\n` +
                                         `_GM GAIYA - MD Bot is now ready to use!_`;

                await sock.sendMessage(botJid, { text: connectedMessage });
            } catch (err) {
                console.error("Connected message යැවීමට නොහැකි විය:", err);
            }
        }
    });

    // Messages සහ Commands Handle කිරීම
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg || !msg.message) return;

            // Duplicate Message Check
            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);

            setTimeout(() => processedMessages.delete(msgId), 60000);

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

            const prefix = '.';
            const currentState = userState.get(from);

            // ----------------- SETTINGS STEP BY STEP RESPONSE ----------------- //

            // Step 2: User විසින් '1' ලබාදුන් පසු sub-menu එක ලබාදීම
            if (currentState === 'AWAITING_SETTING_CHOICE' && textMessage === '1') {
                userState.set(from, 'AWAITING_ONLINE_CHOICE');
                const onlineMenu = `⚙️ *ONLINE STATUS SETTINGS*\n\n` +
                                   `Reply with the number:\n` +
                                   `*1.1* - Turn ON Online Status 🟢\n` +
                                   `*1.2* - Turn OFF Online Status (Offline) 🔴\n\n` +
                                   `_GM GAIYA - MD_`;
                return await sock.sendMessage(from, { text: onlineMenu }, { quoted: msg });
            }

            // Step 3: '1.1' හෝ '1.2' ලබාදුන් පසු Online/Offline වෙනස් කිරීම
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

            // ----------------- MAIN COMMANDS ----------------- //

            if (!textMessage.startsWith(prefix)) return;

            const args = textMessage.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // 1. Menu Command
            if (command === 'menu' || command === 'help') {
                const menuText = `✨ *GM GAIYA - MD MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                 `📌 *Prefix:* [ ${prefix} ]\n` +
                                 `🟢 *Status:* ${botPresence === 'available' ? 'Online' : 'Offline'}\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${prefix}menu* - Display Menu\n` +
                                 `│ 🏓 *${prefix}ping* - Check Bot Speed\n` +
                                 `│ ⚙️ *${prefix}setting* - Bot Settings\n` +
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

            // 3. Setting Command (Main)
            else if (command === 'setting' || command === 'settings') {
                userState.set(from, 'AWAITING_SETTING_CHOICE');
                
                const settingsText = `⚙️ *GM GAIYA - MD SETTINGS*\n\n` +
                                     `Reply with the option number:\n\n` +
                                     `*1* - Online Status Settings\n\n` +
                                     `_Current Status: ${botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}_`;
                
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();            }

            // Step 3: '1.1' හෝ '1.2' ලබාදුන් පසු Online/Offline වෙනස් කිරීම
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

            // ----------------- MAIN COMMANDS ----------------- //

            if (!textMessage.startsWith(prefix)) return;

            const args = textMessage.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // 1. Menu Command
            if (command === 'menu' || command === 'help') {
                const menuText = `✨ *GM GAIYA - MD MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* GM GAIYA - MD\n` +
                                 `📌 *Prefix:* [ ${prefix} ]\n` +
                                 `🟢 *Status:* ${botPresence === 'available' ? 'Online' : 'Offline'}\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${prefix}menu* - Display Menu\n` +
                                 `│ 🏓 *${prefix}ping* - Check Bot Speed\n` +
                                 `│ ⚙️ *${prefix}setting* - Bot Settings\n` +
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

            // 3. Setting Command (Main)
            else if (command === 'setting' || command === 'settings') {
                userState.set(from, 'AWAITING_SETTING_CHOICE');
                
                const settingsText = `⚙️ *GM GAIYA - MD SETTINGS*\n\n` +
                                     `Reply with the option number:\n\n` +
                                     `*1* - Online Status Settings\n\n` +
                                     `_Current Status: ${botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}_`;
                
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
            // 2. Setting Command
            else if (command === 'setting' || command === 'settings') {
                const settingsText = `⚙️ *BOT SETTINGS MENU*\n\n` +
                                     `• *Bot Name:* WhatsApp Bot\n` +
                                     `• *Prefix:* [ ${prefix} ]\n` +
                                     `• *Status:* Online 🟢\n` +
                                     `• *Mode:* Public / Self\n\n` +
                                     `Use settings options to configure.`;
                
                await sock.sendMessage(from, { text: settingsText }, { quoted: msg });
            }

        } catch (error) {
            console.error("Message Processing Error:", error);
        }
    });
}

connectToWhatsApp();
