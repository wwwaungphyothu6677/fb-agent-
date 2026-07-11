const express = require('express');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai'); // Gemini SDK ကို ခေါ်ယူခြင်း
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Gemini AI ကို စတင်သတ်မှတ်ခြင်း
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.get('/', (req, res) => {
    res.send('Facebook Gemini AI Agent is running...');
});

// Facebook Webhook Verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// Facebook က စာဝင်လာရင် ဖတ်ပြီး Gemini နဲ့ ပြန်ဖြေမယ့်နေရာ
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(async (entry) => {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                const userMessage = webhook_event.message.text;
                console.log(`User Sent: ${userMessage}`);

                try {
                    // Gemini API သို့ မေးခွန်းပို့ပြီး အဖြေတောင်းခြင်း (gemini-2.5-flash မော်ဒယ်ကို သုံးထားပါတယ်)
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: userMessage,
                    });

                    const aiReply = response.text;
                    console.log(`Gemini Reply: ${aiReply}`);

                    // ရလာတဲ့ AI အဖြေကို Facebook Page ဆီ ပြန်ပို့ခြင်း
                    await sendFacebookMessage(sender_psid, aiReply);

                } catch (aiError) {
                    console.error('Gemini API Error:', aiError);
                    await sendFacebookMessage(sender_psid, "စိတ်မရှိပါနဲ့၊ တစ်ခုခုလွဲချော်သွားလို့ နောက်မှ ထပ်မေးပေးပါခင်ဗျာ။");
                }
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Facebook စာပြန်ပို့သည့် Function
async function sendFacebookMessage(sender_psid, text) {
    const url = https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN};
    const payload = {
        recipient: { id: sender_psid },
        message: { text: text }
    };

    try {
        await axios.post(url, payload);
        console.log('Message sent successfully');
    } catch (error) {
        console.error('Error sending message:', error.response ? error.response.data : error.message);
    }
}

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
