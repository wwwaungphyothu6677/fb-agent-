const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_token";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Telegram Config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_FINANCE_CHAT_ID = process.env.TELEGRAM_FINANCE_CHAT_ID;
const TELEGRAM_PACKING_CHAT_ID = process.env.TELEGRAM_PACKING_CHAT_ID;

// Gemini Config
const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;
if (apiKey) genAI = new GoogleGenerativeAI(apiKey);

// 🧠 Customer တစ်ယောက်ချင်းစီရဲ့ စကားပြောမှတ်ဉာဏ်နှင့် အချိန်မှတ်တမ်း
const chatSessions = {};

// ⏱️ ၂၄ နာရီကျော်သွားသော Session များကို စစ်ဆေးဖျက်ဆီးသည့် စနစ်
function getValidChatSession(sender_psid, modelConfig) {
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // Milliseconds အဖြစ်ပြောင်းလဲခြင်း

    if (chatSessions[sender_psid]) {
        // ၂၄ နာရီ ကျော်မကျော် စစ်ဆေးခြင်း
        if (now - chatSessions[sender_psid].createdAt > TWENTY_FOUR_HOURS) {
            console.log(`Session expired for customer ${sender_psid}. Resetting chat...`);
            delete chatSessions[sender_psid]; // ၂၄ နာရီကျော်က ဖျက်ပစ်မည်
        } else {
            // စကား ဆက်ပြောနေလျှင် သက်တမ်းကို လက်ရှိအချိန်ကနေ နောက်ထပ် ၂၄ နာရီ ထပ်တိုးပေးခြင်း (Optional)
            chatSessions[sender_psid].lastUpdatedAt = now;
            return chatSessions[sender_psid].session;
        }
    }

    // Session မရှိလျှင် သို့မဟုတ် သက်တမ်းကုန်သွားလျှင် အသစ်ပြန်ဆောက်မည်
    if (genAI) {
        const model = genAI.getGenerativeModel(modelConfig);
        chatSessions[sender_psid] = {
            session: model.startChat(),
            createdAt: now,
            lastUpdatedAt: now
        };
        return chatSessions[sender_psid].session;
    }
    return null;
}

// Google Sheet ဆွဲသည့် Function (CSV Parser)
async function getLiveShopInfo() {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!sheetId) return "လက်ရှိတွင် ပစ္စည်းစာရင်း မရနိုင်သေးပါ။";
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    try {
        const response = await axios.get(url);
        const lines = response.data.split('\n');
        let itemsText = "";
        let count = 1;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const columns = line.split(',');
            const name = columns[0] ? columns[0].replace(/"/g, '') : '';
            const price = columns[1] ? columns[1].replace(/"/g, '') : '';
            const details = columns[2] ? columns[2].replace(/"/g, '') : '';
            if (name) {
                itemsText += `${count}. ${name} - ${price} ကျပ် (${details})\n`;
                count++;
            }
        }
        return itemsText;
    } catch (e) {
        return "ဆိုင်တွင် ပစ္စည်းများ ရောင်းချပေးနေပါသည်။";
    }
}

// Telegram Functions
async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try { await axios.post(url, { chat_id: chatId, text: text, parse_mode: 'Markdown' }); } catch (e) {}
}

async function sendTelegramPhoto(chatId, photoUrl, caption) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    try { await axios.post(url, { chat_id: chatId, photo: photoUrl, caption: caption }); } catch (e) {}
}

app.get('/', (req, res) => res.status(200).send('AI Sales Agent with 24h Expire Session is running...'));

app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
    }
    return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);
    if (!body.entry || !Array.isArray(body.entry)) return res.sendStatus(200);

    for (const entry of body.entry) {
        if (!entry.messaging) continue;
        const webhook_event = entry.messaging[0];
        if (!webhook_event || !webhook_event.sender) continue;

        const sender_psid = webhook_event.sender.id;

        // ၁။ Screenshot ပို့လာလျှင် -> Finance Group
        if (webhook_event.message && webhook_event.message.attachments) {
            const attachment = webhook_event.message.attachments[0];
            if (attachment.type === 'image') {
                await sendTelegramPhoto(
                    TELEGRAM_FINANCE_CHAT_ID, 
                    attachment.payload.url, 
                    `💰 *ငွေလွှဲပြေစာအသစ်*\nCustomer PSID: \`${sender_psid}\`\nလူသား Admin များ စစ်ဆေးပေးပါရန်။`
                );
                await sendFacebookMessage(sender_psid, "ငွေလွှဲပြေစာ လက်ခံရရှိပါပြီရှင်။ တာဝန်ရှိသူက စစ်ဆေးပြီးပါက အကြောင်းကြားပေးပါမည်။");
                continue;
            }
        }

        // ၂။ စာပို့လာလျှင် (ပစ္စည်း၊ ဖုန်း၊ လိပ်စာ)
        if (webhook_event.message && webhook_event.message.text) {
            const userMessage = webhook_event.message.text;
            console.log(`Customer: ${userMessage}`);

            if (!genAI) {
                await sendFacebookMessage(sender_psid, "စနစ်ပြင်ဆင်နေဆဲဖြစ်၍ ခေတ္တစောင့်ဆိုင်းပေးပါ။");
                continue;
            }

            try {
                const itemsList = await getLiveShopInfo();
                
                // Gemini Model Configuration နှင့် ဉာဏ်ရည်လမ်းညွှန်ချက်
                const modelConfig = { 
                    model: "gemini-2.5-flash",
                    systemInstruction: `
သင်သည် "Smart Zone" ဆိုင်၏ တက်ကြွသော AI အရောင်းဝန်ထမ်း ဖြစ်သည်။ မြန်မာဘာသာဖြင့် သာယာပျော့ပျောင်းစွာ ပြောပါ။
[ဆိုင်ရှိ ပစ္စည်းများနှင့် ဈေးနှုန်းများ]
${itemsList}
[ပို့ဆောင်ခနှင့် ငွေချေစနစ်]
- ရန်ကုန်/မန္တလေး အိမ်ရောက်ငွေချေ (ပို့ဆောင်ခ ၃,၀၀၀ ကျပ်)
- နယ်မြို့များ ငွေကြိုလွှဲရမည် (ပို့ဆောင်ခ ၄,၀၀၀ ကျပ်)
[အရေးကြီး စည်းကမ်းချက်]
- ဝယ်ယူလိုပါက Customer ထံမှ (၁) အမည်၊ (၂) ဖုန်းနံပါတ်၊ (၃) လိပ်စာ အပြည့်အစုံကို သေချာပေါက် တောင်းခံပါ။
- စကားပြောမှတ်ဉာဏ် (History) ကို အမြဲကြည့်ပါ။ Customer က လိပ်စာနှင့်ဖုန်း ပေးပြီးပါက မှာယူထားသည့် အော်ဒါအနှစ်ချုပ်ကို ပြန်ပြောပြပြီး ငွေလွှဲခိုင်းပါ။ "ဘာယူဦးမလဲ" ဟု ထပ်မမေးပါနှင့်။
`
                };

                // ၂၄ နာရီ စည်းကမ်းချက်ဖြင့် Chat Session ကို ခေါ်ယူခြင်း
                const chat = getValidChatSession(sender_psid, modelConfig);
                
                // AI ထံ စာပို့ပြီး အဖြေတောင်းခြင်း
                const result = await chat.sendMessage(userMessage);
                const aiReply = result.response.text();

                // 📦 Packing အချက်အလက် စစ်ဆေးခြင်း
                // Customer က လိပ်စာ သို့မဟုတ် ဖုန်း ပေးလိုက်ပြီဆိုလျှင် Telegram Packing Group သို့ အကုန်စုပြီး ပို့မည်
                const hasAddressOrPhone = /(လိပ်စာ|မြို့|လမ်း|အိမ်အမှတ်|ဖုန်း|phone|09\d{7,9})/i.test(userMessage);
                
                if (hasAddressOrPhone) {
                    // Chat History ထဲကနေ အရှေ့မှာ ပြောခဲ့သမျှ စကားတွေကို စာသားအဖြစ် ပြန်ထုတ်ယူခြင်း
                    const history = await chat.getHistory();
                    let conversationBuffer = "";
                    history.forEach(turn => {
                        const role = turn.role === 'user' ? 'Customer' : 'AI Agent';
                        const text = turn.parts[0].text;
                        conversationBuffer += `${role}: ${text}\n`;
                    });

                    // Packing Group ဆီသို့ အချက်အလက် အပြည့်အစုံ ပို့ခြင်း
                    const packingDetails = `📦 *ပါဆယ်ထုပ်ရန် အော်ဒါအချက်အလက်အပြည့်အစုံ*\n` +
                                           `• *Customer PSID:* \`${sender_psid}\`\n` +
                                           `• *နောက်ဆုံးပေးပို့သည့် အချက်အလက်:* ${userMessage}\n\n` +
                                           `📝 *စကားပြောဆိုမှု သမိုင်းကြောင်းအနှစ်ချုပ် (မှာယူသည့်ပစ္စည်းနှင့် လိပ်စာကြည့်ရန်):*\n` +
                                           `\`\`\`\n${conversationBuffer}\`\`\``;
                                           
                    await sendTelegramMessage(TELEGRAM_PACKING_CHAT_ID, packingDetails);
                }

                // Customer ထံသို့ စာပြန်ပို့ခြင်း
                await sendFacebookMessage(sender_psid, aiReply);

            } catch (aiError) {
                console.error('Gemini Error:', aiError.message);
                await sendFacebookMessage(sender_psid, "လူကြီးမင်းရှင့်၊ ခဏနေမှ ထပ်မံမေးမြန်းပေးပါရှင့်။");
            }
        }
    }
    return res.status(200).send('EVENT_RECEIVED');
});

async function sendFacebookMessage(sender_psid, text) {
    if (!PAGE_ACCESS_TOKEN) return;
    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    try { await axios.post(url, { recipient: { id: sender_psid }, message: { text: text } }); } catch (e) {}
}

app.listen(PORT, '0.0.0.0', () => console.log(`Live Sales Agent with 24h TTL running on port ${PORT}`));
