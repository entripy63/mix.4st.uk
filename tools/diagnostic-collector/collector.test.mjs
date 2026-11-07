import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./collector.js', import.meta.url), 'utf8');
process.env.TZ = 'UTC';

function session(host = 't.4st.uk') {
  let now = Date.parse('2026-11-06T11:07:04.453Z');
  let tick;
  let permission = 'granted';
  let failWrite = false;
  const files = new Map();
  const report = () => ({ schemaVersion: 1, page: `https://${host}/`,
    generatedAt: new Date(now).toISOString(), current: { currentTime: now / 1000 } });
  const directory = {
    queryPermission: async () => permission,
    async getFileHandle(name, options) {
      if (!files.has(name) && !options?.create) {
        throw Object.assign(new Error('Missing'), { name: 'NotFoundError' });
      }
      return { async createWritable() {
        let data;
        return {
          async write(text) {
            if (failWrite) throw new Error('Disk full');
            data = text;
          },
          async close() { files.set(name, data); },
          async abort() {}
        };
      } };
    }
  };
  const context = vm.createContext({
    window: { showDirectoryPicker: async () => directory },
    location: { origin: `https://${host}`, pathname: '/' },
    playbackDiagnostics: { report }, URL,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    console: { info() {}, error() {} },
    setInterval(callback) { tick = callback; return 1; },
    clearInterval() { tick = null; }
  });
  vm.runInContext(source, context);
  return {
    api: context.window.diagnosticCollector, files, context, report,
    deny() { permission = 'denied'; }, allow() { permission = 'granted'; },
    diskFull(value) { failWrite = value; },
    async advance(ms) {
      now += ms;
      tick?.();
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}

test('actual report identity names captures; due times, late saves and stop', async () => {
  const t = session();
  const m = session('m.4st.uk');
  await t.api.start();
  await m.api.start({ hours: 3 });
  const first = 'MR-261106-110704-453-t.4st.uk.txt';
  assert.equal(t.api.status().lastFile, first);
  assert.deepEqual(JSON.parse(t.files.get(first)), t.report());
  assert.equal(m.api.status().lastFile, 'MR-261106-110704-453-m.4st.uk.txt');
  await t.advance(12 * 3600000 - 1);
  assert.equal(t.files.size, 1);
  await t.advance(1);
  assert.equal(t.files.size, 2);
  assert.equal(t.api.status().lastFile, 'MR-261106-230704-453-t.4st.uk.txt');
  await t.advance(25 * 3600000);
  assert.equal(t.files.size, 3); // One actual capture, not two invented missed ones.
  assert.equal(t.api.status().lastFile, 'MR-261108-000704-453-t.4st.uk.txt');
  t.api.stop();
  await t.advance(24 * 3600000);
  assert.equal(t.files.size, 3);
  assert.equal(t.api.status().running, false);
  assert.equal(t.api.status().nextDue, null);
});

test('permission and disk failures stay visible, preserve last success, and retry', async () => {
  const s = session();
  await s.api.start({ hours: 1 });
  const first = s.api.status().lastFile;
  s.deny();
  await s.advance(3600000);
  assert.equal(s.files.size, 1);
  assert.match(s.api.status().error, /permission lost/);
  assert.equal(s.api.status().lastFile, first);
  s.allow();
  s.diskFull(true);
  await s.advance(60000);
  assert.match(s.api.status().error, /Disk full/);
  assert.equal(s.files.size, 1);
  s.diskFull(false);
  await s.advance(60000);
  assert.equal(s.files.size, 2);
  assert.equal(s.api.status().error, null);
});

test('wrong page, duplicate names, invalid intervals and cancelled picker cannot save', async () => {
  const s = session();
  await assert.rejects(s.api.start({ hours: 0 }), /positive/);
  await s.api.start();
  const original = [...s.files.values()][0];
  await assert.rejects(s.api.saveNow(), /already exists/);
  assert.equal([...s.files.values()][0], original);
  s.context.playbackDiagnostics.report = () => ({ ...s.report(), page: 'https://m.4st.uk/' });
  await s.advance(12 * 3600000);
  assert.match(s.api.status().error, /identity changed/);
  assert.equal(s.files.size, 1);
  await assert.rejects(s.api.start(), /already starting or running/);
  s.api.stop();
  s.context.window.showDirectoryPicker = async () => { throw new Error('User cancelled'); };
  await assert.rejects(s.api.start(), /User cancelled/);
  assert.equal(s.api.status().running, false);
  assert.equal(s.files.size, 1);
});
