# Filmware Server Protoype

## Goals

- **Good Interfaces**: seek nice boundaries between components right away
- **Good Data Model**: seek a good data model right away
- **Disposable Implementation**: don't waste time on anything else
- **Speed**: get a prototype out the door as fast as possible

## Installing Dependencies

**System dependencies**:

- postgres
- python3

**Python dependencies**:

- setup a venv if you'd like
- pip install -r requirements.txt
- devcluster (optional)

## Running the server

- run `pg.py`, then `psql < db.sql`,  then `python app.py`
- or `devcluster -c devcluster.yaml`

## REST API

(tbd)

## Websocket API (`/ws`)

Protocol Summary:

- The client shall begin by sending a `type:subscribe` message, with a
  client-chosen `mux_id` that the server shall attach to all of its responses.

- The server shall send an initial payload of matching messages currently in
  the database.

- The server shall send a `type:sync` message to indicate all historical
  results have been sent.

- The server shall continue sending messages as the arrive in the database.

- The client may send a `type:close` message at any time to close the
  subscription.  The server shall stop sending responses for that subscription
  promptly, but the client must handle additional responses arriving for
  that subscription, as some responses may already be in-flight.

### Client Messages

#### `type:subscribe`

A client asks to start streaming stuff.

Example:

```
{
    "type": "subscribe",
    "mux_id": 99,
    "projects": {
        "since": [[0, 14], [1, 99]],
        # ONE OF
        "match": "*",
        "match": "project", "value": "a-proj-uuid"
    },
    # TODO: figure out how users will be streamed; this is not right.
    "users": {
        "since": [[0, 14], [1, 99]],
        # ONE OF
        "match": "project", "value": "a-proj-uuid"
        "match": "user", "value": "a-user-uuid"
    },
    "permissions": {
        "since": [[0, 14], [1, 99]],
        # ONE OF
        "match": "project", "value": "a-proj-uuid"
        "match": "user", "value": "a-user-uuid"
    },
    "entries": {
        "since": [[0, 14], [1, 99]],
        # ONE OF:
        "match": "project", "value": "the-proj-uuid"
        "match": "report", "value": "a-report-uuid"
        "match": "user", "value": "a-user-uuid"
    },
    "topics": {
        "since": [[0, 14], [1, 99]],
        # ONE OF:
        "match": "project", "value": "a-proj-uuid"
        "match": "user", "value": "a-user-uuid"
    },
    "comments": {
        "since": [[0, 14], [1, 99]],
        # ONE OF:
        "match": "project", "value": "a-proj-uuid"
        "match": "topic", "value": "a-topic-uuid"
        "match": "user", "value": "a-user-uuid"
    }
}
```

- `type:subscribe` indicates this is a subscribe message
- `mux_id` is a multiplexer id, so multiple streams can share a single
   websocket connection.  It will be attached to all responses for this stream.
- remaining fields are optional specs to describe what to stream.

#### `type:close`

A client asks to stop streaming stuff.

Example:

```
{
    "type": "close",
    "mux_id": 99
}
```

#### `type:fetch`

A client asks to start streaming stuff, and to automatically stop when the
sync message is sent.  No `type:close` message is necessary.

```
{
    "type": "fetch",
    "mux_id": 99,
    # the rest is identical to type:subscribe
}
```

#### `type:upload`

A client uploads new objects to the server.

The `"objects"` array may contain multiple new objects of any type.  The client
must pick unique uuids for the uploaded objects.  Duplicate uploads, as defined
by matching uuids, are discarded silently (at-least-once upload semantics).

Example:

```
{
    "type": "upload",
    "mux_id": 99,
    "objects": [...]
}
```

Note that server-defined fields, like `srv_id`, `seqno`, or
`submission_time`, are not part of the uploaded objects.  Neither is
`user_uuid`, which is derived from the identity of the uploader, nor `mux_id`,
which is part of the transport layer, not the object itself.

Example `type:newcomment` object:

```
{
    "type": "newcomment",
    "project": "the-proj-uuid",
    "version": "client-chosen-uuid",
    "comment": "the-comment-uuid",
    "topic": "the-topic-uuid",
    "parent": "the-parent-uuid",
    "body": "the text of the comment",
    "authortime": "2022-01-01T17:05:00Z",
    "archivetime": [[0,99], [1,199]]
}
```

Example `type:newentry` object (the significance of the fields is defined in
the `type:entry` section, below).

```
{
    "type": "newentry",
    "project": "the-proj-uuid",
    "report": "the-report-uuid",
    "entry": "the-entry-uuid",
    "version": "client-chosen-uuid",
    "archivetime": [[0,99], [1,199]],
    "clip_id": ...,
    "content": ...,
    "modifies": ...,
    "reason": ...
}
```

Example `type:newtopic` object:

```
{
    "type": "newtopic",
    "project": "the-proj-uuid",
    "version": "client-chosen-uuid",
    "topic": "the-topic-uuid",
    "authortime": "2022-01-01T17:05:00Z",
    "archivetime": [[0,99], [1,199]],
    ... other stuff tbd ...
    "links": [
        ["report", "a-report-uuid"],
        ["entry", "an-entry-uuid"],
        ["entry_version", "a-version-uuid"]
        ["clip", "a-clip-id"]
        ["take", "a-scene-and-take"]
    ]
}
```

### Server Messages

#### `type:sync`

A server tells a client a particular stream has finished its initial payload.

Example:

```
{
    "type": "sync",
    "mux_id": 99
}
```

#### `type:closed`

A server tells a client that a close is completed.

Example:

```
{
    "type": "closed",
    "mux_id": 99
}
```

#### `type:project`

A server tells a client about a project.

Example:

```
{
    "type": "project",
    "mux_id": 99,
    "srv_id": 1,
    "seqno": 9194,
    "version": "the-version-uuid",
    "project": "the-proj-uuid",
    "name": "Avengers: Overkill",
    "user": "the-user-uuid",
    "submissiontime": "the-submission-time",
    "authortime": "the-author-time",
    "archivetime": [...]
}
```

#### `type:user`

A server tells a client about a user.

Note that email and password are privileged fields and not exported normally.

Example:

```
{
    "type": "user",
    "mux_id": 99,
    "srv_id": 1,
    "seqno": 9194,
    "version": "the-version-uuid",
    "user": "the-user-uuid",
    "name": "joe.blow",
    "submissiontime": "the-submission-time",
    "authortime": "the-author-time",
    "archivetime": [...]
}
```

#### `type:permission`

A server tells a client about a permission.

Example:

```
{
    "type": "permission",
    "mux_id": 99,
    "srv_id": 1,
    "seqno": 9194,
    "version": "the-version-uuid",
    "user": "the-user-uuid",
    "project": "the-proj-uuid",
    "kind": "member|admin|loader|daily|editor",
    "enable": true,
    "author": "the-authors-user-uuid",
    "submissiontime": "the-submission-time",
    "authortime": "the-author-time",
    "archivetime": [...]
}
```

#### `type:topic`

A server tells a client about a topic.

Example:

```
{
    "type": "topic",
    "mux_id": 99,
    "srv_id": 1,
    "seqno", 1072,
    "project": "the-proj-uuid",
    "version": "the-version-uuid",
    "topic": "the-topic-uuid",
    "user": "the-user-uuid",
    "submissiontime": "the-submission-time",
    "authortime": "the-author-time",
    "archivetime": [[0,99], [1,199]],
    ... other stuff tbd ...
    "links": [
        ["report", "a-report-uuid"],
        ["entry", "an-entry-uuid"],
        ["version", "a-version-uuid"]
    ]
}
```

Note that multiple links are allowed, and each has a different meaning:

- `report`: a topic about an entire report
- `entry`: a topic about a row of a report
- `version`: a topic about a particular edit

#### `type:comment`

A server tells the client about a comment.

Example:

```
{
    "type": "comment",
    "mux_id": 99,
    "srv_id": 1,
    "seqno", 1055,
    "project": "the-proj-uuid",
    "user": "the-user-uuid",
    "version": "the-version-uuid",
    "comment": "the-comment-uuid",
    "parent": "the-parent-uuid",
    "body": "the text of the comment",
    "topic": "the-topic-uuid",
    "submissiontime": "2022-01-01T21:19:00Z",
    "authortime": "2022-01-01T17:05:00Z"
    "archivetime": [[0,99], [1,199]]
}
```

Note that multiple comments with the same `comment_uuid` indicates updates to
a comment.  The comment with the latest `authortime` should be used.

A comment with a NULL body indicates a deletion of a comment.

#### `type:entry`

A server tells a client about an entry.

Example:

```
{
    "type": "entry",
    "mux_id": 99,
    "srv_id": 0,
    "seqno", 1092,
    "project": "the-proj-uuid",
    "report": "the-report-uuid",
    "entry": "the-entry-uuid",
    "version": "the-unique-version-uuid",
    "archivetime": [[0,99], [1,199]]
    "user": "the-user-uuid",
    "clip_id": ...,
    "content": ...,
    "modifies": ...,
    "reason": ...,
}
```

The behavior of `clip_id`, `content`, `modifies`, and `reason` vary depending
on whether this `version_uuid` represents an original entry or an update to
an existing entry.

For an original entry:
- modifies will be `null`
- reason will be `null`
- clip id will be a string
- content will be a flat dict containing string fields and string keys

Original entry example:
```
{
    "clip_id": "11b",
    "content": {"field1": "val1", "field2": "val2"},
    "modifies": null,
    "reason": null,
}
```

For an edit to an existing entry:
- `entry_uuid` must match an existing entry
- `version_uuid` will be a new unique value
- `modifies` will be a list of previous `version_uuid` values being updated.
  It may be longer than 1 if there were conflicting edits that this edit is
  resolving.
- reason must not be `null`; it will contain a user-provided reason for the
  edit
- a non-`null` `clip_id` represents an update to the `clip_id`
- `clip_id` may be `null` to indicate "no change"
- content may be `null` to indicate changes to the fields.  If so,
  `"field": null` deletes an existing field and `"field": "newval"` either
  updates an existing field's value or adds a new one.
- if both `clip_id` and `content` are null, that represents a deletion of the
  row.

#### `type:uploaded`

A server responds to an upload request.

The `type:uploaded` response indicates that all uploads were successful, and
guarantees that all servers will _eventually_ know about the uploaded object.

After the `type:uploaded` response it is still possible for the client to
stream objects from another server only to find out that the uploaded object is
not yet present; this is allowed because the `type:uploaded` repsonse does not
guarantee that replication has completed between all servers.

Example:

```
{
    "type": "uploaded",
    "mux_id": 99
}
```
