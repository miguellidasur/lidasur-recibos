import sql from 'mssql';

console.log('[DB CFG]', {
  server: (process.env.DB_SERVER || '').trim(),
  instance: (process.env.DB_INSTANCE || '').trim(),
  port: process.env.DB_INSTANCE ? undefined : Number(process.env.DB_PORT || 1433),
  database: (process.env.DB_NAME || '').trim(),
  user: (process.env.DB_USER || '').trim(),
  encrypt: process.env.DB_ENCRYPT === 'true'
});

const dbConfig: sql.config = {
  server: (process.env.DB_SERVER || '').trim(),
  port: process.env.DB_INSTANCE ? undefined : Number(process.env.DB_PORT || 1433),
  database: (process.env.DB_NAME || '').trim(),
  user: (process.env.DB_USER || '').trim(),
  password: (process.env.DB_PASSWORD || '').trim(),
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

if (process.env.DB_INSTANCE && process.env.DB_INSTANCE.trim() !== '') {
  (dbConfig as any).options.instanceName = process.env.DB_INSTANCE.trim();
}

let pool: sql.ConnectionPool | null = null;

export async function getConnection() {
  if (pool && pool.connected) return pool;
  pool = await sql.connect(dbConfig);
  return pool;
}

export async function testConnection() {
  try {
    const conn = await getConnection();
    await conn.query`SELECT 1 AS ok`;
    return { dbConnected: true };
  } catch (err: any) {
    return { dbConnected: false, error: err.message };
  }
}
