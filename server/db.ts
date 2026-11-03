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
  // 2 : email confirmé à l'inscription, codes envoyés par email (confirmation, mot de passe oublié).
  `
  alter table users add column email text;
  alter table users add column email_verified_at timestamptz;
  create unique index users_email_lower on users (lower(email));

  create table email_codes (
    id bigserial primary key,
    user_id bigint not null references users(id) on delete cascade,
    purpose text not null check (purpose in ('verify', 'reset')),
    code_hash text not null,
    attempts integer not null default 0,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  );
  create index email_codes_user on email_codes (user_id, purpose);
  `,
  // 3 : actions du plan cochées « fait », notifications push (abonnements et rappels à envoyer).
  `
  alter table users add column plan_checks jsonb;

  create table push_subscriptions (
    id bigserial primary key,
    user_id bigint not null references users(id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    created_at timestamptz not null default now()
  );
  create index push_subscriptions_user on push_subscriptions (user_id);

  create table push_queue (
    id bigserial primary key,
    user_id bigint not null references users(id) on delete cascade,
    key text not null,
    send_at timestamptz not null,
    title text not null,
    body text not null,
    sent_at timestamptz,
    unique (user_id, key)
  );
  create index push_queue_due on push_queue (send_at) where sent_at is null;
  `,
  // 4 : backlog de la communauté (idées, bugs, modifications) et votes.
  `
  create table backlog_items (
    id bigserial primary key,
    user_id bigint not null references users(id) on delete cascade,
    kind text not null check (kind in ('feature', 'bug', 'change')),
    title text not null,
    body text not null default '',
    status text not null default 'open' check (status in ('open', 'planned', 'done', 'declined')),
    created_at timestamptz not null default now()
  );
  create index backlog_items_created on backlog_items (created_at desc);
  create index backlog_items_user on backlog_items (user_id, created_at desc);

  create table backlog_votes (
    item_id bigint not null references backlog_items(id) on delete cascade,
    user_id bigint not null references users(id) on delete cascade,
    primary key (item_id, user_id)
  );
  `,
  // 5 : rôle admin, backlog en tableau kanban (backlog, en cours, déployé, validé), commentaires et captures.
  `
  alter table users add column is_admin boolean not null default false;
  update users set is_admin = true where lower(username) = 'max_perso';

  alter table backlog_items drop constraint if exists backlog_items_status_check;
  update backlog_items set status = case status when 'done' then 'deployed' else 'backlog' end;
  alter table backlog_items alter column status set default 'backlog';
  alter table backlog_items add constraint backlog_items_status_check
    check (status in ('backlog', 'in_progress', 'deployed', 'validated'));
  alter table backlog_items add column moved_at timestamptz not null default now();

  create table backlog_comments (
    id bigserial primary key,
    item_id bigint not null references backlog_items(id) on delete cascade,
    user_id bigint not null references users(id) on delete cascade,
    body text not null,
    created_at timestamptz not null default now()
  );
  create index backlog_comments_item on backlog_comments (item_id, created_at);
  create index backlog_comments_user on backlog_comments (user_id, created_at desc);

  create table backlog_images (
    id bigserial primary key,
    item_id bigint not null references backlog_items(id) on delete cascade,
    comment_id bigint references backlog_comments(id) on delete cascade,
    user_id bigint not null references users(id) on delete cascade,
    mime text not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
    data bytea not null,
    created_at timestamptz not null default now()
  );
  create index backlog_images_item on backlog_images (item_id);
  `,
  // 6 : « Quoi de neuf ? » vu une seule fois par compte. Les comptes existants n'ont encore rien vu ;
  // pour les tickets déployés, on part de maintenant (pas tout l'historique).
  `
  alter table users add column seen_release integer not null default 0;
  alter table users add column whats_new_seen_at timestamptz not null default now();
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
