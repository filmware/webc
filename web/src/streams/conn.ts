import { observable, Observable, WritableObservable } from 'micro-observables';

import { FWClient, FWClientWS, FWSocket } from './client';
import { FWClientRecon } from './reconnect';
import { Advancer, RecvFailure, RecvMsgAll, RecvSuccess, tob64, Uuid } from './utils';

export enum ConnectionState {
  Connected,
  Connecting,
  Backoff,
}

// ConnectionStatus is meant to be fed into an observable or something.
export type ConnectionStatus = {
  connected: boolean;
  state: ConnectionState;
  // a string representation of the error causing the broken connection
  reason: string;
};

export interface FWConnection {
  // login returns a promise that will always fire
  login(email: string, password: string): Promise<FWClient>;
  // resume a client connection while preserving the same FWClient state (promise always fires)
  resume(password: string): Promise<void>;
  // logout returns a promise that always succeeds
  // TODO: should this clear indexedDB?  Can that fail?  Should it wait for a server ack?
  logout(): Promise<void>;
  // onExpire is the logout callback you never expected
  onExpire?: { (): void };
  status: Observable<ConnectionStatus>;
  // TODO: expose server version
  // version: Observable<string>;
}

export class FWConnectionWS {
  private url: string;
  private advancer: Advancer;
  private recon?: FWClientRecon;

  private backoffUntil: number = 0;

  private socket?: FWSocket;
  private socketError?: Error;
  private socketDead: boolean = false;

  private loggedIn: boolean = false;
  private reconConnected: boolean = false;
  private email?: string;
  private session?: Uuid;
  private token?: string;

  private wantLogin?: [string, string];
  private wantResume?: string;
  private wantLogout: boolean = false;
  private resolve0?: () => void;
  private resolve1?: (client: FWClient) => void;
  private reject?: (error: Error) => void;
  private result?: RecvSuccess | RecvFailure;
  private loginSent: boolean = false;

  /* wantLogin and wantResume are not allowed to overlap, but the autologin may overlap with login,
     so it needs to be tracked with different variables */
  private autologinResult?: RecvSuccess | RecvFailure;
  private autologinSent: boolean = false;

  onExpire?: { (): void };

  status: Observable<ConnectionStatus>;
  private writable: WritableObservable<ConnectionStatus>;

  constructor(url: string) {
    this.url = url;
    this.advancer = new Advancer(this, this.advanceUp, this.advanceDn);

    this.writable = observable({
      connected: false,
      state: ConnectionState.Backoff,
      reason: `${this.socketError}`,
    });
    this.status = this.writable.readOnly();

    /* HACK: run advanceUp once to create the socket and populate the status before anybody can
       subscribe to it */
    this.advanceUp();
  }

  private resetSocket(): void {
    delete this.socket;
    delete this.socketError;
    this.socketDead = false;
    this.loggedIn = false;
    this.reconConnected = false;
  }

  private resetPromise(): void {
    delete this.wantLogin;
    delete this.wantResume;
    delete this.reject;
    delete this.resolve0;
    delete this.resolve1;
    delete this.result;
    this.loginSent = false;
    // not really part of a promise but whatever
    this.autologinSent = false;
    delete this.autologinResult;
  }

  private advanceUp() {
    if (this.wantLogout) {
      // delete our socket first
      if (this.socket && !this.socketDead) {
        this.socket.close();
        return;
      }
      this.wantLogout = false;
      // reset login-related data
      delete this.email;
      delete this.session;
      delete this.token;
      delete this.recon;
      // finished login
      this.resolve0!();
      this.resetPromise();
      // reset socket state
      this.resetSocket();
      // don't worry about connection status, we'll jump to reconnecting immediately
    }

    // did our socket die unexpectedly?
    if (this.socket && this.socketDead) {
      // socket errors are status updates for us
      this.writable.set({
        connected: false,
        state: ConnectionState.Backoff,
        reason: `${this.socketError}`,
      });

      // configure backoff logic
      const now = Date.now();
      const backoff = 1 * 1000;
      this.backoffUntil = now + backoff;
      // wake ourselves up when it's time
      setTimeout(() => this.advancer.schedule(null), backoff);

      // reset the socket
      this.resetSocket();
      // reset socket-dependent state
      if (this.wantLogin || this.wantResume) {
        this.reject!(new Error('connection failure'));
      } else if (this.wantLogout) {
        this.resolve0!();
      }
      this.resetPromise();
    }

    // do we have a socket?
    if (!this.socket) {
      // wait for backoff period...
      if (Date.now() < this.backoffUntil) return;
      // create a new socket
      this.socket = new FWSocket(this.url);
      this.socket.onConnect = () => {
        this.writable.set({
          connected: true,
          state: ConnectionState.Connected,
          reason: '',
        });
      };
      this.socket.onClose = (error?: Error) => {
        this.socketDead = true;
        this.socketError = error;
        this.advancer.schedule(null);
      };
      const oldReason = this.status.get().reason;
      this.writable.set({
        connected: false,
        state: ConnectionState.Connecting,
        // don't change the reason; that is still based on the last failure
        reason: oldReason,
      });
    }

    // do we have a login request?
    if (this.wantLogin) {
      if (!this.loginSent) {
        this.loginSent = true;
        this.socket.send({
          type: 'password',
          email: this.wantLogin[0],
          password: tob64(this.wantLogin[1]),
        });
        this.socket.recv((msg: RecvMsgAll) => {
          if (msg.type !== 'result') {
            throw new Error(`expected type:result message but got ${msg.type}`);
          }
          this.result = msg;
          this.advancer.schedule(null);
        });
      }
      if (!this.result) return;
      if (this.result.success) {
        this.email = this.wantLogin[0];
        this.loggedIn = true;
        const recon = new FWClientRecon();
        this.recon = recon;
        // store the session and token
        this.session = this.result.session;
        this.token = this.result.token;
        this.resolve1!(recon);
      } else {
        this.reject!(new Error('bad credentials'));
      }
      this.resetPromise();
    }

    // do we have a resume request?
    if (this.wantResume) {
      if (!this.loginSent) {
        this.loginSent = true;
        this.socket.send({
          type: 'password',
          email: this.email,
          password: tob64(this.wantResume),
        });
        this.socket.recv((msg: RecvMsgAll) => {
          if (msg.type !== 'result') {
            throw new Error(`expected type:result message but got ${msg.type}`);
          }
          this.result = msg;
          this.advancer.schedule(null);
        });
        if (!this.result) return;
        if (this.result.success) {
          this.loggedIn = true;
          this.resolve0!();
        } else {
          this.reject!(new Error('bad credentials'));
        }
        this.resetPromise();
      }
    }

    // can we log in automatically with a cached session token?
    if (!this.loggedIn && this.session && this.token) {
      if (!this.autologinSent) {
        this.autologinSent = true;
        this.socket.send({
          type: 'session',
          session: this.session,
          token: this.token,
        });
        this.socket.recv((msg: RecvMsgAll) => {
          if (msg.type !== 'result') {
            throw new Error(`expected type:result message but got ${msg.type}`);
          }
          this.autologinResult = msg;
          this.advancer.schedule(null);
        });
      }
      if (!this.autologinResult) return;
      if (this.autologinResult.success) {
        // we logged back in automatically; nothing special here
        this.loggedIn = true;
      } else {
        // our session has expired!
        setTimeout(() => this.onExpire?.call(null));
      }
      delete this.autologinResult;
      this.autologinSent = false;
    }

    // after we login, connect the FWClientRecon to the logged-in websocket
    if (this.loggedIn && !this.reconConnected) {
      this.reconConnected = true;
      const client = new FWClientWS(this.socket!);
      this.recon!.connect(client);
    }
  }

  private advanceDn(error?: Error) {
    // should never happen
    throw error;
  }

  login(email: string, password: string): Promise<FWClient> {
    if (this.wantLogin || this.wantResume || this.wantLogout) {
      throw new Error('login() called with an operation already in flight');
    }
    // detect if we were logged in as something already
    if (this.email) {
      throw new Error('login() called while already logged in');
    }
    this.wantLogin = [email, password];
    // if we were in a backoff, we are not anymore
    this.backoffUntil = 0;
    this.advancer.schedule(null);
    return new Promise((resolve, reject) => {
      this.resolve1 = resolve;
      this.reject = reject;
    });
  }

  resume(password: string): Promise<void> {
    if (this.wantLogin || this.wantResume || this.wantLogout) {
      throw new Error('resume() called with an operation already in flight');
    }
    if (this.loggedIn || this.session) {
      throw new Error('resume() called while already logged in');
    }
    if (!this.email) {
      throw new Error('resume() called without previous successful login()');
    }
    this.wantResume = password;
    // if we were in a backoff, we are not anymore
    this.backoffUntil = 0;
    this.advancer.schedule(null);
    return new Promise((resolve, reject) => {
      this.resolve0 = resolve;
      this.reject = reject;
    });
  }

  logout(): Promise<void> {
    if (this.wantLogin || this.wantResume || this.wantLogout) {
      throw new Error('logout() called with an operation already in flight');
    }
    if (!this.email) {
      throw new Error('logout() called when not logged in');
    }
    this.wantLogout = true;
    this.advancer.schedule(null);
    return new Promise((resolve, reject) => {
      this.resolve0 = resolve;
      this.reject = reject;
    });
  }
}
