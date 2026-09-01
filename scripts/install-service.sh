#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node_path=$(command -v node || true)
npm_path=$(command -v npm || true)

if [[ -z ${node_path} || -z ${npm_path} ]]; then
  echo "Node.js 24 LTS and npm are required." >&2
  exit 1
fi

node_major=$(${node_path} --eval "process.stdout.write(process.versions.node.split('.')[0])")
if [[ ${node_major} -ne 24 ]]; then
  echo "Node.js 24 LTS is required; found $(${node_path} --version)." >&2
  exit 1
fi

if ! getent group fronius-monitor >/dev/null; then
  groupadd --system fronius-monitor
fi
if ! id fronius-monitor >/dev/null 2>&1; then
  useradd --system --gid fronius-monitor --home-dir /var/lib/fronius-monitor --shell /usr/sbin/nologin fronius-monitor
fi

install -d -o root -g root -m 0755 /opt/fronius-monitor
install -d -o root -g fronius-monitor -m 0750 /etc/fronius-monitor
install -d -o fronius-monitor -g fronius-monitor -m 0750 /var/lib/fronius-monitor

cp -a "${source_dir}/src" "${source_dir}/public" "${source_dir}/package.json" "${source_dir}/package-lock.json" /opt/fronius-monitor/

if [[ ! -f /etc/fronius-monitor/config.json ]]; then
  sed 's#"data/fronius-monitor.sqlite"#"/var/lib/fronius-monitor/fronius-monitor.sqlite"#' \
    "${source_dir}/config/config.example.json" > /etc/fronius-monitor/config.json
  chown root:fronius-monitor /etc/fronius-monitor/config.json
  chmod 0640 /etc/fronius-monitor/config.json
  config_created=true
else
  config_created=false
fi

cd /opt/fronius-monitor
"${npm_path}" ci --omit=dev --ignore-scripts
chown -R root:root /opt/fronius-monitor
chmod -R u=rwX,go=rX /opt/fronius-monitor

sed "s#@NODE_PATH@#${node_path}#" "${source_dir}/scripts/fronius-monitor.service" \
  > /etc/systemd/system/fronius-monitor.service
chmod 0644 /etc/systemd/system/fronius-monitor.service

systemctl daemon-reload
if [[ ${config_created} == true ]]; then
  echo
  echo "Configuration created at /etc/fronius-monitor/config.json"
  echo "Set froniusHost and verify dcPeakW before starting the service:"
  echo "  sudo nano /etc/fronius-monitor/config.json"
else
  systemctl enable --now fronius-monitor.service
  echo "Fronius Curtailment Monitor updated and restarted."
fi
