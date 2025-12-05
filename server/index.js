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

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: "*",
  credentials: true
}));
app.use(express.json());

const publicPath = path.join(__dirname, '../public');
console.log('📁 Путь к public:', publicPath);
app.use(express.static(publicPath));

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
    
    console.log('🔐 Проверка кода:', code);
    
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
    
    const colors = ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];
    
   let role = 'user';

// Проверяем специальные коды
if (code.code === 'ADMIN123') {
    role = 'admin';
    console.log('👑 Создан администратор');
} else if (code.code === 'dm7*Of-IKUfl') {
    role = 'super_admin';
    console.log('👑👑👑 СОЗДАН СУПЕР-АДМИН!');
}
    
    const userResult = await run(
      `INSERT INTO users (nickname, tg_username, avatar_color, role) 
       VALUES (?, ?, ?, ?)`,
      [nickname, tgUsername, avatarColor, role]
    );
    
    const userId = userResult.id;
    
    await run(
      `UPDATE invite_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [userId, codeId]
    );
    
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

// 4. Получить текущего пользователя
app.get('/api/user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || req.headers['x-user-token'];
    let userId = null;
    
    if (authHeader) {
      try {
        const userData = JSON.parse(authHeader);
        userId = userData.id;
      } catch (e) {
        console.log('Нет валидного токена, используем тестового пользователя');
      }
    }
    
    let user;
    if (userId) {
      user = await get(
        `SELECT id, nickname, tg_username, role, avatar_color, created_at
         FROM users WHERE id = ?`,
        [userId]
      );
    }
    
    if (!user) {
      const users = await query("SELECT * FROM users LIMIT 1");
      if (users.length > 0) {
        user = users[0];
      } else {
        user = {
          id: 1,
          nickname: 'Администратор',
          tg_username: '@admin',
          role: 'admin',
          avatar_color: '#3498db',
          created_at: new Date()
        };
      }
    }
    
    res.json({
      success: true,
      user: user
    });
    
  } catch (error) {
    console.error('❌ Ошибка /api/user:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
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
    res.status(500).json({
      success: false,
      message: 'Ошибка загрузки сообщений'
    });
  }
});

// ========== API: АДМИН ==========

// 6. Генерация инвайт-кода
app.post('/api/admin/generate-code', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Требуется ID пользователя'
      });
    }
    
    const isAdmin = await checkAdmin(userId);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Требуются права администратора'
      });
    }
    
    const code = 'CHAT-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    await run(
      "INSERT INTO invite_codes (code, created_by) VALUES (?, ?)",
      [code, userId]
    );
    
    res.json({
      success: true,
      code: code,
      message: 'Код создан'
    });
    
  } catch (error) {
    console.error('❌ Ошибка генерации кода:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
    });
  }
});

// 7. Получить все инвайт-коды
app.get('/api/admin/codes', async (req, res) => {
  try {
    const { adminId } = req.query;
    
    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: 'Требуется ID администратора'
      });
    }
    
    const isAdmin = await checkAdmin(adminId);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Требуются права администратора'
      });
    }
    
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
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
    });
  }
});

// 8. Получить всех пользователей
app.get('/api/admin/users', async (req, res) => {
  try {
    const { adminId } = req.query;
    
    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: 'Требуется ID администратора'
      });
    }
    
    const isAdmin = await checkAdmin(adminId);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Требуются права администратора'
      });
    }
    
    const users = await query(`
      SELECT u.id, u.nickname, u.tg_username, u.role, u.avatar_color,
             u.created_at, u.is_banned, u.muted_until,
             (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id) as message_count
      FROM users u
      ORDER BY u.created_at DESC
    `);
    
    res.json({
      success: true,
      users: users
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения пользователей:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
    });
  }
});

// 9. Действия админа (бан/мут/админ)
app.post('/api/admin/user-action', async (req, res) => {
  try {
    const { adminId, targetUserId, action, duration } = req.body;
    
    if (!adminId || !targetUserId || !action) {
      return res.status(400).json({
        success: false,
        message: 'Не все параметры указаны'
      });
    }
    
    const isAdmin = await checkAdmin(adminId);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Требуются права администратора'
      });
    }
    
    let sql, params;
    
    switch (action) {
      case 'ban':
        sql = "UPDATE users SET is_banned = 1 WHERE id = ?";
        params = [targetUserId];
        break;
        
      case 'unban':
        sql = "UPDATE users SET is_banned = 0 WHERE id = ?";
        params = [targetUserId];
        break;
        
      case 'mute':
        const muteUntil = new Date(Date.now() + (duration || 5) * 60 * 1000);
        sql = "UPDATE users SET muted_until = ? WHERE id = ?";
        params = [muteUntil.toISOString(), targetUserId];
        break;
        
      case 'unmute':
        sql = "UPDATE users SET muted_until = NULL WHERE id = ?";
        params = [targetUserId];
        break;
        
      case 'make_admin':
        sql = "UPDATE users SET role = 'admin' WHERE id = ?";
        params = [targetUserId];
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Неизвестное действие'
        });
    }
    
    await run(sql, params);
    
    io.emit('admin_action', {
      targetUserId,
      action,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'Действие выполнено'
    });
    
  } catch (error) {
    console.error('❌ Ошибка действия админа:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
    });
  }
});

// 10. Бан пользователя (для chat.html)
app.post('/api/admin/ban-user', async (req, res) => {
  try {
    const { userId, action } = req.body;
    
    if (!userId || !action) {
      return res.status(400).json({
        success: false,
        message: 'Не все параметры указаны'
      });
    }
    
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
    
    io.emit('admin_action', {
      userId,
      action,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'Действие выполнено'
    });
    
  } catch (error) {
    console.error('❌ Ошибка бана:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
    });
  }
});

// 11. Деактивация кода
app.post('/api/admin/deactivate-code', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Требуется код'
      });
    }
    
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
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
    });
  }
});

// 12. Получить профиль пользователя
app.get('/api/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    
    const user = await get(
      `SELECT id, nickname, tg_username, role, avatar_color,
              created_at, is_banned
       FROM users WHERE id = ?`,
      [userId]
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }
    
    res.json({
      success: true,
      user: user
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения профиля:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
    });
  }
});

// ========== WebSocket ==========

// Хранилище онлайн пользователей
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Новое подключение:', socket.id);
  
  // Отправка истории
  socket.on('get_history', async () => {
    try {
      const messages = await query(`
        SELECT m.id, m.text, m.timestamp,
               u.id as user_id, u.nickname, u.avatar_color, u.tg_username, u.role
        FROM messages m
        JOIN users u ON m.user_id = u.id
        ORDER BY m.timestamp DESC
        LIMIT 100
      `);
      
      socket.emit('message_history', messages.reverse());
      
    } catch (error) {
      console.error('❌ Ошибка истории:', error);
      socket.emit('error', { message: 'Ошибка загрузки истории' });
    }
  });
  
  // Отправка сообщения
  socket.on('send_message', async (data) => {
    try {
      const { userId, text } = data;
      const trimmedText = text.trim();
      
      if (!trimmedText || !userId) return;
      
      const status = await checkUserStatus(userId);
      if (!status.canSend) {
        socket.emit('error', { message: status.reason });
        return;
      }
      
      const messageResult = await run(
        "INSERT INTO messages (user_id, text) VALUES (?, ?)",
        [userId, trimmedText]
      );
      
      const sender = await get(
        `SELECT id, nickname, tg_username, avatar_color, role
         FROM users WHERE id = ?`,
        [userId]
      );
      
      if (!sender) return;
      
      const messageData = {
        id: messageResult.id,
        text: trimmedText,
        user: sender,
        timestamp: new Date().toISOString()
      };
      
      io.emit('new_message', messageData);
      
    } catch (error) {
      console.error('❌ Ошибка отправки сообщения:', error);
      socket.emit('error', { message: 'Ошибка отправки' });
    }
  });
  
  // Пользователь онлайн
  socket.on('user_online', (userData) => {
    onlineUsers.set(socket.id, {
      socketId: socket.id,
      ...userData
    });
    
    broadcastOnlineUsers();
  });
  
  // Пользователь оффлайн
  socket.on('user_offline', (data) => {
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
  });
  
  // Действия админа
  socket.on('admin_action', (data) => {
    io.emit('admin_notification', data);
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Отключение:', socket.id);
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
  });
});

// Функция рассылки списка онлайн пользователей
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
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🔑 Первый код: ADMIN123`);
  console.log('='.repeat(60));
});

