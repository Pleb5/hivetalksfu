'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/Room.js'), 'utf8');
const helpers = source.slice(source.indexOf('function copyRoomURL()'), source.indexOf('function shareRoomByEmail()'));

describe('embedded clipboard actions', () => {
    for (const outcome of ['async', 'selection', 'denied']) {
        it(`reports confirmed copying or a manual fallback: ${outcome}`, async () => {
            const notices = [], dialogs = [];
            let removed = false;
            const input = { style: {}, select() {}, setSelectionRange() {}, remove() { removed = true; } };
            const copy = vm.runInNewContext(helpers + '\ncopyToClipboard;', {
                navigator: { clipboard: { writeText: async () => { if (outcome !== 'async') throw Error('denied'); } } },
                document: { activeElement: null, createElement: () => input,
                    body: { appendChild() {} }, execCommand: () => outcome === 'selection' },
                userLog: (...args) => notices.push(args), swalBackground: '#000',
                Swal: { fire: options => dialogs.push(options) },
            });
            assert.equal(await copy('https://calls.example/join/test', false), outcome !== 'denied');
            assert.equal(notices.length, outcome === 'denied' ? 0 : 1);
            assert.equal(dialogs.length, outcome === 'denied' ? 1 : 0);
            if (outcome !== 'async') assert.equal(removed, true);
            if (outcome === 'denied') assert.equal(dialogs[0].inputValue, 'https://calls.example/join/test');
        });
    }
});
