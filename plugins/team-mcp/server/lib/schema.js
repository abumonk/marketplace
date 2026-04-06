/**
 * Schema validation and transition rules for task pipeline.
 */

// Valid pipeline stages
export const STAGES = ['planning', 'preparing', 'implementing', 'reviewing', 'fixing', 'completed', 'researching'];

// Valid statuses per stage
export const STAGE_STATUSES = {
  planning: ['in_progress', 'ready', 'blocked_on_question', 'BLOCKED', 'error'],
  preparing: ['in_progress', 'ready', 'blocked_on_question', 'BLOCKED', 'error'],
  implementing: ['in_progress', 'ready', 'blocked_on_question', 'BLOCKED', 'error'],
  reviewing: ['in_progress', 'passed', 'failed', 'blocked_on_question', 'BLOCKED', 'error'],
  fixing: ['in_progress', 'ready', 'blocked_on_question', 'BLOCKED', 'error'],
  completed: ['done', 'cancelled'],
  researching: ['in_progress', 'done', 'error'],
};

// Valid stage transitions (from -> to)
export const VALID_TRANSITIONS = {
  planning: ['preparing', 'implementing'],  // preparing for adventure tasks, implementing for standalone
  preparing: ['implementing'],
  implementing: ['reviewing'],
  reviewing: ['fixing', 'completed'],
  fixing: ['reviewing'],
  completed: ['researching'],
  researching: [], // terminal stage
};

// Task ID patterns: standalone (TASK-001) and adventure (ADV015-T001)
export const TASK_ID_PATTERN = /^(TASK-\d{3,}|ADV\d{3,}-T\d{3,})$/;

// Stage-to-default-assignee mapping
export const STAGE_ASSIGNEES = {
  planning: 'planner',
  preparing: 'adventure-preparer',
  implementing: 'implementer',
  reviewing: 'reviewer',
  fixing: 'implementer',
  completed: null, // no assignee when completed
  researching: 'researcher',
};

// Required task frontmatter fields
export const REQUIRED_FIELDS = ['id', 'title', 'stage', 'status', 'created', 'updated'];

/**
 * Validate task frontmatter against schema.
 * Returns { valid: true } or { valid: false, errors: [...] }
 */
export function validateTask(frontmatter) {
  const errors = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (frontmatter[field] === undefined || frontmatter[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate stage
  if (frontmatter.stage && !STAGES.includes(frontmatter.stage)) {
    errors.push(`Invalid stage: ${frontmatter.stage}. Valid stages: ${STAGES.join(', ')}`);
  }

  // Validate status for stage
  if (frontmatter.stage && frontmatter.status) {
    const validStatuses = STAGE_STATUSES[frontmatter.stage];
    if (validStatuses && !validStatuses.includes(frontmatter.status)) {
      errors.push(`Invalid status '${frontmatter.status}' for stage '${frontmatter.stage}'. Valid statuses: ${validStatuses.join(', ')}`);
    }
  }

  // Validate arrays
  if (frontmatter.files && !Array.isArray(frontmatter.files)) {
    errors.push('Field "files" must be an array');
  }
  if (frontmatter.repos && !Array.isArray(frontmatter.repos)) {
    errors.push('Field "repos" must be an array');
  }
  if (frontmatter.depends_on && !Array.isArray(frontmatter.depends_on)) {
    errors.push('Field "depends_on" must be an array');
  }
  if (frontmatter.tags && !Array.isArray(frontmatter.tags)) {
    errors.push('Field "tags" must be an array');
  }
  if (frontmatter.packages && !Array.isArray(frontmatter.packages)) {
    errors.push('Field "packages" must be an array');
  }

  // Validate iterations is a number
  if (frontmatter.iterations !== undefined && typeof frontmatter.iterations !== 'number') {
    errors.push('Field "iterations" must be a number');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Validate a stage transition.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateTransition(fromStage, toStage) {
  if (!STAGES.includes(fromStage)) {
    return { valid: false, error: `Invalid source stage: ${fromStage}` };
  }
  if (!STAGES.includes(toStage)) {
    return { valid: false, error: `Invalid target stage: ${toStage}` };
  }

  const validNextStages = VALID_TRANSITIONS[fromStage];
  if (!validNextStages.includes(toStage)) {
    return {
      valid: false,
      error: `Invalid transition: ${fromStage} -> ${toStage}. Valid next stages from ${fromStage}: ${validNextStages.length > 0 ? validNextStages.join(', ') : 'none (terminal stage)'}`,
    };
  }

  return { valid: true };
}

/**
 * Determine the next stage based on current stage and status.
 * Returns next stage string or null if no automatic transition.
 */
export function getNextStage(currentStage, status) {
  // planning -> implementing (when ready, standalone tasks)
  // Note: adventure tasks go planning -> preparing instead (handled by lead routing)
  if (currentStage === 'planning' && status === 'ready') {
    return 'implementing';
  }

  // preparing -> implementing (when ready, adventure tasks only)
  if (currentStage === 'preparing' && status === 'ready') {
    return 'implementing';
  }

  // implementing -> reviewing (when ready)
  if (currentStage === 'implementing' && status === 'ready') {
    return 'reviewing';
  }

  // reviewing -> completed (when passed)
  if (currentStage === 'reviewing' && status === 'passed') {
    return 'completed';
  }

  // reviewing -> fixing (when failed)
  if (currentStage === 'reviewing' && status === 'failed') {
    return 'fixing';
  }

  // fixing -> reviewing (when ready)
  if (currentStage === 'fixing' && status === 'ready') {
    return 'reviewing';
  }

  // completed -> researching (manual transition, no auto-trigger)
  // researching is terminal (no further transitions)

  return null;
}

/**
 * Get the default assignee for a given stage.
 */
export function getDefaultAssignee(stage) {
  return STAGE_ASSIGNEES[stage] || null;
}

// ---- Adventure state machine ----

export const ADVENTURE_STATES = [
  'concept', 'planning', 'review', 'active',
  'paused', 'blocked', 'completed', 'cancelled',
];

export const ADVENTURE_TRANSITIONS = {
  concept: ['planning', 'cancelled'],
  planning: ['review', 'cancelled'],
  review: ['active', 'planning', 'cancelled'],
  active: ['paused', 'completed', 'blocked', 'cancelled'],
  paused: ['active', 'cancelled'],
  blocked: ['active', 'cancelled'],
  // completed and cancelled are terminal
};

/**
 * Validate an adventure state transition.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateAdventureTransition(from, to) {
  if (!ADVENTURE_STATES.includes(from)) return { valid: false, error: `Invalid state: ${from}` };
  if (!ADVENTURE_STATES.includes(to)) return { valid: false, error: `Invalid state: ${to}` };
  const allowed = ADVENTURE_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return { valid: false, error: `Cannot transition from '${from}' to '${to}'` };
  return { valid: true };
}
