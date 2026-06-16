import { 
  getUserSession, 
  getUnsyncedIds, 
  getTodoById, 
  saveTodo, 
  hardDeleteTodo,
  clearUnsyncedIds, 
  getLastSyncTime, 
  setLastSyncTime 
} from './storage.js';

const SERVER_URL = 'http://localhost:3000';

/**
 * Checks if the sync server is reachable.
 * @returns {Promise<boolean>}
 */
export async function testServerConnection() {
  if (!navigator.onLine) return false;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${SERVER_URL}/api/health`, { 
      signal: controller.signal 
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (e) {
    return false;
  }
}

/**
 * Registers a new user.
 * @param {string} username 
 * @param {string} password 
 */
export async function registerUser(username, password) {
  const response = await fetch(`${SERVER_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Registration failed');
  }
  return data;
}

/**
 * Logs in a user.
 * @param {string} username 
 * @param {string} password 
 * @returns {Promise<object>} session details
 */
export async function loginUser(username, password) {
  const response = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Login failed');
  }
  return data;
}

/**
 * Performs synchronization between local storage and the server database.
 * Conflict resolution strategy: Last-Write-Wins based on 'updatedAt' timestamps.
 */
export async function syncTodos() {
  const session = getUserSession();
  if (!session || !session.token) {
    return { success: false, message: 'User not logged in' };
  }

  const isConnected = await testServerConnection();
  if (!isConnected) {
    return { success: false, message: 'Server unreachable' };
  }

  try {
    // 1. Gather all local changes
    const unsyncedIds = getUnsyncedIds();
    const clientChanges = unsyncedIds
      .map(id => getTodoById(id))
      .filter(Boolean);

    const lastSyncTime = getLastSyncTime() || new Date(0).toISOString();

    // 2. Transmit changes to the server
    const response = await fetch(`${SERVER_URL}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`
      },
      body: JSON.stringify({
        changes: clientChanges,
        lastSyncTime: lastSyncTime
      })
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Unauthorized session. Please sign in again.');
      }
      throw new Error('Sync request failed');
    }

    const data = await response.json();
    const { serverChanges, serverTime } = data;

    // 3. Apply changes received from server with conflict resolution
    for (const serverTodo of serverChanges) {
      const localTodo = getTodoById(serverTodo.id);

      if (!localTodo) {
        // Todo doesn't exist locally. Save it if it isn't deleted.
        if (!serverTodo.deleted) {
          saveTodo(serverTodo, false);
        }
      } else {
        // Todo exists locally. Compare timestamps.
        const serverTimeMs = new Date(serverTodo.updatedAt).getTime();
        const localTimeMs = new Date(localTodo.updatedAt).getTime();

        if (serverTimeMs > localTimeMs) {
          // Server version is newer
          if (serverTodo.deleted) {
            // Server deleted this todo, delete it locally as well
            hardDeleteTodo(serverTodo.id);
          } else {
            // Server updated this todo, update locally
            saveTodo(serverTodo, false);
          }
        }
      }
    }

    // 4. Clean up tombstones locally (remove hard deleted items that were soft deleted locally)
    const allLocalTodos = getUnsyncedIds().map(id => getTodoById(id)).filter(Boolean);
    const locallySoftDeleted = allLocalTodos.filter(t => t.deleted);
    
    // For any item we soft-deleted locally that we just synced, we can safely hard-delete it now
    for (const deletedTodo of locallySoftDeleted) {
      if (unsyncedIds.includes(deletedTodo.id)) {
        hardDeleteTodo(deletedTodo.id);
      }
    }

    // 5. Clear unsynced queue status for synced records
    clearUnsyncedIds(unsyncedIds);
    setLastSyncTime(serverTime);

    return { 
      success: true, 
      sentCount: clientChanges.length, 
      receivedCount: serverChanges.length 
    };

  } catch (error) {
    console.error("Sync error:", error);
    return { success: false, message: error.message };
  }
}
