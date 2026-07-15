const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_token";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_FINANCE_CHAT_ID = process.env.TELEGRAM_FINANCE_CHAT_ID;
const TELEGRAM_PACKING_CHAT_ID = process.env.TELEGRAM_PACKING_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const chatHistories = {};

// 🛠️ Gemini API သို့ တိုက်ရိုက်ခေါ်ယူသည့် စနစ် (REST Endpoint Fixed)
async function callGeminiAPI(systemInstruction, userMessage, history = []) {
    // 💡 တိုက်ရိုက် REST call အတွက် v1beta endpoint သည် JSON payload အား ကျိန်းသေပေါက် လက်ခံပါသည်
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const contents = [];
    
    // History ပုံစံကို standard format ပြောင်းခြင်း
    history.forEach(turn => {
        contents.push({
            role: turn.role === 'user' ? 'user' : 'model',
            parts: [{ text: turn.text }]
        });
    });
    
    // လက်ရှိစာသား ထည့်ခြင်း
    contents.push({
        role: 'user',
        parts: [{ text: userMessage }]
    });

    const payload = {
        contents: contents,
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800
        }
    };

    const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
    return response.data.candidates[0].content.parts[0].text;
}

// 🛠️ မှာယူသည့် အချက်အလက် သန့်စင်သည့် စနစ် (REST Schema Fixed)
async function extractOrderSpecs(conversationText) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const payload = {
        contents: [{
            role: 'user',
            parts: [{ text: `အောက်ပါ စကားပြောဆိုမှုထဲမှ Customer ၏ (၁) အမည်၊ (၂) ဖုန်းနံပါတ်၊ (၃) လိပ်စာ၊ (၄) မှာယူသည့်ပစ္စည်း နှင့် အရေအတွက် တို့ကိုသာ သန့်သန့်ရှင်းရှင်း စာရင်းထုတ်ပေးပါ။ Chat list ကြီး သို့မဟုတ် Customer/AI စာတန်းကြီးများ မလိုချင်ပါ။\n\n${conversationText}` }]
        }],
        generationConfig: {
            temperature: 0.2
        }
    };
    
    try {
        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
        return response.data.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error("Extraction error:", e.message);
        return "အချက်အလက် စစ်ဆေးဆဲ...";
    }
}

// 📊 Google Sheet Data Parser
async function getSheetData() {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    let itemsText = "1. Power Bank - 35,000 ကျပ်\n2. Earbuds - 28,000 ကျပ်\n";
    let deliRules = "- ရန်ကုန်/မန္တလေး: ပို့ဆောင်ခ ၃,၀၀၀ ကျပ် (အိမ်ရောက်ငွေချေ COD ရသည်)\n- ကျန်မြို့များ: ပို့ဆောင်ခ ၄,၀၀၀ ကျပ် (ငွေကြိုလွှဲရမည်)\n";

    if (!sheetId) return { itemsText, deliRules };

    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    try {
        const response = await axios.get(url, { timeout: 5000 });
        const lines = response.data.split('\n');
        let tempItems = "";
        let tempDeli = "";
        let itemCount = 1;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = line.split(',');

            const colA = cols[0] ? cols[0].replace(/"/g, '').trim() : '';
            const colB = cols[1] ? cols[1].replace(/"/g, '').trim() : '';
            const colC = cols[2] ? cols[2].replace(/"/g, '').trim() : '';

            if (colA && colB && !isNaN(colB.replace(/ကျပ်|,/g, '')) && !colA.toLowerCase().includes("township")) {
                tempItems += `${itemCount}. ${colA} - ${colB} ကျပ် (${colC})\n`;
                itemCount++;
            } else if (colA && colB && (colC.toLowerCase() === 'cod' || colC.toLowerCase() === 'prepaid')) {
                tempDeli += `- မြို့နယ်: ${colA} ဖြစ်ပါက ပို့ဆောင်ခ ${colB} ကျပ် ဖြစ်ပြီး ${colC.toLowerCase() === 'cod' ? 'အိမ်ရောက်ငွေချေ (COD) ရပါသည်' : 'ငွေကြိုလွှဲရပါမည်'}။\n`;
            }
        }

        if (tempItems) itemsText = tempItems;
        if (tempDeli) deliRules = tempDeli;

    } catch (e) { console.error("Sheet error:", e.message); }
    return { itemsText, deliRules };
}

// Telegram Functions
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: text, parse_mode: 'Markdown', reply_markup: replyMarkup }); } catch (e) {}
}

async function sendTelegramPhoto(chatId, photoUrl, caption, replyMarkup = null) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { chat_id: chatId, photo: photoUrl, caption: caption, parse_mode: 'Markdown', reply_markup: replyMarkup }); } catch (e) {}
}

app.get('/', (req, res) => res.status(200).send('AI Order Workflow System is running...'));
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
    return res.sendStatus(403);
});

// Facebook Webhook Listener
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);

    for (const entry of body.entry) {
        if (!entry.messaging) continue;
        const webhook_event = entry.messaging[0];
        const sender_psid = webhook_event.sender.id;

        // Button Clicks
        if (webhook_event.postback) {
            const payload = webhook_event.postback.payload;
            if (payload.startsWith("CONFIRM_ORDER_")) {
                const psid = payload.replace("CONFIRM_ORDER_", "");
                let finalOrderText = "အချက်အလက် စစ်ဆေးမရပါ။";
                
                if (chatHistories[psid]) {
                    let conversation = "";
                    chatHistories[psid].history.forEach(t => conversation += `${t.role}: ${t.text}\n`);
                    finalOrderText = await extractOrderSpecs(conversation);
                }

                const inlineKeyboard = { inline_keyboard: [[{ text: "📦 ပါဆယ်ထုတ်ပြီးပြီ", callback_data: `PACKING_DONE_${psid}` }]] };
                await sendTelegramMessage(TELEGRAM_PACKING_CHAT_ID, `📦 *ပါဆယ်ထုတ်ရန် (COD အော်ဒါ)*\n\n${finalOrderText}`, inlineKeyboard);
                await sendFacebookMessage(psid, "ကျေးဇူးတင်ပါတယ်ရှင့်။ အော်ဒါကို အတည်ပြုပြီး Packing ဌာနသို့ လွှဲပေးလိုက်ပါပြီ။ ပစ္စည်းထုတ်ပြီးပါက အကြောင်းကြားပေးပါမည်။");
            }
            continue;
        }

        // ၁။ Screenshot ပို့လာလျှင် -> Finance Group
        if (webhook_event.message && webhook_event.message.attachments) {
            const attachment = webhook_event.message.attachments[0];
            if (attachment.type === 'image') {
                let orderItems = "ပစ္စည်းအချက်အလက် မသိရပါ";
                if (chatHistories[sender_psid]) {
                    let conversation = "";
                    chatHistories[sender_psid].history.forEach(t => conversation += `${t.role}: ${t.text}\n`);
                    orderItems = await extractOrderSpecs(conversation);
                }

                const inlineKeyboard = { inline_keyboard: [[{ text: "💰 ငွေလွှဲမှန်ကန်ကြောင်း အတည်ပြုမည်", callback_data: `FINANCE_CONFIRM_${sender_psid}` }]] };
                await sendTelegramPhoto(
                    TELEGRAM_FINANCE_CHAT_ID, 
                    attachment.payload.url, 
                    `💰 *ငွေလွှဲပြေစာအသစ်*\n\n• *Customer ID:* \`${sender_psid}\`\n• *မှာယူသည့်အချက်အလက်:*\n${orderItems}`,
                    inlineKeyboard
                );
                await sendFacebookMessage(sender_psid, "ငွေလွှဲပြေစာ လက်ခံရရှိပါပြီ။ တာဝန်ရှိသူ စစ်ဆေးပြီးပါက အကြောင်းကြားပေးပါမည်။");
                continue;
            }
        }

        // ၂။ စာပို့လာလျှင်
        if (webhook_event.message && webhook_event.message.text) {
            const userMessage = webhook_event.message.text;

            try {
                const { itemsText, deliRules } = await getSheetData();
                const systemInstruction = `
သင်သည် ဆိုင်၏ အလွန်ယဉ်ကျေးသော လူသားအရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်သည်။ စက်ရုပ်လို လုံးဝမဖြေရ။
[လမ်းညွှန်ချက်]
၁။ ပစ္စည်းအကြောင်း၊ ဈေးနှုန်းမေးမြန်းပါက ဤစာရင်းအတိုင်း ဖြေပါ-\n${itemsText}
၂။ မှာယူမည်ဟု ပြောလာပါက "ပို့ဆောင်ပေးရမည့် မြို့နယ်" ကို အရင်မေးပါ။
၃။ မြို့နယ်အလိုက် ဤစည်းကမ်းချက်အတိုင်း တွက်ချက်ပါ-\n${deliRules}
   - COD ရသော မြို့နယ်ဖြစ်ပါက: COD ရကြောင်းပြောပြီး အမည်၊ ဖုန်း၊ လိပ်စာ တောင်းပါ။
   - COD မရပါက: ငွေကြိုလွှဲရမည်ဖြစ်ကြောင်း ရှင်းပြပြီး ငွေလွှဲပြေစာ တောင်းပါ။
၄။ Customer က အချက်အလက်အစုံပေးပြီးပါက အော်ဒါအနှစ်ချုပ်ပြပြီး ခလုတ်နှိပ်၍ အတည်ပြုခိုင်းပါ။
`;

                const now = Date.now();
                if (!chatHistories[sender_psid] || (now - chatHistories[sender_psid].createdAt > 24 * 60 * 60 * 1000)) {
                    chatHistories[sender_psid] = { history: [], createdAt: now };
                }

                const aiReply = await callGeminiAPI(systemInstruction, userMessage, chatHistories[sender_psid].history);

                chatHistories[sender_psid].history.push({ role: 'user', text: userMessage });
                chatHistories[sender_psid].history.push({ role: 'model', text: aiReply });

                const isReadyToConfirm = /(အတည်ပြု|ခလုတ်)/i.test(aiReply);
                if (isReadyToConfirm) {
                    await sendFacebookButtonMessage(sender_psid, aiReply, sender_psid);
                } else {
                    await sendFacebookMessage(sender_psid, aiReply);
                }

                const hasDetails = /(လိပ်စာ|အိမ်အမှတ်|လမ်း|မြို့)/i.test(userMessage) && /(09\d{7,9})/.test(userMessage);
                if (hasDetails && /COD|အိမ်ရောက်ငွေချေ/i.test(aiReply)) {
                    let conversation = "";
                    chatHistories[sender_psid].history.forEach(t => conversation += `${t.role}: ${t.text}\n`);
                    const cleanSpecs = await extractOrderSpecs(conversation);

                    const inlineKeyboard = { inline_keyboard: [[{ text: "📦 ပါဆယ်ထုတ်ပြီးပြီ", callback_data: `PACKING_DONE_${sender_psid}` }]] };
                    await sendTelegramMessage(TELEGRAM_PACKING_CHAT_ID, `📦 *ပါဆယ်ထုတ်ရန် (COD အော်ဒါ)*\n\n${cleanSpecs}`, inlineKeyboard);
                }

            } catch (aiError) {
                console.error("Gemini Direct Critical Error:", aiError.message);
                await sendFacebookMessage(sender_psid, "လူကြီးမင်းရှင့်၊ ခဏနေမှ ထပ်မံမေးမြန်းပေးပါရှင့်။");
            }
        }
    }
    return res.status(200).send('EVENT_RECEIVED');
});

// Telegram Callbacks
app.post('/tg-webhook', async (req, res) => {
    const { callback_query } = req.body;
    if (!callback_query) return res.sendStatus(200);
    const data = callback_query.data;

    if (data.startsWith("FINANCE_CONFIRM_")) {
        const psid = data.replace("FINANCE_CONFIRM_", "");
        await sendFacebookMessage(psid, "ငွေလွှဲပြေစာကို စစ်ဆေးပြီးပါပြီရှင်။ ငွေလွှဲလက်ခံရရှိပါပြီ။ ပစ္စည်းများကို Packing ဌာနသို့ လွှဲပြောင်းပေးလိုက်ပါပြီ။");

        let cleanSpecs = "အချက်အလက် စစ်ဆေးဆဲ...";
        if (chatHistories[psid]) {
            let conversation = "";
            chatHistories[psid].history.forEach(t => conversation += `${t.text}\n`);
            cleanSpecs = await extractOrderSpecs(conversation);
        }

        const inlineKeyboard = { inline_keyboard: [[{ text: "📦 ပါဆယ်ထုတ်ပြီးပြီ", callback_data: `PACKING_DONE_${psid}` }]] };
        await sendTelegramMessage(TELEGRAM_PACKING_CHAT_ID, `📦 *ပါဆယ်ထုတ်ရန် (ငွေကြိုလွှဲအော်ဒါ)*\n\n${cleanSpecs}`, inlineKeyboard);
        
        try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageCaption`, { chat_id: callback_query.message.chat.id, message_id: callback_query.message.message_id, caption: callback_query.message.caption + "\n\n✅ *[ငွေလွှဲစစ်ဆေးပြီး - Packing သို့ ပို့ပြီး]*", parse_mode: 'Markdown' }); } catch (e) {}
    }

    if (data.startsWith("PACKING_DONE_")) {
        const psid = data.replace("PACKING_DONE_", "");
        await sendFacebookMessage(psid, "လူကြီးမင်းမှာယူထားသော ပါဆယ်ကို ထုပ်ပိုးပြင်ဆင်ပြီးစီး၍ ဂိတ်/Deli သို့ လွှဲပြောင်းအပ်နှံပေးလိုက်ပြီ ဖြစ်ကြောင်း သတင်းကောင်းပါးအပ်ပါတယ်ရှင်။ 📦✨");
        try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, { chat_id: callback_query.message.chat.id, message_id: callback_query.message.message_id, text: callback_query.message.text + "\n\n✅ *[ပါဆယ်ထုတ်ပိုးပြီးကြောင်း Customer ထံ စာပို့ပြီး]*" }); } catch (e) {}
    }
    return res.sendStatus(200);
});

async function sendFacebookMessage(sender_psid, text) {
    if (!PAGE_ACCESS_TOKEN) return;
    try { await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sender_psid }, message: { text: text } }); } catch (e) {}
}

async function sendFacebookButtonMessage(sender_psid, text, payloadId) {
    if (!PAGE_ACCESS_TOKEN) return;
    const payload = { recipient: { id: sender_psid }, message: { attachment: { type: "template", payload: { template_type: "button", text: text, buttons: [{ type: "postback", title: "🛒 ဝယ်ယူမည် (Confirm)", payload: `CONFIRM_ORDER_${payloadId}` }] } } } };
    try { await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, payload); } catch (e) {}
}

app.listen(PORT, '0.0.0.0', () => console.log(`Direct API Automation Service running on port ${PORT}`));
