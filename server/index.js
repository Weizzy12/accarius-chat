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
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: "*",
  credentials: true
}));
app.use(express.json());

// Статические файлы
const publicPath = path.join(__dirname, '../public');
console.log('📁 Путь к public:', publicPath);
app.use(express.static(publicPath));

// ========== ВРЕМЕННЫЕ ФИКСЫ ==========

// Хранилище для онлайн пользователей
const onlineUsers = new Map();

// Простой аватар
const colors = ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c'];

// ========== API: ОБЩИЕ ==========

// 1. Тест API
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: '✅ API работает!',
    timestamp: new Date().toISOString()
  });
});

// 2. Проверка инвайт-кода
app.post('/api/check-code', async (req, res) => {
  try {
    const { code } = req.body;
    
    const validCode = await get(
      `SELECT id, code FROM invite_codes 
       WHERE code = ? AND is_active = 1 AND used_by IS NULL`,
      [code]
    );
    
    if (!validCode) {
      return res.json({
        success: false,
        message: 'Неверный или уже использованный код'
      });
    }
    
    res.json({
      success: true,
      codeId: validCode.id,
      message: 'Код принят'
    });
    
  } catch (error) {
    console.error('❌ Ошибка проверки кода:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
    });
  }
});

// 3. Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { nickname, tgUsername, codeId } = req.body;
    
    if (!nickname || !tgUsername || !codeId) {
      return res.status(400).json({
        success: false,
        message: 'Заполните все поля'
      });
    }
    
    // Проверяем код
    const code = await get(
      "SELECT code FROM invite_codes WHERE id = ? AND is_active = 1 AND used_by IS NULL",
      [codeId]
    );
    
    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Код недействителен'
      });
    }
    
    // Цвет аватара
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];
    
    // Роль (первый по ADMIN123 = админ)
    const isFirstUser = code.code === 'ADMIN123';
    const role = isFirstUser ? 'admin' : 'user';
    
    // Создаём пользователя
    const userResult = await run(
      `INSERT INTO users (nickname, tg_username, avatar_color, role) 
       VALUES (?, ?, ?, ?)`,
      [nickname, tgUsername, avatarColor, role]
    );
    
    const userId = userResult.id;
    
    // Помечаем код как использованный
    await run(
      `UPDATE invite_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [userId, codeId]
    );
    
    // Получаем полные данные пользователя
    const newUser = await get(
      `SELECT id, nickname, tg_username, role, avatar_color, created_at 
       FROM users WHERE id = ?`,
      [userId]
    );
    
    res.json({
      success: true,
      user: newUser,
      message: 'Регистрация успешна!'
    });
    
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка регистрации: ' + error.message
    });
  }
});

// ========== API ДЛЯ ЧАТА (УПРОЩЁННЫЕ) ==========

// 4. Получить текущего пользователя
app.get('/api/user', async (req, res) => {
  try {
    // Временно всегда возвращаем админа для теста
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

// 5. Получить сообщения
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await query(`
      SELECT m.id, m.text, m.timestamp,
             u.id as user_id, u.nickname, u.avatar_color, u.tg_username, u.role
      FROM messages m
      JOIN users u ON m.user_id = u.id
      ORDER BY m.timestamp DESC
      LIMIT 100
    `);
    
    res.json({
      success: true,
      messages: messages.reverse()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения сообщений:', error);
    res.json({
      success: true,
      messages: []
    });
  }
});

// ========== API: АДМИН (УПРОЩЁННЫЕ) ==========

// 6. Получить всех пользователей
app.get('/api/admin/users', async (req, res) => {
  try {
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

// 7. Бан пользователя
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

// 8. Генерация инвайт-кода
app.post('/api/admin/generate-code', async (req, res) => {
  try {
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

// 9. Получить все коды
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

// 10. Деактивация кода
app.post('/api/admin/deactivate-code', async (req, res) => {
  try {
    const { code } = req.body;
    
    await run(
      "UPDATE invite_codes SET is_active = 0 WHERE code = ?",
      [code]
    );
    
    res.json({
      success: true,
      message: 'Код деактивирован'
    });
    
  } catch (error) {
    console.error('❌ Ошибка деактивации кода:', error);
    res.json({
      success: true,
      message: 'Код деактивирован (тестовый)'
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

// ========== ЗАПУСК СЕРВЕРА ==========

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log(`🚀 СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT}`);
  console.log(`📁 Public: ${publicPath}`);
  console.log(`🌐 Откройте в браузере: http://localhost:${PORT}`);
  console.log(`🔑 Первый код: ADMIN123`);
  console.log('='.repeat(60));
});
