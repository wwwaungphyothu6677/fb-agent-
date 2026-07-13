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

// Google Sheet ဆွဲသည့် Function (CSV Parser)
async function getLiveShopInfo() {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!sheetId) return "ဆိုင်တွင် ပစ္စည်းများ ရောင်းချပေးနေပါသည်။";
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
        return `
သင်သည် "Smart Zone" ဆိုင်၏ AI အရောင်းဝန်ထမ်း ဖြစ်သည်။ မြန်မာဘာသာဖြင့် သာယာစွာ ပြောပါ။
[ဆိုင်ရှိပစ္စည်းများနှင့် ဈေးနှုန်းများ]
${itemsText}
[စည်းကမ်းချက်] ဝယ်ယူလိုပါက အမည်၊ ဖုန်းနံပါတ်၊ လိပ်စာ တောင်းခံပါ။ ငွေလွှဲပြေစာ Screenshot ပို့ခိုင်းပါ။
`;
    } catch (e) {
        return "ဆိုင်တွင် ပစ္စည်းများ ရောင်းချပေးနေပါသည်။";
    }
}

// ✈️ Telegram သို့ စာပို့မည့် Function
async function sendTelegramMessage(chatId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try { await axios.post(url, { chat_id: chatId, text: text, parse_mode: 'Markdown' }); } 
    catch (e) { console.error("Telegram send error:", e.message); }
}

// ✈️ Telegram သို့ ပုံ (Screenshot) ပို့မည့် Function
async function sendTelegramPhoto(chatId, photoUrl, caption) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    try { await axios.post(url, { chat_id: chatId, photo: photoUrl, caption: caption }); } 
    catch (e) { console.error("Telegram photo error:", e.message); }
}

app.get('/', (req, res) => res.status(200).send('AI Sales Agent with Telegram Workflow is running...'));

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
        const sender_psid = webhook_event.sender.id;

        // ၁။ Customer က ပုံ (ငွေလွှဲ Screenshot) ပို့လာလျှင် -> Finance Group သို့ ပို့မည်
        if (webhook_event.message && webhook_event.message.attachments) {
            const attachment = webhook_event.message.attachments[0];
            if (attachment.type === 'image') {
                const imageUrl = attachment.payload.url;
                console.log(`Received Screenshot from ${sender_psid}`);
                
                // Finance Group သို့ သွားမည်
                await sendTelegramPhoto(
                    TELEGRAM_FINANCE_CHAT_ID, 
                    imageUrl, 
                    `💰 *ငွေလွှဲပြေစာအသစ်*\nCustomer PSID: `${sender_psid}`\nလူသား Admin များ သေချာစွာ Confirm ပေးပါရန်။`
                );
                await sendFacebookMessage(sender_psid, "ငွေလွှဲပြေစာ လက်ခံရရှိပါပြီရှင်။ တာဝန်ရှိသူက စစ်ဆေးပြီးပါက အကြောင်းကြားပေးပါမည်။");
                continue;
            }
        }

        // ၂။ Customer က စာပို့လာလျှင် (ပစ္စည်း၊ ဖုန်း၊ လိပ်စာ)
        if (webhook_event.message && webhook_event.message.text) {
            const userMessage = webhook_event.message.text;
            console.log(`Customer Text: ${userMessage}`);

            // စာသားထဲမှာ လိပ်စာ သို့မဟုတ် ဖုန်းနံပါတ် သို့မဟုတ် ပစ္စည်းအမည် ပါမပါ ကြည့်ပြီး Packing Group သို့ ခွဲပို့ခြင်း
            const hasAddressInfo = /(လိပ်စာ|မြို့|လမ်း|အိမ်အမှတ်|ဖုန်း|phone|09\d{7,9})/i.test(userMessage);
            
            if (hasAddressInfo) {
                // Packing Group သို့ တန်းပို့မည်
                const packingNotice = `📦 *ပါဆယ်ထုပ်ရန် အချက်အလက်အသစ်*\nCustomer PSID: `${sender_psid}`\nအချက်အလက်: ${userMessage}`;
                await sendTelegramMessage(TELEGRAM_PACKING_CHAT_ID, packingNotice);
            }

            // AI အရောင်းဝန်ထမ်းက Customer ကို ပုံမှန်အတိုင်း စကားပြန်ပြောမည်
            try {
                const dynamicShopInfo = await getLiveShopInfo();
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    systemInstruction: dynamicShopInfo 
                });
                const result = await model.generateContent(userMessage);
                const aiReply = (await result.response).text();
                
                await sendFacebookMessage(sender_psid, aiReply);
            } catch (aiError) {
                await sendFacebookMessage(sender_psid, "လူကြီးမင်းရှင့်၊ ခဏနေမှ ထပ်မံမေးမြန်းပေးပါရှင့်။");
            }
        }
    }
    return res.status(200).send('EVENT_RECEIVED');
});

async function sendFacebookMessage(sender_psid, text) {
    if (!PAGE_ACCESS_TOKEN) return;
    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    try { await axios.post(url, { recipient: { id: sender_psid }, message: { text: text } }); } 
    catch (e) { console.error('FB send error:', e.message); }
}

app.listen(PORT, '0.0.0.0', () => console.log(`Workflow Server running on port ${PORT}`));
