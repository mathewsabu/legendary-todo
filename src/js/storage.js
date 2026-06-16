import { createLogEntry } from './logger.js';

const KEYS = {
  TODOS: 'ff_todos',
  UNSYNCED: 'ff_unsynced',
  LAST_SYNC: 'ff_last_sync',
  SETUP_DATE: 'ff_setup_completed_date',
  USER: 'ff_user_session'
};

// Initialize default structures if missing
if (!localStorage.getItem(KEYS.TODOS)) {
  localStorage.setItem(KEYS.TODOS, JSON.stringify({}));
}
if (!localStorage.getItem(KEYS.UNSYNCED)) {
  localStorage.setItem(KEYS.UNSYNCED, JSON.stringify([]));
}

/**
 * Returns all todos (excluding deleted ones unless includeDeleted is true)
 * @param {boolean} includeDeleted 
 * @returns {Array<object>}
 */
export function getTodos(includeDeleted = false) {
  try {
    const raw = localStorage.getItem(KEYS.TODOS);
    const todosObj = JSON.parse(raw || '{}');
    const list = Object.values(todosObj);
    return includeDeleted ? list : list.filter(t => !t.deleted);
  } catch (e) {
    console.error("Failed to read todos from storage:", e);
    return [];
  }
}

/**
 * Fetches a single todo by ID
 * @param {string} id 
 * @returns {object|null}
 */
export function getTodoById(id) {
  const todosObj = JSON.parse(localStorage.getItem(KEYS.TODOS) || '{}');
  return todosObj[id] || null;
}

/**
 * Saves a todo (creates new or updates existing)
 * @param {object} todo 
 * @param {boolean} markAsUnsynced - Set to true to queue for server sync
 */
export function saveTodo(todo, markAsUnsynced = true) {
  const todosObj = JSON.parse(localStorage.getItem(KEYS.TODOS) || '{}');
  
  // Update timestamp
  todo.updatedAt = new Date().toISOString();
  todosObj[todo.id] = todo;
  localStorage.setItem(KEYS.TODOS, JSON.stringify(todosObj));

  if (markAsUnsynced) {
    queueUnsynced(todo.id);
  }
}

/**
 * Creates and saves a new todo in the pool
 * @param {string} text 
 * @returns {object} The created todo
 */
export function createTodo(text) {
  const newTodo = {
    id: crypto.randomUUID(),
    text: text.trim(),
    completed: false,
    completedAt: null,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assignedDates: [],
    logs: [createLogEntry('created', `Created todo "${text.trim()}" in All.`)],
    deleted: false
  };

  saveTodo(newTodo, true);
  return newTodo;
}

/**
 * Soft deletes a todo (marks deleted: true for server sync).
 * If the todo is offline-only (not synced/unregistered), delete permanently immediately.
 * @param {string} id 
 */
export function deleteTodo(id) {
  const todo = getTodoById(id);
  if (!todo) return;

  const user = getUserSession();
  if (!user) {
    // If not logged in, just delete it immediately
    hardDeleteTodo(id);
  } else {
    // Soft delete so it can be synced to server
    todo.deleted = true;
    todo.logs.push(createLogEntry('deleted', 'Deleted todo.'));
    saveTodo(todo, true);
  }
}

/**
 * Permanently deletes a todo from local storage
 * @param {string} id 
 */
export function hardDeleteTodo(id) {
  const todosObj = JSON.parse(localStorage.getItem(KEYS.TODOS) || '{}');
  delete todosObj[id];
  localStorage.setItem(KEYS.TODOS, JSON.stringify(todosObj));
  
  // Remove from unsynced queue if present
  let unsynced = getUnsyncedIds();
  unsynced = unsynced.filter(uid => uid !== id);
  localStorage.setItem(KEYS.UNSYNCED, JSON.stringify(unsynced));
}

/**
 * Queues a todo ID as unsynced
 * @param {string} id 
 */
function queueUnsynced(id) {
  const unsynced = getUnsyncedIds();
  if (!unsynced.includes(id)) {
    unsynced.push(id);
    localStorage.setItem(KEYS.UNSYNCED, JSON.stringify(unsynced));
  }
}

/**
 * Gets list of IDs of todos that are modified locally but not synced
 * @returns {Array<string>}
 */
export function getUnsyncedIds() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.UNSYNCED) || '[]');
  } catch (e) {
    return [];
  }
}

/**
 * Clears the unsynced status for specific IDs (called after successful sync)
 * @param {Array<string>} ids 
 */
export function clearUnsyncedIds(ids) {
  let unsynced = getUnsyncedIds();
  unsynced = unsynced.filter(id => !ids.includes(id));
  localStorage.setItem(KEYS.UNSYNCED, JSON.stringify(unsynced));
}

/* Auth / Sync session management */

export function getUserSession() {
  try {
    const raw = localStorage.getItem(KEYS.USER);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setUserSession(username, token) {
  localStorage.setItem(KEYS.USER, JSON.stringify({ username, token }));
}

export function clearUserSession() {
  localStorage.removeItem(KEYS.USER);
  localStorage.removeItem(KEYS.LAST_SYNC);
  localStorage.setItem(KEYS.UNSYNCED, JSON.stringify([]));
}

export function getLastSyncTime() {
  return localStorage.getItem(KEYS.LAST_SYNC) || null;
}

export function setLastSyncTime(isoString) {
  localStorage.setItem(KEYS.LAST_SYNC, isoString);
}

/* Daily Setup Completed Date tracking */

export function getLastSetupCompletedDate() {
  return localStorage.getItem(KEYS.SETUP_DATE) || null;
}

export function setLastSetupCompletedDate(dateStr) {
  localStorage.setItem(KEYS.SETUP_DATE, dateStr);
}
