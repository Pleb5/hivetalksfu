'use strict';

// Local-only real SFU fixture. No public rooms, credentials, or media devices.
const express = require('express');
const path = require('node:path');
const mediasoup = require('mediasoup');

process.env.API_KEY_SECRET = 'media-test-api-secret';
process.env.JWT_KEY = 'media-test-jwt-secret';
process.env.HIVETALK_REVISION = '0000000000000000000000000000000000000000';
const config = require('../../app/src/config');

async function main() {
    const worker = await mediasoup.createWorker({ logLevel: 'error' });
    const router = await worker.createRouter({ mediaCodecs: config.mediasoup.router.mediaCodecs });
    const transports = new Map();
    const producers = new Map();
    const consumers = new Map();
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'media-negotiation.html')));
    app.get('/client.js', (req, res) => res.sendFile(path.join(__dirname, '../../public/sfu/MediasoupClient.js')));
    app.get('/capabilities', (req, res) => {
        const capabilities = structuredClone(router.rtpCapabilities);
        // Match RoomClient.joinAllowed(), including its orientation filter.
        capabilities.headerExtensions = capabilities.headerExtensions.filter(
            (extension) => extension.uri !== 'urn:3gpp:video-orientation',
        );
        res.json(capabilities);
    });
    app.post('/rpc', async (req, res, next) => {
        try {
            const { action, id, ...data } = req.body;
            switch (action) {
                case 'transport': {
                    const transport = await router.createWebRtcTransport({
                        listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }],
                    });
                    transports.set(transport.id, transport);
                    res.json({
                        id: transport.id,
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                    });
                    break;
                }
                case 'connect':
                    await transports.get(id).connect(data);
                    res.json({});
                    break;
                case 'produce': {
                    const producer = await transports.get(id).produce(data);
                    producers.set(producer.id, producer);
                    res.json({ id: producer.id });
                    break;
                }
                case 'consume': {
                    const consumer = await transports.get(id).consume({ ...data, paused: true });
                    consumers.set(consumer.id, consumer);
                    res.json({
                        id: consumer.id,
                        producerId: consumer.producerId,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                    });
                    break;
                }
                case 'resume':
                    await consumers.get(id).resume();
                    res.json({});
                    break;
                case 'closeProducer':
                    producers.get(id).close();
                    producers.delete(id);
                    res.json({});
                    break;
                case 'reset':
                    for (const transport of transports.values()) transport.close();
                    transports.clear();
                    producers.clear();
                    consumers.clear();
                    res.json({});
                    break;
                default:
                    res.status(400).json({ error: 'Unknown action' });
            }
        } catch (error) {
            next(error);
        }
    });
    app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
    const server = app.listen(5196, '127.0.0.1', () => {
        console.log('Media negotiation fixture: http://127.0.0.1:5196');
    });
    const close = () => {
        worker.close();
        server.close();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
