import { randomUUID } from 'node:crypto';

async function fetchUser(client, id) {
  const { rows } = await client.query(
    `SELECT u.id, u.role, u.full_name AS "fullName", u.email, u.phone,
            u.created_at AS "createdAt", u.updated_at AS "updatedAt",
            CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', p.id,
              'userId', p.user_id,
              'serviceType', p.service_type,
              'serviceArea', p.service_area,
              'basePrice', p.base_price,
              'attributes', p.attributes,
              'createdAt', p.created_at,
              'updatedAt', p.updated_at
            ) END AS "providerDetails"
     FROM users u LEFT JOIN providers p ON p.user_id = u.id
     WHERE u.id = $1`,
    [id],
  );
  const user = rows[0] ?? null;
  if (user && user.role !== 'service_provider') delete user.providerDetails;
  return user;
}

export function createUserRepository(pool) {
  return {
    async list({ role, limit, offset }) {
      const { rows } = await pool.query(
        `SELECT id, role, full_name AS "fullName", email, phone,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM users WHERE ($1::text IS NULL OR role = $1)
         ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [role ?? null, limit, offset],
      );
      return rows;
    },
    async create({ id, role, fullName, email, phone, passwordHash, providerDetails }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO users (id, role, full_name, email, phone, password_hash)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, role, fullName, email, phone, passwordHash],
        );
        if (providerDetails) {
          await client.query(
            `INSERT INTO providers (id, user_id, service_type, service_area, base_price, attributes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomUUID(), id, providerDetails.serviceType, providerDetails.serviceArea,
              providerDetails.basePrice, JSON.stringify(providerDetails.attributes)],
          );
        }
        const user = await fetchUser(client, id);
        await client.query('COMMIT');
        return user;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async findById(id) {
      return fetchUser(pool, id);
    },

    async findAuthByEmail(email) {
      const { rows } = await pool.query(
        `SELECT id, role, email, password_hash AS "passwordHash",
                auth_version AS "authVersion"
         FROM users WHERE email = $1`,
        [email],
      );
      return rows[0] ?? null;
    },

    async findAuthById(id) {
      const { rows } = await pool.query(
        `SELECT id, role, email, password_hash AS "passwordHash",
                auth_version AS "authVersion"
         FROM users WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },

    async updatePassword(id, oldVersion, passwordHash) {
      const { rows } = await pool.query(
        `UPDATE users SET password_hash = $3, auth_version = auth_version + 1,
                          updated_at = NOW()
         WHERE id = $1 AND auth_version = $2
         RETURNING id, role, auth_version AS "authVersion"`,
        [id, oldVersion, passwordHash],
      );
      return rows[0] ?? null;
    },

    async setPasswordByEmail(email, passwordHash) {
      const { rowCount } = await pool.query(
        `UPDATE users SET password_hash = $2, auth_version = auth_version + 1,
                          updated_at = NOW()
         WHERE email = $1 AND password_hash IS NULL`,
        [email, passwordHash],
      );
      return rowCount > 0;
    },

    async update(id, changes) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
        if (!locked.rowCount) {
          await client.query('ROLLBACK');
          return null;
        }
        const { providerDetails, ...userChanges } = changes;
        const userColumns = { fullName: 'full_name', email: 'email', phone: 'phone' };
        const userEntries = Object.entries(userChanges);
        const userAssignments = userEntries.map(([key], index) => `${userColumns[key]} = $${index + 2}`);
        await client.query(
          `UPDATE users SET ${[...userAssignments, 'updated_at = NOW()'].join(', ')} WHERE id = $1`,
          [id, ...userEntries.map(([, value]) => value)],
        );
        if (providerDetails) {
          const existing = await client.query('SELECT id FROM providers WHERE user_id = $1 FOR UPDATE', [id]);
          if (existing.rowCount) {
            const providerColumns = {
              serviceType: 'service_type', serviceArea: 'service_area',
              basePrice: 'base_price', attributes: 'attributes',
            };
            const entries = Object.entries(providerDetails);
            const assignments = entries.map(([key], index) => `${providerColumns[key]} = $${index + 2}`);
            const values = entries.map(([key, value]) => key === 'attributes' ? JSON.stringify(value) : value);
            await client.query(
              `UPDATE providers SET ${assignments.join(', ')}, updated_at = NOW() WHERE user_id = $1`,
              [id, ...values],
            );
          } else {
            await client.query(
              `INSERT INTO providers (id, user_id, service_type, service_area, base_price, attributes)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [randomUUID(), id, providerDetails.serviceType, providerDetails.serviceArea,
                providerDetails.basePrice, JSON.stringify(providerDetails.attributes ?? {})],
            );
          }
        }
        const user = await fetchUser(client, id);
        await client.query('COMMIT');
        return user;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async delete(id) {
      const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
      return rowCount > 0;
    },
  };
}
