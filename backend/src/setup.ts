/**
 * Keyrail PAM - Initial Setup Endpoints
 * 
 * This module provides the initial setup flow for a fresh installation.
 * It creates the first tenant, first administrator, and initial configuration.
 * 
 * Security: These endpoints are ONLY available when no tenants exist.
 * After the first tenant is created, these endpoints become unavailable.
 */
import argon2 from 'argon2';
import { pool } from './db.js';
import { generateDek, seal } from './crypto.js';
import { randomToken } from './crypto.js';
import { audit } from './audit.js';
import type { HttpError } from './db.js';

// Check if system has been initialized (any tenant exists)
export async function isSystemInitialized(): Promise<boolean> {
  const { rows } = await pool.query(`SELECT COUNT(*) as count FROM tenants WHERE status = 'ACTIVE'`);
  return parseInt(rows[0].count) > 0;
}

// Check if initial setup is required
export async function checkInitialSetup(): Promise<{ requiresSetup: boolean; hasUsers: boolean }> {
  const initialized = await isSystemInitialized();
  
  if (initialized) {
    // Check if there are any users
    const { rows } = await pool.query(`SELECT COUNT(*) as count FROM users WHERE status = 'ACTIVE'`);
    return { requiresSetup: false, hasUsers: parseInt(rows[0].count) > 0 };
  }
  
  return { requiresSetup: true, hasUsers: false };
}

// Initialize the system with first tenant and admin
export async function initializeSystem(params: {
  organizationName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  tenantSlug: string;
}): Promise<{ ok: boolean; user: any }> {
  // Double-check that system is not already initialized
  const initialized = await isSystemInitialized();
  if (initialized) {
    throw new Error('System already initialized');
  }

  // Validate inputs
  if (!params.organizationName || params.organizationName.trim().length < 2) {
    throw new Error('Organization name is required');
  }
  if (!params.adminName || params.adminName.trim().length < 2) {
    throw new Error('Administrator name is required');
  }
  if (!params.adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(params.adminEmail)) {
    throw new Error('Valid administrator email is required');
  }
  if (!params.adminPassword || params.adminPassword.length < 12) {
    throw new Error('Administrator password must be at least 12 characters');
  }
  if (!params.tenantSlug || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(params.tenantSlug)) {
    throw new Error('Valid tenant slug is required (lowercase alphanumeric and hyphens)');
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Create the tenant
    const tenantResult = await client.query(
      `INSERT INTO tenants (name, slug, region, plan, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       RETURNING id, name, slug, region, plan`,
      [params.organizationName.trim(), params.tenantSlug.trim(), 'global', 'enterprise']
    );
    const tenant = tenantResult.rows[0];
    
    // 2. Create system roles (if not exist)
    const exRoles = await client.query(`SELECT 1 FROM roles WHERE is_system = true`);
    if (exRoles.rows.length === 0) {
      await client.query(`
        INSERT INTO roles (name, is_system) VALUES 
          ('SUPER_ADMIN', true),
          ('ORG_ADMIN', true),
          ('PAM_ADMIN', true),
          ('SECURITY_ADMIN', true),
          ('AUDITOR', true),
          ('USER', true),
          ('READ_ONLY', true)
      `);
    }
    
    // 3. Create permissions (if not exist)
    await client.query(`
      INSERT INTO permissions (name) VALUES 
        ('credential.view_metadata'),
        ('credential.use'),
        ('credential.reveal'),
        ('credential.create'),
        ('credential.update'),
        ('credential.delete'),
        ('application.create'),
        ('application.update'),
        ('application.delete'),
        ('application.launch'),
        ('collection.create'),
        ('collection.update'),
        ('collection.delete'),
        ('session.start'),
        ('session.terminate'),
        ('session.record.view'),
        ('user.create'),
        ('user.disable'),
        ('policy.create'),
        ('policy.update'),
        ('audit.view')
      ON CONFLICT (name) DO NOTHING
    `);
    
    // 4. Get role IDs
    const { rows: roles } = await client.query(`SELECT id, name FROM roles WHERE is_system = true`);
    const roleIdMap: Record<string, string> = {};
    roles.forEach((r: any) => { roleIdMap[r.name] = r.id; });
    
    // 5. Get permission IDs
    const { rows: perms } = await client.query(`SELECT id, name FROM permissions`);
    const permIdMap: Record<string, string> = {};
    perms.forEach((p: any) => { permIdMap[p.name] = p.id; });
    
    // 6. Assign all permissions to SUPER_ADMIN
    const superAdminRoleId = roleIdMap['SUPER_ADMIN'];
    if (superAdminRoleId) {
      for (const perm of perms) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [superAdminRoleId, perm.id]
        );
      }
    }
    
    // 7. Assign appropriate permissions to other roles
    const rolePermissions: Record<string, string[]> = {
      ORG_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'user.disable', 'policy.create', 'policy.update', 'audit.view'],
      PAM_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'policy.create', 'policy.update', 'audit.view'],
      SECURITY_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.reveal', 'application.launch', 'session.start', 'session.terminate', 'session.record.view', 'policy.create', 'policy.update', 'audit.view'],
      AUDITOR: ['credential.view_metadata', 'session.record.view', 'audit.view'],
      USER: ['credential.view_metadata', 'credential.use', 'application.launch', 'session.start'],
      READ_ONLY: ['credential.view_metadata'],
    };
    
    for (const [roleName, permNames] of Object.entries(rolePermissions)) {
      const roleId = roleIdMap[roleName];
      if (!roleId) continue;
      for (const permName of permNames) {
        const permId = permIdMap[permName];
        if (permId) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [roleId, permId]
          );
        }
      }
    }
    
    // 8. Hash the password
    const passwordHash = await argon2.hash(params.adminPassword);
    
    // 9. Create the administrator user
    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, status, mfa_required)
       VALUES ($1, $2, $3, $4, 'ACTIVE', false)
       RETURNING id, email, name, tenant_id`,
      [tenant.id, params.adminEmail.trim().toLowerCase(), params.adminName.trim(), passwordHash]
    );
    const user = userResult.rows[0];
    
    // 10. Assign SUPER_ADMIN role to the user
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
      [user.id, roleIdMap['SUPER_ADMIN']]
    );
    
    // 11. Generate and store the tenant DEK (Data Encryption Key)
    await generateDek(tenant.id);
    
    // 12. Create default collection
    const collectionResult = await client.query(
      `INSERT INTO collections (tenant_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tenant.id, 'Default', 'Default collection for all credentials']
    );
    const collectionId = collectionResult.rows[0].id;
    
    // 13. Add user to default collection
    await client.query(
      `INSERT INTO collection_members (collection_id, user_id)
       VALUES ($1, $2)`,
      [collectionId, user.id]
    );
    
    // 14. Create default access policy
    await client.query(
      `INSERT INTO access_policies (tenant_id, name, rule, created_by, enabled)
       VALUES ($1, $2, $3, $4, true)`,
      [tenant.id, 'default-launch-policy', JSON.stringify({
        mfa_step_up: true,
        geo_allow: [],
        max_concurrent_sessions: 5,
        idle_timeout_min: 15,
        record_sessions: true,
      }), user.id]
    );
    
    // 15. Create initial audit event
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_id, actor_name, event_type, result, meta, source_ip, hash, prev_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tenant.id, user.id, params.adminName, 'SYSTEM_INITIALIZED', 'SUCCESS', 
       `Initial setup by ${params.adminName} (${params.adminEmail})`, '0.0.0.0', 
       '0000000000000000000000000000000000000000000000000000000000000000', '0000000000000000000000000000000000000000000000000000000000000000']
    );
    
    await client.query('COMMIT');
    
    // Return success with user info
    return {
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'SUPER_ADMIN',
        tenantId: tenant.id,
        authMethod: 'PASSWORD',
        sessionId: randomToken(16),
        issuedAt: Date.now(),
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Get setup status (for UI to show progress)
export async function getSetupStatus(): Promise<{
  initialized: boolean;
  tenantCount: number;
  userCount: number;
  hasSuperAdmin: boolean;
}> {
  const { rows: tenants } = await pool.query(`SELECT COUNT(*) as count FROM tenants WHERE status = 'ACTIVE'`);
  const { rows: users } = await pool.query(`SELECT COUNT(*) as count FROM users WHERE status = 'ACTIVE'`);
  const { rows: superAdmins } = await pool.query(`
    SELECT COUNT(*) as count 
    FROM users u 
    JOIN user_roles ur ON ur.user_id = u.id 
    JOIN roles r ON r.id = ur.role_id 
    WHERE r.name = 'SUPER_ADMIN' AND u.status = 'ACTIVE'
  `);
  
  return {
    initialized: parseInt(tenants[0].count) > 0,
    tenantCount: parseInt(tenants[0].count),
    userCount: parseInt(users[0].count),
    hasSuperAdmin: parseInt(superAdmins[0].count) > 0,
  };
}

export default {
  isSystemInitialized,
  checkInitialSetup,
  initializeSystem,
  getSetupStatus,
};
