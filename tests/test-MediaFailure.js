'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const roomClientSource = fs.readFileSync(path.join(__dirname, '../public/js/RoomClient.js'), 'utf8');

describe('Media negotiation failure cleanup', () => {
    for (const type of ['audioType', 'videoType', 'screenType']) {
        it(`releases all captured tracks before reporting a failed ${type} producer`, async () => {
            const error = new Error('RTP extension ID reassignment not supported');
            const tracks = [
                {
                    stopped: false,
                    getSettings: () => ({}),
                    stop() {
                        this.stopped = true;
                    },
                },
                {
                    stopped: false,
                    stop() {
                        this.stopped = true;
                    },
                },
            ];
            const stream = {
                getTracks: () => tracks,
                getAudioTracks: () => [tracks[0]],
                getVideoTracks: () => [tracks[0]],
            };
            let reported = false;
            const RoomClient = vm.runInNewContext(`${roomClientSource}\nRoomClient;`, {
                console: { log() {}, error() {} },
                navigator: {
                    mediaDevices: {
                        getUserMedia: async () => stream,
                        getDisplayMedia: async () => stream,
                        getSupportedConstraints: () => ({}),
                    },
                },
                handleMediaError(mediaType, actualError) {
                    assert.equal(mediaType, type);
                    assert.equal(actualError, error);
                    assert.ok(
                        tracks.every((track) => track.stopped),
                        'capture must stop before the error dialog',
                    );
                    reported = true;
                    throw actualError;
                },
            });
            const client = Object.assign(Object.create(RoomClient.prototype), {
                device: { canProduce: () => true },
                producerLabel: new Map(),
                producerTransport: {
                    produce: async () => {
                        throw error;
                    },
                },
                getId: () => null,
                getAudioConstraints: () => ({}),
                getVideoConstraints: () => ({}),
                getScreenConstraints: () => ({}),
                getWebCamEncoding: () => ({}),
                getScreenEncoding: () => ({}),
            });
            await assert.rejects(client.produce(type), (actualError) => actualError === error);
            assert.ok(reported);
        });
    }
});
