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

-- topics is an archive table; each topic has a root thread
create sequence if not exists topics_seq as int8 start 1;
create table if not exists topics (
    srv_id int not null default 1,
    seqno int8 not null default nextval('topics_seq'),
    topic_uuid uuid,
    proj_id int not null,
    user_id int not null,
    -- TODO: creation time and such stuff
    -- TODO: user-friendly referenceable field... thread name? subject?
    --       (that feels more crud-y than archive-y...)

    -- links is all the objects this topic links to.
    -- TODO: should there be a separate table just for streaming the reverse
    -- lookup of "what topics are about XYZ"?
    -- streaming is a lot more natural in this direction but it seems to be
    -- the opposite of what an RDB would normally do.
    links jsonb not null,
    archivetime jsonb,

    constraint topics_seq_uniq unique (srv_id, seqno)
);

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
    comment_uuid uuid not null,
    topic_uuid uuid not null,
    proj_id int not null,
    user_id int not null,
    -- null body means it was deleted
    body varchar,
    -- comments may have a parent comment, like hackernews or reddit
    parent_uuid uuid,
    -- comments are ordered by when they arrive on the server
    submissiontime timestamp not null,
    -- comment edits are resolved by latest client-provided author time
    authortime timestamp not null,
    -- the client's view when the comment was made
    archivetime jsonb,

    constraint comments_seq_uniq unique (srv_id, seqno)
);
create index if not exists comments_topic_uuid on comments (topic_uuid);
create index if not exists comments_comment_uuid on comments (comment_uuid);
