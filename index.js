const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage,
    makeInMemoryStore,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const https = require('https');

// 🌐 Keep-Alive Server (Prevents hosting shutdown)
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('GM GAIYA - MD Bot is Running 24/7 Successfully!\n');
}).listen(PORT, () => {
    console.log(`🌐 Keep-Alive Server running on port ${PORT}`);
});

// Cache Setup for Retry Counters
let NodeCache;
let msgRetryCounterCache;
try {
    NodeCache = require('node-cache');
    msgRetryCounterCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });
} catch (e) {
    msgRetryCounterCache = new Map();
}

// Global Crash Prevention Handlers (Keep Process Alive & Prevent Sudden Stop)
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception Prevented:', err?.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection Prevented:', reason?.message || reason);
});

const rawPhoneNumber = process.env.PHONE_NUMBER || "94764802314";
const PHONE_NUMBER = rawPhoneNumber.replace(/[^0-9]/g, '');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// Store Initialization
let store;
try {
    store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
    store.readFromFile('./baileys_store_multi.json');
    setInterval(() => {
        try {
            store.writeToFile('./baileys_store_multi.json');
        } catch (e) {}
    }, 10000);
} catch (e) {
    console.log("Store initialization skipped.");
}

// Bot Configuration State
let config = {
    botName: 'GM GAIYA - MD',
    botPresence: 'available',
    currentPrefix: ':',
    workMode: 'public', 
    
    ownerAutoReactEnabled: true,
    ownerReactEmojis: ['👑', '❤️'],

    autoReactEnabled: false,
    autoReactTarget: 'public', 
    
    customReactEnabled: false,
    customReactTarget: 'public', 
    customEmojis: ['❤️', '👑', '♥️'],
    
    viewOnceDownload: true,
    githubToken: process.env.GITHUB_TOKEN || "NOT SET",
    githubRepo: process.env.GITHUB_REPO || "ometh230/Gm-gaiya"
};

function loadSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const loadedData = JSON.parse(data);
            if (loadedData.ownerReactEmoji && !loadedData.ownerReactEmojis) {
                loadedData.ownerReactEmojis = loadedData.ownerReactEmoji.split(',').map(e => e.trim());
            }
            config = { ...config, ...loadedData };
        } catch (e) {
            console.error("Settings load error:", e);
        }
    }
}

async function syncToGitHub(filePath, content, commitMessage) {
    if (!config.githubToken || config.githubToken === "NOT SET" || !config.githubRepo) return;
    try {
        const repo = config.githubRepo.replace('https://github.com/', '').replace('.git', '');
        const filename = path.basename(filePath);
        const encodedContent = Buffer.from(content).toString('base64');

        const options = {
            hostname: 'api.github.com',
            path: `/repos/${repo}/contents/${filename}`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Authorization': `token ${config.githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let sha = '';
                if (res.statusCode === 200) {
                    const parsed = JSON.parse(data);
                    sha = parsed.sha;
                }

                const putData = JSON.stringify({
                    message: commitMessage || `Auto Update ${filename}`,
                    content: encodedContent,
                    sha: sha || undefined
                });

                const putOptions = {
                    hostname: 'api.github.com',
                    path: `/repos/${repo}/contents/${filename}`,
                    method: 'PUT',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'Authorization': `token ${config.githubToken}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(putData)
                    }
                };

                const putReq = https.request(putOptions, (pRes) => {
                    if (pRes.statusCode === 200 || pRes.statusCode === 201) {
                        console.log(`✅ GitHub Sync Success: ${filename}`);
                    }
                });
                putReq.write(putData);
                putReq.end();
            });
        });
        req.on('error', (e) => console.error("GitHub Sync error:", e.message));
        req.end();
    } catch (e) {
        console.error("GitHub Sync Exception:", e);
    }
}

function saveSettings() {
    try {
        const settingsJson = JSON.stringify(config, null, 2);
        fs.writeFileSync(SETTINGS_FILE, settingsJson);
        syncToGitHub(SETTINGS_FILE, settingsJson, 'Update Bot Settings via Whatsapp Command');
    } catch (e) {
        console.error("Settings save error:", e);
    }
}

loadSettings();

const processedMessages = new Set();
const userState = new Map();
let isPairingRequested = false;
let sock = null;
let ownerEmojiIndex = 0;

// HTTP Helper Function
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
            }
        };
        const req = https.get(url, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', err => reject(err));
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error("Timeout"));
        });
    });
}

// 🎬 Fixed Movie Scraper Logic
async function searchCinesubz(query) {
    try {
        const url = `https://cinesubz.co/?s=${encodeURIComponent(query)}`;
        const html = await fetchUrl(url);
        const results = [];

        const linkRegex = /<a[^>]+href="(https:\/\/cinesubz\.co\/movies\/[^"]+)"[^>]*>(.*?)<\/a>/gi;
        const altLinkRegex = /href="(https:\/\/cinesubz\.co\/[^\/]+\/)"[^>]*title="([^"]+)"/gi;
        
        let match;
        const seen = new Set();

        while ((match = linkRegex.exec(html)) !== null) {
            const link = match[1];
            let title = match[2].replace(/<[^>]+>/g, '').trim();

            if (title && !seen.has(link)) {
                seen.add(link);
                results.push({ title, link });
            }
        }

        if (results.length === 0) {
            while ((match = altLinkRegex.exec(html)) !== null) {
                const link = match[1];
                let title = match[2].trim();

                if (title && !seen.has(link) && !link.includes('/category/') && !link.includes('/tag/')) {
                    seen.add(link);
                    results.push({ title, link });
                }
            }
        }

        return results.slice(0, 10);
    } catch (e) {
        console.error("Movie Search Error:", e);
        return [];
    }
}

async function getMovieDetails(movieUrl) {
    try {
        const html = await fetchUrl(movieUrl);

        let titleMatch = html.match(/<h1[^>]*class="entry-title"[^>]*>(.*?)<\/h1>/i) || html.match(/<h1[^>]*>(.*?)<\/h1>/i);
        let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Movie Details';

        let imgMatch = html.match(/<div class="poster"[^>]*>\s*<img[^>]+src="([^"]+)"/i) || html.match(/<img[^>]+src="(https:\/\/[^"]+\.(?:jpg|jpeg|png))"[^>]*>/i);
        let img = imgMatch ? imgMatch[1] : '';

        const downloadLinks = [];
        const linkRegex = /href="(https:\/\/[^"]*(?:pixeldrain|mega|drive|direct|download|file)[^"]*)"/gi;
        let lMatch;
        let idx = 1;
        const seenLinks = new Set();

        while ((lMatch = linkRegex.exec(html)) !== null) {
            const dLink = lMatch[1];
            if (!seenLinks.has(dLink) && !dLink.includes('cinesubz.co')) {
                seenLinks.add(dLink);
                let quality = dLink.includes('720p') ? '720p HD' : dLink.includes('1080p') ? '1080p FHD' : dLink.includes('480p') ? '480p SD' : `Download Link ${idx}`;
                downloadLinks.push({ name: `${quality}`, url: dLink });
                idx++;
            }
        }

        return { title, img, downloadLinks };
    } catch (e) {
        console.error("Movie Detail Error:", e);
        return null;
    }
}

// Connection Setup & Auto-Reconnect Keep-Alive Loop
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    let version;
    try {
        const fetched = await fetchLatestBaileysVersion();
        version = fetched.version;
    } catch (e) {
        version = [2, 3000, 1015901307];
    }

    const logger = pino({ level: 'silent' });

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        browser: Browsers.ubuntu("Chrome"),
        generateHighQualityLinkPreview: true,
        
        syncFullHistory: false,
        fireInitQueries: false,
        shouldSyncHistoryMessage: () => false,
        emitOwnEvents: true, 
        markOnlineOnConnect: config.botPresence === 'available',
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 500,
        msgRetryCounterCache,
        cachedGroupMetadata: async (jid) => store?.groupMetadata?.[jid],

        getMessage: async (key) => {
            if (store) {
                try {
                    const msg = await store.loadMessage(key.remoteJid, key.id);
                    return msg?.message || undefined;
                } catch (e) { return undefined; }
            }
            return { conversation: '' };
        }
    });

    if (store) store.bind(sock.ev);

    // Auto Reconnect Handler (Automatic Recovery on Restart/Offline)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (!sock.authState.creds.registered && !isPairingRequested) {
            isPairingRequested = true;
            setTimeout(async () => {
                try {
                    console.log(`\n⏳ Requesting Pairing Code for: +${PHONE_NUMBER}...`);
                    let code = await sock.requestPairingCode(PHONE_NUMBER);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(`\n=================================\n🔑 PAIRING CODE: ${code}\n=================================\n`);
                } catch (error) {
                    isPairingRequested = false;
                }
            }, 5000);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            isPairingRequested = false;
            console.log(`⚠️ Connection closed (Status: ${statusCode}). Reconnecting in 3 seconds...`);
            
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                console.log("❌ Session Logged Out. Clearing old session to restart...");
                try {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                } catch (e) {}
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === 'open') {
            console.log(`✅ ${config.botName} - Connected Successfully & 24/7 Active!`);
            isPairingRequested = false;

            try {
                await sock.sendPresenceUpdate(config.botPresence);
                const ownerJid = `${PHONE_NUMBER}@s.whatsapp.net`;
                await sock.sendMessage(ownerJid, {
                    text: `🟢 *${config.botName} Connected Successfully! (24/7 Active)*\n\n` +
                          `🤖 Status: ${config.botPresence === 'available' ? 'Online 🟢' : 'Offline 🔴'}\n` +
                          `📁 Repo: ${config.githubRepo}`
                }).catch(() => {});
            } catch (e) {}
        }
    });

    sock.ev.on('creds.update', saveCreds);

    async function safeReact(from, emoji, key) {
        if (!emoji || !key || !sock) return;
        await sock.sendMessage(from, { react: { text: emoji, key: key } }).catch(() => {});
    }

    // Message Upsert Logic
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return; 

            const msg = messages[0];
            if (!msg || !msg.key) return;

            if (!msg.message || Object.keys(msg.message).length === 0 || msg.message.reactionMessage || msg.message.protocolMessage) return;

            const msgId = msg.key.id;
            if (processedMessages.has(msgId)) return;
            processedMessages.add(msgId);
            
            if (processedMessages.size > 3000) {
                processedMessages.clear();
            } else {
                setTimeout(() => processedMessages.delete(msgId), 30000);
            }

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;

            const isGroup = from.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];
            const isOwner = senderNumber === PHONE_NUMBER || msg.key.fromMe;

            const textMessage = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                ''
            ).trim();

            const isSelfChat = (from === `${PHONE_NUMBER}@s.whatsapp.net`) || msg.key.fromMe;
            const sendOptions = isSelfChat ? {} : { quoted: msg };

            // Owner Auto React
            if (isOwner && config.ownerAutoReactEnabled && config.ownerReactEmojis?.length > 0) {
                const isBotGeneratedText = textMessage.includes('MAIN MENU') || 
                                           textMessage.includes('SETTINGS MENU') || 
                                           textMessage.includes('Pong!') || 
                                           textMessage.includes('Connected Successfully');

                if (!isBotGeneratedText) {
                    const currentOwnerEmoji = config.ownerReactEmojis[ownerEmojiIndex % config.ownerReactEmojis.length];
                    ownerEmojiIndex++;
                    safeReact(from, currentOwnerEmoji, msg.key);
                }
            }

            // Public Auto React
            if (!isOwner) {
                if (config.autoReactEnabled) {
                    const isTargetMatched = 
                        (config.autoReactTarget === 'public') ||
                        (config.autoReactTarget === 'group' && isGroup) ||
                        (config.autoReactTarget === 'inbox' && !isGroup);

                    if (isTargetMatched) {
                        const fallbackEmoji = config.ownerReactEmojis[0] || '👑';
                        safeReact(from, fallbackEmoji, msg.key);
                    }
                }

                if (config.customReactEnabled && config.customEmojis?.length > 0) {
                    const isCustomTargetMatched = 
                        (config.customReactTarget === 'public') ||
                        (config.customReactTarget === 'group' && isGroup) ||
                        (config.customReactTarget === 'inbox' && !isGroup);

                    if (isCustomTargetMatched) {
                        const randomEmoji = config.customEmojis[Math.floor(Math.random() * config.customEmojis.length)];
                        safeReact(from, randomEmoji, msg.key);
                    }
                }
            }

            if (!textMessage) return;

            if (!isOwner) {
                if (config.workMode === 'private') return; 
                if (config.workMode === 'inbox' && isGroup) return; 
                if (config.workMode === 'group' && !isGroup) return; 
            }

            const currentState = userState.get(from);

            // 🎬 MOVIE SELECTION & DETAILS CARD HANDLER
            if (currentState && typeof currentState === 'object' && currentState.type === 'MOVIE_SEARCH_LIST') {
                const choice = parseInt(textMessage.trim());
                if (!isNaN(choice) && choice > 0 && choice <= currentState.results.length) {
                    const selectedMovie = currentState.results[choice - 1];
                    userState.delete(from);

                    await sock.sendMessage(from, { text: `⏳ *Fetching Details for:* _${selectedMovie.title}_...` }, sendOptions);
                    const movieData = await getMovieDetails(selectedMovie.link);

                    if (!movieData) {
                        return sock.sendMessage(from, { text: `❌ Movie details ලබා ගැනීමට නොහැකි විය.` }, sendOptions);
                    }

                    userState.set(from, {
                        type: 'MOVIE_DOWNLOAD_LIST',
                        links: movieData.downloadLinks,
                        title: movieData.title
                    });

                    let detailsCard = `🎬 *${movieData.title.toUpperCase()}*\n\n` +
                                      `🔗 *Link:* ${selectedMovie.link}`;

                    if (movieData.img) {
                        await sock.sendMessage(from, { image: { url: movieData.img }, caption: detailsCard }, sendOptions);
                    } else {
                        await sock.sendMessage(from, { text: detailsCard }, sendOptions);
                    }

                    let dlText = `📥 *AVAILABLE DOWNLOAD QUALITIES*\n\n` +
                                 `Reply with the option number to download:\n\n`;

                    if (movieData.downloadLinks.length === 0) {
                        dlText += `❌ Direct download links හමු නොවීය.`;
                    } else {
                        movieData.downloadLinks.forEach((item, idx) => {
                            dlText += `*${idx + 1}* - ${item.name}\n`;
                        });
                    }

                    return sock.sendMessage(from, { text: dlText }, sendOptions);
                }
            }

            // 📥 MOVIE DOWNLOAD HANDLER
            if (currentState && typeof currentState === 'object' && currentState.type === 'MOVIE_DOWNLOAD_LIST') {
                const choice = parseInt(textMessage.trim());
                if (!isNaN(choice) && choice > 0 && choice <= currentState.links.length) {
                    const selectedLink = currentState.links[choice - 1];
                    userState.delete(from);

                    await sock.sendMessage(from, { 
                        text: `🚀 *Downloading Movie File:* _${currentState.title}_\n\n⚠️ *මෙම ක්‍රියාවලියට File Size එක අනුව විනාඩි කිහිපයක් ගතවිය හැක...*` 
                    }, sendOptions);

                    try {
                        await sock.sendMessage(from, {
                            document: { url: selectedLink.url },
                            mimetype: 'video/mp4',
                            fileName: `${currentState.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`,
                            caption: `🎬 *${currentState.title}*\n\nDownloaded via ${config.botName}`
                        }, sendOptions);
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: `❌ *Direct File Send Error!* File Size එක ඉතා විශාල නිසා කෙලින්ම යැවිය නොහැක.\n\n🔗 *Direct Download Link:* ${selectedLink.url}` 
                        }, sendOptions);
                    }
                    return;
                }
            }

            if (isOwner && currentState && typeof currentState === 'object' && currentState.type === 'CONFIRM_TOKEN') {
                if (textMessage === '1') {
                    config.githubToken = currentState.data;
                    saveSettings();
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `✅ *GitHub Token updated!* 🟢` }, sendOptions);
                } else if (textMessage === '2') {
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `❌ *GitHub Token update cancelled!*` }, sendOptions);
                }
            }

            if (isOwner && currentState && typeof currentState === 'object' && currentState.type === 'CONFIRM_REPO') {
                if (textMessage === '1') {
                    config.githubRepo = currentState.data;
                    saveSettings();
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `✅ *GitHub Repo updated:* [ *${config.githubRepo}* ] 🟢` }, sendOptions);
                } else if (textMessage === '2') {
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `❌ *GitHub Repo update cancelled!*` }, sendOptions);
                }
            }

            if (isOwner && currentState === 'AWAITING_SETTING_CHOICE') {
                if (textMessage === '2') {
                    userState.set(from, 'AWAITING_PREFIX_CHOICE');
                    return sock.sendMessage(from, { text: `⚙️ *CHANGE PREFIX*\n\nCurrent: [ *${config.currentPrefix}* ]\nSend desired prefix symbol.` }, sendOptions);
                }
                else if (textMessage === '3') {
                    userState.set(from, 'AWAITING_MODE_CHOICE');
                    return sock.sendMessage(from, { text: `⚙️ *WORK MODE SETTINGS*\n\nReply with:\n*3.1* - Private 🔒\n*3.2* - Group 👥\n*3.3* - Inbox 📥\n*3.4* - Public 🌐` }, sendOptions);
                }
                else if (textMessage === '4') {
                    userState.set(from, 'AWAITING_OWNER_REACT_CHOICE');
                    return sock.sendMessage(from, { text: `⚙️ *OWNER AUTO REACT*\n\nReply with:\n*4.1* - ON 🟢\n*4.2* - OFF 🔴\n*4.3* - Change Emojis` }, sendOptions);
                }
                else if (textMessage === '5') {
                    userState.set(from, 'AWAITING_REACT_CHOICE');
                    return sock.sendMessage(from, { text: `⚙️ *AUTO REACT*\n\nReply with:\n*5.1* - ON 🟢\n*5.2* - OFF 🔴\n*5.3* - Group\n*5.4* - Inbox\n*5.5* - Public\n*5.6* - Change Single Emoji` }, sendOptions);
                }
                else if (textMessage === '6') {
                    userState.set(from, 'AWAITING_CUSTOM_REACT_CHOICE');
                    return sock.sendMessage(from, { text: `⚙️ *CUSTOM REACT*\n\nReply with:\n*6.1* - ON 🟢\n*6.2* - OFF 🔴\n*6.3* - Group\n*6.4* - Inbox\n*6.5* - Public\n*6.6* - Set Emojis` }, sendOptions);
                }
                else if (textMessage === '7') {
                    config.viewOnceDownload = !config.viewOnceDownload;
                    saveSettings();
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `👁️ *View Once Downloader:* ${config.viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}` }, sendOptions);
                }
                else if (textMessage === '8') {
                    userState.set(from, 'AWAITING_PRESENCE_CHOICE');
                    return sock.sendMessage(from, { text: `⚙️ *PRESENCE STATUS*\n\nReply with:\n*8.1* - ONLINE 🟢\n*8.2* - OFFLINE 🔴` }, sendOptions);
                }
            }

            if (isOwner && currentState === 'AWAITING_PRESENCE_CHOICE') {
                if (textMessage === '8.1' || textMessage.toLowerCase() === 'on') {
                    config.botPresence = 'available';
                    await sock.sendPresenceUpdate('available');
                    saveSettings();
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `✅ *Presence set to:* ONLINE 🟢` }, sendOptions);
                } else if (textMessage === '8.2' || textMessage.toLowerCase() === 'off') {
                    config.botPresence = 'unavailable';
                    await sock.sendPresenceUpdate('unavailable');
                    saveSettings();
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `✅ *Presence set to:* OFFLINE 🔴` }, sendOptions);
                }
            }

            if (isOwner && currentState === 'AWAITING_PREFIX_CHOICE') {
                config.currentPrefix = textMessage.trim()[0] || config.currentPrefix;
                saveSettings();
                userState.delete(from);
                return sock.sendMessage(from, { text: `✅ *Prefix set to:* [ *${config.currentPrefix}* ]` }, sendOptions);
            }

            if (isOwner && currentState === 'AWAITING_MODE_CHOICE') {
                if (textMessage === '3.1') config.workMode = 'private';
                if (textMessage === '3.2') config.workMode = 'group';
                if (textMessage === '3.3') config.workMode = 'inbox';
                if (textMessage === '3.4') config.workMode = 'public';
                saveSettings();
                userState.delete(from);
                return sock.sendMessage(from, { text: `✅ *Work Mode set to:* ${config.workMode.toUpperCase()}` }, sendOptions);
            }

            if (isOwner && currentState === 'AWAITING_OWNER_REACT_CHOICE') {
                if (textMessage === '4.1') {
                    config.ownerAutoReactEnabled = true;
                    saveSettings();
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `✅ *Owner Auto React Enabled!* 🟢` }, sendOptions);
                } else if (textMessage === '4.2') {
                    config.ownerAutoReactEnabled = false;
                    saveSettings();
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `✅ *Owner Auto React Disabled!* 🔴` }, sendOptions);
                } else if (textMessage === '4.3') {
                    userState.set(from, 'AWAITING_OWNER_EMOJIS');
                    return sock.sendMessage(from, { text: `Send Owner Emojis (e.g. 👑,❤️):` }, sendOptions);
                }
            }

            if (isOwner && currentState === 'AWAITING_OWNER_EMOJIS') {
                const emojiList = textMessage.split(',').map(e => e.trim()).filter(e => e.length > 0);
                if (emojiList.length > 0) {
                    config.ownerReactEmojis = emojiList;
                    ownerEmojiIndex = 0;
                    saveSettings();
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `✅ *Owner Emojis updated:* ${config.ownerReactEmojis.join(' ')}` }, sendOptions);
                }
            }

            if (isOwner && currentState === 'AWAITING_REACT_CHOICE') {
                if (textMessage === '5.1') config.autoReactEnabled = true;
                else if (textMessage === '5.2') config.autoReactEnabled = false;
                else if (textMessage === '5.3') config.autoReactTarget = 'group';
                else if (textMessage === '5.4') config.autoReactTarget = 'inbox';
                else if (textMessage === '5.5') config.autoReactTarget = 'public';
                else if (textMessage === '5.6') {
                    userState.set(from, 'AWAITING_EMOJI');
                    return sock.sendMessage(from, { text: `Send single Emoji:` }, sendOptions);
                }
                saveSettings();
                userState.delete(from);
                return sock.sendMessage(from, { text: `✅ *Auto React Settings Updated!*` }, sendOptions);
            }

            if (isOwner && currentState === 'AWAITING_CUSTOM_REACT_CHOICE') {
                if (textMessage === '6.1') config.customReactEnabled = true;
                else if (textMessage === '6.2') config.customReactEnabled = false;
                else if (textMessage === '6.3') config.customReactTarget = 'group';
                else if (textMessage === '6.4') config.customReactTarget = 'inbox';
                else if (textMessage === '6.5') config.customReactTarget = 'public';
                else if (textMessage === '6.6') {
                    userState.set(from, 'AWAITING_CUSTOM_EMOJIS');
                    return sock.sendMessage(from, { text: `Send emojis (e.g. ❤️,👑,♥️):` }, sendOptions);
                }
                saveSettings();
                userState.delete(from);
                return sock.sendMessage(from, { text: `✅ *Custom React Settings Updated!*` }, sendOptions);
            }

            if (isOwner && currentState === 'AWAITING_EMOJI') {
                config.ownerReactEmojis = [textMessage.trim()];
                saveSettings();
                userState.delete(from);
                return sock.sendMessage(from, { text: `✅ *Emoji updated to:* ${config.ownerReactEmojis.join(' ')}` }, sendOptions);
            }

            if (isOwner && currentState === 'AWAITING_CUSTOM_EMOJIS') {
                const emojiList = textMessage.split(',').map(e => e.trim()).filter(e => e.length > 0);
                if (emojiList.length > 0) {
                    config.customEmojis = emojiList;
                    saveSettings();
                    userState.delete(from);
                    return sock.sendMessage(from, { text: `✅ *Custom Emojis updated to:* ${config.customEmojis.join(' ')}` }, sendOptions);
                }
            }

            if (!textMessage.startsWith(config.currentPrefix)) return;

            const args = textMessage.slice(config.currentPrefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // 🎬 MOVIE / CINESUBZ COMMAND
            if (command === 'cinesubz' || command === 'movie') {
                const query = args.join(' ').trim();
                if (!query) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ *භාවිතය:* ${config.currentPrefix}${command} <Movie Name>\n*Example:* ${config.currentPrefix}${command} Batman` 
                    }, sendOptions);
                }

                await sock.sendMessage(from, { text: `🔍 *Searching Cinesubz for:* _${query}_...` }, sendOptions);

                const searchResults = await searchCinesubz(query);

                if (searchResults.length === 0) {
                    return sock.sendMessage(from, { text: `❌ *${query}* වෙනුවෙන් Cinesubz හි කිසිදු Movie එකක් හමු නොවීය.` }, sendOptions);
                }

                userState.set(from, {
                    type: 'MOVIE_SEARCH_LIST',
                    results: searchResults
                });

                let menuMsg = `🎬 *CINESUBZ MOVIE SEARCH RESULTS*\n\n` +
                              `🔎 *Query:* ${query}\n` +
                              `Reply with the option number to view details:\n\n`;

                searchResults.forEach((item, index) => {
                    menuMsg += `*${index + 1}* - ${item.title}\n`;
                });

                return sock.sendMessage(from, { text: menuMsg }, sendOptions);
            }

            // Info Command
            if (command === 'info') {
                if (!isGroup) return sock.sendMessage(from, { text: `⚠️ ගෲප් තුළ පමණක් භාවිතා කළ හැක!` }, sendOptions);
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const groupDesc = groupMetadata.desc ? groupMetadata.desc.toString() : 'Description එකක් සකසා නැත.';
                    const infoText = `📋 *GROUP DESCRIPTION*\n\n👥 *Group Name:* ${groupMetadata.subject}\n\n📝 *Description:*\n${groupDesc}`;
                    return sock.sendMessage(from, { text: infoText }, sendOptions);
                } catch (e) {
                    return sock.sendMessage(from, { text: `❌ Details ලබා ගැනීමට නොහැකි විය.` }, sendOptions);
                }
            }

            // Bot Command
            if (command === 'bot') {
                if (!isOwner) return sock.sendMessage(from, { text: `⚠️ Bot Owner ට පමණයි!` }, sendOptions);

                const subCommand = args.shift()?.toLowerCase();
                if (subCommand === 'name') {
                    const newName = args.join(' ').trim();
                    if (!newName) return sock.sendMessage(from, { text: `⚠️ නව නම ඇතුළත් කරන්න!` }, sendOptions);
                    config.botName = newName;
                    saveSettings();
                    return sock.sendMessage(from, { text: `✅ *Bot Name updated to:* [ *${config.botName}* ] 🟢` }, sendOptions);
                } else {
                    return sock.sendMessage(from, { text: `⚠️ භාවිතය: *${config.currentPrefix}bot name <New Name>*` }, sendOptions);
                }
            }

            // Apply Command
            if (command === 'apply') {
                if (!isOwner) return sock.sendMessage(from, { text: `⚠️ Bot Owner ට පමණයි!` }, sendOptions);

                const inputData = args.join(' ').trim();
                if (!inputData) return sock.sendMessage(from, { text: `⚠️ භාවිතය: ${config.currentPrefix}apply <Token/Repo>` }, sendOptions);

                if (inputData.startsWith('ghp_') || inputData.includes('github.com')) {
                    const tokenValue = inputData;
                    userState.set(from, { type: 'CONFIRM_TOKEN', data: tokenValue });
                    return sock.sendMessage(from, { text: `⚙️ *GITHUB TOKEN SETTINGS*\n\nReply:\n*1* - Save Token\n*2* - Cancel` }, sendOptions);
                } else {
                    userState.set(from, { type: 'CONFIRM_REPO', data: inputData });
                    return sock.sendMessage(from, { text: `⚙️ *GITHUB REPO SETTINGS*\n\nReply:\n*1* - Save Repo\n*2* - Cancel` }, sendOptions);
                }
            }

            // Settings Command
            if (command === 'setting' || command === 'settings') {
                if (!isOwner) return sock.sendMessage(from, { text: `⚠️ Bot Owner ට පමණයි!` }, sendOptions);

                userState.set(from, 'AWAITING_SETTING_CHOICE');

                const settingsText = `⚙️ *${config.botName} SETTINGS MENU*\n\n` +
                                     `Reply with option number:\n\n` +
                                     `*2* - Change Bot Prefix\n` +
                                     `*3* - Work Mode Settings\n` +
                                     `*4* - Owner Auto React Settings\n` +
                                     `*5* - Auto React Settings\n` +
                                     `*6* - Custom React Settings\n` +
                                     `*7* - Toggle View Once Downloader\n` +
                                     `*8* - Bot Online/Offline Status Settings\n\n` +
                                     `📌 *CURRENT CONFIGURATION*\n` +
                                     `• *Bot Name:* ${config.botName}\n` +
                                     `• *Prefix:* [ ${config.currentPrefix} ]\n` +
                                     `• *Work Mode:* ${config.workMode.toUpperCase()}\n` +
                                     `• *Presence:* ${config.botPresence === 'available' ? 'ONLINE 🟢' : 'OFFLINE 🔴'}\n` +
                                     `• *Owner Auto React:* ${config.ownerAutoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.ownerReactEmojis.join(', ')})\n` +
                                     `• *Auto React:* ${config.autoReactEnabled ? 'ON 🟢' : 'OFF 🔴'} (${config.autoReactTarget.toUpperCase()})\n` +
                                     `• *Custom React:* ${config.customReactEnabled ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                     `• *View Once:* ${config.viewOnceDownload ? 'ON 🟢' : 'OFF 🔴'}\n` +
                                     `• *GitHub Token:* ${config.githubToken !== "NOT SET" ? "SET 🟢" : "NOT SET 🔴"}\n` +
                                     `• *GitHub Repo:* ${config.githubRepo}`;

                sock.sendMessage(from, { text: settingsText }, sendOptions);
            }

            // Menu Command
            else if (command === 'menu' || command === 'help') {
                const menuText = `✨ *${config.botName} MAIN MENU* ✨\n\n` +
                                 `🤖 *Bot Name:* ${config.botName}\n` +
                                 `⚙️ *Mode:* ${config.workMode.toUpperCase()}\n` +
                                 `🌐 *Presence:* ${config.botPresence === 'available' ? 'ONLINE 🟢' : 'OFFLINE 🔴'}\n` +
                                 `📌 *Prefix:* [ ${config.currentPrefix} ]\n\n` +
                                 `*AVAILABLE COMMANDS:*\n` +
                                 `┌──────────────\n` +
                                 `│ 📜 *${config.currentPrefix}menu* - Display Menu\n` +
                                 `│ 🎬 *${config.currentPrefix}movie* - Search Movies\n` +
                                 `│ 🍿 *${config.currentPrefix}cinesubz* - Search Cinesubz\n` +
                                 `│ 🏓 *${config.currentPrefix}ping* - Speed Test\n` +
                                 `│ 📋 *${config.currentPrefix}info* - Get Group Description\n` +
                                 `│ ⚙️ *${config.currentPrefix}setting* - Bot Settings\n` +
                                 `│ 🤖 *${config.currentPrefix}bot name <name>* - Change Bot Name\n` +
                                 `│ 🔑 *${config.currentPrefix}apply <token/repo>* - Set GitHub Config\n` +
                                 `│ 🔄 *${config.currentPrefix}update* - Git Update\n` +
                                 `│ 👁️ *${config.currentPrefix}vv2* - View Once Downloader\n` +
                                 `└──────────────`;

                sock.sendMessage(from, { text: menuText }, sendOptions);
            }

            // Ping Command
            else if (command === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: 'Testing speed...' }, sendOptions);
                const end = Date.now();
                await sock.sendMessage(from, { text: `📿 *Pong!* Speed: *${end - start}ms*` }, sendOptions);
            }

            // Update Command
            else if (command === 'update') {
                if (!isOwner) return;
                await sock.sendMessage(from, { text: `🔄 Updating from GitHub...` }, sendOptions);
                exec('git pull', async (error, stdout) => {
                    if (error) return await sock.sendMessage(from, { text: `❌ Update Failed: ${error.message}` }, sendOptions);
                    await sock.sendMessage(from, { text: `✅ Updated Successfully:\n\`\`\`${stdout}\`\`\`\nRestarting Process...` }, sendOptions);
                    setTimeout(() => process.exit(0), 1500);
                });
            }

            // View Once Command
            else if (command === 'vv2' || command === 'vv') {
                if (!config.viewOnceDownload) return sock.sendMessage(from, { text: `⚠️ View Once Downloader is disabled in Settings!` }, sendOptions);

                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) return sock.sendMessage(from, { text: `⚠️ View Once Message එකකට Reply කරන්න!` }, sendOptions);

                const viewOnceMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg;
                const imageMsg = viewOnceMsg.imageMessage;
                const videoMsg = viewOnceMsg.videoMessage;

                const botOwnerJid = PHONE_NUMBER.includes('@s.whatsapp.net') ? PHONE_NUMBER : `${PHONE_NUMBER}@s.whatsapp.net`;

                if (imageMsg) {
                    const stream = await downloadContentFromMessage(imageMsg, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    await sock.sendMessage(botOwnerJid, { image: buffer, caption: `👁️ *VIEW ONCE PHOTO DOWNLOADED*` });
                    await sock.sendMessage(from, { text: `✅ Inbox එකට යවන ලදී!` }, sendOptions);
                } else if (videoMsg) {
                    const stream = await downloadContentFromMessage(videoMsg, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    await sock.sendMessage(botOwnerJid, { video: buffer, caption: `👁️ *VIEW ONCE VIDEO DOWNLOADED*` });
                    await sock.sendMessage(from, { text: `✅ Inbox එකට යවන ලදී!` }, sendOptions);
                }
            }

        } catch (error) {
            console.error("Safe Handled Processing Error:", error?.message || error);
        }
    });
}

connectToWhatsApp();
