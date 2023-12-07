import { WebSocket } from "ws";
import { observable, Observable, WritableObservable } from "micro-observables";

type advanceUpFn = () => void;
type advanceDnFn = (error: any) => void;

class Advancer {
    protected error: any = null;
    protected scheduled : boolean = false;
    protected advanceUp: advanceUpFn;
    protected advanceDn: advanceDnFn;

    doneUp: boolean = false;
    doneDn: boolean = false;

    constructor(thisArg: any, advanceUp: advanceUpFn, advanceDn: advanceDnFn){
        this.advanceUp = advanceUp.bind(thisArg);
        this.advanceDn = advanceDn.bind(thisArg);
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

    protected advanceState(): void {
        this.scheduled = false;
        if (this.doneDn) {
            // late wakeups are ignored
            return;
        }
        if (!this.doneUp && !this.error) {
            try {
                this.advanceUp();
            } catch(error) {
                this.error = error;
            }
        }

        if (this.doneUp || this.error) {
            this.advanceDn(this.error);
        }
    }
};

/* FWClient is the logical unit of synchronization.  It is an interface because
   it can be implemented either directly over a websocket or through a
   replicator built around an IndexedDB, or through a port to SharedWorker. */
interface FWClient {
    subscribe(spec): FWSubscription;
    fetch(spec): FWFetch;
    upload(objects): void;
}

interface FWSubscription {
    /* onPreSyncMsg returns messages prior to the synchronization message.
       If unset, onSync will return all messages in a single callback.  It is
       assumed onPreSyncMsg will be unset unless the consumer is collecting a
       very large amount of data and wants to process it as it arrives, rather
       than buffer everything in memory. */
    onPreSyncMsg?: {(msg: any): void};
    /* onSync returns the whole initial payload, unless onPreSyncMsg was
       set, in which case it returns an empty list of messages. */
    onSync?: {(payload: any[]): void};
    // onMsg returns individual messages which arrive after the sync message.
    onMsg?: {(msg: any): void};

    close(): void;
}

interface FWFetch {
    onFetch?: {(payload: any[]): void};

    cancel(): void;
}

class FWClientWS {
    advancer: Advancer;
    socket: WebSocket;

    unsent: any[] = [];
    recvd: any[] = [];
    muxId: number = 0;
    subs: Map<number, FWSubscriptionWS> = new Map<number, FWSubscriptionWS>;
    reqs: Map<number, FWRequestWS> = new Map<number, FWRequestWS>;

    socketConnected: boolean = false;
    socketCloseStarted: boolean = false;
    socketCloseDone: boolean = false;
    wantClose: boolean

    // callback API //
    onClose?: {(error: any): void} = null;

    constructor(url: string) {
        this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);

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

    private getMuxID(): number {
        this.muxId += 1;
        return this.muxId;
    }

    private advanceUp(): void {
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

    private advanceDn(error: any): void {
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
        let muxId = this.getMuxID();
        let msg = {
            "type": "subscribe",
            "mux_id": muxId,
            ...spec,
        };
        let sub = new FWSubscriptionWS(this, muxId);
        this.subs[muxId] = sub;
        this.unsent.push(msg);
        this.advancer.schedule(null);
        return sub;
    }

    fetch(spec){
        let muxId = this.getMuxID();
        let msg = {
            "type": "fetch",
            "mux_id": muxId,
            ...spec,
        };
        let sub = new FWSubscriptionWS(this, muxId);
        this.subs[muxId] = sub;
        this.unsent.push(msg);
        this.advancer.schedule(null);
        return new FWFetchWS(sub);
    }

    upload(objects): FWRequestWS {
        let muxId = this.getMuxID();
        let msg = {
            "type": "upload",
            "mux_id": muxId,
            "objects": objects
        };
        let req = new FWRequestWS(this, muxId);
        this.reqs[muxId] = req;
        this.unsent.push(msg);
        this.advancer.schedule(null);
        return req;
    }
}

class FWSubscriptionWS {
    client: FWClientWS;
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

    healthyCallback(name, ...args: any[]): void {
        setTimeout(() => {
            let func = this[name];
            if(func && !this.closed && !this.client.wantClose){
                func(...args);
            }
        });
    }

    // a message arrives from the client object
    put(msg): void {
        if(this.synced){
            // after sync, always call onMsg
            this.healthyCallback("onMsg", msg);
            return;
        }
        if(msg.type == "sync") {
            // this is the sync; deliver the buffered presync messages
            this.synced = true;
            let payload = this.presync;
            this.presync = null;
            this.healthyCallback("onSync", payload);
            return;
        }
        if(this.onPreSyncMsg){
            // before sync, client can request individual messages
            this.healthyCallback("onPreSyncMsg", msg);
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

class FWFetchWS {
    // FWFetch is just a wrapper around FWSubscription
    sub: FWSubscriptionWS;

    canceled: boolean = false;

    // callback API //
    onFetch?: {(payload: any[]): void} = null;

    constructor(sub) {
        this.sub = sub
        this.sub.onSync = (payload) => {
            this.healthyCallback("onFetch", payload);
            this.sub.client.subs.delete(this.sub.muxId);
        };
    }

    healthyCallback(name, ...args: any[]): void {
        setTimeout(() => {
            let func = this[name];
            if(func && !this.canceled && !this.sub.client.wantClose){
                func(...args);
            }
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

class FWRequestWS {
    client: FWClientWS;
    muxId: number;
    finished: boolean = false;

    // callback API //
    onFinish?: {(): void} = null;

    constructor(client: FWClientWS, muxId: number) {
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

class FWComment {
    srvId: number; // only for tie-breaker sorting
    seqno: number; // only for tie-breaker sorting
    uuid: string;
    topic: string;
    project: string;
    user: string;
    body: string;
    parent?: string; // parent uuid

    // whose parent are we
    children: string[]; // list of child uuids
    submissiontime: Date;
    authortime: Date;
    edittime?: Date;
}

function isBefore(a: any, akind: string, b: any, bkind: string): boolean {
    if(a[akind] < b[bkind]){
        return true;
    }else if(a[akind] > b[bkind]){
        return false;
    }
    // tiebreaker
    if(a.srvId == b.srvId) return a.srvId < b.srvId;
    return a.srvId < b.srvId;
}

function isBeforeSort(a: any, akind: string, b: any, bkind: string): number {
    return isBefore(a, akind, b, bkind) ? -1 : 1;
}

class FWComments {
    observable: Observable<Record<string, FWComment>>;
    onSync?: {(): void};

    private writable: WritableObservable<Record<string, FWComment>>;
    private sub: FWSubscription;
    private advancer: Advancer;
    private recvd?: any = null;
    private comments: Record<string, FWComment> = {};
    private unresolved: Record<string, any[]> = {};
    private allParents: Record<string, boolean> = {};

    private onSyncSent: boolean = false;

    constructor(client: FWClient, spec: any) {
        this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);
        this.sub = client.subscribe({"comments": spec});
        this.sub.onSync = (payload) => {
            this.recvd = payload;
            this.advancer.schedule(null);
        };
        this.sub.onMsg = (msg) => {
            this.recvd.push(msg);
            this.advancer.schedule(null);
        }
        this.writable = observable({});
        this.observable = this.writable.readOnly();
    }

    private resolve(msg: any): any[] {
        const uuid = msg["comment"];
        this.allParents[uuid] = true;
        let out = [msg];
        let newResolved = this.unresolved[uuid];
        if(newResolved){
            delete this.unresolved[uuid];
            newResolved.forEach((msg) => {
                out.push(...this.resolve(msg));
            });
        }
        return out;
    }

    private processRecvd(): void {
        // do we have any updates to process?
        if(!this.recvd.length) return;

        // Deal with unresolved comments.  Currently, unresolved means:
        //  - parent is defined but not present

        let resolved = []

        // sort received into resolved and unresolved, promoting as needed
        this.recvd.forEach((msg) => {
            const uuid = msg["comment"];
            const parent = msg["parent"];
            if(parent === null){
                // top-level comments are always resolved
                resolved.push(...this.resolve(msg));
            }else if(parent in this.allParents){
                // parent already exists
                resolved.push(...this.resolve(msg));
            }else if(parent in this.unresolved){
                this.unresolved[parent].push(msg);
            }else{
                this.unresolved[parent] = [msg];
            }
        });
        this.recvd = [];

        // now apply comment msg events to FWComment objects
        let newChildren = [];
        resolved.forEach((msg) => {
            const uuid = msg["comment"];

            let c = {
                srvId: msg["srvId"],
                seqno: msg["seqno"],
                uuid: uuid,
                topic: msg["topic"],
                project: msg["project"],
                user: msg["user"], // todo: link to users instead
                parent: msg["parent"],
                body: msg["body"],
                submissiontime: msg["submissiontime"],
                authortime: msg["authortime"],
                edittime: null,
                children: [],
            };

            // read diffs, apply to our comments map
            // "x" = e"x"isting commet
            let x = this.comments[uuid];
            if(!x){
                // new comment
                this.comments[uuid] = c;
                if(c.parent){
                    newChildren.push([uuid, c.parent]);
                }
            }else if(
                // c is an update to x...
                isBefore(x, "authortime", c, "authortime")
                // but c is not the latest update to x...
                && isBefore(c, "authortime", x, "edittime")
            ){
                // ignore already-obsolete updates
            }else{
                // c updates x, or x updates c
                let [older, newer] =
                    isBefore(x, "authortime", c, "authortime")
                    ?  [x, c] : [c, x];
                this.comments[uuid] = {
                    // preserve immutable fields and child links
                    /* (note we are trusting the update to not make illegal
                        modifications) */
                    ...x,
                    // update mutable content
                    srvId: older.srvId,
                    seqno: older.seqno,
                    submissiontime: older.submissiontime,
                    authortime: older.authortime,
                    body: newer.body,
                    edittime: newer.authortime,
                }
            }
        });

        // now that all FWComment objects are created, update children links
        newChildren.forEach(([child,  parent]) => {
            this.comments[parent].children.push(child);
        });

        // finally, update the observable
        this.writable.set({...this.comments})
    }

    private advanceUp(): void {
        // wait for initial sync
        if(!this.recvd) return;

        this.processRecvd();

        // send onSync after we have processed our own sync msg
        if(!this.onSyncSent){
            this.onSyncSent = true;
            setTimeout(() => {
                if(!this.advancer.doneUp && this.onSync){
                    this.onSync();
                }
            });
        }
    }

    private advanceDn(error): void {
        // this should actually never run
        console.log("unexpected FWComments.advanceDn() error:", error);
    }

    close(): void {
        this.advancer.doneUp = true;
        this.sub.close();
        // there's no cleanup to be done
        this.advancer.doneDn = true;
    }
}

class Demo {
    client: FWClientWS;
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
        this.client = new FWClientWS("ws://localhost:8080/ws");
        this.client.onClose = (error) => {
            if(error === null){
                error = "client closed unexpectedly";
            }
            this.advancer.schedule(error);
        }

        this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);
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
            // now stream comments from the topic we found
            let comments = new FWComments(
                this.client, {"match": "topic", "value": this.topic}
            );
            // for now, we'll just print stuff to the console
            comments.observable.subscribe(printComments);
        }
    }

    advanceDn(error){
        console.log("demo exited with error:", error);
        this.advancer.doneDn = true;
    }
}

function printList(
    all: Record<string, FWComment>, comments: FWComment[], indent: string = ""
): void {
    comments.sort((a, b) => {
        return isBeforeSort(a, "submissiontime", b, "submissiontime");
    });
    comments.forEach((c, idx) => {
        // very first print resets the screen
        let pre = (indent == "" && idx == 0) ? "\x1b[2J\x1b[1;1H" : "";
        // edits are flagged as "*"
        let post = c.edittime ? " *" : "";
        console.log(`${pre}${indent}${c.uuid}${post}`);
        let children = c.children.map((uuid) => all[uuid]);
        printList(all, children, indent + "  ");
    });
}

function printComments(comments: Record<string, FWComment>): void {
    let top = [];
    for(let uuid in comments){
        let c = comments[uuid];
        if(c.parent == null){
            top.push(c);
        }
    }
    printList(comments, top);
}

let demo = new Demo();
demo.advancer.schedule(null);
