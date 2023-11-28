if(typeof Websocket === "undefined"){
    // assume we're in node; bring in a websocket package
    var WebSocket = require('ws');
}

class Advancer {
    constructor(advance_up, advance_dn) {
        this.error = null;
        this.canceled = false;
        this.done_up = false;
        this.done_dn = false;

        this.advance_up = advance_up;
        this.advance_dn = advance_dn;
    }

    schedule(error) {
        if (error && !this.error) {
            this.error = error
        }
        if (!this.done_dn && !this.scheduled) {
            setTimeout(() => { this.advance_state(); });
            this.scheduled = true;
        }
    }

    advance_state() {
        this.scheduled = false;
        if (this.done_dn) {
            // late wakeups are ignored
            return;
        }
        if (!this.done_up && !this.error) {
            try {
                this.advance_up();
            } catch(error) {
                this.error = error;
            }
        }

        if (this.done_up || this.error) {
            this.advance_dn(this.error);
        }
    }
}

class FWClient {
    constructor(url) {
        this.advancer = new Advancer(
            () => { this.advance_up(); },
            (e) => { this.advance_dn(e); },
        );

        // state
        this.unsent = [];
        this.recvd = [];
        this.subs = new Map();
        this.reqs = new Map();
        this.socket_connected = false;
        this.socket_close_started = false;
        this.socket_close_done = false;
        this.mux_id = 0;

        this.socket = new WebSocket(url);
        this.socket.onopen = (e) => {
            this.socket_connected = true;
            this.advancer.schedule(null);
        };
        this.socket.onmessage = (e) => {
            let msg = JSON.parse(e.data);
            this.recvd.push(msg);
            this.advancer.schedule(null);
        };
        this.socket.onclose = (e) => {
            this.socket_close_done = true;
            let error = null;
            if (!this.want_close) {
                error = "closed early";
            }
            this.advancer.schedule(error)
        };
        this.socket.onerror = (error) => {
            // discard the error if we closed the websocket ourselves
            let kept_error = null;
            if (!this.want_close) {
                kept_error = error;
            }
            this.advancer.schedule(kept_error);
        };

        // callback API //
        this.onclose = null;
    }

    get_mux_id() {
        this.mux_id += 1;
        return this.mux_id;
    }

    advance_up() {
        // wait for a connection
        if (!this.socket_connected) {
            return;
        }

        // hand out recvd messages
        let msg;
        while (msg = this.recvd.shift()) {
            // find the matching subscription
            let sub = this.subs[msg.mux_id]
            if (sub !== undefined) {
                // let that subscription decide what to do
                sub.put(msg);
                continue;
            }
            let req = this.reqs[msg.mux_id]
            if(req !== undefined){
                req.finish(msg);
                this.reqs.delete(this.mux_id);
                continue;
            }
            // must be a streaming mux_id that we canceled earlier
            log.console(`unexpected mux_id: ${msg.mux_id}`);
            return;
        }

        // ship any unsent messages
        while (msg = this.unsent.shift()) {
            this.socket.send(JSON.stringify(msg));
        }
    }

    advance_dn(error) {
        // make sure our socket is closed
        if (!this.socket_close_done) {
            if (!this.socket_close_started) {
                this.socket.close();
            }
            return;
        }

        // we're done now
        this.advancer.done_dn = true;

        if(this.onclose){
            setTimeout(() => {this.onclose(error)});
        }
    }

    // external API //
    close() {
        this.advancer.done_up = true;
        this.advancer.schedule(null);
    }

    /* TODO: have a real api here; as-written, the user composes the whole
             message except mux_id and type */
    subscribe(spec){
        // can these be const?  I don't know how that works.
        let mux_id = this.get_mux_id();
        let msg = {
            "type": "subscribe",
            "mux_id": mux_id,
            ...spec,
        };
        let sub = new FWSubscription(this, mux_id);
        this.subs[mux_id] = sub;
        this.unsent.push(msg);
        this.advancer.schedule(null);
        return sub;
    }

    upload(objects){
        let mux_id = this.get_mux_id();
        let msg = {
            "type": "upload",
            "mux_id": mux_id,
            "objects": objects
        };
        let req = new FWRequest(this, mux_id);
        this.reqs[mux_id] = req;
        this.unsent.push(msg);
        this.advancer.schedule(null);
        return req;
    }
}

class FWSubscription {
    constructor(client, mux_id) {
        this.client = client;
        this.mux_id = mux_id;

        // state
        this.presync = [];
        this.synced = false;
        this.closed = false;

        // callback API //

        /* onpresyncmsg returns messages prior to the synchronization message.
           If unset, onsync will return all messages in a single callback.
           It is assumed onpresyncmsg will be unset unless the consumer is
           collecting a very large amount of data and wants to process it as
           it arrives, rather than buffer everything in memory. */
        this.onpresyncmsg = null;
        /* onsync returns the whole initial payload, unless onpresyncmsg was
           set, in which case it returns an empty list of messages */
        this.onsync = null;
        // onmsg returns individual messages after the sync msg arrives
        this.onmsg = null;
    }

    healthy_callback(func, ...args) {
        if(!func) return;
        setTimeout(() => {
            if(!this.closed && !this.client.want_close) func(...args);
        });
    }

    // a message arrives from the client object
    put(msg) {
        if(this.synced){
            // after sync, always call onmsg
            this.healthy_callback(this.onmsg, msg);
            return;
        }
        if(this.onpresyncmsg){
            // before sync, client can request individual messages
            this.healthy_callback(this.onpresyncmsg, msg);
            return;
        }
        if(msg.type == "sync") {
            // this is the sync; deliver the buffered presync messages
            this.synced = true;
            let payload = this.presync;
            this.presync = null;
            this.healthy_callback(this.onsync, payload);
            return;
        }
        // buffer presync message and keep waiting for sync
        this.presync.push(msg);
    }

    // external API //
    close() {
        this.closed = true;
        this.client.unsent.push({"type": "close", "mux_id": this.mux_id});
        this.client.subs.delete(this.mux_id);
        this.client.advancer.schedule(null);
    }
}

class FWRequest {
    constructor(client, mux_id) {
        this.client = client;
        this.mux_id = mux_id;

        this.finished = false;

        // callback API //

        this.onfinish = null;
    }

    finish(msg){
        this.finished = true;
        if(!this.onfinish) return;
        setTimeout(() => {
            if(!this.client.want_close) this.onfinish();
        });
    }

    // no external API //
}

class Demo {
    constructor(){
        this.client = new FWClient("ws://localhost:8080/ws");
        this.client.onclose = (error) => {
            if(error === null){
                error = "client closed unexpectedly";
            }
            this.advancer.schedule(error);
        }

        this.advancer = new Advancer(
            () => { this.advance_up(); },
            (e) => { this.advance_dn(e); },
        );


        // collect any valid topic_uuid and report_uuid
        this.topic_uuid = null;
        this.report_uuid = null;

        // state flags
        this.finding_topic = false;
        this.finding_report = false;
        this.upload_started = false;
        this.upload_done = false;
        this.stream_started = false;
    }

    advance_up(){
        // find a valid topic_uuid
        if(!this.finding_topic){
            this.finding_topic = true;
            this.sub = this.client.subscribe(
                {"proj_id": 1, "topics": {"match": "*"}}
            );
            this.sub.onpresyncmsg = (msg) => {
                this.topic_uuid = msg.topic_uuid;
                console.log(`found topic_uuid=${this.topic_uuid}`);
                this.sub.close();
                this.advancer.schedule(null);
            }
        }
        if(!this.topic_uuid) return;

        // find a valid report_uuid
        if(!this.finding_report){
            this.finding_report = true;
            this.sub = this.client.subscribe(
                {"proj_id": 1, "entries": {"match": "*"}}
            );
            this.sub.onpresyncmsg = (msg) => {
                this.report_uuid = msg.report_uuid;
                console.log(`found report_uuid=${this.report_uuid}`);
                this.sub.close();
                this.advancer.schedule(null);
            }
        }
        if(!this.report_uuid) return;

        // upload some example data
        if(!this.upload_started){
            console.log("upload starting");
            this.upload_started = true;
            this.req = this.client.upload([
                {
                    "type": "newcomment",
                    "proj_id": 1,
                    "version_uuid": crypto.randomUUID(),
                    "comment_uuid": crypto.randomUUID(),
                    "topic_uuid": this.topic_uuid,
                    "parent_uuid": null,
                    "body": "an uploaded comment",
                    "authortime": "2022-01-01T17:05:00Z",
                    "archivetime": null,
                },
                {
                    "type": "newtopic",
                    "proj_id": 1,
                    "topic_uuid": crypto.randomUUID(),
                    "archivetime": null,
                    "links": ["report", this.report_uuid],
                },
                {
                    "type": "newentry",
                    "proj_id": 1,
                    "report_uuid": this.report_uuid,
                    "entry_uuid": crypto.randomUUID(),
                    "version_uuid": crypto.randomUUID(),
                    "archivetime": null,
                    "clip_id": "11a",
                    "content": {"col-a": "val-a", "col-b": "val-b"},
                    "modifies": null,
                    "reason": null,
                },
            ]);
            this.req.onfinish = () => {
                this.upload_done = true;
                this.advancer.schedule(null);
            };
        }
        if(!this.upload_done) return;

        if(!this.stream_started){
            this.stream_started = true;
            // now subscribe to comments in the topic we found
            this.sub = this.client.subscribe({
                "proj_id": 1,
                "comments": {"match": "topic_uuid", "value": this.topic_uuid},
            });

            this.sub.onsync = (payload) => {
                console.log("--- sync!");
                for(let i = 0; i < payload.length; i++){
                    console.log(`payload[${i}]:`, payload[i]);
                }
                console.log("---");
            };

            this.sub.onmsg = (msg) => {
                console.log(msg);
            };
        }
    }

    advance_dn(error){
        console.log("demo exited with error:", error);
        this.advancer.done_dn = true;
    }
}

demo = new Demo();
demo.advancer.schedule(null);
