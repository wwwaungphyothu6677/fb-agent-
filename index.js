const express = require('express');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai'); 
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// API Key စစ်ဆေးခြင်း (မရှိရင် error မတက်အောင် ကြိုကာကွယ်ထားတာပါ)
const apiKey = process.env.GEMINI_API_KEY;
let ai;
if (apiKey) {
    ai = new GoogleGenAI({ apiKey: apiKey });
} else {
    console.error("WARNING: GEMINI_API_KEY is not defined in Environment Variables!");
}

app.get('/', (req, res) => {
    res.send('Facebook Gemini AI Agent is running perfectly...');
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

// Facebook Webhook Listener
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        // map/for loops ထဲမှာ async/await သုံးရင် ကွဲလွဲတတ်လို့ ရိုးရိုး for loop သုံးပါမယ်
        for (const entry of body.entry) {
            if (!entry.messaging) continue;
            
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                const userMessage = webhook_event.message.text;
                console.log(`User Sent: ${userMessage}`);

                if (!ai) {
                    await sendFacebookMessage(sender_psid, "စနစ်ပြင်ဆင်မှု လိုအပ်နေပါသဖြင့် ခေတ္တစောင့်ဆိုင်းပေးပါ။");
                    continue;
                }

                try {
                    // Gemini SDK ခေါ်ဆိုမှု
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: userMessage,
                    });

                    const aiReply = response.text || "နားမလည်နိုင်ဖြစ်သွားလို့ ထပ်မံပြောကြားပေးပါ။";
                    console.log(`Gemini Reply: ${aiReply}`);
                    await sendFacebookMessage(sender_psid, aiReply);

                } catch (aiError) {
                    console.error('Gemini API Error Detail:', aiError.message);
                    await sendFacebookMessage(sender_psid, "ခေတ္တအဆင်မပြေဖြစ်သွားလို့ ခဏနေမှ ထပ်စမ်းကြည့်ပေးပါ။");
                }
            }
        }
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
        console.log('Message sent successfully to:', sender_psid);
    } catch (error) {
        console.error('Error sending message:', error.response ? error.response.data : error.message);
    }
}

app.listen(PORT, () => console.log(`Server is successfully running on port ${PORT}`));
