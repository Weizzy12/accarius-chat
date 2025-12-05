const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Подключаем базу (в памяти для простоты)
const db = new sqlite3.Database(':memory:');

// Инициализация таблиц
db.serialize(() => {
  // Пользователи
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL UNIQUE,
    tg_username TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    avatar_color TEXT DEFAULT '#3498db',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_banned INTEGER DEFAULT 0,
    muted_until DATETIME
  )`);

  // Инвайт-коды
  db.run(`CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used_by INTEGER,
    used_at DATETIME,
    is_active INTEGER DEFAULT 1,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (used_by) REFERENCES users(id)
  )`);

  // Сообщения
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Создаём первый инвайт-код
  db.run("INSERT OR IGNORE INTO invite_codes (code, created_by) VALUES ('ADMIN123', 0)");
  
  // Создаём тестового админа если нет пользователей
  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (err) {
      console.error('Ошибка проверки пользователей:', err);
      return;
    }
    
    if (row.count === 0) {
      console.log('👤 Создаём тестового администратора...');
      db.run(
        `INSERT INTO users (nickname, tg_username, role, avatar_color) 
         VALUES (?, ?, ?, ?)`,
        ['Администратор', '@admin', 'admin', '#3498db'],
        function(err) {
          if (err) {
            console.error('Ошибка создания администратора:', err);
          } else {
            console.log(`✅ Администратор создан с ID: ${this.lastID}`);
            
            // Обновляем код с использовавшим его админом
            db.run(
              "UPDATE invite_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = 'ADMIN123'",
              [this.lastID]
            );
          }
        }
      );
    }
  });
  
  console.log('✅ База данных инициализирована');
  console.log('🔑 Инвайт-код для входа: ADMIN123');
});

// Функции для работы с БД
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('❌ Ошибка SQL query:', err);
        console.error('SQL:', sql);
        console.error('Params:', params);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Ошибка SQL run:', err);
        console.error('SQL:', sql);
        console.error('Params:', params);
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        console.error('❌ Ошибка SQL get:', err);
        console.error('SQL:', sql);
        console.error('Params:', params);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

module.exports = { db, query, run, get };
