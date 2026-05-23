// Read-only roles list — used by the admin UI to populate the
// "assign role" dropdown. Org-scoped.

import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { roles } from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';
import { requirePermission } from '../rbac/requirePermission.js';

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

rolesRouter.get(
  '/',
  requirePermission('user.manage', 'org'),
  async (req, res) => {
    const rows = await db
      .select({ id: roles.id, code: roles.code, name: roles.name })
      .from(roles)
      .where(eq(roles.orgId, req.user.orgId))
      .orderBy(asc(roles.code));
    res.json({ roles: rows });
  },
);
