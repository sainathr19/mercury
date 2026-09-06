// No-op analytics. The real SDK reads Platform.OS at import time, so pulling it
// in through the import graph made suites fail to load — and a unit test should
// not be emitting analytics events anyway.
class PostHog {
  static async initAsync() { return new PostHog(); }
  capture() {}
  identify() {}
  screen() {}
  flush() {}
  reset() {}
  optIn() {}
  optOut() {}
}
export default PostHog;
export { PostHog };
