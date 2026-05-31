#!/bin/bash
set -e
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Steel Core Installer"
echo "===================="

if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
fi

echo -e "${YELLOW}Installing dependencies...${NC}"
case $OS in
    ubuntu|debian)
        apt-get update
        apt-get install -y curl docker.io docker-compose
        ;;
    *)
        echo -e "${RED}Unsupported OS. Please install Docker manually.${NC}"
        exit 1
        ;;
esac

systemctl start docker
systemctl enable docker

echo -e "${YELLOW}Generating secure credentials...${NC}"
DB_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 64)
ENCRYPTION_KEY=$(openssl rand -base64 32)
GRAFANA_PASSWORD=$(openssl rand -base64 16)

cat > .env << EOF
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}
EOF

echo -e "${YELLOW}Deploying...${NC}"
docker-compose pull
docker-compose up -d

echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Access:"
echo "  API:     http://localhost:3000"
echo "  Grafana: http://localhost:3001 (admin / ${GRAFANA_PASSWORD})"
