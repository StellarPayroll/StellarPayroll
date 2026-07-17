import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../db/client';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const router = Router();

// GET /api/employees/org/:orgId
router.get('/org/:orgId', async (req: Request, res: Response) => {
  const rawPage = Number(req.query.page ?? DEFAULT_PAGE);
  const rawLimit = Number(req.query.limit ?? DEFAULT_LIMIT);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : DEFAULT_PAGE;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = (page - 1) * limit;

  const { rows } = await db.query(
    'SELECT * FROM employees WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [req.params.orgId, limit, offset]
  );
  const { rows: [{ count }] } = await db.query(
    'SELECT COUNT(*) FROM employees WHERE org_id = $1',
    [req.params.orgId]
  );

  return res.json({ data: rows, total: Number(count), page, limit });
});

// POST /api/employees/org/:orgId
router.post(
  '/org/:orgId',
  [
    body('name').trim().notEmpty(),
    body('wallet_address').trim().isLength({ min: 56, max: 56 }),
    body('currency').isIn(['XLM', 'USDC']),
    body('role').isIn(['admin', 'finance', 'employee']),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, wallet_address, role, currency } = req.body;
    const { rows } = await db.query(
      'INSERT INTO employees (org_id, name, email, wallet_address, role, currency) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.orgId, name, email || null, wallet_address, role || 'employee', currency || 'USDC']
    );
    return res.status(201).json(rows[0]);
  }
);

// PUT /api/employees/:id
router.put('/:id', async (req: Request, res: Response) => {
  const { name, email, wallet_address, role, currency } = req.body;
  const { rows } = await db.query(
    `UPDATE employees SET
      name = COALESCE($1, name),
      email = COALESCE($2, email),
      wallet_address = COALESCE($3, wallet_address),
      role = COALESCE($4, role),
      currency = COALESCE($5, currency)
    WHERE id = $6 RETURNING *`,
    [name, email, wallet_address, role, currency, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Employee not found' });
  return res.json(rows[0]);
});

// DELETE /api/employees/:id
router.delete('/:id', async (req: Request, res: Response) => {
  await db.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
  return res.status(204).send();
});

// POST /api/employees/org/:orgId/import — bulk import
router.post('/org/:orgId/import', async (req: Request, res: Response) => {
  const employees: any[] = req.body.employees;
  if (!Array.isArray(employees) || !employees.length) {
    return res.status(400).json({ error: 'employees array required' });
  }

  const inserted: any[] = [];
  for (const emp of employees) {
    if (!emp.name || !emp.wallet_address) continue;
    const { rows } = await db.query(
      'INSERT INTO employees (org_id, name, email, wallet_address, role, currency) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.orgId, emp.name, emp.email || null, emp.wallet_address, emp.role || 'employee', emp.currency || 'USDC']
    );
    inserted.push(rows[0]);
  }
  return res.status(201).json({ imported: inserted.length, employees: inserted });
});

export default router;
