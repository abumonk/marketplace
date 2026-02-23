/**
 * Standardized MCP error response constructors.
 *
 * All tool handlers should return these objects on failure rather than
 * constructing ad-hoc error shapes. Each function returns an MCP tool
 * response with isError: true and a JSON-encoded { error, message } body.
 *
 * Error codes:
 *   VALIDATION_ERROR  - Input failed schema or business-rule validation
 *   NOT_FOUND         - Requested resource does not exist
 *   LOCK_CONFLICT     - Resource is locked by another session
 *   INTERNAL_ERROR    - Unexpected server-side failure
 */

/**
 * Build a structured MCP error response.
 * @param {string} code   - Error code constant (e.g. 'NOT_FOUND')
 * @param {string} message - Human-readable description
 * @returns {{ content: Array, isError: true }}
 */
function makeError(code, message) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: code, message }),
      },
    ],
    isError: true,
  };
}

/**
 * Input did not pass validation (missing fields, bad values, etc.).
 * @param {string} message
 */
export function VALIDATION_ERROR(message) {
  return makeError('VALIDATION_ERROR', message);
}

/**
 * The requested resource (task, config, knowledge entry) was not found.
 * @param {string} message
 */
export function NOT_FOUND(message) {
  return makeError('NOT_FOUND', message);
}

/**
 * The resource is currently locked by another session.
 * @param {string} message
 */
export function LOCK_CONFLICT(message) {
  return makeError('LOCK_CONFLICT', message);
}

/**
 * An unexpected internal error occurred.
 * @param {string} message
 */
export function INTERNAL_ERROR(message) {
  return makeError('INTERNAL_ERROR', message);
}
