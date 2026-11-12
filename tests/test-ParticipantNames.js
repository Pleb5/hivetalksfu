'use strict';

const assert = require('node:assert/strict');
const Room = require('../app/src/Room');
const Peer = require('../app/src/Peer');

describe('room participant names', () => {
    const room = () => Object.assign(Object.create(Room.prototype), { peers: new Map() });
    const peer = (id, name) => new Peer(id, { peer_info: { peer_name: name } });

    it('allocates suffixes for simultaneous devices and reuses vacated names', () => {
        const r = room();
        for (const id of ['a', 'b', 'c']) r.addPeer(peer(id, 'five'));
        assert.deepEqual([...r.peers.values()].map(p => p.peer_name), ['five', 'five-1', 'five-2']);
        r.peers.delete('b');
        r.addPeer(peer('d', 'five'));
        assert.equal(r.getPeer('d').peer_info.peer_name, 'five-1');
    });

    it('checks all occupied suffixes and keeps long names within the join limit', () => {
        const r = room();
        r.addPeer(peer('a', 'five-1'));
        r.addPeer(peer('b', 'five'));
        r.addPeer(peer('c', 'five'));
        assert.equal(r.getPeer('c').peer_name, 'five-2');
        r.addPeer(peer('d', 'x'.repeat(64)));
        r.addPeer(peer('e', 'x'.repeat(64)));
        assert.equal(r.getPeer('e').peer_name, 'x'.repeat(62) + '-1');
    });
});
