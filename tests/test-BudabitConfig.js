'use strict';

require('should');

process.env.API_KEY_SECRET = 'test-api-secret';
process.env.HIVETALK_REVISION = '0000000000000000000000000000000000000000';
process.env.JWT_KEY = 'test-jwt-secret';

const config = require('../app/src/config');

describe('BudaBit production configuration', () => {
    it('binds the application locally and announces the VPS address for media', () => {
        config.server.listen.should.deepEqual({ ip: '127.0.0.1', port: 3010 });
        config.server.cors.origin.should.deepEqual(['https://calls.budabit.club']);
        config.mediasoup.numWorkers.should.equal(2);

        for (const listenInfo of config.mediasoup.webRtcTransport.listenInfos) {
            listenInfo.ip.should.equal('0.0.0.0');
            listenInfo.announcedAddress.should.equal('116.203.126.94');
            listenInfo.portRange.should.deepEqual({ min: 40000, max: 40100 });
        }
    });

    it('disables public and external pilot features', () => {
        config.features.should.deepEqual({
            publicApi: false,
            publicRoomPages: false,
            zapGoal: false,
            payments: false,
            roomPrefix: 'budabit-',
        });
        config.server.recording.enabled.should.be.false();
        config.server.rtmp.enabled.should.be.false();
        config.chatGPT.enabled.should.be.false();
        config.videoAI.enabled.should.be.false();
        config.stats.enabled.should.be.false();
        Object.values(config.api.allowed)
            .every((allowed) => allowed === false)
            .should.be.true();
    });

    it('reads defense-in-depth secrets from the environment', () => {
        config.deployment.revision.should.equal('0000000000000000000000000000000000000000');
        config.api.keySecret.should.equal('test-api-secret');
        config.jwt.key.should.equal('test-jwt-secret');
    });
});
