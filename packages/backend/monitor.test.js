const request = require('supertest');
const express = require('express');
const path = require('path');
jest.mock('ssh2');
jest.mock('axios');

let app;
let server;

const fs = require('fs');
const publicDir = path.join(__dirname, 'public');
const indexFile = path.join(publicDir, 'index.html');

beforeAll(() => {
  // Create dummy index.html for static test
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
  fs.writeFileSync(indexFile, '<!DOCTYPE html><html><body>Test</body></html>');
  app = require('./monitor');
  server = app.listen(0); // random port
});

afterAll((done) => {
  server.close(done);
  // Clean up dummy index.html
  if (fs.existsSync(indexFile)) fs.unlinkSync(indexFile);
  if (fs.existsSync(publicDir)) fs.rmdirSync(publicDir);
});

describe('API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/vm-status returns status', async () => {
    const axios = require('axios');
    axios.post.mockResolvedValue({ data: { data: { ticket: 't', CSRFPreventionToken: 'c' } } });
    axios.get.mockResolvedValue({ data: { data: { status: 'running' } } });
    const res = await request(server).get('/api/vm-status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
  });

  test('GET /api/windows-status returns reachable', async () => {
    const { Client } = require('ssh2');
    Client.mockImplementation(() => ({
      on: function (event, cb) {
        if (event === 'ready') process.nextTick(cb);
        if (event === 'error') process.nextTick(() => {});
        return this;
      },
      exec: function (cmd, cb) {
        cb(null, {
          on: (evt, handler) => {
            if (evt === 'data') process.nextTick(() => handler('Online'));
            if (evt === 'close') setTimeout(() => handler(), 10);
            return this;
          },
          stderr: { on: () => this }
        });
      },
      connect: function () { return this; },
      end: function () { }
    }));
    const res = await request(server).get('/api/windows-status');
    expect(res.status).toBe(200);
    expect(res.body.reachable).toBe(true);
  });

  test('GET /api/display-driver-status returns displayDriverLoaded', async () => {
    const { Client } = require('ssh2');
    Client.mockImplementation(() => ({
      on: function (event, cb) {
        if (event === 'ready') process.nextTick(cb);
        if (event === 'error') process.nextTick(() => {});
        return this;
      },
      exec: function (cmd, cb) {
        cb(null, {
          on: (evt, handler) => {
            if (evt === 'data') process.nextTick(() => handler('Virtual Display Driver'));
            if (evt === 'close') setTimeout(() => handler(), 10);
            return this;
          },
          stderr: { on: () => this }
        });
      },
      connect: function () { return this; },
      end: function () { }
    }));
    const res = await request(server).get('/api/display-driver-status');
    expect(res.status).toBe(200);
    expect(res.body.displayDriverLoaded).toBe(true);
  });

  test('GET /api/steam-status returns steamRunning', async () => {
    const { Client } = require('ssh2');
    Client.mockImplementation(() => ({
      on: function (event, cb) {
        if (event === 'ready') process.nextTick(cb);
        if (event === 'error') process.nextTick(() => {});
        return this;
      },
      exec: function (cmd, cb) {
        cb(null, {
          on: (evt, handler) => {
            if (evt === 'data') process.nextTick(() => handler(JSON.stringify({ Name: 'steam', Id: 123 })));
            if (evt === 'close') setTimeout(() => handler(), 10);
            return this;
          },
          stderr: { on: () => this }
        });
      },
      connect: function () { return this; },
      end: function () { }
    }));
    const res = await request(server).get('/api/steam-status');
    expect(res.status).toBe(200);
    expect(res.body.steamRunning).toBe(true);
  });

  test('GET / (static) returns index.html', async () => {
    const res = await request(server).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html');
  });

  test('GET /api/vm-status handles error', async () => {
    const axios = require('axios');
    axios.post.mockResolvedValue({ data: { data: { ticket: 't', CSRFPreventionToken: 'c' } } });
    axios.get.mockRejectedValue({ response: { data: 'fail' }, message: 'fail' });
    const res = await request(server).get('/api/vm-status');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to fetch Proxmox VM status');
  });

  test('GET /api/windows-status handles error', async () => {
    const { Client } = require('ssh2');
    Client.mockImplementation(() => ({
      on: function (event, cb) {
        if (event === 'ready') process.nextTick(cb);
        if (event === 'error') process.nextTick(() => cb(new Error('fail')));
        return this;
      },
      exec: function (cmd, cb) {
        cb(new Error('fail'));
        return this;
      },
      connect: function () { return this; },
      end: function () { }
    }));
    const res = await request(server).get('/api/windows-status');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to reach Windows VM over SSH');
  });

  test('GET /api/display-driver-status handles error', async () => {
    const { Client } = require('ssh2');
    Client.mockImplementation(() => ({
      on: function (event, cb) {
        if (event === 'ready') process.nextTick(cb);
        if (event === 'error') process.nextTick(() => cb(new Error('fail')));
        return this;
      },
      exec: function (cmd, cb) {
        cb(new Error('fail'));
        return this;
      },
      connect: function () { return this; },
      end: function () { }
    }));
    const res = await request(server).get('/api/display-driver-status');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to check display driver');
  });

  test('GET /api/steam-status handles error', async () => {
    const { Client } = require('ssh2');
    Client.mockImplementation(() => ({
      on: function (event, cb) {
        if (event === 'ready') process.nextTick(cb);
        if (event === 'error') process.nextTick(() => cb(new Error('fail')));
        return this;
      },
      exec: function (cmd, cb) {
        cb(new Error('fail'));
        return this;
      },
      connect: function () { return this; },
      end: function () { }
    }));
    const res = await request(server).get('/api/steam-status');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to check Steam process');
  });

  test('POST /api/clone-vm handles error', async () => {
    const axios = require('axios');
    axios.post.mockRejectedValueOnce(new Error('fail'));
    const res = await request(server).post('/api/clone-vm');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to clone VM');
  });

  test('Fallback route returns index.html for non-API path', async () => {
    const res = await request(server).get('/some-random-path');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html');
  });
});
