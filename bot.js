// index.js

// استدعاء المكتبات اللازمة
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// التحقق من وجود التوكن
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('خطأ: لم يتم العثور على TELEGRAM_BOT_TOKEN. يرجى إعداده في ملف .env');
    process.exit(1);
}

// تهيئة البوت
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// تحميل الإعدادات من ملف .env
const GROUP_ID = process.env.GROUP_ID;
const ARCHIVE_CHANNEL_ID = process.env.ARCHIVE_CHANNEL_ID;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];

// متغيرات لحالة البوت وبياناته
let monitoringActive = true;
const stats = {
    totalMessages: 0,
    userMessages: {}, // { userId: count }
};
const archives = []; // لتخزين معلومات الرسائل المؤرشفة

// قوائم الكلمات
const forbiddenWords = ['كلمة1', 'كلمة2', 'كلمة سيئة', 'سبام']; // أضف الكلمات المحظورة هنا
const dangerousWords = ['تهديد', 'احتيال', 'ابتزاز', 'اختراق']; // كلمات تستدعي تنبيه الأدمن

// رسائل وقواعد
const groupRules = `
📋 **قواعد النشر في المجموعة:**

1.  يمنع نشر أي روابط خارجية.
2.  يمنع استخدام الألفاظ النابية أو المسيئة.
3.  يمنع تكرار الرسائل (سبام).
4.  الاحترام المتبادل بين جميع الأعضاء.
5.  ... أضف باقي القواعد هنا ...
`;

const helpMessage = `
🤖 **مرحباً بك في بوت الحارس!**

إليك قائمة الأوامر المتاحة:

*/start* - تشغيل البوت وعرض رسالة الترحيب.
*/help* - عرض هذه القائمة.
*/rules* - عرض قواعد المجموعة.
*/stats* - عرض إحصائيات النشاط في المجموعة.
*/on* - (للأدمن) تفعيل المراقبة.
*/off* - (للأدمن) إيقاف المراقبة.

**أوامر الإدارة (للأدمن فقط):**
*/warn @user* - توجيه تحذير لعضو.
*/mute @user [مدة]* - كتم عضو (مثال: /mute @user 10m لكتمه 10 دقائق).
*/ban @user* - حظر عضو من المجموعة.
*/unban @user* - فك حظر عضو.
*/archive* - أرشفة الرسالة التي تم الرد عليها.
*/list_archives* - عرض آخر 10 رسائل مؤرشفة.
`;

// =================================================================
// دالات مساعدة (Helper Functions)
// =================================================================

// دالة للتحقق مما إذا كان المستخدم أدمن
const isAdmin = (userId) => ADMIN_IDS.includes(userId);

// دالة لتنبيه الأدمن
const alertAdmins = (message) => {
    ADMIN_IDS.forEach(adminId => {
        bot.sendMessage(adminId, message, { parse_mode: 'Markdown' }).catch(console.error);
    });
};

// =================================================================
// معالجة الرسائل والأحداث (Event Listeners)
// =================================================================

// 1. الترحيب بالأعضاء الجدد
bot.on('new_chat_members', (msg) => {
    if (msg.chat.id.toString() !== GROUP_ID) return;

    const newMembers = msg.new_chat_members;
    newMembers.forEach(member => {
        const welcomeMessage = `
👋 أهلاً بك يا [${member.first_name}](tg://user?id=${member.id}) في مجموعتنا!

نتمنى لك وقتاً ممتعاً ومفيداً.
يرجى قراءة قواعد المجموعة قبل المشاركة.
        `;
        bot.sendMessage(GROUP_ID, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📜 عرض القواعد', callback_data: 'show_rules' }],
                ],
            },
        });
    });
});

// 2. المعالج الرئيسي للرسائل (الفلترة، الحذف، الإحصائيات)
bot.on('message', (msg) => {
    // تجاهل الرسائل التي ليست في المجموعة المستهدفة
    if (msg.chat.id.toString() !== GROUP_ID) return;

    const userId = msg.from.id;
    const text = msg.text || msg.caption || '';

    // تحديث الإحصائيات
    stats.totalMessages++;
    stats.userMessages[userId] = (stats.userMessages[userId] || 0) + 1;

    // إذا كانت المراقبة متوقفة، لا تكمل الفلترة (إلا للأوامر)
    if (!monitoringActive && !text.startsWith('/')) return;

    // تجاهل رسائل الأدمن من الفلترة
    if (isAdmin(userId)) return;

    // --- بدء الفلترة ---

    // أ. حذف الروابط
    if (msg.entities && msg.entities.some(e => ['url', 'text_link'].includes(e.type))) {
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(console.error);
        bot.sendMessage(userId, 'عذراً، يمنع نشر الروابط في هذه المجموعة.').catch(console.error);
        return;
    }

    // ب. حذف الكلمات المحظورة
    const hasForbiddenWord = forbiddenWords.some(word => text.toLowerCase().includes(word.toLowerCase()));
    if (hasForbiddenWord) {
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(console.error);
        bot.sendMessage(userId, 'تم حذف رسالتك لاحتوائها على كلمات غير مسموح بها.').catch(console.error);
        return;
    }

    // ج. تنبيه الأدمن عند وجود كلمات خطيرة
    const hasDangerousWord = dangerousWords.some(word => text.toLowerCase().includes(word.toLowerCase()));
    if (hasDangerousWord) {
        const alertMessage = `
🚨 **تنبيه أمني** 🚨
وردت كلمة خطيرة من المستخدم: [${msg.from.first_name}](tg://user?id=${userId})
نص الرسالة: "${text}"
        `;
        alertAdmins(alertMessage);
        // لا نحذف الرسالة هنا لكي يتمكن الأدمن من رؤيتها واتخاذ إجراء
    }
});


// =================================================================
// معالجة الأوامر (Commands)
// =================================================================

// /start
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, helpMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📜 عرض القواعد', callback_data: 'show_rules' }],
                [{ text: '📊 عرض الإحصائيات', callback_data: 'show_stats' }],
            ]
        }
    });
});

// /help
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
});

// /rules
bot.onText(/\/rules/, (msg) => {
    bot.sendMessage(msg.chat.id, groupRules, { parse_mode: 'Markdown' });
});

// /on (للأدمن)
bot.onText(/\/on/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    monitoringActive = true;
    bot.sendMessage(msg.chat.id, '✅ تم تفعيل المراقبة والفلترة في المجموعة.');
});

// /off (للأدمن)
bot.onText(/\/off/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    monitoringActive = false;
    bot.sendMessage(msg.chat.id, '🅾️ تم إيقاف المراقبة والفلترة في المجموعة.');
});

// /stats
bot.onText(/\/stats/, (msg) => {
    const totalUsers = Object.keys(stats.userMessages).length;
    
    // إيجاد العضو الأكثر نشاطاً
    let topUser = { id: null, count: 0, name: 'لا يوجد' };
    if (totalUsers > 0) {
        const topUserId = Object.keys(stats.userMessages).reduce((a, b) => stats.userMessages[a] > stats.userMessages[b] ? a : b);
        topUser.id = topUserId;
        topUser.count = stats.userMessages[topUserId];
        // نحاول جلب اسم المستخدم
        bot.getChatMember(GROUP_ID, topUserId).then(member => {
            topUser.name = member.user.first_name;
            sendStatsMessage(msg.chat.id, topUser);
        }).catch(() => {
            sendStatsMessage(msg.chat.id, topUser); // إرسال الإحصائيات حتى لو فشل جلب الاسم
        });
    } else {
        sendStatsMessage(msg.chat.id, topUser);
    }
});

function sendStatsMessage(chatId, topUser) {
    const statsMessage = `
📊 **إحصائيات المجموعة**

- إجمالي الرسائل: *${stats.totalMessages}*
- عدد الأعضاء المشاركين: *${Object.keys(stats.userMessages).length}*
- العضو الأكثر نشاطاً: [${topUser.name}](tg://user?id=${topUser.id}) (*${topUser.count}* رسالة)
    `;
    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
}


// /ban (للأدمن)
bot.onText(/\/ban/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    if (!msg.reply_to_message) {
        bot.sendMessage(msg.chat.id, '⚠️ يرجى استخدام هذا الأمر بالرد على رسالة العضو الذي تريد حظره.');
        return;
    }
    const userToBan = msg.reply_to_message.from;
    bot.banChatMember(GROUP_ID, userToBan.id)
        .then(() => {
            bot.sendMessage(GROUP_ID, `🚫 تم حظر المستخدم [${userToBan.first_name}](tg://user?id=${userToBan.id}) بنجاح.`, { parse_mode: 'Markdown' });
        })
        .catch(err => {
            bot.sendMessage(msg.chat.id, `حدث خطأ: ${err.message}`);
        });
});

// /unban (للأدمن)
bot.onText(/\/unban (.+)/, (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const userIdToUnban = match[1]; // يجب أن يكون ID المستخدم
    bot.unbanChatMember(GROUP_ID, userIdToUnban)
        .then(() => {
            bot.sendMessage(GROUP_ID, `✅ تم فك حظر المستخدم صاحب المعرف: ${userIdToUnban}`);
        })
        .catch(err => {
            bot.sendMessage(msg.chat.id, `حدث خطأ أو المعرف غير صحيح: ${err.message}`);
        });
});


// /mute (للأدمن)
bot.onText(/\/mute/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    if (!msg.reply_to_message) {
        bot.sendMessage(msg.chat.id, '⚠️ يرجى استخدام هذا الأمر بالرد على رسالة العضو الذي تريد كتمه.');
        return;
    }

    const userToMute = msg.reply_to_message.from;
    const durationMatch = msg.text.match(/(\d+)(m|h|d)/); // 10m, 2h, 1d
    let untilDate;

    if (durationMatch) {
        const value = parseInt(durationMatch[1]);
        const unit = durationMatch[2];
        const now = Math.floor(Date.now() / 1000);

        if (unit === 'm') untilDate = now + value * 60;
        else if (unit === 'h') untilDate = now + value * 3600;
        else if (unit === 'd') untilDate = now + value * 86400;
    } else {
        // كتم دائم إذا لم يتم تحديد مدة
        untilDate = 0;
    }

    bot.restrictChatMember(GROUP_ID, userToMute.id, {
        can_send_messages: false,
        until_date: untilDate
    }).then(() => {
        const durationText = durationMatch ? `لمدة ${durationMatch[0]}` : 'بشكل دائم';
        bot.sendMessage(GROUP_ID, `🔇 تم كتم المستخدم [${userToMute.first_name}](tg://user?id=${userToMute.id}) ${durationText}.`, { parse_mode: 'Markdown' });
    }).catch(err => bot.sendMessage(msg.chat.id, `حدث خطأ: ${err.message}`));
});


// /warn (للأدمن)
bot.onText(/\/warn/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    if (!msg.reply_to_message) {
        bot.sendMessage(msg.chat.id, '⚠️ يرجى استخدام هذا الأمر بالرد على رسالة العضو الذي تريد تحذيره.');
        return;
    }
    const userToWarn = msg.reply_to_message.from;
    bot.sendMessage(GROUP_ID, `
⚠️ **تحذير!**
المستخدم [${userToWarn.first_name}](tg://user?id=${userToWarn.id})، لقد تلقيت تحذيراً من الإدارة.
يرجى الالتزام بقواعد المجموعة لتجنب الإجراءات العقابية.
    `, { parse_mode: 'Markdown' });
});

// /archive (للأدمن)
bot.onText(/\/archive/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    if (!msg.reply_to_message) {
        bot.sendMessage(msg.chat.id, '⚠️ يرجى استخدام هذا الأمر بالرد على الرسالة التي تريد أرشفتها.');
        return;
    }
    if (!ARCHIVE_CHANNEL_ID) {
        bot.sendMessage(msg.chat.id, 'خطأ: لم يتم تحديد قناة الأرشفة في الإعدادات.');
        return;
    }

    bot.forwardMessage(ARCHIVE_CHANNEL_ID, msg.chat.id, msg.reply_to_message.message_id)
        .then(archivedMsg => {
            archives.push({
                original_msg_id: msg.reply_to_message.message_id,
                archived_msg_id: archivedMsg.message_id,
                text: msg.reply_to_message.text || '[رسالة بدون نص]',
                user: msg.reply_to_message.from.first_name,
                date: new Date().toISOString()
            });
            bot.sendMessage(msg.chat.id, `✅ تم أرشفة الرسالة بنجاح في القناة.`);
        })
        .catch(err => {
            bot.sendMessage(msg.chat.id, `حدث خطأ أثناء الأرشفة: ${err.message}`);
        });
});

// /list_archives
bot.onText(/\/list_archives/, (msg) => {
    if (archives.length === 0) {
        bot.sendMessage(msg.chat.id, '🗄️ لا توجد رسائل مؤرشفة بعد.');
        return;
    }
    
    // عرض آخر 10 رسائل
    const recentArchives = archives.slice(-10).reverse();
    let archiveList = '📜 **آخر 10 رسائل مؤرشفة:**\n\n';
    recentArchives.forEach((archive, index) => {
        const linkToArchive = `https://t.me/c/${ARCHIVE_CHANNEL_ID.toString().substring(4)}/${archive.archived_msg_id}`;
        archiveList += `${index + 1}. [${archive.text.substring(0, 30)}...](${linkToArchive}) - بواسطة ${archive.user}\n`;
    });
    
    bot.sendMessage(msg.chat.id, archiveList, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

// =================================================================
// معالجة ضغطات الأزرار (Callback Query)
// =================================================================

bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;

    if (data === 'show_rules') {
        bot.sendMessage(msg.chat.id, groupRules, { parse_mode: 'Markdown' });
    } else if (data === 'show_stats') {
        // استدعاء نفس دالة الإحصائيات
        bot.emit('message', { ...msg, text: '/stats' });
    }
    
    // للرد على تليجرام بأن الضغطة تمت معالجتها
    bot.answerCallbackQuery(callbackQuery.id);
});

// =================================================================
// رسالة عند بدء تشغيل البوت
// =================================================================
console.log('🤖 بــوت الــحــارس يعمل الآن...');
alertAdmins('✅ تم إعادة تشغيل البوت وهو يعمل الآن.');
