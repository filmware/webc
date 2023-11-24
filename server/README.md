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
    "proj_id": 7,
    "entries": {
        "since": [[0, 14], [1, 99]],
        # ONE OF:
        "match": "*"
        "match": "report_uuid", "value": "a-report-uuid"
        "match": "user_id", "value": 314
    },
    "topics": {
        "since": [[0, 14], [1, 99]],
        # ONE OF:
        "match": "*"
        "match": "user_id", "value": 314
    },
    "comments": {
        "since": [[0, 14], [1, 99]],
        # ONE OF:
        "match": "*",
        "match": "topic_uuid", "value": "a-topic-uuid"
        "match": "user_id", "value": 314
    }
}
```

- `type:subscribe` indicates this is a subscribe message
- `mux_id` is a multiplexer id, so multiple streams can share a single
   websocket connection.  It will be attached to all responses for this stream.
- `project` indicates which project should be queried
- `since` is a list of the highest client-known (`server_id`, `seqno`) values
  for this subscription
- `entries` (optional) is a spec for which entries should be streamed.
- `topics` (optional) is a spec for which topics should be streamed.
- `comments` (optional) is a spec for which comments should be streamed.

#### `type:close`

A client asks to stop streaming stuff.

Example:

```
{
    "type": "close",
    "mux_id": 99
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

#### `type:topic`

A server tells a client about a topic.

Example:

```
{
    "type": "topic",
    "mux_id": 99,
    "srv_id": 1,
    "seqno", 1072,
    "proj_id": 7,
    "topic_uuid": 1,
    "user_id": 314,
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
    "proj_id": 7,
    "user_uuid": 314,
    "comment_uuid": "the-comment-uuid",
    "thread_uuid": "the-thread-uuid",
    "submissiontime": "2022-01-01T21:19:00Z",
    "authortime": "2022-01-01T17:05:00Z"
    "archivetime": [[0,99], [1,199]]
}
```

Note that multiple comments with the same `comment_uuid` indicates updates to
a comment.  The comment with the latest `authortime` should be used.

#### `type:entry`

A server tells a client about an entry.

Example:

```
{
    "type": "entry",
    "mux_id": 99,
    "srv_id": 0,
    "seqno", 1092,
    "proj_id": 7,
    "report_uuid": "the-report-uuid",
    "entry_uuid": "the-entry-uuid",
    "version_uuid": "the-unique-version-uuid",
    "archivetime": [[0,99], [1,199]]
    "user_id": 314,
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
