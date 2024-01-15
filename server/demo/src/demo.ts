import {
  Advancer,
  FWClient,
  FWSubscription,
  FWFetch,
  FWProjects,
  FWUserAccounts,
  FWCommentsResult,
  FWComments,
  FWTopicsResult,
  FWTopics,
  FWReports,
  FWReportSummary,
  FWConnection,
  FWConnectionWS,
  Uuid,
  UuidRecord,
} from "@/streams/index";

class Demo {
    conn: FWConnection;
    client?: FWClient;
    advancer: Advancer;

    sub?: FWSubscription;

    // state
    connected: boolean = false;
    project?: string;
    topic?: string;
    report?: string;

    logging_in: boolean = false;
    finding_project: boolean = false;
    finding_topic: boolean = false;
    finding_report: boolean = false;
    upload_started: boolean = false;
    upload_done: boolean = false;
    stream_started: boolean = false;
    want_render: boolean = false;

    projects?: UuidRecord<FWProject>;
    ua?: UuidRecord<FWUserAccount>;
    comments?: FWCommentsResult;
    topics?: FWTopicsResult;
    summary?: FWReportSummary;
    content?: FWReportContent;

    constructor(){
        this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);

        this.conn = new FWConnectionWS("ws://localhost:8080/ws");

        this.conn.status.select(status => status.connected).subscribe(connected => {
            this.want_render = true;
            this.connected = connected;
            this.advancer.schedule(null);
        });
    }

    advanceUp(){
        // first log in
        if(!this.client){
            if(!this.logging_in){
              this.logging_in = true;
              this.conn.login("praj.ectowner@filmware.io", "password").then(
                (client) => { this.client = client; this.advancer.schedule(null); }
              ).catch(
                (error) => { this.advancer.schedule(error); }
              )
            }
            return;
        }
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
                {"reports": {"match": "project", "value": this.project}}
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
            // stream projects
            let projectsStore = new FWProjects(this.client);
            projectsStore.observable.subscribe((result) => {
              this.projects = result;
              this.want_render = true;
              this.advancer.schedule(null);
            });
            // stream useraccounts
            let uaStore = new FWUserAccounts(this.client);
            uaStore.observable.subscribe((result) => {
                this.ua = result;
                this.want_render = true;
                this.advancer.schedule(null);
            });
            // stream comments
            let commentsStore = new FWComments(
                this.client, uaStore, {"match": "topic", "value": this.topic}
            );
            commentsStore.observable.subscribe((result) => {
                this.comments = result;
                this.want_render = true;
                this.advancer.schedule(null);
            });
            // stream topics
            let topicsStore = new FWTopics(
                this.client, {"match": "project", "value": this.project}
            );
            topicsStore.observable.subscribe((result) => {
                this.topics = result;
                this.want_render = true;
                this.advancer.schedule(null);
            });
            // stream reports
            let reportsStore = new FWReports(
                this.client, uaStore, {"match": "project", "value": this.project}
            )
            const onSummary = (summary) => {
                this.summary = summary;
                this.want_render = true;
                this.advancer.schedule(null);
            };
            const onContent = (content) => {
                this.content = content;
                this.want_render = true;
                this.advancer.schedule(null);
            };
            reportsStore.onSync = (payload) => {
                // start streaming our report's summary
                reportsStore.reportsList
                    .select(list => list.summaries[this.report])
                    .subscribe(onSummary);
                // grab initial value
                onSummary(payload.summaries[this.report])
                // start subscribing to our report's content
                const obs = reportsStore.reportContents[this.report];
                obs.subscribe(onContent);
                // grab initial values
                onContent(obs.get());
            };
        }

        if(
            this.want_render
            && this.projects
            && this.ua
            && this.comments
            && this.topics
            && this.summary
            && this.content
        ){
            this.want_render = false;
            this.render();
        }
    }

    render() {
        let out = "";
        out += "\x1b[2J\x1b[1;1H";
        out += `CONNECTED: \x1b[93m${this.connected}\x1b[m\n`;
        out += "PROJECTS:\n";
        Object.entries(this.projects).forEach(([uuid, proj]) => {
          const id = uuid.substring(0, 8);
          const name = proj.name.substring(0, 40);
          out += `  ${id}: ${name}\n`;
        });
        out += "TOPICS:\n";
        this.topics.bySubmit.map(
            (uuid) => this.topics.topics[uuid]
        ).forEach((t) => {
            const id = t.uuid.substring(0, 8);
            const when = t.submissiontime;
            const name = t.name.substring(0, 40);
            out += `  ${id}:${when}: ${name}\n`;
        });
        out += `COMMENTS (${this.topic}):\n`;
        out += printComments(this.ua, this.comments.comments, this.comments.topLevels, "  ");
        out += `REPORT (${this.report}):\n`;
        out += `(conflicts=${this.summary.conflicts}, edittime=${this.summary.edittime})\n`;
        out += printReport(this.content);
        process.stdout.write(out);
    }

    advanceDn(error){
        console.log("demo exited with error:", error);
        this.advancer.doneDn = true;
    }
}

function printComments(
    ua: UuidRecord<FWUserAccount>, all: UuidRecord<FWComment>, uuids: Uuid[], indent: string = ""
): string {
    let out = "";
    uuids.map((uuid) => all[uuid]).forEach((c) => {
        const edit = c.edittime ? "*" : "";
        const name = ua[c.user].name;
        const id = c.uuid.substring(0, 4);
        const text = c.body.substring(0, 40);
        out += `${indent}${name}(${id}): ${edit}${text}\n`;
        out += printComments(ua, all, c.children, indent + "  ");
    });
    return out;
}

function columnWidth(content: FWReportContent, column: Uuid): number {
    const widths = Object.values(rows).forEach(row => row[column]?.length ?? 0);
    const headerWidth = content.columns[column].name.length;
    return widths.reduce((acc, x) => x > acc ? x : acc, headerWidth);
}

const spaces = "                                                                              ";
function printCell(s: string, conflict: boolean, width: number): string {
    let out;
    if (s.length > width) {
        out = s.substring(0, width);
    } else {
        out = s + spaces.substring(0, width - s.length);
    }
    if (conflict) {
        out = "\x1b[33m" + out + "\x1b[m";
    }
    return out;
}

function printReport(content: FWReportContent): string {
    // figure out how many columns even fit
    const wmax = 98 / content.columnList.length - 1;
    // measure column length (column headers with no ansi color codes)
    let temp = " |";
    content.columnList.forEach(c => {
        const col = content.columns[c];
        temp += printCell(col.name, false, wmax) + "|";
    });
    // actually write headers
    let out = " |";
    content.columnList.forEach(c => {
        const col = content.columns[c];
        out += printCell(col.name, col.hasConflict, wmax) + "|";
    });
    out += "\n " + (
      "---------------------------------------------------------------------------------------" +
      "---------------------------------------------------------------------------------------"
    ).substring(0, temp.length - 1) + "\n";
    // write each row
    content.rowList.forEach(r => {
        const row = content.rows[r];
        out += row.conflicts > 0 ? "!|" : " |";
        // write each cell
        content.columnList.forEach(c => {
            let text = "";
            let hasConflict = false;
            if(c in row.cells){
                // cell is defined
                const cell = row.cells[c];
                out += printCell(cell.text, cell.hasConflict, wmax) + "|";
            } else {
                out += printCell("", false, wmax) + "|";
            }
        });
        out += "\n";
    });
    return out;
}

let demo = new Demo();
demo.advancer.schedule(null);
