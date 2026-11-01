#!/usr/bin/env node
/**
 * CLI Migration Script: Assign Legacy Unowned Projects
 * 
 * Usage:
 *   node src/scripts/migrate-legacy-projects.js --email user@example.com [--project-id <uuid>]
 *   node src/scripts/migrate-legacy-projects.js --list
 */
import 'dotenv/config';
import pg from 'pg';
import { getUnownedProjects, assignUnownedProjects } from '../services/projectMigration.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.includes('-l')) {
    console.log('Fetching unowned legacy projects...');
    const list = await getUnownedProjects(pool);
    if (list.length === 0) {
      console.log('No unowned projects found.');
    } else {
      console.table(list.map(p => ({
        'Project ID': p.id,
        'Name': p.name,
        'Created At': p.created_at,
        'API Keys': p.api_key_count,
        'Notifications': p.notification_count
      })));
    }
    await pool.end();
    return;
  }

  let email = null;
  let projectId = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' || args[i] === '-e') {
      email = args[i + 1];
      i++;
    } else if (args[i] === '--project-id' || args[i] === '-p') {
      projectId = args[i + 1];
      i++;
    }
  }

  if (!email) {
    console.error('Error: An explicit target email is required.');
    console.error('Usage: node src/scripts/migrate-legacy-projects.js --email user@example.com [--project-id <uuid>]');
    await pool.end();
    process.exit(1);
  }

  try {
    console.log(`Starting controlled project migration to target account: ${email}...`);
    const result = await assignUnownedProjects(pool, { targetEmail: email, projectId });

    if (result.assignedCount === 0) {
      console.log('No unowned projects were found to assign.');
    } else {
      console.log(`Successfully assigned ${result.assignedCount} unowned project(s) to ${result.targetUser.email} (${result.targetUser.id}):`);
      console.table(result.assignedProjects.map(p => ({
        'Project ID': p.id,
        'Name': p.name,
        'Owner User ID': p.user_id
      })));
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
