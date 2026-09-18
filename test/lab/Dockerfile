# Isolated seatmesh upgrade / poke lab. Does not touch host meshes.
FROM node:22-bookworm

ARG SEATMESH_VERSION=latest

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    openssh-server \
    sudo \
    tmux \
    vim-tiny \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/run/sshd \
  && ssh-keygen -A

# Password: seatmesh-lab (local poke only). Prefer key auth via lab.sh.
# node:22-bookworm already has uid 1000 (`node`) — rename to `lab`.
RUN usermod -l lab node \
  && groupmod -n lab node \
  && usermod -d /home/lab -m lab \
  && echo 'lab:seatmesh-lab' | chpasswd \
  && echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab \
  && chmod 440 /etc/sudoers.d/lab

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/lab-entrypoint.sh
COPY install-from-npm.sh /usr/local/bin/lab-install-from-npm.sh
COPY seed/ /opt/lab-seed/
RUN chmod +x /usr/local/bin/lab-entrypoint.sh /usr/local/bin/lab-install-from-npm.sh

# Optional bake of a rewritten npm install (LAB_INSTALL=npm). Default lab uses
# bind-mounted monorepo bin — published seatmesh still ships file: workspace deps.
ARG LAB_BAKE_NPM=1
RUN if [ "$LAB_BAKE_NPM" = "1" ]; then \
      /usr/local/bin/lab-install-from-npm.sh "$SEATMESH_VERSION"; \
    fi

ENV SEATMESH_SKIP_VERSION_CHECK=1 \
    LAB_HOME=/home/lab \
    LAB_MESH=/home/lab/mesh \
    LAB_INBOX_PORT=31691 \
    LAB_INSTALL=npm \
    SEATMESH_VERSION=${SEATMESH_VERSION}

EXPOSE 22 31691 3190
WORKDIR /home/lab/mesh
ENTRYPOINT ["/usr/local/bin/lab-entrypoint.sh"]
