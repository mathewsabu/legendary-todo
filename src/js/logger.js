/**
 * Generates audit-trail log entries for todos.
 */

/**
 * Creates a log entry object.
 * @param {string} type - 'created' | 'completed' | 'uncompleted' | 'note_edit' | 'assigned' | 'unassigned' | 'renamed'
 * @param {string} detail - Description of the action
 * @returns {object} The LogEntry object
 */
export function createLogEntry(type, detail = '') {
  return {
    type,
    timestamp: new Date().toISOString(),
    detail: detail
  };
}

/**
 * Formats a timestamp into a readable date/time string.
 * @param {string} isoString 
 * @returns {string} Readable string
 */
export function formatLogTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
