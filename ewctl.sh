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

register_crontab() {
    (crontab -l 2>/dev/null; echo "*/2 * * * * $EWCTL_PATH 2") | crontab -
    echo "已注册定时任务，每2分钟运行一次 ewctl。"
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
    9)
        uninstall_ewctl
        ;;

    *)
        echo "==========================================
███████ ██     ██ ███████ ██   ██  ██████
██      ██     ██ ██      ██   ██ ██  ████
█████   ██  █  ██ ███████ ███████ ██ ██ ██
██      ██ ███ ██      ██ ██   ██ ████  ██
███████  ███ ███  ███████ ██   ██  ██████   
==========================================
"
        echo "欢迎使用 EasyWireGuardSync 客户端脚本！"
        echo "请使用以下命令进行操作："
        echo "安装: $0 0"
        echo "配置: $0 1 [配置参数]"
        echo "运行: $0 2"
        echo "注册定时任务: $0 3"
        echo "直接运行主函数: $0 4 [配置参数]"
        echo "卸载: $0 9"
        exit 0
        ;;
esac

