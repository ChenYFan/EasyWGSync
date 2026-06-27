#!/bin/bash
ACTION=$1
shift
CONFIG_FILE="/usr/bin/ewctl.cfg"
EWCTL_PATH="/usr/bin/ewctl"
DEPENDENCIES=(wireguard openresolv net-tools iptables)

install_dependencies() {
    echo "正在安装依赖..."
    apt install -y "${DEPENDENCIES[@]}"
    mkdir -p /etc/wireguard
}
install_ewctl() {
    echo "正在安装 ewctl..."
    /usr/bin/cp -f "$0" "$EWCTL_PATH"
    chmod +x "$EWCTL_PATH"
    install_dependencies
    echo "ewctl installed to $EWCTL_PATH"
}

configure_ewctl() {
    echo "正在配置 ewctl..."
    echo "$@" > "$CONFIG_FILE"
    echo "配置已保存到 $CONFIG_FILE"
}
run_ewctl() {
    echo "正在运行 ewctl 主函数..."
    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo "配置文件不存在，请先进行配置。"
        exit 1
    fi
    CONFIG_PARAMS=$(<"$CONFIG_FILE")
    EasyWireGuardSync $CONFIG_PARAMS
}
uninstall_ewctl() {
    echo "正在卸载 ewctl..."
    rm -f "$EWCTL_PATH" "$CONFIG_FILE"
    echo "ewctl 已卸载。"
}

update_ewctl() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo "配置文件不存在，无法获取服务器地址。请先配置 (ewctl 1)。"
        exit 1
    fi
    # Server address is the 2nd config param (ip:port). Strip any scheme/path.
    local CFG_PARAMS=($(<"$CONFIG_FILE"))
    local SERVER="${CFG_PARAMS[1]}"
    SERVER="${SERVER#https://}"
    SERVER="${SERVER#http://}"
    SERVER="${SERVER%%/*}"
    local URL="https://${SERVER}/api/ewctl"
    local TMP_FILE="/tmp/ewctl.sh"
    echo "正在从 ${URL} 下载最新 ewctl 到 ${TMP_FILE}..."
    local HTTP_STATUS
    HTTP_STATUS=$(curl -o "$TMP_FILE" -s -w "%{http_code}\n" "${URL}")
    if [[ "${HTTP_STATUS}" -ne 200 || ! -s "$TMP_FILE" ]]; then
        echo "错误: 无法下载 ewctl (HTTP ${HTTP_STATUS})。"
        rm -f "$TMP_FILE"
        exit 1
    fi
    cp -f "$TMP_FILE" "$EWCTL_PATH"
    chmod +x "$EWCTL_PATH"
    rm -f "$TMP_FILE"
    echo "ewctl 已更新到 $EWCTL_PATH。"
}

register_crontab() {
    (crontab -l 2>/dev/null; echo "*/2 * * * * $EWCTL_PATH 2") | crontab -
    echo "已注册定时任务，每2分钟运行一次 ewctl。"
}
sync_proxy() {
    local IFACE="$1" CONF="$2"
    # Target proxy list from the .conf JSON comment block.
    local TARGET_JSON
    TARGET_JSON=$(awk "/#===EASYWGSYNC_PROXY_START===#/{f=1;next}/#===EASYWGSYNC_PROXY_END===#/{f=0}f" "$CONF" | grep "^#" | sed "s/^#//")
    local TARGET_IPS=()
    if [[ -n "$TARGET_JSON" ]]; then
        while IFS= read -r ip; do [[ -n "$ip" ]] && TARGET_IPS+=("$ip"); done < <(echo "$TARGET_JSON" | grep -oE ""proxied":\[[^]]*\]" | grep -oE "[0-9a-fA-F:.]+/[0-9]+")
    fi

    # Current proxy list from live iptables (stateless — no local state file).
    local CUR_IPS=()
    while IFS= read -r rule; do
        local ip=$(echo "$rule" | grep -oE "\-s [0-9a-fA-F:.]+/[0-9]+" | awk "{print $2}")
        [[ -n "$ip" ]] && CUR_IPS+=("$ip")
    done < <(iptables -t nat -S POSTROUTING 2>/dev/null | grep -E -- "-o ${IFACE} " | grep -E -- "-j MASQUERADE")
    while IFS= read -r rule; do
        local ip=$(echo "$rule" | grep -oE "\-s [0-9a-fA-F:.]+/[0-9]+" | awk "{print $2}")
        [[ -n "$ip" ]] && CUR_IPS+=("$ip")
    done < <(ip6tables -t nat -S POSTROUTING 2>/dev/null | grep -E -- "-o ${IFACE} " | grep -E -- "-j MASQUERADE")

    # Diff: add new (-A), remove gone (-D). v4 -> iptables, v6 -> ip6tables.
    for ip in "${TARGET_IPS[@]}"; do
        local found=0
        for c in "${CUR_IPS[@]}"; do [[ "$c" == "$ip" ]] && found=1 && break; done
        if [[ $found -eq 0 ]]; then
            local cmd=$(echo "$ip" | grep -q ":" && echo ip6tables || echo iptables)
            $cmd -t nat -A POSTROUTING -s "$ip" -o "${IFACE}" -j MASQUERADE
            echo "proxy +$ip"
        fi
    done
    for ip in "${CUR_IPS[@]}"; do
        local found=0
        for t in "${TARGET_IPS[@]}"; do [[ "$t" == "$ip" ]] && found=1 && break; done
        if [[ $found -eq 0 ]]; then
            local cmd=$(echo "$ip" | grep -q ":" && echo ip6tables || echo iptables)
            $cmd -t nat -D POSTROUTING -s "$ip" -o "${IFACE}" -j MASQUERADE 2>/dev/null
            echo "proxy -$ip"
        fi
    done
}

EasyWireGuardSync() {
    local CONFIG_PARAMS=("$@")
    echo "执行 EasyWireGuardSync 主函数，参数: ${CONFIG_PARAMS[*]}"
    #args WireguardInterfaceName ip:port secret peername
    local WG_INTERFACE=${CONFIG_PARAMS[0]}
    local SERVER_IP_PORT=${CONFIG_PARAMS[1]}
    local SECRET=${CONFIG_PARAMS[2]}
    local PEER_NAME=${CONFIG_PARAMS[3]}
    local URL="https://${SERVER_IP_PORT}/api/getPeerConfig?secret=${SECRET}&peername=${PEER_NAME}"
    echo "获取配置的URL: ${URL}"
    local CONFIG_DIR="/etc/wireguard/${WG_INTERFACE}.conf"
    local HTTP_STATUS=$(curl -o /dev/null -s -w "%{http_code}\n" "${URL}")
    if [[ "${HTTP_STATUS}" -ne 200 ]]; then
        echo "错误: 无法获取配置文件，HTTP状态码: ${HTTP_STATUS}"
        return 1
    fi
    curl -s "${URL}" -o "${CONFIG_DIR}"
    if [[ $? -ne 0 || ! -s "${CONFIG_DIR}" ]]; then
        echo "错误: 无法下载配置文件或文件为空。"
        return 1
    fi
    if ip link show "${WG_INTERFACE}" &> /dev/null; then
        echo "接口 ${WG_INTERFACE} 已存在，正在更新配置..."
        wg syncconf ${WG_INTERFACE} <(wg-quick strip ${CONFIG_DIR})
        sync_proxy "${WG_INTERFACE}" "${CONFIG_DIR}"
    else
        echo "接口 ${WG_INTERFACE} 不存在，正在创建..."
        wg-quick up "${WG_INTERFACE}"
    fi
    if [[ $? -ne 0 ]]; then
        echo "错误: 无法应用 WireGuard 配置。"
        return 1
    fi
    echo "WireGuard 配置已成功应用。"
    return 0
}
case $ACTION in
    0)
        install_ewctl
        ;;
    1)
        configure_ewctl "$@"
        ;;
    2)
        run_ewctl
        ;;
    3)
        register_crontab
        ;;
    4)
        EasyWireGuardSync "$@"
        ;;
    5)
        update_ewctl
        ;;
    9)
        uninstall_ewctl
        ;;

    *)
        echo "
  ███████╗██╗    ██╗ ██████╗ ███████╗██╗   ██╗███╗   ██╗ ██████╗
  ██╔════╝██║    ██║██╔════╝ ██╔════╝╚██╗ ██╔╝████╗  ██║██╔════╝
  █████╗  ██║ █╗ ██║██║  ███╗███████╗ ╚████╔╝ ██╔██╗ ██║██║     
  ██╔══╝  ██║███╗██║██║   ██║╚════██║  ╚██╔╝  ██║╚██╗██║██║     
  ███████╗╚███╔███╔╝╚██████╔╝███████║   ██║   ██║ ╚████║╚██████╗
  ╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝
"
        echo "欢迎使用 EasyWireGuardSync 客户端脚本！"
        echo "请使用以下命令进行操作："
        echo "安装: $0 0"
        echo "配置: $0 1 [配置参数]"
        echo "运行: $0 2"
        echo "注册定时任务: $0 3"
        echo "直接运行主函数: $0 4 [配置参数]"
        echo "更新: $0 5"
        echo "卸载: $0 9"
        exit 0
        ;;
esac

