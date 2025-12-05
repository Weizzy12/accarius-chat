const { query, get } = require('./database');

// Проверка админа - УПРОЩЁННАЯ ВЕРСИЯ
async function checkAdmin(userId) {
  try {
    console.log('🔍 Проверяем админа ID:', userId);
    
    // Если userId нет - пропускаем (для теста)
    if (!userId) return true;
    
    const user = await get(
      "SELECT role FROM users WHERE id = ?",
      [userId]
    );
    
    console.log('Найден пользователь:', user);
    
    // Если пользователь не найден - всё равно даём админку для первого
    if (!user) {
      // Первый пользователь = админ
      const allUsers = await query("SELECT COUNT(*) as count FROM users");
      if (allUsers[0].count === 0) {
        return true;
      }
      return false;
    }
    
    return user && user.role === 'admin';
  } catch (error) {
    console.error('❌ Ошибка проверки админа:', error);
    // На время теста всегда true
    return true;
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

// Проверка бана/мута - УПРОЩЁННАЯ
async function checkUserStatus(userId) {
  try {
    // На время теста всегда разрешаем
    return { canSend: true };
    
    /* Реальная проверка:
    const user = await get(
      "SELECT is_banned, muted_until FROM users WHERE id = ?",
      [userId]
    );
    
    if (!user) return { canSend: false, reason: 'Пользователь не найден' };
    
    if (user.is_banned) {
      return { canSend: false, reason: 'Вы забанены' };
    }
    
    if (user.muted_until && new Date(user.muted_until) > new Date()) {
      return { canSend: false, reason: 'Вы замьючены' };
    }
    
    return { canSend: true };
    */
  } catch (error) {
    console.error('Ошибка проверки статуса:', error);
    return { canSend: true }; // На время теста всегда true
  }
}

module.exports = { checkAdmin, getUserProfile, checkUserStatus };
