WebSocket = (typeof WebSocket === "undefined") ? require('ws') : WebSocket;

type advanceUpFn = () => void;
type advanceDnFn = (error: any) => void;

interface Advanceable {
    advanceUp: advanceUpFn;
    advanceDn: advanceDnFn;
};

class Advancer {
    error: any = null;
    doneUp: boolean = false;
    doneDn: boolean = false;
    scheduled : boolean = false;
    obj: Advanceable;

    constructor(obj: Advanceable) {
        this.obj = obj;
    };

    schedule(error: any) {
        if (error && !this.error) {
            this.error = error
        }
        if (!this.doneDn && !this.scheduled) {
            setTimeout(() => { this.advanceState(); });
            this.scheduled = true;
        }
    }

    advanceState(): void {
        this.scheduled = false;
        if (this.doneDn) {
            // late wakeups are ignored
            return;
        }
        if (!this.doneUp && !this.error) {
            try {
                this.obj.advanceUp();
            } catch(error) {
                this.error = error;
            }
        }

        if (this.doneUp || this.error) {
            this.obj.advanceDn(this.error);
        }
    }
};

class FWClient {
    advancer: Advancer;
    socket: WebSocket;

    unsent: any[] = [];
    recvd: any[] = [];
    muxId: number = 0;
    subs: Map<number, FWSubscription> = new Map<number, FWSubscription>;
    reqs: Map<number, FWRequest> = new Map<number, FWRequest>;

    socketConnected: boolean = false;
    socketCloseStarted: boolean = false;
    socketCloseDone: boolean = false;
    wantClose: boolean

    // callback API //
    onClose?: {(error: any): void} = null;

    constructor(url: string) {
        this.advancer = new Advancer(this);

        this.socket = new WebSocket(url);

        this.socket.onopen = (e: any): void => {
            this.socketConnected = true;
            this.advancer.schedule(null);
        };
        this.socket.onmessage = (e: any): void => {
            let msg = JSON.parse(e.data);
            this.recvd.push(msg);
            this.advancer.schedule(null);
        };
        this.socket.onclose = (e: any): void => {
            this.socketCloseDone = true;
            let error = null;
            if (!this.wantClose) {
                error = "closed early";
            }
            this.advancer.schedule(error)
        };
        this.socket.onerror = (error: any): void => {
            // discard the error if we closed the websocket ourselves
            let kept_error = null;
            if (!this.wantClose) {
                kept_error = error;
            }
            this.advancer.schedule(kept_error);
        };
    }

    GetMuxID(): number {
        this.muxId += 1;
        return this.muxId;
    }

    advanceUp(): void {
        // wait for a connection
        if (!this.socketConnected) {
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
                this.reqs.delete(msg.mux_id);
                continue;
            }
            // must be a streaming muxId that we canceled earlier
            console.log(`unexpected muxId: ${msg.mux_id}`);
            return;
        }

        // ship any unsent messages
        while (msg = this.unsent.shift()) {
            this.socket.send(JSON.stringify(msg));
        }
    }

    advanceDn(error: any): void {
        // make sure our socket is closed
        if (!this.socketCloseDone) {
            if (!this.socketCloseStarted) {
                this.socket.close();
            }
            return;
        }

        // we're done now
        this.advancer.doneDn = true;

        if(this.onClose){
            setTimeout(() => {this.onClose(error)});
        }
    }

    // external API //
    close() {
        this.wantClose = true;
        this.advancer.doneUp = true;
        this.advancer.schedule(null);
    }

    /* TODO: have a real api here; as-written, the user composes the whole
             message except mux_id and type */
    subscribe(spec){
        // can these be const?  I don't know how that works.
        let muxId = this.GetMuxID();
        let msg = {
            "type": "subscribe",
            "mux_id": muxId,
            ...spec,
        };
        let sub = new FWSubscription(this, muxId);
        this.subs[muxId] = sub;
        this.unsent.push(msg);
        this.advancer.schedule(null);
        return sub;
    }

    fetch(spec){
        let muxId = this.GetMuxID();
        let msg = {
            "type": "fetch",
            "mux_id": muxId,
            ...spec,
        };
        let sub = new FWSubscription(this, muxId);
        this.subs[muxId] = sub;
        this.unsent.push(msg);
        this.advancer.schedule(null);
        return new FWFetch(sub);
    }

    upload(objects){
        let muxId = this.GetMuxID();
        let msg = {
            "type": "upload",
            "mux_id": muxId,
            "objects": objects
        };
        let req = new FWRequest(this, muxId);
        this.reqs[muxId] = req;
        this.unsent.push(msg);
        this.advancer.schedule(null);
        return req;
    }
}

class FWSubscription {
    client: FWClient;
    muxId: number;

    presync: any[] = [];

    synced: boolean = false;
    closed: boolean = false;

    // callback API //
    /* onPreSyncMsg returns messages prior to the synchronization message.
       If unset, onSync will return all messages in a single callback.  It is
       assumed onPreSyncMsg will be unset unless the consumer is collecting a
       very large amount of data and wants to process it as it arrives, rather
       than buffer everything in memory. */
    onPreSyncMsg?: {(msg: any): void} = null;
    /* onSync returns the whole initial payload, unless onPreSyncMsg was
       set, in which case it returns an empty list of messages. */
    onSync?: {(payload: any[]): void} = null;
    // onMsg returns individual messages which arrive after the sync message.
    onMsg?: {(msg: any): void} = null;

    constructor(client, muxId) {
        this.client = client;
        this.muxId = muxId;
    }

    healthyCallback(func, ...args: any[]): void {
        if(!func) return;
        setTimeout(() => {
            if(!this.closed && !this.client.wantClose) func(...args);
        });
    }

    // a message arrives from the client object
    put(msg): void {
        if(this.synced){
            // after sync, always call onMsg
            this.healthyCallback(this.onMsg, msg);
            return;
        }
        if(msg.type == "sync") {
            // this is the sync; deliver the buffered presync messages
            this.synced = true;
            let payload = this.presync;
            this.presync = null;
            this.healthyCallback(this.onSync, payload);
            return;
        }
        if(this.onPreSyncMsg){
            // before sync, client can request individual messages
            this.healthyCallback(this.onPreSyncMsg, msg);
            return;
        }
        // buffer presync message and keep waiting for sync
        this.presync.push(msg);
    }

    // external API //
    close(): void {
        this.closed = true;
        this.client.unsent.push({"type": "close", "mux_id": this.muxId});
        this.client.subs.delete(this.muxId);
        this.client.advancer.schedule(null);
    }
}

class FWFetch {
    // FWFetch is just a wrapper around FWSubscription
    sub: FWSubscription;

    canceled: boolean = false;

    // callback API //
    onFetch?: {(payload: any[]): void} = null;

    constructor(sub) {
        this.sub = sub
        this.sub.onSync = (payload) => {
            this.healthyCallback(this.onFetch, payload);
            this.sub.client.subs.delete(this.sub.muxId);
        };
    }

    healthyCallback(func, ...args: any[]): void {
        if(!func) return;
        setTimeout(() => {
            if(!this.canceled && !this.sub.client.wantClose) func(...args);
        });
    }

    // external API //

    /* cancel cancels the callback but does not affect the messages on the
       wire, since the server does not read messages from the client until
       after the sync message is sent. */
    cancel(): void {
        this.canceled = true;
    }
}

class FWRequest {
    client: FWClient;
    muxId: number;
    finished: boolean = false;

    // callback API //
    onFinish?: {(): void} = null;

    constructor(client: FWClient, muxId: number) {
        this.client = client;
        this.muxId = muxId;
    }

    finish(msg: any): void{
        this.finished = true;
        if(!this.onFinish) return;
        setTimeout(() => {
            if(!this.client.wantClose) this.onFinish();
        });
    }

    // no external API //
}

class Demo {
    client: FWClient;
    advancer: Advancer;

    sub?: FWSubscription = null;

    // state
    project?: string = null;
    topic?: string = null;
    report?: string = null;

    finding_project: boolean = false;
    finding_topic: boolean = false;
    finding_report: boolean = false;
    upload_started: boolean = false;
    upload_done: boolean = false;
    stream_started: boolean = false;

    constructor(){
        this.client = new FWClient("ws://localhost:8080/ws");
        this.client.onClose = (error) => {
            if(error === null){
                error = "client closed unexpectedly";
            }
            this.advancer.schedule(error);
        }

        this.advancer = new Advancer(this);
    }

    advanceUp(){
        // find a valid project
        if(!this.finding_project){
            this.finding_project = true;
            let fetch = this.client.fetch({"projects": {"match": "*"}});
            fetch.onFetch = (payload) => {
                this.project = payload[0].project;
                console.log(`found project=${this.project}`);
                this.advancer.schedule(null);
            }
        }
        if(!this.project) return;

        // find a valid topic
        if(!this.finding_topic){
            this.finding_topic = true;
            let fetch = this.client.fetch(
                {"topics": {"match": "project", "value": this.project}}
            );
            fetch.onFetch = (payload) => {
                this.topic = payload[0].topic;
                console.log(`found topic=${this.topic}`);
                this.advancer.schedule(null);
            }
        }
        if(!this.topic) return;

        // find a valid report
        if(!this.finding_report){
            this.finding_report = true;
            let fetch = this.client.fetch(
                {"entries": {"match": "project", "value": this.project}}
            );
            fetch.onFetch = (payload) => {
                this.report = payload[0].report;
                console.log(`found report=${this.report}`);
                this.advancer.schedule(null);
            }
        }
        if(!this.report) return;

        // upload some example data
        if(!this.upload_started){
            console.log("upload starting");
            this.upload_started = true;
            let req = this.client.upload([
                {
                    "type": "newcomment",
                    "project": this.project,
                    "version": crypto.randomUUID(),
                    "comment": crypto.randomUUID(),
                    "topic": this.topic,
                    "parent": null,
                    "body": "an uploaded comment",
                    "authortime": "2022-01-01T17:05:00Z",
                    "archivetime": null,
                },
                {
                    "type": "newtopic",
                    "project": this.project,
                    "version": crypto.randomUUID(),
                    "topic": crypto.randomUUID(),
                    "name": "really, another sequel??",
                    "authortime": "2022-01-01T17:05:00Z",
                    "archivetime": null,
                    "links": ["report", this.report],
                },
                {
                    "type": "newentry",
                    "project": this.project,
                    "report": this.report,
                    "entry": crypto.randomUUID(),
                    "version": crypto.randomUUID(),
                    "archivetime": null,
                    "clip_id": "11a",
                    "content": {"col-a": "val-a", "col-b": "val-b"},
                    "modifies": null,
                    "reason": null,
                },
            ]);
            req.onFinish = () => {
                this.upload_done = true;
                this.advancer.schedule(null);
            };
        }
        if(!this.upload_done) return;

        if(!this.stream_started){
            this.stream_started = true;
            // now subscribe to comments in the topic we found
            this.sub = this.client.subscribe({
                "comments": {"match": "topic", "value": this.topic},
            });

            this.sub.onSync = (payload) => {
                console.log("--- sync!");
                for(let i = 0; i < payload.length; i++){
                    console.log(`payload[${i}]:`, payload[i]);
                }
                console.log("---");
            };

            this.sub.onMsg = (msg) => {
                console.log(msg);
            };
        }
    }

    advanceDn(error){
        console.log("demo exited with error:", error);
        this.advancer.doneDn = true;
    }
}

let demo = new Demo();
demo.advancer.schedule(null);
