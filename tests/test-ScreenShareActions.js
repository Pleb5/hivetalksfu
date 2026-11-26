'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../public/js/RoomClient.js'), 'utf8');

function setup() {
    const dom = new JSDOM('<div id="grid"><div class="Camera" id="screen__video"><video id="screen"></video></div></div><div id="pinned"></div><button id="pin"></button>');
    const document = dom.window.document;
    const RoomClient = vm.runInNewContext(`${source}\nRoomClient;`, {
        document, pinVideoPosition: { value: 'vertical' }, setColor() {}, handleAspectRatio() {},
    });
    const messages = [];
    const client = Object.assign(Object.create(RoomClient.prototype), {
        userLog: (...args) => messages.push(args),
        sound() {},
        toggleVideoPin() {},
        resizeVideoMenuBar() {},
        removeVideoPinMediaContainer() {},
        videoMediaContainer: document.getElementById('grid'),
        videoPinMediaContainer: document.getElementById('pinned'),
    });
    const container = document.querySelector('.Camera');
    const video = container.querySelector('video');
    client.addScreenShareActions(container, video, '<Presenter>');
    return { dom, document, container, video, messages };
}

describe('visible screen-share controls', () => {
    it('retains screen controls and presentation classes when automatically pinned and unpinned', () => {
        const f = setup();
        const RoomClient = vm.runInNewContext(`${source}\nRoomClient;`, {
            document: f.document, pinVideoPosition: { value: 'vertical' }, setColor() {}, handleAspectRatio() {},
        });
        const client = Object.assign(Object.create(RoomClient.prototype), {
            sound() {}, toggleVideoPin() {}, resizeVideoMenuBar() {}, removeVideoPinMediaContainer() {},
            videoMediaContainer: f.document.getElementById('grid'),
            videoPinMediaContainer: f.document.getElementById('pinned'),
        });
        client.handlePN('screen', 'pin', 'screen__video', true);
        f.document.getElementById('pin').click();
        assert.equal(f.container.parentElement.id, 'pinned');
        assert.ok(f.container.classList.contains('shared-screen-tile'));
        f.container.querySelector('button').click();
        assert.ok(f.container.classList.contains('screen-share-focused'));
        f.document.getElementById('pin').click();
        assert.equal(f.container.parentElement.id, 'grid');
        assert.ok(f.container.classList.contains('shared-screen-tile'));
        assert.equal(f.container.querySelector('video'), f.video);
        f.dom.window.close();
    });
    it('focuses and restores the same video without opening the hidden menu', () => {
        const f = setup();
        let tileClicks = 0;
        f.container.addEventListener('click', () => tileClicks++);
        const [focus, fullscreen] = f.container.querySelectorAll('button');
        assert.equal(f.container.querySelector('span').textContent, "<Presenter>'s shared screen");
        assert.equal(fullscreen.getAttribute('aria-label'), 'Full screen shared screen from <Presenter>');
        focus.click();
        assert.ok(f.container.classList.contains('screen-share-focused'));
        assert.equal(focus.getAttribute('aria-pressed'), 'true');
        assert.equal(focus.textContent, 'Back to call');
        assert.equal(f.container.querySelector('video'), f.video);
        focus.click();
        assert.ok(!f.container.classList.contains('screen-share-focused'));
        assert.equal(tileClicks, 0);
        f.dom.window.close();
    });

    it('focuses the screen tile across the viewport when the room is already fullscreen', async () => {
        const f = setup();
        Object.defineProperty(f.document, 'fullscreenElement', { value: f.document.documentElement });
        let requested = false;
        f.container.requestFullscreen = async () => { requested = true; };
        f.container.querySelectorAll('button')[1].click();
        await new Promise(setImmediate);
        assert.equal(requested, false);
        assert.ok(f.container.classList.contains('screen-share-focused'));
        assert.equal(f.messages.length, 0);
        f.dom.window.close();
    });

    it('falls back to focused view when fullscreen is denied', async () => {
        const f = setup();
        f.container.requestFullscreen = async () => { throw new Error('Permissions policy denied'); };
        f.container.querySelectorAll('button')[1].click();
        await new Promise(setImmediate);
        assert.ok(f.container.classList.contains('screen-share-focused'));
        assert.equal(f.messages.length, 1);
        f.container.querySelector('button').click();
        assert.ok(!f.container.classList.contains('screen-share-focused'));
        f.dom.window.close();
    });
});
