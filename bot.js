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

// --- نصوص ورسائل البوت ---
const groupRulesText = `
١- الاحترام المتبادل بين الأعضاء.
٢- يمنع استخدام الألفاظ النابية أو الشتم أو الإهانة.
٣- يمنع نشر الروابط أو الإعلانات.
٤- يمنع ذكر أسماء الأشخاص أو بياناتهم الشخصية.
٥- يمنع نشر الصور أو المقاطع المخلة بالآداب أو المسيئة.
٦- يمنع النقاشات الخارجة عن الأدب العام أو إثارة الفتن.
٧- يمنع التلميح أو التهديد أو التحريض أو التنمر بكافة أشكاله.
`;
const fullRulesMessage = `📌 *قوانين مجموعة النقاش (هام):*\n\n${groupRulesText}\n\nالالتزام بالقوانين يضمن بقاءك داخل المجموعة.`;

const welcomeMessage = `
👋 أهلاً بك! أنا بوت الإشراف الآلي.
وظيفتي هي الحفاظ على بيئة نقاش محترمة وآمنة للجميع عبر مراقبة الرسائل وحذف المخالف منها تلقائيًا.

👇 استخدم الأزرار أدناه لمعرفة المزيد.
`;

// --- تعريف الأزرار (Inline Keyboards) ---
const mainMenuKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📜 عرض القوانين', callback_data: 'show_rules' }],
            [{ text: '❌ إغلاق', callback_data: 'close_menu' }]
        ]
    }
};

const rulesMenuKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu' }]
        ]
    }
};


// =======================================================
// == 1. الأوامر الرئيسية والتفاعلية (لكل المستخدمين) ==
// =======================================================

// أمر /start و /help لعرض القائمة الرئيسية مع الأزرار
bot.onText(/\/start|\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, welcomeMessage, mainMenuKeyboard);
});

// المستمع الخاص بضغطات الأزرار (Callback Queries)
bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    const messageId = msg.message_id;

    switch (data) {
        case 'show_rules':
            // تعديل الرسالة لعرض القوانين
            bot.editMessageText(fullRulesMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                ...rulesMenuKeyboard
            });
            break;
        
        case 'main_menu':
            // تعديل الرسالة للعودة إلى القائمة الرئيسية
            bot.editMessageText(welcomeMessage, {
                chat_id: chatId,
                message_id: messageId,
                ...mainMenuKeyboard
            });
            break;

        case 'close_menu':
            // حذف الرسالة عند الضغط على "إغلاق"
            bot.deleteMessage(chatId, messageId);
            break;
    }
    // إرسال تأكيد استلام الضغطة لإزالة علامة التحميل من الزر
    bot.answerCallbackQuery(callbackQuery.id);
});


// =======================================================
// == 2. أوامر الأدمن (نصية وتتطلب الرد على رسالة) ==
// =======================================================

const isAdmin = (userId) => userId.toString() === adminId;

bot.onText(/\/status|\/الحالة/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, '✅ البوت يعمل ويراقب المجموعة بنجاح.');
});

bot.onText(/\/warn(?: (.+))?/, (msg, match) => {
    if (!isAdmin(msg.from.id) || !msg.reply_to_message) return;
    const reason = match[1] || "بدون سبب محدد";
    const targetUser = msg.reply_to_message.from;
    const warningText = `⚠️ *تحذير للمستخدم* [${targetUser.first_name}](tg://user?id=${targetUser.id})!\n*السبب:* ${reason}`;
    bot.sendMessage(msg.chat.id, warningText, { parse_mode: 'Markdown' });
});

bot.onText(/\/kick/, async (msg) => {
    if (!isAdmin(msg.from.id) || !msg.reply_to_message) return;
    try {
        await bot.kickChatMember(msg.chat.id, msg.reply_to_message.from.id);
        bot.sendMessage(msg.chat.id, `✅ تم طرد المستخدم ${msg.reply_to_message.from.first_name}.`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ خطأ: لم أتمكن من طرد المستخدم.`); }
});

bot.onText(/\/ban/, async (msg) => {
    if (!isAdmin(msg.from.id) || !msg.reply_to_message) return;
    try {
        await bot.banChatMember(msg.chat.id, msg.reply_to_message.from.id);
        bot.sendMessage(msg.chat.id, `🚫 تم حظر المستخدم ${msg.reply_to_message.from.first_name}.`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ خطأ: لم أتمكن من حظر المستخدم.`); }
});


// =======================================================
// == 3. المشرف التلقائي (يعمل على كل رسالة) ==
// =======================================================
async function analyzeMessageWithAI(messageText) {
    const prompt = `أنت مشرف AI في مجموعة. حلل الرسالة التالية: "${messageText}" بناءً على هذه القوانين: ${groupRulesText}. أجب بـ JSON فقط: {"isViolation": boolean, "reason": "شرح المخالفة بالعربية"}.`;
    try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions',
            { model: 'deepseek-chat', messages: [{ role: 'system', content: 'You only respond in JSON.' },{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 150 },
            { headers: { 'Authorization': `Bearer ${deepseekApiKey}` } }
        );
        const resultText = response.data.choices[0].message.content;
        console.log('AI Response:', resultText);
        return JSON.parse(resultText.match(/{.*}/s)[0]);
    } catch (error) {
        console.error('AI API Error:', error.message);
        return { isViolation: false };
    }
}

bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return; // تجاهل الأوامر
    if (isAdmin(msg.from.id)) return; // تجاهل الأدمن

    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    const messageText = msg.text || msg.caption || '';
    
    // 1. الفحص السريع للروابط
    const linkRegex = /http[s]?:\/\/[^\s]+|www\.[^\s]+|\.[a-z]{2,}(\/|$)/i;
    if (linkRegex.test(messageText)) {
        try {
            await bot.deleteMessage(chatId, messageId);
            await bot.sendMessage(adminId, `🚨 **تم حذف رسالة (رابط)**\n- **من:** ${msg.from.first_name} (${msg.from.id})\n- **الرسالة:** "${messageText}"`, { parse_mode: 'Markdown' });
        } catch (e) { console.error("Error deleting link message:", e.message); }
        return;
    }

    // 2. الفحص بالذكاء الاصطناعي
    if (messageText) {
        const analysis = await analyzeMessageWithAI(messageText);
        if (analysis && analysis.isViolation) {
            try {
                await bot.deleteMessage(chatId, messageId);
                await bot.sendMessage(adminId, `🤖 **تم حذف رسالة (AI)**\n- **السبب:** ${analysis.reason}\n- **من:** ${msg.from.first_name} (${msg.from.id})\n- **الرسالة:** "${messageText}"`, { parse_mode: 'Markdown' });
            } catch (e) { console.error("Error deleting AI-flagged message:", e.message); }
        }
    }
});


// =======================================================
// == 4. إعداد خادم الويب وتشغيل البوت ==
// =======================================================
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('البوت المشرف يعمل!'));
app.listen(port, () => console.log(`خادم الويب يعمل على المنفذ ${port}`));

console.log('✅ البوت يعمل الآن ويراقب المجموعة...');
bot.on('polling_error', (error) => console.error(`Polling error: ${error.code}`));
