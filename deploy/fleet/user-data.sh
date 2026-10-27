#!/bin/bash
# EC2 user data for one fleet machine: Docker, the bot image from ECR, and N bot containers (each its own wallet under
# /opt/benzo/botN). Settings come from the instance's tags-free template: CONTAINERS, WORKERS, STARTER_FIRST, PAUSE_*.
set -euxo pipefail
CONTAINERS=__CONTAINERS__; WORKERS=__WORKERS__; PAUSE_MIN=__PAUSE_MIN__; PAUSE_MAX=__PAUSE_MAX__; HOST=__HOST__
IMG=807872461891.dkr.ecr.eu-north-1.amazonaws.com/benzo-bot:1
dnf install -y docker; systemctl enable --now docker
aws ecr get-login-password --region eu-north-1 | docker login --username AWS --password-stdin 807872461891.dkr.ecr.eu-north-1.amazonaws.com
docker pull $IMG
for i in $(seq 1 $CONTAINERS); do
  mkdir -p /opt/benzo/bot$i
  docker run -d --name bot$i --restart always --shm-size=1g -v /opt/benzo/bot$i:/data \
    -e BOT_NAME=$HOST-bot$i -e WORKERS=$WORKERS -e STARTER=$([ $i = 1 ] && echo 1 || echo 0) -e PAUSE_MIN=$PAUSE_MIN -e PAUSE_MAX=$PAUSE_MAX \
    --log-opt max-size=20m --log-opt max-file=3 $IMG
done
