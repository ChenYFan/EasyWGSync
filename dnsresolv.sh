cat /etc/resolv.conf
cat /etc/systemd/resolved.conf

echo "DNS=1.0.0.1" >> /etc/systemd/resolved.conf
systemctl restart systemd-resolved
resolvectl dns cnca 192.168.111.0
resolvectl domain cnca ~cnca ~cnc
resolvectl default-route cnca no

#恢复
resolvectl revert cnca