const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // ရေးထုံးမှန်ပြောင်းလဲခြင်း
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Gemini configuration
const apiKey = process.env.GEMINI_API_KEY;
let genAI;
if (apiKey) {
    genAI = new GoogleGenerativeAI(apiKey); // သန့်ရှင်းသော object တည်ဆောက်မှု
} else {
    console.error("WARNING: GEMINI_API_KEY is missing!");
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

// Webhook Listener
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            if (!entry.messaging) continue;
            
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                const userMessage = webhook_event.message.text;
                console.log(`User Sent: ${userMessage}`);

                if (!genAI) {
                    await sendFacebookMessage(sender_psid, "AI စနစ် ပြင်ဆင်မှု လိုအပ်နေပါသည်။");
                    continue;
                }

                try {
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    const result = await model.generateContent(userMessage);
                    const response = await result.response;
                    const aiReply = response.text();
                    
                    console.log(`Gemini Reply: ${aiReply}`);
                    await sendFacebookMessage(sender_psid, aiReply);

                } catch (aiError) {
                    console.error('Gemini Error:', aiError.message);
                    await sendFacebookMessage(sender_psid, "ခေတ္တအဆင်မပြေဖြစ်သွားလို့ နောက်မှ ထပ်စမ်းကြည့်ပါ။");
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Facebook Send Message Function
async function sendFacebookMessage(sender_psid, text) {
    const url = 'https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}';
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

app.listen(PORT, () => console.log(`Server is successfully running on port ${PORT}`));
