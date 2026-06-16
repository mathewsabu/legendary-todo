const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'focusflow_super_secret_jwt_key_2026';
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());

// Initialize Local JSON database file if it doesn't exist
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error("Database reading error, resetting database:", e);
    return { users: {} };
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("Database writing error:", e);
  }
}

/* Health check for client offline/online testing */
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', serverTime: new Date().toISOString() });
});

/* Authentication: User Registration */
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const db = loadDB();
  const normalizedUser = username.trim().toLowerCase();

  if (db.users[normalizedUser]) {
    return res.status(400).json({ message: 'Username already exists' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    db.users[normalizedUser] = {
      username: username.trim(),
      password: hashedPassword,
      todos: {} // Nested todo container
    };

    saveDB(db);
    res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    res.status(500).json({ message: 'Server error during registration' });
  }
});

/* Authentication: User Login */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const db = loadDB();
  const normalizedUser = username.trim().toLowerCase();
  const userRecord = db.users[normalizedUser];

  if (!userRecord) {
    return res.status(400).json({ message: 'Invalid username or password' });
  }

  try {
    const isMatch = await bcrypt.compare(password, userRecord.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid username or password' });
    }

    // Sign JWT
    const token = jwt.sign(
      { username: userRecord.username }, 
      JWT_SECRET, 
      { expiresIn: '30d' }
    );

    res.status(200).json({
      username: userRecord.username,
      token: token
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error during login' });
  }
});

/* Middleware: JWT Authentication */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.username = decoded.username;
    next();
  });
}

/* Synchronization endpoint */
app.post('/api/sync', authenticateToken, (req, res) => {
  const { changes, lastSyncTime } = req.body;
  const db = loadDB();
  const normalizedUser = req.username.toLowerCase();
  const user = db.users[normalizedUser];

  if (!user) {
    return res.status(404).json({ message: 'User database not found' });
  }

  const currentServerTime = new Date().toISOString();

  // 1. Process client changes (Last-Write-Wins based on updatedAt)
  if (Array.isArray(changes)) {
    changes.forEach(clientTodo => {
      const serverTodo = user.todos[clientTodo.id];

      if (!serverTodo) {
        // New todo from client
        user.todos[clientTodo.id] = clientTodo;
      } else {
        const clientTime = new Date(clientTodo.updatedAt).getTime();
        const serverTime = new Date(serverTodo.updatedAt).getTime();

        if (clientTime > serverTime) {
          // Client version is newer, overwrite server copy
          user.todos[clientTodo.id] = clientTodo;
        }
      }
    });
  }

  // 2. Fetch server changes since client's last sync time
  const serverChanges = [];
  const clientLastSyncMs = new Date(lastSyncTime).getTime();

  Object.values(user.todos).forEach(todo => {
    const todoUpdatedMs = new Date(todo.updatedAt).getTime();
    if (todoUpdatedMs > clientLastSyncMs) {
      serverChanges.push(todo);
    }
  });

  // Save changes to db
  saveDB(db);

  // Return server updates and current sync time
  res.status(200).json({
    serverChanges: serverChanges,
    serverTime: currentServerTime
  });
});

app.listen(PORT, () => {
  console.log(`FocusFlow Sync Server running on http://localhost:${PORT}`);
});
