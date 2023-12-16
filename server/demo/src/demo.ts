import {
  Advancer,
  FWClient,
  FWSubscription,
  FWFetch,
  FWCommentsResult,
  FWComments,
  FWTopicsResult,
  FWTopics,
  reconnectingClient,
  Uuid,
  UuidRecord,
} from "@/streams/index";

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
    want_render: boolean = false;

    comments?: FWCommentsResult = null;
    topics?: FWTopicsResult = null;

    constructor(){
        this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);

        let statusObservable;
        [this.client, statusObservable] = reconnectingClient("ws://localhost:8080/ws");

        this.client.onClose = (error) => {
            if(!error){
                error = "client closed unexpectedly";
            }
            this.advancer.schedule(error);
        }

        statusObservable.select(status => status.connected).subscribe(connected => {
            this.want_render = true;
            this.connected = connected;
            this.advancer.schedule(null);
        });
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
                console.log("upload done");
                this.upload_done = true;
                this.advancer.schedule(null);
            };
        }
        if(!this.upload_done) return;

        if(!this.stream_started){
            this.stream_started = true;
            // now stream comments from the topic we found
            let commentsStore = new FWComments(
                this.client, {"match": "topic", "value": this.topic}
            );
            // for now, we'll just print stuff to the console
            commentsStore.observable.subscribe((result) => {
                this.comments = result;
                this.want_render = true;
                this.advancer.schedule(null);
            });
            // also stream all topics
            let topicsStore = new FWTopics(
                this.client, {"match": "project", "value": this.project}
            );
            // for now, we'll just print stuff to the console
            topicsStore.observable.subscribe((result) => {
                this.topics = result;
                this.want_render = true;
                this.advancer.schedule(null);
            });
        }

        if(this.comments && this.topics && this.want_render){
            this.want_render = false;
            this.render();
        }
    }

    render() {
        let out = "";
        out += "\x1b[2J\x1b[1;1H";
        out += `CONNECTED: \x1b[93m${this.connected}\x1b[m\n`;
        out += "TOPICS:\n";
        this.topics.bySubmit.map(
            (uuid) => this.topics.topics[uuid]
        ).forEach((t) => {
            const id = t.uuid.substring(0, 8);
            const when = t.submissiontime;
            const name = t.name.substring(0,40);
            out += `  ${id}:${when}: ${name}\n`;
        });
        out += "\n";
        out += `\nCOMMENTS (${this.topic}):\n`;
        out += printComments(this.comments.comments, this.comments.topLevels, "  ");
        process.stdout.write(out);
    }

    advanceDn(error){
        console.log("demo exited with error:", error);
        this.advancer.doneDn = true;
    }
}

function printComments(
    all: UuidRecord<FWComment>, uuids: Uuid[], indent: string = ""
): string {
    let out = "";
    uuids.map((uuid) => all[uuid]).forEach((c) => {
        const edit = c.edittime ? "*" : "";
        const id = c.uuid.substring(0, 8);
        const text = c.body.substring(0, 40);
        out += `${indent}${id}: ${edit}${text}\n`;
        out += printComments(all, c.children, indent + "  ");
    });
    return out;
}

let demo = new Demo();
demo.advancer.schedule(null);
