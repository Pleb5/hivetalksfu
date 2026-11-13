'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    process.env.ROOM_CLIENT_TEST_SOURCE || path.join(__dirname, '../public/js/RoomClient.js'),
    'utf8',
);
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};

function fixture({ lobby = false } = {}) {
    const listeners = new Map();
    const initialAudio = { producer_id: 'initiator-audio', peer_name: 'Initiator', peer_info: {}, type: 'audioType' };
    const consumed = [];
    const localMediaStarted = deferred();
    const allowLocalMedia = deferred();
    const connected = deferred();
    const snapshotDelivered = deferred();
    const room = { peers: '[]' };
    const socket = {
        id: 'later-participant',
        on(event, handler) {
            const handlers = listeners.get(event) || [];
            handlers.push(handler);
            listeners.set(event, handlers);
        },
        off(event, handler) {
            listeners.set(event, (listeners.get(event) || []).filter((listener) => listener !== handler));
        },
        emit(event, data, callback) {
            if (event === 'join') callback(lobby ? 'isLobby' : room);
            else if (event === 'getRouterRtpCapabilities') callback({ headerExtensions: [] });
            else if (event === 'getProducers') {
                // Socket.IO does not buffer events until application listeners
                // are installed. Reply while the joiner's capture is pending.
                queueMicrotask(async () => {
                    await deliver('newProducers', [initialAudio]);
                    snapshotDelivered.resolve();
                });
            }
        },
    };
    async function deliver(event, payload) {
        await Promise.all((listeners.get(event) || []).map((handler) => handler(payload)));
    }
    const TestClient = vm.runInNewContext(`${source}
        class TestClient extends RoomClient {
            checkRoomHasPeers() {}
            isFullScreenSupported() { return false; }
        }
        ({TestClient, start: RoomClient.prototype.checkRoomHasPeers});`, {
        console: { log() {}, warn() {}, error: console.error },
        DetectRTC: { isMobileDevice: false },
        navigator: { mediaDevices: {} },
        document: {},
        window: { localStorage: { removeItem() {} } },
        isBroadcastingEnabled: false,
    });
    const client = new TestClient.TestClient(
        null, null, null, null, {}, socket, 'budabit-discovery-test', 'Joiner', 'uuid', {},
        true, false, false, false, false, null, () => connected.resolve(),
    );
    Object.assign(client, {
        createRoom: async () => {},
        handleRoomInfo: async () => {},
        loadDevice: async () => ({ rtpCapabilities: { codecs: [] } }),
        initTransports: async () => { client.consumerTransport = {}; },
        startLocalMedia: async () => {
            localMediaStarted.resolve();
            await allowLocalMedia.promise;
        },
        consume: async (id) => { consumed.push(id); },
        event() {},
        waitJoinConfirm() {},
    });
    return {
        client, consumed, deliver, listeners, room, initialAudio, connected,
        localMediaStarted, allowLocalMedia, snapshotDelivered,
        start: () => TestClient.start.call(client),
    };
}

describe('existing producer discovery during join', () => {
    it('receives the initiator audio when the producer list arrives before local capture finishes', async () => {
        const f = fixture();
        f.start();
        await f.localMediaStarted.promise;
        await f.snapshotDelivered.promise;
        f.allowLocalMedia.resolve();
        await f.connected.promise;
        assert.deepEqual(f.consumed, ['initiator-audio']);
        await f.deliver('newProducers', [{ ...f.initialAudio, producer_id: 'later-audio' }]);
        assert.deepEqual(f.consumed, ['initiator-audio', 'later-audio']);
        assert.equal(f.listeners.get('newProducers').length, 1);
    });

    it('retains lobby handlers and discovers existing audio after admission without duplicate listeners', async () => {
        const f = fixture({ lobby: true });
        f.start();
        await f.connected.promise;
        assert.equal(f.listeners.get('roomLobby').length, 1);
        const admission = f.client.joinAllowed(f.room);
        await f.localMediaStarted.promise;
        await f.snapshotDelivered.promise;
        f.allowLocalMedia.resolve();
        await admission;
        assert.deepEqual(f.consumed, ['initiator-audio']);
        assert.equal(f.listeners.get('newProducers').length, 1);
        assert.equal(f.listeners.get('roomLobby').length, 1);
    });
});
