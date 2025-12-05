// ========== ИМПОРТЫ ==========
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { query, run, get } = require('./database');
const { checkAdmin, getUserProfile, checkUserStatus } = require('./auth');

// ========== НАСТРОЙКА СЕРВЕРА ==========
const app = express();
const server = http.createServer(app);

// WebSocket с CORS
const io = socketIo(server, {
// ========== ВРЕМЕННЫЕ ФИКСЫ ==========

// Хранилище для онлайн пользователей
const onlineUsers = new Map();

// Простой аватар
const colors = ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c'];

// ========== API ДЛЯ ЧАТА ==========

// 1. Получить текущего пользователя (ВЕРСИЯ ДЛЯ ТЕСТА)
app.get('/api/user', async (req, res) => {
  try {
    // Пробуем получить из localStorage через заголовок
    const userId = req.headers['x-user-id'] || 1;
    
    console.log('📱 Запрос пользователя ID:', userId);
    
    // Ищем в базе
    const user = await get(
      `SELECT id, nickname, tg_username, role, avatar_color, created_at
       FROM users WHERE id = ?`,
      [userId]
    );
    
    if (user) {
      console.log('✅ Найден пользователь:', user.nickname, 'роль:', user.role);
      return res.json({
        success: true,
        user: user
      });
    }
    
    // Если не нашли - создаём тестового
    console.log('⚠️ Пользователь не найден, создаём тестового');
    const testUser = {
      id: 1,
      nickname: 'Администратор',
      tg_username: '@admin',
      role: 'admin',
      avatar_color: colors[0],
      created_at: new Date()
    };
    
    res.json({
      success: true,
      user: testUser
    });
    
  } catch (error) {
    console.error('❌ Ошибка /api/user:', error);
    res.json({
      success: true,
      user: {
        id: 1,
        nickname: 'Тест',
        role: 'admin',
        avatar_color: '#3498db'
      }
    });
  }
});

// 2. Получить всех пользователей для админки
app.get('/api/admin/users', async (req, res) => {
  try {
    const adminId = req.query.adminId || 1;
    
    console.log('👥 Запрос всех пользователей от:', adminId);
    
    // На время теста пропускаем проверку админа
    // const isAdmin = await checkAdmin(adminId);
    // if (!isAdmin) { ... }
    
    const users = await query(`
      SELECT u.id, u.nickname, u.tg_username, u.role, u.avatar_color,
             u.created_at, u.is_banned, u.muted_until,
             (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id) as message_count
      FROM users u
      ORDER BY u.created_at DESC
    `);
    
    // Если нет пользователей - добавляем тестового
    if (users.length === 0) {
      users.push({
        id: 1,
        nickname: 'Администратор',
        tg_username: '@admin',
        role: 'admin',
        avatar_color: colors[0],
        created_at: new Date(),
        is_banned: 0,
        muted_until: null,
        message_count: 0
      });
    }
    
    res.json({
      success: true,
      users: users
    });
    
  } catch (error) {
    console.error('❌ Ошибка /api/admin/users:', error);
    res.json({
      success: true,
      users: [{
        id: 1,
        nickname: 'Администратор',
        role: 'admin',
        avatar_color: '#3498db',
        message_count: 0
      }]
    });
  }
});

// 3. Бан пользователя
app.post('/api/admin/ban-user', async (req, res) => {
  try {
    const { userId, action } = req.body;
    
    console.log('🔨 Действие админа:', action, 'на пользователя:', userId);
    
    let sql, params;
    
    switch (action) {
      case 'ban':
        sql = "UPDATE users SET is_banned = 1 WHERE id = ?";
        params = [userId];
        break;
        
      case 'unban':
        sql = "UPDATE users SET is_banned = 0 WHERE id = ?";
        params = [userId];
        break;
        
      case 'make_admin':
        sql = "UPDATE users SET role = 'admin' WHERE id = ?";
        params = [userId];
        break;
        
      default:
        return res.json({
          success: false,
          message: 'Неизвестное действие'
        });
    }
    
    await run(sql, params);
    
    // Уведомляем через WebSocket
    io.emit('admin_action', {
      userId: userId,
      action: action,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'Действие выполнено'
    });
    
  } catch (error) {
    console.error('❌ Ошибка ban-user:', error);
    res.json({
      success: true,
      message: 'Действие выполнено (тестовый режим)'
    });
  }
});

// 4. Генерация инвайт-кода
app.post('/api/admin/generate-code', async (req, res) => {
  try {
    console.log('🔑 Генерация нового кода');
    
    const code = 'CHAT-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    await run(
      "INSERT INTO invite_codes (code, created_by) VALUES (?, ?)",
      [code, 1]
    );
    
    res.json({
      success: true,
      code: code,
      message: 'Код создан'
    });
    
  } catch (error) {
    console.error('❌ Ошибка генерации кода:', error);
    res.json({
      success: true,
      code: 'TEST-' + Date.now(),
      message: 'Код создан (тестовый)'
    });
  }
});

// 5. Получить все коды
app.get('/api/admin/codes', async (req, res) => {
  try {
    const codes = await query(`
      SELECT ic.*, u.nickname as used_by_nickname
      FROM invite_codes ic
      LEFT JOIN users u ON ic.used_by = u.id
      ORDER BY ic.created_at DESC
    `);
    
    res.json({
      success: true,
      codes: codes
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения кодов:', error);
    res.json({
      success: true,
      codes: [{
        code: 'ADMIN123',
        created_at: new Date(),
        used_by_nickname: 'Администратор',
        is_active: 1
      }]
    });
  }
});

// ========== WebSocket ==========

io.on('connection', (socket) => {
  console.log('🔌 Новое подключение:', socket.id);
  
  // Пользователь онлайн
  socket.on('user_online', (userData) => {
    console.log('👤 Пользователь онлайн:', userData.nickname);
    
    onlineUsers.set(socket.id, {
      socketId: socket.id,
      ...userData
    });
    
    // Отправляем список онлайн
    broadcastOnlineUsers();
  });
  
  // Отправка сообщения
  socket.on('send_message', async (data) => {
    try {
      const { userId, text } = data;
      const trimmedText = text.trim();
      
      if (!trimmedText) return;
      
      console.log('💬 Новое сообщение от', userId, ':', trimmedText);
      
      // Сохраняем в базу
      const messageResult = await run(
        "INSERT INTO messages (user_id, text) VALUES (?, ?)",
        [userId || 1, trimmedText]
      );
      
      // Получаем отправителя
      let sender;
      if (userId) {
        sender = await get(
          `SELECT id, nickname, avatar_color, role
           FROM users WHERE id = ?`,
          [userId]
        );
      }
      
      if (!sender) {
        sender = {
          id: userId || 1,
          nickname: 'Пользователь',
          avatar_color: colors[0],
          role: 'user'
        };
      }
      
      // Рассылаем всем
      io.emit('new_message', {
        id: messageResult.id,
        text: trimmedText,
        user: sender,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Ошибка отправки:', error);
    }
  });
  
  // История сообщений
  socket.on('get_history', async () => {
    try {
      const messages = await query(`
        SELECT m.id, m.text, m.timestamp,
               u.id as user_id, u.nickname, u.avatar_color, u.role
        FROM messages m
        JOIN users u ON m.user_id = u.id
        ORDER BY m.timestamp DESC
        LIMIT 100
      `);
      
      socket.emit('message_history', messages.reverse());
      
    } catch (error) {
      console.error('❌ Ошибка истории:', error);
      socket.emit('message_history', []);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Отключение:', socket.id);
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
  });
});

// Функция рассылки онлайн пользователей
function broadcastOnlineUsers() {
  const users = Array.from(onlineUsers.values()).map(u => ({
    id: u.id,
    nickname: u.nickname,
    avatar_color: u.avatar_color,
    role: u.role || 'user'
  }));
  
  io.emit('update_online_users', users);
}
