const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_token";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Telegram & Config
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
    if (!sheetId) return "ရန်ကုန်/မန္တလေး COD ရပြီး ကျန်မြို့များ ငွေကြိုလွှဲရပါမည်။";
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    try {
        const response = await axios.get(url);
        const lines = response.data.split('\n');
        let deliRules = "နောက်ဆက်တွဲ ပို့ဆောင်ရေးလမ်းညွှန်ချက်-\n";
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = line.split(',');
            const town = cols[0] ? cols[0].replace(/"/g, '').trim() : '';
            const deli = cols[1] ? cols[1].replace(/"/g, '').trim() : '';
            const type = cols[2] ? cols[2].replace(/"/g, '').trim() : 'Prepaid';
            
            if (town) {
                deliRules += `- မြို့နယ်: ${town} ဖြစ်ပါက ပို့ဆောင်ခ ${deli} ကျပ် ဖြစ်ပြီး ${type === 'COD' ? 'အိမ်ရောက်ငွေချေ (COD)' : 'ငွေကြိုလွှဲ'} ရပါမည်။\n`;
            }
        }
        deliRules += "မှတ်ချက် - အထက်ပါစာရင်းထဲတွင် မပါသော မြို့နယ်အားလုံးသည် ပို့ဆောင်ခ ၄,၀၀၀ ကျပ် ဖြစ်ပြီး သေချာပေါက် 'ငွေကြိုလွှဲ' ရပါမည်။\n";
        return deliRules;
    } catch (e) {
        return "ရန်ကုန်/မန္တလေး COD ရပြီး ကျန်မြို့များ ငွေကြိုလွှဲရပါမည်။";
    }
}

// ✈️ Telegram Functions
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try { await axios.post(url, payload); } catch (e) { console.error("TG send error:", e.message); }
}

async function sendTelegramPhoto(chatId, photoUrl, caption) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    try { await axios.post(url, { chat_id: chatId, photo: photoUrl, caption: caption }); } catch (e) {}
}

app.get('/', (req, res) => res.status(200).send('Advance AI Sales Workflow running...'));
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        return res.status(200).send(req.query['hub.challenge']);
    }
    return res.sendStatus(403);
});

// 📥 Facebook Webhook Listener
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);

    for (const entry of body.entry) {
        if (!entry.messaging) continue;
        const webhook_event = entry.messaging[0];
        const sender_psid = webhook_event.sender.id;

        // 🔘 ကလစ်နှိပ်ချက် (Postback Buttons) များကို ကိုင်တွယ်ခြင်း
        if (webhook_event.postback) {
            const payload = webhook_event.postback.payload;
            
            if (payload.startsWith("CONFIRM_ORDER_")) {
                const psid = payload.replace("CONFIRM_ORDER_", "");
                
                // AI Memory ထဲကနေ မှာယူတဲ့အချက်အလက်ကို Extraction လုပ်ပြီး သန့်စင်ရန် တောင်းခြင်း
                let finalOrderText = "အချက်အလက် မပြည့်စုံပါ။";
                if (chatSessions[psid]) {
                    try {
                        const history = await chatSessions[psid].session.getHistory();
                        let conversation = "";
                        history.forEach(t => conversation += `${t.role === 'user' ? 'Cust' : 'AI'}: ${t.parts[0].text}\n`);
                        
                        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                        const extraction = await model.generateContent(
                            `အောက်ပါ စကားပြောဆိုမှုထဲမှ Customer ၏ (၁) အမည်၊ (၂) ဖုန်းနံပါတ်၊ (၃) လိပ်စာ၊ (၄) မှာယူသည့်ပစ္စည်းနှင့် အရေအတွက် တို့ကိုသာ သန့်စင်စွာ ထုတ်ပေးပါ။ Chat list ကြီး မလိုချင်ပါ။\n\n${conversation}`
                        );
                        finalOrderText = extraction.response.text();
                    } catch (e) { finalOrderText = "အော်ဒါ အတည်ပြုပြီးပါပြီ။"; }
                }

                // Inline Confirm Button ပါဝင်သော Telegram Packing Group သို့ ပို့ခြင်း
                const inlineKeyboard = {
                    inline_keyboard: [[{ text: "📦 ပါဆယ်ထုတ်ပြီးပြီ", callback_data: `PACKED_${psid}` }]]
                };
                
                await sendTelegramMessage(
                    TELEGRAM_PACKING_CHAT_ID, 
                    `📦 *ပါဆယ်ထုတ်ရန် အော်ဒါအသစ်*\n\n${finalOrderText}`, 
                    inlineKeyboard
                );

                await sendFacebookMessage(psid, "ကျေးဇူးတင်ပါတယ်ရှင့်။ လူကြီးမင်း၏ အော်ဒါကို အတည်ပြုပြီး Packing ဌာနသို့ လွှဲပြောင်းပေးလိုက်ပါပြီ။ ပစ္စည်းထုတ်ပြီးပါက ထပ်မံအကြောင်းကြားပေးပါမည်။");
            }
            continue;
        }

        // ၁။ Screenshot ပို့လာလျှင် -> Finance Group
        if (webhook_event.message && webhook_event.message.attachments) {
            const attachment = webhook_event.message.attachments[0];
            if (attachment.type === 'image') {
                await sendTelegramPhoto(TELEGRAM_FINANCE_CHAT_ID, attachment.payload.url, `💰 *ငွေလွှဲပြေစာ*\nCustomer PSID: \`${sender_psid}\``);
                await sendFacebookMessage(sender_psid, "ငွေလွှဲပြေစာ လက်ခံရရှိပါပြီ။ တာဝန်ရှိသူ စစ်ဆေးပေးပါမည်။");
                continue;
            }
        }

        // ၂။ စာပို့လာလျှင်
        if (webhook_event.message && webhook_event.message.text) {
            const userMessage = webhook_event.message.text;

            try {
                const deliRules = await getTownshipData();
                const modelConfig = { 
                    model: "gemini-2.5-flash",
                    systemInstruction: `
သင်သည် ဆိုင်၏ AI အရောင်းဝန်ထမ်း ဖြစ်သည်။ မြန်မာဘာသာဖြင့် ဖြေပါ။
${deliRules}
[စည်းကမ်းချက်] 
- Customer က ဝယ်ယူရန် အမည်၊ ဖုန်း၊ လိပ်စာ၊ ပစ္စည်းစာရင်း ပေးပြီးပါက အော်ဒါအနှစ်ချုပ်ကို ပြပြီး "အောက်ပါ ခလုတ်ကို နှိပ်၍ အော်ဒါ အတည်ပြုပေးပါ" ဟု ပြောပါ။ 
- Customer က အတည်မပြုမချင်း Packing ဌာနသို့ မပို့နိုင်ကြောင်း သတိပေးပါ။
`
                };

                const chat = getValidChatSession(sender_psid, modelConfig);
                const result = await chat.sendMessage(userMessage);
                const aiReply = result.response.text();

                // အကယ်၍ AI က အော်ဒါအနှစ်ချုပ်ပြီး အတည်ပြုခိုင်းနေပြီဆိုလျှင် Facebook Button ပြပေးမည်
                const isReadyToConfirm = /(အတည်ပြု|ခလုတ်)/i.test(aiReply);
                
                if (isReadyToConfirm) {
                    await sendFacebookButtonMessage(sender_psid, aiReply, sender_psid);
                } else {
                    await sendFacebookMessage(sender_psid, aiReply);
                }

            } catch (aiError) {
                await sendFacebookMessage(sender_psid, "လူကြီးမင်းရှင့်၊ ခဏနေမှ ထပ်မံမေးမြန်းပေးပါရှင့်။");
            }
        }
    }
    return res.status(200).send('EVENT_RECEIVED');
});

// 📥 Telegram Webhook (Bot Callback Buttons ဖတ်ရန်)
app.post('/tg-webhook', async (req, res) => {
    const { callback_query } = req.body;
    if (callback_query && callback_query.data.startsWith("PACKED_")) {
        const psid = callback_query.data.replace("PACKED_", "");
        
        // Facebook Customer ဆီ စာလှမ်းပို့ခြင်း
        await sendFacebookMessage(psid, "လူကြီးမင်းမှာယူထားသော ပါဆယ်ကို ထုပ်ပိုးပြီးစီး၍ ဂိတ်/Deli သို့ အပ်နှံလိုက်ပြီ ဖြစ်ပါကြောင်း ဝမ်းမြောက်စွာ အကြောင်းကြားအပ်ပါတယ်ရှင်။ 📦✨");
        
        // Telegram Group ထဲက စာကို Update လုပ်ပြီး ခလုတ်ဖြုတ်ခြင်း
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
        try {
            await axios.post(url, {
                chat_id: callback_query.message.chat.id,
                message_id: callback_query.message.message_id,
                text: callback_query.message.text + "\n\n✅ *[ပါဆယ်ထုတ်ပြီးကြောင်း Customer ထံ အကြောင်းကြားပြီးပါပြီ]*"
            });
        } catch (e) {}
    }
    return res.sendStatus(200);
});

// Facebook Standard Messages
async function sendFacebookMessage(sender_psid, text) {
    if (!PAGE_ACCESS_TOKEN) return;
    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    try { await axios.post(url, { recipient: { id: sender_psid }, message: { text: text } }); } catch (e) {}
}

// Facebook Button Messages
async function sendFacebookButtonMessage(sender_psid, text, payloadId) {
    if (!PAGE_ACCESS_TOKEN) return;
    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    const payload = {
        recipient: { id: sender_psid },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: text,
                    buttons: [{ type: "postback", title: "🛒 ဝယ်ယူမည် (Confirm)", payload: `CONFIRM_ORDER_${payloadId}` }]
                }
            }
        }
    };
    try { await axios.post(url, payload); } catch (e) {}
}

app.listen(PORT, '0.0.0.0', () => console.log(`Advance Systems running on port ${PORT}`));
