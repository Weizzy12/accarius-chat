const { query, get } = require('./database');

// Проверка админа
async function checkAdmin(userId) {
  try {
    const user = await get(
      "SELECT role FROM users WHERE id = ?",
      [userId]
    );
    return user && user.role === 'admin';
  } catch (error) {
    console.error('Ошибка проверки админа:', error);
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
    
    if (!user) return { canSend: false, reason: 'Пользователь не найден' };
    
    if (user.is_banned) {
      return { canSend: false, reason: 'Вы забанены' };
    }
    
    if (user.muted_until && new Date(user.muted_until) > new Date()) {
      return { canSend: false, reason: 'Вы замьючены' };
    }
    
    return { canSend: true };
  } catch (error) {
    console.error('Ошибка проверки статуса:', error);
    return { canSend: false, reason: 'Ошибка сервера' };
  }
}

module.exports = { checkAdmin, getUserProfile, checkUserStatus };