if(typeof Websocket === "undefined"){
    // assume we're in node; bring in a websocket package
    var WebSocket = require('ws');
}

class FWClient {
    constructor(url) {
        this.error = null;
        this.want_close = false;
        this.done_dn = false;
        this.scheduled = false;

        // state
        this.unsent = [];
        this.recvd = [];
        this.subs = {};
        this.socket_connected = false;
        this.socket_close_started = false;
        this.socket_close_done = false;
        this.mux_id = 0;

        this.socket = new WebSocket(url);
        this.socket.onopen = (e) => {
            this.socket_connected = true;
            this.schedule(null);
        };
        this.socket.onmessage = (e) => {
            let msg = JSON.parse(e.data);
            this.recvd.push(msg);
            this.schedule(null);
        };
        this.socket.onclose = (e) => {
            this.socket_close_done = true;
            let error = null;
            if (!this.want_close) {
                error = "closed early";
            }
            this.schedule(error)
        };
        this.socket.onerror = (error) => {
            // discard the error if we closed the websocket ourselves
            let kept_error = null;
            if (!this.want_close) {
                kept_error = error;
            }
            this.schedule(kept_error);
        };

        // callback API //
        this.onclose = null;
    }

    get_mux_id() {
        this.mux_id += 1;
        return this.mux_id;
    }

    schedule(e) {
        if (e && !this.error) {
            this.error = e
        }
        if (!this.done_dn && !this.scheduled) {
            setTimeout(() => { this.advance_state() });
            this.scheduled = true;
        }
    }

    advance_state() {
        this.scheduled = false;
        if (this.done_dn) {
            // late calls are ignored
            return;
        }
        if (!this.want_close && !this.error) {
            try {
                this.advance_up();
            } catch(error) {
                this.error = error;
            }
        }

        if (this.want_close || this.error) {
            console.log(this);
            this.advance_dn();
        }
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
            sub = this.subs[msg.mux_id]
            if (sub === undefined) {
                // must be a streaming mux_id that we canceled earlier
                log.console(`unexpected mux_id: ${msg.mux_id}`);
                return;
            }
            // let that subscription decide what to do
            sub.put(msg);
        }

        // ship any unsent messages
        while (msg = this.unsent.shift()) {
            this.socket.send(JSON.stringify(msg));
        }
    }

    advance_dn() {
        // make sure our socket is closed
        if (!this.socket_close_done) {
            if (!this.socket_close_started) {
                this.socket.close();
            }
            return;
        }

        // we're done now
        this.down_dn = true;

        always_callback(this.onclose, this.error);
    }

    // external API //
    close() {
        this.want_close = true;
        this.schedule(null);
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
        this.schedule(null);
        return sub;
    }
}

class FWSubscription {
    constructor(client, mux_id) {
        this.client = client;
        this.mux_id = mux_id;

        // state
        this.presync = [];
        this.synced = false;

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
        setTimeout(() => { if(!this.client.want_close) func(...args); });
    }

    always_callback(func, ...args) {
        if(!func) return;
        setTimeout(() => { func(...args); });
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
        this.client.unsent.push({"type": "close", "mux_id": this.mux_id});
        this.client.subs.delete(this.mux_id);
        this.client.schedule(null);
    }
}

let client = new FWClient("ws://localhost:8080/ws");

sub = client.subscribe({"proj_id": 1, "comments": {"match": "*"}});

sub.onsync = (payload) => {
    console.log("--- sync!");
    for(let i = 0; i < payload.length; i++){
        console.log(`payload[${i}]: ${payload[i]}`);
    }
    console.log("---");
};

sub.onsmg = (msg) => {
    console.log(msg);
};
