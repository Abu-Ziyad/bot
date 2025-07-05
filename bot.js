// استدعاء المكتبات اللازمة
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// --- إعدادات البوت والمعلومات الحساسة ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const adminId = process.env.ADMIN_ID;

if (!token || !deepseekApiKey || !adminId) {
    console.error("خطأ فادح: أحد المتغيرات المطلوبة (TELEGRAM_BOT_TOKEN, DEEPSEEK_API_KEY, ADMIN_ID) غير موجود.");
    process.exit(1);
}

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

// --- [إضافة جديدة] لوحة تحكم الأدمن (Inline Keyboard) ---
const adminKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: 'ℹ️ معلومات المجموعة', callback_data: 'admin_group_info' },
                { text: '📜 عرض القوانين', callback_data: 'admin_show_rules' }
            ],
            [
                { text: '❌ إغلاق', callback_data: 'admin_close_panel' }
            ]
        ]
    }
};

/**
 * دالة لتحليل الرسالة باستخدام DeepSeek AI (بدون تغيير)
 */
async function analyzeMessageWithAI(messageText) {
    // ... (الكود الخاص بهذه الدالة يبقى كما هو تماماً)
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
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', { model: 'deepseek-chat', messages: [{ role: 'system', content: 'You are a content moderator bot that only responds in JSON format.' }, { role: 'user', content: prompt }], temperature: 0.1, max_tokens: 150, }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekApiKey}` } });
        const resultText = response.data.choices[0].message.content;
        console.log('AI Response:', resultText);
        const cleanedResult = resultText.match(/{.*}/s);
        return JSON.parse(cleanedResult[0]);
    } catch (error) {
        console.error('خطأ أثناء التواصل مع DeepSeek API:', error.response ? error.response.data : error.message);
        return { isViolation: false, reason: "فشل تحليل الذكاء الاصطناعي" };
    }
}

// --- [إضافة جديدة] معالج أوامر الأدمن ---

// أمر /admin لفتح لوحة التحكم
bot.onText(/\/admin/, (msg) => {
    const userId = msg.from.id;
    // التأكد من أن المستخدم هو الأدمن
    if (userId.toString() === adminId) {
        bot.sendMessage(msg.chat.id, 'أهلاً بك في لوحة تحكم الأدمن:', adminKeyboard);
    }
});

// أمر /ban لحظر عضو (يجب استخدامه بالرد على رسالة العضو)
bot.onText(/\/ban/, async (msg) => {
    const userId = msg.from.id;
    if (userId.toString() !== adminId) return; // فقط الأدمن يمكنه الحظر

    if (msg.reply_to_message) {
        const userToBan = msg.reply_to_message.from;
        const chatId = msg.chat.id;
        try {
            await bot.banChatMember(chatId, userToBan.id);
            await bot.sendMessage(chatId, `✅ تم حظر المستخدم ${userToBan.first_name} (${userToBan.id}) بنجاح.`);
        } catch (e) {
            bot.sendMessage(chatId, `❌ حدث خطأ أثناء محاولة الحظر. تأكد من أن البوت لديه صلاحيات الحظر.`);
        }
    } else {
        bot.sendMessage(msg.chat.id, '⚠️ لاستخدام أمر الحظر، يرجى الرد على رسالة الشخص الذي تريد حظره ثم اكتب `/ban`.');
    }
});

// أمر /kick لطرد عضو
bot.onText(/\/kick/, async (msg) => {
    const userId = msg.from.id;
    if (userId.toString() !== adminId) return;

    if (msg.reply_to_message) {
        const userToKick = msg.reply_to_message.from;
        const chatId = msg.chat.id;
        try {
            await bot.kickChatMember(chatId, userToKick.id);
            await bot.sendMessage(chatId, `✅ تم طرد المستخدم ${userToKick.first_name} (${userToKick.id}). يمكنه الانضمام مجددًا.`);
        } catch (e) {
            bot.sendMessage(chatId, `❌ حدث خطأ أثناء محاولة الطرد. تأكد من أن البوت لديه صلاحيات الحظر.`);
        }
    } else {
        bot.sendMessage(msg.chat.id, '⚠️ لاستخدام أمر الطرد، يرجى الرد على رسالة الشخص الذي تريد طرده ثم اكتب `/kick`.');
    }
});


// --- [إضافة جديدة] معالج ضغطات أزرار لوحة التحكم ---
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;

    // تأكد من أن من ضغط الزر هو الأدمن
    if (userId.toString() !== adminId) {
        // إرسال رد صامت لإزالة علامة التحميل من الزر
        return bot.answerCallbackQuery(callbackQuery.id, { text: 'هذه اللوحة خاصة بالأدمن فقط!', show_alert: true });
    }

    switch (data) {
        case 'admin_group_info':
            const chatId = msg.chat.id;
            const memberCount = await bot.getChatMemberCount(chatId);
            const infoText = `
*معلومات المجموعة:*
- **ID المجموعة:** \`${chatId}\`
- **عدد الأعضاء:** ${memberCount}
            `;
            bot.editMessageText(infoText, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: adminKeyboard.reply_markup });
            break;

        case 'admin_show_rules':
            const rulesText = `*القوانين الحالية التي يطبقها البوت:* \n\n${groupRules}`;
            bot.editMessageText(rulesText, { chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: adminKeyboard.reply_markup });
            break;

        case 'admin_close_panel':
            bot.deleteMessage(msg.chat.id, msg.message_id);
            break;
    }

    // إرسال رد لتأكيد الضغط على الزر
    bot.answerCallbackQuery(callbackQuery.id);
});


// --- المستمع الرئيسي للرسائل (المراقبة التلقائية) ---
bot.on('message', async (msg) => {
    // تجاهل الأوامر لتجنب معالجتها مرتين
    if (msg.text && msg.text.startsWith('/')) return;

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
app.get('/', (req, res) => { res.send('البوت المشرف يعمل!'); });
app.listen(port, () => { console.log(`خادم الويب يعمل على المنفذ ${port}`); });

console.log('✅ البوت يعمل الآن ويراقب المجموعة...');
bot.on('polling_error', (error) => { console.error(`خطأ في الاتصال بالتليجرام: ${error.code}`); });
