/**
 * Controlled Legacy Project Ownership Migration Service
 * 
 * Manages the migration of legacy unowned projects (user_id IS NULL)
 * to an explicitly specified user account.
 * 
 * Rules:
 * - Never silently transfer ownership.
 * - Never overwrite or reassign projects that already have an owner.
 * - Preserve all existing project data, API keys, notifications, and attempts.
 */

/**
 * Lists all legacy projects that currently do not have an owner.
 */
export async function getUnownedProjects(pool) {
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.created_at,
           COUNT(DISTINCT k.id)::int AS api_key_count,
           COUNT(DISTINCT n.id)::int AS notification_count
    FROM projects p
    LEFT JOIN api_keys k ON k.project_id = p.id
    LEFT JOIN notifications n ON n.project_id = p.id
    WHERE p.user_id IS NULL
    GROUP BY p.id
    ORDER BY p.created_at ASC
  `);
  return rows;
}

/**
 * Assigns unowned project(s) to an explicitly specified user account.
 * 
 * @param {import('pg').Pool} pool 
 * @param {Object} options
 * @param {string} [options.targetEmail] - Explicit email of the destination account
 * @param {string} [options.targetUserId] - Explicit user ID of the destination account
 * @param {string} [options.projectId] - Specific project ID to migrate (optional)
 * @returns {Promise<{ targetUser: Object, assignedProjects: Array, assignedCount: number }>}
 */
export async function assignUnownedProjects(pool, { targetEmail, targetUserId, projectId } = {}) {
  if (!targetEmail && !targetUserId) {
    throw new Error('An explicit target account (targetEmail or targetUserId) must be specified for migration.');
  }

  // 1. Resolve and verify the target user exists
  let targetUser;
  if (targetUserId) {
    const { rows } = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [targetUserId]);
    if (rows.length === 0) {
      throw new Error(`Target user account not found with ID: ${targetUserId}`);
    }
    targetUser = rows[0];
  } else {
    const email = String(targetEmail).trim().toLowerCase();
    const { rows } = await pool.query('SELECT id, email, name FROM users WHERE LOWER(email) = $1', [email]);
    if (rows.length === 0) {
      throw new Error(`Target user account not found with email: ${email}`);
    }
    targetUser = rows[0];
  }

  // 2. If a specific projectId was specified, inspect and validate it
  if (projectId) {
    const { rows } = await pool.query('SELECT id, name, user_id FROM projects WHERE id = $1', [projectId]);
    if (rows.length === 0) {
      throw new Error(`Project not found with ID: ${projectId}`);
    }

    const project = rows[0];
    if (project.user_id !== null) {
      // NEVER silently transfer ownership of already-owned projects
      throw new Error(
        `Project "${project.name}" (${project.id}) already has an assigned owner. Silent or forced ownership transfers are strictly prohibited.`
      );
    }

    // Atomically assign ONLY if still unowned
    const updateResult = await pool.query(
      'UPDATE projects SET user_id = $1 WHERE id = $2 AND user_id IS NULL RETURNING id, name, user_id, created_at',
      [targetUser.id, projectId]
    );

    return {
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name
      },
      assignedProjects: updateResult.rows,
      assignedCount: updateResult.rowCount
    };
  }

  // 3. If no specific projectId was specified, migrate all currently unowned projects
  const unowned = await pool.query('SELECT id, name FROM projects WHERE user_id IS NULL');
  if (unowned.rowCount === 0) {
    return {
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name
      },
      assignedProjects: [],
      assignedCount: 0
    };
  }

  const updateResult = await pool.query(
    'UPDATE projects SET user_id = $1 WHERE user_id IS NULL RETURNING id, name, user_id, created_at',
    [targetUser.id]
  );

  return {
    targetUser: {
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name
    },
    assignedProjects: updateResult.rows,
    assignedCount: updateResult.rowCount
  };
}
