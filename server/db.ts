import pg from "pg";

export type Db = pg.Pool;

export function createPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

/** Migrations numérotées, appliquées une seule fois, dans l'ordre. */
const MIGRATIONS: string[] = [
  `
  create table users (
    id bigserial primary key,
    username text not null,
    password_hash text not null,
    token_version integer not null default 0,
    settings jsonb,
    created_at timestamptz not null default now()
  );
  create unique index users_username_lower on users (lower(username));

  create table exports (
    id bigserial primary key,
    user_id bigint not null references users(id) on delete cascade,
    tag text not null,
    exported_at timestamptz not null,
    raw jsonb not null,
    summary jsonb not null,
    created_at timestamptz not null default now(),
    unique (user_id, exported_at)
  );
  create index exports_user_time on exports (user_id, exported_at desc);
  `,
];

export async function migrate(db: Db): Promise<number> {
  const client = await db.connect();
  try {
    // Verrou pour qu'un seul conteneur migre à la fois.
    await client.query("select pg_advisory_lock(424242)");
    await client.query("create table if not exists schema_migrations (version integer primary key, applied_at timestamptz not null default now())");
    const { rows } = await client.query<{ version: number }>("select version from schema_migrations");
    const done = new Set(rows.map((r) => r.version));
    let applied = 0;
    for (const [i, sql] of MIGRATIONS.entries()) {
      const version = i + 1;
      if (done.has(version)) continue;
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version) values ($1)", [version]);
        await client.query("commit");
        applied++;
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
    return applied;
  } finally {
    await client.query("select pg_advisory_unlock(424242)").catch(() => {});
    client.release();
  }
}
