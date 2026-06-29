#!/bin/bash
ACTION=$1
shift
CONFIG_FILE="/usr/bin/ewctl.cfg"
EWCTL_PATH="/usr/bin/ewctl"

install_dependencies() {
    echo "正在安装依赖..."
    # Detect distro family via /etc/os-release and pick the package manager + the
    # distro-appropriate package names. wireguard-tools/iptables/net-tools are
    # required; a resolvconf provider is best-effort (openresolv on Debian,
    # resolvconf on Ubuntu, wireguard-tools bundles one on Arch).
    local ID_LIKE=""
    [[ -f /etc/os-release ]] && . /etc/os-release
    local family="${ID_LIKE:-$ID}"
    case "$family" in
        *arch*|*manjaro*)
            pacman -Sy --noconfirm wireguard-tools iptables net-tools openresolv 2>/dev/null \
                || echo "警告: 部分依赖安装失败"
            ;;
        *fedora*|*rhel*|*centos*|*rocky*|*alma*|*amzn*)
            # RHEL/CentOS 8+ / Fedora / Rocky / Alma: dnf (fallback yum).
            local PKG=(dnf yum); local mgr=""
            for c in "${PKG[@]}"; do command -v "$c" >/dev/null 2>&1 && mgr="$c" && break; done
            [[ -z "$mgr" ]] && { echo "错误: 未找到 dnf/yum"; return 1; }
            $mgr install -y epel-release 2>/dev/null
            $mgr install -y wireguard-tools iptables net-tools 2>/dev/null \
                || echo "警告: 部分依赖安装失败 (可能需要先启用 EPEL)"
            ;;
        *debian*|*ubuntu*|*)
            apt install -y wireguard net-tools iptables
            apt install -y openresolv 2>/dev/null || apt install -y resolvconf 2>/dev/null \
                || echo "警告: 未安装 resolvconf/openresolv (DNS 解析可能受限)"
            ;;
    esac
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
    # Append one network config (a single line: WG_INTERFACE ip:port secret peername).
    # De-dup by interface name: if an entry for the same interface exists, replace it.
    local NEW_LINE="$*"
    local NEW_IFACE="${NEW_LINE%% *}"
    if [[ -z "$NEW_IFACE" || $# -lt 4 ]]; then
        echo "用法: ewctl 1 <接口名> <ip:port> <secret> <peername>"
        exit 1
    fi
    mkdir -p "$(dirname "$CONFIG_FILE")" 2>/dev/null
    touch "$CONFIG_FILE"
    local TMP=$(mktemp)
    local replaced=0
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local iface="${line%% *}"
        if [[ "$iface" == "$NEW_IFACE" ]]; then
            echo "$NEW_LINE" >> "$TMP"
            replaced=1
        else
            echo "$line" >> "$TMP"
        fi
    done < "$CONFIG_FILE"
    [[ $replaced -eq 0 ]] && echo "$NEW_LINE" >> "$TMP"
    mv "$TMP" "$CONFIG_FILE"
    echo "配置已保存到 $CONFIG_FILE (接口 ${NEW_IFACE})"
}
run_ewctl() {
    echo "正在运行 ewctl 主函数..."
    if [[ ! -f "$CONFIG_FILE" || ! -s "$CONFIG_FILE" ]]; then
        echo "配置文件不存在或为空，请先进行配置。"
        exit 1
    fi
    # Run EasyWireGuardSync for each configured network (one line per network).
    local failed=0
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        echo "----- 网络: ${line%% *} -----"
        EasyWireGuardSync $line || failed=1
    done < "$CONFIG_FILE"
    return $failed
}
uninstall_ewctl() {
    echo "正在卸载 ewctl..."
    rm -f "$EWCTL_PATH" "$CONFIG_FILE"
    rm -rf /var/lib/ewctl
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
    # Target proxy list from the .conf ExtraInfo JSON block (the proxied field).
    local EXTRA_JSON
    EXTRA_JSON=$(awk "/#===EASYWGSYNC_EXTRA_START===#/{f=1;next}/#===EASYWGSYNC_EXTRA_END===#/{f=0}f" "$CONF" | grep "^#" | sed "s/^#//")
    local TARGET_IPS=()
    if [[ -n "$EXTRA_JSON" ]]; then
        while IFS= read -r ip; do [[ -n "$ip" ]] && TARGET_IPS+=("$ip"); done < <(echo "$EXTRA_JSON" | grep -oE "\"proxied\":\[[^]]*\]" | grep -oE "[0-9a-fA-F:.]+/[0-9]+")
    fi

    # Current proxy list from live iptables (stateless — no local state file).
    # ONLY our proxy rules: `-s <ip> -o %i -j MASQUERADE` with NO `-d`. The domain
    # NAT (`-s <net> ! -d <net> ... -j MASQUERADE`) and any manual `-d` rule are
    # excluded — sync_proxy must never touch them.
    local CUR_IPS=()
    while IFS= read -r rule; do
        local ip=$(echo "$rule" | grep -oE '\-s [0-9a-fA-F:.]+/[0-9]+' | cut -d' ' -f2)
        [[ -n "$ip" ]] && CUR_IPS+=("$ip")
    done < <(iptables -t nat -S POSTROUTING 2>/dev/null | grep -E -- "-o ${IFACE} " | grep -E -- "-j MASQUERADE" | grep -v -- "-d ")
    while IFS= read -r rule; do
        local ip=$(echo "$rule" | grep -oE '\-s [0-9a-fA-F:.]+/[0-9]+' | cut -d' ' -f2)
        [[ -n "$ip" ]] && CUR_IPS+=("$ip")
    done < <(ip6tables -t nat -S POSTROUTING 2>/dev/null | grep -E -- "-o ${IFACE} " | grep -E -- "-j MASQUERADE" | grep -v -- "-d ")

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

    # Config version (savedAt) from the ExtraInfo block. Skip the no-op sync if
    # the version is unchanged since the last successful apply (interface exists).
    local NEW_SAVED_AT
    NEW_SAVED_AT=$(awk "/#===EASYWGSYNC_EXTRA_START===#/{f=1;next}/#===EASYWGSYNC_EXTRA_END===#/{f=0}f" "${CONFIG_DIR}" | grep "^#" | sed "s/^#//" | grep -oE "\"savedAt\":[0-9]+" | grep -oE "[0-9]+")
    local STATE_DIR="/var/lib/ewctl"
    local STATE_FILE="${STATE_DIR}/${WG_INTERFACE}.savedAt"
    if ip link show "${WG_INTERFACE}" &> /dev/null; then
        if [[ -n "${NEW_SAVED_AT}" && -f "${STATE_FILE}" && "$(cat "${STATE_FILE}" 2>/dev/null)" == "${NEW_SAVED_AT}" ]]; then
            echo "配置版本未变化 (savedAt=${NEW_SAVED_AT})，跳过同步。"
            return 0
        fi
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
    # Record the applied version so the next run can skip if unchanged.
    mkdir -p "${STATE_DIR}" 2>/dev/null
    [[ -n "${NEW_SAVED_AT}" ]] && echo -n "${NEW_SAVED_AT}" > "${STATE_FILE}"
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
        echo "配置: $0 1 接口名 ip:port secret peername] "
        echo "运行: $0 2 "
        echo "注册定时任务: $0 3"
        echo "直接运行主函数: $0 4 [配置参数]"
        echo "更新: $0 5"
        echo "卸载: $0 9"
        exit 0
        ;;
esac

