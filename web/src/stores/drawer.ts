import { observable } from 'micro-observables';

class DrawerStore {
  #settings = observable(false);
  #welcome = observable(false);

  settings = this.#settings.readOnly();
  welcome = this.#welcome.readOnly();

  setSettings(show: boolean) {
    this.#settings.set(show);
  }

  setWelcome(show: boolean) {
    this.#welcome.set(show);
  }
}

export default new DrawerStore();
