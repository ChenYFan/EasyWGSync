import bash from './bash.js';
import env from '../env.json' with { type: 'json' };
const ExtraTag = env.EXTRA_TAG || {};
const getWGRawConf = async (apiurl, apikey, configname) => {
    return fetch(`${apiurl}/api/getWireguardConfigurationRawFile?configurationName=${configname}`, {
        headers: {
            'content-type': 'application/json',
            'wg-dashboard-apikey': apikey
        },
        method: "GET"
    })
        .then(res => res.json())
        .then(res => res?.data?.content)
}
const getWGPeerConf = async (apiurl, apikey, configname) => {
    return fetch(`${apiurl}/api/downloadAllPeers/${configname}`, {
        headers: {
            'content-type': 'application/json',
            'wg-dashboard-apikey': apikey
        },
        method: "GET"
    })
        .then(res => res.json())
        .then(res => res?.data)
}

const getWGPeerNames = async (apiurl, apikey, configname) => {
    return await getWGPeerConf(apiurl, apikey, configname).then(peers => peers.map(peer => peer.fileName))
}

const getWGShowConnectionEndpoints = async (configname) => {
    const result = await bash('wg', ['show', configname, 'endpoints']);
    if (result.code !== 0) { return {} }
    const lines = result.stdout.trim().split('\n');
    const endpoints = {};
    for (const line of lines) {
        const [peer, endpoint] = line.split('\t');
        endpoints[peer] = endpoint;
    }
    return endpoints;
}
const getWGPubKeyFromPrivKey = async (privKey) => {
    const result = await bash('echo', [privKey, '|', 'wg', 'pubkey']);
    if (result.code !== 0) { return null }
    return result.stdout.trim();
}

const getWGPeerFullMeshConf = async (apiurl, apikey, configname, peername) => {
    let result = (await getWGPeerConf(apiurl, apikey, configname)).find(peer => peer.fileName === peername)?.file;
    if (!result) { return ""; }
    result = result.replace(/DNS \=/, "# DNS =")
    .replace(`[Interface]`, `# ===以下为原始配置===\n[Interface]\nListenPort = 40399\n`+`PreUp = ${env.EXTRA_SCRIPTS.PRE_UP}\nPostUp = ${env.EXTRA_SCRIPTS.POST_UP}\nPreDown = ${env.EXTRA_SCRIPTS.PRE_DOWN}\nPostDown = ${env.EXTRA_SCRIPTS.POST_DOWN}\n`);

    result += '\n\n# ===以上为原始配置，接下来为FullMesh节点配置===\n';
    const PriKey = result.match(/PrivateKey = (.+)/)[1].trim();
    const PubKey = await getWGPubKeyFromPrivKey(PriKey);
    const PeerExtraTag = ExtraTag[PubKey] ? ExtraTag[PubKey].split(',') : [];
    if (PeerExtraTag.includes('NoFullMesh')) {
        return result + '\n# ==此节点被标记为不启用FullMesh连接。将不用于配置其他FullMesh节点==\n';
    }

    let RawWGConfig = (await getWGRawConf(apiurl, apikey, configname)).split('\n');
    RawWGConfig = RawWGConfig.slice(RawWGConfig.findIndex(line => line.startsWith('[Peer]')))

    const RawPeerConfigs = {};
    const PeerIndices = [];
    RawWGConfig.forEach((line, index) => {
        if (line.startsWith('[Peer]')) PeerIndices.push(index);
    });
    PeerIndices.push(RawWGConfig.length);

    for (let i = 0; i < PeerIndices.length - 1; i++) {
        const peerConfigLines = RawWGConfig.slice(PeerIndices[i] + 1, PeerIndices[i + 1]);
        const currentPeer = {}
        let currentPeerPubKey = null
        peerConfigLines.forEach(line => {
            const [key, value] = line.split(' = ').map(s => s.trim());
            if (!key || !value) return;
            currentPeer[key] = value;
            if (key === 'PublicKey') currentPeerPubKey = value;
        })
        if (!!currentPeerPubKey) RawPeerConfigs[currentPeerPubKey] = currentPeer;
    }
    //1. 首先移除自己
    delete RawPeerConfigs[PubKey];
    //2. 先从wg show endpoints获取在线端点（AutoSave很不好用不如直接获取）
    const OnlineEndpoints = await getWGShowConnectionEndpoints(configname);
    for (let OnlineEndpointPubKey in OnlineEndpoints) {
        if (!!RawPeerConfigs[OnlineEndpointPubKey]) RawPeerConfigs[OnlineEndpointPubKey].Endpoint = OnlineEndpoints[OnlineEndpointPubKey];
    }
    //3. 根据ExtraTag删除或修改节点
    for (let peerPubKey in RawPeerConfigs) {
        const tags = ExtraTag[peerPubKey] ? ExtraTag[peerPubKey].split(',') : [];
        RawPeerConfigs[peerPubKey]["#ExtraTags"] = tags;
        RawPeerConfigs[peerPubKey]["PersistentKeepalive"] = 25;
        if (tags.includes('NoFullMesh')) {
            delete RawPeerConfigs[peerPubKey];
            continue;
        }
        if (tags.includes('NotReal')) {
            delete RawPeerConfigs[peerPubKey].Endpoint;
            if (tags.find(tag => tag.startsWith('Real%'))) {
                const realEndpoint = tags.find(tag => tag.startsWith('Real%')).replace('Real%', '');
                RawPeerConfigs[peerPubKey].Endpoint = realEndpoint;
            }
        }
        if (tags.includes('NotDefaultPersistentKeepalive')) {
            delete RawPeerConfigs[peerPubKey]["PersistentKeepalive"]
            if (tags.find(tag => tag.startsWith('RealPersistentKeepalive%'))) {
                const realPK = tags.find(tag => tag.startsWith('RealPersistentKeepalive%')).replace('RealPersistentKeepalive%', '');
                RawPeerConfigs[peerPubKey]["PersistentKeepalive"] = realPK;
            }
        }
        if (RawPeerConfigs[peerPubKey].Endpoint === undefined || RawPeerConfigs[peerPubKey].Endpoint.includes('none')) {
            delete RawPeerConfigs[peerPubKey].Endpoint;
        }
    }
    //4. 拼接最终的配置
    for (let peerPubKey in RawPeerConfigs) {
        const peer = RawPeerConfigs[peerPubKey];
        result += `\n[Peer]\n`;
        for (let key in peer) {
            result += `${key} = ${peer[key]}\n`;
        }
        result += `\n`;
    }
    result += `\n#===以上为FullMesh节点配置===\n`;

    return result

}


export {
    getWGRawConf,
    getWGPeerConf,
    getWGPeerNames,
    getWGShowConnectionEndpoints,
    getWGPeerFullMeshConf,
    getWGPubKeyFromPrivKey
};