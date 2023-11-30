-- projects are one per production
create sequence if not exists projects_seq as int8 start 1;
create table if not exists projects (
    srv_id int not null default 1,
    seqno int8 not null default nextval('projects_seq'),
    version_uuid uuid primary key,
    proj_uuid uuid not null,
    name varchar(64) not null unique,
    user_uuid uuid not null,
    submissiontime timestamptz not null,
    authortime timestamptz not null,
    archivetime jsonb
);
create index if not exists projects_proj_idx on projects (proj_uuid);

-- users can participate in multiple projects
create sequence if not exists users_seq as int8 start 1;
create table if not exists users (
    srv_id int not null default 1,
    seqno int8 not null default nextval('users_seq'),
    version_uuid uuid primary key,
    user_uuid uuid not null,
    name varchar(64) not null unique,
    email varchar(128) not null,
    password varchar(128) not null,
    submissiontime timestamptz not null,
    authortime timestamptz not null,
    archivetime jsonb
);
create index if not exists users_user_idx on users (user_uuid);

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
    version_uuid uuid primary key,
    user_uuid uuid not null,
    proj_uuid uuid not null,
    kind permission_kind not null,
    enable boolean not null,
    -- who made this edit?
    author_uuid uuid not null,
    submissiontime timestamptz not null,
    authortime timestamptz not null,
    archivetime jsonb
);
create index if not exists permissions_user_idx on permissions (user_uuid);
create index if not exists permissions_proj_idx on permissions (proj_uuid);

-- reports is an archive table.  Really it contains two kinds of entries:
--   - original entries added to a report, from an upload or manual action
--   - modified or deleted entries of an existing report
--
-- the report_uuid may correspond to an uploaded file that we keep somewhere.
create sequence if not exists entries_seq as int8 start 1;
create table if not exists entries (
    srv_id int not null default 1,
    seqno int8 not null default nextval('entries_seq'),
    report_uuid uuid not null,
    -- the entry in the report; not unique because edits also appear here
    entry_uuid uuid not null,
    -- the version of this entry; unique, but not linear
    version_uuid uuid primary key,
    proj_uuid uuid not null,
    user_uuid uuid not null,

    -- for original entries:
    --   - report_uuid shall be unique (at least until there is an edit)
    --   - clip_id is non-null (but is allowed to be empty)
    --   - content is non-null
    --   - reason is null (meaning "newly added report")
    --
    -- for edited entries:
    --   - report_uuid shall point to an existing report_uuid
    --   - reason is non-null, a user-provided explanation for the edit
    --   - modifies is non-null, a list of version_uuid's
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
create index if not exists entries_report_idx on entries (report_uuid);
create index if not exists entries_entry_idx on entries (entry_uuid);

-- topics is an archive table
create sequence if not exists topics_seq as int8 start 1;
create table if not exists topics (
    srv_id int not null default 1,
    seqno int8 not null default nextval('topics_seq'),
    version_uuid uuid primary key,
    topic_uuid uuid not null,
    proj_uuid uuid not null,
    user_uuid uuid not null,
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
create index if not exists topic_topic_uuid on topics (topic_uuid);

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
    version_uuid uuid primary key,
    comment_uuid uuid not null,
    topic_uuid uuid not null,
    proj_uuid uuid not null,
    user_uuid uuid not null,
    -- null body means it was deleted
    body varchar,
    -- comments may have a parent comment, like hackernews or reddit
    parent_uuid uuid,
    -- comments are ordered by when they arrive on the server
    submissiontime timestamptz not null,
    -- comment edits are resolved by latest client-provided author time
    authortime timestamptz not null,
    -- the client's view when the comment was made
    archivetime jsonb,

    constraint comments_seq_uniq unique (srv_id, seqno)
);
create index if not exists comments_topic_uuid on comments (topic_uuid);
create index if not exists comments_comment_uuid on comments (comment_uuid);

-- add NOTIFY triggers
create or replace function stream_send() returns trigger as $$
DECLARE
    output jsonb = NULL;
    extra jsonb = NULL;
BEGIN
    output = to_jsonb(NEW) || jsonb_object_agg('type', TG_ARGV[0]);
    PERFORM pg_notify('stream', output::text);
    return null;
END;
$$ language plpgsql;

create or replace trigger projects_trigger after insert on projects
for each row execute procedure stream_send('project');

create or replace trigger users_trigger after insert on users
for each row execute procedure stream_send('user');

create or replace trigger permissions_trigger after insert on permissions
for each row execute procedure stream_send('permission');

create or replace trigger comments_trigger after insert on comments
for each row execute procedure stream_send('comment');

create or replace trigger entries_trigger after insert on entries
for each row execute procedure stream_send('entry');

create or replace trigger topics_trigger after insert on topics
for each row execute procedure stream_send('topic');
