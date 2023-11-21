-- users is a crud table
create table if not exists users (
    user_id int not null primary key,
    user_name varchar(64) not null unique,
    email varchar(128) not null,
    password varchar(128) not null
);

-- projects is a crud table
create table if not exists projects (
    proj_id int not null primary key,
    proj_name varchar(64) not null unique
);

-- a sequence shared by all of the tables (is this wise?)
create sequence if not exists seqno as int8 start 1;

-- reports is an archive table.  Really it contains two kinds of entries:
--   - original entries being added to a report, from an upload or manual action
--   - modified or deleted entries of an existing report
--
-- the report_uuid may correspond to an uploaded file that we keep somewhere.
create table if not exists entries (
    srv_id int not null default 1,
    seqno int8 not null default nextval('seqno'),
    report_uuid uuid not null,
    -- the entry in the report; not unique because edits also appear here
    entry_uuid uuid not null,
    -- the version of this entry; unique, but not linear
    version_uuid uuid primary key,
    proj_id int not null,
    user_id int not null,
    clip_id varchar(64),

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

    content jsonb not null,
    modifies jsonb,
    reason varchar,
    archivetime jsonb,

    constraint entries_seq_uniq unique (srv_id, seqno)
);

-- ideas:
create index if not exists entries_report_idx on entries (report_uuid);
create index if not exists entries_entry_idx on entries (entry_uuid);

-- threads is an archive table
create table if not exists threads (
    srv_id int not null default 1,
    seqno int8 not null default nextval('seqno'),
    thread_uuid uuid primary key,
    proj_id int not null,
    user_id int not null,
    -- TODO: creation time and such stuff
    -- TODO: user-friendly referenceable field... thread name? subject?
    --       (that feels more crud-y than archive-y...)
    -- the moment the thread was started
    archivetime jsonb not null,

    constraint threads_seq_uniq unique (srv_id, seqno)
);

-- thread_links is an archive table; it is a many-to-many relationship between
-- threads and objects they are discussing; many threads can target one object,
-- and each thread may target multiple objects
create table if not exists thread_links (
    srv_id int not null default 1,
    seqno int8 not null default nextval('seqno'),
    thread_uuid uuid not null,
    -- one of the following must be non-null
    report_uuid uuid,  -- an entire report
    entry_uuid uuid,   -- an entry within a report
    version_uuid uuid, -- a particular edit
    comment_uuid uuid, -- a thread under a comment

    constraint thread_links_seq_uniq unique (srv_id, seqno)
);

-- comments is an archive table
create table if not exists comments (
    srv_id int not null default 1,
    seqno int8 not null default nextval('seqno'),
    comment_uuid uuid not null,
    thread_uuid uuid not null,
    proj_id int not null,
    user_id int not null,
    -- comments are ordered by when they arrive on the server
    submissiontime timestamp not null,
    -- comment edits are resolved by latest client-provided author time
    authortime timestamp not null,
    -- the client's view when the comment was made
    archivetime jsonb not null,

    constraint comments_seq_uniq unique (srv_id, seqno)
);

-- ideas:
create index if not exists comments_thread_idx on comments (thread_uuid);
create index if not exists comments_comment_idx on comments (comment_uuid);
