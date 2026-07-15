const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_FINANCE_CHAT_ID = process.env.TELEGRAM_FINANCE_CHAT_ID;
const TELEGRAM_PACKING_CHAT_ID = process.env.TELEGRAM_PACKING_CHAT_ID;

// Official SDK ကို အသုံးပြုခြင်း
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatSessions = {};

// Google Sheet Data
async function getSheetData() {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    let itemsText = "1. Power Bank - 35,000 ကျပ်\n2. Earbuds - 28,000 ကျပ်\n";
    let deliRules = "- ရန်ကုန်/မန္တလေး: ပို့ဆောင်ခ ၃,၀၀၀ ကျပ် (COD ရ)\n- ကျန်မြို့များ: ပို့ဆောင်ခ ၄,၀၀၀ ကျပ် (ငွေကြိုလွှဲ)\n";
    if (!sheetId) return { itemsText, deliRules };
    try {
        const response = await axios.get(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`);
        return { itemsText: "ပစ္စည်းစာရင်းမှန်ကန်စွာ ရရှိပါပြီ။", deliRules: "ပို့ဆောင်ခ စည်းကမ်းချက်များ ရရှိပါပြီ။" };
    } catch (e) { return { itemsText, deliRules }; }
}

// Telegram Utils
async function sendTelegram(chatId, text, kb = null) {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: kb });
}

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (const entry of body.entry) {
            const event = entry.messaging[0];
            const psid = event.sender.id;

            // Initialize Model
            const model = genAI.getGenerativeModel({ 
                model: "gemini-1.5-flash",
                systemInstruction: "သင်သည် Smart Zone ဆိုင်၏ အရောင်းဝန်ထမ်းဖြစ်သည်။ ပစ္စည်းစာရင်းနှင့် ဈေးနှုန်းကို ပြောပြပါ။ ဝယ်မည်ဆိုပါက မြို့နယ်မေးပြီး COD ရမရ ပြောပြပါ။ အချက်အလက်စုံလျှင် Confirm ခလုတ်ပေးပါ။"
            });

            if (!chatSessions[psid]) chatSessions[psid] = model.startChat();

            if (event.message && event.message.text) {
                const result = await chatSessions[psid].sendMessage(event.message.text);
                const reply = result.response.text();
                await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                    recipient: { id: psid }, message: { text: reply }
                });
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));
