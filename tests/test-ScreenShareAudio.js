'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const roomClientSource = fs.readFileSync(path.join(__dirname, '../public/js/RoomClient.js'), 'utf8');

function loadRoomClient(extraGlobals = {}) {
    return vm.runInNewContext(`${roomClientSource}\nRoomClient;`, {
        console: { log() {}, warn() {}, error() {} },
        handleAspectRatio() {},
        ...extraGlobals,
    });
}

describe('Screen share audio lifecycle', () => {
    it('closes mediaType.audioTab without touching video DOM nodes or throwing', () => {
        const RoomClient = loadRoomClient();
        const stopped = [];
        let removed = false;
        const audioEl = {
            srcObject: {
                getTracks: () => [{ stop: () => stopped.push('audioTab') }],
            },
            parentNode: {
                removeChild(node) {
                    assert.equal(node, audioEl);
                    removed = true;
                },
            },
        };
        const emitted = [];
        let producerClosed = false;
        const client = Object.assign(Object.create(RoomClient.prototype), {
            peer_name: 'Alice',
            socket: { emit: (ev, data) => emitted.push({ ev, data }) },
            producers: new Map([['prod-tab-1', { close: () => { producerClosed = true; } }]]),
            producerLabel: new Map([['audioTab', 'prod-tab-1']]),
            localAudioEl: { childElementCount: 0 },
            videoMediaContainer: { childElementCount: 0 },
            getId: (id) => (id === 'prod-tab-1' ? audioEl : null),
            getName: () => null,
            event() {},
            setIsAudio() {},
            setIsVideo() {},
            setIsScreen() {},
        });

        client.closeProducer('audioTab');
        assert.equal(producerClosed, true);
        assert.equal(removed, true);
        assert.deepEqual(stopped, ['audioTab']);
        assert.equal(client.producerLabel.has('audioTab'), false);
        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].ev, 'producerClosed');
        assert.equal(emitted[0].data.producer_id, 'prod-tab-1');
    });

    it('closes paired audioTab when closing screen producer', () => {
        const RoomClient = loadRoomClient();
        const closedIds = [];
        const videoEl = {
            srcObject: { getTracks: () => [{ stop() {} }] },
        };
        const videoDiv = { parentNode: { removeChild() {} } };
        const vbDiv = { parentNode: { removeChild() {} } };
        const audioEl = {
            srcObject: { getTracks: () => [{ stop() {} }] },
            parentNode: { removeChild() {} },
        };
        const client = Object.assign(Object.create(RoomClient.prototype), {
            peer_name: 'Alice',
            socket: { emit: (_, data) => closedIds.push(data.producer_id) },
            producers: new Map([
                ['prod-screen-1', { close() {} }],
                ['prod-tab-1', { close() {} }],
            ]),
            producerLabel: new Map([
                ['screenType', 'prod-screen-1'],
                ['audioTab', 'prod-tab-1'],
            ]),
            localAudioEl: { childElementCount: 0 },
            videoMediaContainer: { childElementCount: 0 },
            isVideoPinned: false,
            getId: (id) =>
                ({
                    'prod-screen-1': videoEl,
                    'prod-screen-1__video': videoDiv,
                    'prod-screen-1__vb': vbDiv,
                    'prod-tab-1': audioEl,
                })[id] || null,
            getName: () => null,
            event() {},
            setIsScreen() {},
        });

        client.closeProducer('screenType');
        assert.deepEqual(closedIds, ['prod-screen-1', 'prod-tab-1']);
        assert.equal(client.producerLabel.has('screenType'), false);
        assert.equal(client.producerLabel.has('audioTab'), false);
    });

    it('preserves presenter mic echoCancellation and noiseSuppression toggles accurately', () => {
        const RoomClient = loadRoomClient({
            isRulesActive: true,
            isPresenter: true,
            switchAutoGainControl: { checked: true },
            switchEchoCancellation: { checked: true },
            switchNoiseSuppression: { checked: false },
            sampleRateSelect: { value: '48000' },
            sampleSizeSelect: { value: '16' },
            channelCountSelect: { value: '1' },
            micLatencyRange: { value: '10' },
            micVolumeRange: { value: '100' },
        });
        const client = Object.create(RoomClient.prototype);
        const constraints = client.getAudioConstraints('mic-1');
        assert.equal(constraints.audio.echoCancellation, true);
        assert.equal(constraints.audio.noiseSuppression, false);
    });

    it('uses full-viewport tile focus directly when room fullscreen is already active without nested requestFullscreen', async () => {
        const classes = new Set(['Camera']);
        const menuBarClasses = new Set(['videoMenuBar']);
        const appended = [];
        let nestedRequestCalls = 0;
        let exitFullscreenCalls = 0;
        const menuBar = {
            classList: {
                add: (c) => menuBarClasses.add(c),
                contains: (c) => menuBarClasses.has(c),
            },
        };
        const doc = {
            fullscreenElement: { id: 'room-root' },
            exitFullscreen: async () => {
                exitFullscreenCalls += 1;
                doc.fullscreenElement = null;
            },
            querySelectorAll: (sel) => (sel === '.videoMenuBar' ? [menuBar] : []),
            createElement: (tag) => ({
                tagName: tag.toUpperCase(),
                type: '',
                className: '',
                textContent: '',
                listeners: {},
                addEventListener(ev, fn) {
                    this.listeners[ev] = fn;
                },
            }),
        };
        const RoomClient = loadRoomClient({ document: doc });
        const tile = {
            classList: {
                contains: (c) => classes.has(c),
                toggle: (c, force) => {
                    if (force === undefined) {
                        if (classes.has(c)) classes.delete(c);
                        else classes.add(c);
                    } else if (force) classes.add(c);
                    else classes.delete(c);
                },
                add: (c) => classes.add(c),
                remove: (c) => classes.delete(c),
            },
            querySelector: () => null,
            appendChild: (node) => appended.push(node),
        };
        const video = {
            closest: (sel) => (sel.includes('.Camera') ? tile : null),
            requestFullscreen: async () => {
                nestedRequestCalls += 1;
            },
        };
        const client = Object.assign(Object.create(RoomClient.prototype), {
            isDocumentOnFullScreen: true,
            isVideoOnFullScreen: false,
            userLog() {},
        });

        await client.toggleFullScreen(video);
        assert.equal(nestedRequestCalls, 0);
        assert.equal(exitFullscreenCalls, 0);
        assert.equal(classes.has('tile-focused'), true);
        assert.equal(menuBarClasses.has('hidden'), true);
        assert.equal(client.isVideoOnFullScreen, true);
        assert.equal(appended.length, 1);

        // Second click exits tile focus cleanly without exiting room fullscreen
        await client.toggleFullScreen(video);
        assert.equal(exitFullscreenCalls, 0);
        assert.equal(classes.has('tile-focused'), false);
        assert.equal(client.isVideoOnFullScreen, false);
    });

    it('uses full-viewport tile focus directly when embedded in an already-fullscreen parent iframe', async () => {
        const classes = new Set(['Camera']);
        let nestedRequestCalls = 0;
        const fakeSelf = {};
        const fakeTop = {};
        const doc = {
            fullscreenElement: null,
            querySelectorAll: () => [],
            createElement: (tag) => ({
                tagName: tag.toUpperCase(),
                type: '',
                className: '',
                textContent: '',
                addEventListener() {},
            }),
        };
        const RoomClient = loadRoomClient({
            document: doc,
            window: {
                self: fakeSelf,
                top: fakeTop,
                innerWidth: 1920,
                innerHeight: 1110,
                screen: { width: 1920, height: 1200 },
            },
        });
        const tile = {
            classList: {
                contains: (c) => classes.has(c),
                toggle: (c, force) => (force ? classes.add(c) : classes.delete(c)),
                add: (c) => classes.add(c),
                remove: (c) => classes.delete(c),
            },
            querySelector: () => null,
            appendChild() {},
        };
        const video = {
            closest: (sel) => (sel.includes('.Camera') ? tile : null),
            requestFullscreen: async () => {
                nestedRequestCalls += 1;
            },
        };
        const client = Object.assign(Object.create(RoomClient.prototype), {
            isDocumentOnFullScreen: false,
            isVideoOnFullScreen: false,
            userLog() {},
        });

        await client.toggleFullScreen(video);
        assert.equal(nestedRequestCalls, 0);
        assert.equal(classes.has('tile-focused'), true);
        assert.equal(client.isVideoOnFullScreen, true);
    });

    it('focuses pinned screen-share tiles even after handlePN removes the Camera class and raises pin container stacking', async () => {
        const tileClasses = new Set(); // Camera class removed by handlePN when pinned!
        const parentClasses = new Set();
        const doc = {
            fullscreenElement: null,
            querySelectorAll: () => [],
            createElement: (tag) => ({
                tagName: tag.toUpperCase(),
                type: '',
                className: '',
                textContent: '',
                addEventListener() {},
            }),
        };
        const RoomClient = loadRoomClient({ document: doc });
        const pinContainer = {
            id: 'videoPinMediaContainer',
            classList: {
                toggle: (c, force) => (force ? parentClasses.add(c) : parentClasses.delete(c)),
                add: (c) => parentClasses.add(c),
                remove: (c) => parentClasses.delete(c),
            },
        };
        const tile = {
            id: 'prod-screen-1__video',
            parentElement: pinContainer,
            classList: {
                contains: (c) => tileClasses.has(c),
                toggle: (c, force) => (force ? tileClasses.add(c) : tileClasses.delete(c)),
                add: (c) => tileClasses.add(c),
                remove: (c) => tileClasses.delete(c),
            },
            querySelector: () => null,
            appendChild() {},
        };
        const video = {
            parentElement: tile,
            closest: (sel) => (sel.includes('[id$="__video"]') ? tile : null),
            requestFullscreen: async () => {
                // Simulate browser silently ignoring nested fullscreen without rejecting
            },
        };
        const client = Object.assign(Object.create(RoomClient.prototype), {
            isDocumentOnFullScreen: false,
            isVideoOnFullScreen: false,
            userLog() {},
        });

        await client.toggleFullScreen(video);
        assert.equal(tileClasses.has('tile-focused'), true);
        assert.equal(parentClasses.has('has-focused-tile'), true);

        await client.toggleFullScreen(video);
        assert.equal(tileClasses.has('tile-focused'), false);
        assert.equal(parentClasses.has('has-focused-tile'), false);
    });

    it('falls back to full-viewport tile focus when requestFullscreen hangs without settling', async () => {
        const tileClasses = new Set();
        const parentClasses = new Set();
        const doc = {
            fullscreenElement: null,
            querySelectorAll: () => [],
            createElement: (tag) => ({
                tagName: tag.toUpperCase(),
                type: '',
                className: '',
                textContent: '',
                addEventListener() {},
            }),
        };
        const RoomClient = loadRoomClient({ document: doc });
        const pinContainer = {
            id: 'videoPinMediaContainer',
            classList: {
                toggle: (c, force) => (force ? parentClasses.add(c) : parentClasses.delete(c)),
                add: (c) => parentClasses.add(c),
                remove: (c) => parentClasses.delete(c),
            },
        };
        const tile = {
            id: 'prod-screen-hang__video',
            parentElement: pinContainer,
            classList: {
                contains: (c) => tileClasses.has(c),
                toggle: (c, force) => (force ? tileClasses.add(c) : tileClasses.delete(c)),
                add: (c) => tileClasses.add(c),
                remove: (c) => tileClasses.delete(c),
            },
            querySelector: () => null,
            appendChild() {},
        };
        const video = {
            parentElement: tile,
            closest: (sel) => (sel.includes('[id$="__video"]') ? tile : null),
            // Real Chromium bug observed inside fullscreen parent iframe: promise never settles
            requestFullscreen: () => new Promise(() => {}),
        };
        const client = Object.assign(Object.create(RoomClient.prototype), {
            isDocumentOnFullScreen: false,
            isVideoOnFullScreen: false,
            userLog() {},
        });
        const origGoIn = client.goInFullscreen.bind(client);
        client.goInFullscreen = (el) => origGoIn(el, 25);

        await client.toggleFullScreen(video);
        assert.equal(tileClasses.has('tile-focused'), true);
        assert.equal(parentClasses.has('has-focused-tile'), true);
        assert.equal(client.isVideoOnFullScreen, true);
    });
});
