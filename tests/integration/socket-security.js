'use strict';

const assert = require('node:assert/strict');
const WebSocket = require('ws');

const socketUrl = 'ws://127.0.0.1:3010/socket.io/?EIO=4&transport=websocket';
const allowedOrigin = 'https://calls.budabit.club';

function within(promise, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 5000)),
    ]);
}

class SocketClient {
    constructor(socket) {
        this.socket = socket;
        this.nextAckId = 1;
        this.pendingAcks = new Map();
        this.pendingEvents = new Map();
        socket.on('message', (message) => this.handleMessage(message.toString()));
    }

    handleMessage(message) {
        if (message === '2') {
            this.socket.send('3');
            return;
        }

        const ack = message.match(/^43(\d+)(.*)$/s);
        if (ack) {
            const callback = this.pendingAcks.get(Number(ack[1]));
            if (!callback) return;
            this.pendingAcks.delete(Number(ack[1]));
            const values = JSON.parse(ack[2]);
            callback(values[0]);
            return;
        }

        if (message.startsWith('42')) {
            const [event, value] = JSON.parse(message.slice(2));
            const callback = this.pendingEvents.get(event);
            if (!callback) return;
            this.pendingEvents.delete(event);
            callback(value);
        }
    }

    request(event, data = {}) {
        const ackId = this.nextAckId++;
        return new Promise((resolve) => {
            this.pendingAcks.set(ackId, resolve);
            this.socket.send(`42${ackId}${JSON.stringify([event, data])}`);
        });
    }

    send(event, data = {}) {
        this.socket.send(`42${JSON.stringify([event, data])}`);
    }

    waitFor(event) {
        return new Promise((resolve) => this.pendingEvents.set(event, resolve));
    }

    close() {
        this.socket.close();
    }
}

function connect(origin = allowedOrigin) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(socketUrl, { origin });
        const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);

        socket.on('error', reject);
        socket.on('message', (message) => {
            const packet = message.toString();
            if (packet.startsWith('0')) socket.send('40');
            if (packet.startsWith('40')) {
                clearTimeout(timeout);
                resolve(new SocketClient(socket));
            }
        });
    });
}

function expectRejectedOrigin() {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(socketUrl, { origin: 'https://evil.example' });
        socket.on('open', () => reject(new Error('Untrusted origin was accepted')));
        socket.on('unexpected-response', (_, response) => {
            try {
                assert.equal(response.statusCode, 400);
                response.resume();
                socket.terminate();
                resolve();
            } catch (error) {
                reject(error);
            }
        });
        socket.on('error', reject);
    });
}

function peer(name, uuid) {
    return {
        room_id: 'budabit-socket-security',
        peer_info: {
            peer_name: name,
            peer_uuid: uuid,
            peer_token: false,
            peer_audio: false,
            peer_video: false,
            peer_screen: false,
            os_name: 'test',
            os_version: '1',
            browser_name: 'test',
            browser_version: '1',
        },
    };
}

async function main() {
    await within(expectRejectedOrigin(), 'Origin rejection');
    console.log('Origin rejection passed');

    const moderator = await within(connect(), 'Moderator connection');
    const created = await within(
        moderator.request('createRoom', { room_id: 'budabit-socket-security' }),
        'Moderator room creation',
    );
    assert.equal(created.room_id, 'budabit-socket-security');

    const moderatorJoin = await within(
        moderator.request('join', peer('Moderator', 'moderator-uuid')),
        'Moderator join',
    );
    assert.equal(moderatorJoin.id, 'budabit-socket-security');
    console.log('Moderator join passed');

    moderator.send('roomAction', {
        action: 'lock',
        password: 'correct-horse',
        peer_name: 'Moderator',
        peer_uuid: 'moderator-uuid',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const guest = await within(connect(), 'Guest connection');
    const existing = await within(
        guest.request('createRoom', { room_id: 'budabit-socket-security' }),
        'Existing room lookup',
    );
    assert.equal(existing.error, 'already exists');

    const guestJoin = await within(guest.request('join', peer('Guest', 'guest-uuid')), 'Locked guest join');
    assert.equal(guestJoin, 'isLocked');
    console.log('Locked guest denial passed');

    const deniedTransport = await within(guest.request('createWebRtcTransport'), 'Unauthorized transport request');
    assert.equal(deniedTransport.error, 'Room not found');

    const wrongPassword = guest.waitFor('roomPassword');
    guest.send('roomAction', { action: 'checkPassword', password: 'wrong' });
    assert.equal((await within(wrongPassword, 'Wrong password response')).password, 'KO');

    const correctPassword = guest.waitFor('roomPassword');
    guest.send('roomAction', { action: 'checkPassword', password: 'correct-horse' });
    const admitted = await within(correctPassword, 'Correct password response');
    assert.equal(admitted.password, 'OK');
    assert.equal(admitted.room.id, 'budabit-socket-security');

    guest.send('roomAction', {
        action: 'unlock',
        peer_name: 'Moderator',
        peer_uuid: 'moderator-uuid',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const presenterSpoofProbe = await within(connect(), 'Presenter-spoof probe connection');
    await within(
        presenterSpoofProbe.request('createRoom', { room_id: 'budabit-socket-security' }),
        'Presenter-spoof room lookup',
    );
    const spoofProbeJoin = await within(
        presenterSpoofProbe.request('join', peer('Probe', 'probe-uuid')),
        'Presenter-spoof join',
    );
    assert.equal(spoofProbeJoin, 'isLocked');
    console.log('Presenter spoofing denial passed');

    const capabilities = await within(guest.request('getRouterRtpCapabilities'), 'Authorized capabilities request');
    assert.ok(Array.isArray(capabilities.codecs));

    const secondRoom = await within(
        guest.request('createRoom', { room_id: 'budabit-second-room' }),
        'Second room rejection',
    );
    assert.equal(secondRoom.error, 'A socket can only access one room');

    const invalidPrefix = await within(connect(), 'Invalid-prefix client connection');
    const rejectedRoom = await within(
        invalidPrefix.request('createRoom', { room_id: 'outside-prefix' }),
        'Invalid-prefix room rejection',
    );
    assert.equal(rejectedRoom.error, 'Invalid room');

    const emptyRoomOwner = await within(connect(), 'Empty-room owner connection');
    const emptyRoom = await within(
        emptyRoomOwner.request('createRoom', { room_id: 'budabit-empty-room-cleanup' }),
        'Empty room creation',
    );
    assert.equal(emptyRoom.room_id, 'budabit-empty-room-cleanup');
    emptyRoomOwner.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const emptyRoomReplacement = await within(connect(), 'Empty-room replacement connection');
    const recreatedEmptyRoom = await within(
        emptyRoomReplacement.request('createRoom', { room_id: 'budabit-empty-room-cleanup' }),
        'Empty room recreation',
    );
    assert.equal(recreatedEmptyRoom.room_id, 'budabit-empty-room-cleanup');

    emptyRoomReplacement.close();
    invalidPrefix.close();
    presenterSpoofProbe.close();
    guest.close();
    moderator.close();
    console.log('Socket security smoke test passed');
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
