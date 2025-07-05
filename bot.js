// استدعاء المكتبات اللازمة
require('dotenv').config(); // لتحميل المتغيرات من ملف .env أثناء التطوير المحلي
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// --- إعدادات البوت والمعلومات الحساسة ---
// يتم قراءة هذه القيم من متغيرات البيئة في Render أو من ملف .env المحلي
const token = process.env.TELEGRAM_BOT_TOKEN;
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const adminId = process.env.ADMIN_ID;

// التحقق من وجود المتغيرات لضمان عدم حدوث خطأ عند التشغيل
if (!token || !deepseekApiKey || !adminId) {
    console.error("خطأ فادح: أحد المتغيرات المطلوبة (TELEGRAM_BOT_TOKEN, DEEPSEEK_API_KEY, ADMIN_ID) غير موجود.");
    process.exit(1); // إيقاف التشغيل إذا كانت المعلومات ناقصة
}

// تهيئة البوت باستخدام طريقة الـ "Polling"
const bot = new TelegramBot(token, { polling: true });

// --- قوانين المجموعة ---
const groupRules = `
١- الاحترام المتبادل بين الأعضاء.
٢- يمنع استخدام الألفاظ النابية أو الشتم أو الإهانة.
٣- يمنع نشر الروابط أو الإعلانات.
٤- يمنع ذكر أسماء الأشخاص أو بياناتهم الشخصية.
٥- يمنع نشر الصور أو المقاطع المخلة بالآداب أو المسيئة.
٦- يمنع النقاشات الخارجة عن الأدب العام أو إثارة الفتن.
٧- يمنع التلميح أو التهديد أو التحريض أو التنمر بكافة أشكاله.
`;

/**
 * دالة لتحليل الرسالة باستخدام DeepSeek AI
 * @param {string} messageText - نص الرسالة المراد تحليلها
 * @returns {Promise<object>} - كائن يحتوي على نتيجة التحليل
 */
async function analyzeMessageWithAI(messageText) {
    const prompt = `
        أنت مشرف ذكاء اصطناعي في مجموعة تلجرام. هذه هي قوانين المجموعة:
        ${groupRules}
        مهمتك هي تحليل الرسالة التالية: "${messageText}"
        وتحديد ما إذا كانت تنتهك أيًا من هذه القوانين.
        أجب بصيغة JSON فقط بدون أي نص إضافي. يجب أن يحتوي الـ JSON على حقلين:
        1. "isViolation" (boolean: true إذا كانت هناك مخالفة, false إذا لم تكن).
        2. "reason" (string: شرح مختصر للمخالفة باللغة العربية، أو "لا توجد مخالفة").
    `;

    try {
        const response = await axios.post(
            'https://api.deepseek.com/v1/chat/completions',
            {
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: 'You are a content moderator bot that only responds in JSON format.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 150,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${deepseekApiKey}`
                }
            }
        );
        
        const resultText = response.data.choices[0].message.content;
        console.log('AI Response:', resultText);
        const cleanedResult = resultText.match(/{.*}/s);
        return JSON.parse(cleanedResult[0]);

    } catch (error) {
        console.error('خطأ أثناء التواصل مع DeepSeek API:', error.response ? error.response.data : error.message);
        return { isViolation: false, reason: "فشل تحليل الذكاء الاصطناعي" };
    }
}

// --- المستمع الرئيسي لرسائل البوت ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;
    const messageText = msg.text || msg.caption || '';

    // تجاهل رسائل الأدمن بشكل كامل
    if (userId.toString() === adminId) return;

    // 1. الفحص السريع: حظر الروابط (القانون ٣)
    const linkRegex = /http[s]?:\/\/[^\s]+|www\.[^\s]+|\.[a-z]{2,}(\/|$)/i;
    if (linkRegex.test(messageText)) {
        console.log(`تم اكتشاف رابط من المستخدم ${userId}. سيتم حذف الرسالة.`);
        try {
            await bot.deleteMessage(chatId, messageId);
            await bot.sendMessage(adminId, `🚨 **تم حذف رسالة (رابط)**\n- **المستخدم:** ${msg.from.first_name} (${userId})\n- **الرسالة:** "${messageText}"`, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error("خطأ في حذف رسالة الرابط:", e.message);
        }
        return;
    }

    // 2. الفحص المتقدم بالذكاء الاصطناعي (إذا كان هناك نص)
    if (messageText) {
        const analysis = await analyzeMessageWithAI(messageText);
        if (analysis && analysis.isViolation) {
            console.log(`مخالفة AI: ${analysis.reason}. سيتم حذف الرسالة.`);
            try {
                await bot.deleteMessage(chatId, messageId);
                await bot.sendMessage(adminId, `🤖 **تم حذف رسالة (AI)**\n- **السبب:** ${analysis.reason}\n- **المستخدم:** ${msg.from.first_name} (${userId})\n- **الرسالة:** "${messageText}"`, { parse_mode: 'Markdown' });
            } catch (e) {
                console.error("خطأ في حذف رسالة AI:", e.message);
            }
        }
    }
});

// --- إعداد خادم الويب للبقاء نشطًا على Render ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('البوت المشرف يعمل!');
});

app.listen(port, () => {
  console.log(`خادم الويب يعمل على المنفذ ${port}`);
});

console.log('✅ البوت يعمل الآن ويراقب المجموعة...');

// معالجة أخطاء الاتصال
bot.on('polling_error', (error) => {
    console.error(`خطأ في الاتصال بالتليجرام: ${error.code}`);
});
