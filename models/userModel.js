export function createUserRepository(pool) {
  return {
    async create({ id, role, fullName, email, phone, passwordHash }) {
      const { rows } = await pool.query(
        `INSERT INTO users (id, role, full_name, email, phone, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, role, full_name AS "fullName", email, phone,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, role, fullName, email, phone, passwordHash],
      );
      return rows[0];
    },

    async findById(id) {
      const { rows } = await pool.query(
        `SELECT id, role, full_name AS "fullName", email, phone,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM users WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
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
      const columns = { fullName: 'full_name', email: 'email', phone: 'phone' };
      const entries = Object.entries(changes);
      const assignments = entries.map(([key], index) => `${columns[key]} = $${index + 2}`);
      const values = [id, ...entries.map(([, value]) => value)];
      const { rows } = await pool.query(
        `UPDATE users SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = $1
         RETURNING id, role, full_name AS "fullName", email, phone,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        values,
      );
      return rows[0] ?? null;
    },

    async delete(id) {
      const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
      return rowCount > 0;
    },
  };
}
