import * as io from 'io-ts';
import { Observable, observable } from 'micro-observables';

import localStorageStore, { LocalStorageStore } from '@/stores/localStorage';
import {
  ConnectionStatus,
  FWClient,
  FWComment,
  FWComments,
  FWConnectionWS,
  FWProject,
  FWProjects,
  FWTopic,
  FWTopics,
  FWUserAccount,
  FWUserAccounts,
  Uuid,
  UuidRecord,
} from '@/streams';
import { getUTCString } from '@/utils/date';
import { randomUUID } from '@/utils/string';

const STORAGE_KEY_PROJECT_UUID = 'project-uuid';

class StreamStore {
  #localStorage: LocalStorageStore;
  #connection: FWConnectionWS;
  #client?: FWClient;
  #userAccountsStore?: FWUserAccounts;
  #projectStore?: FWProjects;
  #topicStore?: FWTopics;
  #commentStore?: FWComments;

  status: Observable<ConnectionStatus>;
  authenticated = observable(false);
  userMap = observable<UuidRecord<FWUserAccount>>({});
  projectList = observable<Uuid[]>([]);
  projectMap = observable<UuidRecord<FWProject>>({});
  projectUuid = observable<string | undefined>(undefined);
  topicList = observable<Uuid[]>([]);
  topicMap = observable<UuidRecord<FWTopic>>({});
  topicUuid = observable<Uuid | undefined>(undefined);
  commentList = observable<Uuid[]>([]);
  commentMap = observable<UuidRecord<FWComment>>({});

  constructor(localStorage: LocalStorageStore) {
    this.#localStorage = localStorage;

    this.#connection = new FWConnectionWS(import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws');
    this.#connection.onExpire = () => this.authenticated.set(false);
    this.status = this.#connection.status;
  }

  async login(email: string, password: string): Promise<void> {
    this.#client = await this.#connection.login(email, password);
    this.authenticated.set(true);

    this.#userAccountsStore = new FWUserAccounts(this.#client);
    this.#userAccountsStore.observable.subscribe((payload) => {
      this.userMap.set(payload);
    });

    this.#projectStore = new FWProjects(this.#client);
    this.#projectStore.observable.subscribe((payload) => {
      const projectUuidList = Object.values(payload)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => p.uuid);
      this.projectMap.set(payload);
      this.projectList.set(projectUuidList);
    });

    const storedProjectUuid = this.#localStorage.getPath<Uuid>(STORAGE_KEY_PROJECT_UUID, io.string);
    if (storedProjectUuid) this.setProjectUuid(storedProjectUuid);
  }

  async logout() {
    await this.#connection.logout();

    this.#client = undefined;
    this.authenticated.set(false);
  }

  setProjectUuid(uuid: string) {
    if (!this.#client) return;

    this.projectUuid.set(uuid);
    this.#localStorage.setPath(STORAGE_KEY_PROJECT_UUID, uuid, io.string);

    this.#topicStore = new FWTopics(this.#client, { match: 'project', value: uuid });
    this.#topicStore.observable.subscribe(({ bySubmit, topics }) => {
      this.topicList.set(bySubmit);
      this.topicMap.set(topics);
    });
  }

  setTopicUuid(uuid: string) {
    if (!this.#client || !this.#userAccountsStore) return;

    this.topicUuid.set(uuid);

    this.#commentStore = new FWComments(this.#client, this.#userAccountsStore, {
      match: 'topic',
      value: uuid,
    });
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

export default new StreamStore(localStorageStore);
