// In-memory stand-in for expo-file-system's File/Paths API.
//
// Same reason as the SecureStore mock: the caching stores import it at module
// scope, so the real (native) module broke suites that never do any I/O.
const files = new Map();
const key = (dir, name) => `${dir}/${name}`;

export const Paths = { document: 'document', cache: 'cache' };

export class File {
  constructor(dir, name) {
    this.key = key(dir, name);
  }
  get exists() {
    return files.has(this.key);
  }
  async text() {
    return files.get(this.key) ?? '';
  }
  write(contents) {
    files.set(this.key, String(contents));
  }
  delete() {
    files.delete(this.key);
  }
}

export class Directory {
  constructor(path) {
    this.path = path;
  }
}
