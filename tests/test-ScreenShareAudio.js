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

    it('allows participant video fullscreen even while room fullscreen is active, falling back to full-viewport tile focus when nested fullscreen rejects', async () => {
        const classes = new Set(['Camera']);
        const appended = [];
        const doc = {
            fullscreenElement: { id: 'room-root' },
            exitFullscreen: async () => {
                doc.fullscreenElement = null;
            },
            querySelectorAll: () => [],
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
            closest: (sel) => (sel === '.Camera' ? tile : null),
            requestFullscreen: async () => {
                throw new Error('Blocked inside fullscreen parent iframe');
            },
        };
        const client = Object.assign(Object.create(RoomClient.prototype), {
            isDocumentOnFullScreen: true,
            isVideoOnFullScreen: false,
            userLog() {},
        });

        await client.toggleFullScreen(video);
        assert.equal(classes.has('tile-focused'), true);
        assert.equal(client.isVideoOnFullScreen, true);
        assert.equal(appended.length, 1);

        // Second click exits tile focus cleanly without exiting room fullscreen
        await client.toggleFullScreen(video);
        assert.equal(classes.has('tile-focused'), false);
        assert.equal(client.isVideoOnFullScreen, false);
    });
});
