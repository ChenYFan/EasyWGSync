import bash from './bash.js';
import env from '../env.json' with { type: 'json' };
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

    const PriKey = result.match(/PrivateKey = (.+)/)[1].trim();
    const PubKey = await getWGPubKeyFromPrivKey(PriKey);

    result = "# ===EasyWGSync托管，以下为原始配置=== #\n" + result
    if (!env.GLOBAL_DNS) result = result.replace(/DNS \=/, "# DNS =")

    if (!!env.GLOBAL_SCRIPTS) {
        //寻找原始PreUp、PostUp、PreDown、PostDown，先注释
        result = result.replace(/^(PreUp|PostUp|PreDown|PostDown) \= .+/g, match => `# 以下配置被EasyWGSync(Global)禁用 ${match}`);
        //添加新的脚本
        for (let scriptType in env.GLOBAL_SCRIPTS) {
            //在[Peer]前面插入脚本(即Interface后)
            const scriptContent = env.GLOBAL_SCRIPTS[scriptType];
            if (!!scriptContent && scriptContent.trim() !== "") {
                result = result.replace(/\[Peer\]/, match => `${scriptType} = ${scriptContent}\n${match}`);
            }
        }
    }

    if (!!env.EXTRA_CONFIG && PubKey in env.EXTRA_CONFIG) {
        const extraConfig = env.EXTRA_CONFIG[PubKey];
        if (!!extraConfig.COMMENTS && extraConfig.COMMENTS.trim() !== "") result = result.replace(/\[Peer\]/, match => `# 本节点注释：${extraConfig.COMMENTS}\n${match}`);
        if (!!extraConfig.SCRIPTS) {
            for (let scriptType in extraConfig.SCRIPTS) {
                const scriptContent = extraConfig.SCRIPTS[scriptType];
                if (!!scriptContent && scriptContent.trim() !== "") {
                    result = result.replace(new RegExp(`^(${scriptType}) \\= .+`, 'gm'), match => `# 以下配置被EasyWGSync(Peer)禁用 ${match}`).replace(/\[Peer\]/, match => `${scriptType} = ${scriptContent}\n${match}`);
                }
            }
        }
        if (!!extraConfig.P2P_CONFIG && !!extraConfig.P2P_CONFIG['CENTRAL_NODE']) {
            //与中心节点的P2P配置
            const centralNodeConfig = extraConfig.P2P_CONFIG['CENTRAL_NODE'];
            if (!!centralNodeConfig.ALLOWED_IPS) result = result.replace(/AllowedIPs \= .+/, `AllowedIPs = ${centralNodeConfig.ALLOWED_IPS.join(', ')}`);
            //极度不推荐这么做，事实上中心节点应当与所有节点都能正常联系。但考虑到HybridMesh中诡异的网络环境，允许用户这么做
            if (centralNodeConfig.ENDPOINT === "none") result = result.replace(/Endpoint \= .+/, match => `# 以下配置被EasyWGSync(Peer)禁用 ${match}`);
            else if (!!centralNodeConfig.ENDPOINT) result = result.replace(/Endpoint \= .+/, `Endpoint = ${centralNodeConfig.ENDPOINT}`);
            if (!!centralNodeConfig.PERSISTENT_KEEPALIVE) result = result.replace(/PersistentKeepalive \= .+/, `PersistentKeepalive = ${centralNodeConfig.PERSISTENT_KEEPALIVE}`);
        }
    }

    result += '\n\n# ===以上为原始配置，接下来为P2P网络(MeshGroup)节点配置=== #\n';


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
    //1. 先从wg show endpoints获取中心节点与其他所有节点的Endpoint，作为默认endpoint使用（AutoSave很不好用不如直接获取）
    const OnlineEndpoints = await getWGShowConnectionEndpoints(configname);
    for (let OnlineEndpointPubKey in OnlineEndpoints) {
        if (!!RawPeerConfigs[OnlineEndpointPubKey]) RawPeerConfigs[OnlineEndpointPubKey].Endpoint = OnlineEndpoints[OnlineEndpointPubKey];
    }
    //2. Ver0.0.2 重写规则，引入MESH_GROUPS和EXTRA_CONFIG
    //2.1 首先处理EXTRA_CONFIG部分，先跳过自己和自己的P2P_CONFIG部分

    for (let PeerPubKey in env.EXTRA_CONFIG) {
        if (PeerPubKey === PubKey) continue; //跳过自己
        RawPeerConfigs[PeerPubKey]["#Comments"] = env.EXTRA_CONFIG[PeerPubKey]?.COMMENTS
        //ENDPOINT处理
        if (env.EXTRA_CONFIG[PeerPubKey].ENDPOINT === "none") delete RawPeerConfigs[PeerPubKey].Endpoint; //移除Endpoint，避免一部分在内网的节点或者本地地址污染其他节点的连接
        else if (!!env.EXTRA_CONFIG[PeerPubKey].ENDPOINT) RawPeerConfigs[PeerPubKey].Endpoint = env.EXTRA_CONFIG[PeerPubKey].ENDPOINT; //指定Endpoint，这是GLOBAL指定。因为有可能中心节点使用其他地址连接到该节点
        //ALLOWED_IPS处理，但这里并不推荐使用，AllowedIPs应该在对端节点的P2P_CONFIG中设置
        if (!!env.EXTRA_CONFIG[PeerPubKey].ALLOWED_IPS) RawPeerConfigs[PeerPubKey].AllowedIPs = env.EXTRA_CONFIG[PeerPubKey].ALLOWED_IPS.join(', ');
        //PERSISTENT_KEEPALIVE不应当在这里处理，应当由wgdashboard管理
    }

    if (PubKey in env.EXTRA_CONFIG && env.EXTRA_CONFIG[PubKey].P2P_CONFIG) {
        //处理自己的P2P_CONFIG部分
        //这里的P2P_CONFIG是指在该节点视角下，对其他节点的配置，包括ENDPOINT、ALLOWED_IPS、PERSISTENT_KEEPALIVE
        for (let PeerPubKey in env.EXTRA_CONFIG[PubKey].P2P_CONFIG) {
            if (PeerPubKey === PubKey || PeerPubKey === 'CENTRAL_NODE') continue; //跳过自己和CENTRAL_NODE，这一部分逻辑应当在上面被处理
            const p2pConfig = env.EXTRA_CONFIG[PubKey].P2P_CONFIG[PeerPubKey];
            //ENDPOINT处理
            if (p2pConfig.ENDPOINT === "none") delete RawPeerConfigs[PeerPubKey].Endpoint; //移除Endpoint，避免一部分在内网的节点或者本地地址污染其他节点的连接
            else if (!!p2pConfig.ENDPOINT) RawPeerConfigs[PeerPubKey].Endpoint = p2pConfig.ENDPOINT;
            //ALLOWED_IPS处理
            if (!!p2pConfig.ALLOWED_IPS) RawPeerConfigs[PeerPubKey].AllowedIPs = p2pConfig.ALLOWED_IPS.join(', ');
            //PERSISTENT_KEEPALIVE处理
            if (!!p2pConfig.PERSISTENT_KEEPALIVE) RawPeerConfigs[PeerPubKey].PersistentKeepalive = p2pConfig.PERSISTENT_KEEPALIVE;
        }
    }
    //2.2 然后处理MESH_GROUPS部分
    const MeshPeers = new Set();
    for (let meshGroupName in env.MESH_GROUPS) {
        const meshGroup = env.MESH_GROUPS[meshGroupName];
        if (meshGroup.includes(PubKey)) {
            //该节点属于该MeshGroup，添加所有节点
            meshGroup.forEach(peerPubKey => {
                if (peerPubKey !== PubKey) {
                    if (!RawPeerConfigs[peerPubKey]["#Groups"]) RawPeerConfigs[peerPubKey]["#Groups"] = "";
                    RawPeerConfigs[peerPubKey]["#Groups"] += meshGroupName + " ";
                    MeshPeers.add(peerPubKey);
                }
            });
        }
    }


    //3. 最后将MeshPeers中的节点配置添加到结果中

    for (let peerPubKey of MeshPeers) {
        const peerConfig = RawPeerConfigs[peerPubKey];
        result += `\n[Peer]\n`;
        for (let key in peerConfig) result += `${key} = ${peerConfig[key]}\n`;
    }

    return result + '\n# ===EasyWGSync托管，P2P配置结束=== #\n';



}


export {
    getWGRawConf,
    getWGPeerConf,
    getWGPeerNames,
    getWGShowConnectionEndpoints,
    getWGPeerFullMeshConf,
    getWGPubKeyFromPrivKey
};