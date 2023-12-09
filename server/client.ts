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

type Uuid = string;
type UuidRecord<T> = Record<Uuid, T>;

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
    uuid: Uuid;
    topic: Uuid;
    project: Uuid;
    user: Uuid;
    body: string;
    parent?: Uuid; // parent uuid

    // whose parent are we
    children: Uuid[]; // list of child uuids
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

class FWCommentsResult {
    // comments is all comments this store knows of.
    comments: UuidRecord<FWComment>;
    // topLevels are comments with a null parent, sorted by submissiontime
    topLevels: Uuid[];
}

class FWComments {
    observable: Observable<FWCommentsResult>;
    // onSync fires shortly after the observable are populated the first time
    onSync?: {(result: FWCommentsResult): void};

    private writable: WritableObservable<FWCommentsResult>;
    private sub: FWSubscription;
    private advancer: Advancer;
    private recvd?: any = null;
    private comments: UuidRecord<FWComment> = {};
    private tops: string[] = [];
    private unresolved: UuidRecord<any[]> = {};

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
        this.writable = observable(undefined);
        this.observable = this.writable.readOnly();
    }

    // returns a set of comment uuids whose child lists need resolving.
    private processMsg(msg: any): UuidRecord<boolean> {
        const uuid = msg["comment"];
        const parent = msg["parent"];
        let out = {};

        // can we resolve this message yet?
        if(parent != null && !(parent in this.comments)){
            // comment has a parent, but we haven't seen it yet
            if(parent in this.unresolved){
                this.unresolved[parent].push(msg);
            }else{
                this.unresolved[parent] = [msg];
            }
            // we'll come back to it later
            return out;
        }

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
        let prev = this.comments[uuid];
        let recurse = [];
        if(!prev){
            // new comment
            this.comments[uuid] = c;
            if(c.parent){
                // add this comment to its parent's children list
                this.comments[c.parent].children.push(uuid);
                out[c.parent] = true;
            }else{
                // add this comment to our list of top-level comments
                this.tops.push(uuid);
                out["topLevels"] = true;
            }
            // check if any unresolved messages are newly resolvable
            let newResolved = this.unresolved[uuid];
            if(newResolved){
                delete this.unresolved[uuid];
                // we'll process them at the end of this call
                recurse.push(...newResolved);
            }
        }else if(
            // c is an update to prev...
            isBefore(prev, "authortime", c, "authortime")
            // but c is not the latest update to prev...
            && isBefore(c, "authortime", prev, "edittime")
        ){
            // ignore already-obsolete updates
        }else{
            // c updates prev, or prev updates c
            let [older, newer] =
                isBefore(prev, "authortime", c, "authortime")
                ?  [prev, c] : [c, prev];
            this.comments[uuid] = {
                // preserve immutable fields and child links
                /* (note we are trusting the update to not make illegal
                    modifications) */
                ...prev,
                // update mutable content
                srvId: older.srvId,
                seqno: older.seqno,
                submissiontime: older.submissiontime,
                authortime: older.authortime,
                body: newer.body,
                edittime: newer.authortime,
            }
        }

        recurse.forEach(
            (msg) => { out = {...out, ...this.processMsg(msg)}; }
        );
        return out;
    }

    private sortUuids(list: Uuid[]): Uuid[] {
        // do all map lookups once
        let temp = list.map((uuid) => {
            const c = this.comments[uuid];
            return {
                uuid: uuid,
                srvId: c.srvId,
                seqno: c.seqno,
                submissiontime: c.submissiontime,
            };
        });

        // sort by submissiontime
        temp.sort((a, b) => {
            return isBeforeSort(a, "submissiontime", b, "submissiontime");
        });

        // return just the sorted uuids
        return temp.map((obj) => obj.uuid);
    }

    private advanceUp(): void {
        // wait for initial sync
        if(!this.recvd) return;

        // process recvd, and any messages which become resolvable as a result
        let reSort = {};
        this.recvd.forEach(
            (msg) => reSort = {...reSort, ...this.processMsg(msg)}
        );
        this.recvd = [];

        // re-sort any objects with updated lists
        for(let key in reSort){
            if(key === "topLevels"){
                this.tops = this.sortUuids(this.tops);
            }else{
                const c = this.comments[key];
                this.comments[key] = {
                    ...c, children: this.sortUuids(c.children)
                };
            }
        }

        // update the observable
        this.writable.set({
            /* the only case where map was not updated is if we received only
               stale updates, which will be virtually never */
            comments: {...this.comments},
            // topLevels is updated IFF this.tops was updated
            topLevels: this.tops,
        });

        // send onSync after we have processed our own sync msg
        if(!this.onSyncSent){
            this.onSyncSent = true;
            setTimeout(() => {
                if(!this.advancer.doneUp && this.onSync){
                    this.onSync(this.observable.get());
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
            let store = new FWComments(
                this.client, {"match": "topic", "value": this.topic}
            );
            // for now, we'll just print stuff to the console
            store.observable.subscribe((result) => {
                printComments(result.comments, result.topLevels);
            });
        }
    }

    advanceDn(error){
        console.log("demo exited with error:", error);
        this.advancer.doneDn = true;
    }
}

function printComments(
    all: UuidRecord<FWComment>, uuids: Uuid[], indent: string = ""
): void {
    uuids.forEach((uuid, idx) => {
        const c = all[uuid];
        // very first print resets the screen
        const pre = (indent == "" && idx == 0) ? "\x1b[2J\x1b[1;1H" : "";
        // edits are flagged as "*"
        const post = c.edittime ? " *" : "";
        console.log(`${pre}${indent}${c.uuid}${post}`);
        printComments(all, c.children, indent + "  ");
    });
}

let demo = new Demo();
demo.advancer.schedule(null);
