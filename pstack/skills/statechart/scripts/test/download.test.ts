import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { download } from "../run.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "statechart-dl-"));

async function serving(files: { [path: string]: string }) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    const body = files[req.url ?? ""];
    if (body === undefined) res.writeHead(404).end();
    else res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("download keeps a file whose sha256 matches, and reuses it", async () => {
  const site = await serving({ "/tla2tools.jar": "the jar" });
  const dest = path.join(scratch(), "cache", "tlc.jar");
  try {
    assert.equal(await download(`${site.base}/tla2tools.jar`, sha("the jar"), dest), dest);
    assert.equal(fs.readFileSync(dest, "utf8"), "the jar");
    await download(`${site.base}/tla2tools.jar`, sha("the jar"), dest);
    assert.equal(site.requests.length, 1);
    assert.deepEqual(fs.readdirSync(path.dirname(dest)), ["tlc.jar"]);
  } finally {
    await site.close();
  }
});

test("download refuses a file whose sha256 does not match, and keeps nothing", async () => {
  const site = await serving({ "/tla2tools.jar": "a different jar" });
  const dest = path.join(scratch(), "tlc.jar");
  try {
    await assert.rejects(
      download(`${site.base}/tla2tools.jar`, sha("the jar"), dest),
      /has sha256 /,
    );
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(path.dirname(dest)), []);
  } finally {
    await site.close();
  }
});

test("download replaces a cached file whose sha256 no longer matches", async () => {
  const site = await serving({ "/tla2tools.jar": "the jar" });
  const dest = path.join(scratch(), "tlc.jar");
  fs.writeFileSync(dest, "truncated");
  try {
    await download(`${site.base}/tla2tools.jar`, sha("the jar"), dest);
    assert.equal(fs.readFileSync(dest, "utf8"), "the jar");
  } finally {
    await site.close();
  }
});

test("download says which URL failed", async () => {
  const site = await serving({});
  const dest = path.join(scratch(), "tlc.jar");
  try {
    await assert.rejects(
      download(`${site.base}/tla2tools.jar`, sha("the jar"), dest),
      /tla2tools\.jar: HTTP 404/,
    );
    assert.equal(fs.existsSync(dest), false);
  } finally {
    await site.close();
  }
});
