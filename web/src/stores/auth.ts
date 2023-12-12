class AuthStore {
  #token: string | undefined = 'fake-token';

  get token(): string | undefined {
    return this.#token;
  }

  set token(token: string) {
    this.#token = token;
  }
}

export default new AuthStore();
