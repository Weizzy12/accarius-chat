const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Статика
app.use(express.static(path.join(__dirname, '../public')));

// ========== ПРОСТЫЕ API ==========

// 1. Тест
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API работает!' });
});

// 2. Текущий пользователь (ВСЕГДА админ для теста)
app.get('/api/user', (req, res) => {
  res.json({
    success: true,
    user: {
      id: 1,
      nickname: 'Админ',
      role: 'admin',
      avatar_color: '#3498db',
      tg_username: '@admin',
      created_at: new Date()
    }
  });
});

// 3. Сообщения
app.get('/api/messages', (req, res) => {
  res.json({ 
    success: true, 
    messages: [] 
  });
});

// 4. Все пользователи для админки
app.get('/api/admin/users', (req, res) => {
  res.json({
    success: true,
    users: [
      {
        id: 1,
        nickname: 'Админ',
        role: 'admin',
        avatar_color: '#3498db',
        tg_username: '@admin',
        created_at: new Date(),
        is_banned: 0,
        message_count: 10
      },
      {
        id: 2,
        nickname: 'Тест',
        role: 'user',
        avatar_color: '#2ecc71',
        tg_username: '@test',
        created_at: new Date(),
        is_banned: 0,
        message_count: 5
      }
    ]
  });
});

// 5. Все коды для админки
app.get('/api/admin/codes', (req, res) => {
  res.json({
    success: true,
    codes: [
      {
        code: 'ADMIN123',
        created_at: new Date(),
        used_by_nickname: 'Админ',
        is_active: 1
      },
      {
        code: 'CHAT-ABC123',
        created_at: new Date(),
        used_by_nickname: null,
        is_active: 1
      }
    ]
  });
});

// 6. Генерация кода
app.post('/api/admin/generate-code', (req, res) => {
  res.json({
    success: true,
    code: 'CHAT-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    message: 'Код создан'
  });
});

// 7. Бан пользователя
app.post('/api/admin/ban-user', (req, res) => {
  res.json({
    success: true,
    message: 'Действие выполнено'
  });
});

// 8. Деактивация кода
app.post('/api/admin/deactivate-code', (req, res) => {
  res.json({
    success: true,
    message: 'Код деактивирован'
  });
});

// ========== WebSocket для сообщений ==========

let allMessages = [];

io.on('connection', (socket) => {
  console.log('✅ Пользователь подключился');
  
  // Сразу отправляем историю
  socket.emit('message_history', allMessages);
  
  // Отправка сообщения
  socket.on('send_message', (data) => {
    console.log('📨 Получено сообщение:', data);
    
    const newMessage = {
      id: Date.now(),
      text: data.text,
      user: {
        id: data.userId || 1,
        nickname: data.userId ? 'User' + data.userId : 'Аноним',
        avatar_color: data.userId ? '#3498db' : '#e74c3c',
        role: 'user'
      },
      timestamp: new Date().toISOString(),
      user_id: data.userId || 1,
      nickname: data.userId ? 'User' + data.userId : 'Аноним',
      avatar_color: data.userId ? '#3498db' : '#e74c3c',
      role: 'user'
    };
    
    // Сохраняем
    allMessages.push(newMessage);
    
    // Лимит 100 сообщений
    if (allMessages.length > 100) {
      allMessages.shift();
    }
    
    // Рассылаем ВСЕМ
    io.emit('new_message', newMessage);
    console.log('📤 Сообщение отправлено всем');
  });
  
  // Запрос истории
  socket.on('get_history', () => {
    socket.emit('message_history', allMessages);
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Пользователь отключился');
  });
});

// ========== ЗАПУСК ==========

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📁 Откройте: http://localhost:${PORT}`);
  console.log(`🔑 Код для входа: ADMIN123`);
});
