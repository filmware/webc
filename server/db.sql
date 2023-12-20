\set ON_ERROR_STOP

alter database filmware set timezone to 'utc';

-- projects are one per production
create sequence if not exists projects_seq as int8 start 1;
create table if not exists projects (
    srv_id int not null default 1,
    seqno int8 not null default nextval('projects_seq'),
    version uuid unique,
    project uuid not null,
    name varchar(64) not null unique,
    "user" uuid not null,
    submissiontime timestamptz not null,
    authortime timestamptz not null,
    archivetime jsonb,

    constraint projects_seq_uniq unique (srv_id, seqno)
);
create index if not exists projects_project_idx on projects (project);

-- Users:
-- - a User is really just a UUID for tagging what a human does in the system
-- - e.g. every comment has a "User" UUID
-- - a User does not have a name or a password
-- - a User does have a mutable Account UUID it is linked to
-- - multiple users may link to one Account, if accounts have been merged
--
-- Accounts:
-- - an Account has email, password, display name, etc
-- - an Account has a primary User uuid to tag objects uploaded by a session
-- - e.g. which "User" is the author of a comment uploaded after logging in
-- - the User of an Account is immutable even after a merge
-- - every merge orphans one Account
--
-- Permissions:
-- - Permissions are assigned to Users
-- - merging accounts does not affect Permissions table
-- - Account Permissions are the union of Permissions for Users for an Account
--
-- Session:
-- - a session represents a login
-- - a session is tied to accounts, not to users
-- - multiple sessions may link to one Account
--
-- How do invitations work:
-- - a Session for an Account with invite Permission invites an email address
-- - an Account, a User, and a Permission are created immediately
-- - initial Account password is empty
-- - the magic link in the email contains the email address and the session
-- - if the user clicks fast enough, they start logged in into the session
-- - else they are instructed to use OTP or reset password
--
-- How does login work:
-- - log in via email address + password
-- - log in via existing Session
-- - if the Account has no password, they can send OTP or reset password

-- users can participate in multiple projects
create sequence if not exists users_seq as int8 start 1;
create table if not exists users (
    srv_id int not null default 1,
    seqno int8 not null default nextval('users_seq'),
    version uuid unique,
    "user" uuid not null,
    account uuid not null,
    submissiontime timestamptz not null,
    authortime timestamptz not null,
    archivetime jsonb,

    constraint users_seq_uniq unique (srv_id, seqno)
);
create index if not exists users_user_idx on users ("user");

-- users map to accounts, but not 1-to-1 due to possible merging
create sequence if not exists accounts_seq as int8 start 1;
create table if not exists accounts (
    srv_id int not null default 1,
    seqno int8 not null default nextval('accounts_seq'),
    version uuid unique,
    account uuid not null,
    -- the default user uuid for objects uploaded by a session for this account
    "user" uuid not null,
    name varchar(64),
    -- TODO: email needs to be unique, since it's used for login, but it is an
    --       archive table, so that presents some challenges.
    --       Maybe this is like the thread-id thing, where email should be the
    --       primary key.  Or maybe email invites should be a separate table
    --       and the presence of multiple invites to the same email address
    --       should all be resolved at the same time?
    email varchar(128),
    password varchar(128),
    submissiontime timestamptz not null,
    authortime timestamptz not null,
    archivetime jsonb,

    constraint accounts_seq_uniq unique (srv_id, seqno)
);
create index if not exists accounts_account_idx on accounts (account);

-- sessions is not an archive table; it is mutable
--   - replication is server-to-server only
--   - deletions are automatic per server, only replicate inserts and updates
--   - sessions are invalidated by updating srv_id,seqno and setting valid=0
create sequence if not exists sessions_seq as int8 start 1;
create table if not exists sessions (
    srv_id int not null default 1,
    seqno int8 not null default nextval('sessions_seq'),
    "session" uuid primary key,
    token bit(256) not null,
    account uuid null,
    expiry timestamptz not null,
    valid boolean not null default true,

    constraint sessions_seq_uniq unique (srv_id, seqno)
);

-- permissions ties users to projects
create type permission_kind as enum (
    -- members have general viewing capabilities
    -- (member is implied if any other permission is present)
    'member',
    -- admins can modify other members
    'admin',
    -- these have no special rights at the moment
    'loader',
    'daily',
    'editor'
);
create sequence if not exists perms_seq as int8 start 1;
create table if not exists permissions (
    srv_id int not null default 1,
    seqno int8 not null default nextval('perms_seq'),
    version uuid unique,
    "user" uuid not null,
    project uuid not null,
    kind permission_kind not null,
    enable boolean not null,
    -- who made this edit?
    author uuid not null,
    submissiontime timestamptz not null,
    authortime timestamptz not null,
    archivetime jsonb,

    constraint perms_seq_uniq unique (srv_id, seqno)
);
create index if not exists permissions_user_idx on permissions ("user");
create index if not exists permissions_project_idx on permissions (project);

-- entries is an archive table.  Really it contains two kinds of entries:
--   - original entries added to a report, from an upload or manual action
--   - modified or deleted entries of an existing report
--
-- the report uuid may correspond to an uploaded file that we keep somewhere.
create sequence if not exists entries_seq as int8 start 1;
create table if not exists entries (
    srv_id int not null default 1,
    seqno int8 not null default nextval('entries_seq'),
    report uuid not null,
    -- the entry in the report; not unique because edits also appear here
    entry uuid not null,
    -- the version of this entry; unique, but not linear
    version uuid unique,
    project uuid not null,
    "user" uuid not null,

    -- for original entries:
    --   - report shall be unique (at least until there is an edit)
    --   - clip_id is non-null (but is allowed to be empty)
    --   - content is non-null
    --   - reason is null (meaning "newly added report")
    --
    -- for edited entries:
    --   - report shall point to an existing report uuid
    --   - reason is non-null, a user-provided explanation for the edit
    --   - modifies is non-null, a list of version uuid's
    --   - archivetime is non-null, a pagination key
    --   - a null content and null clip_id is a deletion of the whole entry
    --   - null fields in a non-null content are deleted columns
    --   - non-null fields in content are overwritten
    --   - unspecified fields in content are unaffected
    --   - null clip_id is "no change"
    --   - non-null clip_id is a change to clip_id

    clip_id varchar(64),
    content jsonb not null,
    modifies jsonb,
    reason varchar,
    archivetime jsonb,

    constraint entries_seq_uniq unique (srv_id, seqno)
);

-- ideas:
create index if not exists entries_report_idx on entries (report);
create index if not exists entries_entry_idx on entries (entry);

-- topics is an archive table
create sequence if not exists topics_seq as int8 start 1;
create table if not exists topics (
    srv_id int not null default 1,
    seqno int8 not null default nextval('topics_seq'),
    version uuid unique,
    topic uuid not null,
    project uuid not null,
    "user" uuid not null,
    -- name is expected to be editable by uploading new versions of a topic
    name varchar(256) not null,
    -- submissiontime is when the server received this version of the topic
    submissiontime timestamptz not null,
    -- authortime is when the client says the entry was created
    authortime timestamptz not null,
    -- we can decide if edits to a topic are allowed to update links or not.
    links jsonb,
    archivetime jsonb,

    constraint topics_seq_uniq unique (srv_id, seqno)
);
create index if not exists topic_topic on topics (topic);

-- comments is an archive table.  Each comment is part of a topic.  A comment
-- may have a non-null parent, which means that comment is in response to some
-- other comment.  All comments in response to the same comment.
--
-- The reason not to have explicit thread objects is that it would be common
-- for multiple offline clients to each create their own thread in response to
-- the same comment, so many threads would need to be merged by the client
-- anyway.  Better to let the threading be implicit, although that implies some
-- intelligent thread-tree-building logic in the client.  This may be a nice
-- thing for a midend to figure out, or maybe the volume of comments in a
-- topic is small enough that doing it client side is just fine.
create sequence if not exists comments_seq as int8 start 1;
create table if not exists comments (
    srv_id int not null default 1,
    seqno int8 not null default nextval('comments_seq'),
    version uuid unique,
    comment uuid not null,
    topic uuid not null,
    project uuid not null,
    "user" uuid not null,
    -- null body means it was deleted
    body varchar,
    -- comments may have a parent comment, like hackernews or reddit
    parent uuid,
    -- comments are ordered by when they arrive on the server
    submissiontime timestamptz not null,
    -- comment edits are resolved by latest client-provided author time
    authortime timestamptz not null,
    -- the client's view when the comment was made
    archivetime jsonb,

    constraint comments_seq_uniq unique (srv_id, seqno)
);
create index if not exists comments_topic on comments (topic);
create index if not exists comments_comment on comments (comment);

-- add NOTIFY triggers
-- stream_send( kind [, timefields...] )
create or replace function stream_send() returns trigger as $$
DECLARE
    output jsonb = NULL;
    extra jsonb = NULL;
BEGIN
    output = to_jsonb(NEW) || jsonb_object_agg('type', TG_ARGV[0]);
    -- convert timefields to rfc3339 timestamps
    for i in 1..(TG_NARGS-1) loop
        output = output || jsonb_object_agg(
            TG_ARGV[i],
            to_char(
                (output->>TG_ARGV[i])::timestamptz,
                'YYYY-MM-DD"T"HH24:MI:SS.USZ'
            )
        );
    end loop;
    PERFORM pg_notify('stream', output::text);
    return null;
END;
$$ language plpgsql;

create or replace trigger projects_trigger after insert on projects
for each row execute procedure stream_send(
    'project', 'authortime', 'submissiontime'
);

create or replace trigger users_trigger after insert on users
for each row execute procedure stream_send(
    'user', 'authortime', 'submissiontime'
);

create or replace trigger permissions_trigger after insert on permissions
for each row execute procedure stream_send(
    'permission', 'authortime', 'submissiontime'
);

create or replace trigger comments_trigger after insert on comments
for each row execute procedure stream_send(
    'comment', 'authortime', 'submissiontime'
);

create or replace trigger entries_trigger after insert on entries
for each row execute procedure stream_send('entry');

create or replace trigger topics_trigger after insert on topics
for each row execute procedure stream_send(
    'topic', 'authortime', 'submissiontime'
);
