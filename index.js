const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_token";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Telegram Configurations
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_FINANCE_CHAT_ID = process.env.TELEGRAM_FINANCE_CHAT_ID;
const TELEGRAM_PACKING_CHAT_ID = process.env.TELEGRAM_PACKING_CHAT_ID;

const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;
if (apiKey) genAI = new GoogleGenerativeAI(apiKey);

const chatSessions = {};

// ⏱️ ၂၄ နာရီ Session စစ်ဆေးခြင်း
function getValidChatSession(sender_psid, modelConfig) {
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    if (chatSessions[sender_psid] && (now - chatSessions[sender_psid].createdAt < TWENTY_FOUR_HOURS)) {
        return chatSessions[sender_psid].session;
    }
    if (genAI) {
        const model = genAI.getGenerativeModel(modelConfig);
        chatSessions[sender_psid] = { session: model.startChat(), createdAt: now };
        return chatSessions[sender_psid].session;
    }
    return null;
}

// 📊 Google Sheet မှ မြို့နယ်နှင့် Deli ခ Live ဆွဲယူခြင်း
async function getTownshipData() {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!sheetId) return "ဒီမြို့‌ေလးက အိမ်‌ေရာက်‌ေငွ‌ေချ‌ေ‌ေလလးရပါတယ်ရှင့်";
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    try {
        const response = await axios.get(url);
        const lines = response.data.split('\n');
        let deliRules = "လမ်းညွှန်ချက်-\n";
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = line.split(',');
            const town = cols[0] ? cols[0].replace(/"/g, '').trim() : '';
            const deli = cols[1] ? cols[1].replace(/"/g, '').trim() : '';
            const type = cols[2] ? cols[2].replace(/"/g, '').trim() : 'Prepaid';
            if (town) {
                deliRules += `- မြို့နယ်: ${town} ဖြစ်ပါက ပို့ဆောင်ခ ${deli} ကျပ် ဖြစ်ပြီး ${type === 'COD' ? 'အိမ်ရောက်ငွေချေ (COD) ရပါသည်' : 'ငွေကြိုလွှဲရပါမည်'}။\n`;
            }
        }
        return deliRules;
    } catch (e) { return "ရန်ကုန်/မန္တလေး COD ရပြီး ကျန်မြို့များ ငွေကြိုလွှဲရပါမည်။"; }
}

// 📊 Google Sheet မှ ပစ္စည်းနှင့် ဈေးနှုန်းစာရင်း ဆွဲယူခြင်း
async function getLiveShopInfo() {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!sheetId) return "ဒီပပစ္စည်း‌ေလးက မရနိုင်‌ေသသးပါဘူးရှင့်။";
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`; // Note: တကယ်လို့ တစ်ခုတည်းမှာတွဲထားရင် Tab ID ခွဲနိုင်ပါတယ်
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
            const stock = columns[2] ? columns[2].replace(/"/g, '') : '';
            if (name && !name.includes("Township")) { // Header တွေကို ဇကာတင်ခြင်း
                itemsText += `${count}. ${name} - ${price} ကျပ် (${stock})\n`;
                count++;
            }
        }
        return itemsText;
    } catch (e) { return "ပစ္စည်းများ ရောင်းချပေးနေပါသည်။"; }
}

// ✈️ Telegram Functions
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try { await axios.post(url, payload); } catch (e) {}
}

async function sendTelegramPhoto(chatId, photoUrl, caption, replyMarkup = null) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const payload = { chat_id: chatId, photo: photoUrl, caption: caption, parse_mode: 'Markdown' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try { await axios.post(url, payload); } catch (e) {}
}

// 📥 Facebook Webhook Listener
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);

    for (const entry of body.entry) {
        if (!entry.messaging) continue;
        const webhook_event = entry.messaging[0];
        const sender_psid = webhook_event.sender.id;

        // ၁။ Customer က Screenshot (ငွေလွှဲ) ပို့လာလျှင် -> Finance Group သို့ သွားမည်
        if (webhook_event.message && webhook_event.message.attachments) {
            const attachment = webhook_event.message.attachments[0];
            if (attachment.type === 'image') {
                let orderItems = "ပစ္စည်းအချက်အလက် စစ်ဆေးဆဲ";
                if (chatSessions[sender_psid]) {
                    try {
                        const history = await chatSessions[sender_psid].session.getHistory();
                        let conversation = "";
                        history.forEach(t => conversation += `${t.parts[0].text}\n`);
                        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                        const ext = await model.generateContent(`အောက်ပါစာသားထဲမှ Customer မှာယူထားသော ပစ္စည်းအမည်နှင့် အရေအတွက်ကိုသာ တိုတိုတုတ်တုတ် ထုတ်ပေးပါ-\n\n${conversation}`);
                        orderItems = ext.response.text().trim();
                    } catch (e) {}
                }

                const inlineKeyboard = { inline_keyboard: [[{ text: "💰 ငွေလွှဲမှန်ကန်ကြောင်း အတည်ပြုမည်", callback_data: `FINANCE_CONFIRM_${sender_psid}` }]] };
                await sendTelegramPhoto(
                    TELEGRAM_FINANCE_CHAT_ID, 
                    attachment.payload.url, 
                    `💰 *ငွေလွှဲပြေစာအသစ် ရောက်ရှိလာပါသည်*\n\n• *Customer ID:* \`${sender_psid}\`\n• *မှာယူထားသည့် ပစ္စည်း:* ${orderItems}\n\nလူသား Admin များ စစ်ဆေးပြီး ခလုတ်နှိပ်ပေးပါရန်။`,
                    inlineKeyboard
                );
                await sendFacebookMessage(sender_psid, "ငွေလွှဲပြေစာ ပေးပို့မှုအတွက် ကျေးဇူးတင်ပါတယ်ရှင်။ တာဝန်ရှိသူက စစ်ဆေးပြီးတာနဲ့ ချက်ချင်း အကြောင်းကြားပေးပါမည်။");
                continue;
            }
        }

        // ၂။ စာပို့လာလျှင် (လူတစ်ယောက်လို ဖြေဆိုမည့်စနစ်)
        if (webhook_event.message && webhook_event.message.text) {
            const userMessage = webhook_event.message.text;

            try {
                const itemsList = await getLiveShopInfo();
                const deliRules = await getTownshipData();

                const modelConfig = { 
                    model: "gemini-2.5-flash",
                    systemInstruction: `
သင်သည် ဆိုင်၏ အလွန်ယဉ်ကျေးသော လူသားအရောင်းဝန်ထမ်းတစ်ဦး ဖြစ်သည်။ စက်ရုပ်လို လုံးဝမဖြေပါနှင့်။
[စည်းကမ်းချက်နှင့် လုပ်ငန်းစဉ်အဆင့်ဆင့်]
၁။ Customer က ပစ္စည်းအကြောင်း၊ ဈေးနှုန်းမေးမြန်းပါက ဤစာရင်းအတိုင်း ညင်သာစွာ ဖြေပေးပါ-\n${itemsList}
၂။ Customer က ပစ္စည်းတစ်ခုခုကို ဝယ်ယူမည်/မှာယူမည်ဟု ပြောလာပါက သေချာပေါက် "ပို့ဆောင်ပေးရမည့် မြို့နယ်" ကို အရင်မေးမြန်းပါ။
၃။ Customer ပေးသော မြို့နယ်ကို ဤစည်းကမ်းချက်အတိုင်း တိုက်စစ်ပါ-\n${deliRules}
   - မြို့နယ်သည် COD ရသော စာရင်းထဲတွင် ပါဝင်ပါက: COD ရရှိကြောင်း ပြောပြပြီး (အမည်၊ ဖုန်း၊ လိပ်စာ) တောင်းခံပါ။
   - မြို့နယ်သည် COD မရပါက (သို့မဟုတ်) စာရင်းထဲမရှိပါက: ၎င်းမြို့နယ်သည် ငွေကြိုလွှဲရမည့် မြို့နယ်ဖြစ်ကြောင်း ကောင်းမွန်စွာ ရှင်းပြပြီး ငွေလွှဲရန် အကောင့်နံပါတ်ပေးကာ ငွေလွှဲပြေစာ Screenshot ပို့ခိုင်းပါ။
`
                };

                const chat = getValidChatSession(sender_psid, modelConfig);
                const result = await chat.sendMessage(userMessage);
                const aiReply = result.response.text();

                await sendFacebookMessage(sender_psid, aiReply);

                // Customer က အချက်အလက်တွေပေးပြီး COD မြို့နယ်ဖြစ်နေရင် Packing Group သို့ တန်းပို့မည့် ကဏ္ဍ
                const hasDetails = /(လိပ်စာ|အိမ်အမှတ်|လမ်း|မြို့)/i.test(userMessage) && /(09\d{7,9})/i.test(userMessage);
                const isCOD = /COD|အိမ်ရောက်ငွေချေ/i.test(aiReply); 

                if (hasDetails && isCOD) {
                    const history = await chat.getHistory();
                    let conversation = "";
                    history.forEach(t => conversation += `${t.parts[0].text}\n`);
                    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                    const ext = await model.generateContent(`အောက်ပါစာသားထဲမှ Customer ၏ (၁) အမည်၊ (၂) ဖုန်းနံပါတ်၊ (၃) လိပ်စာ၊ (၄) မှာယူသည့်ပစ္စည်း တို့ကိုသာ သန့်စင်စွာ ထုတ်ပေးပါ။\n\n${conversation}`);
                    
                    const inlineKeyboard = { inline_keyboard: [[{ text: "📦 ပါဆယ်ထုတ်ပြီးပြီ", callback_data: `PACKING_DONE_${sender_psid}` }]] };
                    await sendTelegramMessage(TELEGRAM_PACKING_CHAT_ID, `📦 *ပါဆယ်ထုတ်ရန် (COD အော်ဒါ)*\n\n${ext.response.text()}`, inlineKeyboard);
                }

            } catch (aiError) {
                await sendFacebookMessage(sender_psid, "လူကြီးမင်းရှင့်၊ ခဏနေမှ ထပ်မံမေးမြန်းပေးပါရှင့်။");
            }
        }
    }
    return res.status(200).send('EVENT_RECEIVED');
});

// 📥 Telegram Webhook Listener (Finance / Packing Button Callback)
app.post('/tg-webhook', async (req, res) => {
    const { callback_query } = req.body;
    if (!callback_query) return res.sendStatus(200);

    const data = callback_query.data;
    const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;

    // 💰 Finance Admin က Confirm နှိပ်လိုက်လျှင်
    if (data.startsWith("FINANCE_CONFIRM_")) {
        const psid = data.replace("FINANCE_CONFIRM_", "");

        // ၁။ Customer ဆီ စာပို့
        await sendFacebookMessage(psid, "လူကြီးမင်း ပို့ဆောင်ပေးသော ငွေလွှဲပြေစာကို စစ်ဆေးပြီးပါပြီရှင်။ ငွေလွှဲလက်ခံရရှိပါပြီ။ ပစ္စည်းများကို Packing ဌာနသို့ လွှဲပြောင်းပေးပို့လိုက်ပါပြီရှင်။ ဆိုင်ကို အားပေးမှုအတွက် ကျေးဇူးတင်ပါတယ်ရှင့်။");

        // ၂။ Chat History ထဲကနေ လိပ်စာ၊ ဖုန်း၊ ပစ္စည်း အနှစ်ချုပ်ဆွဲထုတ်ပြီး Packing Group သို့ လှမ်းပို့ခြင်း
        let cleanSpecs = "အချက်အလက်များကို ဆွဲယူ၍မရပါ။";
        if (chatSessions[psid]) {
            try {
                const history = await chatSessions[psid].session.getHistory();
                let conversation = "";
                history.forEach(t => conversation += `${t.parts[0].text}\n`);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const ext = await model.generateContent(`အောက်ပါစာသားထဲမှ Customer ၏ (၁) အမည်၊ (၂) ဖုန်းနံပါတ်၊ (၃) လိပ်စာ၊ (၄) မှာယူသည့်ပစ္စည်း တို့ကိုသာ သန့်စင်စွာ ထုတ်ပေးပါ။ Chat list ကြီး မပါရပါ။\n\n${conversation}`);
                cleanSpecs = ext.response.text();
            } catch (e) {}
        }

        const inlineKeyboard = { inline_keyboard: [[{ text: "📦 ပါဆယ်ထုတ်ပြီးပြီ", callback_data: `PACKING_DONE_${psid}` }]] };
        await sendTelegramMessage(TELEGRAM_PACKING_CHAT_ID, `📦 *ပါဆယ်ထုတ်ရန် (ငွေကြိုလွှဲအော်ဒါ)*\n\n${cleanSpecs}`, inlineKeyboard);

        // ၃။ Finance Message ကို Status ပြောင်းခြင်း
        try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageCaption`, {
                chat_id: callback_query.message.chat.id,
                message_id: callback_query.message.message_id,
                caption: callback_query.message.caption + "\n\n✅ *[ငွေလွှဲစစ်ဆေးပြီး - Packing သို့ ပို့ဆောင်ပြီးပါပြီ]*",
                parse_mode: 'Markdown'
            });
        } catch (e) {}
    }

    // 📦 Packing Admin က Confirm နှိပ်လိုက်လျှင်
    if (data.startsWith("PACKING_DONE_")) {
        const psid = data.replace("PACKING_DONE_", "");
        
        // Customer ဆီ စာပို့
        await sendFacebookMessage(psid, "လူကြီးမင်းမှာယူထားသော ပါဆယ်ကို ထုပ်ပိုးပြင်ဆင်ပြီးစီးသွားပြီ ဖြစ်ပါသဖြင့် ဂိတ်/Deli သို့ လွှဲပြောင်းအပ်နှံပေးလိုက်ပြီ ဖြစ်ကြောင်း သတင်းကောင်းပါးအပ်ပါတယ်ရှင်။ 📦✨");

        // Packing Message ကို Status ပြောင်းခြင်း
        try {
            await axios.post(tgUrl, {
                chat_id: callback_query.message.chat.id,
                message_id: callback_query.message.message_id,
                text: callback_query.message.text + "\n\n✅ *[ပါဆယ်ထုတ်ပိုးပြီးကြောင်း Customer ထံ စာပို့ပြီးပါပြီ]*"
            });
        } catch (e) {}
    }

    return res.sendStatus(200);
});

async function sendFacebookMessage(sender_psid, text) {
    if (!PAGE_ACCESS_TOKEN) return;
    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    try { await axios.post(url, { recipient: { id: sender_psid }, message: { text: text } }); } catch (e) {}
}

app.listen(PORT, '0.0.0.0', () => console.log(`Live Automated Shop running on port ${PORT}`));
