const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_token";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Gemini Config
const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;
if (apiKey) {
    genAI = new GoogleGenerativeAI(apiKey);
}

// 📊 Google Sheet ထဲက ပစ္စည်းစာရင်းကို ဆွဲယူမည့် Function
async function getLiveShopInfo() {
    const sheetId = process.env.GOOGLE_SHEET_ID; // Render Environment ထဲမှာ ထည့်ပေးရမည်
    if (!sheetId) {
        console.error("GOOGLE_SHEET_ID is missing!");
        return "လက်ရှိတွင် ပစ္စည်းစာရင်း အချက်အလက်များ မရနိုင်သေးပါ။";
    }

    // Google Sheet ကို JSON အဖြစ် ပြောင်းလဲဖတ်ရှုသည့် တရားဝင် URL
    const url = https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json;

    try {
        const response = await axios.get(url);
        // Google ရဲ့ JSON Format ထဲက စာသားများကို သန့်စင်ခြင်း
        const jsonString = response.data.match(/google\.visualization\.Query\.setResponse\(([\s\S\n]*)\);/)[1];
        const data = JSON.parse(jsonString);
        
        const rows = data.table.rows;
        let itemsText = "";
        
        rows.forEach((row, index) => {
            const product name = row.c[0] ? row.c[0].v : '';
            const price = row.c[1] ? row.c[1].v : '';
            const stock = row.c[2] ? row.c[2].v : '';
            if (name) {
                itemsText += ${index + 1}. ${name} - ${price} ကျပ် (${details})\n;
            }
        });

        // AI သို့ ပေးမည့် ဆိုင်နောက်ခံဇာတ်ညွှန်း
        return 
သင်သည် "Smart Zone" ဆိုင်၏ တက်ကြွသော AI အရောင်းဝန်ထမ်း ဖြစ်သည်။
လူကြီးမင်းတို့၏ မေးခွန်းများကို မြန်မာဘာသာဖြင့် သာယာပျော့ပျောင်းစွာ ပြန်လည်ဖြေကြားပေးရမည်။

[ဆိုင်ရှိ ပစ္စည်းများနှင့် ဈေးနှုန်းများ (Google Sheet မှ တိုက်ရိုက်ရရှိသော Live Data)]
${itemsText}

[ပို့ဆောင်ခနှင့် ငွေချေစနစ်]
- ရန်ကုန်/မန္တလေး အိမ်ရောက်ငွေချေ (ပို့ဆောင်ခ ၃,၀၀၀ ကျပ်)
- နယ်မြို့များ ငွေကြိုလွှဲရမည် (ပို့ဆောင်ခ ၄,၀၀၀ ကျပ်)

[စည်းကမ်းချက်]
- ဝယ်ယူလိုပါက အမည်၊ ဖုန်းနံပါတ်နှင့် လိပ်စာ တောင်းခံပါ။
;
    } catch (error) {
        console.error("Error fetching Google Sheet:", error.message);
        return "ဆိုင်တွင် ပစ္စည်းများ ရောင်းချပေးနေပါသည်။ ဈေးနှုန်းများကို မေးမြန်းနိုင်ပါသည်။";
    }
}

app.get('/', (req, res) => {
    res.status(200).send('Facebook AI Sales Agent with Google Sheet is running...');
});

// Webhook Verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

// Webhook Listener
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        if (!body.entry || !Array.isArray(body.entry)) return res.sendStatus(200);

        for (const entry of body.entry) {
            if (!entry.messaging || !Array.isArray(entry.messaging)) continue;
            
            const webhook_event = entry.messaging[0];
            if (!webhook_event  !webhook_event.sender  !webhook_event.message || !webhook_event.message.text) continue;

            const sender_psid = webhook_event.sender.id;
            const userMessage = webhook_event.message.text;
            console.log(Customer: ${userMessage});

            if (!genAI) {
                await sendFacebookMessage(sender_psid, "စနစ်ပြင်ဆင်နေဆဲဖြစ်၍ ခေတ္တစောင့်ဆိုင်းပေးပါ။");
                continue;
            }

            try {
                // Customer စာပို့လာတိုင်း Google Sheet ထဲက အချက်အလက်အသစ်ကို လှမ်းဆွဲမည်
                const dynamicShopInfo = await getLiveShopInfo();

                const model = genAI.getGenerativeModel({model: "gemini-1.5-flash",
                    systemInstruction: dynamicShopInfo 
                });

                const result = await model.generateContent(userMessage);
                const response = await result.response;
                const aiReply = response.text();
                
                console.log(`AI Reply: ${aiReply}`);
                await sendFacebookMessage(sender_psid, aiReply);

            } catch (aiError) {
                console.error('Gemini Error:', aiError.message);
                await sendFacebookMessage(sender_psid, "လူကြီးမင်းရှင့်၊ ခဏနေမှ ထပ်မံမေးမြန်းပေးပါရှင့်။");
            }
        }
        return res.status(200).send('EVENT_RECEIVED');
    }
    return res.sendStatus(404);
});

// Send Message Function
async function sendFacebookMessage(sender_psid, text) {
    if (!PAGE_ACCESS_TOKEN) return;
    const url = https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN};
    const payload = {
        recipient: { id: sender_psid },
        message: { text: text }
    };
    try {
        await axios.post(url, payload);
    } catch (error) {
        console.error('Error sending message:', error.message);
    }
}

app.listen(PORT, '0.0.0.0', () => console.log(`Live Sales Agent running on port ${PORT}`));
