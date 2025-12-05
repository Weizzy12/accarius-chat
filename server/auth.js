const { query, get } = require('./database');

// Проверка админа
async function checkAdmin(userId) {
  try {
    console.log('🔍 Проверяем админа ID:', userId);
    
    if (!userId) {
      console.log('⚠️ Нет userId, возвращаем false');
      return false;
    }
    
    const user = await get(
      "SELECT role FROM users WHERE id = ?",
      [userId]
    );
    
    console.log('Найден пользователь:', user);
    
    if (!user) {
      console.log('⚠️ Пользователь не найден в базе');
      return false;
    }
    
    const isAdmin = user.role === 'admin';
    console.log(`✅ Роль пользователя ${userId}: ${user.role}, админ: ${isAdmin}`);
    
    return isAdmin;
  } catch (error) {
    console.error('❌ Ошибка проверки админа:', error);
    return false;
  }
}

// Получить профиль пользователя
async function getUserProfile(userId) {
  try {
    const user = await get(
      `SELECT id, nickname, tg_username, role, avatar_color, 
              created_at, is_banned, muted_until
       FROM users WHERE id = ?`,
      [userId]
    );
    return user;
  } catch (error) {
    console.error('Ошибка получения профиля:', error);
    return null;
  }
}

// Проверка бана/мута
async function checkUserStatus(userId) {
  try {
    const user = await get(
      "SELECT is_banned, muted_until FROM users WHERE id = ?",
      [userId]
    );
    
    if (!user) {
      console.log(`⚠️ Пользователь ${userId} не найден при проверке статуса`);
      return { canSend: false, reason: 'Пользователь не найден' };
    }
    
    console.log(`🔍 Статус пользователя ${userId}: забанен=${user.is_banned}, мут до=${user.muted_until}`);
    
    if (user.is_banned) {
      return { canSend: false, reason: 'Вы забанены' };
    }
    
    if (user.muted_until && new Date(user.muted_until) > new Date()) {
      const muteTime = Math.round((new Date(user.muted_until) - new Date()) / 60000);
      return { canSend: false, reason: `Вы замьючены на ${muteTime} минут` };
    }
    
    return { canSend: true };
  } catch (error) {
    console.error('Ошибка проверки статуса:', error);
    return { canSend: false, reason: 'Ошибка сервера' };
  }
}

module.exports = { checkAdmin, getUserProfile, checkUserStatus };
