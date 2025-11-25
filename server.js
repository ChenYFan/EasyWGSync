import env from './env.json' with { type: 'json' };
import logger from './utils/logger.js';
import {
    getWGRawConf,
    getWGPeerConf,
    getWGPeerNames,
    getWGShowConnectionEndpoints,
    getWGPeerFullMeshConf,
    getWGPubKeyFromPrivKey
} from './utils/wgconf.js';


const log = new logger('WGSync Server');
import http from 'http';

const server = http.createServer(async (req, res) => {
    const URLObject = new URL(req.url, `http://${req.headers.host}`);
    const URLPath = URLObject.pathname;
    const URLParams = URLObject.searchParams;
    const ReqHeader = req.headers;
    const RealIP = ReqHeader['x-real-ip'] || ReqHeader['x-forwarded-for'] || req.socket.remoteAddress;
    const secret = URLParams.get('secret');

    log.debug(`From ${RealIP} Received request: ${URLPath} with params: ${URLParams.toString()}`);
    if (secret !== env.SECRET) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API Forbidden' }));
        log.error(`From ${RealIP} Forbidden request due to invalid secret.`);
        return;
    }
    log.debug(`From ${RealIP} Authorized request with valid secret.`);
    const URLPathSplit = URLPath.split('/');
    switch (URLPathSplit[1]) {
        case 'api':
            switch (URLPathSplit[2]) {
                case 'getPeerConfig':
                    const PeerName = URLParams.get('peername');
                    const AllWGPeerNames = await getWGPeerNames(env.WIREGUARD_DASHBOARD_URL, env.WIREGUARD_DASHBOARD_APIKEY, env.WIREGUARD_CONFIGNAME);
                    if (!PeerName || !AllWGPeerNames.includes(PeerName)) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Peer Not Found' }));
                        return;
                    }
                    const result = await getWGPeerFullMeshConf(env.WIREGUARD_DASHBOARD_URL, env.WIREGUARD_DASHBOARD_APIKEY, env.WIREGUARD_CONFIGNAME, PeerName)
                    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end(result);
                    break;
                case 'getAllPeerNames':
                    const AllWGPeerNamesList = await getWGPeerNames(env.WIREGUARD_DASHBOARD_URL, env.WIREGUARD_DASHBOARD_APIKEY, env.WIREGUARD_CONFIGNAME);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ peers: AllWGPeerNamesList }));
                    return;
                default:
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Not Found API' }));
                    return;
            }
            break;
        default:
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not Found Path' }));
            return;
    }
})

server.listen(env.PORT, "0.0.0.0", () => {
    log.log(`Server is listening on port ${env.PORT}`);
});
