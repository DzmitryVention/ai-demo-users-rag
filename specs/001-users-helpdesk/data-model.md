# Data model — Feature 001

```
users 1 ──── * tickets 1 ──── * ticket_messages
  ▲                                   │
  └────────── author_id ──────────────┘
```

## users

| Column                  | Type        | Constraints                                     |
| ----------------------- | ----------- | ----------------------------------------------- |
| id                      | uuid        | PK, default `gen_random_uuid()`                 |
| firebase_uid            | text        | UNIQUE, NULL until first sign-in (seeded users) |
| email                   | text        | NOT NULL; UNIQUE on `lower(email)`              |
| first_name              | text        | NOT NULL, ≤ 100 (Name)                          |
| last_name               | text        | NOT NULL, ≤ 100 (Surname)                       |
| phone                   | text        | NULL, ≤ 32                                      |
| about                   | text        | NULL, ≤ 2000                                    |
| avatar_url              | text        | NULL (from Google)                              |
| created_at / updated_at | timestamptz | NOT NULL default now()                          |

Indexes: `users_email_lower_uq`, `users_created_at_idx`.
Role is **not** stored (derived from `ADMIN_EMAILS`, see plan).

## tickets

| Column                  | Type                 | Constraints                                      |
| ----------------------- | -------------------- | ------------------------------------------------ |
| id                      | uuid                 | PK                                               |
| user_id                 | uuid                 | FK → users.id ON DELETE CASCADE                  |
| subject                 | text                 | NOT NULL, 3–200                                  |
| status                  | `ticket_status` enum | `open` \| `answered` \| `closed`, default `open` |
| created_at / updated_at | timestamptz          | `updated_at` = last activity                     |

Indexes: `(user_id, updated_at desc)`, `(status, updated_at desc)`.

## ticket_messages

| Column      | Type               | Constraints                                |
| ----------- | ------------------ | ------------------------------------------ |
| id          | uuid               | PK                                         |
| ticket_id   | uuid               | FK → tickets.id ON DELETE CASCADE          |
| author_id   | uuid               | FK → users.id ON DELETE CASCADE            |
| author_role | `author_role` enum | `user` \| `admin` (snapshot at write time) |
| body        | text               | NOT NULL, 1–5000                           |
| created_at  | timestamptz        |                                            |

Index: `(ticket_id, created_at)`.

## Status transitions

| Event                | From | To       |
| -------------------- | ---- | -------- |
| user creates ticket  | —    | open     |
| admin replies        | any  | answered |
| user posts follow-up | any  | open     |
| user or admin closes | any  | closed   |
| admin sets status    | any  | any      |

## Migrations

| File                       | Content                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `0000_init.sql`            | enums, tables, indexes                                               |
| `0001_seed_fake_users.sql` | 100 Faker users + ~25 sample tickets (deterministic seed `20261111`) |
