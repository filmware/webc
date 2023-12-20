import { Observable, observable } from 'micro-observables';

import {
  ConnectionStatus,
  FWClient,
  FWComment,
  FWComments,
  FWConnectionWS,
  FWTopic,
  FWTopics,
  Uuid,
  UuidRecord,
} from '@/streams';
import { getUTCString } from '@/utils/date';
import { randomUUID } from '@/utils/string';

type Project = {
  authortime: string;
  name: string;
  project: Uuid;
  submissiontime: string;
  user: Uuid;
  version: Uuid;
};

class StreamStore {
  #connection: FWConnectionWS;
  #client?: FWClient;
  #topicStore?: FWTopics;
  #commentStore?: FWComments;

  status: Observable<ConnectionStatus>;
  authenticated = observable(false);
  projectList = observable<Project[]>([]);
  projectUuid = observable<string | undefined>(undefined);
  topicList = observable<Uuid[]>([]);
  topicMap = observable<UuidRecord<FWTopic>>({});
  topicUuid = observable<Uuid | undefined>(undefined);
  commentList = observable<Uuid[]>([]);
  commentMap = observable<UuidRecord<FWComment>>({});

  constructor() {
    this.#connection = new FWConnectionWS('ws://localhost:8080/ws');
    this.#connection.onExpire = () => this.authenticated.set(false);
    this.status = this.#connection.status;
  }

  async login(email: string, password: string): Promise<void> {
    this.#client = await this.#connection.login(email, password);

    this.authenticated.set(true);

    const fetch = this.#client.fetch({ projects: { match: '*' } });
    fetch.onFetch = (payload) => {
      this.projectList.set(payload as unknown as Project[]);
      if (payload.length !== 0) this.setProjectUuid(payload[0].project);
    };
  }

  async logout() {
    await this.#connection.logout();

    this.#client = undefined;
    this.authenticated.set(false);
  }

  setProjectUuid(uuid: string) {
    if (!this.#client) return;

    this.projectUuid.set(uuid);

    this.#topicStore = new FWTopics(this.#client, { match: 'project', value: uuid });
    this.#topicStore.observable.subscribe(({ bySubmit, topics }) => {
      this.topicList.set(bySubmit);
      this.topicMap.set(topics);
    });
  }

  setTopicUuid(uuid: string) {
    if (!this.#client) return;

    this.topicUuid.set(uuid);

    this.#commentStore = new FWComments(this.#client, { match: 'topic', value: uuid });
    this.#commentStore.observable.subscribe(({ comments, topLevels }) => {
      this.commentList.set(topLevels);
      this.commentMap.set(comments);
    });
  }

  uploadComment(message: string) {
    if (!this.#client) return;

    return this.#client.upload([
      {
        type: 'newcomment',
        project: this.projectUuid.get(),
        version: randomUUID(),
        comment: randomUUID(),
        topic: this.topicUuid.get(),
        parent: null,
        body: message,
        authortime: getUTCString(),
        archivetime: null,
      },
    ]);
  }
}

export default new StreamStore();
